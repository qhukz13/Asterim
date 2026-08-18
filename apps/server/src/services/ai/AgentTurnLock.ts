/**
 * The Turn Concurrency Engine (P8-01, DEC-031 § 2).
 *
 * A shared team agent has one transcript and several people typing into it. The
 * failure that makes shared agents unusable is not a lost message — it is two
 * instructions arriving while the agent is mid-generation, producing a
 * transcript in which neither conversation is legible and a tool call that was
 * approved for one request runs against the other's state.
 *
 * So a collaborative thread is not a chat, it is a queue with a lock:
 *
 *   - **One turn at a time.** Exactly one turn per thread holds the lock. The
 *     next one does not start until the current one releases, whether it
 *     succeeded, failed or timed out.
 *   - **First in, first served.** Order of service is order of arrival, and it
 *     is decided at `enqueue` — synchronously, before any `await` — so two
 *     submissions racing in the same tick are ordered by which reached the
 *     queue, not by which promise the runtime happened to resume first.
 *   - **Everyone sees the same queue.** Every transition broadcasts the whole
 *     queue, so a member who joined mid-conversation or missed a frame over a
 *     relay tunnel does not have to ask.
 *
 * The lock is in-memory and per-process, which is the correct scope: the agent
 * executes on one host workstation (DEC-032 § 1), so the process that owns the
 * PTY is the only thing that can serialize access to it. `TeamAgentService`
 * mirrors each transition into `team_turn_queue` so the queue survives a
 * restart as a record, but the authority while the Core is up is here.
 *
 * Nothing in this file talks to SQLite, a socket or an agent. It is given a
 * broadcaster and told when turns start and stop, which is what lets the
 * ordering guarantees be tested without a PTY, a database or a network.
 */

import crypto from 'crypto';
import {
  TEAM_TURN_CANCELLED_EVENT,
  TEAM_TURN_COMPLETED_EVENT,
  TEAM_TURN_QUEUED_EVENT,
  TEAM_TURN_STARTED_EVENT,
  TeamThreadTurnState,
  TeamTurnEventPayload,
  TeamTurnQueueItem,
  TeamTurnQueueState,
  TeamTurnStatus
} from '@asterim/shared';
import { EventBus, eventBus } from '../EventBus';

/** What a thread's turns need to carry so a client can route them. */
export interface TurnLockThreadContext {
  teamAgentId: string;
  teamId: string;
  /** The project the thread is bound to, when it is bound to one. */
  projectId?: string;
}

/** How a turn transition reaches connected clients. */
export type TurnBroadcaster = (eventType: string, payload: TeamTurnEventPayload) => void;

/**
 * The production broadcaster: an event on the bus, which the socket bridge
 * routes to `workspace:<teamId>` — the room every member of the team is
 * already in. Going through the bus rather than reaching for Socket.IO keeps
 * this file free of the socket layer and lets a test subscribe to the same
 * events the dashboard receives.
 */
export function eventBusTurnBroadcaster(bus: EventBus = eventBus): TurnBroadcaster {
  return (eventType, payload) => {
    bus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server:team-agent',
      type: eventType,
      payload
    });
  };
}

/** One thread's lock, its queue, and whoever is waiting on either. */
interface ThreadLane {
  context: TurnLockThreadContext;
  /** The turn holding the lock, or null when the thread is idle. */
  active: TeamTurnQueueItem | null;
  /** Waiting turns, in service order. Index 0 runs next. */
  queue: TeamTurnQueueItem[];
  state: TeamThreadTurnState;
  /** `acquireTurn` callers that have not been answered yet, by turn id. */
  waiters: Map<string, (granted: boolean) => void>;
}

export class AgentTurnLock {
  private lanes = new Map<string, ThreadLane>();
  private broadcast: TurnBroadcaster;

  constructor(broadcast: TurnBroadcaster = eventBusTurnBroadcaster()) {
    this.broadcast = broadcast;
  }

