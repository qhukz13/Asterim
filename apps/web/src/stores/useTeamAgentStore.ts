import { create } from 'zustand';
import {
  DEFAULT_TEAM_APPROVAL_POLICY,
  TEAM_TURN_APPROVAL_EVENT,
  TEAM_TURN_CANCELLED_EVENT,
  TEAM_TURN_COMPLETED_EVENT,
  TEAM_TURN_QUEUED_EVENT,
  TEAM_TURN_STARTED_EVENT,
  isTerminalTurnStatus
} from '@asterim/shared';
import type {
  CreateTeamAgentInput,
  TeamAgent,
  TeamAgentMessage,
  TeamApprovalDecision,
  TeamApprovalPolicy,
  TeamApprovalRiskLevel,
  TeamPendingApprovalInfo,
  TeamThread,
  TeamThreadTurnState,
  TeamThreadViewer,
  TeamTurnEventPayload,
  TeamTurnQueueItem,
  TeamTurnQueueState,
  TeamTurnStatus,
  UpdateTeamAgentInput
} from '@asterim/shared';
import { getAuthHeaders } from '../utils/auth';

/**
 * Shared team agents and their collaborative threads, as the dashboard holds
 * them (P8-02, DEC-031).
 *
 * A collaborative thread is not a chat, it is a queue: several members type
 * into one transcript, and exactly one instruction at a time holds the agent
 * (P8-01). So the interesting state here is not the message list — it is
 * `activeQueueState`, which answers the two questions a member actually has
 * before they press send: is the agent busy, and how many people are ahead
 * of me.
 *
 * Two sources feed that state, and they are deliberately not equal:
 *
 *   - **REST is the snapshot.** `GET /team-threads/:id` answers with the
 *     transcript, the live queue and the durable turn history at one instant.
 *     It is what a freshly opened thread starts from.
 *   - **The socket is the authority while the page is open.** Every
 *     `team_turn:*` transition carries the turn that moved, the thread's new
 *     state, and where that turn sits in service order. The queue is rebuilt
 *     from those transitions rather than re-fetched, because a member watching
 *     their position move from #3 to #1 is the whole point of the panel.
 *
 * Where the two disagree the socket wins, which is why a background refresh —
 * the one that fetches the agent's answer after a turn completes — adopts the
 * transcript and the history but leaves the queue alone. It is a snapshot taken
 * before it arrived; treating it as authoritative would drop a turn queued
 * while it was in flight.
 *
 * Scoped to the active team (workspace) and the open thread, per
 * `blueprint/STORE_ARCHITECTURE.md`: nothing here is global, and switching
 * teams reloads rather than filters — another team's agents were never fetched.
 */

const AGENTS_BASE = '/api/v1/team-agents';
const THREADS_BASE = '/api/v1/team-threads';

/** The turn transitions the Core publishes, as the socket sees them. */
export const TEAM_TURN_EVENT_TYPES: readonly string[] = [
  TEAM_TURN_QUEUED_EVENT,
  TEAM_TURN_STARTED_EVENT,
  TEAM_TURN_COMPLETED_EVENT,
  TEAM_TURN_CANCELLED_EVENT,
  TEAM_TURN_APPROVAL_EVENT
];

/** Whether an event belongs to the team turn subsystem. */
export function isTeamTurnEvent(event: { type?: string } | null | undefined): boolean {
  return !!event?.type && TEAM_TURN_EVENT_TYPES.includes(event.type);
}

// --- Pure helpers ---

/**
 * The Core's failure, in words a team member can act on.
 *
 * The team agent routes answer with both a message and a `code`, so the code is
 * what is branched on where one exists: the two 409s mean entirely different
 * things and a shared "conflict" would tell nobody anything.
 */
export function describeTeamAgentError(
  message: string | undefined,
  status?: number,
  code?: string
): string {
  if (code === 'TURN_NOT_CANCELLABLE') {
    return 'That turn is already running, so it can no longer be withdrawn.';
  }
  if (code === 'NO_PROJECT_BOUND') {
    return 'This thread is not bound to a project, so there is no checkout for a turn to run against.';
  }
  if (status === 401) return 'Sign in to use your team’s shared agents.';
  if (status === 403) return message || 'You do not have permission to use this team agent.';
  if (status === 404) return message || 'That team agent or thread no longer exists.';
  return message || 'The request failed.';
}

