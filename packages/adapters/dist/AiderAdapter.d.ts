import { IAgentAdapter, AgentConfig, AgentDeckEvent } from '@agentdeck/shared';
export declare class AiderAdapter implements IAgentAdapter {
    private process;
    private eventCallback?;
    start(config: AgentConfig): Promise<void>;
    stop(): Promise<void>;
    sendCommand(command: string): Promise<void>;
    onEvent(callback: (event: AgentDeckEvent) => void): void;
    private emitLog;
    private emitStatus;
}
//# sourceMappingURL=AiderAdapter.d.ts.map