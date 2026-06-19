import { eventBus } from './EventBus';
import { IAgentAdapter, AgentDeckEvent, ClientCommandPayload, ClientApprovalResponsePayload } from '@agentdeck/shared';
import { AiderAdapter, ClaudeAdapter } from '@agentdeck/adapters';
import { WorkspaceMonitor } from './workspaceMonitor';
import crypto from 'crypto';
import { dbService } from './DatabaseService';

export class AgentService {
  private activeAdapters = new Map<string, IAgentAdapter>();
  private workspaceMonitors = new Map<string, WorkspaceMonitor>();
  private activeSessions = new Map<string, string>(); // projectId -> sessionId

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    eventBus.subscribe<ClientCommandPayload>('client.command', async (event) => {
      try {
        const { command } = event.payload;
        const projectId = (event.payload as any).projectId;
        const agentType = (event.payload as any).agentType || 'aider'; // 'aider' or 'claude'

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
  }

  private async startAgent(projectId: string, workspace: string, agentType: 'aider' | 'claude') {
    if (this.activeAdapters.has(projectId)) {
      console.log(`[AgentService] Agent already running for project ${projectId}`);
      return;
    }

    const adapter = agentType === 'claude' ? new ClaudeAdapter() : new AiderAdapter();
    
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
        onExit: (exitCode) => {
          const sessionId = this.activeSessions.get(projectId);
          if (sessionId) {
            try {
              const db = dbService.getDb();
              const status = exitCode === 0 ? 'exited' : 'crashed';
              const update = db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?');
              update.run(status, Date.now(), sessionId);
              console.log(`[AgentService] Agent session ${sessionId} for project ${projectId} exited naturally: ${status}`);
            } catch (dbErr) {
              console.error('[AgentService] Failed to update session exit status in database:', dbErr);
            }
            this.activeSessions.delete(projectId);
          }
          this.stopAgent(projectId);
        }
      });

      const sessionId = crypto.randomUUID();
      try {
        const db = dbService.getDb();
        const insert = db.prepare('INSERT INTO sessions (id, project_id, agent_type, status, pid, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const pid = typeof adapter.getPid === 'function' ? adapter.getPid() : null;
        insert.run(sessionId, projectId, agentType, 'running', pid, Date.now(), Date.now());
        this.activeSessions.set(projectId, sessionId);
      } catch (dbErr) {
        console.error('[AgentService] Failed to write new session to database:', dbErr);
      }

      this.activeAdapters.set(projectId, adapter);

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
          message: `Error starting agent: ${err.message || String(err)}. Is Aider installed?`,
          projectId
        }
      });
    }
  }

  private async stopAgent(projectId: string) {
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