/** Free-text filter over the fields a member would search an agent by. */
export function filterTeamAgents(agents: TeamAgent[], search: string): TeamAgent[] {
  const query = search.trim().toLowerCase();
  if (!query) return agents;
  return agents.filter(
    agent =>
      agent.name.toLowerCase().includes(query) ||
      agent.role.toLowerCase().includes(query) ||
      agent.description.toLowerCase().includes(query)
  );
}

export interface TurnStateTone {
  label: string;
  color: string;
  background: string;
}

/**
 * How a thread's turn state is shown.
 *
 * `AWAITING_APPROVAL` gets its own tone rather than sharing the working one:
 * both mean the lock is held and nothing behind it may start, but only one of
 * them is waiting on a person in the room, and a member deciding whether to
 * wait or to go and answer the prompt needs to be able to tell them apart.
 */
export function threadStateTone(state: TeamThreadTurnState): TurnStateTone {
  switch (state) {
    case 'PROCESSING_TURN':
      return {
        label: 'Processing turn',
        color: 'var(--color-state-working)',
        background: 'var(--color-state-working-bg)'
      };
    case 'AWAITING_APPROVAL':
      return {
        label: 'Awaiting approval',
        color: 'var(--color-state-paused)',
        background: 'var(--color-state-paused-bg)'
      };
    default:
      return {
        label: 'Idle',
        color: 'var(--color-text-secondary)',
        background: 'rgba(148, 163, 184, 0.12)'
      };
  }
}

/** How one turn's own status reads on a history row. */
export function turnStatusLabel(status: TeamTurnStatus): string {
  switch (status) {
    case 'QUEUED':
      return 'Queued';
    case 'PROCESSING':
      return 'Running';
    case 'AWAITING_APPROVAL':
      return 'Awaiting approval';
    case 'COMPLETED':
      return 'Completed';
    case 'FAILED':
      return 'Failed';
    default:
      return 'Cancelled';
  }
}

/**
 * A queued turn's place in line, as a badge.
 *
 * One-based, because `#0 in queue` means nothing to the person reading it. The
 * index passed in is the position *behind* the active turn, which is what the
 * queue array already is.
 */
export function queuePositionLabel(index: number): string {
  return `#${index + 1} in queue`;
}

/** How many turns are waiting behind whatever holds the lock. */
export function pendingTurnCount(queue: TeamTurnQueueState | null): number {
  return queue?.queuedTurns.length ?? 0;
}

/**
 * What a member is told about their wait before they submit.
 *
 * Reads the queue rather than counting a response, so it is the same sentence
 * whether the panel was just loaded or has been watching transitions for an
 * hour.
 */
export function queueWaitNotice(queue: TeamTurnQueueState | null): string | null {
  if (!queue || queue.state === 'IDLE') return null;
  const waiting = pendingTurnCount(queue);
  const who = queue.activeTurn?.userName || 'someone';
  if (waiting === 0) return `${who} is being served; your turn would run next.`;
  return `${who} is being served, with ${waiting} ${waiting === 1 ? 'turn' : 'turns'} already waiting.`;
}

/** Whoever holds the lock right now, or null when the thread is idle. */
export function activeOperator(
  queue: TeamTurnQueueState | null
): { userId: string; userName: string; startedAt?: number } | null {
  const active = queue?.activeTurn;
  if (!active) return null;
  return { userId: active.userId, userName: active.userName, startedAt: active.startedAt };
}

/** Whether an instruction can be put in the queue. */
export function canSubmitTurn(instruction: string, isSubmitting: boolean): boolean {
  return !isSubmitting && instruction.trim().length > 0;
}

/**
 * Only a turn that has not started can be withdrawn.
 *
 * The Core answers 409 for anything else, and refusing here as well is what
 * stops a member from being offered a button whose only outcome is that error.
 */
export function canCancelTurn(turn: TeamTurnQueueItem): boolean {
  return turn.status === 'QUEUED';
}

// --- Approval governance (DEC-031 § 3) ---

/**
 * The policy in force on a thread: its own override, then its agent's default.
 *
 * Unset on the thread means "whatever the agent says", not `ANY_MEMBER`, and
 * resolving it the same way the Core does is what keeps the panel from
 * promising an approval the Core will refuse.
 */
export function effectiveApprovalPolicy(
  thread: TeamThread | null,
  agent?: TeamAgent | null
): TeamApprovalPolicy {
  return thread?.approvalPolicy ?? agent?.approvalPolicy ?? DEFAULT_TEAM_APPROVAL_POLICY;
}

