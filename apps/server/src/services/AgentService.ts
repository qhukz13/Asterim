import { eventBus } from './EventBus';
import {
  IAgentAdapter,
  AsterimEvent,
  AGENT_STARTED_EVENT,
  AGENT_STOPPED_EVENT,
  AUDIT_SUBJECT_MAX_CHARS,
  POLICY_VIOLATION_EVENT,
  ClientCommandPayload,
  ClientApprovalResponsePayload
} from '@asterim/shared';
import type { PolicyViolationPayload } from '@asterim/shared';
import { SessionManager, globalProviderRegistry } from '@asterim/adapters';
import { WorkspaceMonitor } from './workspaceMonitor';
import crypto from 'crypto';
import { dbService } from './DatabaseService';

import { processTreeManager } from './ProcessTreeManager';
import { environmentSecretService } from './security/EnvironmentSecretService';
import { mcpAgentBridge } from './mcp/McpAgentBridge';
import { mcpToolGateway } from './mcp/McpToolGateway';
import {
  composeSessionInstructions,
  filterSkillsForProfile,
  filterToolsForProfile,
  profileService
} from './ai/ProfileService';
import { fleetPolicyService } from './enterprise/FleetPolicyService';
import type { AgentProfile } from '@asterim/shared';
import type { NativePermissionAsk } from '@asterim/adapters';
import type { CommandSecurityAnalysis } from './ApprovalManager';

/** A permission request raised by an agent through its own protocol. */
export interface NativePermissionRequest {
  projectId: string;
  threadId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId?: string;
  agentDescription?: string;
  reason?: string;
  /** Aborted when the agent withdraws the request before it is answered. */
  signal?: AbortSignal;
}

/** The settings key under which a thread's provider session id is kept. */
function providerSessionKey(threadId: string): string {
  return `provider_session:${threadId}`;
}

/**
 * What to show a person for one tool call. The command field is what the
 * security heuristics look at, so for shell tools it is the command itself and
 * for file tools it is the path.
 */
