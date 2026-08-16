/**
 * Multi-Agent Handoff & Role Delegation (P7-01).
 *
 * One thread asking for a second one, and waiting. The parent names a role and
 * describes the work; this creates a child thread hanging from it, starts a
 * session under that role's profile, watches the child's own events go past on
 * the EventBus, and writes the outcome back into the parent's session as text.
 *
 * Three things shape the design:
 *
 * **The child is an ordinary thread.** It is started the same way the dashboard
 * starts one — a `client.command` on the bus — so it inherits every guarantee
 * that path already has, including the sanitized environment `ProcessManager`
 * builds for an agent subprocess. Nothing here spawns a process itself, and
 * nothing here passes the parent's environment to a child.
 *
 * **Completion is observed, not reported.** A CLI agent driven over a PTY has no
 * way to say "I am finished"; what it has is a transcript and a status. So a
 * child is done when it has produced output and then gone idle, and the brief
 * asks it to close with a `SUMMARY:` line so the parent gets an answer rather
 * than a wall of terminal.
 *
 * **The parent is always released.** A crash, a timeout and a refusal all end
 * with the parent resumed and told what happened. A parent left parked behind a
 * child that never finished is worse than a parent told the child failed.
 *
 * The session mechanics sit behind `DelegationSessionRunner` so the lifecycle
 * can be exercised without a PTY: the tests substitute a runner that plays a
 * child's events onto the real bus, which is the part worth asserting.
 */

import crypto from 'crypto';
import {
  AgentProfile,
  DEFAULT_DELEGATION_TIMEOUT_MS,
  DEFAULT_REVIEW_ROLE,
  DELEGATION_CHILD_STATE_EVENT,
  DELEGATION_COMPLETED_EVENT,
  DELEGATION_PARENT_STATE_EVENT,
  DELEGATION_STARTED_EVENT,
  DelegationChildState,
  DelegationChildSummary,
  DelegationContext,
  DelegationKind,
  DelegationParentState,
  DelegationRequest,
  DelegationResult,
  DelegationStatus,
  MAX_DELEGATION_DEPTH,
  MAX_DELEGATION_TIMEOUT_MS,
  REQUEST_REVIEW_TOOL,
  ReviewVerdict,
  isDelegationToolName,
  parseReviewVerdict
} from '@asterim/shared';
import { dbService } from '../DatabaseService';
import { EventBus, eventBus } from '../EventBus';
import { ProfileService, profileService } from './ProfileService';

/** How a delegation failure reads to a caller that has to answer over HTTP. */
export type DelegationErrorCode =
  | 'INVALID_INPUT'
  | 'THREAD_NOT_FOUND'
  | 'PROFILE_NOT_FOUND'
  | 'DEPTH_EXCEEDED'
  | 'ALREADY_DELEGATING'
  | 'NOT_DELEGATING';

export class DelegationError extends Error {
  constructor(
    public readonly code: DelegationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'DelegationError';
  }
}

/** Longest task description accepted, so one call cannot fill the database. */
export const MAX_TASK_CHARS = 20000;
/** Longest supporting context accepted. */
export const MAX_CONTEXT_CHARS = 60000;
/** How much of a child's transcript is carried back as `output`. */
export const MAX_OUTPUT_CHARS = 20000;
/** How much of it is carried as the `summary`, when it never wrote one. */
export const MAX_SUMMARY_CHARS = 2000;
/** How many hops the parent chain is walked before it is called a cycle. */
const MAX_CHAIN_HOPS = 64;

/** What a cancelled delegation records when the caller gave no reason (P7-03). */
export const DEFAULT_CANCELLATION_REASON = 'Delegation cancelled by operator';

/**
 * How a child session is started, fed and stopped.
 *
 * An indirection with exactly one production implementation, which is worth it
 * for what it buys: the waiting, the depth guard and the resume path can be
 * tested against a fake child that answers in milliseconds, instead of against
 * an agent CLI that may not be installed on the machine running the suite.
 */
export interface DelegationSessionRunner {
  start(params: {
    projectId: string;
    threadId: string;
    profileId?: string;
    agentType?: string;
  }): void | Promise<void>;
  send(params: { projectId: string; threadId: string; content: string }): void | Promise<void>;
  stop(params: { projectId: string; threadId: string }): void | Promise<void>;
}

/**
 * The production runner: the same three client events the dashboard sends.
 *
 * Going through the bus rather than calling `AgentService` directly keeps the
 * privileged half of session startup — the workspace check, the profile
 * resolution, the tool catalogue, the sanitized subprocess environment — in the
 * one place that already owns it.
 */
export class EventBusSessionRunner implements DelegationSessionRunner {
  constructor(private readonly bus: EventBus = eventBus) {}

  public start(params: {
    projectId: string;
    threadId: string;
    profileId?: string;
    agentType?: string;
  }): void {
    this.bus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server:delegation',
      type: 'client.command',
      payload: {
        command: 'start',
        projectId: params.projectId,
        threadId: params.threadId,
        agentType: params.agentType,
        profileId: params.profileId
      }
    });
  }

  /**
   * A chat message rather than raw stdin, on purpose. It goes through the
   * adapter's busy queue — so a brief written before the agent has finished
   * booting is delivered rather than dropped into a terminal that is not
   * reading — it starts the session if it is not running, and it lands in the
   * transcript, so a person opening the thread later sees what was asked.
   */
  public send(params: { projectId: string; threadId: string; content: string }): void {
    this.bus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server:delegation',
      type: 'client.chat_message',
      payload: {
        projectId: params.projectId,
        threadId: params.threadId,
        content: params.content
      }
    });
  }

  public stop(params: { projectId: string; threadId: string }): void {
    this.bus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server:delegation',
      type: 'client.command',
      payload: { command: 'stop', projectId: params.projectId, threadId: params.threadId }
    });
  }
}

