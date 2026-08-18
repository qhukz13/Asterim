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
import fs from 'fs';
import path from 'path';
import {
  AgentProfile,
  BatchDelegationResult,
  DEFAULT_DELEGATION_TIMEOUT_MS,
  DEFAULT_REVIEW_ROLE,
  DELEGATE_PARALLEL_TOOL,
  DELEGATION_BATCH_COMPLETED_EVENT,
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
  DelegationSandbox,
  DelegationStatus,
  MAX_CONCURRENT_DELEGATIONS,
  MAX_DELEGATION_DEPTH,
  MAX_DELEGATION_TIMEOUT_MS,
  MAX_VERIFICATION_STEPS,
  ParallelDelegationItem,
  ParallelDelegationRequest,
  REQUEST_REVIEW_TOOL,
  ReviewVerdict,
  VerificationPipelineReport,
  WorktreeInfo,
  aggregateDelegationStatus,
  aggregateReviewVerdict,
  isDelegationToolName,
  isSafeScriptName,
  parseReviewVerdict,
  summarizeVerificationReport
} from '@asterim/shared';
import { dbService } from '../DatabaseService';
import { EventBus, eventBus } from '../EventBus';
import { GitWorktreeService, gitWorktreeService } from '../git/GitWorktreeService';
import {
  VerificationPipelineService,
  verificationPipelineService
} from '../verification/VerificationPipelineService';
import { saveThreadVerificationReport } from '../verification/threadVerificationStore';
import { ProfileService, profileService } from './ProfileService';

/** How a delegation failure reads to a caller that has to answer over HTTP. */
export type DelegationErrorCode =
  | 'INVALID_INPUT'
  | 'THREAD_NOT_FOUND'
  | 'PROFILE_NOT_FOUND'
  | 'DEPTH_EXCEEDED'
  | 'ALREADY_DELEGATING'
  | 'CONCURRENCY_LIMIT_EXCEEDED'
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
/**
 * How much of a sandbox's diff is carried back on the result (P8-01).
 *
 * The diff goes into an event payload and, from there, over the socket to every
 * dashboard watching the project. The worktree is still on disk with the whole
 * thing in it, so what travels is the part a parent can actually read.
 */