/** The policy as a short badge. */
export function approvalPolicyLabel(policy: TeamApprovalPolicy): string {
  switch (policy) {
    case 'ADMIN_ONLY':
      return 'Admins only';
    case 'TURN_INITIATOR':
      return 'Turn initiator';
    default:
      return 'Any member';
  }
}

/** Who the policy says may answer, in a sentence a waiting member can act on. */
export function approvalPolicyRequirement(policy: TeamApprovalPolicy): string {
  switch (policy) {
    case 'ADMIN_ONLY':
      return 'A team admin or owner has to answer this.';
    case 'TURN_INITIATOR':
      return 'The member who submitted this turn, or a team admin, has to answer it.';
    default:
      return 'Any team member who can approve agent actions may answer this.';
  }
}

/**
 * Whether this viewer may answer this turn's prompt.
 *
 * The Core decides for real — this is refused there as well, and this copy has
 * no authority. What it buys is that a viewer is not shown an Approve button
 * whose only outcome is a 403, and that somebody who *cannot* answer is told
 * who can instead of being left wondering why nothing happens.
 */
export function canResolveApproval(
  policy: TeamApprovalPolicy,
  turn: TeamTurnQueueItem | null | undefined,
  viewer: TeamThreadViewer | null | undefined
): boolean {
  if (!turn || !viewer) return false;
  if (turn.status !== 'AWAITING_APPROVAL') return false;
  // A team with no memberships at all is a single-developer workstation; its
  // one user is the owner in everything but the record.
  if (!viewer.role) return viewer.unmanaged === true;

  const admin = viewer.role === 'owner' || viewer.role === 'admin';
  if (policy === 'ADMIN_ONLY') return admin;
  if (policy === 'TURN_INITIATOR') return admin || viewer.userId === turn.userId;
  return viewer.role !== 'viewer';
}

/** The turn parked on an approval, when the thread is parked on one. */
export function awaitingApprovalTurn(queue: TeamTurnQueueState | null): TeamTurnQueueItem | null {
  if (!queue || queue.state !== 'AWAITING_APPROVAL') return null;
  return queue.activeTurn?.status === 'AWAITING_APPROVAL' ? queue.activeTurn : null;
}

/**
 * The action a parked turn is actually waiting on, when the Core said what it
 * is (P8-04, DEC-031 § 3).
 *
 * Absent on a turn parked without details — a prompt raised by something that
 * did not describe itself — and the card then falls back to the instruction,
 * because "somebody must approve this" is still worth saying.
 */
export function pendingApprovalOf(
  turn: TeamTurnQueueItem | null | undefined
): TeamPendingApprovalInfo | null {
  return turn?.pendingApproval ?? null;
}

export interface ApprovalRiskTone {
  label: string;
  color: string;
  background: string;
}

/**
 * How dangerous the Core judged the pending action, as a badge.
 *
 * Four distinct tones rather than one alarm colour: a member who sees the same
 * red on `ls` and on `rm -rf /` learns to ignore it, and the point of putting
 * the analysis on the card at all is that the difference is what they are being
 * asked to decide about.
 */
export function approvalRiskTone(risk: TeamApprovalRiskLevel | undefined): ApprovalRiskTone | null {
  switch (risk) {
    case 'critical':
      return {
        label: 'Critical risk',
        color: 'var(--color-state-error)',
        background: 'var(--color-state-error-bg)'
      };
    case 'high':
      return {
        label: 'High risk',
        color: 'var(--color-state-paused)',
        background: 'var(--color-state-paused-bg)'
      };
    case 'medium':
      return {
        label: 'Medium risk',
        color: 'var(--color-state-waiting)',
        background: 'var(--color-state-waiting-bg)'
      };
    case 'low':
      return {
        label: 'Low risk',
        color: 'var(--color-text-secondary)',
        background: 'var(--color-surface-3)'
      };
    default:
      // An analysis that never arrived is not a low-risk one, and saying so
      // would be a claim the Core did not make.
      return null;
  }
}

/** Two initials for an author badge, from whatever name the Core recorded. */
export function authorInitials(name: string | undefined): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '??';
  const words = trimmed.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Who said a transcript line, as it is labelled above the text. */
export function messageAuthorLabel(message: TeamAgentMessage, agentName?: string): string {
  if (message.role === 'assistant') return agentName || 'Team agent';
  if (message.role === 'system') return 'System';
  return message.userName || message.userId || 'Unknown member';
}