interface ThreadRow {
  id: string;
  project_id: string;
  name: string;
  parent_thread_id: string | null;
  delegation_context_json: string | null;
  profile_id: string | null;
  created_at?: string;
}

/** How the caller wants the parent handled once the child is done. */
export interface DelegationOptions {
  /**
   * Whether to write the report into the parent's session.
   *
   * True for a delegation an operator triggered, where nothing else would tell
   * the parent. False when the caller is already returning the report to the
   * agent by another route — which the meta-tool path is, through the adapter's
   * tool-result line.
   */
  resumeParent?: boolean;
}

/** What watching a child's events produced. */
interface ChildOutcome {
  status: DelegationStatus;
  output: string;
  /** Why it failed, when it did. */
  failure?: string;
  /**
   * Whether the failure was an intervention rather than the child's own doing.
   *
   * It changes only how the outcome reads: a cancelled delegation's summary is
   * the reason it was cancelled, not that reason followed by whatever the child
   * happened to have said when it was stopped mid-sentence.
   */
  cancelled?: boolean;
}

/**
 * A delegation that is running right now (P7-03).
 *
 * `delegateTask` is one long await, so the only handle anything else has on a
 * running delegation is what it registers here before it starts waiting. That
 * is two things: a way to end the wait early, and the promise the outcome will
 * arrive on — so a cancellation does not settle the delegation itself, it asks
 * the delegation to settle and then reports what it settled as. One writer for
 * the child row, one release of the parent, one set of events, whether the
 * child finished, timed out or was stopped.
 */
interface ActiveDelegation {
  /** Which thread is running the work; the map key is the parent waiting on it. */
  childThreadId: string;
  /** The result `delegateTask` will return, once it has one. */
  settled: Promise<DelegationResult>;
  /**
   * Ends the wait with a cancellation. Absent for the moment between this
   * record being registered and the watch being armed; `cancelReason` is what
   * covers that window.
   */
  abort?: (reason: string) => void;
  /** Set by the first cancellation; later ones ride the same settle. */
  cancelReason?: string;
}

export class AgentDelegationService {
  /** Parent thread id → the child it is currently parked behind. */
  private waiting = new Map<string, string>();

  /** Parent thread id → the delegation running under it, while it runs. */
  private active = new Map<string, ActiveDelegation>();

  constructor(
    private readonly runner: DelegationSessionRunner = new EventBusSessionRunner(),
    private readonly profiles: ProfileService = profileService,
    private readonly bus: EventBus = eventBus
  ) {}

  private db() {
    return dbService.getDb();
  }

  // --- Hierarchy ------------------------------------------------------------

