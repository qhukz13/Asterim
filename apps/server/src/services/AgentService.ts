import { eventBus } from './EventBus';
import {
  IAgentAdapter,
  AsterimEvent,
  ClientCommandPayload,
  ClientApprovalResponsePayload
} from '@asterim/shared';
import { SessionManager, globalProviderRegistry } from '@asterim/adapters';
import { WorkspaceMonitor } from './workspaceMonitor';
import crypto from 'crypto';
import { dbService } from './DatabaseService';

import { processTreeManager } from './ProcessTreeManager';
import { mcpAgentBridge } from './mcp/McpAgentBridge';
import { mcpToolGateway } from './mcp/McpToolGateway';
import {
  composeSessionInstructions,
  filterSkillsForProfile,
  filterToolsForProfile,
  profileService
} from './ai/ProfileService';
import type { AgentProfile } from '@asterim/shared';

export class AgentService {
  private sessionManager = new SessionManager();
  private workspaceMonitors = new Map<string, WorkspaceMonitor>(); // Keyed by projectId
  private activeSessions = new Map<string, string>(); // threadId -> sessionId
  private crashCounts = new Map<string, { count: number; lastCrash: number }>(); // threadId
  private adapterConfigs = new Map<
    string,
    {
      projectId: string;
      workspace: string;
      agentType: 'aider' | 'claude' | 'antigravity';
      profileId?: string;
    }
  >();
  private userStopped = new Set<string>(); // threadId
  private pendingStarts = new Map<string, Promise<void>>(); // threadId -> start promise

  constructor() {
    this.setupListeners();
    setInterval(() => {
      processTreeManager.sweepOrphanedProcesses().catch(() => {});
    }, 60000);
  }

