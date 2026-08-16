/**
 * Multi-Agent Handoff & Role Delegation contract (Phase 7, P7-01).
 *
 * A delegation is one thread asking for a second one. The parent names a role,
 * describes the work, and stops; a child thread is created under it, runs under
 * that role's profile, and its outcome is written back into the parent's session
 * as text. Nothing else about a session changes: the child is an ordinary thread
 * with an ordinary transcript, and the only new fact in storage is which thread
 * it hangs from.
 *
 * Two things in here are load-bearing rather than cosmetic:
 *
 *   - `MAX_DELEGATION_DEPTH`. Delegation is recursive by construction — a child
 *     runs an agent, and that agent holds the same tool the parent used. Without
 *     a bound, one ambiguous instruction spawns a chain that only ends when the
 *     machine does.
 *   - The three-valued outcome. `TIMEOUT` is deliberately not folded into
 *     `FAILED`: a child that ran out of time may well have done the work, and
 *     the parent is owed the difference so it can decide whether to look.
 */

/**
 * How many levels of delegation are allowed below a root thread.
 *
 * A root thread is depth 0, so the deepest child that may exist is depth 3 and
 * a request made from it is refused. Three is enough for the workflow this
 * exists to serve — lead delegates to an implementer, who asks for a review —
 * with one level of slack, and small enough that a runaway chain is bounded by
 * something a person can still read.
 */
export const MAX_DELEGATION_DEPTH = 3;

/** The meta-tool an agent calls to hand work to another role. */
export const DELEGATE_TASK_TOOL = 'delegate_task';

/** The meta-tool an agent calls to have its changes critiqued. */
export const REQUEST_REVIEW_TOOL = 'request_review';

/** Every name the delegation subsystem answers to. */
export const DELEGATION_TOOL_NAMES: readonly string[] = [
  DELEGATE_TASK_TOOL,
  REQUEST_REVIEW_TOOL
];

/** Whether a tool name belongs to the delegation subsystem. */
export function isDelegationToolName(name: string): boolean {
  return DELEGATION_TOOL_NAMES.includes(name);
}

/** The role a review is sent to when the caller does not name one. */
export const DEFAULT_REVIEW_ROLE = 'Security Auditor';

/** How long a delegated child may run before it is abandoned. */
export const DEFAULT_DELEGATION_TIMEOUT_MS = 600000;

/** The longest timeout a caller may ask for: one hour. */
export const MAX_DELEGATION_TIMEOUT_MS = 3600000;

/** How a delegation ended, from the parent's point of view. */
export type DelegationStatus = 'COMPLETED' | 'FAILED' | 'TIMEOUT';

/** Where a child session is in its life. */
export type DelegationChildState = 'STARTING' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';

/**
 * Whether a parent session is running or parked behind a child.
 *
 * Held in memory by the delegating service rather than in storage: it describes
 * a live session, and a parent that was waiting when the Core stopped is not
 * waiting for anything once it comes back.
 */
export type DelegationParentState = 'ACTIVE' | 'WAITING_FOR_CHILD';

/** Whether a delegation is ordinary work or a review of existing changes. */
export type DelegationKind = 'TASK' | 'REVIEW';

/** A reviewer's verdict, reduced to the two answers a caller can act on. */
export type ReviewVerdict = 'PASS' | 'NEEDS_FIX';

/** What one thread asks for when it hands work to another. */
export interface DelegationRequest {
  /** The thread that will wait for the result. */
  parentThreadId: string;
  /** The role to run under, matched against profile roles and names. */
  targetRole?: string;
  /** An exact profile, when the caller has one. Wins over `targetRole`. */
  profileId?: string;
  /** What the child is being asked to do. */
  taskDescription: string;
  /** Anything the child needs that its own transcript will not contain. */
  inputContext?: string;
  /** How long to wait before abandoning the child. */
  timeoutMs?: number;
  /** `REVIEW` changes how the brief is written and how the answer is read. */
  kind?: DelegationKind;
  /** What a review must check, when the caller named criteria. */
  reviewCriteria?: string[];
}

