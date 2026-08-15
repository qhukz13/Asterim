import { Readable, Writable } from 'stream';
import {
  McpPromptDefinition,
  McpResourceDefinition,
  McpServerCapabilities,
  McpToolCallResult,
  McpToolContent,
  McpToolDefinition
} from '@asterim/shared';

/**
 * A JSON-RPC 2.0 client speaking the MCP stdio transport.
 *
 * The transport is newline-delimited JSON over the child's stdin/stdout. Two
 * properties of that framing drive this implementation: a single `data` chunk
 * may contain half a message or several, so messages are reassembled from a
 * buffer rather than parsed per chunk; and responses may arrive in any order,
 * so every request is tracked by id and resolved when its answer comes back.
 *
 * The client owns no process. It reads and writes streams it was handed, and
 * `dispose()` detaches from them — stopping the child is the supervisor's job.
 */

/** MCP revision this client negotiates. */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

export const MCP_CLIENT_INFO = { name: 'asterim-core', version: '0.1.0' };

/** How long a single request may take before it is abandoned. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

/**
 * How long a tool call may take.
 *
 * Far longer than a protocol request: `tools/call` runs someone else's code —
 * a database query, a directory walk, an HTTP request — and a handshake's
 * patience is the wrong measure for it.
 */
export const DEFAULT_TOOL_TIMEOUT_MS = 30000;

/** JSON-RPC's "method not found"; a server may answer this for an optional list. */
const METHOD_NOT_FOUND = -32601;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
}

/** A request that was never answered in time. Distinguished so a route can 504. */
export class McpTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpTimeoutError';
  }
}

export class McpRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string
  ) {
    super(message);
    this.name = 'McpRpcError';
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
}

export interface McpStdioClientOptions {
  /** Per-request timeout. The handshake as a whole is bounded by the caller. */
  timeoutMs?: number;
  /** Where protocol-level warnings go. Overridden in tests. */
  logger?: (message: string) => void;
  /**
   * Called when the server announces that its tool list changed.
   *
   * The client only reports the notification; deciding what to do about it —
   * re-running discovery, telling the rest of Asterim — belongs to the
   * supervisor, which owns the cached capabilities.
   */
  onListChanged?: (kind: 'tools' | 'resources' | 'prompts') => void;
}

/** The `notifications/*_changed` methods this client understands. */
const LIST_CHANGED_METHODS: Record<string, 'tools' | 'resources' | 'prompts'> = {
  'notifications/tools/list_changed': 'tools',
  'notifications/resources/list_changed': 'resources',
  'notifications/prompts/list_changed': 'prompts'
};

export class McpStdioClient {
  private readonly pending = new Map<number, Pending>();
  private readonly timeoutMs: number;
  private readonly log: (message: string) => void;
  private readonly onListChanged?: (kind: 'tools' | 'resources' | 'prompts') => void;
  private nextId = 1;
  private buffer = '';
  private disposed = false;
  private onData?: (chunk: Buffer) => void;

  constructor(
    private readonly stdin: Writable,
    private readonly stdout: Readable,
    options: McpStdioClientOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.log = options.logger ?? (message => console.warn(message));
    this.onListChanged = options.onListChanged;

    this.onData = (chunk: Buffer) => this.ingest(chunk.toString('utf8'));
    this.stdout.on('data', this.onData);
  }

  /**
   * Reassembles messages from the stream.
   *
   * Everything before the last newline is a complete set of messages; whatever
   * follows it is the start of the next one and is kept for the next chunk.
   */
  private ingest(text: string): void {
    this.buffer += text;

    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      // Servers occasionally print banners on stdout. That is a protocol
      // violation, but it must not take the session down.
      this.log(`[MCP] Ignoring non-JSON line on stdout: ${line.slice(0, 120)}`);
      return;
    }

    // A notification from the server: nothing is waiting on it by id, but a
    // list_changed announcement means the cached catalogue is now stale.
    if (message.id === undefined || message.id === null) {
      const kind = message.method ? LIST_CHANGED_METHODS[message.method] : undefined;
      if (kind && this.onListChanged) {
        try {
          this.onListChanged(kind);
        } catch (err) {
          this.log(`[MCP] list_changed handler failed: ${(err as Error).message}`);
        }
      }
      return;
    }