/** A system prompt as much of it as fits on a card, without cutting mid-word. */
export function systemPromptPreview(prompt: string, limit = 140): string {
  const collapsed = prompt.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= limit) return collapsed;
  const cut = collapsed.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * How long ago something happened, in the coarsest unit that is still true.
 *
 * `now` is a parameter rather than a call to `Date.now()` so the same wording
 * can be asserted without the clock moving underneath it.
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// --- Queue reduction ---

/** A queue with one turn removed, wherever it was. */
function withoutTurn(queue: TeamTurnQueueItem[], turnId: string): TeamTurnQueueItem[] {
  return queue.filter(entry => entry.id !== turnId);
}

/**
 * The turn from a transition, with the action it is parked on kept (P8-04).
 *
 * Two ways it can be missing from the turn itself and still be known: the
 * transition may carry it alongside the turn, and a turn that is *still* parked
 * keeps whatever the last transition said it was parked on. Dropping it would
 * replace a card naming `rm -rf /` with one naming nothing, which is the moment
 * a member stops reading the card.
 */
function withPendingApproval(
  base: TeamTurnQueueState,
  turn: TeamTurnQueueItem,
  payload: TeamTurnEventPayload
): TeamTurnQueueItem {
  if (turn.pendingApproval) return turn;
  const carried =
    payload.pendingApproval ??
    (turn.status === 'AWAITING_APPROVAL' && base.activeTurn?.id === turn.id
      ? base.activeTurn.pendingApproval
      : undefined);
  return carried ? { ...turn, pendingApproval: carried } : turn;
}

/**
 * One turn transition applied to a thread's queue.
 *
 * Pure, and exported, because this is the part of the store that has to be
 * right: it is what every member's sense of "whose turn is it" is rebuilt from,
 * and it is reachable in a test without a socket.
 *
 * The rules follow the lock's own (`AgentTurnLock`):
 *   - `queued` appends, unless the turn is already known — a client that
 *     submitted the turn itself has already adopted the 202's queue.
 *   - `started` promotes the turn to active and takes it out of the waiting
 *     list. It also fires when an active turn parks on an approval and again
 *     when it resumes, so it must be idempotent for the turn already active.
 *   - `completed` clears the active turn, but only when it names it: a release
 *     for a turn that has already been superseded must not free its successor.
 *   - `cancelled` only ever removes a waiting turn.
 *   - `approval_resolved` says who decided. An approval puts the turn back in
 *     flight, so it behaves like `started`; a rejection ends it, so it behaves
 *     like `completed`. Which one it is is read from the turn's own status
 *     rather than from the decision, because the turn is what the queue holds.
 */
export function applyTurnEventToQueue(
  queue: TeamTurnQueueState | null,
  eventType: string,
  payload: TeamTurnEventPayload
): TeamTurnQueueState {
  const base: TeamTurnQueueState = queue ?? {
    threadId: payload.teamThreadId,
    state: 'IDLE',
    activeTurn: null,
    queuedTurns: []
  };
  const turn = payload.turn;

  switch (eventType) {
    case TEAM_TURN_QUEUED_EVENT: {
      const known =
        base.activeTurn?.id === turn.id || base.queuedTurns.some(entry => entry.id === turn.id);
      return {
        ...base,
        state: payload.state,
        queuedTurns: known ? base.queuedTurns : [...base.queuedTurns, turn]
      };
    }
    case TEAM_TURN_APPROVAL_EVENT:
      return isTerminalTurnStatus(turn.status)
        ? {
            ...base,
            state: payload.state,
            activeTurn: base.activeTurn?.id === turn.id ? null : base.activeTurn,
            queuedTurns: withoutTurn(base.queuedTurns, turn.id)
          }
        : {
            ...base,
            state: payload.state,
            activeTurn: withPendingApproval(base, turn, payload),
            queuedTurns: withoutTurn(base.queuedTurns, turn.id)
          };
    case TEAM_TURN_STARTED_EVENT:
      return {
        ...base,
        state: payload.state,
        activeTurn: withPendingApproval(base, turn, payload),
        queuedTurns: withoutTurn(base.queuedTurns, turn.id)
      };
    case TEAM_TURN_COMPLETED_EVENT:
      return {
        ...base,
        state: payload.state,
        activeTurn: base.activeTurn?.id === turn.id ? null : base.activeTurn,
        queuedTurns: withoutTurn(base.queuedTurns, turn.id)
      };
    case TEAM_TURN_CANCELLED_EVENT:
      return {
        ...base,
        state: payload.state,
        activeTurn: base.activeTurn?.id === turn.id ? null : base.activeTurn,
        queuedTurns: withoutTurn(base.queuedTurns, turn.id)
      };
    default:
      return base;
  }
}

