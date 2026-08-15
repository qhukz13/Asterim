import { ChildProcess, spawn } from 'child_process';
import crypto from 'crypto';
import { sanitizeAgentEnv } from '@asterim/adapters';
import {
  MCP_EVENTS,
  McpEventType,
  McpServerCapabilities,
  McpServerConfig,
  McpServerEventPayload,
  McpServerInput,
  McpServerRuntimeInfo,
  McpServerStatus,
  McpToolCallResult,
  McpTransport
} from '@asterim/shared';
import { dbService } from '../DatabaseService';
import { eventBus } from '../EventBus';
import { DEFAULT_TOOL_TIMEOUT_MS, McpStdioClient, McpTimeoutError } from './McpStdioClient';
import { validateToolArguments } from './SchemaValidator';

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
  | 'NOT_FOUND'
  | 'INVALID_CONFIG'
  | 'SERVER_DISABLED'
  | 'UNSUPPORTED_TRANSPORT'
  | 'SPAWN_FAILED'
  | 'SERVER_NOT_RUNNING'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_TIMEOUT'
  | 'INVALID_ARGUMENTS'
  | 'QUEUE_FULL';

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

/** Bound on the whole opening sequence, not on one request within it. */
export const HANDSHAKE_TIMEOUT_MS = 10000;

/**
 * Calls that may be waiting for one server at once.
 *
 * A queue that grows without limit turns a slow MCP server into unbounded
 * memory and a pile of calls whose callers gave up long ago. Past this depth a
 * call is refused immediately, which is information the caller can act on.
 */
export const MAX_QUEUE_DEPTH = 20;

/** How long a call may sit in the queue before it is abandoned. */
export const QUEUE_WAIT_TIMEOUT_MS = 60000;

/**
 * Runs one job at a time for one server.
 *
 * A stdio MCP server is a single pipe. Two concurrent `tools/call` writes are
 * two interleaved byte streams, and the protocol has no framing that survives
 * that — so invocations are serialised per server rather than per process.
 *
 * The slot is released in a `finally`, which is the whole point: a tool that
 * throws, times out, or is abandoned must not leave the queue wedged behind it.
 */
class SerialQueue {
  private active = false;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly maxDepth: number,
    private readonly waitTimeoutMs: number
  ) {}

  get depth(): number {
    return this.waiting.length;
  }

  get isBusy(): boolean {
    return this.active;
  }

  async run<T>(job: () => Promise<T>, onFull: () => Error): Promise<T> {
    if (this.active) {
      if (this.waiting.length >= this.maxDepth) {
        throw onFull();
      }
      await this.waitTurn();
    }

    this.active = true;
    try {
      return await job();
    } finally {
      this.active = false;
      this.waiting.shift()?.();
    }
  }

  private waitTurn(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(release);
        if (index !== -1) this.waiting.splice(index, 1);
        reject(new Error(`waited more than ${this.waitTimeoutMs}ms for the server to be free`));
      }, this.waitTimeoutMs);

      const release = () => {
        clearTimeout(timer);
        resolve();
      };
      this.waiting.push(release);
    });
  }
}

/** Rejects if `promise` has not settled in time. */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      // Not unref'd: this timer is the only thing that ends a handshake against
      // a server that never answers. Always cleared in the finally below.
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  /** The open JSON-RPC session, kept for refreshes and tool calls. */
  client: McpStdioClient | null;
  /** Serialises tool calls: one pipe, one call at a time. */
  queue: SerialQueue;
  capabilities: McpServerCapabilities | null;
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

function idleState(
  maxQueueDepth = MAX_QUEUE_DEPTH,
  queueWaitMs = QUEUE_WAIT_TIMEOUT_MS
): RuntimeState {
  return {
    status: 'STOPPED',
    child: null,
    client: null,
    queue: new SerialQueue(maxQueueDepth, queueWaitMs),
    capabilities: null,
    pid: null,
    startedAt: null,
    stderr: [],
    lastError: null,
    lastExitCode: null,
    startCount: 0,
    stopping: false
  };
}

export interface McpSupervisorOptions {
  /** Per-JSON-RPC-request timeout. */
  requestTimeoutMs?: number;
  /** Bound on the complete handshake. */
  handshakeTimeoutMs?: number;
  /** Bound on a single tool call. */
  toolTimeoutMs?: number;
  /** Calls that may wait for one server before further ones are refused. */
  maxQueueDepth?: number;
  /** How long a call may wait in the queue before it is abandoned. */
  queueWaitTimeoutMs?: number;
}

