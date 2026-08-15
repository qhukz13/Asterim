import { ChildProcess, spawn } from 'child_process';
import crypto from 'crypto';
import { sanitizeAgentEnv } from '@asterim/adapters';
import {
  McpServerConfig,
  McpServerInput,
  McpServerRuntimeInfo,
  McpServerStatus,
  McpTransport
} from '@asterim/shared';
import { dbService } from '../DatabaseService';

/**
 * Supervises the MCP servers a developer has registered with Asterim.
 *
 * Only configuration is persisted. Process state — pid, status, logs — is a
 * runtime fact that dies with the Core, which is the honest model: a row saying
 * `RUNNING` after a restart would be a lie.
 *
 * The child is an external program the developer chose to run. It executes with
 * their privileges and no more, and with an environment that carries none of
 * the Core's own secrets (see {@link sanitizeMcpEnv}).
 */

export type McpErrorCode =
  'NOT_FOUND' | 'INVALID_CONFIG' | 'SERVER_DISABLED' | 'UNSUPPORTED_TRANSPORT' | 'SPAWN_FAILED';

export class McpError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'McpError';
  }
}

/** How many stderr lines are kept per server. */
export const STDERR_BUFFER_LINES = 50;

/** How long a child is given to exit on SIGTERM before it is killed. */
export const TERMINATE_GRACE_MS = 3000;

/**
 * Environment variables an MCP child must never receive, on top of the
 * `ASTERIM_*` filtering `sanitizeAgentEnv` already applies.
 *
 * The named patterns are Asterim's own credentials. The generic ones are a
 * blunt instrument on purpose: an MCP server is third-party code, and a
 * developer's cloud tokens have no business reaching it by accident. A server
 * that genuinely needs one is given it explicitly in its own `env`, which is a
 * decision rather than an inheritance.
 */
export const BLOCKED_ENV_PATTERNS: RegExp[] = [
  /^STRIPE_/i,
  /^RELAY_SECRET$/i,
  /^VAPID_/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /PASSWD/i,
  /PRIVATE_KEY/i,
  /API_KEY/i,
  /APIKEY/i,
  /CREDENTIAL/i
];

/**
 * Builds the environment an MCP child runs with: the Core's environment minus
 * its internals and anything credential-shaped, then the server's own `env`
 * laid over the top.
 *
 * What this does *not* do is isolate the filesystem. The child runs as the same
 * user and can read anything that user can, `~/.asterim/server.json` included.
 * Env sanitisation stops Asterim from handing over its secrets; it is not a
 * sandbox, and nothing here should be read as one.
 */
export function sanitizeMcpEnv(
  source: NodeJS.ProcessEnv,
  configured?: Record<string, string>
): NodeJS.ProcessEnv {
  const clean = sanitizeAgentEnv(source);
  for (const key of Object.keys(clean)) {
    if (BLOCKED_ENV_PATTERNS.some(pattern => pattern.test(key))) {
      delete clean[key];
    }
  }
  return { ...clean, ...(configured || {}) };
}

interface RuntimeState {
  status: McpServerStatus;
  child: ChildProcess | null;
  pid: number | null;
  startedAt: number | null;
  stderr: string[];
  lastError: string | null;
  lastExitCode: number | null;
  startCount: number;
  /** Set while a stop was asked for, so the exit is not read as a crash. */
  stopping: boolean;
}

interface McpServerRow {
  id: string;
  workspace_id: string | null;
  name: string;
  transport: string;
  command: string;
  args_json: string;
  env_json: string;
  is_enabled: number;
  is_global: number;
  created_at: number;
  updated_at: number;
}

const TRANSPORTS: McpTransport[] = ['stdio', 'sse'];

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A hand-edited row should degrade to a default, not take the list down.
    return fallback;
  }
}