  private setupListeners() {
    eventBus.subscribe<ClientCommandPayload>('client.command', async event => {
      try {
        const { command } = event.payload;
        const projectId = (event.payload as any).projectId;
        const threadId = (event.payload as any).threadId;
        const agentType = (event.payload as any).agentType || 'aider'; // 'aider', 'claude' or 'antigravity'
        // The profile the dashboard has selected for this thread, when it has
        // one. Absent means "whatever the thread was last started under".
        const profileId = (event.payload as any).profileId as string | undefined;

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
          this.crashCounts.delete(threadId);
          const startPromise = this.startAgent(projectId, threadId, project.path, agentType, profileId);
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
            const startPromise = this.startAgent(projectId, threadId, project.path, agentType, profileId);
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

    eventBus.subscribe<any>('client.stdin', async event => {
      try {
        const { data, threadId } = event.payload;
        if (!threadId) return;
        this.sessionManager.writeStdin(threadId, data);
      } catch (err) {
        console.error('[AgentService] Error processing stdin:', err);
      }
    });

    eventBus.subscribe<ClientApprovalResponsePayload>('client.approval_response', async event => {
      try {
        const { approved, threadId } = event.payload as any;
        const targetThreadId = threadId || Array.from(this.activeSessions.keys())[0];
        if (targetThreadId) {
          console.log(`[AgentService] Sending approval response '${approved ? 'y' : 'n'}' for thread ${targetThreadId}`);
          await this.sessionManager.sendCommand(targetThreadId, approved ? 'y' : 'n');
        }
      } catch (err) {
        console.error('[AgentService] Error processing approval response:', err);
      }
    });

    eventBus.subscribe<any>('client.chat_message', async event => {
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

        // Ensure agent session is started if not already active
        if (!this.sessionManager.getSessionAdapter(threadId)) {
          console.log(`[AgentService] Agent session not running for thread ${threadId}. Auto-starting agent...`);
          const { projectManager } = await import('./ProjectManager');
          const project = projectManager.getProject(projectId);
          if (project) {
            const config = this.adapterConfigs.get(threadId);
            const agentType = config?.agentType || 'antigravity';
            const startPromise = this.startAgent(
              projectId,
              threadId,
              project.path,
              agentType,
              config?.profileId
            );
            this.pendingStarts.set(threadId, startPromise);
            try {
              await startPromise;
            } finally {
              this.pendingStarts.delete(threadId);
            }
          }
        } else if (this.pendingStarts.has(threadId)) {
          await this.pendingStarts.get(threadId);
        }

        await this.sessionManager.sendCommand(threadId, content);
      } catch (err) {
        console.error('[AgentService] Error processing chat message:', err);
      }
    });

    eventBus.subscribe<any>('client.clear_chat', async event => {
      try {
        const { projectId, threadId } = event.payload;
        if (!projectId) return;
        const db = dbService.getDb();
        if (threadId) {
          db.prepare('DELETE FROM events WHERE project_id = ? AND (thread_id = ? OR thread_id IS NULL)').run(projectId, threadId);
        } else {
          db.prepare('DELETE FROM events WHERE project_id = ?').run(projectId);
        }

        const { getSocketManager } = await import('../sockets/socketManager');
        getSocketManager()?.clearRecentLogs(projectId);

        if (threadId) {
          const adapter = this.sessionManager.getSessionAdapter(threadId);
          if (adapter) {
            this.sessionManager.sendCommand(threadId, '/clear');
            eventBus.publish({
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              source: 'server',
              type: 'agent.status',
              payload: { status: 'idle', message: 'Chat cleared', projectId, threadId }
            });
          }
        }
      } catch (err) {
        console.error('[AgentService] Error clearing chat:', err);
      }
    });
  }

  private async startAgent(
    projectId: string,
    threadId: string,
    projectPath: string,
    agentType: 'aider' | 'claude' | 'antigravity',
    profileId?: string
  ) {
    if (this.sessionManager.getSessionAdapter(threadId)) {
      console.log(`[AgentService] Agent already running for thread ${threadId}`);
      return;
    }

    // A delegated thread with a sandbox runs in the sandbox (P8-01). Resolved
    // here rather than by the caller because every path into a session — start,
    // restart, crash recovery, the auto-start behind a chat message — has to
    // land in the same directory, and this is the one place they all meet.
    const workspace = this.resolveThreadWorkspace(threadId, projectPath);

    // Resolved before anything can fail, so a crash-restart further down
    // reuses the same persona rather than quietly dropping it.
    const profile = this.resolveProfile(threadId, profileId);

    this.userStopped.delete(threadId);
    this.adapterConfigs.set(threadId, {
      projectId,
      workspace,
      agentType,
      profileId: profile?.id ?? profileId
    });

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

    try {
      const db = dbService.getDb();
      const eventCount = db.prepare("SELECT COUNT(*) as count FROM events WHERE project_id = ? AND thread_id = ? AND type = 'chat.message'").get(projectId, threadId) as { count: number };
      const hasHistory = eventCount.count > 0;

      const { approvalManager } = await import('./ApprovalManager');
      const { questionManager } = await import('./QuestionManager');

      // Whatever MCP and the skills library are offering right now. Read at
      // session start rather than held: a server the user starts or a skill the
      // user writes later belongs to the next session, and a list captured once
      // would go stale without anyone noticing.
      const workspaceId = this.resolveWorkspaceId(projectId);
      const mcpTools = this.discoverMcpTools(workspaceId, workspace);
      const skills = mcpAgentBridge.discoverSkills(workspace);

      // The profile narrows both lists before either is described or made
      // callable. Filtering the catalogue rather than only the instructions
      // matters: the executor is built from these same descriptors, so a tool a
      // profile excludes is not merely unmentioned, it cannot be invoked.
      const allowedTools = filterToolsForProfile(mcpTools, profile);
      const allowedSkills = filterSkillsForProfile(skills, profile);

      // The delegation meta-tools (P7-01) are appended rather than filtered:
      // they belong to Asterim, not to a server or a skills directory, and who
      // gets them is decided by what the persona is for. Appended last so the
      // catalogue still opens with the work the session was started to do.
      const delegationTools = mcpAgentBridge.getDelegationTools(profile);

      const { toToolDescriptors, formatSessionInstructions } = await import('./mcp/McpToolPrompt');
      const toolDescriptors = toToolDescriptors([...allowedTools, ...delegationTools]);
      const mcpToolInstructions = composeSessionInstructions(
        profile,
        formatSessionInstructions(toolDescriptors, allowedSkills)
      );

      if (profile) {
        console.log(
          `[AgentService] Thread ${threadId} starts as '${profile.name}' with ${allowedTools.length}/${mcpTools.length} tools` +
            `${delegationTools.length > 0 ? ' plus delegation' : ''}.`
        );
      }

      await this.sessionManager.startSession(
        agentType,
        threadId,
        {
          workspace,
          hasHistory,
          mcpTools: toolDescriptors,
          mcpToolInstructions
        },
        (event: AsterimEvent) => {
          event.payload = { ...event.payload, projectId, threadId };
          eventBus.publish(event);
        },
        async (exitCode) => {
          processTreeManager.unregisterProcess(threadId);
          // If the session manager no longer tracks it, it means it was stopped
          // or a new one started. But we can check userStopped.
          const wasUserStopped = this.userStopped.has(threadId);
          if (wasUserStopped) {
            this.userStopped.delete(threadId);
            this.activeSessions.delete(threadId);
            return;
          }

          const sessionId = this.activeSessions.get(threadId);
          if (sessionId) {
            try {
              const db = dbService.getDb();
              const status = exitCode === 0 ? 'exited' : 'crashed';
              const update = db.prepare(
                'UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?'
              );
              update.run(status, Date.now(), sessionId);
            } catch (dbErr) {
              console.error('[AgentService] Failed to update session exit status:', dbErr);
            }
            this.activeSessions.delete(threadId);
          }

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

              eventBus.publish({
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                source: 'server',
                type: 'agent.status',
                payload: {
                  status: 'error',
                  message: `⚠️ **System Error**: Agent crashed. Auto-restarting (attempt ${nextCount}/3) in ${delay / 1000}s...`,
                  projectId,
                  threadId
                }
              });

              setTimeout(() => {
                this.startAgent(
                  config.projectId,
                  threadId,
                  config.workspace,
                  config.agentType,
                  config.profileId
                );
              }, delay);
              return;
            } else {
              console.log(
                `[AgentService] Agent for thread ${threadId} crashed 3 times or has no config. Giving up.`
              );
              this.crashCounts.delete(threadId);
              this.adapterConfigs.delete(threadId);

              eventBus.publish({
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                source: 'server',
                type: 'agent.status',
                payload: {
                  status: 'error',
                  message: `⚠️ **System Error**: Agent crashed repeatedly and cannot be restarted. Please verify that the agent CLI is installed and available in your PATH.`,
                  projectId,
                  threadId
                }
              });
            }
          }

          this.stopAgent(threadId);
        },
        adapter => {
          // Wired before the child process exists, so a tool call in its very
          // first line of output already has somewhere to go.
          adapter.setAvailableTools(toolDescriptors);
          adapter.registerToolExecutor(
            mcpToolGateway.createExecutor({
              projectId,
              threadId,
              workspaceId,
              workspacePath: workspace
            })
          );
        }
      );

      // The startup payload: what this session can call, on the record.
      eventBus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'server',
        type: 'agent.tools_available',
        payload: {
          projectId,
          threadId,
          tools: toolDescriptors.map(tool => ({ name: tool.name, description: tool.description }))
        }
      });

