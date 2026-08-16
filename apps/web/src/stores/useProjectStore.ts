import { create } from 'zustand';
import {
  DELEGATION_BATCH_COMPLETED_EVENT,
  DELEGATION_CHILD_STATE_EVENT,
  DELEGATION_COMPLETED_EVENT,
  DELEGATION_PARENT_STATE_EVENT,
  DELEGATION_STARTED_EVENT
} from '@asterim/shared';
import type {
  BatchDelegationResult,
  BatchDelegationStatus,
  DelegationBatchCompletedPayload,
  DelegationChildState,
  DelegationChildStatePayload,
  DelegationChildSummary,
  DelegationCompletedPayload,
  DelegationContext,
  DelegationParentState,
  DelegationParentStatePayload,
  DelegationResult,
  DelegationStartedPayload,
  DelegationStatus,
  ParallelDelegationItem,
  VerificationPipelineReport,
  WorktreeDiff,
  WorktreeInfo,
  WorktreeMergeResult
} from '@asterim/shared';
import { getAuthHeaders, resolveBackendUrl } from '../utils/auth';

/**
 * Repository context, the thread list, and the delegation state that spans it
 * (P7-02).
 *
 * The hierarchy lives here rather than in `ThreadStore` because it is a fact
 * about the *list*: a parent and its children are separate threads, and only
 * one of them is ever the active one. `ThreadStore` owns the thread that is
 * open; asking it to also hold the parked state of a thread the user is not
 * looking at would make "active thread" mean two things.
 *
 * The live delegation maps are keyed by thread id and deliberately not merged
 * into the thread rows. A thread row is what the Core last served; the maps are
 * what the socket has said since, and keeping them apart means a refetch of the
 * list cannot quietly roll back a state the events already advanced.
 */

/** A thread as the Core serves it, carrying its delegation link. */
export interface ThreadNode {
  id: string;
  project_id: string;
  name: string;
  created_at?: string;
  parent_thread_id?: string | null;
  delegation_context_json?: string | null;
  [key: string]: unknown;
}

/** One thread in the hierarchy, with its children resolved. */
export interface ThreadTreeNode {
  thread: ThreadNode;
  /** Distance from a root thread. A root is 0. */
  depth: number;
  /** The brief this thread was created with, when it was delegated. */
  context: DelegationContext | null;
  children: ThreadTreeNode[];
}

/** How far the tree is walked before a `parent_thread_id` chain is called a cycle. */
const MAX_TREE_DEPTH = 16;

/** A child's brief, or null when the row carries none or carries nonsense. */
export function parseDelegationContext(raw: unknown): DelegationContext | null {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as DelegationContext) : null;
  } catch {
    return null;
  }
}

/**
 * The thread list as a hierarchy.
 *
 * Three cases the flat list can present that the tree must survive, because
 * `parent_thread_id` is an ordinary column and the list is a page of it:
 *
 *   - a child whose parent is not in the list (a different project, or a row
 *     the user cannot see) is shown as a root, so it is never dropped;
 *   - a cycle has no root at all, and would otherwise delete every thread in it
 *     from the sidebar. Anything the walk from the real roots never reached is
 *     adopted as a root itself, and the visited set breaks the loop one level
 *     in, so a corrupted link costs a nesting level rather than the threads;
 *   - order is the order the Core served, which is creation order, so a
 *     delegation appears under its parent in the sequence it was requested.
 */
export function buildThreadTree(threads: ThreadNode[]): ThreadTreeNode[] {
  const byId = new Map<string, ThreadNode>();
  for (const thread of threads) {
    if (thread?.id) byId.set(thread.id, thread);
  }

  const childrenOf = new Map<string, ThreadNode[]>();
  const roots: ThreadNode[] = [];

  for (const thread of threads) {
    if (!thread?.id) continue;
    const parentId = thread.parent_thread_id;
    // A thread that names itself as its parent is its own root; anything else
    // would be an infinite descent one level up from where the guard sits.
    if (parentId && parentId !== thread.id && byId.has(parentId)) {
      const siblings = childrenOf.get(parentId) || [];
      siblings.push(thread);
      childrenOf.set(parentId, siblings);
    } else {
      roots.push(thread);
    }
  }

  const visited = new Set<string>();

  const build = (thread: ThreadNode, depth: number): ThreadTreeNode => {
    visited.add(thread.id);
    const context = parseDelegationContext(thread.delegation_context_json);
    const children =
      depth >= MAX_TREE_DEPTH
        ? []
        : (childrenOf.get(thread.id) || [])
            .filter(child => !visited.has(child.id))
            .map(child => build(child, depth + 1));
    return { thread, depth, context, children };
  };

  const nodes = roots.map(root => build(root, 0));

  // Every thread the walk did not reach is in a cycle. It is shown at the top
  // level rather than dropped: a thread the user cannot see is worse than one
  // shown at the wrong indentation.
  for (const thread of threads) {
    if (thread?.id && !visited.has(thread.id)) nodes.push(build(thread, 0));
  }

  return nodes;
}

