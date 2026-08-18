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