/** The history list with this turn's latest shape at the front. */
function mergeHistory(history: TeamTurnQueueItem[], turn: TeamTurnQueueItem): TeamTurnQueueItem[] {
  const rest = history.filter(entry => entry.id !== turn.id);
  return [turn, ...rest];
}

// --- Store ---

interface TeamAgentState {
  /** The shared agents of the team that was last fetched. */
  teamAgents: TeamAgent[];
  /** Collaborative threads by team agent id, as each agent is opened. */
  teamThreads: Record<string, TeamThread[]>;
  /** Which agent's card is expanded in the explorer. */
  activeAgentId: string | null;
  activeThread: TeamThread | null;
  activeTranscript: TeamAgentMessage[];
  activeQueueState: TeamTurnQueueState | null;
  turnHistory: TeamTurnQueueItem[];
  /**
   * Who the Core says the reader is on the open thread, and what they may do.
   *
   * Answered by `GET /team-threads/:id` rather than assembled here: a dashboard
   * that guessed its own role would either offer an approval the Core refuses
   * or hide one the member is entitled to give.
   */
  viewer: TeamThreadViewer | null;

  isLoading: boolean;
  isSaving: boolean;
  isSubmitting: boolean;
  /** The turn whose withdrawal is in flight, so only its own row shows it. */
  cancellingTurnId: string | null;
  /** The turn whose approval answer is in flight, for the same reason. */
  resolvingApprovalTurnId: string | null;
  error: string | null;
  notice: string | null;

  fetchTeamAgents: (teamId: string) => Promise<void>;
  /** One agent with its threads, which the list endpoint does not carry. */
  fetchTeamAgent: (id: string) => Promise<void>;
  createTeamAgent: (input: CreateTeamAgentInput) => Promise<TeamAgent | null>;
  updateTeamAgent: (id: string, input: UpdateTeamAgentInput) => Promise<TeamAgent | null>;
  deleteTeamAgent: (id: string) => Promise<boolean>;
  fetchTeamThread: (id: string, options?: { silent?: boolean }) => Promise<void>;
  createTeamThread: (
    agentId: string,
    input: { title: string; projectId?: string }
  ) => Promise<TeamThread | null>;
  submitTurn: (
    threadId: string,
    instruction: string,
    context?: unknown
  ) => Promise<TeamTurnQueueItem | null>;
  cancelTurn: (threadId: string, turnId: string) => Promise<boolean>;
  /** Answers the prompt a parked turn is waiting on (DEC-031 § 3). */
  resolveApproval: (
    threadId: string,
    turnId: string,
    decision: TeamApprovalDecision,
    comment?: string
  ) => Promise<boolean>;

  setActiveAgent: (id: string | null) => void;
  closeThread: () => void;
  /** Applies one `team_turn:*` transition. */
  applyTurnEvent: (eventType: string, payload: TeamTurnEventPayload) => void;
  clearError: () => void;
  clearNotice: () => void;
  reset: () => void;
}

