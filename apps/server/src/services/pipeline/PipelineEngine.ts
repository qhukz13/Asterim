/**
 * The multi-step execution controller for declarative pipelines (P9-01).
 *
 * A pipeline run is a topological walk of the definition's DAG. On every pass
 * the engine asks which steps are ready — still `PENDING`, with every declared
 * dependency `PASSED` — dispatches them, waits, records what they did, and asks
 * again. Nothing in the file says what runs in parallel; two steps run together
 * exactly when neither can reach the other through `dependsOn`, which is the
 * property that makes a definition's parallelism impossible to state wrongly.
 *
 * Four decisions carry the design.
 *
 * **A step is a delegation.** Every step is a delegated child of one root thread
 * created for the run, so a step inherits everything Phase 7 and Phase 8 already
 * built and verified: the profile resolution, the worktree sandbox, the
 * verification pipeline over the diff, the timeout, the stop-before-resume
 * ordering, and a real transcript a person can open afterwards. The engine adds
 * scheduling and persistence; it does not add a second way to run an agent.
 * Ready sets wider than `PIPELINE_MAX_PARALLEL_STEPS` are dispatched in batches
 * for the same reason a fan-out is bounded — that limit is on how many agent
 * processes one thread has running, and a pipeline is not exempt from it.
 *
 * **Fail-closed.** One failed step ends the run. Everything still pending is
 * marked `SKIPPED` rather than attempted, because a step's input is its
 * ancestors' output and running it without that input produces a confident
 * answer to a question nobody asked. Nothing is left running: the delegation
 * that failed has already stopped its own child process before it returned.
 *
 * **The row is the record, not the memory.** Step state is written to
 * `pipeline_step_runs` as it changes, so a dashboard that reconnects mid-run
 * and a person reading a run six months later see the same thing, and a Core
 * that stops mid-run leaves rows that say exactly how far it got.
 *
 * **A cancellation is a separate answer.** Stopping a run marks its steps
 * `CANCELLED`, not `FAILED`: an operator who stopped a pipeline has not
 * discovered a bug in it, and a history that cannot tell those apart is a
 * history that cannot answer "does this pipeline work".
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  DelegationResult,
  MAX_PIPELINE_CONTEXT_CHARS,
  MAX_PIPELINE_STEP_DIFF_CHARS,
  MAX_PIPELINE_STEP_OUTPUT_CHARS,
  MAX_PIPELINE_TASK_CHARS,
  MAX_PIPELINE_YAML_CHARS,
  PIPELINE_COMPLETED_EVENT,
  PIPELINE_DEFINITION_DIR,
  PIPELINE_FAILED_EVENT,
  PIPELINE_MAX_PARALLEL_STEPS,
  PIPELINE_STARTED_EVENT,
  PIPELINE_STEP_COMPLETED_EVENT,
  PIPELINE_STEP_STARTED_EVENT,
  Pipeline,
  PipelineConflictAnalysis,
  PipelineDefinition,
  PipelineRun,
  PipelineRunStatus,
  PipelineStep,
  PipelineStepRun,
  PipelineStepStatus,
  PipelineStepWorktree,
  PipelineSynthesisResult,
  aggregatePipelineRunStatus,
  isTerminalPipelineRunStatus,
  pipelineAncestorIds,
  readyPipelineStepIds,
  topologicalPipelineOrder
} from '@asterim/shared';
import { EventBus, eventBus } from '../EventBus';
import { dbService } from '../DatabaseService';
import { ProfileService, profileService } from '../ai/ProfileService';
import { AgentDelegationService, agentDelegationService } from '../ai/AgentDelegationService';
import { PipelineParser, pipelineParser } from './PipelineParser';
import {
  WorktreeFleetError,
  WorktreeFleetService,
  worktreeFleetService
} from './WorktreeFleetService';

/** What a pipeline request can be refused for. */
export type PipelineErrorCode =
  | 'INVALID_INPUT'
  | 'PIPELINE_NOT_FOUND'
  | 'RUN_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'ALREADY_RUNNING'
  /** The run kept no worktree fleet, so there are no branches to work with. */
  | 'NO_FLEET'
  /** Asked to consolidate a run that has not finished. */
  | 'RUN_IN_PROGRESS'
  /** The branches asked for cannot be combined. */
  | 'SYNTHESIS_CONFLICT';