      const sessionId = crypto.randomUUID();
      const pid = this.sessionManager.getPid(threadId);
      if (pid) {
        processTreeManager.registerProcess(threadId, pid);
      }

      try {
        const db = dbService.getDb();
        const insert = db.prepare(
          'INSERT INTO sessions (id, project_id, thread_id, agent_type, status, pid, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        insert.run(
          sessionId,
          projectId,
          threadId,
          agentType,
          'running',
          pid ?? null,
          Date.now(),
          Date.now()
        );
        this.activeSessions.set(threadId, sessionId);
      } catch (dbErr) {
        console.error('[AgentService] Failed to write new session to database:', dbErr);
      }

      // Reset crash count on stable run of 10s
      if (pid) {
        setTimeout(() => {
          const currentAdapter = this.sessionManager.getSessionAdapter(threadId);
          if (
            currentAdapter &&
            typeof currentAdapter.getPid === 'function' &&
            currentAdapter.getPid() === pid
          ) {
            console.log(
              `[AgentService] Resetting crash count for thread ${threadId} after stable run.`
            );
            this.crashCounts.delete(threadId);
          }
        }, 10000);
      }

      // Start WorkspaceMonitor (Only start one per project)
      if (!this.workspaceMonitors.has(projectId)) {
        const monitor = new WorkspaceMonitor(workspace);
        monitor.onEvent((event: AsterimEvent) => {
          event.payload = { ...event.payload, projectId }; // workspace changes don't belong to a single thread
          eventBus.publish(event);
        });
        await monitor.start();
        this.workspaceMonitors.set(projectId, monitor);
      }

