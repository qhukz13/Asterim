/**
 * The Shared Team Agent primitive and its turn contract (P8-01, DEC-031).
 *
 * A team agent is a persistent role — "Tech Lead", "Security Reviewer" — that
 * belongs to a team rather than to whoever happened to start a session. Several
 * people talk to the same one, into the same transcript, which is the whole
 * point and also the whole problem: two instructions arriving while the agent
 * is mid-generation would interleave into a transcript that reads as neither
 * conversation.
 *
 * So a collaborative thread is not a chat, it is a queue. Everything below
 * describes that queue — what a request looks like going in, what state the
 * thread is in while one is being served, and what every connected client is
 * told as it advances. These types cross the WebSocket boundary, so they live
 * here rather than being restated in the server and the dashboard.
 */

import type { WorkspaceRole } from './workspace';

/**
 * Where one queued instruction is in its life.
 *
 * `AWAITING_APPROVAL` is a turn that is still the active one — it holds the
 * lock, and nothing behind it may start — but is blocked on a human answering a
 * destructive-tool prompt (DEC-031 § 3). It is deliberately distinct from
 * `PROCESSING` so a queue inspector can say *why* nothing is moving.
 */
export type TeamTurnStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'AWAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/** Whether a queued turn is over, and can therefore never hold the lock. */
export function isTerminalTurnStatus(status: TeamTurnStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

/**
 * The turn state of a collaborative thread as a whole.
 *
 * One value per thread, derived from its active turn rather than stored
 * independently of it: a thread is `IDLE` exactly when nothing holds its lock.
 */
export type TeamThreadTurnState = 'IDLE' | 'PROCESSING_TURN' | 'AWAITING_APPROVAL';

/** Who said a line in a shared transcript. */
export type TeamAgentMessageRole = 'user' | 'assistant' | 'system';

/**
 * Who may answer the approval prompt a parked turn is waiting on (DEC-031 § 3).
 *
 * The policy is about the *answer*, never about the queue: whichever one is in
 * force, the turn keeps the lock until somebody with the standing to decide has
 * decided, because an unanswerable prompt and a thread that never moves again
 * are the same outcome for the rest of the team.
 *
 *   - `ANY_MEMBER` — anyone on the team who may approve agent actions. The
 *     default, because the common case is a room of colleagues and a prompt
 *     that only its author can clear is a prompt that waits for them to come
 *     back from lunch.
 *   - `ADMIN_ONLY` — an admin or the owner of the team. For roles whose tool
 *     calls are consequential enough that "somebody was around" is not the bar.
 *   - `TURN_INITIATOR` — whoever submitted the turn, or an admin/owner. For work
 *     where only the person who asked knows whether the action the agent
 *     proposes is the one they meant.
 */
export type TeamApprovalPolicy = 'ANY_MEMBER' | 'ADMIN_ONLY' | 'TURN_INITIATOR';

/** What a thread falls back to when neither it nor its agent names a policy. */
export const DEFAULT_TEAM_APPROVAL_POLICY: TeamApprovalPolicy = 'ANY_MEMBER';

/** Runtime companion to {@link TeamApprovalPolicy}, which erases at compile time. */
export const TEAM_APPROVAL_POLICIES: readonly TeamApprovalPolicy[] = [
  'ANY_MEMBER',
  'ADMIN_ONLY',
  'TURN_INITIATOR'
];

/** Whether a value is one of the three policies the contract defines. */
export function isTeamApprovalPolicy(value: unknown): value is TeamApprovalPolicy {
  return (
    typeof value === 'string' && (TEAM_APPROVAL_POLICIES as readonly string[]).includes(value)
  );
}

/** The two answers an approval prompt accepts. */
export type TeamApprovalDecision = 'APPROVED' | 'REJECTED';

/**
 * A persistent shared agent identity.
 *
 * The capability lists mirror `AgentProfile`: `undefined` means "unset, allow
 * whatever the workstation allows", and an empty array means "deliberately
 * nothing". They are not the same and must not decay into one another.
 */
export interface TeamAgent {
  id: string;
  /** The team (workspace) this agent belongs to. Shared by every member of it. */
  teamId: string;
  name: string;
  /** The short role label, e.g. `security-reviewer`. */
  role: string;
  description: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  enabledMcpServers?: string[];
  enabledSkills?: string[];
  /** Who may answer this role's approval prompts. Defaults to `ANY_MEMBER`. */
  approvalPolicy?: TeamApprovalPolicy;
  /** The user id that created it, when one is known. */
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

/** What creating a team agent needs, and what it may optionally be given. */
export interface CreateTeamAgentInput {
  teamId: string;
  name: string;
  role: string;
  description?: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  enabledMcpServers?: string[];
  enabledSkills?: string[];
  approvalPolicy?: TeamApprovalPolicy;
  createdBy?: string;
}

/** Every field of a team agent that may be changed after it exists. */
export interface UpdateTeamAgentInput {
  name?: string;
  role?: string;
  description?: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  enabledMcpServers?: string[];
  enabledSkills?: string[];
  approvalPolicy?: TeamApprovalPolicy;
}

/**
 * One shared conversation with a team agent.
 *
 * `projectId` binds the thread to a working directory, which is what lets a
 * turn actually run: the agent executes on the host workstation against a real
 * checkout (DEC-032 § 1). A thread without one is a transcript that can be read
 * and queued into, but not served.
 */
export interface TeamThread {
  id: string;
  teamAgentId: string;
  /** The project whose checkout turns run against, when the thread is bound to one. */
  projectId?: string;
  title: string;
  status: TeamThreadTurnState;
  /** Whose turn is being served right now, or `undefined` when the thread is idle. */
  activeTurnUserId?: string;
  /**
   * This conversation's approval policy, when it overrides its agent's.
   *
   * Unset is not `ANY_MEMBER`: it means "whatever the agent says", and the
   * agent is what a team configured once for every thread it opens. Collapsing
   * the two would silently loosen an `ADMIN_ONLY` role the moment somebody
   * opened a new thread on it.
   */
  approvalPolicy?: TeamApprovalPolicy;
  createdAt: number;
  updatedAt: number;
}

/** What a team member submits when they want the shared agent to do something. */
export interface TeamTurnRequest {
  teamThreadId: string;
  userId: string;
  userName: string;
  instruction: string;
  /** Anything the caller wants carried alongside the instruction. Stored as JSON. */
  context?: unknown;
}

/** A submitted instruction, as it sits in the queue. */
export interface TeamTurnQueueItem {
  id: string;
  teamThreadId: string;
  userId: string;
  userName: string;
  instruction: string;
  context?: unknown;
  status: TeamTurnStatus;
  queuedAt: number;
  startedAt?: number;
  completedAt?: number;
  errorMessage?: string;
  /** How this turn's approval prompt was answered, once one was answered. */
  approval?: TeamTurnApprovalRecord;
}

/**
 * The answer a parked turn was released or cancelled on.
 *
 * Kept on the turn rather than only in the transcript because governance is a
 * question asked after the fact — "who let the agent do that" — and a
 * transcript line is prose, while this is the record.
 */
export interface TeamTurnApprovalRecord {
  decision: TeamApprovalDecision;
  /** The policy that was in force when it was answered. */
  policy: TeamApprovalPolicy;
  /** The user id that answered. */
  resolvedBy: string;
  resolvedByName?: string;
  comment?: string;
  resolvedAt: number;
}

/** One line of a shared transcript. */
export interface TeamAgentMessage {
  id: string;
  teamThreadId: string;
  /** Absent on the agent's own lines: they belong to the thread, not a person. */
  userId?: string;
  userName?: string;
  role: TeamAgentMessageRole;
  content: string;
  /** Whatever tool activity produced this line, verbatim from the adapter. */
  toolCalls?: unknown;
  createdAt: number;
}

/**
 * A thread's queue, as anything outside the lock sees it.
 *
 * `queuedTurns` is in service order — index 0 runs next — because the order is
 * the guarantee this subsystem exists to make, and a caller should not have to
 * re-derive it by sorting on `queuedAt`.
 */
export interface TeamTurnQueueState {
  threadId: string;
  state: TeamThreadTurnState;
  activeTurn: TeamTurnQueueItem | null;
  queuedTurns: TeamTurnQueueItem[];
}

/** What a turn ended up as, returned to whoever submitted it. */
export interface TeamTurnResult {
  turnId: string;
  teamThreadId: string;
  status: TeamTurnStatus;
  /** What the agent said, when it said anything. */
  output?: string;
  /** Why it did not finish, when it did not. */
  errorMessage?: string;
  /** How long it held the lock, in milliseconds. */
  durationMs?: number;
}

// --- Approval governance (DEC-031 § 3) ---

/** What a member sends to answer the prompt a parked turn is waiting on. */
export interface TeamTurnApprovalRequest {
  turnId: string;
  decision: TeamApprovalDecision;
  /** Why, in the answerer's words. Written into the shared transcript. */
  comment?: string;
}

/** What answering an approval prompt produced. */
export interface TeamTurnApprovalResult {
  teamThreadId: string;
  turn: TeamTurnQueueItem;
  approval: TeamTurnApprovalRecord;
  /** The thread's turn state after the answer was applied. */
  state: TeamThreadTurnState;
}

/**
 * Who the Core says the caller is, on the thread they just read.
 *
 * Answered by the Core rather than assembled by the dashboard: a client cannot
 * be trusted to know its own role, and a client that guessed would either offer
 * a button that 403s or hide one the member is entitled to.
 */
export interface TeamThreadViewer {
  userId: string;
  /**
   * The caller's role in the team, or `null` when the team has no membership
   * rows at all — a workstation that predates RBAC, which is the normal shape
   * of a single-developer install (DEC-028).
   */
  role: WorkspaceRole | null;
  /** True when the team is unmanaged, so local single-developer use still works. */
  unmanaged: boolean;
  /** The policy in force on this thread, agent default included. */
  approvalPolicy: TeamApprovalPolicy;
  /** Whether this caller may answer an approval prompt on this thread. */
  canApprove: boolean;
  /** Whether this caller may retire or reconfigure the shared agent. */
  canAdminister: boolean;
}

// --- Socket.IO turn synchronization (DEC-031 § 2) ---

/** An instruction has joined the queue; its position is `queuePosition`. */
export const TEAM_TURN_QUEUED_EVENT = 'team_turn:queued';
/** A turn has taken the lock and the agent is now generating for it. */
export const TEAM_TURN_STARTED_EVENT = 'team_turn:started';
/** A turn has released the lock, whether it succeeded or failed. */
export const TEAM_TURN_COMPLETED_EVENT = 'team_turn:completed';
/** A queued turn was withdrawn before it ever ran. */
export const TEAM_TURN_CANCELLED_EVENT = 'team_turn:cancelled';
/**
 * Somebody answered the approval prompt a turn was parked on.
 *
 * Distinct from `started`/`completed`, which say what the *queue* did: this one
 * says who decided and what they decided, which is what the rest of the team is
 * owed when an agent is let loose on a destructive action in their repository.
 */
export const TEAM_TURN_APPROVAL_EVENT = 'team_turn:approval_resolved';

/**
 * What every turn transition carries to connected clients.
 *
 * The whole queue rides along on every transition rather than only the turn
 * that moved. A dashboard that joined mid-conversation, or missed a frame over
 * a relay tunnel, would otherwise have to ask — and the queue is small by
 * construction, because it is bounded by the number of people in the room.
 */
export interface TeamTurnEventPayload {
  teamThreadId: string;
  teamAgentId: string;
  teamId: string;
  /** The room the Core routes this to; the team id, since a team is a workspace. */
  workspaceId: string;
  /** Set when the thread is bound to a project, so project rooms see it too. */
  projectId?: string;
  turn: TeamTurnQueueItem;
  state: TeamThreadTurnState;
  /**
   * Where this turn sits in service order at the moment of the transition:
   * 0 is the turn holding the lock, 1 is next, and so on. `-1` once the turn is
   * no longer in the order at all — which is every `completed` and `cancelled`
   * event, since both fire after the turn has left the queue.
   */
  queuePosition: number;
  /** How many turns are still waiting behind the active one. */
  queueLength: number;
}

/**
 * What {@link TEAM_TURN_APPROVAL_EVENT} carries on top of a turn transition.
 *
 * A superset of the ordinary payload, so a client that only understands the
 * queue can treat it as one more transition, while a client that understands
 * governance can also say who decided.
 */
export interface TeamTurnApprovalEventPayload extends TeamTurnEventPayload {
  approval: TeamTurnApprovalRecord;
}
