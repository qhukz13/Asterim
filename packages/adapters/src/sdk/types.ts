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
