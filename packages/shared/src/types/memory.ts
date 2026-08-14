// --- Project Memory Core Domain Types ---
//
// Timestamps are milliseconds since epoch (`Date.now()`), matching the INTEGER
// columns used by the `sessions`, `approvals`, and `context_entries` tables and
// the `ContextEntry` type in `./events`.

/** Lifecycle state of a recorded project decision. */
export type DecisionStatus =
  /** Currently in force. */
  | 'ACTIVE'
  /** Still in force, but the evidence backing it no longer matches the repository. */
  | 'STALE'
  /** Replaced by another decision; see `supersededBy`. */
  | 'SUPERSEDED'
  /** Retired without a replacement. */
  | 'ARCHIVED';

/** How a decision entered project memory, ordered from strongest to weakest. */
export type DecisionProvenance =
  /** The user explicitly confirmed it. */
  | 'HUMAN_CONFIRMED'
  /** Derived from the repository itself (code, config, commit history). */
  | 'REPOSITORY_EVIDENCE'
  /** An agent asserted it during a session. */
  | 'AGENT_STATEMENT'
  /** Inferred without direct evidence. */
  | 'INFERRED';

/** A concrete anchor in the repository backing a decision. */
export interface DecisionCodeRef {
  id: string;
  decisionId: string;
  /** Repository-relative path. */
  filePath?: string;
  /** Function, class, or symbol name within `filePath`. */
  symbolName?: string;
  /** Commit the reference was captured against. */
  commitHash?: string;
  createdAt: number;
}

/** A durable architectural or product decision held in a project's memory. */
export interface ProjectDecision {
  id: string;
  projectId: string;
  /** Short imperative headline. */
  title: string;
  /** What was decided. */
  summary: string;
  /** Why it was decided. */
  rationale: string;
  /** Boundaries the decision imposes on future work. */
  constraints: string[];
  status: DecisionStatus;
  /** Id of the decision that replaced this one; `null` unless `status` is `'SUPERSEDED'`. */
  supersededBy: string | null;
  provenance: DecisionProvenance;
  /** Confidence in the decision, 0–1. */
  confidence: number;
  createdAt: number;
  updatedAt: number;
  /** Repository-relative paths the decision governs. */
  relatedFiles: string[];
  /** Populated when code references are loaded alongside the decision. */
  codeRefs?: DecisionCodeRef[];
  /** Computed on request, never stored. Absent unless drift was asked for. */
  drift?: DecisionDriftInfo;
}

/** Lifecycle state of a project intent. */
export type ProjectIntentStatus = 'ACTIVE' | 'ARCHIVED';

/** What the project is currently trying to achieve. At most one intent is `'ACTIVE'` per project. */
export interface ProjectIntent {
  id: string;
  projectId: string;
  /** The outcome being pursued. */
  goal: string;
  /** Boundaries the work must respect. */
  constraints: string[];
  /** Explicitly out of scope. */
  nonGoals: string[];
  status: ProjectIntentStatus;
  createdAt: number;
  updatedAt: number;
}

/** How strongly an architectural rule should be enforced. */
export type ArchitecturalRuleSeverity = 'error' | 'warning' | 'info';

/** A standing constraint agents must observe when working in a project. */
export interface ArchitecturalRule {
  id: string;
  projectId: string;
  /** Short headline. */
  title: string;
  /** The rule itself, phrased as a directive. */
  statement: string;
  severity: ArchitecturalRuleSeverity;
  /** Glob matching the paths the rule applies to (`'**'` for project-wide). */
  scopePattern: string;
  createdAt: number;
}

/**
 * Lifecycle state of an agent session, mirroring the `status` values written to
 * the `sessions` table by `AgentService`.
 */
export type AgentWorkStatus = 'running' | 'stopped' | 'exited' | 'crashed';

/** A recent agent session, projected from the `sessions` table for a briefing. */
export interface AgentWorkSummary {
  sessionId: string;
  /** Absent on rows written before `sessions.thread_id` was added. */
  threadId?: string;
  /** Provider id, e.g. `'claude'`, `'aider'`, `'antigravity'`. */
  agentType: string;
  status: AgentWorkStatus;
  startedAt: number;
  /** Last status transition; doubles as the session's last-activity time. */
  updatedAt: number;
}

