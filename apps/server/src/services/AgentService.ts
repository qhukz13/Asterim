import { eventBus } from './EventBus';
import { IAgentAdapter, AgentDeckEvent, ClientCommandPayload, ClientApprovalResponsePayload } from '@agentdeck/shared';
import { AiderAdapter, ClaudeAdapter, AntigravityAdapter } from '@agentdeck/adapters';
import { WorkspaceMonitor } from './workspaceMonitor';
import crypto from 'crypto';
import { dbService } from './DatabaseService';

export class AgentService {
  private activeAdapters = new Map<string, IAgentAdapter>(); // Keyed by threadId
  private workspaceMonitors = new Map<string, WorkspaceMonitor>(); // Keyed by projectId
  private activeSessions = new Map<string, string>(); // threadId -> sessionId
  private crashCounts = new Map<string, { count: number; lastCrash: number }>(); // threadId
  private adapterConfigs = new Map<string, { projectId: string; workspace: string; agentType: 'aider' | 'claude' | 'antigravity' }>();
  private userStopped = new Set<string>(); // threadId
  private pendingStarts = new Map<string, Promise<void>>(); // threadId -> start promise

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    eventBus.subscribe<ClientCommandPayload>('client.command', async (event) => {
      try {
        const { command } = event.payload;
        const projectId = (event.payload as any).projectId;
        const threadId = (event.payload as any).threadId;
        const agentType = (event.payload as any).agentType || 'aider'; // 'aider', 'claude' or 'antigravity'

        if (!projectId || !threadId) {
          console.error('[AgentService] client.command requires projectId and threadId');
          return;
        }

        if (command === 'start') {
          const { projectManager } = await import('./ProjectManager');
          const project = projectManager.getProject(projectId);
          if (!project) {
            console.error(`[AgentService] Project ${projectId} not found`);
            return;
          }
          const startPromise = this.startAgent(projectId, threadId, project.path, agentType);
          this.pendingStarts.set(threadId, startPromise);
          try {
            await startPromise;
          } finally {
            this.pendingStarts.delete(threadId);
          }
        } else if (command === 'stop') {
          await this.stopAgent(threadId);
        } else if (command === 'restart') {
          await this.stopAgent(threadId);
          await new Promise(resolve => setTimeout(resolve, 1000));
          const { projectManager } = await import('./ProjectManager');
          const project = projectManager.getProject(projectId);
          if (project) {
            const startPromise = this.startAgent(projectId, threadId, project.path, agentType);
            this.pendingStarts.set(threadId, startPromise);
            try {
              await startPromise;
            } finally {
              this.pendingStarts.delete(threadId);
            }
          }
        } else {
          await this.sendCommand(threadId, command);
        }
      } catch (err) {
        console.error('[AgentService] FATAL ERROR processing command:', err);
      }
    });

    eventBus.subscribe<any>('client.stdin', async (event) => {
      try {
        const { data, threadId } = event.payload;
        if (!threadId) return;
        const adapter = this.activeAdapters.get(threadId);
        if (adapter && adapter.writeStdin) {
          adapter.writeStdin(data);
        }
      } catch (err) {
        console.error('[AgentService] Error processing stdin:', err);
      }
    });

    eventBus.subscribe<any>('client.chat_message', async (event) => {
      try {
        const { content, projectId, threadId } = event.payload;
        if (!projectId || !threadId || !content) return;
        
        eventBus.publish({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          type: 'chat.message',
          source: 'server',
          payload: {
            projectId,
            threadId,
            role: 'user',
            content
          }
        });

        // If the agent is currently starting, wait for it to finish
        if (this.pendingStarts.has(threadId)) {
          await this.pendingStarts.get(threadId);
        }

        const adapter = this.activeAdapters.get(threadId);
        if (adapter && adapter.sendCommand) {
          await adapter.sendCommand(content);
        }
      } catch (err) {
        console.error('[AgentService] Error processing chat message:', err);
      }
    });