/** What the parent gets back, whether or not the child succeeded. */
export interface DelegationResult {
  /** The thread the child ran in. Its transcript outlives this result. */
  childThreadId: string;
  status: DelegationStatus;
  /** One paragraph the parent can act on: the child's answer, or why there is none. */
  summary: string;
  /** Everything the child said, bounded. Empty when it said nothing. */
  output: string;
  /** Files the child named as its output, when it named any. */
  artifacts?: string[];
  /** The role the child ran under. */
  role?: string;
  profileId?: string;
  /** The child's depth in the thread hierarchy; a root thread is 0. */
  depth?: number;
  /** Set for `REVIEW` delegations only. */
  verdict?: ReviewVerdict;
  startedAt?: number;
  finishedAt?: number;
}

/**
 * What a child thread records about why it exists.
 *
 * Stored as `threads.delegation_context_json`, so a child found later — in the
 * dashboard, or by a person reading the database — carries its own brief and
 * its outcome rather than only a parent id.
 */
export interface DelegationContext {
  parentThreadId: string;
  depth: number;
  kind: DelegationKind;
  taskDescription: string;
  inputContext?: string;
  reviewCriteria?: string[];
  role?: string;
  profileId?: string;
  requestedAt: number;
  /** Filled in when the child finishes; absent while it is still running. */
  status?: DelegationStatus;
  summary?: string;
  verdict?: ReviewVerdict;
  finishedAt?: number;
}

/** One child thread, as the REST surface and the dashboard describe it. */
export interface DelegationChildSummary {
  threadId: string;
  projectId: string;
  name: string;
  parentThreadId: string;
  depth: number;
  role?: string;
  profileId?: string;
  kind: DelegationKind;
  taskDescription: string;
  status: DelegationStatus | 'RUNNING';
  summary?: string;
  verdict?: ReviewVerdict;
  requestedAt: number;
  finishedAt?: number;
}

// --- EventBus contract -------------------------------------------------------

/** Published when a child thread has been created and is about to start. */
export const DELEGATION_STARTED_EVENT = 'delegation.started';

/** Published on every child lifecycle transition. */
export const DELEGATION_CHILD_STATE_EVENT = 'delegation.child_state';

/** Published when the parent is parked behind a child, and when it is released. */
export const DELEGATION_PARENT_STATE_EVENT = 'delegation.parent_state';

/** Published once the outcome has been handed back to the parent. */
export const DELEGATION_COMPLETED_EVENT = 'delegation.completed';

export interface DelegationStartedPayload {
  projectId: string;
  /** The parent, so the event routes to the room the user is watching. */
  threadId: string;
  childThreadId: string;
  depth: number;
  kind: DelegationKind;
  role?: string;
  profileId?: string;
  taskDescription: string;
}

export interface DelegationChildStatePayload {
  projectId: string;
  /** The child, whose own room shows its transcript. */
  threadId: string;
  parentThreadId: string;
  state: DelegationChildState;
  message?: string;
}

export interface DelegationParentStatePayload {
  projectId: string;
  threadId: string;
  state: DelegationParentState;
  childThreadId?: string;
}

export interface DelegationCompletedPayload {
  projectId: string;
  threadId: string;
  result: DelegationResult;
}

// --- Who may delegate --------------------------------------------------------

/**
 * The roles that hand work out rather than do it.
 *
 * Matched as substrings of a profile's role, lowercased, because a workstation's
 * own "Lead Architect (Platform)" is the same kind of thing as the built-in
 * "Tech Lead" and a user should not have to discover an exact spelling.
 *
 * The list is deliberately short. A reviewer profile that could delegate would
 * be able to spawn the implementer whose work it is reviewing, which is not a
 * workflow anyone asked for.
 */
export const DELEGATION_CAPABLE_ROLE_PATTERNS: readonly string[] = [
  'tech lead',
  'team lead',
  'lead architect',
  'architect',
  'orchestrator',
  'engineering manager',
  'staff engineer',
  'principal engineer'
];

