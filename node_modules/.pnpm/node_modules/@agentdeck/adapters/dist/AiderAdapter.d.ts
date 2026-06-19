import { IAgentAdapter, AgentConfig, AgentDeckEvent } from '@agentdeck/shared';
export declare class AiderAdapter implements IAgentAdapter {
    private ptyProcess;
    private eventCallback?;
    private currentActionId;
    private dataBuffer;
    private pendingApproval;
    private requestApprovalCallback?;
    start(config: AgentConfig): Promise<void>;
    stop(): Promise<void>;
    sendCommand(command: string): Promise<void>;
    writeStdin(data: string): void;
    getPid(): number | undefined;
    onEvent(callback: (event: AgentDeckEvent) => void): void;
    private parseOutputForApprovals;
    private emitLog;
    private emitStatus;
}
//# sourceMappingURL=AiderAdapter.d.ts.map