export class McpProcessSupervisor {
  private readonly runtimes = new Map<string, RuntimeState>();
  private readonly requestTimeoutMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly toolTimeoutMs: number;
  private readonly maxQueueDepth: number;
  private readonly queueWaitTimeoutMs: number;
  private exitHookInstalled = false;

  constructor(options: McpSupervisorOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5000;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    this.toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    this.maxQueueDepth = options.maxQueueDepth ?? MAX_QUEUE_DEPTH;
    this.queueWaitTimeoutMs = options.queueWaitTimeoutMs ?? QUEUE_WAIT_TIMEOUT_MS;
  }

  /**
   * Publishes a state change onto the EventBus.
   *
   * The payload carries no `projectId`, which is what keeps these events
   * broadcast-only: `socketManager` persists an event to the project log only
   * when one is present, so no tool traffic can reach a database table.
   */
  private emit(type: McpEventType, id: string): void {
    const server = this.getServerStatus(id);
    if (!server) return;
    try {
      eventBus.publish<McpServerEventPayload>({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'system:mcp',
        type,
        payload: { server }
      });
    } catch (err) {
      console.error(`[MCP] Failed to publish ${type}: ${(err as Error).message}`);
    }
  }

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
    return Boolean(
      state &&
      (state.status === 'RUNNING' || state.status === 'STARTING' || state.status === 'INITIALIZING')
    );
  }

  /** The current status, read fresh — asynchronous handlers move it. */
  private statusOf(id: string): McpServerStatus {
    return this.runtimes.get(id)?.status ?? 'STOPPED';
  }

  private state(id: string): RuntimeState {
    let state = this.runtimes.get(id);
    if (!state) {
      state = idleState(this.maxQueueDepth, this.queueWaitTimeoutMs);
      this.runtimes.set(id, state);
    }
    return state;
  }

  /**
   * Spawns the child and completes the MCP handshake.
   *
   * `RUNNING` is reached only once the server has answered `initialize` and its
   * capabilities are known. A process that spawns but never finishes the
   * handshake is stopped and reported as `ERROR`: it cannot serve a tool call,
   * and leaving it alive would be a supervised process nothing can use.
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

    // stdout is the JSON-RPC transport, consumed by McpStdioClient below. It is
    // never written to a log: it carries tool traffic, not diagnostics.
    child.stderr?.on('data', (chunk: Buffer) => {
      this.appendStderr(state, chunk.toString('utf8'));
    });

    child.on('exit', (code, signal) => {
      state.child = null;
      state.pid = null;
      state.startedAt = null;
      state.lastExitCode = code;
      state.client?.dispose();
      state.client = null;

      if (state.status === 'ERROR') {
        // A handshake failure already explained itself; the kill that followed
        // is not a second, different problem.
      } else if (state.stopping || code === 0) {
        // Asked to stop, or exited cleanly on its own: nothing is wrong, but
        // nothing is running either.
        state.status = 'STOPPED';
        this.emit(MCP_EVENTS.SERVER_STOPPED, id);
      } else {
        state.status = 'CRASHED';
        state.lastError = signal
          ? `Process terminated by signal ${signal}`
          : `Process exited with code ${code}`;
        console.warn(`[MCP] ${config.name} crashed: ${state.lastError}`);
        this.emit(MCP_EVENTS.SERVER_CRASHED, id);
      }
    });

    const spawned = await new Promise<boolean>(resolve => {
      child.once('spawn', () => {
        state.pid = child.pid ?? null;
        state.startedAt = Date.now();
        console.log(`[MCP] Spawned ${config.name} (pid ${state.pid})`);
        resolve(true);
      });

      child.once('error', (err: Error) => {
        // ENOENT and friends: the process never existed, so this is a
        // configuration problem rather than a crash.
        state.status = 'ERROR';
        state.child = null;
        state.pid = null;
        state.lastError = err.message;
        console.error(`[MCP] Failed to start ${config.name}: ${err.message}`);
        this.emit(MCP_EVENTS.SERVER_CRASHED, id);
        resolve(false);
      });
    });

    if (!spawned) {
      return this.getServerStatus(id) as McpServerRuntimeInfo;
    }

    state.status = 'INITIALIZING';
    try {
      state.capabilities = await this.handshake(id, child);
      state.status = 'RUNNING';
      console.log(
        `[MCP] ${config.name} ready: ${state.capabilities.tools.length} tool(s), ` +
          `${state.capabilities.resources.length} resource(s), ${state.capabilities.prompts.length} prompt(s)`
      );
      this.emit(MCP_EVENTS.SERVER_STARTED, id);
      this.emit(MCP_EVENTS.CAPABILITIES_UPDATED, id);
    } catch (err) {
      // A child that crashed on its own has already explained itself, and that
      // explanation is the better one; do not overwrite it with the handshake's
      // view of the same event. Read through statusOf(): the exit handler
      // mutates the status asynchronously, which narrowing cannot see.
      if (this.statusOf(id) !== 'CRASHED') {
        state.status = 'ERROR';
        state.lastError = `Handshake failed: ${(err as Error).message}`;
        console.error(`[MCP] ${config.name}: ${state.lastError}`);
        // The process is alive but unusable. Stopping it is the only honest
        // outcome; `stopping` keeps the exit from being read as a crash.
        state.stopping = true;
        await this.terminate(config.name, child);
        state.stopping = false;
        this.emit(MCP_EVENTS.SERVER_CRASHED, id);
      }
    }

    return this.getServerStatus(id) as McpServerRuntimeInfo;
  }

  /**
   * Runs the MCP opening sequence over the child's stdio and keeps the client
   * for later use — a refresh, and eventually tool invocation, speak over the
   * same session rather than opening a second one.
   */
  private async handshake(id: string, child: ChildProcess): Promise<McpServerCapabilities> {
    const state = this.state(id);
    state.client?.dispose();

    if (!child.stdin || !child.stdout) {
      throw new Error('child process has no stdio pipes');
    }

    const client = new McpStdioClient(child.stdin, child.stdout, {
      timeoutMs: this.requestTimeoutMs,
      // The server announcing a changed list is the only signal that a cached
      // catalogue has gone stale; without acting on it, Asterim would offer
      // tools that no longer exist.
      onListChanged: kind => void this.onListChanged(id, kind)
    });
    state.client = client;

    // A child that dies mid-handshake should fail immediately rather than make
    // the caller wait out a timeout for an answer that can never come.
    const exited = new Promise<never>((_, reject) => {
      child.once('exit', (code, signal) =>
        reject(new Error(`process exited during handshake (code ${code}, signal ${signal})`))
      );
    });

    try {
      return await withTimeout(
        Promise.race([client.discover(), exited]),
        this.handshakeTimeoutMs,
        `handshake did not complete within ${this.handshakeTimeoutMs}ms`
      );
    } catch (err) {
      client.dispose();
      state.client = null;
      throw err;
    }
  }

  /**
   * Re-runs discovery against a server that is already up.
   *
   * A server whose tool list changed — a filesystem server given a new root, a
   * database server pointed at another schema — reports the change only when
   * asked again.
   */
  public async refreshCapabilities(id: string): Promise<McpServerRuntimeInfo> {
    const config = this.requireConfig(id);
    const state = this.state(id);

    if (!state.child || state.status !== 'RUNNING') {
      throw new McpError(
        'SERVER_NOT_RUNNING',
        `${config.name} is not running; start it before refreshing capabilities.`
      );
    }

    state.capabilities = await this.handshake(id, state.child);
    this.emit(MCP_EVENTS.CAPABILITIES_UPDATED, id);
    return this.getServerStatus(id) as McpServerRuntimeInfo;
  }

  /**
   * Invokes a tool on a running server.
   *
   * Two things are checked before the call leaves: that the server is actually
   * `RUNNING` (a stopped or crashed server has no session to speak over), and
   * that the tool is one the last handshake found. The second is not
   * bureaucracy — it turns "the server answered -32602 eventually" into an
   * immediate, specific answer, and it is what lets the route return 404 rather
   * than 500.
   */
  public async callTool(
    serverId: string,
    toolName: string,
    args?: Record<string, unknown>
  ): Promise<McpToolCallResult> {
    const config = this.requireConfig(serverId);
    const state = this.state(serverId);

    if (state.status !== 'RUNNING' || !state.client) {
      throw new McpError(
        'SERVER_NOT_RUNNING',
        `${config.name} is ${state.status.toLowerCase()}; start it before calling its tools.`
      );
    }

    const tool = state.capabilities?.tools.find(candidate => candidate.name === toolName);
    if (!tool) {
      throw new McpError(
        'TOOL_NOT_FOUND',
        `${config.name} does not expose a tool named '${toolName}'.`
      );
    }

    // Checked here rather than in the bridge so every caller — agent, REST
    // route, UI — gets the same answer to the same mistake.
    const validation = validateToolArguments(args, tool.inputSchema, toolName);
    if (!validation.valid) {
      throw new McpError(
        'INVALID_ARGUMENTS',
        `${toolName} was called with invalid arguments: ${(validation.errors || []).join('; ')}`
      );
    }

    const client = state.client;
    return state.queue.run(
      async () => {
        try {
          return await client.callTool(toolName, args, this.toolTimeoutMs);
        } catch (err) {
          if (err instanceof McpTimeoutError) {
            throw new McpError(
              'TOOL_TIMEOUT',
              `${config.name} did not answer '${toolName}' within ${this.toolTimeoutMs}ms.`
            );
          }
          throw err;
        }
      },
      () =>
        new McpError(
          'QUEUE_FULL',
          `${config.name} already has ${this.maxQueueDepth} calls waiting; try again shortly.`
        )
    );
  }

  /** Calls waiting on a server, for diagnostics and tests. */
  public queueDepth(serverId: string): number {
    return this.runtimes.get(serverId)?.queue.depth ?? 0;
  }

  /**
   * Re-reads a server's catalogue after it announced a change.
   *
   * Best-effort by design: this runs from a notification, with nobody waiting on
   * it. A failed re-read leaves the previous capabilities in place — stale is
   * better than empty — and says so in the log.
   */
  private async onListChanged(id: string, kind: 'tools' | 'resources' | 'prompts'): Promise<void> {
    const state = this.runtimes.get(id);
    if (!state || state.status !== 'RUNNING' || !state.child) return;

    const name = this.getConfig(id)?.name ?? id;
    console.log(`[MCP] ${name} announced changed ${kind}; re-reading capabilities`);

    try {
      state.capabilities = await this.handshake(id, state.child);
      this.emit(MCP_EVENTS.CAPABILITIES_UPDATED, id);
    } catch (err) {
      console.warn(
        `[MCP] Could not re-read ${name} after a ${kind} change: ${(err as Error).message}`
      );
    }
  }

  /**
   * Starts every enabled server, on boot.
   *
   * Never rejects: a workstation with one broken MCP server must still get an
   * Asterim. Failures are logged and left visible in each server's status.
   */
  public async autostartEnabledServers(): Promise<McpServerRuntimeInfo[]> {
    const enabled = this.listConfigs().filter(
      config => config.isEnabled && config.transport === 'stdio'
    );
    if (enabled.length === 0) return [];

    console.log(`[MCP] Autostarting ${enabled.length} enabled server(s)`);
    const results = await Promise.all(
      enabled.map(config =>
        this.startServer(config.id).catch(err => {
          console.warn(`[MCP] Autostart of ${config.name} failed: ${(err as Error).message}`);
          return this.getServerStatus(config.id) as McpServerRuntimeInfo;
        })
      )
    );

    const ready = results.filter(server => server.status === 'RUNNING').length;
    console.log(`[MCP] Autostart complete: ${ready}/${results.length} ready`);
    return results;
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
      state.client?.dispose();
      state.client = null;
      return this.getServerStatus(id) as McpServerRuntimeInfo;
    }

    state.stopping = true;
    await this.terminate(config.name, child);
    state.stopping = false;

    state.status = 'STOPPED';
    state.child = null;
    state.pid = null;
    state.startedAt = null;
    return this.getServerStatus(id) as McpServerRuntimeInfo;
  }

  /** Signals a child and resolves once it is actually gone. */
  private terminate(name: string, child: ChildProcess): Promise<void> {
    return new Promise<void>(resolve => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }

      const kill = setTimeout(() => {
        if (child.exitCode === null) {
          console.warn(`[MCP] ${name} ignored SIGTERM; sending SIGKILL`);
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
    const state =
      this.runtimes.get(config.id) ?? idleState(this.maxQueueDepth, this.queueWaitTimeoutMs);
    return {
      ...config,
      status: state.status,
      pid: state.pid,
      uptimeSeconds: state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0,
      recentStderrLogs: [...state.stderr],
      lastError: state.lastError,
      lastExitCode: state.lastExitCode,
      startCount: state.startCount,
      capabilities: state.capabilities
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

/** Reads a positive integer from the environment, or keeps the default. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The supervisor the Core and its routes share.
 *
 * The timeouts are configurable because they are operational, not architectural:
 * a workstation running a slow database MCP server needs a longer tool budget
 * than the default, and finding that out should not require a rebuild.
 */
export const mcpProcessSupervisor = new McpProcessSupervisor({
  requestTimeoutMs: envInt('ASTERIM_MCP_REQUEST_TIMEOUT_MS', 5000),
  handshakeTimeoutMs: envInt('ASTERIM_MCP_HANDSHAKE_TIMEOUT_MS', HANDSHAKE_TIMEOUT_MS),
  toolTimeoutMs: envInt('ASTERIM_MCP_TOOL_TIMEOUT_MS', DEFAULT_TOOL_TIMEOUT_MS)
});