export class PipelineError extends Error {
  constructor(
    public readonly code: PipelineErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

/** What a cancelled run records when the caller gave no reason. */
export const DEFAULT_PIPELINE_CANCELLATION_REASON = 'Pipeline cancelled by operator';

/** A run this process is executing right now. */
interface ActiveRun {
  pipelineId: string;
  rootThreadId: string;
  /** Set by a cancellation; read by the loop between batches. */
  cancelReason?: string;
  /** The checkout the run's fleet is provisioned in, when it has one (P9-02). */
  repoPath?: string;
  /** The commit every root step branched from. */
  baseCommit?: string;
}

interface PipelineRow {
  id: string;
  workspace_id: string | null;
  name: string;
  description: string | null;
  yaml_content: string;
  created_at: number;
  updated_at: number;
}

interface RunRow {
  id: string;
  pipeline_id: string;
  status: string;
  current_step_id: string | null;
  run_context_json: string;
  project_id: string | null;
  root_thread_id: string | null;
  started_at: number;
  completed_at: number | null;
  error_message: string | null;
  base_commit: string | null;
  synthesis_branch: string | null;
  synthesis_commit: string | null;
}

interface StepRunRow {
  id: string;
  pipeline_run_id: string;
  step_id: string;
  step_name: string;
  role_profile_id: string;
  status: string;
  thread_id: string | null;
  worktree_path: string | null;
  worktree_branch: string | null;
  commit_sha: string | null;
  attempts: number | null;
  diff: string | null;
  output: string | null;
  started_at: number | null;
  completed_at: number | null;
  error_message: string | null;
}

export class PipelineEngine {
  /** Run id → the run this process is executing. Empty after a restart. */
  private readonly active = new Map<string, ActiveRun>();

  constructor(
    private readonly delegation: AgentDelegationService = agentDelegationService,
    private readonly parser: PipelineParser = pipelineParser,
    private readonly profiles: ProfileService = profileService,
    private readonly bus: EventBus = eventBus,
    private readonly fleet: WorktreeFleetService = worktreeFleetService
  ) {}

  private db() {
    return dbService.getDb();
  }

  // --- Definitions ----------------------------------------------------------

  /**
   * Validates a definition and stores it.
   *
   * The YAML is stored as written and the parse is thrown away: the file is
   * what the operator will edit next, and re-serializing a parse would lose
   * their comments and their ordering the first time Asterim read it. Parsing
   * on read costs microseconds and keeps one source of truth.
   */
  public savePipeline(input: {
    id?: string;
    workspaceId?: string;
    yaml: string;
  }): Pipeline {
    const yaml = typeof input?.yaml === 'string' ? input.yaml : '';
    if (!yaml.trim()) {
      throw new PipelineError('INVALID_INPUT', 'A pipeline definition (yaml) is required.');
    }
    if (yaml.length > MAX_PIPELINE_YAML_CHARS) {
      throw new PipelineError(
        'INVALID_INPUT',
        `A pipeline definition may be at most ${MAX_PIPELINE_YAML_CHARS} characters.`
      );
    }

    // Throws `PipelineParseError`, which the REST surface turns into a 400 with
    // the line on it. Nothing reaches storage that the engine could not run.
    const definition = this.parser.parse(yaml);

    const now = Date.now();
    const existing = input.id ? this.getRow(input.id) : null;
    if (input.id && !existing) {
      throw new PipelineError('PIPELINE_NOT_FOUND', `No pipeline with id ${input.id}.`);
    }

    const id = existing?.id ?? `pipe_${crypto.randomUUID()}`;
    if (existing) {
      this.db()
        .prepare(
          `UPDATE pipelines
              SET workspace_id = ?, name = ?, description = ?, yaml_content = ?, updated_at = ?
            WHERE id = ?`
        )
        .run(
          input.workspaceId ?? existing.workspace_id ?? null,
          definition.name,
          definition.description ?? null,
          yaml,
          now,
          id
        );
    } else {
      this.db()
        .prepare(
          `INSERT INTO pipelines (id, workspace_id, name, description, yaml_content, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.workspaceId ?? null,
          definition.name,
          definition.description ?? null,
          yaml,
          now,
          now
        );
    }

    return this.requirePipeline(id);
  }

  /**
   * The pipelines a workspace can see.
   *
   * Scoped the way agent profiles are: a workspace's own, plus the ones that
   * belong to no workspace, which is every pipeline on a single-developer
   * install (DEC-028).
   */
  public listPipelines(workspaceId?: string): Pipeline[] {
    const rows = this.db()
      .prepare(
        `SELECT * FROM pipelines
          WHERE workspace_id IS NULL OR workspace_id = ?
          ORDER BY updated_at DESC`
      )
      .all(workspaceId ?? null) as unknown as PipelineRow[];
    return rows.map(row => this.toPipeline(row)).filter((entry): entry is Pipeline => !!entry);
  }

  /** One pipeline, or null when the id names nothing. */
  public getPipeline(id: string): Pipeline | null {
    const row = this.getRow(id);
    return row ? this.toPipeline(row) : null;
  }

  /** One pipeline, or a refusal a route turns into a 404. */
  public requirePipeline(id: string): Pipeline {
    const pipeline = this.getPipeline(id);
    if (!pipeline) throw new PipelineError('PIPELINE_NOT_FOUND', `No pipeline with id ${id}.`);
    return pipeline;
  }

  /** Removes a pipeline, and with it every run it ever had. */
  public deletePipeline(id: string): boolean {
    const result = this.db().prepare('DELETE FROM pipelines WHERE id = ?').run(id);
    return Number(result.changes ?? 0) > 0;
  }

  /**
   * Imports every definition a project keeps in `.asterim/pipelines/`.
   *
   * Matched by name, so re-importing an edited file updates the pipeline the
   * previous import created rather than adding a second copy of it. A file that
   * does not parse is reported and skipped; one bad definition in the directory
   * must not stop the rest from loading.
   */
  public importFromDirectory(
    projectPath: string,
    workspaceId?: string
  ): { imported: Pipeline[]; failures: Array<{ file: string; error: string }> } {
    const directory = path.join(projectPath, ...PIPELINE_DEFINITION_DIR.split('/'));
    const imported: Pipeline[] = [];
    const failures: Array<{ file: string; error: string }> = [];

    for (const entry of this.parser.parseDirectory(directory)) {
      if (!entry.definition) {
        failures.push({ file: entry.file, error: entry.error ?? 'Unreadable definition.' });
        continue;
      }
      const existing = this.listPipelines(workspaceId).find(
        pipeline => pipeline.name === entry.definition?.name
      );
      try {
        imported.push(
          this.savePipeline({
            id: existing?.id,
            workspaceId,
            yaml: fs.readFileSync(entry.file, 'utf8')
          })
        );
      } catch (err) {
        failures.push({ file: entry.file, error: (err as Error).message });
      }
    }

    return { imported, failures };
  }

  // --- Runs -----------------------------------------------------------------

  /**
   * Runs a pipeline to completion and returns what it did.
   *
   * Everything that can be refused is refused before a row exists: an unknown
   * pipeline, a definition that no longer parses, a project that is not there.
   * From the first insert onward the run always reaches a terminal status, and
   * a step's failure is part of the answer rather than an exception — by then
   * there are threads, transcripts and possibly diffs, and throwing would
   * discard them.
   */
  public async runPipeline(
    pipelineId: string,
    runContext: Record<string, unknown> = {}
  ): Promise<PipelineRun> {
    const pipeline = this.requirePipeline(pipelineId);
    const definition = pipeline.definition;

    for (const run of this.active.values()) {
      if (run.pipelineId === pipelineId) {
        throw new PipelineError(
          'ALREADY_RUNNING',
          `Pipeline ${pipelineId} already has a run in progress. Wait for it or cancel it before starting another.`
        );
      }
    }

    const context: Record<string, unknown> = { ...(definition.parameters ?? {}), ...runContext };
    const projectId = this.resolveProjectId(definition, context);
    context.projectId = projectId;

    const order = topologicalPipelineOrder(definition.steps);
    if (!order) {
      // Unreachable through `savePipeline`, which refuses a cyclic definition;
      // reachable if a row were edited outside Asterim.
      throw new PipelineError(
        'INVALID_INPUT',
        'This pipeline has no valid execution order; its steps form a cycle.'
      );
    }
    const steps = order.map(id => definition.steps.find(step => step.id === id) as PipelineStep);

    const runId = `prun_${crypto.randomUUID()}`;
    const rootThreadId = this.createRootThread(projectId, definition, runId);
    const startedAt = Date.now();

    // The fleet's base is resolved once, before the first step, so every step of
    // the run — and any synthesis of it afterwards — is measured against the
    // same commit even if the operator's HEAD moves while it is running (P9-02).
    const fleet = await this.openFleet(projectId);

    this.db()
      .prepare(
        `INSERT INTO pipeline_runs
           (id, pipeline_id, status, current_step_id, run_context_json, project_id, root_thread_id, started_at, base_commit)
         VALUES (?, ?, 'RUNNING', NULL, ?, ?, ?, ?, ?)`
      )
      .run(
        runId,
        pipeline.id,
        JSON.stringify(context),
        projectId,
        rootThreadId,
        startedAt,
        fleet?.baseCommit ?? null
      );

    for (const step of steps) {
      this.db()
        .prepare(
          `INSERT INTO pipeline_step_runs
             (id, pipeline_run_id, step_id, step_name, role_profile_id, status)
           VALUES (?, ?, ?, ?, ?, 'PENDING')`
        )
        .run(`pstep_${crypto.randomUUID()}`, runId, step.id, step.name, step.roleProfileId);
    }

    this.active.set(runId, {
      pipelineId: pipeline.id,
      rootThreadId,
      repoPath: fleet?.repoPath,
      baseCommit: fleet?.baseCommit
    });

    this.publish(PIPELINE_STARTED_EVENT, {
      projectId,
      threadId: rootThreadId,
      pipelineId: pipeline.id,
      runId,
      name: definition.name,
      stepIds: steps.map(step => step.id)
    });

    try {
      await this.execute(runId, pipeline, steps, projectId, rootThreadId, context);
    } catch (err) {
      // The loop settles every step it dispatched, so reaching here means
      // something structural went wrong — a database write, a bus subscriber.
      // The run is still owed a terminal status: a row left at RUNNING is a
      // pipeline the dashboard shows as live for the rest of the process's life.
      console.error(`[Pipeline] Run ${runId} ended unexpectedly:`, err);
      const message = `The pipeline run stopped unexpectedly: ${(err as Error).message}`;
      const now = Date.now();
      this.db()
        .prepare(
          `UPDATE pipeline_step_runs
              SET status = 'FAILED', completed_at = ?, error_message = ?
            WHERE pipeline_run_id = ? AND status IN ('PENDING', 'RUNNING')`
        )
        .run(now, message, runId);
      this.db()
        .prepare(
          `UPDATE pipeline_runs SET status = 'FAILED', completed_at = ?, error_message = ? WHERE id = ?`
        )
        .run(now, message, runId);
    } finally {
      this.active.delete(runId);
    }

    const run = this.requireRun(runId);
    const payload = {
      projectId,
      threadId: rootThreadId,
      pipelineId: pipeline.id,
      run
    };
    if (run.status === 'PASSED') {
      this.publish(PIPELINE_COMPLETED_EVENT, payload);
    } else {
      this.publish(PIPELINE_FAILED_EVENT, { ...payload, errorMessage: run.errorMessage });
    }
    return run;
  }

  /**
   * The scheduling loop: ready set, dispatch, record, repeat.
   *
   * Batched rather than fully concurrent because a step is a delegation and one
   * thread may only have `PIPELINE_MAX_PARALLEL_STEPS` children running at a
   * time. A ready set of six is two dispatches, not a refusal, and the DAG is
   * honoured either way.
   */
  private async execute(
    runId: string,
    pipeline: Pipeline,
    steps: PipelineStep[],
    projectId: string,
    rootThreadId: string,
    context: Record<string, unknown>
  ): Promise<void> {
    const statuses: Record<string, PipelineStepStatus> = {};
    for (const step of steps) statuses[step.id] = 'PENDING';
    const results = new Map<string, DelegationResult>();
    /** The checkout each step ran in, so its work can be settled onto its branch. */
    const worktrees = new Map<string, PipelineStepWorktree>();
    /** How many times each step was dispatched, retries included. */
    const attempts = new Map<string, number>();

    for (;;) {
      const cancelReason = this.active.get(runId)?.cancelReason;
      if (cancelReason) {
        this.settleRemaining(runId, steps, statuses, 'CANCELLED', cancelReason);
        this.finish(runId, statuses, cancelReason);
        return;
      }

      const ready = readyPipelineStepIds(steps, statuses).slice(0, PIPELINE_MAX_PARALLEL_STEPS);
      if (ready.length === 0) break;

      const batch = ready.map(id => steps.find(step => step.id === id) as PipelineStep);
      const outcomes = await this.dispatchWithRetries(
        runId,
        pipeline,
        batch,
        steps,
        statuses,
        results,
        projectId,
        rootThreadId,
        context,
        worktrees,
        attempts
      );

      const stopped = this.active.get(runId)?.cancelReason;
      for (let position = 0; position < batch.length; position++) {
        const step = batch[position];
        const result = outcomes[position];
        const worktree = worktrees.get(step.id);
        let passed = result?.status === 'COMPLETED';
        let failure: string | undefined;
        let commitSha: string | undefined;

        // A successor is branched from a *commit*, so a passing step's work is
        // put onto its own branch before anything downstream is planned. A
        // settle that fails is the step failing: a successor branched from the
        // previous commit would silently be handed the wrong input (P9-02).
        if (passed && worktree && !stopped) {
          try {
            const settled = await this.fleet.settleStep(
              worktree,
              `Asterim: ${pipeline.definition.name} — step ${step.id}`
            );
            commitSha = settled.commitSha;
          } catch (err) {
            passed = false;
            failure = `The step's work could not be committed to its branch: ${(err as Error).message}`;
          }
        }

        const status: PipelineStepStatus = passed ? 'PASSED' : stopped ? 'CANCELLED' : 'FAILED';

        statuses[step.id] = status;
        if (result) results.set(step.id, result);
        this.recordStepOutcome(runId, step, status, result, stopped, {
          attempts: attempts.get(step.id) ?? 0,
          branch: worktree?.branch,
          commitSha,
          failure
        });
        this.publishStepCompleted(runId, pipeline.id, projectId, rootThreadId, step.id);
      }

      if (stopped) {
        this.settleRemaining(runId, steps, statuses, 'CANCELLED', stopped);
        this.finish(runId, statuses, stopped);
        return;
      }

      const failed = batch.filter(step => statuses[step.id] !== 'PASSED');
      if (failed.length > 0) {
        const reason = `Step '${failed[0].id}' did not pass; the pipeline stopped.`;
        // Everything still pending would have run on input that never arrived.
        this.settleRemaining(runId, steps, statuses, 'SKIPPED', 'An upstream step did not pass.');
        this.finish(runId, statuses, reason);
        return;
      }
    }

    this.finish(runId, statuses);
  }