    const pending = this.pending.get(Number(message.id));
    if (!pending) return; // Late answer to a request that already timed out.

    this.pending.delete(Number(message.id));
    clearTimeout(pending.timer);

    if (message.error) {
      pending.reject(new McpRpcError(message.error.code, message.error.message));
      return;
    }
    pending.resolve(message.result);
  }

  /** Sends a request and resolves with its result. */
  public request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error('MCP client has been disposed'));
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} });
    const budget = timeoutMs ?? this.timeoutMs;

    return new Promise<T>((resolve, reject) => {
      // Deliberately not unref'd: the timeout is what guarantees this promise
      // settles, and an unref'd timer can be skipped entirely if the event loop
      // empties first. It is cleared on every path that resolves.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpTimeoutError(`MCP request '${method}' timed out after ${budget}ms`));
      }, budget);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        method
      });

      try {
        this.stdin.write(`${payload}\n`);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err as Error);
      }
    });
  }

  /** Sends a notification. Nothing answers, so nothing is awaited. */
  public notify(method: string, params?: Record<string, unknown>): void {
    if (this.disposed) return;
    this.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {} })}\n`);
  }

  /**
   * Runs the full MCP opening sequence and reads back what the server offers.
   *
   * Only the lists the server advertised in its `initialize` response are
   * requested: asking an implementation for prompts it never claimed to have is
   * how a healthy server ends up reported as broken.
   */
  public async discover(): Promise<McpServerCapabilities> {
    const initialized =
      (await this.request<{
        protocolVersion?: string;
        serverInfo?: { name: string; version: string };
        capabilities?: Record<string, unknown>;
      }>('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: MCP_CLIENT_INFO
      })) || {};

    // Required by the protocol: the server may hold back until it arrives.
    this.notify('notifications/initialized');

    const advertised = initialized.capabilities ?? {};

    const [tools, resources, prompts] = await Promise.all([
      advertised.tools ? this.list<McpToolDefinition>('tools/list', 'tools') : Promise.resolve([]),
      advertised.resources
        ? this.list<McpResourceDefinition>('resources/list', 'resources')
        : Promise.resolve([]),
      advertised.prompts
        ? this.list<McpPromptDefinition>('prompts/list', 'prompts')
        : Promise.resolve([])
    ]);

    return {
      tools,
      resources,
      prompts,
      protocolVersion: initialized.protocolVersion,
      serverInfo: initialized.serverInfo,
      discoveredAt: Date.now()
    };
  }

  /**
   * Invokes a tool and returns its structured answer.
   *
   * A tool that reports failure (`isError: true`) resolves rather than rejects:
   * "that file does not exist" is an answer, and the caller needs the content
   * that explains it. Only a transport failure — a timeout, a JSON-RPC error,
   * a dead session — rejects.
   */
  public async callTool(
    name: string,
    args?: Record<string, unknown>,
    timeoutMs: number = DEFAULT_TOOL_TIMEOUT_MS
  ): Promise<McpToolCallResult> {
    const result = await this.request<{ content?: unknown; isError?: unknown }>(
      'tools/call',
      { name, arguments: args ?? {} },
      timeoutMs
    );

    const content = Array.isArray(result?.content) ? (result.content as McpToolContent[]) : [];
    return { content, isError: Boolean(result?.isError) };
  }

  /**
   * Reads one advertised list. A server that advertises a capability and then
   * answers "method not found" is treated as having none of it rather than as
   * broken; any other failure is the caller's to handle.
   */
  private async list<T>(method: string, key: string): Promise<T[]> {
    try {
      const result = (await this.request<Record<string, unknown>>(method)) || {};
      const entries = result[key];
      return Array.isArray(entries) ? (entries as T[]) : [];
    } catch (err) {
      if (err instanceof McpRpcError && err.code === METHOD_NOT_FOUND) {
        this.log(`[MCP] Server advertised ${key} but does not implement ${method}`);
        return [];
      }
      throw err;
    }
  }

  /** Detaches from the streams and fails anything still waiting. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.onData) {
      this.stdout.off('data', this.onData);
      this.onData = undefined;
    }

    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`MCP client disposed while '${pending.method}' was in flight`));
      this.pending.delete(id);
    }
  }
}