  /** One thread row, or null. Never throws on a database that is mid-upgrade. */
  private getThread(threadId: string): ThreadRow | null {
    if (!threadId) return null;
    try {
      const row = this.db()
        .prepare(
          `SELECT id, project_id, name, parent_thread_id, delegation_context_json, profile_id
             FROM threads WHERE id = ?`
        )
        .get(threadId) as unknown as ThreadRow | undefined;
      return row ?? null;
    } catch (err) {
      console.warn(`[Delegation] Could not read thread ${threadId}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * How far below a root thread this one sits. A root thread is 0.
   *
   * Bounded rather than recursive: `parent_thread_id` is an ordinary column and
   * nothing in SQLite stops a hand-edited row from pointing at itself. A chain
   * longer than the bound is treated as depth beyond the limit, which refuses
   * the delegation — the safe direction for a guard whose whole job is refusing.
   */
  public getDelegationDepth(threadId: string): number {
    let depth = 0;
    let current = this.getThread(threadId);
    const seen = new Set<string>();

    while (current?.parent_thread_id) {
      // A thread reached twice is a cycle, which is not a depth at all. It is
      // reported as beyond the bound so the guard refuses rather than lets a
      // corrupted row through as a shallow chain.
      if (seen.has(current.id)) return MAX_CHAIN_HOPS;
      seen.add(current.id);
      depth++;
      if (depth > MAX_CHAIN_HOPS) return MAX_CHAIN_HOPS;
      current = this.getThread(current.parent_thread_id);
    }

    return depth;
  }

  /** The delegated threads hanging directly off one thread, oldest first. */
  public listChildren(threadId: string): DelegationChildSummary[] {
    if (!threadId) return [];
    let rows: ThreadRow[];
    try {
      rows = this.db()
        .prepare(
          `SELECT id, project_id, name, parent_thread_id, delegation_context_json, profile_id
             FROM threads WHERE parent_thread_id = ? ORDER BY rowid ASC`
        )
        .all(threadId) as unknown as ThreadRow[];
    } catch (err) {
      console.warn(`[Delegation] Could not list children of ${threadId}: ${(err as Error).message}`);
      return [];
    }

    return rows.map(row => {
      const context = parseDelegationContext(row.delegation_context_json);
      return {
        threadId: row.id,
        projectId: row.project_id,
        name: row.name,
        parentThreadId: row.parent_thread_id ?? threadId,
        depth: context?.depth ?? 1,
        role: context?.role,
        profileId: context?.profileId ?? row.profile_id ?? undefined,
        kind: context?.kind ?? 'TASK',
        taskDescription: context?.taskDescription ?? '',
        // No recorded status means it never finished — either it is running now,
        // or the Core stopped while it was. Both read as RUNNING; the child's
        // own session state, not this row, is what says which.
        status: context?.status ?? 'RUNNING',
        summary: context?.summary,
        verdict: context?.verdict,
        requestedAt: context?.requestedAt ?? 0,
        finishedAt: context?.finishedAt
      };
    });
  }

  /** Whether this thread is parked behind a child right now. */
  public getParentState(threadId: string): DelegationParentState {
    return this.waiting.has(threadId) ? 'WAITING_FOR_CHILD' : 'ACTIVE';
  }

  /** The child a thread is waiting on, if it is waiting on one. */
  public getPendingChild(threadId: string): string | undefined {
    return this.waiting.get(threadId);
  }

  // --- Startup recovery -----------------------------------------------------

  /**
   * Settles children the Core stopped on top of (P7-02).
   *
   * A delegation's outcome is written when the child settles, and the waiting
   * is held in memory. So a Core that stops mid-delegation leaves a child row
   * with a brief and no `status` — which `listChildren` reports as `RUNNING`,
   * correctly, because nothing else in storage can tell a child that is running
   * now from one that was running when the process died. After a restart the
   * difference is knowable: no session survived, so every such child is over.
   *
   * They are recorded as `FAILED` rather than `TIMEOUT`. A timeout says the
   * child was given its full time and did not answer; this says it was cut off,
   * and the reason line is what tells the operator which happened. Nothing is
   * restarted — a child that was interrupted mid-edit is not a thing to silently
   * resume, and its transcript is still there for whoever wants to read it.
   *
   * Returns how many rows were settled. Never throws: a recovery pass that
   * fails must not be what stops a workstation from starting.
   */
  public recoverDelegations(reason = 'Server restarted while child was running'): number {
    // A parent parked in memory cannot outlive the process, but clearing is
    // free and makes the pass safe to call more than once.
    this.waiting.clear();
    this.active.clear();

    let rows: ThreadRow[];
    try {
      rows = this.db()
        .prepare(
          `SELECT id, project_id, name, parent_thread_id, delegation_context_json, profile_id
             FROM threads WHERE parent_thread_id IS NOT NULL`
        )
        .all() as unknown as ThreadRow[];
    } catch (err) {
      console.warn(`[Delegation] Could not scan for dangling children: ${(err as Error).message}`);
      return 0;
    }

    const finishedAt = Date.now();
    let recovered = 0;

    for (const row of rows) {
      const context = parseDelegationContext(row.delegation_context_json);
      if (context?.status) continue;

      // A child with no readable context still has to stop reading as RUNNING,
      // so one is written from what the row itself knows. The brief is left
      // empty rather than invented: an outcome may be reconstructed after the
      // fact, a task description may not.
      const settled: DelegationContext = {
        parentThreadId: context?.parentThreadId ?? row.parent_thread_id ?? '',
        depth: context?.depth ?? 1,
        kind: context?.kind ?? 'TASK',
        taskDescription: context?.taskDescription ?? '',
        inputContext: context?.inputContext,
        reviewCriteria: context?.reviewCriteria,
        role: context?.role,
        profileId: context?.profileId ?? row.profile_id ?? undefined,
        requestedAt: context?.requestedAt ?? 0,
        status: 'FAILED',
        summary: truncate(reason, MAX_SUMMARY_CHARS),
        verdict: context?.kind === 'REVIEW' ? 'NEEDS_FIX' : undefined,
        finishedAt
      };

      try {
        this.db()
          .prepare('UPDATE threads SET delegation_context_json = ? WHERE id = ?')
          .run(JSON.stringify(settled), row.id);
      } catch (err) {
        console.warn(
          `[Delegation] Could not settle dangling child ${row.id}: ${(err as Error).message}`
        );
        continue;
      }

      recovered++;
      // Published so a dashboard that reconnects to a restarted Core sees the
      // child leave its running state, rather than showing it live forever.
      this.publishChildState(
        row.project_id,
        row.id,
        settled.parentThreadId || row.parent_thread_id || '',
        'FAILED',
        reason
      );
    }

    if (recovered > 0) {
      console.log(`[Delegation] Recovered ${recovered} dangling child thread(s) after restart`);
    }
    return recovered;
  }

  // --- Delegation -----------------------------------------------------------

  /**
   * Hands one piece of work to another role and waits for the answer.
   *
   * Throws only for the things a caller can fix — a thread that does not exist,
   * a role nothing matches, a depth already at the limit. Everything after the
   * child starts comes back as a `DelegationResult`, including its crash: by
   * then a child thread exists and has a transcript, and turning that into an
   * exception would lose it.
   */
  public async delegateTask(
    request: DelegationRequest,
    options: DelegationOptions = {}
  ): Promise<DelegationResult> {
    const parentThreadId = requireText(request?.parentThreadId, 'parentThreadId', 200);
    const taskDescription = requireText(request?.taskDescription, 'taskDescription', MAX_TASK_CHARS);
    const inputContext = optionalText(request?.inputContext, 'inputContext', MAX_CONTEXT_CHARS);
    const kind: DelegationKind = request?.kind === 'REVIEW' ? 'REVIEW' : 'TASK';
    const timeoutMs = resolveTimeout(request?.timeoutMs);

    const parent = this.getThread(parentThreadId);
    if (!parent) {
      throw new DelegationError('THREAD_NOT_FOUND', `No thread with id ${parentThreadId}.`);
    }

    if (this.waiting.has(parentThreadId)) {
      throw new DelegationError(
        'ALREADY_DELEGATING',
        `Thread ${parentThreadId} is already waiting on child ${this.waiting.get(parentThreadId)}. Wait for that result before delegating again.`
      );
    }

    const depth = this.getDelegationDepth(parentThreadId) + 1;
    if (depth > MAX_DELEGATION_DEPTH) {
      throw new DelegationError(
        'DEPTH_EXCEEDED',
        `Delegation depth ${depth} exceeds the limit of ${MAX_DELEGATION_DEPTH}. Do this work yourself rather than handing it on.`
      );
    }

    const profile = this.resolveTargetProfile(request);
    const reviewCriteria = normalizeCriteria(request?.reviewCriteria);

    // Everything that can be refused has been refused; from here a child thread
    // exists and the parent is on the hook to be released.
    const context: DelegationContext = {
      parentThreadId,
      depth,
      kind,
      taskDescription,
      inputContext,
      reviewCriteria: reviewCriteria.length > 0 ? reviewCriteria : undefined,
      role: profile?.role,
      profileId: profile?.id,
      requestedAt: Date.now()
    };

    const childThreadId = this.createChildThread(parent, profile, context);
    const startedAt = Date.now();

    this.bus.publish({
      id: crypto.randomUUID(),
      timestamp: startedAt,
      source: 'server:delegation',
      type: DELEGATION_STARTED_EVENT,
      payload: {
        projectId: parent.project_id,
        threadId: parentThreadId,
        childThreadId,
        depth,
        kind,
        role: profile?.role,
        profileId: profile?.id,
        taskDescription
      }
    });

    this.setParentState(parent.project_id, parentThreadId, 'WAITING_FOR_CHILD', childThreadId);

    // Registered before the first await, so a cancellation that arrives while
    // the child is still booting has something to hold on to.
    let settle!: (result: DelegationResult) => void;
    let reject!: (err: unknown) => void;
    const settled = new Promise<DelegationResult>((resolve, fail) => {
      settle = resolve;
      reject = fail;
    });
    // Nobody awaits this unless a cancellation does, and a rejection nothing is
    // listening to would take the Core down as an unhandled rejection.
    settled.catch(() => undefined);

    const active: ActiveDelegation = { childThreadId, settled };
    this.active.set(parentThreadId, active);

    try {
      let outcome: ChildOutcome;
      try {
        outcome = await this.runChild(parent, childThreadId, profile, context, timeoutMs, active);
      } catch (err) {
        // The runner itself failed — the session never started. Still an outcome,
        // because the parent is waiting either way.
        outcome = {
          status: 'FAILED',
          output: '',
          failure: `The delegated session could not be started: ${(err as Error).message}`
        };
      }

      const result = this.buildResult(childThreadId, profile, context, outcome, startedAt);

      this.recordOutcome(childThreadId, context, result);
      // Every delegation status is also a terminal child state, by construction.
      this.publishChildState(
        parent.project_id,
        childThreadId,
        parentThreadId,
        result.status,
        result.summary
      );

      // The child's process is stopped before the parent is resumed: the parent's
      // next move may touch the same working tree, and two agents editing it at
      // once is exactly what the parent parked itself to avoid. It is also what
      // makes a cancellation mean something — the runaway child is gone by the
      // time the operator's request answers.
      await this.safeStop(parent.project_id, childThreadId);

      this.waiting.delete(parentThreadId);
      this.setParentState(parent.project_id, parentThreadId, 'ACTIVE', childThreadId);

      // The report goes into the parent's session — unless the parent asked for
      // this through a meta-tool, in which case it is already being written to
      // that session as the tool's result line, and sending it again would have
      // the agent read the same answer twice and treat the second as new work.
      if (options.resumeParent !== false) {
        await this.safeSend(parent.project_id, parentThreadId, formatDelegationReport(result));
      }

      this.bus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'server:delegation',
        type: DELEGATION_COMPLETED_EVENT,
        payload: { projectId: parent.project_id, threadId: parentThreadId, result }
      });

      settle(result);
      return result;
    } catch (err) {
      reject(err);
      throw err;
    } finally {
      this.active.delete(parentThreadId);
    }
  }

  // --- Cancellation (P7-03) ---------------------------------------------------

  /**
   * Stops a running delegation and gives the parent its thread back.
   *
   * Addressable from either end: an operator watching the parent's waiting
   * banner names the parent, an operator looking at a runaway child in the tree
   * names the child, and both mean the same delegation.
   *
   * It does not settle anything itself. It ends the wait and then returns what
   * `delegateTask` settled as — which is what keeps a cancellation from being a
   * second, competing writer of the child's row, a second release of the
   * parent, and a second set of terminal events. The child's process is stopped
   * on that same path, before the parent is resumed.
   *
   * Idempotent in the two ways it has to be. Two cancellations racing each other
   * both wait on the one settle and get the same result; a cancellation that
   * arrives after the child already finished answers with what it finished as,
   * rather than failing because it lost by a few milliseconds.
   */
  public async cancelDelegation(threadId: string, reason?: string): Promise<DelegationResult> {
    const id = requireText(threadId, 'threadId', 200);
    const why = optionalText(reason, 'reason', MAX_SUMMARY_CHARS) || DEFAULT_CANCELLATION_REASON;

    const thread = this.getThread(id);
    if (!thread) {
      throw new DelegationError('THREAD_NOT_FOUND', `No thread with id ${id}.`);
    }

    const active = this.active.get(id) ?? this.findActiveByChild(id);
    if (active) {
      // The first cancellation owns the reason; a second one would otherwise
      // overwrite it after the outcome had already been built from it.
      if (!active.cancelReason) {
        active.cancelReason = why;
        // Absent only in the window before the watch is armed, which the
        // reason recorded above is what closes.
        active.abort?.(why);
      }
      return active.settled;
    }

    // Nothing running under this thread. A child that has already settled
    // answers with its own outcome, so a cancel that lost the race reads the
    // same as one that won it.
    const alreadySettled = this.settledResultFor(thread);
    if (alreadySettled) return alreadySettled;

    throw new DelegationError(
      'NOT_DELEGATING',
      `Thread ${id} is not waiting on a delegated agent and is not one itself.`
    );
  }

  /** The running delegation whose child is this thread, if there is one. */
  private findActiveByChild(childThreadId: string): ActiveDelegation | undefined {
    for (const entry of this.active.values()) {
      if (entry.childThreadId === childThreadId) return entry;
    }
    return undefined;
  }

  /** A finished child's row, read back as the result it settled as. */
  private settledResultFor(row: ThreadRow): DelegationResult | null {
    const context = parseDelegationContext(row.delegation_context_json);
    if (!context?.status) return null;
    return {
      childThreadId: row.id,
      status: context.status,
      // The transcript is not reconstructed: it lives in the child's thread,
      // and a caller that wants it opens that thread.
      output: '',
      summary: context.summary ?? '',
      role: context.role,
      profileId: context.profileId ?? row.profile_id ?? undefined,
      depth: context.depth,
      verdict: context.verdict,
      startedAt: context.requestedAt,
      finishedAt: context.finishedAt
    };
  }

  /**
   * Sends changes to a reviewer role and reads the answer as a verdict.
   *
   * A thin shape over `delegateTask`: same lifecycle, a brief written for
   * critique rather than implementation, and an outcome that is not merely
   * "the session ended" but PASS or NEEDS_FIX.
   */
  public async requestReview(
    params: {
      parentThreadId: string;
      diff: string;
      criteria?: string[];
      role?: string;
      profileId?: string;
      timeoutMs?: number;
    },
    options: DelegationOptions = {}
  ): Promise<DelegationResult> {
    const diff = requireText(params?.diff, 'diff', MAX_CONTEXT_CHARS);
    return this.delegateTask(
      {
        parentThreadId: params?.parentThreadId,
        targetRole: params?.role || DEFAULT_REVIEW_ROLE,
        profileId: params?.profileId,
        kind: 'REVIEW',
        taskDescription:
          'Review the changes below against the criteria given. Report findings; do not rewrite the feature.',
        inputContext: diff,
        reviewCriteria: params?.criteria,
        timeoutMs: params?.timeoutMs
      },
      options
    );
  }

  // --- Meta-tools -----------------------------------------------------------

  /**
   * Runs `delegate_task` or `request_review` on behalf of an agent.
   *
   * Never throws, for the reason every agent-facing path in Asterim does not: a
   * delegating agent is mid-turn waiting on a line, and an exception here would
   * read to it as a dead session rather than as an answer it can correct. A
   * refused delegation comes back as text saying why.
   */
  public async executeDelegationTool(
    toolName: string,
    args: Record<string, unknown>,
    context: { threadId: string }
  ): Promise<{ name: string; isError: boolean; text: string }> {
    const fail = (text: string) => ({ name: toolName, isError: true, text });

    if (!isDelegationToolName(toolName)) {
      return fail(`'${toolName}' is not a delegation tool.`);
    }
    if (!context?.threadId) {
      return fail(`${toolName} cannot be used outside a thread.`);
    }

    try {
      // The caller is the agent itself, and the text returned here is written
      // into its session as the tool's result. That is the resume, so the
      // service must not also write the report in as a message.
      const viaTool: DelegationOptions = { resumeParent: false };

      const result =
        toolName === REQUEST_REVIEW_TOOL
          ? await this.requestReview(
              {
                parentThreadId: context.threadId,
                diff: asString(args?.diff),
                criteria: normalizeCriteria(args?.criteria),
                role: asOptionalString(args?.role),
                timeoutMs: asOptionalNumber(args?.timeoutMs)
              },
              viaTool
            )
          : await this.delegateTask(
              {
                parentThreadId: context.threadId,
                targetRole: asOptionalString(args?.role),
                profileId: asOptionalString(args?.profileId),
                taskDescription: asString(args?.task ?? args?.taskDescription),
                inputContext: asOptionalString(args?.context ?? args?.inputContext),
                timeoutMs: asOptionalNumber(args?.timeoutMs)
              },
              viaTool
            );

      return {
        name: toolName,
        // A child that failed is an answer, not a broken tool call: the caller
        // is told so in the text and can decide what to do about it.
        isError: false,
        text: formatDelegationReport(result)
      };
    } catch (err) {
      if (err instanceof DelegationError) return fail(err.message);
      return fail(`${toolName} failed: ${(err as Error).message}`);
    }
  }

  // --- Internals ------------------------------------------------------------

  /**
   * The profile a child runs under.
   *
   * An explicit id must exist; a role is matched against the catalogue by role
   * first and by name second, so both "Security Auditor" and the profile a user
   * called "Our Auditor" are reachable. A role that matches nothing is refused
   * with the list of what is available, because the caller is usually a model
   * that can correct itself given the names.
   */
  private resolveTargetProfile(request: DelegationRequest): AgentProfile | null {
    if (request?.profileId) {
      const profile = this.profiles.getProfile(request.profileId);
      if (!profile) {
        throw new DelegationError(
          'PROFILE_NOT_FOUND',
          `No agent profile with id ${request.profileId}.`
        );
      }
      return profile;
    }

    const wanted = (request?.targetRole ?? '').trim().toLowerCase();
    if (!wanted) {
      throw new DelegationError(
        'INVALID_INPUT',
        'A target role (or profileId) is required to delegate.'
      );
    }

    const catalogue = this.profiles.listProfiles();
    const match =
      catalogue.find(profile => profile.role.trim().toLowerCase() === wanted) ??
      catalogue.find(profile => profile.name.trim().toLowerCase() === wanted) ??
      catalogue.find(profile => profile.role.trim().toLowerCase().includes(wanted)) ??
      catalogue.find(profile => profile.name.trim().toLowerCase().includes(wanted));

    if (!match) {
      const available = catalogue.map(profile => profile.role).join(', ');
      throw new DelegationError(
        'PROFILE_NOT_FOUND',
        `No agent profile plays the role '${request.targetRole}'. Available roles: ${available || 'none'}.`
      );
    }
    return match;
  }

  /** Creates the child row, linked to its parent and carrying its brief. */
  private createChildThread(
    parent: ThreadRow,
    profile: AgentProfile | null,
    context: DelegationContext
  ): string {
    const childThreadId = crypto.randomUUID();
    const label = context.kind === 'REVIEW' ? 'Review' : 'Task';
    const name = `${profile?.role ?? 'Delegated'} — ${label}: ${truncate(context.taskDescription, 60)}`;

    this.db()
      .prepare(
        `INSERT INTO threads (id, project_id, name, profile_id, parent_thread_id, delegation_context_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        childThreadId,
        parent.project_id,
        name,
        profile?.id ?? null,
        parent.id,
        JSON.stringify(context)
      );

    return childThreadId;
  }

  /** Starts the child, hands it its brief, and watches until it settles. */
  private async runChild(
    parent: ThreadRow,
    childThreadId: string,
    profile: AgentProfile | null,
    context: DelegationContext,
    timeoutMs: number,
    active: ActiveDelegation
  ): Promise<ChildOutcome> {
    this.publishChildState(parent.project_id, childThreadId, parent.id, 'STARTING');

    // Watching starts before the session does: a child that answers immediately
    // must not have its first line land before anything is listening.
    const watching = this.watchChild(childThreadId, timeoutMs, active);

    // A delegation cancelled before its session was asked for does not get one.
    // The window is small, but starting a subprocess in order to stop it a
    // moment later is the kind of thing that leaves one behind.
    if (active.cancelReason) return watching;

    await this.runner.start({
      projectId: parent.project_id,
      threadId: childThreadId,
      profileId: profile?.id,
      agentType: this.resolveAgentType(parent.id)
    });

    this.publishChildState(parent.project_id, childThreadId, parent.id, 'ACTIVE');
    await this.runner.send({
      projectId: parent.project_id,
      threadId: childThreadId,
      content: formatChildBrief(profile, context)
    });

    return watching;
  }

  /**
   * Resolves when the child settles: an answer, a failure, or the timeout.
   *
   * A PTY-driven agent has no completion signal, so "settled" is inferred: the
   * child has said something and then reported itself idle. The `sawOutput`
   * guard is what separates that from the idle a session reports at startup,
   * before it has been asked anything.
   *
   * The fourth way it can end is an operator saying stop, which arrives through
   * the abort this arms on the delegation record (P7-03).
   */
  private watchChild(
    childThreadId: string,
    timeoutMs: number,
    active: ActiveDelegation
  ): Promise<ChildOutcome> {
    return new Promise<ChildOutcome>(resolve => {
      const chunks: string[] = [];
      let sawOutput = false;
      let settled = false;

      const finish = (status: DelegationStatus, failure?: string, cancelled = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        active.abort = undefined;
        this.bus.unsubscribe('chat.message', onChat);
        this.bus.unsubscribe('agent.status', onStatus);
        resolve({
          status,
          output: truncate(chunks.join('').trim(), MAX_OUTPUT_CHARS),
          failure,
          cancelled
        });
      };

      const onChat = (event: { payload?: Record<string, unknown> }) => {
        const payload = event?.payload ?? {};
        if (payload.threadId !== childThreadId) return;
        if (payload.role !== 'agent') return;
        const content = typeof payload.content === 'string' ? payload.content : '';
        if (!content) return;
        chunks.push(content);
        sawOutput = true;
      };

      const onStatus = (event: { payload?: Record<string, unknown> }) => {
        const payload = event?.payload ?? {};
        if (payload.threadId !== childThreadId) return;
        const status = payload.status;
        const message = typeof payload.message === 'string' ? payload.message : '';

        if (status === 'error') {
          finish('FAILED', message || 'The delegated session reported an error.');
          return;
        }
        // A session that could not be started reports itself idle with the
        // reason in the message. Without this it would look like a child that
        // simply had nothing to say, and the parent would wait out the timeout.
        if (status === 'idle' && !sawOutput && /^error starting agent/i.test(message)) {
          finish('FAILED', message);
          return;
        }
        if (status === 'idle' && sawOutput) finish('COMPLETED');
      };

      // Armed before anything is subscribed, so `finish` — which clears it —
      // cannot run before it exists. Deliberately not unref'd: this timer is
      // the only thing that will ever settle a delegation whose child went
      // quiet, and a timer the runtime is free to skip is a parent left waiting
      // forever. A delegation that ends normally clears it and leaves nothing.
      const timer = setTimeout(
        () =>
          finish(
            'TIMEOUT',
            `The delegated session did not finish within ${Math.round(timeoutMs / 1000)}s.`
          ),
        timeoutMs
      );

      this.bus.subscribe('chat.message', onChat);
      this.bus.subscribe('agent.status', onStatus);

      // A cancellation is a `FAILED` outcome with an operator behind it rather
      // than a crash, which is the difference the summary carries.
      active.abort = (reason: string) => finish('FAILED', reason, true);
      // And one that arrived before this watch existed is honoured now, rather
      // than leaving the parent parked until the timeout.
      if (active.cancelReason) active.abort(active.cancelReason);
    });
  }

  /**
   * Which adapter a child should run: whatever the parent last ran.
   *
   * A child started under a different agent CLI than its parent would be a
   * surprise nobody asked for. `antigravity` is the fallback because it is what
   * an auto-started session uses when nothing else is known.
   */
  private resolveAgentType(parentThreadId: string): string {
    try {
      const row = this.db()
        .prepare('SELECT agent_type FROM sessions WHERE thread_id = ? ORDER BY started_at DESC LIMIT 1')
        .get(parentThreadId) as { agent_type?: string } | undefined;
      return row?.agent_type || 'antigravity';
    } catch {
      return 'antigravity';
    }
  }

  /** The outcome, read out of what the child actually said. */
  private buildResult(
    childThreadId: string,
    profile: AgentProfile | null,
    context: DelegationContext,
    outcome: ChildOutcome,
    startedAt: number
  ): DelegationResult {
    const tagged = parseTaggedLine(outcome.output, 'SUMMARY');
    const summary =
      outcome.status === 'COMPLETED'
        ? tagged || tail(outcome.output, MAX_SUMMARY_CHARS) || 'The delegated agent produced no output.'
        : // A cancellation is the operator's sentence, not the child's. Trailing
          // it with whatever the child was mid-way through saying would read as
          // an explanation of a failure that did not happen.
          outcome.cancelled
          ? (outcome.failure ?? DEFAULT_CANCELLATION_REASON)
          : `${outcome.failure ?? 'The delegated agent did not finish.'}${
              outcome.output ? ` Last output: ${tail(outcome.output, 600)}` : ''
            }`;

    const artifacts = parseArtifacts(outcome.output);

    const result: DelegationResult = {
      childThreadId,
      status: outcome.status,
      summary,
      output: outcome.output,
      role: profile?.role,
      profileId: profile?.id,
      depth: context.depth,
      startedAt,
      finishedAt: Date.now()
    };

    if (artifacts.length > 0) result.artifacts = artifacts;

    if (context.kind === 'REVIEW') {
      // A review that did not finish has not cleared anything, whatever the
      // half of it that arrived happens to say.
      result.verdict =
        outcome.status === 'COMPLETED'
          ? readVerdict(outcome.output)
          : ('NEEDS_FIX' as ReviewVerdict);
    }

    return result;
  }

  /** Writes the outcome back onto the child row, next to its brief. */
  private recordOutcome(
    childThreadId: string,
    context: DelegationContext,
    result: DelegationResult
  ): void {
    const finished: DelegationContext = {
      ...context,
      status: result.status,
      summary: truncate(result.summary, MAX_SUMMARY_CHARS),
      verdict: result.verdict,
      finishedAt: result.finishedAt
    };
    try {
      this.db()
        .prepare('UPDATE threads SET delegation_context_json = ? WHERE id = ?')
        .run(JSON.stringify(finished), childThreadId);
    } catch (err) {
      console.warn(
        `[Delegation] Could not record the outcome for ${childThreadId}: ${(err as Error).message}`
      );
    }
  }

  private setParentState(
    projectId: string,
    threadId: string,
    state: DelegationParentState,
    childThreadId?: string
  ): void {
    if (state === 'WAITING_FOR_CHILD' && childThreadId) {
      this.waiting.set(threadId, childThreadId);
    }
    this.bus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server:delegation',
      type: DELEGATION_PARENT_STATE_EVENT,
      payload: { projectId, threadId, state, childThreadId }
    });
  }