  /** Swaps the broadcaster. Only the test suite does this. */
  public setBroadcaster(broadcast: TurnBroadcaster): void {
    this.broadcast = broadcast;
  }

  /**
   * Puts a turn at the back of its thread's queue.
   *
   * Synchronous and total: when this returns, the turn's place in the order is
   * fixed and visible to everyone. That is the property the FIFO guarantee
   * rests on — two callers submitting in the same tick both reach this before
   * either of them awaits anything.
   *
   * Returns how many turns are ahead of it, so the caller can tell a member
   * "you are third" without asking a second question.
   */
  public enqueue(item: TeamTurnQueueItem, context: TurnLockThreadContext): number {
    const lane = this.lane(item.teamThreadId, context);
    // A fresh lane inherits the context it was created with; a later submission
    // refreshes it, because a thread that has since been bound to a project
    // should route its events there.
    lane.context = context;

    const queued: TeamTurnQueueItem = { ...item, status: 'QUEUED' };
    lane.queue.push(queued);

    this.emit(TEAM_TURN_QUEUED_EVENT, lane, queued);
    return this.positionOf(lane, queued.id);
  }

  /**
   * Resolves when this turn holds the thread's lock.
   *
   * `true` means the caller may now generate; `false` means the turn was
   * cancelled while it waited and must not run. There is no third answer: a
   * caller that gets `true` is obliged to call `releaseTurn`, and every path
   * out of a turn — success, failure, timeout — has to reach it, or the thread
   * stays locked behind a turn nobody is running.
   *
   * A turn id this lock has never seen is enqueued on the spot, so the two-step
   * `enqueue` + `acquireTurn` and the one-step `acquireTurn` both work and both
   * observe the same order.
   */
  public acquireTurn(
    threadId: string,
    turnId: string,
    context?: TurnLockThreadContext
  ): Promise<boolean> {
    const lane = this.lane(threadId, context);

    // Already holding it: the pump granted this turn before the caller got
    // round to asking. Not an error, and not a second grant.
    if (lane.active?.id === turnId) return Promise.resolve(true);

    const waiting = lane.queue.find(entry => entry.id === turnId);
    if (!waiting) {
      // Never seen, and not active. Either it was cancelled out of the queue
      // while the caller was in flight, or it was never enqueued at all. The
      // first must answer `false`; the second is a caller using the one-step
      // form, and gets a place in line.
      if (this.settled.has(turnId)) return Promise.resolve(false);
      this.enqueue(
        {
          id: turnId,
          teamThreadId: threadId,
          userId: 'unknown',
          userName: 'unknown',
          instruction: '',
          status: 'QUEUED',
          queuedAt: Date.now()
        },
        lane.context
      );
    }

    return new Promise<boolean>(resolve => {
      lane.waiters.set(turnId, resolve);
      this.pump(lane);
    });
  }

  /**
   * Hands the lock back and starts whatever is next.
   *
   * `outcome` is how the turn actually ended. It matters because the release is
   * what the room is told about: a turn that failed and was announced as
   * `COMPLETED` would show every member of the team an answer that never
   * arrived. `COMPLETED` is the default only because it is the common case.
   *
   * Idempotent, and a release naming a turn that is not the active one is
   * ignored rather than throwing: a turn that timed out and then finished would
   * otherwise release its successor's lock, which is the exact collision this
   * class exists to prevent.
   */
  public releaseTurn(
    threadId: string,
    turnId: string,
    outcome?: { status?: TeamTurnStatus; errorMessage?: string }
  ): void {
    const lane = this.lanes.get(threadId);
    if (!lane || lane.active?.id !== turnId) return;

    const finished = lane.active;
    lane.active = null;
    lane.state = 'IDLE';
    // A released turn is over, so the two states that mean "still running" are
    // not answers. Anything else the caller named is kept.
    const settledAs = outcome?.status;
    finished.status =
      settledAs && settledAs !== 'PROCESSING' && settledAs !== 'AWAITING_APPROVAL'
        ? settledAs
        : 'COMPLETED';
    if (outcome?.errorMessage) finished.errorMessage = outcome.errorMessage;
    finished.completedAt = finished.completedAt ?? Date.now();
    this.markSettled(finished.id);

    this.emit(TEAM_TURN_COMPLETED_EVENT, lane, finished);
    this.pump(lane);
  }

