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

import type { VerificationPipelineReport } from './verification';

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

/**
 * How many children one parent may have running at the same time (P7-04).
 *
 * Depth bounds how far delegation goes down; this bounds how wide it goes at
 * any one level, which is the other way a fan-out turns into a machine running
 * more agent processes than it has cores. Four is the width the workflow this
 * exists to serve actually uses — a lead splitting a feature into backend,
 * frontend, and asking for a review of each — and it is small enough that the
 * outcome matrix the parent is handed still fits in one prompt.
 *
 * It is a bound on *concurrency*, not on total children: a parent may delegate
 * a hundred times in sequence, four at a time.
 */
export const MAX_CONCURRENT_DELEGATIONS = 4;

/** The meta-tool an agent calls to hand work to another role. */
export const DELEGATE_TASK_TOOL = 'delegate_task';

/** The meta-tool an agent calls to have its changes critiqued. */
export const REQUEST_REVIEW_TOOL = 'request_review';

/** The meta-tool an agent calls to hand out several pieces of work at once. */
export const DELEGATE_PARALLEL_TOOL = 'delegate_parallel';

/** Every name the delegation subsystem answers to. */
export const DELEGATION_TOOL_NAMES: readonly string[] = [
  DELEGATE_TASK_TOOL,
  REQUEST_REVIEW_TOOL,
  DELEGATE_PARALLEL_TOOL
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
  /**
   * Whether the child runs in its own Git worktree (P8-01).
   *
   * Unset means the default, which is on for `TASK` in a Git repository and off
   * everywhere else: a child that is going to edit files needs a sandbox, a
   * reviewer that is going to read them does not, and a project that is not a
   * repository has nothing to branch from. Set it explicitly to override either
   * way; asking for isolation where it cannot be provided is not an error, it
   * simply does not happen.
   */
  isolateWorktree?: boolean;
  /**
   * Whether the child's work is verified before the result is handed back (P8-02).
   *
   * Unset means the default, which is on for a `TASK` that got a sandbox: the
   * child edited files somewhere isolated, so the project's own typechecker,
   * linter, tests and build can be run over exactly those edits without anyone
   * else's checkout being touched. Off everywhere else — a reviewer changed
   * nothing to verify, and a task with no sandbox would be verified in the
   * operator's own working tree.
   *
   * Setting it explicitly overrides both ways, including running the pipeline in
   * the project directory when there is no sandbox. Like isolation, asking for
   * verification a project cannot provide is not an error: the report comes back
   * saying no pipeline was discovered.
   */
  verifyPipeline?: boolean;
  /**
   * Which discovered steps to run, by name, instead of all of them.
   *
   * Names, not commands — `['typecheck', 'test']`. A caller cannot introduce a
   * command this way, only choose among the ones the project already declares.
   */
  verificationSteps?: string[];
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
  /**
   * The sandbox the child ran in, when it ran in one (P8-01).
   *
   * `diff` is what the child actually changed, taken against the commit its
   * worktree was branched from — the thing a parent or an operator has to look
   * at before deciding whether to keep the work. It is absent rather than empty
   * when there was no sandbox, so "no isolation" and "isolated and changed
   * nothing" stay distinguishable.
   */
  worktreePath?: string;
  diff?: string;
  changedFiles?: string[];
  /**
   * What the project's own verification commands said about the child's work
   * (P8-02).
   *
   * The other half of the evidence the diff is: a diff shows what was changed,
   * this shows whether the result still typechecks, lints, tests and builds. It
   * is Asterim's own execution, not the child's account of it, which is the
   * point — an agent that reports "all tests pass" and a pipeline that exits
   * non-zero disagree, and only one of them ran the tests.
   *
   * Absent when nothing was verified, rather than present and empty, so
   * "verification was not run" and "verification found nothing to run" stay
   * distinguishable — the second is a report with `totalSteps: 0`.
   */
  verificationReport?: VerificationPipelineReport;
}

// --- Parallel delegation (P7-04) ---------------------------------------------

/**
 * How a batch of delegations ended.
 *
 * `PARTIAL_SUCCESS` is the case a single delegation cannot have and the one a
 * fan-out produces most often: the backend child answered, the frontend child
 * timed out, and the parent has real work to continue from plus one thing to
 * decide about. Folding it into `FAILED` would throw away the half that worked.
 */
export type BatchDelegationStatus = DelegationStatus | 'PARTIAL_SUCCESS';

/** One piece of work in a parallel batch. A `DelegationRequest` without a parent. */
export interface ParallelDelegationItem {
  targetRole?: string;
  profileId?: string;
  taskDescription: string;
  inputContext?: string;
  timeoutMs?: number;
  kind?: DelegationKind;
  reviewCriteria?: string[];
  /** Whether this piece runs in its own Git worktree (P8-01). */
  isolateWorktree?: boolean;
  /** Whether this piece's work is verified before it is reported (P8-02). */
  verifyPipeline?: boolean;
  /** Which discovered verification steps to run for it, by name (P8-02). */
  verificationSteps?: string[];
}