  private publishChildState(
    projectId: string,
    childThreadId: string,
    parentThreadId: string,
    state: DelegationChildState,
    message?: string
  ): void {
    this.bus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server:delegation',
      type: DELEGATION_CHILD_STATE_EVENT,
      payload: { projectId, threadId: childThreadId, parentThreadId, state, message }
    });
  }

  /** Stopping a child must never be what strands the parent. */
  private async safeStop(projectId: string, threadId: string): Promise<void> {
    try {
      await this.runner.stop({ projectId, threadId });
    } catch (err) {
      console.warn(`[Delegation] Could not stop child ${threadId}: ${(err as Error).message}`);
    }
  }

  /** Nor must the resume itself. */
  private async safeSend(projectId: string, threadId: string, content: string): Promise<void> {
    try {
      await this.runner.send({ projectId, threadId, content });
    } catch (err) {
      console.error(
        `[Delegation] Could not resume parent ${threadId}: ${(err as Error).message}`
      );
    }
  }
}

// --- Formatting & parsing ----------------------------------------------------

/**
 * The brief a child opens with.
 *
 * It ends by naming the three lines the child should close with, because the
 * alternative is guessing which part of a terminal transcript was the answer.
 * The last instruction is there for a reason too: a child that delegates onward
 * by reflex is how a bounded depth gets spent on nothing.
 */