  /**
   * One batch, dispatched and then re-dispatched for the steps that may retry
   * (P9-02).
   *
   * A retry is a fresh delegation in a fresh checkout, not a resumption of the
   * session that failed: what is usually being retried *is* the session — an
   * agent process that died on boot, a network call it made that timed out —
   * and handing the next attempt the last one's half-written files would be a
   * different piece of work from the one the definition asked for.
   *
   * Only the failed steps of a batch are retried, and only while the run has
   * not been cancelled; the wait between attempts is interruptible for the same
   * reason, because a sixty-second `retryDelayMs` must not be sixty seconds of
   * a cancel button that has not done anything yet.
   */
  private async dispatchWithRetries(
    runId: string,
    pipeline: Pipeline,
    batch: PipelineStep[],
    steps: PipelineStep[],
    statuses: Record<string, PipelineStepStatus>,
    results: Map<string, DelegationResult>,
    projectId: string,
    rootThreadId: string,
    context: Record<string, unknown>,
    worktrees: Map<string, PipelineStepWorktree>,
    attempts: Map<string, number>
  ): Promise<Array<DelegationResult | null>> {
    const outcomes = await this.dispatch(
      runId,
      pipeline,
      batch,
      steps,
      statuses,
      results,
      projectId,
      rootThreadId,
      context,
      worktrees,
      attempts
    );

    for (;;) {
      if (this.active.get(runId)?.cancelReason) return outcomes;

      const retrying = batch.filter((step, position) => {
        const failed = outcomes[position]?.status !== 'COMPLETED';
        const used = attempts.get(step.id) ?? 1;
        return failed && used <= Math.max(0, step.retries ?? 0);
      });
      if (retrying.length === 0) return outcomes;

      const delay = Math.max(0, ...retrying.map(step => Math.max(0, step.retryDelayMs ?? 0)));
      if (delay > 0 && !(await this.waitBetweenAttempts(runId, delay))) return outcomes;

      for (const step of retrying) {
        console.log(
          `[Pipeline] Retrying step '${step.id}' of run ${runId} (attempt ${(attempts.get(step.id) ?? 1) + 1} of ${(step.retries ?? 0) + 1}).`
        );
      }

      const retried = await this.dispatch(
        runId,
        pipeline,
        retrying,
        steps,
        statuses,
        results,
        projectId,
        rootThreadId,
        context,
        worktrees,
        attempts
      );

      for (let position = 0; position < retrying.length; position++) {
        const index = batch.indexOf(retrying[position]);
        if (index >= 0) outcomes[index] = retried[position];
      }
    }
  }