/**
 * Resolution state of an approval, mirroring the `status` values written to the
 * `approvals` table by `ApprovalManager`.
 */
export type ApprovalOutcome = 'pending' | 'approved' | 'denied' | 'expired';

/** A recent approval gate, projected from the `approvals` table for a briefing. */
export interface ApprovalSummary {
  /** The `action_id` correlation key, not the row's primary key. */
  actionId: string;
  description: string;
  /** The command the agent asked to run. */
  command: string;
  status: ApprovalOutcome;
  /** Request time. The `approvals` table records no resolution timestamp. */
  createdAt: number;
}

/** The memory snapshot handed to an agent at the start of its work on a project. */
export interface ProjectBriefing {
  projectId: string;
  /** Decisions whose `status` is `'ACTIVE'`. */
  activeDecisions: ProjectDecision[];
  architecturalRules: ArchitecturalRule[];
  /** The project's `'ACTIVE'` intent, or `null` if none is set. */
  currentIntent: ProjectIntent | null;
  /** Most recent agent sessions, newest first. */
  recentAgentWork: AgentWorkSummary[];
  /** Most recent approval gates, newest first. */
  recentApprovals: ApprovalSummary[];
}

// --- Request bodies for the memory REST surface ---
//
// These are the wire contract for `/api/v1/projects/:id/memory/*`, shared by the
// server routes and the web client. They deliberately carry no `projectId`: the
// route reads it from the URL path. That is what distinguishes them from the
// service-level `Create*Input` types in `ProjectMemoryService`, which do carry one.

/** A code anchor supplied when recording a decision. */
export interface CreateCodeRefRequest {
  filePath?: string;
  symbolName?: string;
  commitHash?: string;
}

/** Body of `POST /api/v1/projects/:id/memory/decisions`. */
export interface CreateDecisionRequest {
  title: string;
  summary: string;
  rationale: string;
  constraints?: string[];
  status?: DecisionStatus;
  provenance?: DecisionProvenance;
  /** Clamped to 0–1 by the service. Defaults to 1.0. */
  confidence?: number;
  /** Repository-relative paths the decision governs. Persisted as code anchors. */
  relatedFiles?: string[];
  codeRefs?: CreateCodeRefRequest[];
}

/**
 * Body of `POST /api/v1/projects/:id/memory/decisions/:decisionId/supersede`.
 *
 * The fields describe the *replacement* decision; the decision being replaced is
 * identified by the path, not the body.
 */
export type SupersedeDecisionRequest = CreateDecisionRequest;

/** Body of `POST /api/v1/projects/:id/memory/intents`. */
export interface CreateIntentRequest {
  goal: string;
  constraints?: string[];
  nonGoals?: string[];
}

/** Body of `POST /api/v1/projects/:id/memory/rules`. */
export interface CreateRuleRequest {
  title: string;
  statement: string;
  severity?: ArchitecturalRuleSeverity;
  /** Glob matching the paths the rule applies to. */
  scopePattern?: string;
}

// --- Code anchor drift ---
//
// Drift is a *computed* property, never stored: it compares a decision's anchors
// against the working tree at the moment it is asked for. Per DEC-027 a drifted
// decision is flagged, never mutated — the code moved, not the decision.

/** How a single code anchor has come adrift from the repository. */
export type DriftType =
  /** The anchored file is no longer on disk. */
  | 'FILE_DELETED'
  /** The anchored file has changed since the decision was anchored to it. */
  | 'FILE_MODIFIED'
  /** The anchored symbol is no longer present in the file. */
  | 'SYMBOL_NOT_FOUND';

/** The drift found against one code reference. */
export interface CodeRefDrift {
  /** Id of the `decision_code_refs` row this describes. */
  refId: string;
  filePath?: string;
  symbolName?: string;
  type: DriftType;
  /** Human-readable explanation, suitable for a tooltip. */
  detail: string;
}

/** Drift across every anchor of one decision. */
export interface DecisionDriftInfo {
  decisionId: string;
  /** True when at least one anchor has drifted. */
  drifted: boolean;
  /** Empty when the decision is clean. */
  refs: CodeRefDrift[];
  /** The most severe drift found, or null when clean. */
  worst: DriftType | null;
}