export function formatChildBrief(
  profile: { role?: string; name?: string } | null,
  context: DelegationContext
): string {
  const role = profile?.role ?? 'delegated engineer';
  const lines: string[] = [
    `You have been delegated work by another Asterim agent as the ${role}.`,
    `This is delegation depth ${context.depth} of ${MAX_DELEGATION_DEPTH}.`,
    '',
    'TASK:',
    context.taskDescription
  ];

  if (context.inputContext) {
    lines.push('', context.kind === 'REVIEW' ? 'CHANGES UNDER REVIEW:' : 'CONTEXT:', context.inputContext);
  }

  if (context.reviewCriteria && context.reviewCriteria.length > 0) {
    lines.push('', 'CRITERIA:', ...context.reviewCriteria.map(criterion => `- ${criterion}`));
  }

  lines.push(
    '',
    'When you are done, end your final message with these lines:',
    'SUMMARY: <what you did or found, in one paragraph the requester can act on>',
    'ARTIFACTS: <comma-separated paths you changed, or none>'
  );

  if (context.kind === 'REVIEW') {
    lines.push('VERDICT: PASS or NEEDS_FIX');
  }

  lines.push(
    '',
    'Do the work yourself. Only delegate onward if the task genuinely belongs to a different role.'
  );

  return lines.join('\n');
}

