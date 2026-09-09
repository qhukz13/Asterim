import type {
  ProjectDecision,
  ProjectIntent,
  ArchitecturalRule,
  DecisionStatus
} from './types/memory';
import type { ApprovalConsequence } from './types/approval';
import type { Diagnosis } from './types/diagnostics';

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
  /**
   * Present on `error`: what went wrong and what to try. The dashboard renders
   * the remedies rather than only the message, because a user without a
   * founder to ask needs the next step, not the stack.
   */
  diagnosis?: Diagnosis;
}

export interface ApprovalRequestPayload {
  actionId: string;
  description: string;
  command: string; // The command the agent wants to run
  /**
   * What approving actually does, in a form the card can render (the file that
   * will be written, the edit that will be made, the command that will run).
   * Absent for providers that only give us a line of text, and for approvals
   * recovered from the database after a restart — the card falls back to
   * `description` and `command` in both cases.
   */
  consequence?: ApprovalConsequence;
  /** The Core's own risk read. Its warnings are shown on the card. */
  securityAnalysis?: {
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    isPathTraversal: boolean;
    warnings: string[];
    requiresExplicitHumanApproval: boolean;
  };
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
  /**
   * What produced this decision. `user` means someone clicked the card;
   * `auto-rule` means a setting answered on their behalf. Recorded because a
   * gate that cannot say who opened it is not a gate — an approval nobody made
   * has to be visible in the record.
   */
  decidedBy?: 'user' | 'auto-rule';
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

// --- Project Memory Payloads ---

/** Payload broadcast when a decision is recorded in a project's memory. */
export interface MemoryDecisionCreatedPayload {
  projectId: string;
  decision: ProjectDecision;
}

/** Payload broadcast when a decision is replaced by a newer one. */
export interface MemoryDecisionSupersededPayload {
  projectId: string;
  /** Id of the decision that was superseded. */
  decisionId: string;
  /** Id of the decision that replaced it. */
  supersededBy: string;
  /** The replacing decision, when it was created as part of the same operation. */
  decision?: ProjectDecision;
}

/**
 * Payload broadcast when a decision moves to another lifecycle state.
 *
 * Distinct from `memory.decision_superseded`, which describes one decision being
 * replaced by another. This covers a status change on its own — archiving,
 * marking stale — where nothing takes the decision's place.
 */
export interface MemoryDecisionUpdatedPayload {
  projectId: string;
  /** The decision as it now stands. */
  decision: ProjectDecision;
  /** The status it held before this change, so a client can tell what moved. */
  previousStatus: DecisionStatus;
}

/** Payload broadcast when a project's active intent changes. */
export interface MemoryIntentUpdatedPayload {
  projectId: string;
  /** The project's intent after the update, or `null` if it was archived without a replacement. */
  intent: ProjectIntent | null;
  /** Id of the intent archived by this update, when one was replaced. */
  previousIntentId?: string;
}

/** Payload broadcast when an architectural rule is added to a project. */
export interface MemoryRuleCreatedPayload {
  projectId: string;
  rule: ArchitecturalRule;
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
export type MemoryDecisionCreatedEvent = AsterimEvent<MemoryDecisionCreatedPayload>;
export type MemoryDecisionSupersededEvent = AsterimEvent<MemoryDecisionSupersededPayload>;
export type MemoryDecisionUpdatedEvent = AsterimEvent<MemoryDecisionUpdatedPayload>;
export type MemoryIntentUpdatedEvent = AsterimEvent<MemoryIntentUpdatedPayload>;
export type MemoryRuleCreatedEvent = AsterimEvent<MemoryRuleCreatedPayload>;