/** Every node of a tree, parents before their children. */
export function flattenThreadTree(nodes: ThreadTreeNode[]): ThreadTreeNode[] {
  const flat: ThreadTreeNode[] = [];
  const walk = (list: ThreadTreeNode[]) => {
    for (const node of list) {
      flat.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return flat;
}

/**
 * What a thread's row in the sidebar says about its state.
 *
 * The four cases are the ones a person watching a multi-agent run has to tell
 * apart at a glance: a child doing work, a parent that has stopped to wait for
 * one, something that finished, and something that did not. A review that came
 * back `NEEDS_FIX` is `completed` here rather than `failed` — the review ran,
 * and confusing "the reviewer says no" with "the reviewer crashed" would be the
 * more expensive mistake.
 */
export type ThreadStatusTone = 'running' | 'waiting' | 'completed' | 'failed' | 'idle';

export interface ThreadStatusDescriptor {
  tone: ThreadStatusTone;
  label: string;
  color: string;
  background: string;
}

const TONES: Record<ThreadStatusTone, { color: string; background: string }> = {
  running: { color: 'var(--color-state-working)', background: 'var(--color-state-working-bg)' },
  waiting: { color: 'var(--color-state-paused)', background: 'var(--color-state-paused-bg)' },
  completed: {
    color: 'var(--color-state-completed)',
    background: 'var(--color-state-completed-bg)'
  },
  failed: { color: 'var(--color-state-error)', background: 'var(--color-state-error-bg)' },
  idle: { color: 'var(--color-text-muted)', background: 'transparent' }
};

function tone(kind: ThreadStatusTone, label: string): ThreadStatusDescriptor {
  return { tone: kind, label, ...TONES[kind] };
}

/** How a delegation status reads on its own. */
export function delegationStatusTone(
  status: DelegationStatus | 'RUNNING' | undefined
): ThreadStatusDescriptor {
  switch (status) {
    case 'COMPLETED':
      return tone('completed', 'Completed');
    case 'FAILED':
      return tone('failed', 'Failed');
    case 'TIMEOUT':
      return tone('failed', 'Timed out');
    case 'RUNNING':
      return tone('running', 'Running');
    default:
      return tone('idle', 'Idle');
  }
}

/**
 * How a fan-out's overall status reads (P7-04).
 *
 * `PARTIAL_SUCCESS` takes the waiting tone rather than the failed one: some of
 * the work is done and some of it is not, which is a thing to look at, not a
 * thing that went wrong.
 */
export function batchStatusTone(
  status: BatchDelegationStatus | undefined
): ThreadStatusDescriptor {
  if (status === 'PARTIAL_SUCCESS') return tone('waiting', 'Partial success');
  return delegationStatusTone(status);
}

/**
 * The state one thread is in, from everything known about it.
 *
 * The live child state wins over the stored one: the row is what the Core last
 * wrote, and a child that is running has not been written yet.
 */
export function threadStatusTone(
  node: ThreadTreeNode,
  live: {
    parentStates: Record<string, DelegationParentState>;
    childStates: Record<string, DelegationChildState>;
  }
): ThreadStatusDescriptor {
  const childState = live.childStates[node.thread.id];
  if (childState === 'STARTING') return tone('running', 'Starting');
  if (childState === 'ACTIVE') return tone('running', 'Working');
  if (childState === 'COMPLETED') return tone('completed', 'Completed');
  if (childState === 'FAILED') return tone('failed', 'Failed');
  if (childState === 'TIMEOUT') return tone('failed', 'Timed out');

  if (live.parentStates[node.thread.id] === 'WAITING_FOR_CHILD') {
    return tone('waiting', 'Waiting on child');
  }

  if (node.context) return delegationStatusTone(node.context.status ?? 'RUNNING');
  return tone('idle', '');
}

/**
 * What one pass of the verification pipeline reads as on a badge (P8-03).
 *
 * Three states, not two, and the third is the one that matters: a report with
 * no steps in it has verified nothing, and the whole point of the subsystem is
 * that "nothing was checked" must never look like "everything passed". So it
 * takes the idle tone and says so in words, the same way `passed: false` with
 * `totalSteps: 0` says it in the contract.
 */
export function verificationStatusTone(
  report: VerificationPipelineReport | null | undefined
): ThreadStatusDescriptor {
  if (!report) return tone('idle', 'Not verified');
  if (!report.totalSteps) return tone('idle', 'No verification pipeline configured');

  const seconds = (report.durationMs / 1000).toFixed(1);
  if (report.passed) {
    return tone(
      'completed',
      `${report.passedSteps}/${report.totalSteps} verification steps passed (${seconds}s)`
    );
  }

  const broken = report.steps.filter(step => !step.passed);
  const first = broken[0];
  const why = !first
    ? 'verification failed'
    : `${first.name} failed (${first.error ? first.error : `exit ${first.exitCode}`})`;
  return tone('failed', broken.length > 1 ? `${why} +${broken.length - 1} more` : why);
}

/** How one step of a finished pipeline reads on its own row. */
export function verificationStepTone(passed: boolean): ThreadStatusDescriptor {
  return passed ? tone('completed', 'Passed') : tone('failed', 'Failed');
}

/**
 * The outcome to show for a parent thread.
 *
 * A live `delegation.completed` first, because it is the most recent thing that
 * happened. Failing that, the newest settled child on the list — which is what
 * a reload has instead of the event, and carries the same four facts the card
 * renders.
 */
export function latestOutcomeFor(
  threadId: string | null | undefined,
  outcomes: Record<string, DelegationResult>,
  children: Record<string, DelegationChildSummary[]>
): DelegationResult | null {
  if (!threadId) return null;
  const live = outcomes[threadId];
  if (live) return live;

  const settled = (children[threadId] || []).filter(child => child.status !== 'RUNNING');
  if (settled.length === 0) return null;

  const newest = settled.reduce((best, child) =>
    (child.finishedAt ?? 0) >= (best.finishedAt ?? 0) ? child : best
  );

  return {
    childThreadId: newest.threadId,
    status: newest.status as DelegationStatus,
    summary: newest.summary || '',
    output: '',
    role: newest.role,
    profileId: newest.profileId,
    depth: newest.depth,
    verdict: newest.verdict,
    finishedAt: newest.finishedAt
  };
}

/** What a sandbox changed, as the dashboard holds it. */
export interface ThreadDiffView {
  diff: string;
  changedFiles: string[];
}

/** Which sandbox lifecycle action is in flight for a thread. */
export type WorktreeAction = 'MERGING' | 'DISCARDING' | 'VERIFYING';

/** What a merge, a discard or a verification came back with. */
export interface WorktreeActionResult {
  success: boolean;
  /** Why it did not happen, in the Core's own words, when it did not. */
  error?: string;
}

interface ProjectState {
  activeProjectId: string | null;
  threads: ThreadNode[];
  gitStatus: any | null; // Represents repository status

  // --- Delegation (P7-02) ---
  /** Thread id → whether it is parked behind a child right now. */
  parentStates: Record<string, DelegationParentState>;
  /**
   * Parent thread id → every child it is waiting on, oldest first (P7-04).
   *
   * A list rather than one id because a parent can fan out to several children
   * at once, and the banner has to show all of them. A parent waiting on
   * nothing holds no key at all rather than an empty list, so "is this thread
   * delegating" stays one lookup.
   */
  pendingChildren: Record<string, string[]>;
  /** Child thread id → where that child is in its life. */
  childStates: Record<string, DelegationChildState>;
  /** Child thread id → what it was asked to do. */
  childTasks: Record<string, string>;
  /** Child thread id → the role it runs under. */
  childRoles: Record<string, string>;
  /** Parent thread id → the outcome of the delegation that just finished. */
  delegationOutcomes: Record<string, DelegationResult>;
  /** Parent thread id → the fan-out that just finished under it (P7-04). */
  batchOutcomes: Record<string, BatchDelegationResult>;
  /** Parent thread id → its children, as the Core last described them. */
  delegationChildren: Record<string, DelegationChildSummary[]>;
  /**
   * Child thread id → a cancellation is in flight for it (P7-03).
   *
   * Keyed by the child rather than by whoever asked, so the waiting banner and
   * the row in the tree — two components that never talk to each other — both
   * show the same intervention as it happens.
   */
  cancellingChildren: Record<string, boolean>;

  // --- Worktree sandboxes and verification (P8-03) ---
  /**
   * Thread id → the sandbox it ran in, or null when it has none.
   *
   * Keyed by the *child* thread, because that is what a sandbox belongs to: the
   * parent's own checkout is never the thing being merged or discarded. Null is
   * a real answer — "asked, and there is none" — and an absent key is "never
   * asked", which is what decides whether the card fetches.
   */
  threadWorktrees: Record<string, WorktreeInfo | null>;
  /** Thread id → what its sandbox changed, against the commit it branched from. */
  threadDiffs: Record<string, ThreadDiffView | null>;
  /** Thread id → the last thing the project's own checks said about it. */
  threadVerificationReports: Record<string, VerificationPipelineReport | null>;
  /**
   * Thread id → the lifecycle action in flight for its sandbox.
   *
   * One at a time per thread, and named rather than boolean: merging, throwing
   * away and re-verifying are three different things to have started, and the
   * button that is spinning has to be the one that was pressed.
   */
  worktreeActions: Record<string, WorktreeAction>;

  // Actions
  setActiveProject: (id: string | null) => void;
  setThreads: (threads: ThreadNode[]) => void;
  upsertThread: (thread: ThreadNode) => void;
  setGitStatus: (status: any) => void;

  applyDelegationStarted: (payload: DelegationStartedPayload) => void;
  applyDelegationParentState: (payload: DelegationParentStatePayload) => void;
  applyDelegationChildState: (payload: DelegationChildStatePayload) => void;
  applyDelegationCompleted: (payload: DelegationCompletedPayload) => void;
  applyDelegationBatchCompleted: (payload: DelegationBatchCompletedPayload) => void;
  /** Reads the authoritative delegation state for one thread off the Core. */
  syncDelegations: (threadId: string, backendUrl?: string | null) => Promise<void>;
  /**
   * Hands several pieces of work out at once (P7-04). Resolves to the batch the
   * Core came back with, or null when it refused; the caller shows the refusal.
   */
  delegateParallel: (
    threadId: string,
    delegations: ParallelDelegationItem[],
    backendUrl?: string | null
  ) => Promise<BatchDelegationResult | null>;
  /**
   * Stops every delegation running under one parent. Resolves to whether the
   * Core accepted it.
   */
  cancelAllDelegations: (
    threadId: string,
    reason?: string,
    backendUrl?: string | null
  ) => Promise<boolean>;
  /**
   * Stops the delegation a thread is part of. `threadId` may be the parent that
   * is waiting or the child that is running. Resolves to whether the Core
   * accepted it; the caller shows the refusal.
   */
  cancelDelegation: (
    threadId: string,
    reason?: string,
    backendUrl?: string | null
  ) => Promise<boolean>;

  /**
   * Reads the sandbox one thread ran in, and what it changed (P8-03).
   *
   * Resolves to the sandbox or to null — a thread that never had one, and a
   * thread whose sandbox has been discarded, are both null and both perfectly
   * ordinary. A read that could not be made leaves the maps alone.
   */
  fetchThreadWorktree: (
    threadId: string,
    backendUrl?: string | null
  ) => Promise<WorktreeInfo | null>;
  /**
   * Reads the last thing verification said about a thread (P8-02).
   *
   * The report travels on `delegation.completed`, which a dashboard that
   * reloaded never saw. This is how the card gets it back without running the
   * pipeline again — a thread that has never been verified answers null, which
   * is recorded as null rather than skipped.
   */
  fetchThreadVerification: (
    threadId: string,
    backendUrl?: string | null
  ) => Promise<VerificationPipelineReport | null>;
  /** Merges a sandbox into a real branch. The one action that writes to the checkout. */
  mergeThreadWorktree: (
    threadId: string,
    targetBranch?: string,
    backendUrl?: string | null
  ) => Promise<WorktreeActionResult>;
  /** Throws a sandbox away, branch and directory both. */
  discardThreadWorktree: (
    threadId: string,
    backendUrl?: string | null
  ) => Promise<WorktreeActionResult>;
  /**
   * Runs the project's own verification commands over a thread's directory on
   * demand. `steps` names discovered steps — never commands.
   */
  verifyThreadWorktree: (
    threadId: string,
    steps?: string[],
    backendUrl?: string | null
  ) => Promise<VerificationPipelineReport | null>;

  resetDelegation: () => void;
}

const emptyDelegation = () => ({
  parentStates: {} as Record<string, DelegationParentState>,
  pendingChildren: {} as Record<string, string[]>,
  childStates: {} as Record<string, DelegationChildState>,
  childTasks: {} as Record<string, string>,
  childRoles: {} as Record<string, string>,
  delegationOutcomes: {} as Record<string, DelegationResult>,
  batchOutcomes: {} as Record<string, BatchDelegationResult>,
  delegationChildren: {} as Record<string, DelegationChildSummary[]>,
  cancellingChildren: {} as Record<string, boolean>,
  threadWorktrees: {} as Record<string, WorktreeInfo | null>,
  threadDiffs: {} as Record<string, ThreadDiffView | null>,
  threadVerificationReports: {} as Record<string, VerificationPipelineReport | null>,
  worktreeActions: {} as Record<string, WorktreeAction>
});

/**
 * The sandbox evidence one finished delegation carried, folded into the maps.
 *
 * A `delegation.completed` payload already holds everything the outcome card
 * needs — the diff, the changed files, the verification report — so the card
 * renders without a fetch, and `fetchThreadWorktree` is only for the operator
 * who comes back to a thread later or who wants it re-read.
 *
 * Deliberately additive: a result with no sandbox writes nothing rather than
 * writing null, so a delegation that isolated nothing cannot erase what a
 * later on-demand read established about the same thread.
 */
function evidenceFromResult(
  state: {
    threadDiffs: Record<string, ThreadDiffView | null>;
    threadVerificationReports: Record<string, VerificationPipelineReport | null>;
  },
  result: DelegationResult | null | undefined
): Partial<Pick<ProjectState, 'threadDiffs' | 'threadVerificationReports'>> {
  const childThreadId = result?.childThreadId;
  if (!result || !childThreadId) return {};

  const patch: Partial<Pick<ProjectState, 'threadDiffs' | 'threadVerificationReports'>> = {};
  if (result.worktreePath !== undefined || result.diff !== undefined) {
    patch.threadDiffs = {
      ...state.threadDiffs,
      [childThreadId]: { diff: result.diff ?? '', changedFiles: result.changedFiles ?? [] }
    };
  }
  if (result.verificationReport) {
    patch.threadVerificationReports = {
      ...state.threadVerificationReports,
      [childThreadId]: result.verificationReport
    };
  }
  return patch;
}

/** The same record without one key, or the record itself when it had none. */
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const copy = { ...record };
  delete copy[key];
  return copy;
}

/** The pending list for one parent, with a child added and no duplicates. */
function withPendingChild(
  pending: Record<string, string[]>,
  parentThreadId: string,
  childThreadId: string
): Record<string, string[]> {
  const current = pending[parentThreadId] || [];
  if (current.includes(childThreadId)) return pending;
  return { ...pending, [parentThreadId]: [...current, childThreadId] };
}

/** The same list with a child removed, dropping the key once it is empty. */
function withoutPendingChild(
  pending: Record<string, string[]>,
  parentThreadId: string,
  childThreadId: string
): Record<string, string[]> {
  const current = pending[parentThreadId];
  if (!current) return pending;
  const next = current.filter(id => id !== childThreadId);
  const copy = { ...pending };
  if (next.length === 0) delete copy[parentThreadId];
  else copy[parentThreadId] = next;
  return copy;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  activeProjectId: null,
  threads: [],
  gitStatus: null,
  ...emptyDelegation(),

  setActiveProject: id => set({ activeProjectId: id }),
  setThreads: threads => set({ threads }),

  /**
   * Adds a thread the list has not seen, or refreshes one it has.
   *
   * A delegation creates its child on the Core, and the dashboard learns about
   * it from an event rather than a refetch. Without this the child would be
   * invisible until the next time the list was loaded — which is the whole
   * window in which watching it is interesting.
   */
  upsertThread: thread =>
    set(state => {
      if (!thread?.id) return state;
      const index = state.threads.findIndex(existing => existing.id === thread.id);
      if (index < 0) return { threads: [...state.threads, thread] };
      const next = [...state.threads];
      next[index] = { ...next[index], ...thread };
      return { threads: next };
    }),

  setGitStatus: status => set({ gitStatus: status }),

  applyDelegationStarted: payload =>
    set(state => {
      const threads = state.threads.some(thread => thread.id === payload.childThreadId)
        ? state.threads
        : [
            ...state.threads,
            {
              id: payload.childThreadId,
              project_id: payload.projectId,
              name: payload.role || 'Delegated agent',
              parent_thread_id: payload.threadId,
              delegation_context_json: JSON.stringify({
                parentThreadId: payload.threadId,
                depth: payload.depth,
                kind: payload.kind,
                taskDescription: payload.taskDescription,
                role: payload.role,
                profileId: payload.profileId,
                requestedAt: Date.now()
              } satisfies DelegationContext)
            }
          ];

      return {
        threads,
        childStates: { ...state.childStates, [payload.childThreadId]: 'STARTING' },
        childTasks: { ...state.childTasks, [payload.childThreadId]: payload.taskDescription },
        childRoles: payload.role
          ? { ...state.childRoles, [payload.childThreadId]: payload.role }
          : state.childRoles,
        pendingChildren: withPendingChild(
          state.pendingChildren,
          payload.threadId,
          payload.childThreadId
        )
      };
    }),

  applyDelegationParentState: payload =>
    set(state => {
      // A parent is parked once per child, so `WAITING_FOR_CHILD` adds to the
      // list rather than replacing it; the single release at the end of a
      // delegation — or of a whole batch — is what clears it.
      const pendingChildren =
        payload.state === 'WAITING_FOR_CHILD' && payload.childThreadId
          ? withPendingChild(state.pendingChildren, payload.threadId, payload.childThreadId)
          : omitKey(state.pendingChildren, payload.threadId);

      return {
        parentStates: { ...state.parentStates, [payload.threadId]: payload.state },
        pendingChildren
      };
    }),

  applyDelegationChildState: payload =>
    set(state => ({
      childStates: { ...state.childStates, [payload.threadId]: payload.state }
    })),

  applyDelegationCompleted: payload =>
    set(state => {
      // Only this child stops being pending. A parent that fanned out is still
      // waiting on its siblings, and clearing the whole list here would make
      // the banner vanish while three agents were still working.
      const pendingChildren = withoutPendingChild(
        state.pendingChildren,
        payload.threadId,
        payload.result.childThreadId
      );
      const stillWaiting = (pendingChildren[payload.threadId] || []).length > 0;

      // The stored brief is updated in place so the tree reads the same after a
      // reload as it does now, without waiting for the list to be refetched.
      const threads = state.threads.map(thread => {
        if (thread.id !== payload.result.childThreadId) return thread;
        const context = parseDelegationContext(thread.delegation_context_json);
        if (!context) return thread;
        return {
          ...thread,
          delegation_context_json: JSON.stringify({
            ...context,
            status: payload.result.status,
            summary: payload.result.summary,
            verdict: payload.result.verdict,
            finishedAt: payload.result.finishedAt
          } satisfies DelegationContext)
        };
      });

      return {
        threads,
        pendingChildren,
        parentStates: stillWaiting
          ? state.parentStates
          : { ...state.parentStates, [payload.threadId]: 'ACTIVE' },
        childStates: {
          ...state.childStates,
          [payload.result.childThreadId]: payload.result.status
        },
        delegationOutcomes: { ...state.delegationOutcomes, [payload.threadId]: payload.result },
        // The diff and the verification report travel on the payload (P8-01,
        // P8-02), so the outcome card has its evidence without asking for it.
        ...evidenceFromResult(state, payload.result)
      };
    }),

  /**
   * The fan-out that just finished, kept whole (P7-04).
   *
   * It arrives after one `delegation.completed` per child, so every per-child
   * fact is already in the maps; what this adds is the grouping — which
   * outcomes were one batch, and the one verdict over them — which nothing else
   * on the socket can say. The single-outcome card is cleared for this parent so
   * the last child of a batch does not render twice, once alone and once inside
   * the batch it belonged to.
   */
  applyDelegationBatchCompleted: payload =>
    set(state => {
      // Every child's evidence, folded in one at a time so a batch that arrived
      // without its per-child events — the `delegateParallel` response beating
      // the socket — still fills the maps the cards read.
      let threadDiffs = state.threadDiffs;
      let threadVerificationReports = state.threadVerificationReports;
      for (const result of payload.batch?.results || []) {
        const patch = evidenceFromResult({ threadDiffs, threadVerificationReports }, result);
        threadDiffs = patch.threadDiffs ?? threadDiffs;
        threadVerificationReports = patch.threadVerificationReports ?? threadVerificationReports;
      }

      return {
        batchOutcomes: { ...state.batchOutcomes, [payload.threadId]: payload.batch },
        delegationOutcomes: omitKey(state.delegationOutcomes, payload.threadId),
        parentStates: { ...state.parentStates, [payload.threadId]: 'ACTIVE' },
        pendingChildren: omitKey(state.pendingChildren, payload.threadId),
        threadDiffs,
        threadVerificationReports
      };
    }),

  syncDelegations: async (threadId, backendUrl) => {
    if (!threadId) return;
    const base = resolveBackendUrl(backendUrl) || '';
    try {
      const res = await fetch(
        `${base}/api/v1/threads/${encodeURIComponent(threadId)}/children`,
        { headers: getAuthHeaders({ backendUrl }) }
      );
      if (!res.ok) return;
      const body = (await res.json()) as {
        parentState?: DelegationParentState;
        pendingChildThreadId?: string;
        pendingChildThreadIds?: string[];
        children?: DelegationChildSummary[];
      };

      set(state => {
        const children = body.children || [];
        const childStates = { ...state.childStates };
        const childTasks = { ...state.childTasks };
        const childRoles = { ...state.childRoles };
        for (const child of children) {
          // A child the Core still calls RUNNING is only really running if no
          // event has said otherwise since; the socket is ahead of this read.
          if (child.status !== 'RUNNING' || !childStates[child.threadId]) {
            childStates[child.threadId] =
              child.status === 'RUNNING' ? 'ACTIVE' : (child.status as DelegationChildState);
          }
          if (child.taskDescription) childTasks[child.threadId] = child.taskDescription;
          if (child.role) childRoles[child.threadId] = child.role;
        }

        // A Core that predates P7-04 sends the single id and no list; one that
        // does not sends both, and the list is the whole answer.
        const pending =
          body.pendingChildThreadIds && body.pendingChildThreadIds.length > 0
            ? body.pendingChildThreadIds
            : body.pendingChildThreadId
              ? [body.pendingChildThreadId]
              : [];
        const pendingChildren =
          pending.length > 0
            ? { ...state.pendingChildren, [threadId]: pending }
            : omitKey(state.pendingChildren, threadId);

        return {
          parentStates: { ...state.parentStates, [threadId]: body.parentState || 'ACTIVE' },
          pendingChildren,
          childStates,
          childTasks,
          childRoles,
          delegationChildren: { ...state.delegationChildren, [threadId]: children }
        };
      });
    } catch {
      // A workstation that cannot be reached is already reported by the socket's
      // own disconnect banner; failing to read a hierarchy is not a second error
      // worth putting in front of the user.
    }
  },

  /**
   * Asks the Core to stop a running delegation (P7-03).
   *
   * Unlike `POST /delegate`, this one answers quickly, and it answers with the
   * outcome the delegation settled as. That outcome is applied here rather than
   * only waited for on the socket: the operator clicked a button and is owed
   * the banner clearing, whether or not the event beat the response back.
   * Applying it twice is idempotent — both paths write the same terminal state.
   */
  cancelDelegation: async (threadId, reason, backendUrl) => {
    if (!threadId) return false;

    // Cancelling from the waiting banner names the parent; cancelling from the
    // tree, or from one row of a fan-out, names the child. The spinner belongs
    // on the child either way — and a parent with several children running is
    // addressed by whichever the Core will stop, which is the oldest.
    const pendingChild = (get().pendingChildren[threadId] || [])[0];
    const childThreadId = pendingChild || threadId;
    set(state => ({
      cancellingChildren: { ...state.cancellingChildren, [childThreadId]: true }
    }));

    const base = resolveBackendUrl(backendUrl) || '';
    try {
      const res = await fetch(
        `${base}/api/v1/threads/${encodeURIComponent(threadId)}/delegate/cancel`,
        {
          method: 'POST',
          headers: getAuthHeaders({ backendUrl, json: true }),
          body: JSON.stringify(reason ? { reason } : {})
        }
      );
      if (!res.ok) return false;

      const body = (await res.json().catch(() => null)) as { result?: DelegationResult } | null;
      const result = body?.result;
      if (result) {
        const projectId = get().activeProjectId || '';
        if (pendingChild) {
          get().applyDelegationCompleted({ projectId, threadId, result });
        } else {
          // Cancelled by child id, so which thread was parked behind it is not
          // known here. The child's own terminal state is; the parent's release
          // arrives on `delegation.parent_state`.
          get().applyDelegationChildState({
            projectId,
            threadId: result.childThreadId,
            parentThreadId: '',
            state: result.status
          });
        }
      }
      return true;
    } catch {
      return false;
    } finally {
      set(state => {
        const cancellingChildren = { ...state.cancellingChildren };
        delete cancellingChildren[childThreadId];
        return { cancellingChildren };
      });
    }
  },

  /**
   * Hands several pieces of work out at once (P7-04).
   *
   * Like `POST /delegate`, this request is held open by the Core until every
   * child is done, so the caller is expected to leave it running while the
   * banner — driven by the socket, not by this promise — shows what is
   * happening. The batch is applied here as well as on the socket for the same
   * reason a cancellation is: whichever arrives first is the one that renders.
   */
  delegateParallel: async (threadId, delegations, backendUrl) => {
    if (!threadId || !Array.isArray(delegations) || delegations.length === 0) return null;

    const base = resolveBackendUrl(backendUrl) || '';
    try {
      const res = await fetch(
        `${base}/api/v1/threads/${encodeURIComponent(threadId)}/delegate/parallel`,
        {
          method: 'POST',
          headers: getAuthHeaders({ backendUrl, json: true }),
          body: JSON.stringify({ delegations })
        }
      );
      if (!res.ok) return null;

      const body = (await res.json().catch(() => null)) as {
        batch?: BatchDelegationResult;
      } | null;
      const batch = body?.batch;
      if (!batch) return null;

      get().applyDelegationBatchCompleted({
        projectId: get().activeProjectId || '',
        threadId,
        batch
      });
      return batch;
    } catch {
      return null;
    }
  },

  /**
   * Stops every delegation running under one parent (P7-04).
   *
   * Each child is marked as cancelling for as long as the request is in flight,
   * so every row of the banner and every row of the tree dims at once rather
   * than one of them standing in for the batch.
   */
  cancelAllDelegations: async (threadId, reason, backendUrl) => {
    if (!threadId) return false;

    const pending = get().pendingChildren[threadId] || [];
    set(state => {
      const cancellingChildren = { ...state.cancellingChildren };
      for (const childThreadId of pending) cancellingChildren[childThreadId] = true;
      return { cancellingChildren };
    });

    const base = resolveBackendUrl(backendUrl) || '';
    try {
      const res = await fetch(
        `${base}/api/v1/threads/${encodeURIComponent(threadId)}/delegate/cancel-all`,
        {
          method: 'POST',
          headers: getAuthHeaders({ backendUrl, json: true }),
          body: JSON.stringify(reason ? { reason } : {})
        }
      );
      if (!res.ok) return false;

      const body = (await res.json().catch(() => null)) as {
        results?: DelegationResult[];
      } | null;
      const projectId = get().activeProjectId || '';
      for (const result of body?.results || []) {
        get().applyDelegationCompleted({ projectId, threadId, result });
      }
      return true;
    } catch {
      return false;
    } finally {
      set(state => {
        const cancellingChildren = { ...state.cancellingChildren };
        for (const childThreadId of pending) delete cancellingChildren[childThreadId];
        return { cancellingChildren };
      });
    }
  },

  /**
   * Reads one thread's sandbox and its diff off the Core (P8-03).
   *
   * `GET /worktree` answers 200 with `worktree: null` for a thread that has
   * none, which is written through as null rather than skipped: the card has to
   * tell "there is no sandbox" from "we have not looked yet", and an absent key
   * is the second of those.
   */
  fetchThreadWorktree: async (threadId, backendUrl) => {
    if (!threadId) return null;
    const base = resolveBackendUrl(backendUrl) || '';
    try {
      const res = await fetch(
        `${base}/api/v1/threads/${encodeURIComponent(threadId)}/worktree`,
        { headers: getAuthHeaders({ backendUrl }) }
      );
      if (!res.ok) return null;

      const body = (await res.json().catch(() => null)) as {
        worktree?: WorktreeInfo | null;
        diff?: WorktreeDiff | null;
      } | null;
      const worktree = body?.worktree ?? null;
      const changes = body?.diff ?? null;

      set(state => ({
        threadWorktrees: { ...state.threadWorktrees, [threadId]: worktree },
        threadDiffs: {
          ...state.threadDiffs,
          [threadId]: changes
            ? { diff: changes.diff || '', changedFiles: changes.changedFiles || [] }
            : null
        }
      }));
      return worktree;
    } catch {
      return null;
    }
  },

  fetchThreadVerification: async (threadId, backendUrl) => {
    if (!threadId) return null;
    const base = resolveBackendUrl(backendUrl) || '';
    try {
      const res = await fetch(
        `${base}/api/v1/threads/${encodeURIComponent(threadId)}/worktree/verify`,
        { headers: getAuthHeaders({ backendUrl }) }
      );
      if (!res.ok) return null;

      const body = (await res.json().catch(() => null)) as {
        report?: VerificationPipelineReport | null;
      } | null;
      const report = body?.report ?? null;
      set(state => ({
        threadVerificationReports: { ...state.threadVerificationReports, [threadId]: report }
      }));
      return report;
    } catch {
      return null;
    }
  },

  /**
   * Merges a sandbox back into a real branch.
   *
   * The only action in this store that writes to the operator's own checkout,
   * and the reason the card asks for a second click before calling it. A
   * conflict comes back as `merged: false` with the paths, not as an HTTP
   * failure, so both are read here and both become the same refusal string.
   */
  mergeThreadWorktree: async (threadId, targetBranch, backendUrl) => {
    if (!threadId) return { success: false, error: 'No thread to merge.' };

    set(state => ({ worktreeActions: { ...state.worktreeActions, [threadId]: 'MERGING' } }));
    const base = resolveBackendUrl(backendUrl) || '';
    try {
      const res = await fetch(
        `${base}/api/v1/threads/${encodeURIComponent(threadId)}/worktree/merge`,
        {
          method: 'POST',
          headers: getAuthHeaders({ backendUrl, json: true }),
          body: JSON.stringify(targetBranch ? { targetBranch } : {})
        }
      );
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        result?: WorktreeMergeResult;
      } | null;

      if (!res.ok) {
        return { success: false, error: body?.error || `The merge was refused (${res.status}).` };
      }

      const result = body?.result;
      if (result && !result.merged) {
        const conflicts = result.conflicts?.length
          ? ` Conflicts: ${result.conflicts.join(', ')}.`
          : '';
        return {
          success: false,
          error: `${result.reason || 'The sandbox could not be merged.'}${conflicts}`
        };
      }

      // The sandbox is still on disk after a merge — `git worktree` keeps it
      // until it is removed — so only its status changes here.
      set(state => {
        const known = state.threadWorktrees[threadId];
        return known
          ? { threadWorktrees: { ...state.threadWorktrees, [threadId]: { ...known, status: 'MERGED' } } }
          : {};
      });
      return { success: true };
    } catch {
      return { success: false, error: 'Could not reach the workstation.' };
    } finally {
      set(state => ({ worktreeActions: omitKey(state.worktreeActions, threadId) }));
    }
  },

  /** Throws a sandbox away, and forgets everything the dashboard held about it. */
  discardThreadWorktree: async (threadId, backendUrl) => {
    if (!threadId) return { success: false, error: 'No thread to discard.' };

    set(state => ({ worktreeActions: { ...state.worktreeActions, [threadId]: 'DISCARDING' } }));
    const base = resolveBackendUrl(backendUrl) || '';
    try {
      const res = await fetch(
        `${base}/api/v1/threads/${encodeURIComponent(threadId)}/worktree`,
        { method: 'DELETE', headers: getAuthHeaders({ backendUrl, json: true }) }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        return { success: false, error: body?.error || `The sandbox could not be discarded (${res.status}).` };
      }

      set(state => ({
        threadWorktrees: { ...state.threadWorktrees, [threadId]: null },
        threadDiffs: { ...state.threadDiffs, [threadId]: null }
      }));
      return { success: true };
    } catch {
      return { success: false, error: 'Could not reach the workstation.' };
    } finally {
      set(state => ({ worktreeActions: omitKey(state.worktreeActions, threadId) }));
    }
  },

  /**
   * Runs the project's own checks again, over whatever directory the thread's
   * work is in (P8-02).
   *
   * `steps` are names the project already declares, never commands — the Core
   * refuses anything else, and sending nothing means "all of them".
   */
  verifyThreadWorktree: async (threadId, steps, backendUrl) => {
    if (!threadId) return null;

    set(state => ({ worktreeActions: { ...state.worktreeActions, [threadId]: 'VERIFYING' } }));
    const base = resolveBackendUrl(backendUrl) || '';
    try {
      const res = await fetch(
        `${base}/api/v1/threads/${encodeURIComponent(threadId)}/worktree/verify`,
        {
          method: 'POST',
          headers: getAuthHeaders({ backendUrl, json: true }),
          body: JSON.stringify(steps && steps.length > 0 ? { steps } : {})
        }
      );
      if (!res.ok) return null;

      const body = (await res.json().catch(() => null)) as {
        report?: VerificationPipelineReport;
      } | null;
      const report = body?.report ?? null;
      if (!report) return null;

      set(state => ({
        threadVerificationReports: { ...state.threadVerificationReports, [threadId]: report }
      }));
      return report;
    } catch {
      return null;
    } finally {
      set(state => ({ worktreeActions: omitKey(state.worktreeActions, threadId) }));
    }
  },

  resetDelegation: () => set(emptyDelegation())
}));