/** The outcome, as the line written into the parent's session. */
export function formatDelegationReport(result: DelegationResult): string {
  const who = result.role ? `The ${result.role} agent` : 'The delegated agent';
  const lines = [
    `[Asterim delegation] ${who} (thread ${result.childThreadId}) finished with status ${result.status}.`
  ];

  if (result.verdict) lines.push(`VERDICT: ${result.verdict}`);
  lines.push(`SUMMARY: ${result.summary}`);
  if (result.artifacts && result.artifacts.length > 0) {
    lines.push(`ARTIFACTS: ${result.artifacts.join(', ')}`);
  }

  lines.push(
    result.status === 'COMPLETED'
      ? 'Continue from this result. Verify anything you depend on rather than assuming it.'
      : 'The delegated work did not complete. Decide whether to do it yourself, retry it, or report the failure.'
  );

  return lines.join('\n');
}

/** The value of a `TAG: value` line, taking the last one the child wrote. */
export function parseTaggedLine(output: string, tag: string): string | undefined {
  if (!output) return undefined;
  const pattern = new RegExp(`^\\s*${tag}\\s*:\\s*(.+)$`, 'gim');
  let match: RegExpExecArray | null;
  let value: string | undefined;
  while ((match = pattern.exec(output)) !== null) {
    const candidate = match[1].trim();
    if (candidate) value = candidate;
  }
  return value;
}

