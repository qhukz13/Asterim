export interface AgentDeckEvent<T = any> {
  id: string;
  timestamp: number;
  source: string; // e.g., 'adapter:aider', 'client:web-123'
  type: string;
  payload: T & { projectId?: string; threadId?: string };
}

export interface AgentLogPayload {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export interface AgentStatusPayload {
  status: 'idle' | 'working' | 'waiting_approval' | 'waiting_question' | 'error' | 'startup';
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

export interface ClientStdinPayload {
  data: string;
}

export interface ClientApprovalResponsePayload {
  actionId: string;
  approved: boolean;
  feedback?: string;
}

export interface ChatMessagePayload {
  role: 'user' | 'agent';
  content: string;
}

export interface QuestionRequestPayload {
  questionId: string;
  question: string;
  options: string[];
}

export interface ClientQuestionResponsePayload {
  questionId: string;
  selectedIndex: number; // 1-based index
  selectedText?: string;
}

export interface ClientChatMessagePayload {
  message: string;
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

// Helper types for specific events
export type AgentLogEvent = AgentDeckEvent<AgentLogPayload>;
export type AgentStatusEvent = AgentDeckEvent<AgentStatusPayload>;
export type ApprovalRequestEvent = AgentDeckEvent<ApprovalRequestPayload>;
export type ClientCommandEvent = AgentDeckEvent<ClientCommandPayload>;
export type ClientStdinEvent = AgentDeckEvent<ClientStdinPayload>;
export type ClientApprovalResponseEvent = AgentDeckEvent<ClientApprovalResponsePayload>;
export type QuestionRequestEvent = AgentDeckEvent<QuestionRequestPayload>;
export type ClientQuestionResponseEvent = AgentDeckEvent<ClientQuestionResponsePayload>;
export type FileChangedEvent = AgentDeckEvent<FileChangedPayload>;
export type ClientPairEvent = AgentDeckEvent<ClientPairPayload>;
export type ServerAuthResultEvent = AgentDeckEvent<ServerAuthResultPayload>;
export type ChatMessageEvent = AgentDeckEvent<ChatMessagePayload>;
export type ClientChatMessageEvent = AgentDeckEvent<ClientChatMessagePayload>;
