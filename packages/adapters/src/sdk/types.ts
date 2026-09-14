import { AgentToolDescriptor, AsterimEvent } from '@asterim/shared';

export interface AdapterCapabilities {
  supportsDiff: boolean;
  supportsTerminal: boolean;
  supportsInterrupt: boolean;
  supportsResume: boolean;
  supportsVision: boolean;
  supportsApproval: boolean;
  supportsNotifications: boolean;
  supportsContextFiles: boolean;
  supportsMultiSession: boolean;
  supportsRemoteExecution: boolean;
  supportsStreaming: boolean;
}

export interface IParser {
  /**
   * Parse a raw chunk of output from the provider process and optionally return structured events.
   * A parser might hold internal state and emit events through an injected callback.
   * @param chunk Raw data chunk from stdout/stderr or terminal diff
   */
  processOutput(chunk: any): void;
}

/** One tool call a native-protocol agent wants a human to decide on. */
export interface NativePermissionAsk {
  toolName: string;
  input: Record<string, unknown>;
  toolUseId?: string;
  /** The agent's own one-line description of the call, when it gave one. */
  description?: string;
  /** Why the agent's own rules did not decide this call themselves. */
  reason?: string;
  /**
   * Aborted when the agent withdraws the request before it is answered (a
   * hook or a permission rule decided first). The resolver should stop waiting
   * on the human and cancel anything it showed.
   */
  signal?: AbortSignal;
}

export interface LaunchConfig {
  workspace: string;
  isMock?: boolean;
  hasHistory?: boolean;
  /**
   * Extra environment variables for the agent process — the decrypted workspace
   * secrets an environment lends to the sessions running in it (P9-02). Resolved
   * by the Core, never by an adapter: the values are credentials, and the only
   * thing an adapter is allowed to do with them is hand them to `pty.spawn`.
   */
  env?: Record<string, string>;
  /** MCP tools this session may call, for prompts and CLI tool definitions. */
  mcpTools?: AgentToolDescriptor[];
  /** The instructions describing those tools and how to call them. */
  mcpToolInstructions?: string;
  /**
   * Answers permission requests raised by an agent through its own protocol
   * (Claude Code's `can_use_tool` control request). The Core resolves it after
   * the human decides. Absent means every such request is denied, which is the
   * safe reading of "nobody is there to answer".
   */
  permissionResolver?: (ask: NativePermissionAsk) => Promise<{ approved: boolean; message?: string }>;
  /** A provider session id to resume, when the thread has one. */
  resumeSessionId?: string;
  /** Extra text appended to the provider's system prompt (profiles, briefings). */
  systemPromptAppendix?: string;
}

export interface IAgentProvider {
  /** Unique identifier for the provider (e.g. 'antigravity', 'claude') */
  readonly id: string;
  
  /** The capabilities this provider supports */
  readonly capabilities: AdapterCapabilities;

  /**
   * Returns the command and arguments needed to launch the provider process.
   */
  getLaunchCommand(config: LaunchConfig): { cmd: string; args: string[]; env?: Record<string, string> };

  /**
   * Factory method to create a parser instance for this provider.
   */
  createParser(onEvent: (event: AsterimEvent) => void): IParser;
}