function rowToConfig(row: McpServerRow): McpServerConfig {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    transport: (TRANSPORTS.includes(row.transport as McpTransport)
      ? row.transport
      : 'stdio') as McpTransport,
    command: row.command,
    args: parseJson<string[]>(row.args_json, []),
    env: parseJson<Record<string, string>>(row.env_json, {}),
    isEnabled: Boolean(row.is_enabled),
    isGlobal: Boolean(row.is_global),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function idleState(): RuntimeState {
  return {
    status: 'STOPPED',
    child: null,
    pid: null,
    startedAt: null,
    stderr: [],
    lastError: null,
    lastExitCode: null,
    startCount: 0,
    stopping: false
  };
}

export class McpProcessSupervisor {
  private readonly runtimes = new Map<string, RuntimeState>();
  private exitHookInstalled = false;

  // --- Configuration -------------------------------------------------------

  /** Every registered server, or those visible to one workspace. */
  public listConfigs(workspaceId?: string): McpServerConfig[] {
    const db = dbService.getDb();
    // A workspace sees its own servers plus the workstation-wide ones.
    // node:sqlite types every row as Record<string, SQLOutputValue>; the shape
    // asserted here is the one this module's own CREATE TABLE declares.
    const rows = workspaceId
      ? db
          .prepare(
            'SELECT * FROM mcp_servers WHERE workspace_id = ? OR is_global = 1 ORDER BY name'
          )
          .all(workspaceId)
      : db.prepare('SELECT * FROM mcp_servers ORDER BY name').all();
    return (rows as unknown as McpServerRow[]).map(rowToConfig);
  }

  public getConfig(id: string): McpServerConfig | null {
    const row = dbService.getDb().prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as
      McpServerRow | undefined;
    return row ? rowToConfig(row) : null;
  }

  /**
   * Creates a server, or updates the one named by `id`.
   *
   * Disabling a running server stops it: `isEnabled` is what the developer says
   * should be running, and leaving a disabled process alive would contradict it.
   */
  public async saveServer(input: McpServerInput, id?: string): Promise<McpServerConfig> {
    const existing = id ? this.getConfig(id) : null;
    if (id && !existing) {
      throw new McpError('NOT_FOUND', `No MCP server with id ${id}.`);
    }

    const merged: McpServerConfig = {
      id: existing?.id ?? `mcp_${crypto.randomUUID()}`,
      workspaceId:
        input.workspaceId !== undefined ? input.workspaceId : (existing?.workspaceId ?? null),
      name: (input.name ?? existing?.name ?? '').trim(),
      transport: input.transport ?? existing?.transport ?? 'stdio',
      command: (input.command ?? existing?.command ?? '').trim(),
      args: input.args ?? existing?.args ?? [],
      env: input.env ?? existing?.env ?? {},
      isEnabled: input.isEnabled ?? existing?.isEnabled ?? true,
      isGlobal: input.isGlobal ?? existing?.isGlobal ?? false,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now()
    };

    this.validate(merged);

    dbService
      .getDb()
      .prepare(
        `INSERT INTO mcp_servers (id, workspace_id, name, transport, command, args_json, env_json, is_enabled, is_global, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           name = excluded.name,
           transport = excluded.transport,
           command = excluded.command,
           args_json = excluded.args_json,
           env_json = excluded.env_json,
           is_enabled = excluded.is_enabled,
           is_global = excluded.is_global,
           updated_at = excluded.updated_at`
      )
      .run(
        merged.id,
        merged.workspaceId ?? null,
        merged.name,
        merged.transport,
        merged.command,
        JSON.stringify(merged.args),
        JSON.stringify(merged.env ?? {}),
        merged.isEnabled ? 1 : 0,
        merged.isGlobal ? 1 : 0,
        merged.createdAt,
        merged.updatedAt
      );

    if (!merged.isEnabled && this.isRunning(merged.id)) {
      await this.stopServer(merged.id);
    }

    return merged;
  }

  /** Stops the process, if any, then removes the configuration. */
  public async deleteServer(id: string): Promise<boolean> {
    const existing = this.getConfig(id);
    if (!existing) return false;

    if (this.isRunning(id)) {
      await this.stopServer(id);
    }
    this.runtimes.delete(id);
    dbService.getDb().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
    return true;
  }

  private validate(config: McpServerConfig): void {
    if (!config.name) {
      throw new McpError('INVALID_CONFIG', 'name is required.');
    }
    if (!config.command) {
      throw new McpError('INVALID_CONFIG', 'command is required.');
    }
    if (!TRANSPORTS.includes(config.transport)) {
      throw new McpError('INVALID_CONFIG', `transport must be one of: ${TRANSPORTS.join(', ')}.`);
    }
    if (!Array.isArray(config.args) || config.args.some(arg => typeof arg !== 'string')) {
      throw new McpError('INVALID_CONFIG', 'args must be an array of strings.');
    }
    if (config.env && Object.values(config.env).some(value => typeof value !== 'string')) {
      throw new McpError('INVALID_CONFIG', 'env values must be strings.');
    }
  }

  // --- Lifecycle -----------------------------------------------------------

  public isRunning(id: string): boolean {
    const state = this.runtimes.get(id);
    return Boolean(state && (state.status === 'RUNNING' || state.status === 'STARTING'));
  }

  private state(id: string): RuntimeState {
    let state = this.runtimes.get(id);
    if (!state) {
      state = idleState();
      this.runtimes.set(id, state);
    }
    return state;
  }

  /**
   * Spawns the child. Resolves once the process exists (or has failed to), not
   * once it is ready — a stdio MCP server announces readiness only through a
   * JSON-RPC handshake, which belongs to the client that will speak to it.
   */
  public async startServer(id: string): Promise<McpServerRuntimeInfo> {
    const config = this.requireConfig(id);

    if (this.isRunning(id)) {
      return this.getServerStatus(id) as McpServerRuntimeInfo;
    }
    if (!config.isEnabled) {
      throw new McpError(
        'SERVER_DISABLED',
        `${config.name} is disabled; enable it before starting.`
      );
    }
    if (config.transport !== 'stdio') {
      throw new McpError(
        'UNSUPPORTED_TRANSPORT',
        `Only stdio servers are supervised as child processes; ${config.name} is configured as ${config.transport}.`
      );
    }

    const state = this.state(id);
    state.status = 'STARTING';
    state.stopping = false;
    state.lastError = null;
    state.lastExitCode = null;

    this.installExitHook();

    const child = spawn(config.command, config.args, {
      env: sanitizeMcpEnv(process.env, config.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      // No shell: the command and its arguments are passed to execve as given,
      // so a value containing shell metacharacters is an argument, not syntax.
      shell: false
    });

    state.child = child;
    state.startCount += 1;

    // stdout is the JSON-RPC transport. It is drained so the child never blocks
    // on a full pipe, and deliberately not stored: it carries tool traffic, not
    // diagnostics.
    child.stdout?.on('data', () => undefined);

    child.stderr?.on('data', (chunk: Buffer) => {
      this.appendStderr(state, chunk.toString('utf8'));
    });

    child.on('exit', (code, signal) => {
      state.child = null;
      state.pid = null;
      state.startedAt = null;
      state.lastExitCode = code;

      if (state.stopping) {
        state.status = 'STOPPED';
      } else if (code === 0) {
        // Exited cleanly without being asked to: nothing is wrong, but nothing
        // is running either.
        state.status = 'STOPPED';
      } else {
        state.status = 'CRASHED';
        state.lastError = signal
          ? `Process terminated by signal ${signal}`
          : `Process exited with code ${code}`;
        console.warn(`[MCP] ${config.name} crashed: ${state.lastError}`);
      }
    });

    return new Promise<McpServerRuntimeInfo>(resolve => {
      const settle = () => resolve(this.getServerStatus(id) as McpServerRuntimeInfo);

      child.once('spawn', () => {
        state.status = 'RUNNING';
        state.pid = child.pid ?? null;
        state.startedAt = Date.now();
        console.log(`[MCP] Started ${config.name} (pid ${state.pid})`);
        settle();
      });

      child.once('error', (err: Error) => {
        // ENOENT and friends: the process never existed, so this is a
        // configuration problem rather than a crash.
        state.status = 'ERROR';
        state.child = null;
        state.pid = null;
        state.lastError = err.message;
        console.error(`[MCP] Failed to start ${config.name}: ${err.message}`);
        settle();
      });
    });
  }

  /** SIGTERM, then SIGKILL if the child is still there after the grace period. */
  public async stopServer(id: string): Promise<McpServerRuntimeInfo> {
    const config = this.requireConfig(id);
    const state = this.state(id);
    const child = state.child;

    if (!child || child.exitCode !== null) {
      state.status =
        state.status === 'CRASHED' || state.status === 'ERROR' ? state.status : 'STOPPED';
      state.child = null;
      state.pid = null;
      return this.getServerStatus(id) as McpServerRuntimeInfo;
    }

    state.stopping = true;

    await new Promise<void>(resolve => {
      const kill = setTimeout(() => {
        if (child.exitCode === null) {
          console.warn(`[MCP] ${config.name} ignored SIGTERM; sending SIGKILL`);
          child.kill('SIGKILL');
        }
      }, TERMINATE_GRACE_MS);
      // The grace timer must never be the reason the process stays alive.
      kill.unref?.();

      child.once('exit', () => {
        clearTimeout(kill);
        resolve();
      });

      child.kill('SIGTERM');
    });

    state.stopping = false;
    state.status = 'STOPPED';
    state.child = null;
    state.pid = null;
    state.startedAt = null;
    return this.getServerStatus(id) as McpServerRuntimeInfo;
  }

  public async restartServer(id: string): Promise<McpServerRuntimeInfo> {
    this.requireConfig(id);
    await this.stopServer(id);
    return this.startServer(id);
  }

  // --- Reporting -----------------------------------------------------------

  public getServerStatus(id: string): McpServerRuntimeInfo | null {
    const config = this.getConfig(id);
    if (!config) return null;
    return this.withRuntime(config);
  }

  /** Configurations with their live process state attached. */
  public listServers(workspaceId?: string): McpServerRuntimeInfo[] {
    return this.listConfigs(workspaceId).map(config => this.withRuntime(config));
  }

  /** The rolling stderr tail, oldest line first. */
  public getLogs(id: string): string[] {
    return [...this.state(id).stderr];
  }

  private withRuntime(config: McpServerConfig): McpServerRuntimeInfo {
    const state = this.runtimes.get(config.id) ?? idleState();
    return {
      ...config,
      status: state.status,
      pid: state.pid,
      uptimeSeconds: state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0,
      recentStderrLogs: [...state.stderr],
      lastError: state.lastError,
      lastExitCode: state.lastExitCode,
      startCount: state.startCount
    };
  }

  private requireConfig(id: string): McpServerConfig {
    const config = this.getConfig(id);
    if (!config) {
      throw new McpError('NOT_FOUND', `No MCP server with id ${id}.`);
    }
    return config;
  }

  private appendStderr(state: RuntimeState, chunk: string): void {
    for (const line of chunk.split('\n')) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      state.stderr.push(trimmed);
    }
    if (state.stderr.length > STDERR_BUFFER_LINES) {
      state.stderr.splice(0, state.stderr.length - STDERR_BUFFER_LINES);
    }
  }

  // --- Shutdown ------------------------------------------------------------

  /** Stops every running child. Registered on the Fastify `onClose` hook. */
  public async shutdownAll(): Promise<void> {
    const running = [...this.runtimes.entries()].filter(([, state]) => state.child);
    if (running.length === 0) return;

    console.log(`[MCP] Stopping ${running.length} MCP server(s)`);
    await Promise.all(
      running.map(([id]) =>
        this.stopServer(id).catch(err =>
          console.error(`[MCP] Failed to stop ${id}: ${(err as Error).message}`)
        )
      )
    );
  }

  /**
   * A synchronous last resort. `process.on('exit')` cannot await, and other
   * subsystems call `process.exit()` from their own signal handlers, so the
   * graceful path is not guaranteed to run — this at least signals every child
   * rather than orphaning it.
   */
  private installExitHook(): void {
    if (this.exitHookInstalled) return;
    this.exitHookInstalled = true;

    process.on('exit', () => {
      for (const state of this.runtimes.values()) {
        if (state.child && state.child.exitCode === null) {
          try {
            state.child.kill('SIGTERM');
          } catch {
            // The child is already gone; nothing to do.
          }
        }
      }
    });
  }
}

export const mcpProcessSupervisor = new McpProcessSupervisor();