/** Whether a role name is one that hands work out. */
export function isDelegationCapableRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const normalized = role.trim().toLowerCase();
  if (!normalized) return false;
  return DELEGATION_CAPABLE_ROLE_PATTERNS.some(pattern => normalized.includes(pattern));
}

/**
 * Whether a session running under this profile is offered the meta-tools.
 *
 * Deliberately not the rule the capability lists follow, where an absent list
 * means "everything". Delegation is not a tool the workstation happens to
 * offer; it is a thing a *role* does, and a session with no role is not an
 * orchestrator. So an unprofiled session gets nothing here, and choosing the
 * Tech Lead profile is what turns delegation on — which also means a persona
 * whose job is to implement or to review cannot hand its work to someone else.
 *
 * A person can still delegate from any thread over the REST surface; this
 * decides only what an agent is handed.
 */
export function canProfileDelegate(
  profile: { role?: string; name?: string } | null | undefined
): boolean {
  if (!profile) return false;
  return isDelegationCapableRole(profile.role) || isDelegationCapableRole(profile.name);
}

// --- Meta-tool definitions ---------------------------------------------------

/** A meta-tool as the agent-facing catalogue describes it. */
export interface DelegationToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * The two meta-tools, defined once.
 *
 * The descriptions are written for the model that has to choose between them,
 * so each says what it costs: a delegation blocks the caller until the child is
 * done, which is the fact most likely to stop an agent from reaching for it out
 * of habit.
 */
export const DELEGATION_TOOL_DEFINITIONS: readonly DelegationToolDefinition[] = [
  {
    name: DELEGATE_TASK_TOOL,
    description:
      'Hand a self-contained piece of work to another engineering role. A new agent session is started under that role, runs the task, and its outcome is returned to you. You are paused until it finishes, so delegate whole pieces of work rather than single steps.',
    inputSchema: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          description:
            'The engineering role to hand the work to, e.g. "Senior Backend Engineer", "Frontend Reviewer", "DevOps Engineer", "QA Engineer", "Security Auditor".'
        },
        task: {
          type: 'string',
          description: 'What that role should do, stated as an outcome it can verify.'
        },
        context: {
          type: 'string',
          description:
            'Anything it needs that it cannot see from the repository: constraints, decisions already made, files to start from.'
        },
        timeoutMs: {
          type: 'number',
          description: 'How long to wait before giving up on it. Defaults to ten minutes.'
        }
      },
      required: ['role', 'task']
    }
  },
  {
    name: REQUEST_REVIEW_TOOL,
    description:
      'Have changes critiqued by a reviewer role before you rely on them. Returns a PASS or NEEDS_FIX verdict with the findings behind it. You are paused until the review is done.',
    inputSchema: {
      type: 'object',
      properties: {
        diff: {
          type: 'string',
          description: 'The changes to review, as a diff or as the relevant excerpts.'
        },
        criteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'What the review must check. Defaults to the reviewer role’s own checklist.'
        },
        role: {
          type: 'string',
          description: `Which reviewer to ask. Defaults to "${DEFAULT_REVIEW_ROLE}".`
        },
        timeoutMs: {
          type: 'number',
          description: 'How long to wait before giving up on the review.'
        }
      },
      required: ['diff']
    }
  }
];

/**
 * Reads a reviewer's answer into a verdict.
 *
 * Anything that is not an unambiguous pass is a `NEEDS_FIX`, including a review
 * that says neither. A reviewer that could not reach a conclusion has not
 * cleared the change, and defaulting the other way would turn a broken review
 * into an approval.
 */
export function parseReviewVerdict(output: string): ReviewVerdict {
  if (!output) return 'NEEDS_FIX';
  const text = output.toUpperCase();
  if (/NEEDS[\s_-]?FIX|NEEDS[\s_-]?WORK|\bFAIL(ED|URE)?\b|\bREJECT(ED)?\b/.test(text)) {
    return 'NEEDS_FIX';
  }
  if (/\bPASS(ED|ES)?\b|\bAPPROVED?\b|\bLGTM\b/.test(text)) return 'PASS';
  return 'NEEDS_FIX';
}
