import { AgentDeckEvent } from './events';

export interface AgentConfig {
  workspace: string;
  binaryPath?: string;
  model?: string;
  /**
   * Promise-based callback to request user approval.
   * Resolves true if approved, false if denied or timed out.
   */
  requestApproval?: (description: string, command: string) => Promise<boolean>;
  /**
   * Promise-based callback to request user to answer a multiple-choice question.
   * Resolves to the 1-based index of the selected option, or a string for write-ins.
   */
  requestQuestion?: (question: string, options: string[]) => Promise<number | string>;
  /**
   * Optional callback triggered when the agent process exits.
   */
  onExit?: (exitCode: number) => void;
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
   * Writes data directly to the agent's stdin.
   */
  writeStdin?(data: string): void;

  /**
   * Registers a callback to receive events (logs, status, approvals) from the agent.
   */
  onEvent(callback: (event: AgentDeckEvent) => void): void;

  /**
   * Returns the PID of the running process, if applicable.
   */
  getPid?(): number | undefined;
}
