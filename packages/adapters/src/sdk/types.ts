import { AsterimEvent } from '@asterim/shared';

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