  /**
   * Waits out a step's `retryDelayMs`, answering `false` if the run was stopped.
   *
   * In slices, so a cancellation that lands during the wait is acted on within
   * a tick rather than at the end of a minute.
   */
  private async waitBetweenAttempts(runId: string, delayMs: number): Promise<boolean> {
    const deadline = Date.now() + delayMs;
    while (Date.now() < deadline) {
      if (this.active.get(runId)?.cancelReason) return false;
      const slice = Math.min(100, deadline - Date.now());
      if (slice <= 0) break;
      await new Promise(resolve => setTimeout(resolve, slice));
    }
    return !this.active.get(runId)?.cancelReason;
  }

  /** Starts one batch of ready steps and waits for all of them. */
  private async dispatch(
    runId: string,
    pipeline: Pipeline,
    batch: PipelineStep[],
    steps: PipelineStep[],
    statuses: Record<string, PipelineStepStatus>,
    results: Map<string, DelegationResult>,
    projectId: string,
    rootThreadId: string,
    context: Record<string, unknown>,
    worktrees: Map<string, PipelineStepWorktree>,
    attempts: Map<string, number>
  ): Promise<Array<DelegationResult | null>> {
    const startedAt = Date.now();

    for (const step of batch) {
      statuses[step.id] = 'RUNNING';
      attempts.set(step.id, (attempts.get(step.id) ?? 0) + 1);
      this.db()
        .prepare(
          `UPDATE pipeline_step_runs SET status = 'RUNNING', started_at = ?, attempts = ?
            WHERE pipeline_run_id = ? AND step_id = ?`
        )
        .run(startedAt, attempts.get(step.id) ?? 1, runId, step.id);
      this.publish(PIPELINE_STEP_STARTED_EVENT, {
        projectId,
        threadId: rootThreadId,
        pipelineId: pipeline.id,
        runId,
        stepId: step.id,
        stepName: step.name,
        roleProfileId: step.roleProfileId,
        batchStepIds: batch.map(entry => entry.id),
        attempt: attempts.get(step.id) ?? 1
      });
    }

    this.db()
      .prepare('UPDATE pipeline_runs SET current_step_id = ? WHERE id = ?')
      .run(batch[0].id, runId);

    // Each step gets its own checkout, branched from its ancestors' rather than
    // from the repository's HEAD, so a downstream step reads the code its
    // predecessors actually wrote (P9-02). A step whose checkout cannot be
    // provisioned — most often because two ancestors of a join conflict — fails
    // without an agent ever being started, which is the fail-closed answer: a
    // step run on half its input answers a question nobody asked.
    const failures = new Map<string, DelegationResult>();
    const dispatchable: PipelineStep[] = [];
    for (const step of batch) {
      worktrees.delete(step.id);
      try {
        const worktree = await this.provisionStepWorktree(runId, step, steps);
        if (worktree) worktrees.set(step.id, worktree);
        dispatchable.push(step);
      } catch (err) {
        const message =
          err instanceof WorktreeFleetError
            ? err.message
            : `The step's checkout could not be provisioned: ${(err as Error).message}`;
        console.warn(`[Pipeline] Step '${step.id}' of run ${runId} was not started: ${message}`);
        failures.set(step.id, {
          childThreadId: '',
          status: 'FAILED',
          summary: message,
          output: ''
        });
      }
    }

    const requests = dispatchable.map(step => {
      const worktree = worktrees.get(step.id);
      return {
        ...this.targetFor(step),
        // Substitution can lengthen a task the parser already bounded — a
        // parameter is a value the caller supplies — so the brief is cut back to
        // what a delegation accepts rather than refused by it.
        taskDescription: truncate(substitute(step.task, context), MAX_PIPELINE_TASK_CHARS),
        inputContext: this.buildStepContext(pipeline.definition, step, steps, results, context),
        timeoutMs: step.timeoutMs,
        isolateWorktree: step.isolateWorktree,
        verifyPipeline: step.verifyPipeline,
        verificationSteps: step.verificationSteps,
        // Set only when the fleet provisioned one; without it a delegation
        // sandboxes itself exactly as it did in P9-01.
        ...(worktree
          ? {
              sandbox: {
                path: worktree.path,
                branch: worktree.branch,
                baseCommit: worktree.baseCommit
              }
            }
          : {})
      };
    });

    const answer = (outcomes: Map<string, DelegationResult | null>): Array<DelegationResult | null> =>
      batch.map(step => failures.get(step.id) ?? outcomes.get(step.id) ?? null);

    if (requests.length === 0) return answer(new Map());

    try {
      const outcomes = new Map<string, DelegationResult | null>();
      if (requests.length === 1) {
        outcomes.set(
          dispatchable[0].id,
          await this.delegation.delegateTask(
            { parentThreadId: rootThreadId, ...requests[0] },
            // The root thread has no agent session of its own: it is a container
            // for the run's children, and a report written into it would be text
            // nobody reads.
            { resumeParent: false }
          )
        );
        return answer(outcomes);
      }

      const outcome = await this.delegation.delegateParallel(
        { parentThreadId: rootThreadId, delegations: requests },
        { resumeParent: false }
      );
      // `delegateParallel` answers in the order it was asked, which is the order
      // of `dispatchable`, so a result can be matched to its step by position.
      dispatchable.forEach((step, position) => {
        outcomes.set(step.id, outcome.results[position] ?? null);
      });
      return answer(outcomes);
    } catch (err) {
      // A refusal from the delegation service — an unresolvable role, a thread
      // that vanished — is the batch's failure, not the Core's. Every step in it
      // fails with the same reason.
      console.error(`[Pipeline] Batch dispatch failed for run ${runId}:`, err);
      const message = (err as Error).message;
      const outcomes = new Map<string, DelegationResult | null>(
        dispatchable.map(step => [
          step.id,
          { childThreadId: '', status: 'FAILED' as const, summary: message, output: '' }
        ])
      );
      return answer(outcomes);
    }
  }