      console.log(`[AgentService] Started ${agentType} for thread ${threadId}`);
    } catch (err: any) {
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

  /**
   * The persona this session runs under, if any.
   *
   * An explicit id wins and is written back to the thread, so the choice the
   * user just made in the picker survives the next auto-start — a chat message
   * to a stopped agent starts it without going anywhere near the dashboard's
   * state. With no explicit id, the thread's recorded profile applies.
   *
   * Never fatal. An id naming a profile that has since been deleted, or an
   * unreadable table, yields no profile and the session starts exactly as it
   * did before profiles existed.
   */
  private resolveProfile(threadId: string, profileId?: string): AgentProfile | null {
    try {
      if (profileId) {
        const explicit = profileService.getProfile(profileId);
        profileService.setThreadProfile(threadId, explicit ? explicit.id : null);
        if (!explicit) {
          console.warn(
            `[AgentService] Thread ${threadId} asked for profile ${profileId}, which no longer exists.`
          );
        }
        return explicit;
      }
      return profileService.getThreadProfile(threadId);
    } catch (err) {
      console.error('[AgentService] Could not resolve the agent profile:', err);
      return null;
    }
  }

  /**
   * The directory a thread's session actually runs in (P8-01).
   *
   * The project directory for an ordinary thread, and the Git worktree for a
   * delegated one that was given a sandbox. The directory has to still be there:
   * an operator who discarded a sandbox and then restarted the child would
   * otherwise get a session that cannot start at all, where what they want is
   * the child running in the project again.
   */
  private resolveThreadWorkspace(threadId: string, projectPath: string): string {
    try {
      const row = dbService
        .getDb()
        .prepare('SELECT worktree_path FROM threads WHERE id = ?')
        .get(threadId) as { worktree_path?: string | null } | undefined;
      const sandbox = row?.worktree_path;
      if (!sandbox) return projectPath;

      const fs = require('fs');
      if (!fs.existsSync(sandbox)) {
        console.warn(
          `[AgentService] Sandbox ${sandbox} for thread ${threadId} is gone; running in ${projectPath}`
        );
        return projectPath;
      }
      return sandbox;
    } catch (err) {
      console.warn(
        `[AgentService] Could not resolve the working directory for thread ${threadId}: ${(err as Error).message}`
      );
      return projectPath;
    }
  }

  /**
   * The workspace a project belongs to, if it belongs to one.
   *
   * Scopes the MCP catalogue: a workspace's servers plus the
   * workstation-wide ones, which is the same rule the supervisor applies.
   */
  private resolveWorkspaceId(projectId: string): string | undefined {
    try {
      const db = dbService.getDb();
      const row = db
        .prepare('SELECT workspace_id FROM projects WHERE id = ?')
        .get(projectId) as { workspace_id?: string | null } | undefined;
      return row?.workspace_id ?? undefined;
    } catch (err) {
      console.warn(
        `[AgentService] Could not resolve the workspace for project ${projectId}: ${(err as Error).message}`
      );
      return undefined;
    }
  }

  /**
   * The tools available to a session — MCP tools and skills alike. Never fatal:
   * no tools is a session.
   *
   * `workspacePath` is the project directory, which is what scopes skills; the
   * workspace id scopes MCP servers.
   */
  private discoverMcpTools(workspaceId?: string, workspacePath?: string) {
    try {
      return mcpAgentBridge.getAvailableTools(workspaceId, workspacePath);
    } catch (err) {
      console.error('[AgentService] Could not list MCP tools:', err);
      return [];
    }
  }

  private async stopAgent(threadId: string) {
    this.userStopped.add(threadId);
    this.crashCounts.delete(threadId);

    // Anything this thread was waiting on a human for is moot now. Left alone,
    // the approval card outlives the session that asked for it.
    const cancelled = mcpToolGateway.cancelPendingForThread(threadId);
    if (cancelled > 0) {
      console.log(
        `[AgentService] Cancelled ${cancelled} pending tool approval(s) for thread ${threadId}`
      );
    }

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

    await processTreeManager.killProcessTree(threadId, 3000);
    await this.sessionManager.stopSession(threadId);

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
    await this.sessionManager.sendCommand(threadId, command);
  }

  public recoverSessions() {
    try {
      const db = dbService.getDb();
      const query = db.prepare("SELECT * FROM sessions WHERE status = 'running'");
      const rows = query.all() as { id: string; project_id: string; agent_type: string }[];

      if (rows.length === 0) return;

      const update = db.prepare(
        "UPDATE sessions SET status = 'crashed', updated_at = ? WHERE id = ?"
      );

      for (const row of rows) {
        update.run(Date.now(), row.id);
        console.log(
          `[AgentService] Recovered active session ${row.id} for project ${row.project_id} (marked as crashed)`
        );

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