/** Reads a response body without letting a non-JSON error page throw. */
async function readBody(res: Response): Promise<Record<string, unknown>> {
  try {
    return ((await res.json()) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

/** The message a failed response should be reported as. */
function failureOf(res: Response, body: Record<string, unknown>): string {
  return describeTeamAgentError(
    body.error as string | undefined,
    res.status,
    body.code as string | undefined
  );
}

/** A thrown request, which is the Core being unreachable rather than refusing. */
function networkFailure(err: unknown): string {
  return (err as Error)?.message || 'Could not reach the Core.';
}

/**
 * The state a fresh mount sees.
 *
 * A function rather than a shared constant, so a reset cannot hand back the
 * same array a previous team's list was built on.
 */
function emptyState() {
  return {
    teamAgents: [] as TeamAgent[],
    teamThreads: {} as Record<string, TeamThread[]>,
    activeAgentId: null,
    activeThread: null,
    activeTranscript: [] as TeamAgentMessage[],
    activeQueueState: null,
    turnHistory: [] as TeamTurnQueueItem[],
    viewer: null,
    isLoading: false,
    isSaving: false,
    isSubmitting: false,
    cancellingTurnId: null,
    resolvingApprovalTurnId: null,
    error: null,
    notice: null
  };
}

export const useTeamAgentStore = create<TeamAgentState>((set, get) => ({
  ...emptyState(),

  fetchTeamAgents: async (teamId: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${AGENTS_BASE}?teamId=${encodeURIComponent(teamId)}`, {
        headers: getAuthHeaders()
      });
      const body = await readBody(res);
      if (!res.ok) {
        // The list already on screen is left in place: a transient failure
        // should not blank a panel someone is reading.
        set({ error: failureOf(res, body), isLoading: false });
        return;
      }
      set({ teamAgents: (body.agents as TeamAgent[]) ?? [], isLoading: false });
    } catch (err) {
      set({ error: networkFailure(err), isLoading: false });
    }
  },

  fetchTeamAgent: async (id: string) => {
    try {
      const res = await fetch(`${AGENTS_BASE}/${id}`, { headers: getAuthHeaders() });
      const body = await readBody(res);
      if (!res.ok) {
        set({ error: failureOf(res, body) });
        return;
      }
      const agent = body.agent as TeamAgent | undefined;
      const threads = (body.threads as TeamThread[]) ?? [];
      set(state => ({
        teamAgents: agent
          ? state.teamAgents.some(entry => entry.id === agent.id)
            ? state.teamAgents.map(entry => (entry.id === agent.id ? agent : entry))
            : [...state.teamAgents, agent]
          : state.teamAgents,
        teamThreads: { ...state.teamThreads, [id]: threads }
      }));
    } catch (err) {
      set({ error: networkFailure(err) });
    }
  },

  createTeamAgent: async (input: CreateTeamAgentInput) => {
    set({ isSaving: true, error: null, notice: null });
    try {
      const res = await fetch(AGENTS_BASE, {
        method: 'POST',
        headers: getAuthHeaders({ json: true }),
        body: JSON.stringify(input)
      });
      const body = await readBody(res);
      if (!res.ok) {
        set({ error: failureOf(res, body), isSaving: false });
        return null;
      }
      const agent = body.agent as TeamAgent;
      set(state => ({
        teamAgents: [...state.teamAgents, agent],
        isSaving: false,
        notice: `${agent.name} is now available to everyone on the team.`
      }));
      return agent;
    } catch (err) {
      set({ error: networkFailure(err), isSaving: false });
      return null;
    }
  },

  updateTeamAgent: async (id: string, input: UpdateTeamAgentInput) => {
    set({ isSaving: true, error: null, notice: null });
    try {
      const res = await fetch(`${AGENTS_BASE}/${id}`, {
        method: 'PATCH',
        headers: getAuthHeaders({ json: true }),
        body: JSON.stringify(input)
      });
      const body = await readBody(res);
      if (!res.ok) {
        set({ error: failureOf(res, body), isSaving: false });
        return null;
      }
      const agent = body.agent as TeamAgent;
      set(state => ({
        teamAgents: state.teamAgents.map(entry => (entry.id === agent.id ? agent : entry)),
        isSaving: false,
        notice: `${agent.name} was updated for the whole team.`
      }));
      return agent;
    } catch (err) {
      set({ error: networkFailure(err), isSaving: false });
      return null;
    }
  },

  deleteTeamAgent: async (id: string) => {
    set({ isSaving: true, error: null, notice: null });
    try {
      const res = await fetch(`${AGENTS_BASE}/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        set({ error: failureOf(res, await readBody(res)), isSaving: false });
        return false;
      }
      set(state => {
        const threads = { ...state.teamThreads };
        // The Core's schema cascades the threads away with the agent, so a
        // thread still open on one that no longer exists is closed here too.
        const removed = threads[id] || [];
        delete threads[id];
        const closing = state.activeThread && removed.some(t => t.id === state.activeThread!.id);
        return {
          teamAgents: state.teamAgents.filter(entry => entry.id !== id),
          teamThreads: threads,
          activeAgentId: state.activeAgentId === id ? null : state.activeAgentId,
          activeThread: closing ? null : state.activeThread,
          activeTranscript: closing ? [] : state.activeTranscript,
          activeQueueState: closing ? null : state.activeQueueState,
          turnHistory: closing ? [] : state.turnHistory,
          viewer: closing ? null : state.viewer,
          isSaving: false,
          notice: 'The team agent and its collaborative threads were removed.'
        };
      });
      return true;
    } catch (err) {
      set({ error: networkFailure(err), isSaving: false });
      return false;
    }
  },

  fetchTeamThread: async (id: string, options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${THREADS_BASE}/${id}`, { headers: getAuthHeaders() });
      const body = await readBody(res);
      if (!res.ok) {
        set({ error: failureOf(res, body), isLoading: false });
        return;
      }
      const thread = body.thread as TeamThread;
      set(state => {
        // A response for a thread the member has since navigated away from is
        // dropped rather than adopted: the panel would otherwise fill with a
        // conversation nobody asked for.
        if (silent && state.activeThread?.id !== id) return {};
        return {
          activeThread: thread,
          viewer: (body.viewer as TeamThreadViewer | undefined) ?? state.viewer,
          activeTranscript: (body.messages as TeamAgentMessage[]) ?? [],
          // A silent refresh is a snapshot that may predate transitions the
          // socket has already applied, so it does not touch the live queue.
          activeQueueState: silent
            ? state.activeQueueState
            : ((body.queue as TeamTurnQueueState | undefined) ?? null),
          turnHistory: (body.history as TeamTurnQueueItem[]) ?? [],
          isLoading: false
        };
      });
    } catch (err) {
      set({ error: networkFailure(err), isLoading: false });
    }
  },

  createTeamThread: async (agentId: string, input: { title: string; projectId?: string }) => {
    set({ isSaving: true, error: null, notice: null });
    try {
      const res = await fetch(`${AGENTS_BASE}/${agentId}/threads`, {
        method: 'POST',
        headers: getAuthHeaders({ json: true }),
        body: JSON.stringify({ title: input.title, projectId: input.projectId })
      });
      const body = await readBody(res);
      if (!res.ok) {
        set({ error: failureOf(res, body), isSaving: false });
        return null;
      }
      const thread = body.thread as TeamThread;
      set(state => ({
        teamThreads: {
          ...state.teamThreads,
          [agentId]: [...(state.teamThreads[agentId] || []), thread]
        },
        isSaving: false
      }));
      return thread;
    } catch (err) {
      set({ error: networkFailure(err), isSaving: false });
      return null;
    }
  },

  submitTurn: async (threadId: string, instruction: string, context?: unknown) => {
    set({ isSubmitting: true, error: null, notice: null });
    try {
      const res = await fetch(`${THREADS_BASE}/${threadId}/turns`, {
        method: 'POST',
        headers: getAuthHeaders({ json: true }),
        // The author is deliberately not sent. In a shared thread the name on a
        // turn is what the whole team reads, so the Core takes it from the
        // session rather than from a body any client could compose.
        body: JSON.stringify({ instruction, context })
      });
      const body = await readBody(res);
      if (!res.ok) {
        set({ error: failureOf(res, body), isSubmitting: false });
        return null;
      }

      // 202 is the designed answer: the turn joined the queue and its outcome
      // arrives on the socket. The queue that came back with it is adopted
      // whole, because it was computed after this turn was placed and is
      // therefore ahead of anything reconstructed locally.
      const turn = body.turn as TeamTurnQueueItem;
      const queue = body.queue as TeamTurnQueueState | undefined;
      const position = body.queuePosition as number | undefined;
      set(state => ({
        activeQueueState: queue ?? state.activeQueueState,
        turnHistory: mergeHistory(state.turnHistory, turn),
        isSubmitting: false,
        notice:
          position === undefined || position <= 0
            ? 'Your instruction is being served now.'
            : `Your instruction is ${queuePositionLabel(position - 1)}.`
      }));
      return turn;
    } catch (err) {
      set({ error: networkFailure(err), isSubmitting: false });
      return null;
    }
  },

  cancelTurn: async (threadId: string, turnId: string) => {
    set({ cancellingTurnId: turnId, error: null, notice: null });
    try {
      const res = await fetch(`${THREADS_BASE}/${threadId}/turns/${turnId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      const body = await readBody(res);
      if (!res.ok) {
        set({ error: failureOf(res, body), cancellingTurnId: null });
        return false;
      }
      const turn = body.turn as TeamTurnQueueItem;
      const queue = body.queue as TeamTurnQueueState | undefined;
      set(state => ({
        activeQueueState: queue ?? state.activeQueueState,
        turnHistory: turn ? mergeHistory(state.turnHistory, turn) : state.turnHistory,
        cancellingTurnId: null,
        notice: 'The queued turn was withdrawn.'
      }));
      return true;
    } catch (err) {
      set({ error: networkFailure(err), cancellingTurnId: null });
      return false;
    }
  },

  resolveApproval: async (
    threadId: string,
    turnId: string,
    decision: TeamApprovalDecision,
    comment?: string
  ) => {
    set({ resolvingApprovalTurnId: turnId, error: null, notice: null });
    try {
      const res = await fetch(`${THREADS_BASE}/${threadId}/approvals`, {
        method: 'POST',
        headers: getAuthHeaders({ json: true }),
        // The decider is deliberately not sent, for the same reason the author
        // of a turn is not: the whole team reads who approved this.
        body: JSON.stringify({ turnId, decision, comment })
      });
      const body = await readBody(res);
      if (!res.ok) {
        set({ error: failureOf(res, body), resolvingApprovalTurnId: null });
        return false;
      }
      const turn = body.turn as TeamTurnQueueItem | undefined;
      const queue = body.queue as TeamTurnQueueState | undefined;
      set(state => ({
        activeQueueState: queue ?? state.activeQueueState,
        turnHistory: turn ? mergeHistory(state.turnHistory, turn) : state.turnHistory,
        resolvingApprovalTurnId: null,
        notice:
          decision === 'APPROVED'
            ? 'Approved. The agent is carrying on with that turn.'
            : 'Rejected. The turn was cancelled and the queue moved on.'
      }));
      // The rejection line the Core wrote into the shared transcript is not
      // carried by any event, so it is read back rather than reconstructed.
      void get().fetchTeamThread(threadId, { silent: true });
      return true;
    } catch (err) {
      set({ error: networkFailure(err), resolvingApprovalTurnId: null });
      return false;
    }
  },

  setActiveAgent: (id: string | null) => set({ activeAgentId: id }),

  closeThread: () =>
    set({
      activeThread: null,
      activeTranscript: [],
      activeQueueState: null,
      turnHistory: [],
      viewer: null
    }),

  applyTurnEvent: (eventType: string, payload: TeamTurnEventPayload) => {
    if (!payload?.teamThreadId || !payload.turn) return;

    set(state => {
      // Every thread of this agent carries a turn state, whether or not it is
      // the one open: the explorer shows which shared threads are busy, and a
      // member picking one should not have to open it to find out.
      const teamThreads = { ...state.teamThreads };
      for (const [agentId, threads] of Object.entries(teamThreads)) {
        if (!threads.some(thread => thread.id === payload.teamThreadId)) continue;
        teamThreads[agentId] = threads.map(thread =>
          thread.id === payload.teamThreadId
            ? {
                ...thread,
                status: payload.state,
                activeTurnUserId:
                  payload.state === 'IDLE' ? undefined : (payload.turn.userId ?? undefined)
              }
            : thread
        );
      }

      if (state.activeThread?.id !== payload.teamThreadId) {
        return { teamThreads };
      }

      const activeQueueState = applyTurnEventToQueue(state.activeQueueState, eventType, payload);
      return {
        teamThreads,
        activeQueueState,
        activeThread: {
          ...state.activeThread,
          status: payload.state,
          activeTurnUserId: activeQueueState.activeTurn?.userId
        },
        // A turn that is over belongs to the record, not to the queue.
        turnHistory: isTerminalTurnStatus(payload.turn.status)
          ? mergeHistory(state.turnHistory, payload.turn)
          : state.turnHistory
      };
    });

    // The agent's answer is written to the transcript by the Core as the turn
    // ends, and there is no message event to carry it, so the completion is
    // what prompts the read. Silent, so the transcript grows underneath the
    // reader rather than the panel flashing back to a loading state.
    // An approval resolution is read back for the same reason: the Core writes
    // who decided into the shared transcript, and every other member's
    // dashboard learns it from the event rather than from having clicked.
    if (
      (eventType === TEAM_TURN_COMPLETED_EVENT || eventType === TEAM_TURN_APPROVAL_EVENT) &&
      get().activeThread?.id === payload.teamThreadId
    ) {
      void get().fetchTeamThread(payload.teamThreadId, { silent: true });
    }
  },

  clearError: () => set({ error: null }),
  clearNotice: () => set({ notice: null }),
  reset: () => set(emptyState())
}));

/**
 * Routes one team turn event into the store.
 *
 * Imperative because the caller is the socket layer, which is not a component
 * and has no business subscribing. Returns whether the event was one of ours,
 * so the caller can fall through to its own handling for everything else.
 */
export function handleTeamTurnEvent(type: string, payload: unknown): boolean {
  if (!TEAM_TURN_EVENT_TYPES.includes(type)) return false;
  useTeamAgentStore.getState().applyTurnEvent(type, payload as TeamTurnEventPayload);
  return true;
}
