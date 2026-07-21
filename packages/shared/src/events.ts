export interface AsterimEvent<T = any> {
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

// --- Context Domain Types ---

/** The kind of information a context entry represents. */
export type ContextEntryType =
  | 'file'
  | 'knowledge'
  | 'bookmark'
  | 'suggestion'
  | 'artifact';

/** Who or what created a context entry. */
export type ContextEntryCreator =
  | 'user'
  | 'agent'
  | 'ai'
  | 'system'
  | 'plugin';

/** A single entry within a Thread's Context aggregate. */
export interface ContextEntry {
  id: string;
  threadId: string;
  projectId: string;
  entryType: ContextEntryType;
  /** File path or resource URI (for file/bookmark/artifact types). */
  path?: string;
  /** Display label when path alone is insufficient. */
  label?: string;
  /** Freeform text content (for knowledge type). */
  content?: string;
  /** Entry status within the context. */
  status: 'pinned' | 'active' | 'suggestion';
  /** Who or what created this entry. */
  createdBy: ContextEntryCreator;
  /** Explicit ordering position within the context. */
  position: number;
  createdAt: number;
  updatedAt: number;
  /** Monotonically increasing version for optimistic concurrency. */
  version: number;
}

/** Payload broadcast when a thread's context is modified. */
export interface ContextUpdatedPayload {
  threadId: string;
  projectId: string;
  entries: ContextEntry[];
}

/** Payload broadcast when a thread's context is fully cleared. */
export interface ContextClearedPayload {
  threadId: string;
  projectId: string;
}

// Helper types for specific events
export type AgentLogEvent = AsterimEvent<AgentLogPayload>;
export type AgentStatusEvent = AsterimEvent<AgentStatusPayload>;
export type ApprovalRequestEvent = AsterimEvent<ApprovalRequestPayload>;
export type ClientCommandEvent = AsterimEvent<ClientCommandPayload>;
export type ClientStdinEvent = AsterimEvent<ClientStdinPayload>;
export type ClientApprovalResponseEvent = AsterimEvent<ClientApprovalResponsePayload>;
export type QuestionRequestEvent = AsterimEvent<QuestionRequestPayload>;
export type ClientQuestionResponseEvent = AsterimEvent<ClientQuestionResponsePayload>;
export type FileChangedEvent = AsterimEvent<FileChangedPayload>;
export type ClientPairEvent = AsterimEvent<ClientPairPayload>;
export type ServerAuthResultEvent = AsterimEvent<ServerAuthResultPayload>;
export type ChatMessageEvent = AsterimEvent<ChatMessagePayload>;
export type ClientChatMessageEvent = AsterimEvent<ClientChatMessagePayload>;
