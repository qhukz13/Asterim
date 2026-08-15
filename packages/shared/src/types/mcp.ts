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
 * `CRASHED` means the process exited on its own without being asked to;
 * `ERROR` means it never started (a command that does not exist, a spawn that
 * was refused). The distinction matters to a UI: one is worth restarting, the
 * other is worth fixing.
 */
export type McpServerStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'CRASHED' | 'ERROR';

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