export const MAX_DIFF_CHARS = 20000;
/** How many changed paths the parent is told about by name. */
export const MAX_CHANGED_FILES = 100;
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
  /**
   * Parent thread id → every child it is currently parked behind (P7-04).
   *
   * A set rather than a single id because a fan-out parks one parent behind up
   * to `MAX_CONCURRENT_DELEGATIONS` children at once, and the parent is only
   * released when the last of them is gone. A sequential delegation is the
   * one-element case of the same thing.
   */
  private waiting = new Map<string, Set<string>>();

  /** Parent thread id → child thread id → the delegation running under it. */
  private active = new Map<string, Map<string, ActiveDelegation>>();

  constructor(
    private readonly runner: DelegationSessionRunner = new EventBusSessionRunner(),
    private readonly profiles: ProfileService = profileService,
    private readonly bus: EventBus = eventBus,
    private readonly worktrees: GitWorktreeService = gitWorktreeService,
    private readonly verification: VerificationPipelineService = verificationPipelineService
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
    return this.isWaiting(threadId) ? 'WAITING_FOR_CHILD' : 'ACTIVE';
  }

  /**
   * The child a thread is waiting on, if it is waiting on one.
   *
   * The oldest, when it is waiting on several: the REST surface has carried one
   * id since P7-01 and a dashboard that has not learned about fan-out is better
   * served a child that exists than an arbitrary one. `getPendingChildren` is
   * the whole answer.
   */
  public getPendingChild(threadId: string): string | undefined {
    return this.getPendingChildren(threadId)[0];
  }

  /** Every child a thread is parked behind, oldest first (P7-04). */
  public getPendingChildren(threadId: string): string[] {
    return [...(this.waiting.get(threadId) ?? [])];
  }

  /** Whether this thread has at least one child running under it. */
  private isWaiting(threadId: string): boolean {
    return (this.waiting.get(threadId)?.size ?? 0) > 0;
  }

  /** How many children are running under one parent right now. */
  public getActiveDelegationCount(threadId: string): number {
    return this.active.get(threadId)?.size ?? 0;
  }

  private registerActive(parentThreadId: string, active: ActiveDelegation): void {
    const forParent = this.active.get(parentThreadId) ?? new Map<string, ActiveDelegation>();
    forParent.set(active.childThreadId, active);
    this.active.set(parentThreadId, forParent);
  }

  /** Drops one child, and the parent's entry with it once nothing is left. */
  private unregisterActive(parentThreadId: string, childThreadId: string): void {
    const forParent = this.active.get(parentThreadId);
    if (!forParent) return;
    forParent.delete(childThreadId);
    if (forParent.size === 0) this.active.delete(parentThreadId);
  }

  private addWaiting(parentThreadId: string, childThreadId: string): void {
    const children = this.waiting.get(parentThreadId) ?? new Set<string>();
    children.add(childThreadId);
    this.waiting.set(parentThreadId, children);
  }

  private removeWaiting(parentThreadId: string, childThreadId: string): void {
    const children = this.waiting.get(parentThreadId);
    if (!children) return;
    children.delete(childThreadId);
    if (children.size === 0) this.waiting.delete(parentThreadId);
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

    if (this.isWaiting(parentThreadId)) {
      throw new DelegationError(
        'ALREADY_DELEGATING',
        `Thread ${parentThreadId} is already waiting on child ${this.getPendingChild(parentThreadId)}. Wait for that result before delegating again.`
      );
    }

    const depth = this.requireDepthFor(parentThreadId);
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

    return this.runDelegation(parent, profile, context, timeoutMs, {
      ...options,
      isolateWorktree: request?.isolateWorktree,
      verifyPipeline: request?.verifyPipeline,
      verificationSteps: normalizeStepNames(request?.verificationSteps),
      sandbox: request?.sandbox
    });
  }

  /** The depth a new child of this thread would sit at, or a refusal. */
  private requireDepthFor(parentThreadId: string): number {
    const depth = this.getDelegationDepth(parentThreadId) + 1;
    if (depth > MAX_DELEGATION_DEPTH) {
      throw new DelegationError(
        'DEPTH_EXCEEDED',
        `Delegation depth ${depth} exceeds the limit of ${MAX_DELEGATION_DEPTH}. Do this work yourself rather than handing it on.`
      );
    }
    return depth;
  }

  /**
   * One delegation, from the child row to the parent's release.
   *
   * Everything above this has already been validated and refused; from here a
   * child thread exists and the parent is owed a release. Shared by the
   * sequential and the parallel paths, which differ only in who does the
   * releasing: a `delegateTask` releases its own parent as it settles, while a
   * batch keeps the parent parked until the last of its children is done and
   * releases it once, with the outcome matrix rather than one child's answer.
   */
  private async runDelegation(
    parent: ThreadRow,
    profile: AgentProfile | null,
    context: DelegationContext,
    timeoutMs: number,
    options: DelegationOptions & {
      /** Whether settling this child is what puts the parent back to `ACTIVE`. */
      releaseParent?: boolean;
      /** Whether the child gets its own working tree (P8-01). */
      isolateWorktree?: boolean;
      /** Whether the child's work is verified before it is reported (P8-02). */
      verifyPipeline?: boolean;
      /** Which discovered verification steps to run, by name (P8-02). */
      verificationSteps?: string[];
      /** A checkout provisioned by Asterim's own code for this child (P9-02). */
      sandbox?: DelegationSandbox;
    }
  ): Promise<DelegationResult> {
    const parentThreadId = parent.id;
    const { kind, depth, taskDescription } = context;
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
    this.registerActive(parentThreadId, active);

    try {
      // Provisioned before the session is started, because the session is what
      // has to be pointed at it. A sandbox that cannot be provisioned is not a
      // failed delegation — the child runs in the project directory, the way
      // every delegation did before P8-01.
      const worktree = await this.provisionWorktree(
        parent,
        childThreadId,
        context,
        options.isolateWorktree,
        options.sandbox
      );

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

      // Taken while the child's process is still up but after it has stopped
      // producing output: the files are settled, and reading them is what turns
      // "the agent says it did the work" into something reviewable.
      await this.attachWorktreeChanges(result, worktree);

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

      // And only now is the sandbox verified (P8-02): after the diff, which is
      // what is being verified, and after the child's process has been asked to
      // go, so a build does not race an agent that is still writing files. Still
      // before the parent is released, because the whole point is that the
      // parent reads the verdict at the same time as the claim.
      await this.attachVerification(result, worktree, parent, context, outcome, options);

      // The parent sheds this child either way; whether that is what puts it
      // back to work depends on whether anything else is still running under it.
      this.removeWaiting(parentThreadId, childThreadId);
      if (options.releaseParent !== false && !this.isWaiting(parentThreadId)) {
        this.setParentState(parent.project_id, parentThreadId, 'ACTIVE', childThreadId);
      }

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
      // Idempotent, and the net under the path above: a delegation that threw
      // somewhere unexpected — a bus subscriber of its own terminal event, say
      // — must not leave the parent parked behind a child that is over.
      this.removeWaiting(parentThreadId, childThreadId);
      this.unregisterActive(parentThreadId, childThreadId);
    }
  }

  // --- Parallel delegation (P7-04) --------------------------------------------

  /**
   * Hands several independent pieces of work out at once and waits for all.
   *
   * The fan-in is the point. Each child runs as an ordinary delegation — its own
   * thread, its own brief, its own `delegation.started` and terminal
   * `delegation.completed` — so nothing that watches a single delegation has to
   * learn anything new. What the batch adds is that the parent stays parked
   * until the last child settles and is then resumed once, with every outcome
   * together, rather than four times with four answers it would have to
   * reassemble itself.
   *
   * `Promise.allSettled` rather than `Promise.all`: one child crashing must not
   * discard the three that worked, and a rejection nothing awaited would be an
   * unhandled rejection in a process that must not go down.
   *
   * Everything that can be refused is refused before any child thread exists,
   * so a batch that names one bad role does not leave three half-started
   * sessions behind.
   */
  public async delegateParallel(
    request: ParallelDelegationRequest,
    options: DelegationOptions = {}
  ): Promise<BatchDelegationResult> {
    const parentThreadId = requireText(request?.parentThreadId, 'parentThreadId', 200);
    const items = Array.isArray(request?.delegations) ? request.delegations : [];

    if (items.length === 0) {
      throw new DelegationError(
        'INVALID_INPUT',
        'delegations must contain at least one piece of work to hand out.'
      );
    }
    if (items.length > MAX_CONCURRENT_DELEGATIONS) {
      throw new DelegationError(
        'CONCURRENCY_LIMIT_EXCEEDED',
        `A batch may contain at most ${MAX_CONCURRENT_DELEGATIONS} delegations; ${items.length} were requested. Split the work into smaller batches.`
      );
    }

    const parent = this.getThread(parentThreadId);
    if (!parent) {
      throw new DelegationError('THREAD_NOT_FOUND', `No thread with id ${parentThreadId}.`);
    }

    // Children already running under this parent count against the same bound:
    // the limit is on how many agent processes one thread has going at once,
    // not on how many one call asks for.
    const running = this.getActiveDelegationCount(parentThreadId);
    if (running + items.length > MAX_CONCURRENT_DELEGATIONS) {
      throw new DelegationError(
        'CONCURRENCY_LIMIT_EXCEEDED',
        `Thread ${parentThreadId} already has ${running} delegation(s) running; ${items.length} more would exceed the limit of ${MAX_CONCURRENT_DELEGATIONS}.`
      );
    }

    // One depth for the whole batch: every child of a parent sits at the same
    // level, so the bound is checked once and refuses the batch as a whole.
    const depth = this.requireDepthFor(parentThreadId);
    const prepared = items.map(item => this.prepareItem(parentThreadId, depth, item));

    const startedAt = Date.now();
    const settled = await Promise.allSettled(
      prepared.map(entry =>
        this.runDelegation(parent, entry.profile, entry.context, entry.timeoutMs, {
          // The parent is resumed once, by the batch, with everything at once.
          resumeParent: false,
          releaseParent: false,
          // Isolation matters most here: this is the path on which several
          // agents edit the same repository at the same time.
          isolateWorktree: entry.isolateWorktree,
          verifyPipeline: entry.verifyPipeline,
          verificationSteps: entry.verificationSteps,
          sandbox: entry.sandbox
        })
      )
    );

    const results = settled.map((entry, index) =>
      entry.status === 'fulfilled'
        ? entry.value
        : // Only reachable if the child row itself could not be written — the
          // delegation never got as far as having a thread to report on, and
          // the batch still owes the parent a row for what it asked for.
          unstartedResult(prepared[index], startedAt, entry.reason)
    );

    const batch: BatchDelegationResult = {
      parentThreadId,
      overallStatus: aggregateDelegationStatus(results),
      results,
      aggregatedVerdict: aggregateReviewVerdict(results),
      summary: summarizeBatch(results),
      startedAt,
      finishedAt: Date.now()
    };

    // Every child of *this* batch has settled. Released here rather than in
    // `runDelegation` so exactly one release is published for the batch,
    // whatever order the children finished in — and not at all while something
    // else is still running under the same parent, which an operator starting a
    // second batch over the REST surface can arrange.
    if (!this.isWaiting(parentThreadId)) {
      this.setParentState(parent.project_id, parentThreadId, 'ACTIVE');
    }

    if (options.resumeParent !== false) {
      await this.safeSend(parent.project_id, parentThreadId, formatBatchDelegationReport(batch));
    }

    this.bus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server:delegation',
      type: DELEGATION_BATCH_COMPLETED_EVENT,
      payload: { projectId: parent.project_id, threadId: parentThreadId, batch }
    });

    return batch;
  }

  /** One item of a batch, validated and turned into a brief. */
  private prepareItem(
    parentThreadId: string,
    depth: number,
    item: ParallelDelegationItem
  ): {
    context: DelegationContext;
    profile: AgentProfile | null;
    timeoutMs: number;
    isolateWorktree?: boolean;
    verifyPipeline?: boolean;
    verificationSteps?: string[];
    sandbox?: DelegationSandbox;
  } {
    const taskDescription = requireText(item?.taskDescription, 'taskDescription', MAX_TASK_CHARS);
    const inputContext = optionalText(item?.inputContext, 'inputContext', MAX_CONTEXT_CHARS);
    const kind: DelegationKind = item?.kind === 'REVIEW' ? 'REVIEW' : 'TASK';
    const timeoutMs = resolveTimeout(item?.timeoutMs);
    const profile = this.resolveTargetProfile({
      parentThreadId,
      targetRole: item?.targetRole,
      profileId: item?.profileId,
      taskDescription
    });
    const reviewCriteria = normalizeCriteria(item?.reviewCriteria);

    return {
      context: {
        parentThreadId,
        depth,
        kind,
        taskDescription,
        inputContext,
        reviewCriteria: reviewCriteria.length > 0 ? reviewCriteria : undefined,
        role: profile?.role,
        profileId: profile?.id,
        requestedAt: Date.now()
      },
      profile,
      timeoutMs,
      isolateWorktree: item?.isolateWorktree,
      verifyPipeline: item?.verifyPipeline,
      verificationSteps: normalizeStepNames(item?.verificationSteps),
      // Never read from an agent's `delegate_parallel` arguments: `parseParallelItems`
      // does not carry it, so only Asterim's own code can put one here (P9-02).
      sandbox: item?.sandbox
    };
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

    // A thread named as a parent cancels what is running under it; named as a
    // child, the one delegation it is. A parent running a fan-out resolves to
    // its oldest child, because a single cancellation is a single result —
    // stopping the whole batch is `cancelAllDelegations`, and the dashboard
    // names the child it means when there is more than one.
    const active = this.oldestActiveFor(id) ?? this.findActiveByChild(id);
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

  /**
   * Stops every delegation running under one parent (P7-04).
   *
   * The batch counterpart of `cancelDelegation`, and the same shape: it asks
   * each child's own wait to end and then reports what each settled as, so a
   * fan-out cancelled halfway through still has one writer per child row, one
   * stopped process per child, and — if the batch was dispatched through
   * `delegateParallel` — one release of the parent, from the batch itself.
   *
   * A parent with nothing running answers with an empty list rather than an
   * error: "stop everything" on a thread where everything is already stopped
   * has got what it asked for.
   */
  public async cancelAllDelegations(
    parentThreadId: string,
    reason?: string
  ): Promise<DelegationResult[]> {
    const id = requireText(parentThreadId, 'parentThreadId', 200);
    const why = optionalText(reason, 'reason', MAX_SUMMARY_CHARS) || DEFAULT_CANCELLATION_REASON;

    const thread = this.getThread(id);
    if (!thread) {
      throw new DelegationError('THREAD_NOT_FOUND', `No thread with id ${id}.`);
    }

    // Snapshotted before anything is awaited: each child settling removes
    // itself from the registry, and iterating it while that happens would skip
    // whichever sibling the deletion moved.
    const running = [...(this.active.get(id)?.values() ?? [])];
    if (running.length === 0) return [];

    for (const entry of running) {
      if (entry.cancelReason) continue;
      entry.cancelReason = why;
      entry.abort?.(why);
    }

    const settled = await Promise.allSettled(running.map(entry => entry.settled));
    return settled
      .filter(
        (entry): entry is PromiseFulfilledResult<DelegationResult> => entry.status === 'fulfilled'
      )
      .map(entry => entry.value);
  }

  /** The oldest delegation running under one parent, if any is. */
  private oldestActiveFor(parentThreadId: string): ActiveDelegation | undefined {
    const forParent = this.active.get(parentThreadId);
    if (!forParent) return undefined;
    for (const entry of forParent.values()) return entry;
    return undefined;
  }

  /** The running delegation whose child is this thread, if there is one. */
  private findActiveByChild(childThreadId: string): ActiveDelegation | undefined {
    for (const forParent of this.active.values()) {
      const entry = forParent.get(childThreadId);
      if (entry) return entry;
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
      /** A reviewer gets no sandbox unless the caller asks for one (P8-01). */
      isolateWorktree?: boolean;
      /** Nor is a review verified unless the caller asks for it (P8-02). */
      verifyPipeline?: boolean;
      /** Which discovered verification steps to run for it, by name. */
      verificationSteps?: string[];
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
        isolateWorktree: params?.isolateWorktree,
        verifyPipeline: params?.verifyPipeline,
        verificationSteps: params?.verificationSteps,
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
   * Runs `delegate_task`, `request_review` or `delegate_parallel` on behalf of
   * an agent.
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

      if (toolName === DELEGATE_PARALLEL_TOOL) {
        const batch = await this.delegateParallel(
          {
            parentThreadId: context.threadId,
            delegations: parseParallelItems(args?.delegations ?? args?.tasks ?? args?.items)
          },
          viaTool
        );
        return { name: toolName, isError: false, text: formatBatchDelegationReport(batch) };
      }

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

  // --- Worktree sandboxing (P8-01) --------------------------------------------

  /** Where a project lives on disk, or null when it is not a project we know. */
  private getProjectPath(projectId: string): string | null {
    try {
      const row = this.db()
        .prepare('SELECT path FROM projects WHERE id = ?')
        .get(projectId) as { path?: string } | undefined;
      return row?.path || null;
    } catch (err) {
      console.warn(
        `[Delegation] Could not resolve the path of project ${projectId}: ${(err as Error).message}`
      );
      return null;
    }
  }

  /**
   * Gives a child its own working tree, when it should have one.
   *
   * The default is on for `TASK` and off for `REVIEW`: a child that is going to
   * edit files needs somewhere to do it that is not the parent's checkout, and a
   * reviewer that is going to read them gains nothing from a second copy. An
   * explicit `isolateWorktree` overrides both ways.
   *
   * Never throws. Every reason a sandbox cannot be provisioned — the project is
   * not a repository, it has no commits yet, git is not installed — is a
   * delegation that runs the way it always did, in the project directory. A
   * subagent that does not run at all is a worse outcome than one that runs
   * without isolation, and the operator can see which happened from the result.
   */
  private async provisionWorktree(
    parent: ThreadRow,
    childThreadId: string,
    context: DelegationContext,
    isolateWorktree?: boolean,
    sandbox?: DelegationSandbox
  ): Promise<WorktreeInfo | null> {
    // A checkout the caller provisioned wins over both the default and an
    // explicit `isolateWorktree`: the child already has its isolation, and
    // making a second one would run it somewhere its predecessors' work is not
    // (P9-02). Only Asterim's own orchestration can set this — it is not part
    // of the tool schema an agent writes.
    if (sandbox?.path && fs.existsSync(sandbox.path)) {
      const adopted: WorktreeInfo = {
        threadId: childThreadId,
        path: sandbox.path,
        branch: sandbox.branch ?? '',
        baseCommit: sandbox.baseCommit ?? '',
        createdAt: Date.now(),
        status: 'ACTIVE'
      };
      this.db()
        .prepare('UPDATE threads SET worktree_path = ?, worktree_branch = ? WHERE id = ?')
        .run(adopted.path, adopted.branch || null, childThreadId);
      context.worktreePath = adopted.path;
      context.worktreeBranch = adopted.branch || undefined;
      context.worktreeBaseCommit = adopted.baseCommit || undefined;
      return adopted;
    }

    const wanted = isolateWorktree ?? context.kind === 'TASK';
    if (!wanted) return null;

    const repoPath = this.getProjectPath(parent.project_id);
    if (!repoPath) return null;

    // Cheap first: a project directory with no `.git` in it cannot be the root
    // of a repository, and answering that without spawning a subprocess keeps
    // the cost of this feature at zero for every workstation not using it.
    // `.git` is a file rather than a directory inside a worktree, so existence
    // is the question, not what it is.
    if (!fs.existsSync(path.join(repoPath, '.git'))) return null;

    try {
      if (!(await this.worktrees.isRepository(repoPath))) return null;

      const worktree = await this.worktrees.createWorktree(repoPath, childThreadId);

      // Written onto the row before the session starts, because the row is what
      // AgentService reads to decide where to run it.
      this.db()
        .prepare('UPDATE threads SET worktree_path = ?, worktree_branch = ? WHERE id = ?')
        .run(worktree.path, worktree.branch, childThreadId);

      context.worktreePath = worktree.path;
      context.worktreeBranch = worktree.branch;
      context.worktreeBaseCommit = worktree.baseCommit;

      console.log(
        `[Delegation] Child ${childThreadId} runs in sandbox ${worktree.path} on ${worktree.branch}`
      );
      return worktree;
    } catch (err) {
      console.warn(
        `[Delegation] Could not sandbox child ${childThreadId}; it will run in ${repoPath}: ${(err as Error).message}`
      );
      return null;
    }
  }

  /**
   * Puts what the child actually changed onto the result.
   *
   * The diff, not the transcript: an agent's account of its own work is a claim,
   * and this is the evidence. Bounded on the way out, because it travels as an
   * event payload — the worktree itself keeps the whole thing.
   */
  private async attachWorktreeChanges(
    result: DelegationResult,
    worktree: WorktreeInfo | null
  ): Promise<void> {
    if (!worktree) return;
    result.worktreePath = worktree.path;

    try {
      const changes = await this.worktrees.getDiff(worktree.path, worktree.baseCommit);
      result.diff = truncate(changes.diff, MAX_DIFF_CHARS);
      result.changedFiles = changes.changedFiles.slice(0, MAX_CHANGED_FILES);
    } catch (err) {
      console.warn(
        `[Delegation] Could not read the sandbox diff for ${worktree.threadId}: ${(err as Error).message}`
      );
      result.diff = '';
      result.changedFiles = [];
    }
  }

  // --- Automated verification (P8-02) -----------------------------------------

  /**
   * Runs the project's own verification commands over what the child did.
   *
   * The default is the case this exists for: a `TASK` that got a sandbox. The
   * child edited files in a directory nobody else is using, so the typechecker,
   * the linter, the tests and the build can be run over exactly those edits
   * without touching the operator's working tree — and the parent is handed the
   * exit codes next to the child's own account of itself. A `REVIEW` changed
   * nothing to verify, and a task that ran without a sandbox would be verified
   * in the operator's own checkout, so neither is verified unless the caller
   * asked for it in as many words.
   *
   * A cancelled delegation is never verified, whatever was asked for. An
   * operator who has just stopped a runaway agent is waiting on that request,
   * and `cancelDelegation` answers with what the delegation settles as — so a
   * four-minute build here would be four minutes of a cancel button that has
   * not done anything yet, to establish something about work that has been
   * abandoned.
   *
   * Never throws. A pipeline that could not be run leaves the result without a
   * report, which reads as "not verified" — the one thing it must never do is
   * turn a finished delegation into a failed one.
   */
  private async attachVerification(
    result: DelegationResult,
    worktree: WorktreeInfo | null,
    parent: ThreadRow,
    context: DelegationContext,
    outcome: ChildOutcome,
    options: { verifyPipeline?: boolean; verificationSteps?: string[] }
  ): Promise<void> {
    if (outcome.cancelled) return;

    const wanted = options.verifyPipeline ?? (!!worktree && context.kind === 'TASK');
    if (!wanted) return;

    const projectPath = this.getProjectPath(parent.project_id);
    // Only an explicit request runs the pipeline anywhere but a sandbox: a
    // build in the project directory writes artefacts into the tree the
    // operator is working in, which is exactly what P8-01 exists to avoid.
    const targetDir = worktree?.path ?? (options.verifyPipeline === true ? projectPath : null);
    if (!targetDir) return;

    try {
      const report = await this.verification.runPipeline(targetDir, {
        steps: options.verificationSteps,
        // `.asterim/` is untracked, so a sandbox does not carry the operator's
        // pipeline configuration even though the project it branched from does.
        configDir: projectPath ?? undefined
      });
      // The whole thing is kept on the row, where the REST surface reads it
      // from; what travels on the result is bounded, because the result becomes
      // an event payload sent to every dashboard watching the project — the
      // same rule the sandbox diff follows.
      saveThreadVerificationReport(result.childThreadId, report);
      result.verificationReport = compactVerificationReport(report);

      console.log(
        `[Delegation] Verified ${result.childThreadId} in ${targetDir}: ${summarizeVerificationReport(report)}`
      );
    } catch (err) {
      console.warn(
        `[Delegation] Could not verify ${result.childThreadId} in ${targetDir}: ${(err as Error).message}`
      );
    }
  }

  /**
   * Reclaims sandboxes nothing is using any more (P8-02).
   *
   * Called once at startup, after `recoverDelegations` has settled the children
   * the previous run stopped on top of. A Core that was killed mid-delegation
   * can leave a registered worktree whose directory is gone, or a sandbox branch
   * with no checkout on it, and neither is ever cleaned up by anything else —
   * `git worktree list` grows for the life of the repository.
   *
   * What it must not do is throw away work an operator has not looked at yet, so
   * it deletes nothing that exists on disk: `pruneOrphans` skips every sandbox
   * whose directory is still there, and every thread that still records one is
   * named in the keep list on top of that. A finished delegation whose diff is
   * waiting to be reviewed survives any number of restarts.
   *
   * Never throws, and returns how many sandboxes were reclaimed.
   */
  public async pruneOrphanSandboxes(): Promise<number> {
    let projects: Array<{ id: string; path: string | null }>;
    let recorded: Array<{ id: string; project_id: string }>;
    try {
      projects = this.db().prepare('SELECT id, path FROM projects').all() as unknown as Array<{
        id: string;
        path: string | null;
      }>;
      recorded = this.db()
        .prepare('SELECT id, project_id FROM threads WHERE worktree_path IS NOT NULL')
        .all() as unknown as Array<{ id: string; project_id: string }>;
    } catch (err) {
      console.warn(`[Delegation] Could not scan for orphaned sandboxes: ${(err as Error).message}`);
      return 0;
    }

    const keepByProject = new Map<string, string[]>();
    for (const row of recorded) {
      const keep = keepByProject.get(row.project_id) ?? [];
      keep.push(row.id);
      keepByProject.set(row.project_id, keep);
    }

    let pruned = 0;
    for (const project of projects) {
      const repoPath = project.path;
      if (!repoPath) continue;
      const keep = keepByProject.get(project.id) ?? [];
      // Nothing to reclaim in a project that is not a repository, and nothing to
      // look for in one that has never had a sandbox — which is most of them,
      // and answering that from the filesystem keeps startup free of a `git`
      // subprocess per project.
      if (!fs.existsSync(path.join(repoPath, '.git'))) continue;
      if (keep.length === 0 && !fs.existsSync(path.join(repoPath, '.asterim', 'worktrees'))) {
        continue;
      }

      try {
        pruned += await this.worktrees.pruneOrphans(repoPath, keep);
      } catch (err) {
        console.warn(
          `[Delegation] Could not prune sandboxes in ${repoPath}: ${(err as Error).message}`
        );
      }
    }

    if (pruned > 0) console.log(`[Delegation] Reclaimed ${pruned} orphaned sandbox(es)`);
    return pruned;
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
      this.addWaiting(threadId, childThreadId);
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

  // The child's session already starts in the sandbox, so this is not an
  // instruction so much as an explanation: an agent that knows its edits are
  // isolated and will be reviewed as a diff does not go looking for the "real"
  // checkout, and does not try to merge its own work (P8-01).
  if (context.worktreePath) {
    lines.push(
      '',
      'WORKING TREE:',
      `You are in an isolated Git worktree at ${context.worktreePath}, on branch ${context.worktreeBranch ?? 'a sandbox branch'}.`,
      'Make your changes here. They do not touch anyone else’s checkout, and the requester reviews them as a diff and decides whether to merge. Do not merge, rebase or push anything yourself.'
    );
  }

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

  // What it changed, and where those changes are — not the diff itself, which
  // can be megabytes and belongs in the worktree the parent is being pointed at
  // rather than in the middle of its transcript (P8-01).
  if (result.worktreePath) {
    lines.push(
      `WORKTREE: ${result.worktreePath}`,
      result.changedFiles && result.changedFiles.length > 0
        ? `CHANGED FILES: ${result.changedFiles.join(', ')}`
        : 'CHANGED FILES: none — the delegated agent did not modify the working tree.'
    );
  }

  // What the project's own commands said about those changes (P8-02). This is
  // the line that stops a parent from taking "all tests pass" on trust: it is
  // Asterim's own execution of the tests, and it disagrees with the child's
  // summary whenever the child was wrong.
  if (result.verificationReport) {
    lines.push(`VERIFICATION: ${summarizeVerificationReport(result.verificationReport)}`);
    lines.push(...formatVerificationFailures(result.verificationReport));
  }

  lines.push(
    result.status === 'COMPLETED'
      ? result.verificationReport && !result.verificationReport.passed
        ? 'The delegated work did not verify. Read the failing step above before relying on any of it.'
        : 'Continue from this result. Verify anything you depend on rather than assuming it.'
      : 'The delegated work did not complete. Decide whether to do it yourself, retry it, or report the failure.'
  );

  return lines.join('\n');
}

/**
 * How much of a step's output travels on a `DelegationResult` (P8-02).
 *
 * A step captures up to `MAX_VERIFICATION_OUTPUT_CHARS`, and twenty of those
 * would be megabytes going out over the socket to every dashboard watching the
 * project. The whole capture stays on the thread row, which is what
 * `GET /worktree/verify` answers from; this is the part a parent can read.
 */
export const MAX_STEP_OUTPUT_ON_RESULT = 2000;

/**
 * The same report, small enough to put in an event.
 *
 * The tail of each step rather than the head — the opposite end from the
 * capture bound, on purpose. A step's output is truncated at capture from the
 * front, because a compiler's first error is the one to fix; it is truncated
 * here from the back, because by the time a step has printed more than two
 * thousand characters the useful line is the verdict it ends with.
 */
export function compactVerificationReport(
  report: VerificationPipelineReport
): VerificationPipelineReport {
  return {
    ...report,
    steps: report.steps.map(step => ({
      ...step,
      stdoutSummary: step.stdoutSummary
        ? tail(step.stdoutSummary, MAX_STEP_OUTPUT_ON_RESULT)
        : undefined,
      stderrSummary: step.stderrSummary
        ? tail(step.stderrSummary, MAX_STEP_OUTPUT_ON_RESULT)
        : undefined
    }))
  };
}

/** How many failing steps the parent is shown the output of. */
export const MAX_REPORTED_FAILURES = 2;

/** How much of a failing step's output travels with the report. */
export const MAX_FAILURE_OUTPUT_CHARS = 800;

/**
 * The evidence behind a failed verification, for the parent's brief.
 *
 * The tail rather than the head: a compiler prints its errors and then a summary
 * line, and a test runner prints the passing tests first. Bounded hard, and to
 * the first couple of failures — the parent is being told which step to go and
 * look at, not being handed the whole log, which is in the sandbox it is also
 * being pointed at.
 */
export function formatVerificationFailures(report: VerificationPipelineReport): string[] {
  if (!report || report.passed || report.totalSteps === 0) return [];

  return report.steps
    .filter(step => !step.passed)
    .slice(0, MAX_REPORTED_FAILURES)
    .map(step => {
      const output = tail(step.stderrSummary || step.stdoutSummary || '', MAX_FAILURE_OUTPUT_CHARS);
      const reason = step.error ?? `exit ${step.exitCode}`;
      return `  ${step.name} — ${step.command} (${reason})${output ? `\n  ${output.replace(/\n/g, '\n  ')}` : ''}`;
    });
}

/** One line saying how a batch went, in the terms a caller can act on. */
export function summarizeBatch(results: readonly DelegationResult[]): string {
  const total = results.length;
  const completed = results.filter(result => result.status === 'COMPLETED').length;
  const timedOut = results.filter(result => result.status === 'TIMEOUT').length;
  const failed = total - completed - timedOut;

  const trailing: string[] = [];
  if (failed > 0) trailing.push(`${failed} failed`);
  if (timedOut > 0) trailing.push(`${timedOut} timed out`);

  const agents = total === 1 ? 'agent' : 'agents';
  return trailing.length > 0
    ? `${completed} of ${total} delegated ${agents} completed (${trailing.join(', ')}).`
    : `All ${total} delegated ${agents} completed.`;
}

/**
 * A batch, as the block written into the parent's session.
 *
 * The matrix comes before the detail on purpose: the first thing the parent has
 * to decide is whether to continue or to fix something, and that is answered by
 * the status column alone.
 */
export function formatBatchDelegationReport(batch: BatchDelegationResult): string {
  const lines = [
    `[Asterim parallel delegation] ${batch.results.length} agent(s) finished with overall status ${batch.overallStatus}.`
  ];

  if (batch.aggregatedVerdict) lines.push(`VERDICT: ${batch.aggregatedVerdict}`);
  lines.push(`SUMMARY: ${batch.summary}`, '', 'OUTCOMES:');

  batch.results.forEach((result, index) => {
    const who = result.role ? result.role : 'Delegated agent';
    const verdict = result.verdict ? ` [${result.verdict}]` : '';
    lines.push(
      `${index + 1}. ${who} — ${result.status}${verdict} (thread ${result.childThreadId || 'not started'})`,
      `   ${result.summary}`
    );
    if (result.artifacts && result.artifacts.length > 0) {
      lines.push(`   ARTIFACTS: ${result.artifacts.join(', ')}`);
    }
  });

  lines.push(
    '',
    batch.overallStatus === 'COMPLETED'
      ? 'Continue from these results. Verify anything you depend on rather than assuming it.'
      : 'Some of the delegated work did not complete. Decide for each one whether to do it yourself, retry it, or report the failure.'
  );

  return lines.join('\n');
}

/**
 * The row a batch reports for a child that never got a thread.
 *
 * `childThreadId` is empty because there is nothing to open — the alternative
 * would be inventing an id for a transcript that does not exist.
 */
function unstartedResult(
  prepared: { context: DelegationContext; profile: AgentProfile | null },
  startedAt: number,
  reason: unknown
): DelegationResult {
  const message = reason instanceof Error ? reason.message : String(reason);
  return {
    childThreadId: '',
    status: 'FAILED',
    summary: `The delegated session could not be created: ${truncate(message, MAX_SUMMARY_CHARS)}`,
    output: '',
    role: prepared.profile?.role,
    profileId: prepared.profile?.id,
    depth: prepared.context.depth,
    verdict: prepared.context.kind === 'REVIEW' ? 'NEEDS_FIX' : undefined,
    startedAt,
    finishedAt: Date.now()
  };
}

/**
 * The `delegations` argument of `delegate_parallel`, as an agent wrote it.
 *
 * Tolerant about the key names for the same reason the single-delegation tool
 * is: a model that says `task` where the schema says `taskDescription` has
 * asked for something perfectly clear, and refusing it would cost a session.
 * Anything that is not an object at all is dropped, and the emptiness that
 * leaves is refused by `delegateParallel` with a message the agent can act on.
 */
export function parseParallelItems(value: unknown): ParallelDelegationItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map(entry => ({
      targetRole: asOptionalString(entry.role ?? entry.targetRole),
      profileId: asOptionalString(entry.profileId),
      taskDescription: asString(entry.task ?? entry.taskDescription),
      inputContext: asOptionalString(entry.context ?? entry.inputContext ?? entry.diff),
      timeoutMs: asOptionalNumber(entry.timeoutMs),
      kind: String(entry.kind).toUpperCase() === 'REVIEW' ? ('REVIEW' as const) : ('TASK' as const),
      reviewCriteria: normalizeCriteria(entry.criteria ?? entry.reviewCriteria),
      // Left undefined unless the caller said so, so the per-item defaults —
      // a sandbox for a task, verified in it — survive a body that is silent
      // about them (P8-01, P8-02).
      isolateWorktree: asOptionalBoolean(entry.isolateWorktree),
      verifyPipeline: asOptionalBoolean(entry.verifyPipeline),
      verificationSteps: normalizeStepNames(entry.verificationSteps)
    }));
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

/**
 * The verification steps a caller named, as names.
 *
 * Names only, never commands: this reaches `runPipeline`, which matches them
 * against what the project already declares. Anything that is not an ordinary
 * step name is dropped rather than passed on, so the selection cannot be a way
 * to smuggle something onto a command line.
 */
export function normalizeStepNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(entry => isSafeScriptName(entry))
    .slice(0, MAX_VERIFICATION_STEPS);
  return names.length > 0 ? names : undefined;
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

/** A boolean the caller actually stated, or nothing — never a defaulted `false`. */
function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
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