/** The events the delegation subsystem publishes, as the socket sees them. */
export const DELEGATION_EVENT_TYPES: readonly string[] = [
  DELEGATION_STARTED_EVENT,
  DELEGATION_PARENT_STATE_EVENT,
  DELEGATION_CHILD_STATE_EVENT,
  DELEGATION_COMPLETED_EVENT,
  DELEGATION_BATCH_COMPLETED_EVENT
];

/** Whether an event belongs to the delegation subsystem. */
export function isDelegationEvent(event: { type?: string } | null | undefined): boolean {
  return !!event?.type && DELEGATION_EVENT_TYPES.includes(event.type);
}

/**
 * Routes one delegation event into the store.
 *
 * Imperative because the caller is the socket layer, which is not a component
 * and has no business subscribing. Returns whether the event was one of ours,
 * so the caller can fall through to its own handling for everything else.
 */
export function handleDelegationEvent(type: string, payload: unknown): boolean {
  const store = useProjectStore.getState();
  switch (type) {
    case DELEGATION_STARTED_EVENT:
      store.applyDelegationStarted(payload as DelegationStartedPayload);
      return true;
    case DELEGATION_PARENT_STATE_EVENT:
      store.applyDelegationParentState(payload as DelegationParentStatePayload);
      return true;
    case DELEGATION_CHILD_STATE_EVENT:
      store.applyDelegationChildState(payload as DelegationChildStatePayload);
      return true;
    case DELEGATION_COMPLETED_EVENT:
      store.applyDelegationCompleted(payload as DelegationCompletedPayload);
      return true;
    case DELEGATION_BATCH_COMPLETED_EVENT:
      store.applyDelegationBatchCompleted(payload as DelegationBatchCompletedPayload);
      return true;
    default:
      return false;
  }
}