  /**
   * The checkout one step runs in, chained from the steps it depends on.
   *
   * `null` — and not an error — when the run has no fleet: a project that is not
   * a git repository, or one with no commits, is a pipeline that runs the way it
   * did in P9-01, with each step sandboxed by its own delegation. A step that
   * explicitly declares `isolateWorktree: false` is left alone too, because that
   * is an operator saying the step must see the project as it is.
   */
  private async provisionStepWorktree(
    runId: string,
    step: PipelineStep,
    steps: PipelineStep[]
  ): Promise<PipelineStepWorktree | null> {
    const active = this.active.get(runId);
    if (!active?.repoPath || !active.baseCommit) return null;
    if (step.isolateWorktree === false) return null;

    // Direct dependencies, and that is enough to be transitive: each of them was
    // chained from *its* dependencies, so a documentation step branched from a
    // test step's branch already carries the implementation two levels up.
    const chainFrom = step.dependsOn.filter(id => steps.some(entry => entry.id === id));

    return this.fleet.provisionStep({
      repoPath: active.repoPath,
      runId,
      stepId: step.id,
      baseCommit: active.baseCommit,
      chainFrom
    });
  }

  /**
   * The checkout and commit a run's fleet works from, or `null` for no fleet.
   *
   * Never throws: a project that is not a repository, one with no commits, or a
   * workstation with no git at all is a pipeline that runs the way it did in
   * P9-01. A run that refused to start over a missing fleet would be a
   * regression for every project that never had one.
   */
  private async openFleet(
    projectId: string
  ): Promise<{ repoPath: string; baseCommit: string } | null> {
    const row = this.db().prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as
      | unknown as { path?: string }
      | undefined;
    const repoPath = row?.path;
    if (!repoPath || !fs.existsSync(path.join(repoPath, '.git'))) return null;

    try {
      return { repoPath, baseCommit: await this.fleet.resolveRunBase(repoPath) };
    } catch (err) {
      console.warn(
        `[Pipeline] Project ${projectId} gets no worktree fleet; its steps sandbox themselves: ${(err as Error).message}`
      );
      return null;
    }
  }

  /**
   * Which profile a step runs as.
   *
   * An id that names a profile is passed as an id; anything else is passed as a
   * role, which the delegation service matches against roles and names. Sending
   * an unresolvable id would be refused outright, and the whole point of
   * accepting a role is that a definition can name "Security Auditor" without
   * knowing what that profile's id is on this workstation.
   */
  private targetFor(step: PipelineStep): { profileId?: string; targetRole?: string } {
    return this.profiles.getProfile(step.roleProfileId)
      ? { profileId: step.roleProfileId }
      : { targetRole: step.roleProfileId };
  }

