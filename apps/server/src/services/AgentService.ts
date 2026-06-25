import { eventBus } from './EventBus';
import { IAgentAdapter, AgentDeckEvent, ClientCommandPayload, ClientApprovalResponsePayload } from '@agentdeck/shared';
import { AiderAdapter, ClaudeAdapter, AntigravityAdapter } from '@agentdeck/adapters';
import { WorkspaceMonitor } from './workspaceMonitor';
import crypto from 'crypto';
import { dbService } from './DatabaseService';

export class AgentService {
  private activeAdapters = new Map<string, IAgentAdapter>();
  private workspaceMonitors = new Map<string, WorkspaceMonitor>();
  private activeSessions = new Map<string, string>(); // projectId -> sessionId
  private crashCounts = new Map<string, { count: number; lastCrash: number }>();
  private adapterConfigs = new Map<string, { workspace: string; agentType: 'aider' | 'claude' | 'antigravity' }>();
  private userStopped = new Set<string>();

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    eventBus.subscribe<ClientCommandPayload>('client.command', async (event) => {
      try {
        const { command } = event.payload;
        const projectId = (event.payload as any).projectId;
        const agentType = (event.payload as any).agentType || 'aider'; // 'aider', 'claude' or 'antigravity'

        if (!projectId) {
          console.error('[AgentService] client.command requires projectId');
          return;
        }

        if (command === 'start') {
          const { projectManager } = await import('./ProjectManager');
          const project = projectManager.getProject(projectId);
          if (!project) {
            console.error(`[AgentService] Project ${projectId} not found`);
            return;
          }
          await this.startAgent(projectId, project.path, agentType);
        } else if (command === 'stop') {
          await this.stopAgent(projectId);
        } else {
          await this.sendCommand(projectId, command);
        }
      } catch (err) {
        console.error('[AgentService] FATAL ERROR processing command:', err);
      }
    });

    eventBus.subscribe<any>('client.stdin', async (event) => {
      try {
        const { data, projectId } = event.payload;
        if (!projectId) return;
        const adapter = this.activeAdapters.get(projectId);
        if (adapter && adapter.writeStdin) {
          adapter.writeStdin(data);
        }
      } catch (err) {
        console.error('[AgentService] Error processing stdin:', err);
      }
    });

    eventBus.subscribe<any>('client.chat_message', async (event) => {
      try {
        const { content, projectId } = event.payload;
        if (!projectId || !content) return;
        
        // Echo the user's message back to all clients in the project room
        eventBus.publish({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          type: 'chat.message',
          source: 'server',
          payload: {
            projectId,
            role: 'user',
            content
          }
        });

        const adapter = this.activeAdapters.get(projectId);
        if (adapter && adapter.sendCommand) {
          await adapter.sendCommand(content);
        }
      } catch (err) {
        console.error('[AgentService] Error processing chat message:', err);
      }
    });

