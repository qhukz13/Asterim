export interface AgentDeckEvent<T = any> {
  id: string;
  timestamp: number;
  source: string; // e.g., 'adapter:aider', 'client:web-123'
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
  command: string; // The command the agent wants to run
}

export interface ClientCommandPayload {
  command: string;
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

// Helper types for specific events
export type AgentLogEvent = AgentDeckEvent<AgentLogPayload>;
export type AgentStatusEvent = AgentDeckEvent<AgentStatusPayload>;
export type ApprovalRequestEvent = AgentDeckEvent<ApprovalRequestPayload>;
export type ClientCommandEvent = AgentDeckEvent<ClientCommandPayload>;
export type ClientApprovalResponseEvent = AgentDeckEvent<ClientApprovalResponsePayload>;
export type FileChangedEvent = AgentDeckEvent<FileChangedPayload>;