export function describePermission(
  toolName: string,
  input: Record<string, unknown>
): { description: string; command: string } {
  const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '');
  switch (toolName) {
    case 'Bash':
    case 'PowerShell':
      return {
        description: str('description') || `Run a ${toolName === 'Bash' ? 'shell' : 'PowerShell'} command`,
        command: str('command') || '(empty command)'
      };
    case 'Edit':
    case 'MultiEdit':
      return { description: `Edit file ${str('file_path')}`.trim(), command: str('file_path') };
    case 'Write':
      return { description: `Write file ${str('file_path')}`.trim(), command: str('file_path') };
    case 'NotebookEdit':
      return { description: `Edit notebook ${str('notebook_path')}`.trim(), command: str('notebook_path') };
    case 'WebFetch':
      return { description: 'Fetch a web page', command: str('url') };
    default: {
      let serialised: string;
      try {
        serialised = JSON.stringify(input);
      } catch {
        serialised = '';
      }
      if (serialised.length > 400) serialised = `${serialised.slice(0, 400)}…`;
      return { description: `Use tool ${toolName}`, command: serialised || toolName };
    }
  }
}

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
          await this.stopAgent(threadId, 'stopped by user');
        } else if (command === 'restart') {
          await this.stopAgent(threadId, 'restarted by user');
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
          // A raw command is about to be written to a PTY. The fleet policy gate
          // is here rather than in `sendCommand` so the refusal happens before
          // anything is queued on the adapter (P10-01).
          if (!this.enforceCommandPolicy(projectId, threadId, command)) return;
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
        if (!targetThreadId) return;
        // An adapter that raised the request through its own protocol gets the
        // answer through that protocol (the hook response). Writing `y` into
        // its stdin would send the letter to the model as a message.
        const adapter = this.sessionManager.getSessionAdapter(targetThreadId);
        if (adapter?.handlesApprovalsNatively) return;
        console.log(`[AgentService] Sending approval response '${approved ? 'y' : 'n'}' for thread ${targetThreadId}`);
        await this.sessionManager.sendCommand(targetThreadId, approved ? 'y' : 'n');
      } catch (err) {
        console.error('[AgentService] Error processing approval response:', err);
      }
    });

    // A provider that keeps its own conversation (Claude Code) announces its
    // session id once; remembering it is what lets the thread be resumed after
    // the Core restarts instead of starting the conversation over.
    eventBus.subscribe<any>('agent.session', event => {
      try {
        const { threadId, providerSessionId } = event.payload || {};
        if (!threadId || typeof providerSessionId !== 'string' || !providerSessionId) return;
        dbService
          .getDb()
          .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
          .run(providerSessionKey(threadId), providerSessionId);
      } catch (err) {
        console.error('[AgentService] Failed to persist provider session id:', err);
      }
    });

    eventBus.subscribe<any>('client.chat_message', async event => {
      try {
        const { content, projectId, threadId } = event.payload;
        if (!projectId || !threadId || !content) return;

        // Chat text reaches the same PTY stdin a command does — an agent asked
        // in prose to run `curl … | sh` runs it — so the same gate applies, and
        // it applies before the message is echoed back to the room.
        if (!this.enforceCommandPolicy(projectId, threadId, content)) return;

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
          // Clearing the chat means a fresh conversation. A provider that
          // resumes its own session would otherwise carry the old one along, so
          // the remembered session id goes and the process is stopped; the next
          // message starts it again without `--resume`.
          try {
            db.prepare('DELETE FROM settings WHERE key = ?').run(providerSessionKey(threadId));
          } catch (err) {
            console.error('[AgentService] Failed to forget provider session id:', err);
          }
          const adapter = this.sessionManager.getSessionAdapter(threadId);
          if (adapter?.handlesApprovalsNatively) {
            await this.stopAgent(threadId, 'chat cleared');
          } else if (adapter) {
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

    // The fleet allowlist is checked before a process is spawned, not after
    // (P10-01). Every path into a session — start, restart, crash recovery, the
    // auto-start behind a chat message — arrives here, so this is the one place
    // that has to hold for the model gate to mean anything.
    const modelVerdict = fleetPolicyService.validateModel(agentType);
    if (!modelVerdict.allowed) {
      const reason = modelVerdict.reason ?? `Model '${agentType}' is not permitted by fleet policy.`;
      this.publishPolicyViolation({
        projectId,
        threadId,
        kind: 'model',
        subject: agentType,
        reason
      });
      eventBus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'server',
        type: 'agent.status',
        payload: { status: 'error', message: `Blocked by fleet policy: ${reason}`, projectId, threadId }
      });
      console.warn(`[AgentService] Refused to start '${agentType}' for thread ${threadId}: ${reason}`);
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

      // The credentials this environment lends to its sessions (P9-02).
      // Decrypted here, at the last moment before the process exists, and
      // registered with the vault's redactor on the way out of the service — so a
      // token the agent echoes back is already stripped by the time it reaches
      // the log file or a client. Resolved per session start rather than cached:
      // a secret the user rotates belongs to the next session.
      const environmentEnv = this.resolveEnvironmentSecrets(workspaceId);

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

      // Providers with a native permission protocol hand each request to the
      // Core instead of using the PTY text protocol. The resolver closes over
      // this thread, so a request can only ever ask about the thread it came from.
      const nativePermissions = agentType === 'claude';
      const permissionResolver = nativePermissions
        ? (ask: NativePermissionAsk) =>
            this.requestNativePermission({
              projectId,
              threadId,
              toolName: ask.toolName,
              toolInput: ask.input,
              toolUseId: ask.toolUseId,
              agentDescription: ask.description,
              reason: ask.reason,
              signal: ask.signal
            })
        : undefined;
      const resumeSessionId = nativePermissions ? this.readProviderSessionId(threadId) : undefined;
      const systemPromptAppendix = nativePermissions
        ? composeSessionInstructions(profile, '').trim() || undefined
        : undefined;

      await this.sessionManager.startSession(
        agentType,
        threadId,
        {
          workspace,
          hasHistory,
          mcpTools: nativePermissions ? [] : toolDescriptors,
          mcpToolInstructions: nativePermissions ? undefined : mcpToolInstructions,
          env: environmentEnv,
          permissionResolver,
          resumeSessionId,
          systemPromptAppendix
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

          this.stopAgent(
            threadId,
            exitCode === 0 ? 'agent process exited' : `agent process exited with code ${exitCode}`
          );
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

      // The audit record of a session existing (P10-01). Published after the
      // session row is written, so what the audit trail claims started is a
      // session the database also knows about.
      eventBus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'server',
        type: AGENT_STARTED_EVENT,
        payload: { projectId, threadId, agentType }
      });

      console.log(`[AgentService] Started ${agentType} for thread ${threadId}`);
    } catch (err: any) {
      console.error(`[AgentService] Failed to start agent for thread ${threadId}:`, err);
      this.adapterConfigs.delete(threadId);
      // `error`, not `idle`: an idle status paints a green "ready" pill over a
      // session that never started, which is what hid the stub adapter for
      // months. The message reaches the chat as a system line.
      eventBus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'server',
        type: 'agent.status',
        payload: {
          status: 'error',
          message: `Could not start ${agentType}: ${err.message || String(err)}`,
          projectId,
          threadId
        }
      });
    }
  }

  private readProviderSessionId(threadId: string): string | undefined {
    try {
      const row = dbService
        .getDb()
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get(providerSessionKey(threadId)) as { value?: string } | undefined;
      return row?.value || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Answers one permission request from a native-protocol agent.
   *
   * Runs the same heuristics the PTY path runs (so the card shows the same
   * risk labels), raises the same approval, and translates the person's answer
   * for the hook. The status events around it keep the dashboard's header in
   * step with the overlay.
   */
  public async requestNativePermission(
    request: NativePermissionRequest
  ): Promise<{ approved: boolean; message: string }> {
    const { approvalManager } = await import('./ApprovalManager');
    const { projectManager } = await import('./ProjectManager');
    const project = projectManager.getProject(request.projectId);
    const described = describePermission(request.toolName, request.toolInput);
    const command = described.command;
    // The agent's own description of the call is the most honest label; the
    // derived one is the fallback. The escalation reason, when the CLI gives
    // one, is the thing a person most wants to know before saying yes.
    const description = [request.agentDescription || described.description, request.reason]
      .filter(Boolean)
      .join(' — ');
    const analysis: CommandSecurityAnalysis = approvalManager.evaluateCommandSecurity(
      command,
      project?.path
    );

    const publishStatus = (status: 'waiting_approval' | 'working', message: string) =>
      eventBus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'server',
        type: 'agent.status',
        payload: { status, message, projectId: request.projectId, threadId: request.threadId }
      });

    publishStatus('waiting_approval', `${request.toolName} needs your approval`);

    // If the agent withdraws the request (something in its own settings
    // decided first), the card must go with it: an approval nobody can act on
    // would otherwise sit on screen until it expired.
    let actionId: string | undefined;
    const withdraw = () => {
      if (actionId) {
        approvalManager.cancelApproval(
          actionId,
          'Claude Code resolved this permission itself before you answered.'
        );
      }
    };
    request.signal?.addEventListener('abort', withdraw, { once: true });

    let approved = false;
    try {
      approved = await approvalManager.requestApproval(
        request.projectId,
        `${request.toolName}: ${description}`,
        command,
        300000,
        {
          threadId: request.threadId,
          securityAnalysis: analysis,
          onActionId: id => {
            actionId = id;
            if (request.signal?.aborted) withdraw();
          }
        }
      );
    } finally {
      request.signal?.removeEventListener('abort', withdraw);
      const outcome = request.signal?.aborted
        ? 'Decided by Claude Code itself, continuing…'
        : approved
          ? 'Approved, continuing…'
          : 'Denied, continuing…';
      publishStatus('working', outcome);
    }

    return {
      approved,
      message: approved
        ? 'Approved by the user in Asterim.'
        : 'The user denied this action in Asterim. Do not retry it; explain what you would have done and ask how to proceed.'
    };
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
   * The environment secrets to hand the child process, decrypted (P9-02).
   *
   * Never fatal, in either direction: a project with no workspace gets nothing,
   * and a credential that will not decrypt on this machine is dropped by
   * `resolveEnvironmentVariables` rather than failing the session. An agent that
   * starts without a token reports a plain authentication error the user can act
   * on; a session that refuses to start reports nothing.
   */
  private resolveEnvironmentSecrets(workspaceId?: string): Record<string, string> {
    if (!workspaceId) return {};
    try {
      const resolved = environmentSecretService.resolveEnvironmentVariables(workspaceId);
      const count = Object.keys(resolved).length;
      if (count > 0) {
        // The names, never the values — this line ends up in the log file.
        console.log(
          `[AgentService] Injecting ${count} environment secret(s) into the session: ${Object.keys(resolved).join(', ')}.`
        );
      }
      return resolved;
    } catch (err) {
      console.error(
        `[AgentService] Could not resolve environment secrets for ${workspaceId}: ${(err as Error).message}`
      );
      return {};
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

  private async stopAgent(threadId: string, reason = 'session ended') {
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

    // Only a thread that actually held a session (P10-01). `stopAgent` also runs
    // on a thread that was already stopped, and an audit trail recording the end
    // of sessions that never began is one an auditor cannot count.
    if (config) {
      eventBus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'server',
        type: AGENT_STOPPED_EVENT,
        payload: {
          projectId: config.projectId,
          threadId,
          agentType: config.agentType,
          reason
        }
      });
    }

    console.log(`[AgentService] Stopped agent for thread ${threadId}`);
  }

  /**
   * The fleet command gate (P10-01).
   *
   * Returns `false` when the text must not reach the PTY. A refusal publishes
   * two things and writes nothing to the adapter: a `policy.violation` the audit
   * logger records at CRITICAL, and an `agent.status` error so the person who
   * typed it is told why, rather than watching a command vanish.
   *
   * Fails closed by construction — `validateCommand` refuses when the policy
   * itself could not be read — which is what "banned commands must never reach
   * the PTY stream" requires of an unreadable policy file as much as of a match.
   */
  private enforceCommandPolicy(projectId: string, threadId: string, command: string): boolean {
    const verdict = fleetPolicyService.validateCommand(command);
    if (verdict.allowed) return true;

    const reason = verdict.violationReason ?? 'The command is forbidden by fleet policy.';
    this.publishPolicyViolation({
      projectId,
      threadId,
      kind: 'command',
      subject: command,
      reason,
      matchedPattern: verdict.matchedPattern
    });

    eventBus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server',
      type: 'agent.status',
      payload: { status: 'error', message: `Blocked by fleet policy: ${reason}`, projectId, threadId }
    });

    console.warn(`[AgentService] Fleet policy refused a command on thread ${threadId}: ${reason}`);
    return false;
  }

  /** Publishes one violation, with the subject truncated before it leaves this method. */
  private publishPolicyViolation(violation: PolicyViolationPayload): void {
    const policy = fleetPolicyService.getActivePolicy();
    eventBus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server',
      type: POLICY_VIOLATION_EVENT,
      payload: {
        ...violation,
        subject:
          violation.subject.length > AUDIT_SUBJECT_MAX_CHARS
            ? `${violation.subject.slice(0, AUDIT_SUBJECT_MAX_CHARS)}…`
            : violation.subject,
        policyId: policy.id,
        policySource: policy.source
      } satisfies PolicyViolationPayload
    });
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