    eventBus.subscribe<any>('client.clear_chat', async (event) => {
      try {
        const { projectId } = event.payload;
        if (!projectId) return;
        console.log(`[AgentService] Clearing chat history for project ${projectId}`);
        const db = dbService.getDb();
        db.prepare('DELETE FROM events WHERE project_id = ?').run(projectId);
      } catch (err) {
        console.error('[AgentService] Error clearing chat:', err);
      }
    });
  }

  private async startAgent(projectId: string, workspace: string, agentType: 'aider' | 'claude' | 'antigravity') {
    if (this.activeAdapters.has(projectId)) {
      console.log(`[AgentService] Agent already running for project ${projectId}`);
      return;
    }

    this.userStopped.delete(projectId);
    this.adapterConfigs.set(projectId, { workspace, agentType });

    const adapter = agentType === 'claude'
      ? new ClaudeAdapter()
      : agentType === 'antigravity'
      ? new AntigravityAdapter()
      : new AiderAdapter();
    
    // Connect adapter events to EventBus
    adapter.onEvent((event: AgentDeckEvent) => {
      // Inject projectId into payload for routing
      event.payload = { ...event.payload, projectId };
      eventBus.publish(event);
    });

    try {
      const { approvalManager } = await import('./ApprovalManager');
      await adapter.start({
        workspace,
        requestApproval: (desc, cmd) => approvalManager.requestApproval(projectId, desc, cmd),
        onExit: async (exitCode) => {
          const wasUserStopped = this.userStopped.has(projectId);
          if (wasUserStopped) {
            this.userStopped.delete(projectId);
            this.activeSessions.delete(projectId);
            this.activeAdapters.delete(projectId);
            const monitor = this.workspaceMonitors.get(projectId);
            if (monitor) {
              await monitor.stop();
              this.workspaceMonitors.delete(projectId);
            }
            return;
          }

          const sessionId = this.activeSessions.get(projectId);
          if (sessionId) {
            try {
              const db = dbService.getDb();
              const status = exitCode === 0 ? 'exited' : 'crashed';
              const update = db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?');
              update.run(status, Date.now(), sessionId);
              console.log(`[AgentService] Agent session ${sessionId} for project ${projectId} exited: ${status}`);
            } catch (dbErr) {
              console.error('[AgentService] Failed to update session exit status in database:', dbErr);
            }
            this.activeSessions.delete(projectId);
          }

          // Clean up local adapter and workspace monitor
          this.activeAdapters.delete(projectId);
          const monitor = this.workspaceMonitors.get(projectId);
          if (monitor) {
            await monitor.stop();
            this.workspaceMonitors.delete(projectId);
          }

          if (exitCode !== 0) {
            // It crashed! Check if we can auto-restart
            const config = this.adapterConfigs.get(projectId);
            const crashInfo = this.crashCounts.get(projectId) || { count: 0, lastCrash: 0 };
            
            if (config && crashInfo.count < 3) {
              const nextCount = crashInfo.count + 1;
              this.crashCounts.set(projectId, { count: nextCount, lastCrash: Date.now() });
              const delay = nextCount * 2000;
              
              console.log(`[AgentService] Agent for project ${projectId} crashed. Attempting auto-restart ${nextCount}/3 in ${delay}ms...`);
              
              eventBus.publish({
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                source: 'server',
                type: 'agent.status',
                payload: {
                  status: 'error',
                  message: `Agent crashed. Auto-restarting (attempt ${nextCount}/3) in ${delay/1000}s...`,
                  projectId
                }
              });
              
              setTimeout(() => {
                this.startAgent(projectId, config.workspace, config.agentType);
              }, delay);
              return;
            } else {
              console.log(`[AgentService] Agent for project ${projectId} crashed 3 times or has no config. Giving up.`);
              this.crashCounts.delete(projectId);
              this.adapterConfigs.delete(projectId);
            }
          }

          this.stopAgent(projectId);
        }
      });

      const sessionId = crypto.randomUUID();
      const pid = typeof adapter.getPid === 'function' ? adapter.getPid() : null;

      try {
        const db = dbService.getDb();
        const insert = db.prepare('INSERT INTO sessions (id, project_id, agent_type, status, pid, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        insert.run(sessionId, projectId, agentType, 'running', pid ?? null, Date.now(), Date.now());
        this.activeSessions.set(projectId, sessionId);
      } catch (dbErr) {
        console.error('[AgentService] Failed to write new session to database:', dbErr);
      }

      this.activeAdapters.set(projectId, adapter);

      // Reset crash count on stable run of 10s
      if (pid) {
        setTimeout(() => {
          const currentAdapter = this.activeAdapters.get(projectId);
          if (currentAdapter && typeof currentAdapter.getPid === 'function' && currentAdapter.getPid() === pid) {
            console.log(`[AgentService] Resetting crash count for project ${projectId} after stable run.`);
            this.crashCounts.delete(projectId);
          }
        }, 10000);
      }

      // Start WorkspaceMonitor
      const monitor = new WorkspaceMonitor(workspace);
      monitor.onEvent((event: AgentDeckEvent) => {
        event.payload = { ...event.payload, projectId };
        eventBus.publish(event);
      });
      await monitor.start();
      this.workspaceMonitors.set(projectId, monitor);

      console.log(`[AgentService] Started ${agentType} for project ${projectId}`);
    } catch (err: any) {
      console.error(`[AgentService] Failed to start agent for project ${projectId}:`, err);
      eventBus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'server',
        type: 'agent.status',
        payload: {
          status: 'idle',
          message: `Error starting agent: ${err.message || String(err)}. Is the agent installed?`,
          projectId
        }
      });
    }
  }

  private async stopAgent(projectId: string) {
    this.userStopped.add(projectId);
    this.crashCounts.delete(projectId);
    this.adapterConfigs.delete(projectId);

    const sessionId = this.activeSessions.get(projectId);
    if (sessionId) {
      try {
        const db = dbService.getDb();
        const update = db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?');
        update.run('stopped', Date.now(), sessionId);
      } catch (dbErr) {
        console.error('[AgentService] Failed to update session stop status in database:', dbErr);
      }
      this.activeSessions.delete(projectId);
    }

    const adapter = this.activeAdapters.get(projectId);
    if (adapter) {
      await adapter.stop();
      this.activeAdapters.delete(projectId);
    }

    const monitor = this.workspaceMonitors.get(projectId);
    if (monitor) {
      await monitor.stop();
      this.workspaceMonitors.delete(projectId);
    }

    eventBus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server',
      type: 'agent.status',
      payload: {
        status: 'idle',
        message: 'Agent stopped manually.',
        projectId
      }
    });

    console.log(`[AgentService] Stopped agent and monitor for project ${projectId}`);
  }

  private async sendCommand(projectId: string, command: string) {
    const adapter = this.activeAdapters.get(projectId);
    if (adapter) {
      await adapter.sendCommand(command);
    } else {
      console.log(`[AgentService] No active agent for project ${projectId} to receive command`);
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