  /**
   * What a step is told about the run it is part of.
   *
   * Its ancestors' summaries, their output and their diffs — transitively, so a
   * documentation step that depends on a test step is still told what the
   * implementation two levels up actually changed. Bounded as a whole rather
   * than per ancestor: this is prompt text, and the newest ancestors are the
   * ones worth keeping when it does not all fit.
   */
  public buildStepContext(
    definition: PipelineDefinition,
    step: PipelineStep,
    steps: PipelineStep[],
    results: Map<string, DelegationResult>,
    context: Record<string, unknown>
  ): string {
    const sections: string[] = [];

    const parameters = Object.entries(context).filter(
      ([, value]) => value !== undefined && value !== null && typeof value !== 'object'
    );
    if (parameters.length > 0) {
      sections.push(
        [`## Pipeline: ${definition.name}`, '## Run parameters']
          .concat(parameters.map(([key, value]) => `- ${key}: ${String(value)}`))
          .join('\n')
      );
    }

    const ancestors = pipelineAncestorIds(steps, step.id);
    for (const ancestorId of ancestors) {
      const ancestor = steps.find(entry => entry.id === ancestorId);
      const result = results.get(ancestorId);
      if (!ancestor || !result) continue;

      const lines = [`## Completed step: ${ancestor.id} — ${ancestor.name}`];
      if (result.role) lines.push(`Role: ${result.role}`);
      if (result.summary) lines.push(`Summary: ${result.summary}`);
      if (result.changedFiles?.length) {
        lines.push(`Changed files: ${result.changedFiles.join(', ')}`);
      }
      if (result.output) {
        lines.push('Output:', truncate(result.output, 4000));
      }
      if (result.diff) {
        lines.push('Diff:', '```diff', truncate(result.diff, 6000), '```');
      }
      sections.push(lines.join('\n'));
    }

    if (step.inputContext) sections.push(substitute(step.inputContext, context));

    const joined = sections.join('\n\n');
    if (joined.length <= MAX_PIPELINE_CONTEXT_CHARS) return joined;

    // Kept from the end — the nearest ancestors are the ones this step's work
    // actually builds on — and inside the bound including the notice, because
    // the delegation service refuses a context longer than it accepts rather
    // than trimming one.
    const notice = '[earlier pipeline context omitted]\n\n';
    return (
      notice + joined.slice(joined.length - (MAX_PIPELINE_CONTEXT_CHARS - notice.length))
    );
  }

  /** Writes one settled step to its row. */
  private recordStepOutcome(
    runId: string,
    step: PipelineStep,
    status: PipelineStepStatus,
    result: DelegationResult | null,
    cancelReason?: string,
    fleet?: {
      /** How many times the step was dispatched, retries included (P9-02). */
      attempts?: number;
      branch?: string;
      commitSha?: string;
      /** A failure the delegation did not report, such as a settle that failed. */
      failure?: string;
    }
  ): void {
    const failure =
      status === 'PASSED'
        ? null
        : status === 'CANCELLED'
          ? (cancelReason ?? DEFAULT_PIPELINE_CANCELLATION_REASON)
          : (fleet?.failure ?? result?.summary ?? 'The step did not complete.');

    // What the attempts add up to belongs on the row rather than in a log line:
    // "passed" and "passed on the third try" are different facts about a step,
    // and only one of them says the step is flaky.
    const attempted = Math.max(1, fleet?.attempts ?? 1);
    const note =
      attempted > 1 && failure
        ? `${failure} (after ${attempted} attempts)`
        : failure;

    this.db()
      .prepare(
        `UPDATE pipeline_step_runs
            SET status = ?, thread_id = ?, worktree_path = ?, worktree_branch = ?, commit_sha = ?,
                attempts = ?, diff = ?, output = ?, completed_at = ?, error_message = ?
          WHERE pipeline_run_id = ? AND step_id = ?`
      )
      .run(
        status,
        result?.childThreadId || null,
        result?.worktreePath ?? null,
        fleet?.branch ?? null,
        fleet?.commitSha ?? null,
        attempted,
        result?.diff ? truncate(result.diff, MAX_PIPELINE_STEP_DIFF_CHARS) : null,
        result?.output ? truncate(result.output, MAX_PIPELINE_STEP_OUTPUT_CHARS) : null,
        Date.now(),
        note,
        runId,
        step.id
      );
  }

  /** Marks everything still pending, for a run that is not going to run it. */
  private settleRemaining(
    runId: string,
    steps: PipelineStep[],
    statuses: Record<string, PipelineStepStatus>,
    status: PipelineStepStatus,
    reason: string
  ): void {
    for (const step of steps) {
      if (statuses[step.id] !== 'PENDING' && statuses[step.id] !== 'RUNNING') continue;
      statuses[step.id] = status;
      this.db()
        .prepare(
          `UPDATE pipeline_step_runs
              SET status = ?, completed_at = ?, error_message = ?
            WHERE pipeline_run_id = ? AND step_id = ?`
        )
        .run(status, Date.now(), reason, runId, step.id);
    }
  }

  /** Writes the run's terminal status. */
  private finish(
    runId: string,
    statuses: Record<string, PipelineStepStatus>,
    errorMessage?: string
  ): void {
    const status = aggregatePipelineRunStatus(Object.values(statuses));
    this.db()
      .prepare(
        `UPDATE pipeline_runs
            SET status = ?, completed_at = ?, error_message = ?
          WHERE id = ?`
      )
      .run(status, Date.now(), errorMessage ?? null, runId);
  }

  /**
   * Stops a run and everything it has running.
   *
   * The steps are stopped through the delegation service, which is what owns
   * their sessions: it ends each child's wait, stops its process, and settles
   * its row. Only then does the loop see the cancellation and mark the rest.
   *
   * A run this process is not executing — one a restart left behind — is
   * settled in storage alone, because there is nothing running to stop and a
   * row still claiming `RUNNING` is a dashboard showing a pipeline that will
   * never move again.
   */
  public async cancelPipeline(runId: string, reason?: string): Promise<boolean> {
    const row = this.getRunRow(runId);
    if (!row) throw new PipelineError('RUN_NOT_FOUND', `No pipeline run with id ${runId}.`);
    if (isTerminalPipelineRunStatus(row.status as PipelineRunStatus)) return false;

    const why = (reason ?? '').trim() || DEFAULT_PIPELINE_CANCELLATION_REASON;
    const active = this.active.get(runId);

    if (!active) {
      this.db()
        .prepare(
          `UPDATE pipeline_step_runs
              SET status = 'CANCELLED', completed_at = ?, error_message = ?
            WHERE pipeline_run_id = ? AND status IN ('PENDING', 'RUNNING')`
        )
        .run(Date.now(), why, runId);
      this.db()
        .prepare(
          `UPDATE pipeline_runs SET status = 'CANCELLED', completed_at = ?, error_message = ? WHERE id = ?`
        )
        .run(Date.now(), why, runId);
      const settled = this.requireRun(runId);
      this.publish(PIPELINE_FAILED_EVENT, {
        projectId: settled.projectId ?? '',
        threadId: settled.rootThreadId,
        pipelineId: settled.pipelineId,
        run: settled,
        errorMessage: why
      });
      return true;
    }

    // Recorded before the children are stopped, so the loop reads it as soon as
    // the batch it is waiting on settles, whichever way that batch settles.
    active.cancelReason = why;
    try {
      await this.delegation.cancelAllDelegations(active.rootThreadId, why);
    } catch (err) {
      console.warn(`[Pipeline] Cancelling run ${runId} could not stop every step:`, err);
    }
    return true;
  }