  /**
   * Withdraws a turn that has not started yet.
   *
   * Queued only. Cancelling the active turn is a different operation — it means
   * interrupting an agent mid-generation, which leaves a partial transcript and
   * possibly a half-executed tool call — and answering `false` here is what
   * lets the REST layer say so rather than silently corrupting a turn.
   */
  public cancelTurn(threadId: string, turnId: string): boolean {
    const lane = this.lanes.get(threadId);
    if (!lane) return false;

    const index = lane.queue.findIndex(entry => entry.id === turnId);
    if (index === -1) return false;

    const [cancelled] = lane.queue.splice(index, 1);
    cancelled.status = 'CANCELLED';
    cancelled.completedAt = Date.now();
    this.markSettled(cancelled.id);

    // Answered before the broadcast, so a caller awaiting `acquireTurn` learns
    // it must not run before anything else reacts to the cancellation.
    const waiter = lane.waiters.get(turnId);
    if (waiter) {
      lane.waiters.delete(turnId);
      waiter(false);
    }

    this.emit(TEAM_TURN_CANCELLED_EVENT, lane, cancelled);
    // Removing a queued turn cannot free the lock, but it can unblock a lane
    // whose head was the thing just cancelled.
    this.pump(lane);
    return true;
  }

  /**
   * Parks the active turn on a human decision (DEC-031 § 3).
   *
   * The lock is still held — an approval prompt is part of a turn, not a gap
   * between turns — and the state changes only so a queue inspector can say
   * why nothing is moving.
   */
  public markAwaitingApproval(threadId: string, turnId: string): boolean {
    const lane = this.lanes.get(threadId);
    if (!lane || lane.active?.id !== turnId) return false;
    lane.active.status = 'AWAITING_APPROVAL';
    lane.state = 'AWAITING_APPROVAL';
    this.emit(TEAM_TURN_STARTED_EVENT, lane, lane.active);
    return true;
  }

  /** The other half of {@link markAwaitingApproval}: the human answered. */
  public resumeFromApproval(threadId: string, turnId: string): boolean {
    const lane = this.lanes.get(threadId);
    if (!lane || lane.active?.id !== turnId) return false;
    lane.active.status = 'PROCESSING';
    lane.state = 'PROCESSING_TURN';
    this.emit(TEAM_TURN_STARTED_EVENT, lane, lane.active);
    return true;
  }

  /** The thread's queue, copied, so a caller cannot reorder it by accident. */
  public getQueueState(threadId: string): TeamTurnQueueState {
    const lane = this.lanes.get(threadId);
    if (!lane) {
      return { threadId, state: 'IDLE', activeTurn: null, queuedTurns: [] };
    }
    return {
      threadId,
      state: lane.state,
      activeTurn: lane.active ? { ...lane.active } : null,
      queuedTurns: lane.queue.map(entry => ({ ...entry }))
    };
  }

  /** Whether this thread is serving a turn, and if so in what way. */
  public getTurnState(threadId: string): TeamThreadTurnState {
    return this.lanes.get(threadId)?.state ?? 'IDLE';
  }

  /** Whoever is being served on this thread right now. */
  public getActiveUserId(threadId: string): string | undefined {
    return this.lanes.get(threadId)?.active?.userId;
  }