/** The files the child named as its output, if it named any. */
export function parseArtifacts(output: string): string[] {
  const line = parseTaggedLine(output, 'ARTIFACTS');
  if (!line) return [];
  if (/^none\.?$/i.test(line.trim())) return [];
  return line
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0 && !/^none\.?$/i.test(entry))
    .slice(0, 100);
}

/**
 * A reviewer's verdict: its own `VERDICT:` line if it wrote one, otherwise
 * whatever the body of the review reads as.
 */
export function readVerdict(output: string): ReviewVerdict {
  const declared = parseTaggedLine(output, 'VERDICT');
  if (declared) return parseReviewVerdict(declared);
  return parseReviewVerdict(output);
}

function parseDelegationContext(raw: string | null): DelegationContext | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as DelegationContext) : null;
  } catch {
    return null;
  }
}

// --- Small helpers -----------------------------------------------------------

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DelegationError(
      'INVALID_INPUT',
      `${field} is required and must be a non-empty string.`
    );
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new DelegationError('INVALID_INPUT', `${field} must be at most ${max} characters.`);
  }
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new DelegationError('INVALID_INPUT', `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new DelegationError('INVALID_INPUT', `${field} must be at most ${max} characters.`);
  }
  return trimmed || undefined;
}

/** A timeout inside the accepted band; anything else falls back to the default. */
function resolveTimeout(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_DELEGATION_TIMEOUT_MS;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new DelegationError('INVALID_INPUT', 'timeoutMs must be a positive number.');
  }
  return Math.min(value, MAX_DELEGATION_TIMEOUT_MS);
}

function normalizeCriteria(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
    .slice(0, 50);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function truncate(value: string, max: number): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}… (truncated)` : value;
}

/** The end of a transcript, which is where an agent's conclusion lives. */
function tail(value: string, max: number): string {
  if (!value) return '';
  const trimmed = value.trim();
  return trimmed.length > max ? `…${trimmed.slice(trimmed.length - max)}` : trimmed;
}

export const agentDelegationService = new AgentDelegationService();