  /**
   * Settles runs a previous process was in the middle of (P9-01).
   *
   * No delegation survives a restart — the sessions are gone with the process
   * that owned them — so a row still claiming `RUNNING` is describing something
   * that stopped when the Core did. Left alone it would show as live forever.
   */
  public recoverRuns(reason = 'Server restarted while the pipeline was running'): number {
    const rows = this.db()
      .prepare("SELECT id FROM pipeline_runs WHERE status IN ('PENDING', 'RUNNING')")
      .all() as unknown as Array<{ id: string }>;

    for (const row of rows) {
      this.db()
        .prepare(
          `UPDATE pipeline_step_runs
              SET status = 'CANCELLED', completed_at = ?, error_message = ?
            WHERE pipeline_run_id = ? AND status IN ('PENDING', 'RUNNING')`
        )
        .run(Date.now(), reason, row.id);
      this.db()
        .prepare(
          `UPDATE pipeline_runs SET status = 'CANCELLED', completed_at = ?, error_message = ? WHERE id = ?`
        )
        .run(Date.now(), reason, row.id);
    }

    if (rows.length > 0) {
      console.log(`[Pipeline] Settled ${rows.length} run(s) the previous process left running.`);
    }
    return rows.length;
  }

  /** One run with every step it planned, or null. */
  public getRun(runId: string): PipelineRun | null {
    const row = this.getRunRow(runId);
    return row ? this.toRun(row) : null;
  }

  /** One run, or a refusal a route turns into a 404. */
  public requireRun(runId: string): PipelineRun {
    const run = this.getRun(runId);
    if (!run) throw new PipelineError('RUN_NOT_FOUND', `No pipeline run with id ${runId}.`);
    return run;
  }

  // --- Fleet (P9-02) --------------------------------------------------------

  /**
   * Whether a run's step branches could be combined, and where they could not.
   *
   * Asked of the branches rather than of the steps' diffs, because "these two
   * agents both edited this file" and "these two agents wrote things git cannot
   * reconcile" are different questions and only the second one stops a merge.
   * Nothing is changed by asking; see `WorktreeFleetService.analyzeConflicts`.
   *
   * Every step that has a branch is analyzed, not only the ones that passed: a
   * failed step's branch still exists, and an operator deciding what to keep is
   * owed the same answer about it.
   */
  public async analyzeRunConflicts(runId: string): Promise<PipelineConflictAnalysis> {
    const run = this.requireRun(runId);
    const { repoPath, baseCommit } = this.requireFleet(run);
    return this.fleet.analyzeConflicts(
      repoPath,
      run.id,
      run.steps.map(step => step.stepId),
      baseCommit
    );
  }

  /**
   * Consolidates a run's passing steps into one branch an operator can merge.
   *
   * Refused while the run is still going: consolidating a pipeline mid-flight
   * would produce a branch that claims to be the run's result and is not. A
   * conflict is refused too, with the paths on it, rather than resolved — which
   * step's version of a file is right is not a question an orchestrator can
   * answer, and guessing would put a wrong merge on a branch somebody is about
   * to open a pull request from.
   *
   * The branch is left behind on purpose; nothing is merged into the operator's
   * own branch here, and nothing in this call touches their working tree.
   */
  public async synthesizeRun(
    runId: string,
    options: { stepIds?: string[]; message?: string } = {}
  ): Promise<PipelineSynthesisResult> {
    const run = this.requireRun(runId);
    if (!isTerminalPipelineRunStatus(run.status)) {
      throw new PipelineError(
        'RUN_IN_PROGRESS',
        `Run ${runId} is still ${run.status.toLowerCase()}. Wait for it to finish, or cancel it, before consolidating its work.`
      );
    }
    const { repoPath, baseCommit } = this.requireFleet(run);

    const wanted = options.stepIds?.length ? new Set(options.stepIds) : null;
    const steps = run.steps
      .filter(step => step.status === 'PASSED')
      .filter(step => !wanted || wanted.has(step.stepId))
      .map(step => ({
        stepId: step.stepId,
        stepName: step.stepName,
        roleProfileId: step.roleProfileId
      }));

    if (steps.length === 0) {
      throw new PipelineError(
        'INVALID_INPUT',
        `Run ${runId} has no passing step to consolidate.`
      );
    }

    try {
      const result = await this.fleet.synthesize({
        repoPath,
        runId: run.id,
        baseCommit,
        steps,
        pipelineName: this.getPipeline(run.pipelineId)?.name,
        message: options.message
      });
      this.db()
        .prepare('UPDATE pipeline_runs SET synthesis_branch = ?, synthesis_commit = ? WHERE id = ?')
        .run(result.branchName, result.commitSha, run.id);
      return result;
    } catch (err) {
      if (err instanceof WorktreeFleetError) {
        throw new PipelineError(
          err.code === 'SYNTHESIS_CONFLICT'
            ? 'SYNTHESIS_CONFLICT'
            : err.code === 'NOTHING_TO_SYNTHESIZE'
              ? 'INVALID_INPUT'
              : 'NO_FLEET',
          err.message
        );
      }
      throw err;
    }
  }

  /** The checkout and base commit a run's fleet lives in, or a refusal. */
  private requireFleet(run: PipelineRun): { repoPath: string; baseCommit: string } {
    const row = run.projectId
      ? (this.db().prepare('SELECT path FROM projects WHERE id = ?').get(run.projectId) as
          | unknown as { path?: string }
          | undefined)
      : undefined;
    if (!run.baseCommit || !row?.path) {
      throw new PipelineError(
        'NO_FLEET',
        `Run ${run.id} kept no worktree fleet — its project is not a git repository, or it predates P9-02 — so there are no step branches to work with.`
      );
    }
    return { repoPath: row.path, baseCommit: run.baseCommit };
  }

  /** A pipeline's runs, newest first. */
  public listRuns(pipelineId: string, limit = 20): PipelineRun[] {
    const rows = this.db()
      .prepare(
        'SELECT * FROM pipeline_runs WHERE pipeline_id = ? ORDER BY started_at DESC LIMIT ?'
      )
      .all(pipelineId, Math.max(1, Math.min(100, limit))) as unknown as RunRow[];
    return rows.map(row => this.toRun(row));
  }