  /**
   * Forgets a thread entirely.
   *
   * For a thread that has been deleted, and for the test suite between
   * scenarios. Every waiter is answered `false` first: dropping a lane with
   * pending promises would leave their callers awaiting something that can
   * never resolve.
   */
  public clearThread(threadId: string): void {
    const lane = this.lanes.get(threadId);
    if (!lane) return;
    for (const [, resolve] of lane.waiters) resolve(false);
    lane.waiters.clear();
    this.lanes.delete(threadId);
  }

  /** Every thread this lock has seen. */
  public activeThreadIds(): string[] {
    return [...this.lanes.keys()];
  }

  /**
   * Turn ids that have reached a terminal state.
   *
   * Kept so that `acquireTurn` arriving after a cancellation can tell "already
   * settled, do not run" from "never submitted, get in line" — the two cases
   * are otherwise indistinguishable, and guessing wrong runs a turn a member
   * explicitly withdrew.
   *
   * Bounded, because the Core runs for weeks: only the recent past can be
   * raced against, and an unbounded set of every turn id the process has ever
   * seen is a leak with no upper bound but uptime.
   */
  private settled = new Set<string>();

  /** How many settled turn ids are remembered. */
  private static readonly SETTLED_MEMORY = 2000;

  private markSettled(turnId: string): void {
    this.settled.add(turnId);
    while (this.settled.size > AgentTurnLock.SETTLED_MEMORY) {
      // Sets iterate in insertion order, so the first entry is the oldest.
      const oldest = this.settled.values().next();
      if (oldest.done) break;
      this.settled.delete(oldest.value);
    }
  }

  private lane(threadId: string, context?: TurnLockThreadContext): ThreadLane {
    let lane = this.lanes.get(threadId);
    if (!lane) {
      lane = {
        context: context ?? { teamAgentId: '', teamId: '' },
        active: null,
        queue: [],
        state: 'IDLE',
        waiters: new Map()
      };
      this.lanes.set(threadId, lane);
    }
    return lane;
  }

  /**
   * Grants the lock to the head of the queue, if it is free.
   *
   * The head is granted whether or not its `acquireTurn` waiter has registered
   * yet: order of service is decided by the queue, and making activation wait
   * for a promise to be constructed would let a turn whose caller is a tick
   * slower be overtaken by one behind it. A caller that acquires afterwards
   * finds itself already active and is answered immediately.
   */
  private pump(lane: ThreadLane): void {
    if (lane.active) return;

    const next = lane.queue.shift();
    if (!next) return;

    next.status = 'PROCESSING';
    next.startedAt = next.startedAt ?? Date.now();
    lane.active = next;
    lane.state = 'PROCESSING_TURN';

    this.emit(TEAM_TURN_STARTED_EVENT, lane, next);

    const waiter = lane.waiters.get(next.id);
    if (waiter) {
      lane.waiters.delete(next.id);
      waiter(true);
    }
  }

  /** Where a turn sits in service order: the active turn is 0. */
  private positionOf(lane: ThreadLane, turnId: string): number {
    const order = [...(lane.active ? [lane.active] : []), ...lane.queue];
    return order.findIndex(entry => entry.id === turnId);
  }

  private emit(eventType: string, lane: ThreadLane, turn: TeamTurnQueueItem): void {
    try {
      this.broadcast(eventType, {
        teamThreadId: turn.teamThreadId,
        teamAgentId: lane.context.teamAgentId,
        teamId: lane.context.teamId,
        workspaceId: lane.context.teamId,
        projectId: lane.context.projectId,
        turn: { ...turn },
        state: lane.state,
        queuePosition: this.positionOf(lane, turn.id),
        queueLength: lane.queue.length
      });
    } catch (err) {
      // A dashboard that cannot be told is not a reason to stall the queue.
      console.warn(`[AgentTurnLock] Could not broadcast ${eventType}:`, (err as Error).message);
    }
  }
}

/** The Core's lock. One per process, because one process owns the agent. */
export const agentTurnLock = new AgentTurnLock();
