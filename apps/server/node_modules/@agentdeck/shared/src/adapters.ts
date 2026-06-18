import { AgentDeckEvent } from './events';

export interface AgentConfig {
  workspace: string;
  binaryPath?: string;
  model?: string;
}

export interface IAgentAdapter {
  /**
   * Initializes and starts the agent process.
   */
  start(config: AgentConfig): Promise<void>;

  /**
   * Gracefully stops the agent process.
   */
  stop(): Promise<void>;

  /**
   * Sends a command or prompt directly to the agent.
   */
  sendCommand(command: string): Promise<void>;

  /**
   * Registers a callback to receive events (logs, status, approvals) from the agent.
   */
  onEvent(callback: (event: AgentDeckEvent) => void): void;
}