    eventBus.subscribe<any>('client.clear_chat', async (event) => {
      try {
        const { projectId, threadId } = event.payload;
        if (!threadId) return;
        const db = dbService.getDb();
        db.prepare('DELETE FROM events WHERE thread_id = ?').run(threadId);
      } catch (err) {
        console.error('[AgentService] Error clearing chat:', err);
      }
    });
  }

  private async startAgent(projectId: string, threadId: string, workspace: string, agentType: 'aider' | 'claude' | 'antigravity') {
    if (this.activeAdapters.has(threadId)) {
      console.log(`[AgentService] Agent already running for thread ${threadId}`);
      return;
    }

    this.userStopped.delete(threadId);
    this.adapterConfigs.set(threadId, { projectId, workspace, agentType });

    const fs = require('fs');
    if (!fs.existsSync(workspace)) {
      eventBus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'server',
        type: 'agent.status',
        payload: {
          status: 'error',
          message: `Error: Workspace directory does not exist: ${workspace}`,
          projectId,
          threadId
        }
      });
      this.adapterConfigs.delete(threadId);
      return;
    }

    const adapter = agentType === 'claude'
      ? new ClaudeAdapter()
      : agentType === 'antigravity'
      ? new AntigravityAdapter()
      : new AiderAdapter();
      
    this.activeAdapters.set(threadId, adapter);
    
    adapter.onEvent((event: AgentDeckEvent) => {
      event.payload = { ...event.payload, projectId, threadId };
      eventBus.publish(event);
    });

    try {
      const { approvalManager } = await import('./ApprovalManager');
      const { questionManager } = await import('./QuestionManager');
      await adapter.start({
        workspace,
        requestApproval: (desc, cmd) => approvalManager.requestApproval(projectId, desc, cmd),
        requestQuestion: (q, opts) => questionManager.requestQuestion(projectId, q, opts),
        onExit: async (exitCode) => {
          if (this.activeAdapters.has(threadId) && this.activeAdapters.get(threadId) !== adapter) {
            // A new adapter has already been started for this thread, ignore this old adapter's exit.
            return;
          }

          const wasUserStopped = this.userStopped.has(threadId);
          if (wasUserStopped) {
            this.userStopped.delete(threadId);
            this.activeSessions.delete(threadId);
            this.activeAdapters.delete(threadId);
            return;
          }

          const sessionId = this.activeSessions.get(threadId);
          if (sessionId) {
            try {
              const db = dbService.getDb();
              const status = exitCode === 0 ? 'exited' : 'crashed';
              const update = db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?');
              update.run(status, Date.now(), sessionId);
            } catch (dbErr) {
              console.error('[AgentService] Failed to update session exit status:', dbErr);
            }
            this.activeSessions.delete(threadId);
          }

          this.activeAdapters.delete(threadId);
          const monitor = this.workspaceMonitors.get(projectId);
          if (monitor) {
            await monitor.stop();
            this.workspaceMonitors.delete(projectId);
          }

          if (exitCode !== 0) {
            const config = this.adapterConfigs.get(threadId);
            const crashInfo = this.crashCounts.get(threadId) || { count: 0, lastCrash: 0 };
            
            if (config && crashInfo.count < 3) {
              const nextCount = crashInfo.count + 1;
              this.crashCounts.set(threadId, { count: nextCount, lastCrash: Date.now() });
              const delay = nextCount * 2000;
              
              const lastOutput = adapter.getLastOutput ? adapter.getLastOutput() : '';
              const outputMsg = lastOutput ? `\n\nLast Output:\n\`\`\`\n${lastOutput}\n\`\`\`` : '';

              eventBus.publish({
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                source: 'server',
                type: 'agent.status',
                payload: {
                  status: 'error',
                  message: `⚠️ **System Error**: Agent crashed. Auto-restarting (attempt ${nextCount}/3) in ${delay/1000}s...${outputMsg}`,
                  projectId,
                  threadId
                }
              });
              
              setTimeout(() => {
                this.startAgent(config.projectId, threadId, config.workspace, config.agentType);
              }, delay);
              return;
            } else {
              console.log(`[AgentService] Agent for thread ${threadId} crashed 3 times or has no config. Giving up.`);
              this.crashCounts.delete(threadId);
              this.adapterConfigs.delete(threadId);
              
              const lastOutput = adapter.getLastOutput ? adapter.getLastOutput() : '';
              const outputMsg = lastOutput ? `\n\nLast Output:\n\`\`\`\n${lastOutput}\n\`\`\`` : '';

              eventBus.publish({
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                source: 'server',
                type: 'agent.status',
                payload: {
                  status: 'error',
                  message: `⚠️ **System Error**: Agent crashed repeatedly and cannot be restarted. Please verify that the agent CLI is installed and available in your PATH.${outputMsg}`,
                  projectId,
                  threadId
                }
              });
            }
          }

          this.stopAgent(threadId);
        }
      });

      const sessionId = crypto.randomUUID();
      const pid = typeof adapter.getPid === 'function' ? adapter.getPid() : null;

      try {
        const db = dbService.getDb();
        const insert = db.prepare('INSERT INTO sessions (id, project_id, thread_id, agent_type, status, pid, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        insert.run(sessionId, projectId, threadId, agentType, 'running', pid ?? null, Date.now(), Date.now());
        this.activeSessions.set(threadId, sessionId);
      } catch (dbErr) {
        console.error('[AgentService] Failed to write new session to database:', dbErr);
      }

      // Reset crash count on stable run of 10s
      if (pid) {
        setTimeout(() => {
          const currentAdapter = this.activeAdapters.get(threadId);
          if (currentAdapter && typeof currentAdapter.getPid === 'function' && currentAdapter.getPid() === pid) {
            console.log(`[AgentService] Resetting crash count for thread ${threadId} after stable run.`);
            this.crashCounts.delete(threadId);
          }
        }, 10000);
      }

      // Start WorkspaceMonitor (Only start one per project)
      if (!this.workspaceMonitors.has(projectId)) {
        const monitor = new WorkspaceMonitor(workspace);
        monitor.onEvent((event: AgentDeckEvent) => {
          event.payload = { ...event.payload, projectId }; // workspace changes don't belong to a single thread
          eventBus.publish(event);
        });
        await monitor.start();
        this.workspaceMonitors.set(projectId, monitor);
      }

      console.log(`[AgentService] Started ${agentType} for thread ${threadId}`);
    } catch (err: any) {
      if (this.activeAdapters.get(threadId) === adapter) {
        this.activeAdapters.delete(threadId);
      }
      console.error(`[AgentService] Failed to start agent for thread ${threadId}:`, err);
      eventBus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'server',
        type: 'agent.status',
        payload: {
          status: 'idle',
          message: `Error starting agent: ${err.message || String(err)}. Is the agent installed?`,
          projectId,
          threadId
        }
      });
    }
  }

  private async stopAgent(threadId: string) {
    this.userStopped.add(threadId);
    this.crashCounts.delete(threadId);
    
    const config = this.adapterConfigs.get(threadId);
    this.adapterConfigs.delete(threadId);

    // Emit idle status to UI immediately
    if (config) {
      eventBus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'server',
        type: 'agent.status',
        payload: {
          status: 'idle',
          message: 'Agent stopped by user',
          projectId: config.projectId,
          threadId
        }
      });
    }

    const sessionId = this.activeSessions.get(threadId);
    if (sessionId) {
      try {
        const db = dbService.getDb();
        const update = db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?');
        update.run('stopped', Date.now(), sessionId);
      } catch (dbErr) {
        console.error('[AgentService] Failed to update session stop status in database:', dbErr);
      }
      this.activeSessions.delete(threadId);
    }

    const adapter = this.activeAdapters.get(threadId);
    if (adapter) {
      await adapter.stop();
      this.activeAdapters.delete(threadId);
    }

    eventBus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server',
      type: 'agent.status',
      payload: {
        status: 'idle',
        message: 'Agent stopped manually.',
        projectId: config?.projectId,
        threadId
      }
    });

    console.log(`[AgentService] Stopped agent for thread ${threadId}`);
  }

  private async sendCommand(threadId: string, command: string) {
    const adapter = this.activeAdapters.get(threadId);
    if (adapter) {
      await adapter.sendCommand(command);
    } else {
      console.log(`[AgentService] No active agent for thread ${threadId} to receive command`);
    }
  }

  public recoverSessions() {
    try {
      const db = dbService.getDb();
      const query = db.prepare("SELECT * FROM sessions WHERE status = 'running'");
      const rows = query.all() as { id: string, project_id: string, agent_type: string }[];
      
      if (rows.length === 0) return;

      const update = db.prepare("UPDATE sessions SET status = 'crashed', updated_at = ? WHERE id = ?");
      
      for (const row of rows) {
        update.run(Date.now(), row.id);
        console.log(`[AgentService] Recovered active session ${row.id} for project ${row.project_id} (marked as crashed)`);
        
        // Publish event to notify client
        eventBus.publish({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          source: 'server',
          type: 'agent.status',
          payload: {
            status: 'error',
            message: 'Agent crashed or server restarted unexpectedly.',
            projectId: row.project_id
          }
        });
      }
    } catch (err) {
      console.error('[AgentService] Failed to recover running sessions:', err);
    }
  }
}

export const agentService = new AgentService();