/** Several pieces of work handed out at once, from one parent. */
export interface ParallelDelegationRequest {
  parentThreadId: string;
  delegations: ParallelDelegationItem[];
}

/** What the parent gets back once every child in a batch has settled. */
export interface BatchDelegationResult {
  parentThreadId: string;
  overallStatus: BatchDelegationStatus;
  /** One per requested child, in the order they were requested. */
  results: DelegationResult[];
  /** Set when at least one child was a `REVIEW`. */
  aggregatedVerdict?: ReviewVerdict;
  /** One line the parent can act on: how many finished, and how many did not. */
  summary: string;
  startedAt: number;
  finishedAt: number;
}

/**
 * The status a batch reads as, from what its children did.
 *
 * All completed is `COMPLETED`; some completed is `PARTIAL_SUCCESS`; none
 * completed is `FAILED`, unless every one of them ran out of time, which stays
 * `TIMEOUT` for the same reason a single delegation does — a child that timed
 * out may well have done the work, and the parent is owed the difference.
 */
export function aggregateDelegationStatus(
  results: readonly Pick<DelegationResult, 'status'>[]
): BatchDelegationStatus {
  if (results.length === 0) return 'FAILED';
  const completed = results.filter(result => result.status === 'COMPLETED').length;
  if (completed === results.length) return 'COMPLETED';
  if (completed > 0) return 'PARTIAL_SUCCESS';
  return results.every(result => result.status === 'TIMEOUT') ? 'TIMEOUT' : 'FAILED';
}

/**
 * One verdict over every review in a batch, or none when there were no reviews.
 *
 * A single dissent carries: a change three reviewers cleared and a fourth did
 * not has not been cleared, and reporting the majority would be the one summary
 * an agent could act on and be wrong.
 */
export function aggregateReviewVerdict(
  results: readonly Pick<DelegationResult, 'verdict'>[]
): ReviewVerdict | undefined {
  const verdicts = results
    .map(result => result.verdict)
    .filter((verdict): verdict is ReviewVerdict => !!verdict);
  if (verdicts.length === 0) return undefined;
  return verdicts.every(verdict => verdict === 'PASS') ? 'PASS' : 'NEEDS_FIX';
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
  /** The sandbox this child was given, when it was given one (P8-01). */
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeBaseCommit?: string;
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

/**
 * Published once every child of a parallel batch has settled (P7-04).
 *
 * In addition to, not instead of, one `delegation.completed` per child: a
 * dashboard that only knows the four P7-01 events still sees each child finish
 * and each parent released, and this is what tells it the several outcomes it
 * just saw were one fan-out with one verdict over it.
 */
export const DELEGATION_BATCH_COMPLETED_EVENT = 'delegation.batch_completed';

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

export interface DelegationBatchCompletedPayload {
  projectId: string;
  /** The parent the batch was dispatched from. */
  threadId: string;
  batch: BatchDelegationResult;
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
 * The three meta-tools, defined once.
 *
 * The descriptions are written for the model that has to choose between them,
 * so each says what it costs: a delegation blocks the caller until the child is
 * done, which is the fact most likely to stop an agent from reaching for it out
 * of habit. `delegate_parallel` says the other half of that — it costs no more
 * wall-clock than its slowest child, which is what makes splitting a feature up
 * worth doing rather than a way to spend four sessions on one answer.
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
  },
  {
    name: DELEGATE_PARALLEL_TOOL,
    description:
      `Hand several independent pieces of work to different roles at once. Every one of them runs at the same time in its own session, and you are paused until all of them are done — so this costs about as long as the slowest of them, not the sum. Use it when the pieces do not depend on each other; use ${DELEGATE_TASK_TOOL} when one of them needs the answer from another. At most ${MAX_CONCURRENT_DELEGATIONS} at a time. You are given every outcome together, including any that failed.`,
    inputSchema: {
      type: 'object',
      properties: {
        delegations: {
          type: 'array',
          maxItems: MAX_CONCURRENT_DELEGATIONS,
          description: `The pieces of work to hand out, at most ${MAX_CONCURRENT_DELEGATIONS}. Each one goes to its own agent session.`,
          items: {
            type: 'object',
            properties: {
              role: {
                type: 'string',
                description:
                  'The engineering role this piece goes to, e.g. "Senior Backend Engineer", "Frontend Reviewer", "QA Engineer".'
              },
              task: {
                type: 'string',
                description: 'What that role should do, stated as an outcome it can verify.'
              },
              context: {
                type: 'string',
                description: 'Anything it needs that it cannot see from the repository.'
              },
              kind: {
                type: 'string',
                enum: ['TASK', 'REVIEW'],
                description:
                  'REVIEW when this piece is a critique of existing changes, which returns a PASS or NEEDS_FIX verdict. Defaults to TASK.'
              },
              criteria: {
                type: 'array',
                items: { type: 'string' },
                description: 'What a REVIEW piece must check.'
              },
              timeoutMs: {
                type: 'number',
                description: 'How long to wait before giving up on this piece.'
              }
            },
            required: ['role', 'task']
          }
        }
      },
      required: ['delegations']
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
