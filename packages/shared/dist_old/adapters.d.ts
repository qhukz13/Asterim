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
}
//# sourceMappingURL=adapters.d.ts.map