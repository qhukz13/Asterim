import { create } from 'zustand';
import {
  DELEGATION_CHILD_STATE_EVENT,
  DELEGATION_COMPLETED_EVENT,
  DELEGATION_PARENT_STATE_EVENT,
  DELEGATION_STARTED_EVENT
} from '@asterim/shared';
import type {
  DelegationChildState,
  DelegationChildStatePayload,
  DelegationChildSummary,
  DelegationCompletedPayload,
  DelegationContext,
  DelegationParentState,
  DelegationParentStatePayload,
  DelegationResult,
  DelegationStartedPayload,
  DelegationStatus
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

interface ProjectState {
  activeProjectId: string | null;
  threads: ThreadNode[];
  gitStatus: any | null; // Represents repository status

  // --- Delegation (P7-02) ---
  /** Thread id → whether it is parked behind a child right now. */
  parentStates: Record<string, DelegationParentState>;
  /** Parent thread id → the child it is waiting on. */
  pendingChildren: Record<string, string>;
  /** Child thread id → where that child is in its life. */
  childStates: Record<string, DelegationChildState>;
  /** Child thread id → what it was asked to do. */
  childTasks: Record<string, string>;
  /** Child thread id → the role it runs under. */
  childRoles: Record<string, string>;
  /** Parent thread id → the outcome of the delegation that just finished. */
  delegationOutcomes: Record<string, DelegationResult>;
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

  // Actions
  setActiveProject: (id: string | null) => void;
  setThreads: (threads: ThreadNode[]) => void;
  upsertThread: (thread: ThreadNode) => void;
  setGitStatus: (status: any) => void;

  applyDelegationStarted: (payload: DelegationStartedPayload) => void;
  applyDelegationParentState: (payload: DelegationParentStatePayload) => void;
  applyDelegationChildState: (payload: DelegationChildStatePayload) => void;
  applyDelegationCompleted: (payload: DelegationCompletedPayload) => void;
  /** Reads the authoritative delegation state for one thread off the Core. */
  syncDelegations: (threadId: string, backendUrl?: string | null) => Promise<void>;
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
  resetDelegation: () => void;
}

const emptyDelegation = () => ({
  parentStates: {} as Record<string, DelegationParentState>,
  pendingChildren: {} as Record<string, string>,
  childStates: {} as Record<string, DelegationChildState>,
  childTasks: {} as Record<string, string>,
  childRoles: {} as Record<string, string>,
  delegationOutcomes: {} as Record<string, DelegationResult>,
  delegationChildren: {} as Record<string, DelegationChildSummary[]>,
  cancellingChildren: {} as Record<string, boolean>
});

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
        pendingChildren: { ...state.pendingChildren, [payload.threadId]: payload.childThreadId }
      };
    }),

  applyDelegationParentState: payload =>
    set(state => {
      const pendingChildren = { ...state.pendingChildren };
      if (payload.state === 'WAITING_FOR_CHILD' && payload.childThreadId) {
        pendingChildren[payload.threadId] = payload.childThreadId;
      } else {
        delete pendingChildren[payload.threadId];
      }
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
      const pendingChildren = { ...state.pendingChildren };
      delete pendingChildren[payload.threadId];

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
        parentStates: { ...state.parentStates, [payload.threadId]: 'ACTIVE' },
        childStates: {
          ...state.childStates,
          [payload.result.childThreadId]: payload.result.status
        },
        delegationOutcomes: { ...state.delegationOutcomes, [payload.threadId]: payload.result }
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

        const pendingChildren = { ...state.pendingChildren };
        if (body.pendingChildThreadId) {
          pendingChildren[threadId] = body.pendingChildThreadId;
        } else {
          delete pendingChildren[threadId];
        }

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
    // tree names the child. The spinner belongs on the child either way.
    const pendingChild = get().pendingChildren[threadId];
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

  resetDelegation: () => set(emptyDelegation())
}));

/** The four events the delegation subsystem publishes, as the socket sees them. */
export const DELEGATION_EVENT_TYPES: readonly string[] = [
  DELEGATION_STARTED_EVENT,
  DELEGATION_PARENT_STATE_EVENT,
  DELEGATION_CHILD_STATE_EVENT,
  DELEGATION_COMPLETED_EVENT
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
    default:
      return false;
  }
}
