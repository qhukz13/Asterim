export interface AgentDeckEvent<T = any> {
    id: string;
    timestamp: number;
    source: string;
    type: string;
    payload: T;
}
export interface AgentLogPayload {
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
}
export interface AgentStatusPayload {
    status: 'idle' | 'working' | 'waiting_approval' | 'error';
    message?: string;
}
export interface ApprovalRequestPayload {
    actionId: string;
    description: string;
    command: string;
}
export interface ClientCommandPayload {
    command: string;
}
export interface ClientStdinPayload {
    data: string;
}
export interface ClientApprovalResponsePayload {
    actionId: string;
    approved: boolean;
    feedback?: string;
}
export interface FileChangedPayload {
    filePath: string;
    changeType: 'added' | 'modified' | 'deleted';
    diff?: string;
}
export interface ClientPairPayload {
    pin: string;
}
export interface ServerAuthResultPayload {
    success: boolean;
    token?: string;
    error?: string;
}
export type AgentLogEvent = AgentDeckEvent<AgentLogPayload>;
export type AgentStatusEvent = AgentDeckEvent<AgentStatusPayload>;
export type ApprovalRequestEvent = AgentDeckEvent<ApprovalRequestPayload>;
export type ClientCommandEvent = AgentDeckEvent<ClientCommandPayload>;
export type ClientStdinEvent = AgentDeckEvent<ClientStdinPayload>;
export type ClientApprovalResponseEvent = AgentDeckEvent<ClientApprovalResponsePayload>;
export type FileChangedEvent = AgentDeckEvent<FileChangedPayload>;
export type ClientPairEvent = AgentDeckEvent<ClientPairPayload>;
export type ServerAuthResultEvent = AgentDeckEvent<ServerAuthResultPayload>;
//# sourceMappingURL=events.d.ts.map