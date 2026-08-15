/**
 * MCP Server Manager contract (Phase 6).
 *
 * An MCP server is an external tool provider the developer runs on their own
 * workstation. Asterim stores its configuration and supervises the process; it
 * never owns the server itself.
 */

/** How the Core talks to an MCP server. */
export type McpTransport = 'stdio' | 'sse';

/**
 * Lifecycle of a supervised process.
 *
 * `STARTING` is the spawn; `INITIALIZING` is the JSON-RPC handshake that follows
 * it. `RUNNING` is only reached once the server has answered `initialize` and
 * its capabilities are known — a process that exists but never completed the
 * handshake cannot serve a tool call, and saying it is running would be a lie.
 *
 * `CRASHED` means the process exited on its own without being asked to;
 * `ERROR` means it never became usable — a command that does not exist, a spawn
 * that was refused, a handshake that failed or timed out. The distinction
 * matters to a UI: one is worth restarting, the other is worth fixing.
 */
export type McpServerStatus =
  'STOPPED' | 'STARTING' | 'INITIALIZING' | 'RUNNING' | 'CRASHED' | 'ERROR';

/** A tool an MCP server exposes, as reported by `tools/list`. */
export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** A resource an MCP server exposes, as reported by `resources/list`. */
export interface McpResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** A prompt an MCP server exposes, as reported by `prompts/list`. */
export interface McpPromptDefinition {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

/**
 * What a server said it can do, cached from one handshake.
 *
 * A snapshot, not a subscription: `discoveredAt` says when it was taken, and a
 * server that changes its tool list is only re-read on the next discovery.
 */
export interface McpServerCapabilities {
  tools: McpToolDefinition[];
  resources: McpResourceDefinition[];
  prompts: McpPromptDefinition[];
  protocolVersion?: string;
  serverInfo?: { name: string; version: string };
  discoveredAt: number;
}

/** What is persisted in the `mcp_servers` table. */
export interface McpServerConfig {
  id: string;
  /** Scopes the server to one workspace; null for a workstation-wide server. */
  workspaceId?: string | null;
  name: string;
  transport: McpTransport;
  command: string;
  args: string[];
  /** Explicit environment for the child, merged over the sanitized baseline. */
  env?: Record<string, string>;
  isEnabled: boolean;
  isGlobal: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * One piece of a tool's answer.
 *
 * MCP returns content as a list of typed parts — text, an image, an embedded
 * resource — rather than a single string, because a tool may answer with more
 * than one kind of thing at once.
 */
export interface McpToolContent {
  type: string;
  text?: string;
  /** Base64 payload for image or blob content. */
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
}

/**
 * The result of `tools/call`.
 *
 * `isError: true` is the server reporting that the *tool* failed — a file that
 * does not exist, a query that was rejected. That is a normal answer to a
 * question, not a transport failure, and is returned rather than thrown.
 */
export interface McpToolCallResult {
  content: McpToolContent[];
  isError: boolean;
}

/** Configuration plus what the supervisor knows about the live process. */
export interface McpServerRuntimeInfo extends McpServerConfig {
  status: McpServerStatus;
  pid?: number | null;
  uptimeSeconds?: number;
  /** Rolling tail of the child's stderr, oldest first. */
  recentStderrLogs: string[];
  lastError?: string | null;
  /** Exit code of the most recent run, when it has ended. */
  lastExitCode?: number | null;
  /** How many times the supervisor has started this server this session. */
  startCount?: number;
  /** What the last successful handshake found; null until one has happened. */
  capabilities?: McpServerCapabilities | null;
}

/**
 * Payload of every `mcp.*` event on the EventBus.
 *
 * Carries no `projectId`: an MCP server belongs to the workstation, not to a
 * project, which is also why these events are broadcast rather than persisted
 * into the per-project event log.
 */
export interface McpServerEventPayload {
  server: McpServerRuntimeInfo;
}

/** The `mcp.*` event types published on the EventBus. */
export const MCP_EVENTS = {
  SERVER_STARTED: 'mcp.server_started',
  SERVER_STOPPED: 'mcp.server_stopped',
  SERVER_CRASHED: 'mcp.server_crashed',
  CAPABILITIES_UPDATED: 'mcp.capabilities_updated'
} as const;

export type McpEventType = (typeof MCP_EVENTS)[keyof typeof MCP_EVENTS];

/**
 * The tool-call protocol between an Asterim-instructed agent and the Core.
 *
 * Asterim drives agent CLIs over a PTY: it cannot register itself inside
 * `claude`'s or `aider`'s own tool system, so the channel has to be the one
 * channel that exists — the text stream. An agent that has been told about MCP
 * tools asks for one by writing a single line:
 *
 *     ASTERIM_TOOL_CALL {"tool":"mcp__filesystem__read_file","arguments":{"path":"a.txt"}}
 *
 * and the Core writes the answer back on the agent's stdin:
 *
 *     ASTERIM_TOOL_RESULT {"tool":"…","isError":false,"text":"…"}
 *
 * One line each way, JSON after a sentinel, so a parser can find it in a stream
 * that also carries prose, ANSI escapes and progress spinners.
 */
export const TOOL_CALL_PREFIX = 'ASTERIM_TOOL_CALL';
export const TOOL_RESULT_PREFIX = 'ASTERIM_TOOL_RESULT';

/** A tool call an agent has asked for. */
export interface AgentToolCallRequest {
  tool: string;
  arguments: Record<string, unknown>;
}

/** What the Core writes back for one call. */
export interface AgentToolCallResponse {
  tool: string;
  isError: boolean;
  text: string;
}

/** A tool as it is described to an agent. */
export interface AgentToolDescriptor {
  /** `mcp__<server>__<tool>` */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Reads a tool call out of one line of agent output.
 *
 * Returns null for every line that is not one — which is almost all of them —
 * and for a sentinel followed by something that is not a usable call, because a
 * half-written line in a stream is not an error worth surfacing to anyone.
 */
export function parseAgentToolCall(line: string): AgentToolCallRequest | null {
  const index = line.indexOf(TOOL_CALL_PREFIX);
  if (index === -1) return null;

  const payload = line.slice(index + TOOL_CALL_PREFIX.length).trim();
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload) as Partial<AgentToolCallRequest>;
    if (!parsed || typeof parsed.tool !== 'string' || !parsed.tool) return null;
    const args = parsed.arguments;
    return {
      tool: parsed.tool,
      arguments: args && typeof args === 'object' && !Array.isArray(args) ? args : {}
    };
  } catch {
    return null;
  }
}

/** Formats one answer as the line the agent reads. */
export function formatAgentToolResponse(response: AgentToolCallResponse): string {
  return `${TOOL_RESULT_PREFIX} ${JSON.stringify(response)}`;
}

/** Fields a client may send when creating or updating a server. */
export interface McpServerInput {
  name?: string;
  workspaceId?: string | null;
  transport?: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  isEnabled?: boolean;
  isGlobal?: boolean;
}