  // --- Internals ------------------------------------------------------------

  private getRow(id: string): PipelineRow | null {
    if (!id) return null;
    const row = this.db().prepare('SELECT * FROM pipelines WHERE id = ?').get(id) as
      | unknown as PipelineRow
      | undefined;
    return row ?? null;
  }

  private getRunRow(id: string): RunRow | null {
    if (!id) return null;
    const row = this.db().prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(id) as
      | unknown as RunRow
      | undefined;
    return row ?? null;
  }

  /**
   * A stored row as a pipeline, or `null` when its YAML no longer parses.
   *
   * Only reachable through a hand-edited database or a downgrade — nothing that
   * fails to parse is ever stored — and dropping such a row from a list is
   * better than an exception that empties the whole list.
   */
  private toPipeline(row: PipelineRow): Pipeline | null {
    let definition: PipelineDefinition;
    try {
      definition = this.parser.parse(row.yaml_content, { validateRoles: false });
    } catch (err) {
      console.warn(
        `[Pipeline] Stored pipeline ${row.id} no longer parses: ${(err as Error).message}`
      );
      return null;
    }

    return {
      id: row.id,
      workspaceId: row.workspace_id ?? undefined,
      name: row.name,
      description: row.description ?? undefined,
      yaml: row.yaml_content,
      definition,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private toRun(row: RunRow): PipelineRun {
    const steps = this.db()
      .prepare('SELECT * FROM pipeline_step_runs WHERE pipeline_run_id = ? ORDER BY rowid ASC')
      .all(row.id) as unknown as StepRunRow[];

    let runContext: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.run_context_json || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) runContext = parsed;
    } catch {
      /* A context that cannot be read is reported as none rather than as a crash. */
    }

    return {
      id: row.id,
      pipelineId: row.pipeline_id,
      status: row.status as PipelineRunStatus,
      currentStepId: row.current_step_id ?? undefined,
      runContext,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      errorMessage: row.error_message ?? undefined,
      rootThreadId: row.root_thread_id ?? undefined,
      projectId: row.project_id ?? undefined,
      baseCommit: row.base_commit ?? undefined,
      synthesisBranch: row.synthesis_branch ?? undefined,
      synthesisCommit: row.synthesis_commit ?? undefined,
      steps: steps.map(step => this.toStepRun(step))
    };
  }

  private toStepRun(row: StepRunRow): PipelineStepRun {
    return {
      id: row.id,
      pipelineRunId: row.pipeline_run_id,
      stepId: row.step_id,
      stepName: row.step_name,
      roleProfileId: row.role_profile_id,
      status: row.status as PipelineStepStatus,
      threadId: row.thread_id ?? undefined,
      worktreePath: row.worktree_path ?? undefined,
      worktreeBranch: row.worktree_branch ?? undefined,
      commitSha: row.commit_sha ?? undefined,
      attempts: row.attempts ?? undefined,
      diff: row.diff ?? undefined,
      output: row.output ?? undefined,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      errorMessage: row.error_message ?? undefined
    };
  }

  /**
   * Which checkout the run's agents work in.
   *
   * The run may name one, the definition may name one, and neither is required
   * to — but a run with no project has no directory to run an agent in, so the
   * absence is refused here rather than discovered by the first step.
   */
  private resolveProjectId(
    definition: PipelineDefinition,
    context: Record<string, unknown>
  ): string {
    const fromContext = typeof context.projectId === 'string' ? context.projectId.trim() : '';
    const projectId = fromContext || definition.projectId || '';
    if (!projectId) {
      throw new PipelineError(
        'INVALID_INPUT',
        'This pipeline names no project. Declare `projectId:` in the definition or pass one in the run context.'
      );
    }

    const project = this.db().prepare('SELECT id FROM projects WHERE id = ?').get(projectId) as
      | unknown as { id: string }
      | undefined;
    if (!project) {
      throw new PipelineError('PROJECT_NOT_FOUND', `No project with id ${projectId}.`);
    }
    return projectId;
  }

  /**
   * The thread every step of a run is delegated from.
   *
   * A real thread rather than a synthetic id: the delegation service hangs each
   * child off it, the depth guard is computed from it, and the dashboard's
   * thread tree is what shows a run's steps as what they are — children of one
   * piece of work.
   */
  private createRootThread(
    projectId: string,
    definition: PipelineDefinition,
    runId: string
  ): string {
    const threadId = crypto.randomUUID();
    this.db()
      .prepare('INSERT INTO threads (id, project_id, name) VALUES (?, ?, ?)')
      .run(threadId, projectId, `Pipeline: ${definition.name} (${runId.slice(0, 13)})`);
    return threadId;
  }

  private publishStepCompleted(
    runId: string,
    pipelineId: string,
    projectId: string,
    rootThreadId: string,
    stepId: string
  ): void {
    const step = this.requireRun(runId).steps.find(entry => entry.stepId === stepId);
    if (!step) return;
    this.publish(PIPELINE_STEP_COMPLETED_EVENT, {
      projectId,
      threadId: rootThreadId,
      pipelineId,
      runId,
      step
    });
  }

  private publish(type: string, payload: Record<string, unknown>): void {
    this.bus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server:pipeline',
      type,
      payload
    });
  }
}

export const pipelineEngine = new PipelineEngine();

// --- Text --------------------------------------------------------------------

/**
 * Substitutes `{{ name }}` placeholders from the run's context.
 *
 * Only names the context actually holds are replaced; an unknown placeholder is
 * left exactly as written, so a task that talks about `{{ }}` syntax survives
 * and a missing parameter is visible in the brief rather than silently blank.
 */
export function substitute(text: string, context: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (whole, name: string) => {
    const value = context[name];
    if (value === undefined || value === null || typeof value === 'object') return whole;
    return String(value);
  });
}

/**
 * Cuts text to `limit` characters, marker included.
 *
 * The marker is inside the bound rather than added to it on purpose: these
 * bounds are the delegation service's, which *refuses* a brief or a context
 * longer than it accepts, so "the limit plus twelve" would be a step that fails
 * to dispatch rather than one that says slightly less than it wanted to.
 */
function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const marker = '\n[truncated]';
  return `${text.slice(0, Math.max(0, limit - marker.length))}${marker}`;
}
