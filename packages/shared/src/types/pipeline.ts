/**
 * Declarative Multi-Agent Pipelines contract (Phase 9, P9-01).
 *
 * A pipeline is a Directed Acyclic Graph of delegated steps written down once
 * and run many times. Each step names a role, describes work, and declares which
 * other steps must have passed before it may begin; the engine derives the order
 * from those declarations rather than from the order they happen to be listed
 * in, which is what lets independent steps run at the same time without anyone
 * having to say so.
 *
 * Four things in here are load-bearing rather than cosmetic:
 *
 *   - **`dependsOn` is the whole schedule.** There is no `parallel:` block and
 *     no `stage:` grouping. Two steps run together exactly when neither can
 *     reach the other through dependencies, so a definition cannot claim a
 *     parallelism its data dependencies contradict.
 *   - **A cycle is a parse error, not a runtime one.** A DAG that loops has no
 *     first step, so there is nothing to start; discovering that after two
 *     agents have already edited a repository would be discovering it too late.
 *   - **The run's status is not the last step's.** `PASSED` requires every step
 *     to have passed. A run with one failure is `FAILED` however many steps
 *     succeeded before it, which is what "fail-closed" means for a pipeline.
 *   - **`SKIPPED` and `CANCELLED` are different answers.** A step downstream of
 *     a failure never ran because its input never existed; a step in a run an
 *     operator stopped never ran because a person said so. Folding them
 *     together would lose the only fact that distinguishes a broken pipeline
 *     from an abandoned one.
 */

import { MAX_CONCURRENT_DELEGATIONS } from './delegation';

/** What starts a pipeline run. */
export type PipelineTriggerType = 'MANUAL' | 'GIT_COMMIT' | 'FILE_CHANGE' | 'SCHEDULE';

/** Where a whole run sits. `PASSED` means every step passed. */
export type PipelineRunStatus = 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED';

/**
 * Where one step of a run sits.
 *
 * `SKIPPED` is reserved for a step whose ancestors did not pass, so it was
 * never eligible to start; `CANCELLED` for one an operator's stop reached.
 */
export type PipelineStepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'PASSED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED';

/**
 * Where a project's hand-written pipeline definitions live.
 *
 * Inside `.asterim/` for the reason the verification pipeline's config files
 * are (P8-02): that directory is already kept out of Git tracking for worktree
 * sandboxes, so a workstation-local pipeline does not become a commit in the
 * operator's repository.
 */
export const PIPELINE_DEFINITION_DIR = '.asterim/pipelines';

/** The file extensions a pipeline definition may be written in. */
export const PIPELINE_DEFINITION_EXTENSIONS: readonly string[] = ['.yaml', '.yml'];

/** How many steps one pipeline may declare. */
export const MAX_PIPELINE_STEPS = 25;

/** The largest definition accepted, so one POST cannot fill the database. */
export const MAX_PIPELINE_YAML_CHARS = 262144;

export const MAX_PIPELINE_NAME_CHARS = 120;
export const MAX_PIPELINE_DESCRIPTION_CHARS = 2000;

/** The longest task description one step may carry, matching a delegation's. */
export const MAX_PIPELINE_TASK_CHARS = 20000;

/** How much context a step is handed, matching a delegation's input bound. */
export const MAX_PIPELINE_CONTEXT_CHARS = 60000;

/** How much of a step's transcript is kept on its row. */
export const MAX_PIPELINE_STEP_OUTPUT_CHARS = 20000;

/** How much of a step's sandbox diff is kept on its row. */
export const MAX_PIPELINE_STEP_DIFF_CHARS = 20000;

/** How many `parameters:` entries a definition may declare. */
export const MAX_PIPELINE_PARAMETERS = 50;

/**
 * How many steps of one run may execute at the same time.
 *
 * The delegation bound, deliberately, and not a second number: every step is a
 * delegated child of the run's root thread, so this *is* that limit. A ready set
 * wider than this is run in batches rather than refused — the DAG is still
 * honoured, it simply takes more than one pass.
 */
export const PIPELINE_MAX_PARALLEL_STEPS = MAX_CONCURRENT_DELEGATIONS;

/**
 * What a step id may look like.
 *
 * Step ids appear in `dependsOn`, in event payloads and in the brief a step is
 * handed, so they are kept to something a person can type and a log can be
 * grepped for.
 */
export const PIPELINE_STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Whether a string is usable as a step id. */
export function isValidPipelineStepId(id: string): boolean {
  return PIPELINE_STEP_ID_PATTERN.test(id);
}

/**
 * How many times a step may be re-dispatched after a failure (P9-02).
 *
 * Three, and not more, because a retry is only ever worth doing for a failure
 * that is *transient* — an agent process that died on boot, a network call the
 * step made that timed out — and a step that has failed four times is failing
 * for a reason the fifth attempt will meet as well. Each attempt is a whole
 * agent session, so an unbounded `retries:` in a hand-written file would be a
 * pipeline that never fails and never finishes.
 */
export const MAX_PIPELINE_STEP_RETRIES = 3;

/** How long a step may be made to wait between attempts. */
export const MAX_PIPELINE_RETRY_DELAY_MS = 60000;

/** One node of the DAG. */
export interface PipelineStep {
  /** Unique within the pipeline, and what `dependsOn` names. */
  id: string;
  /** What this step is called in the dashboard and in events. */
  name: string;
  /**
   * The role this step runs as: an agent profile id, or a role/name the
   * catalogue resolves — the same two readings a delegation's target accepts.
   */
  roleProfileId: string;
  /** What the step's agent is asked to do. */
  task: string;
  /** Steps that must have passed before this one may start. */
  dependsOn: string[];
  /** Anything the step needs that its ancestors' output will not contain. */
  inputContext?: string;
  /** How long this step's agent may run before it is abandoned. */
  timeoutMs?: number;
  /** Whether the step's agent gets its own worktree; unset means the default. */
  isolateWorktree?: boolean;
  /** Whether the step's work is verified before it is reported; unset is the default. */
  verifyPipeline?: boolean;
  /** Which discovered verification steps to run, by name. */
  verificationSteps?: string[];
  /**
   * How many extra attempts this step gets after a failure (P9-02).
   *
   * Unset and `0` mean the same thing — one attempt — and the retry is a fresh
   * delegation in a fresh sandbox rather than a resumption of the session that
   * failed, because the failure being retried is usually the session itself.
   */
  retries?: number;
  /** How long to wait before the next attempt. Unset means immediately. */
  retryDelayMs?: number;
}

/** A whole pipeline, as the YAML declares it. */
export interface PipelineDefinition {
  name: string;
  description?: string;
  /**
   * The project the run's agents work in.
   *
   * Optional here because a run may name it instead; a run that can find one in
   * neither place is refused before any step starts.
   */
  projectId?: string;
  trigger: PipelineTriggerType;
  /** Values substituted into step briefs, and the run's starting context. */
  parameters?: Record<string, string>;
  steps: PipelineStep[];
}

/** A stored pipeline: the definition, the text it was parsed from, and its row. */
export interface Pipeline {
  id: string;
  workspaceId?: string;
  name: string;
  description?: string;
  /** The exact YAML that was saved, which is what a later edit round-trips. */
  yaml: string;
  definition: PipelineDefinition;
  createdAt: number;
  updatedAt: number;
}

/** One execution of one step. */
export interface PipelineStepRun {
  id: string;
  pipelineRunId: string;
  /** The `id` the definition gave this step. */
  stepId: string;
  stepName: string;
  roleProfileId: string;
  status: PipelineStepStatus;
  /** The delegated thread the step ran in; its transcript outlives the run. */
  threadId?: string;
  /** The sandbox it ran in, when it ran in one. */
  worktreePath?: string;
  /** The fleet branch that sandbox sits on, when the run used a fleet (P9-02). */
  worktreeBranch?: string;
  /** What that branch settled at, which is what downstream steps chain from. */
  commitSha?: string;
  /** How many times the step was dispatched. `1` for a step that never failed. */
  attempts?: number;
  /** What it changed there, bounded. */
  diff?: string;
  /** What it said, bounded. */
  output?: string;
  startedAt?: number;
  completedAt?: number;
  errorMessage?: string;
}

/** One execution of one pipeline, with every step it planned. */
export interface PipelineRun {
  id: string;
  pipelineId: string;
  status: PipelineRunStatus;
  /** The step that started most recently, for a dashboard with one line to spare. */
  currentStepId?: string;
  /** The parameters the run started with, plus what the engine added to them. */
  runContext: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  errorMessage?: string;
  /** The root thread every step is delegated from. */
  rootThreadId?: string;
  projectId?: string;
  /** The commit the run's first step worktrees were branched from (P9-02). */
  baseCommit?: string;
  /** The consolidated branch a synthesis produced, once one has (P9-02). */
  synthesisBranch?: string;
  /** The summary commit on that branch. */
  synthesisCommit?: string;
  steps: PipelineStepRun[];
}

// --- Worktree fleet (P9-02) --------------------------------------------------

/**
 * The branch namespace every step of every run is checked out on.
 *
 * Separate from `asterim/sandbox/` on purpose: a delegation's sandbox is named
 * after the thread that owns it and is thrown away with it, while a fleet branch
 * is named after the *run and the step*, which is what makes it addressable
 * after the fact — a downstream step chains from it, a conflict analysis merges
 * it, and a synthesis consolidates it. Anything under this prefix is Asterim's
 * and may be deleted; anything that is not is somebody's real branch.
 */
export const PIPELINE_BRANCH_PREFIX = 'asterim/pipeline/';

/** The project-relative directory a run's step checkouts are provisioned under. */
export const PIPELINE_WORKTREE_DIR = '.asterim/worktrees/pipeline';

/**
 * What a run id or step id must look like to become a branch and a directory.
 *
 * Both end up on a git command line and in a path, so this refuses everything
 * that is not one shape of identifier rather than trying to escape the rest —
 * the same reasoning `isSafeWorktreeThreadId` applies to a thread id.
 */
const SAFE_PIPELINE_REF_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Whether an id may be used to name a fleet branch and a checkout directory. */
export function isSafePipelineRefComponent(value: string): boolean {
  if (typeof value !== 'string') return false;
  // `..` would escape the fleet directory, and git refuses it in a ref name.
  if (value.includes('..')) return false;
  return SAFE_PIPELINE_REF_COMPONENT.test(value);
}

/** The branch one step of one run works on. */
export function pipelineStepBranchName(runId: string, stepId: string): string {
  return `${PIPELINE_BRANCH_PREFIX}${runId}/step-${stepId}`;
}

/** The consolidated branch a passing run synthesizes into. */
export function pipelineSynthesisBranchName(runId: string): string {
  return `${PIPELINE_BRANCH_PREFIX}${runId}/pr`;
}

/** Whether a branch is one the fleet provisioned, and may therefore delete. */
export function isPipelineBranch(branch: string | null | undefined): boolean {
  return !!branch && branch.startsWith(PIPELINE_BRANCH_PREFIX);
}

/** One provisioned step checkout. */
export interface PipelineStepWorktree {
  runId: string;
  stepId: string;
  /** Absolute path to the checkout. */
  path: string;
  /** The fleet branch it sits on. */
  branch: string;
  /** The commit it was branched from: an ancestor's tip, or the run's base. */
  baseCommit: string;
  /** The steps whose branches this one was chained from, in order. */
  chainedFrom: string[];
  createdAt: number;
}

/** One pair of fleet branches that cannot be merged, and where they disagree. */
export interface PipelineBranchConflict {
  stepIds: [string, string];
  branches: [string, string];
  /** The paths git could not reconcile between them. */
  files: string[];
}

/**
 * What a run's parallel step branches would do if they were merged (P9-02).
 *
 * Reported rather than thrown, and before anything is merged, because the point
 * is to know whether a consolidation *would* work — an operator deciding
 * whether to synthesize, and an engine deciding whether a fan-out can be joined,
 * both need the answer without the repository having been changed to find it.
 */
export interface PipelineConflictAnalysis {
  hasConflicts: boolean;
  /** Every path any pair conflicts on, deduplicated and sorted. */
  conflictedFiles: string[];
  /** The branches that were analyzed. */
  branches: string[];
  /** Which pairs conflict, for a report that has to name them. */
  conflicts: PipelineBranchConflict[];
  /** Steps whose branch no longer exists, so nothing could be said about them. */
  missingStepIds: string[];
}

/** What a caller asks for when it consolidates a run's work. */
export interface PipelineSynthesisRequest {
  runId: string;
  /** Which steps to consolidate. Unset means every step that passed. */
  stepIds?: string[];
  /** The summary commit's message. Unset means a generated one. */
  message?: string;
}

/** The branch a synthesis produced. */
export interface PipelineSynthesisResult {
  /** `asterim/pipeline/<runId>/pr`. */
  branchName: string;
  /** The summary commit at its tip. */
  commitSha: string;
  /** The steps whose branches it carries, in dependency order. */
  mergedStepIds: string[];
  /** Steps that were asked for but had nothing to contribute. */
  skippedStepIds: string[];
  /** The commit the branch was started from. */
  baseCommit: string;
}

// --- Triggers (P9-02) --------------------------------------------------------

/**
 * The bus events an automated trigger listens for.
 *
 * Named here rather than in the trigger service because they are a contract
 * between two subsystems: whoever publishes a commit or a file change and
 * whoever starts a pipeline because of one.
 */
export const PIPELINE_GIT_COMMIT_EVENT = 'git:commit';
export const PIPELINE_FILE_CHANGE_EVENT = 'workspace:file_change';

/** Published when a listener has decided a pipeline should run. */
export const PIPELINE_TRIGGERED_EVENT = 'pipeline:triggered';

/** Why a run was started, and by what. */
export interface PipelineTriggerEvent {
  /** Which listener matched: never `MANUAL`, which is a REST call instead. */
  trigger: PipelineTriggerType;
  pipelineId: string;
  projectId: string;
  /** The commit that caused it, for `GIT_COMMIT`. */
  commitSha?: string;
  /** The paths that caused it, bounded, for `FILE_CHANGE`. */
  changedFiles?: string[];
  /** When the listener decided, which is not when the run reaches its first step. */
  triggeredAt: number;
}

/**
 * How often a `SCHEDULE` pipeline may run, at the fastest.
 *
 * A scheduled pipeline starts agent sessions that edit a checkout; one that
 * fired every second would be a workstation with no cycles left for the person
 * using it. A definition asking for less than this is run at this instead.
 */
export const MIN_PIPELINE_SCHEDULE_MS = 60000;

/**
 * How long a burst of file changes is collected before it starts one run.
 *
 * A single editor save produces several `file.changed` events, and a checkout or
 * a `pnpm install` produces thousands. Without a quiet period, a `FILE_CHANGE`
 * pipeline would start a run per event and refuse all but the first.
 */
export const PIPELINE_FILE_CHANGE_DEBOUNCE_MS = 3000;

// --- DAG algebra -------------------------------------------------------------

/** Whether a run status is one nothing will move off. */
export function isTerminalPipelineRunStatus(status: PipelineRunStatus): boolean {
  return status === 'PASSED' || status === 'FAILED' || status === 'CANCELLED';
}

/** Whether a step status is one nothing will move off. */
export function isTerminalPipelineStepStatus(status: PipelineStepStatus): boolean {
  return (
    status === 'PASSED' || status === 'FAILED' || status === 'SKIPPED' || status === 'CANCELLED'
  );
}

/**
 * The first dependency cycle in a step list, as the path that closes it.
 *
 * Returned rather than thrown, and as a path rather than a boolean, because the
 * caller is usually reporting it to whoever wrote the file and
 * `a → b → c → a` is the whole diagnosis.
 *
 * Depth-first with an explicit stack: a definition is user-supplied and a
 * recursive walk over one deep enough would take the Core down with a stack
 * overflow rather than a validation error.
 */
export function findPipelineCycle(steps: readonly PipelineStep[]): string[] | null {
  const byId = new Map(steps.map(step => [step.id, step]));
  const state = new Map<string, 'visiting' | 'done'>();

  for (const root of steps) {
    if (state.get(root.id) === 'done') continue;

    // Each frame is a step and how many of its dependencies have been walked.
    const stack: Array<{ id: string; next: number }> = [{ id: root.id, next: 0 }];
    state.set(root.id, 'visiting');

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const dependencies = byId.get(frame.id)?.dependsOn ?? [];

      if (frame.next >= dependencies.length) {
        state.set(frame.id, 'done');
        stack.pop();
        continue;
      }

      const dependency = dependencies[frame.next++];
      // A dependency on a step that does not exist is a different error, caught
      // by validation; it is simply not an edge as far as cycles go.
      if (!byId.has(dependency)) continue;

      if (state.get(dependency) === 'visiting') {
        const opened = stack.findIndex(entry => entry.id === dependency);
        return [...stack.slice(opened).map(entry => entry.id), dependency];
      }
      if (state.get(dependency) === 'done') continue;

      state.set(dependency, 'visiting');
      stack.push({ id: dependency, next: 0 });
    }
  }

  return null;
}

/**
 * Step ids in an order where every step follows its dependencies.
 *
 * `null` when the graph has a cycle, which is the same condition
 * `findPipelineCycle` reports; ties are broken by the order the definition
 * lists steps in, so the same file always produces the same plan.
 */
export function topologicalPipelineOrder(steps: readonly PipelineStep[]): string[] | null {
  const byId = new Map(steps.map(step => [step.id, step]));
  const outstanding = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const step of steps) {
    // Unknown dependencies are not edges — that is a validation error rather
    // than an ordering one — but a self-dependency deliberately is, so this
    // agrees with `findPipelineCycle` about what has no order.
    const dependencies = [...new Set(step.dependsOn.filter(id => byId.has(id)))];
    outstanding.set(step.id, dependencies.length);
    for (const dependency of dependencies) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), step.id]);
    }
  }

  const order: string[] = [];
  const queue = steps.filter(step => outstanding.get(step.id) === 0).map(step => step.id);

  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const left = (outstanding.get(dependent) ?? 0) - 1;
      outstanding.set(dependent, left);
      if (left === 0) queue.push(dependent);
    }
  }

  return order.length === byId.size ? order : null;
}

/**
 * Every step `stepId` transitively depends on, in dependency order.
 *
 * Transitive rather than direct because context flows the whole way down: a
 * documentation step that depends on a test step, which depended on an
 * implementation step, is written about the implementation.
 */
export function pipelineAncestorIds(
  steps: readonly PipelineStep[],
  stepId: string
): string[] {
  const byId = new Map(steps.map(step => [step.id, step]));
  const seen = new Set<string>();
  const collect = (id: string): void => {
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dependency) || seen.has(dependency)) continue;
      seen.add(dependency);
      collect(dependency);
    }
  };
  collect(stepId);

  const order = topologicalPipelineOrder(steps) ?? steps.map(step => step.id);
  return order.filter(id => seen.has(id));
}

/**
 * Which steps may start right now.
 *
 * A step is ready when it is still `PENDING` and every dependency it declares
 * has `PASSED`. A dependency that failed, was skipped or was cancelled leaves
 * the step unready forever, which is what stops a pipeline at its first
 * failure rather than running the rest of the graph on missing input.
 */
export function readyPipelineStepIds(
  steps: readonly PipelineStep[],
  statusByStepId: Readonly<Record<string, PipelineStepStatus>>
): string[] {
  return steps
    .filter(
      step =>
        (statusByStepId[step.id] ?? 'PENDING') === 'PENDING' &&
        step.dependsOn.every(dependency => statusByStepId[dependency] === 'PASSED')
    )
    .map(step => step.id);
}

/**
 * The run status a set of step outcomes adds up to.
 *
 * Order matters: a cancellation outranks a failure, because an operator
 * stopping a run is the reason its steps did not finish; a failure outranks
 * everything else; and `PASSED` is only reached when nothing is outstanding.
 */
export function aggregatePipelineRunStatus(
  statuses: readonly PipelineStepStatus[]
): PipelineRunStatus {
  if (statuses.some(status => status === 'CANCELLED')) return 'CANCELLED';
  if (statuses.some(status => status === 'FAILED')) return 'FAILED';
  if (statuses.some(status => status === 'SKIPPED')) return 'FAILED';
  if (statuses.some(status => status === 'RUNNING')) return 'RUNNING';
  if (statuses.some(status => status === 'PENDING')) return 'RUNNING';
  return 'PASSED';
}

// --- EventBus contract -------------------------------------------------------

/** Published once a run has been planned and its first steps are about to start. */
export const PIPELINE_STARTED_EVENT = 'pipeline:started';

/** Published as each step's agent is dispatched. */
export const PIPELINE_STEP_STARTED_EVENT = 'pipeline:step_started';

/** Published as each step settles, whatever it settled as. */
export const PIPELINE_STEP_COMPLETED_EVENT = 'pipeline:step_completed';

/** Published when every step passed. */
export const PIPELINE_COMPLETED_EVENT = 'pipeline:completed';

/**
 * Published when a run ended any other way.
 *
 * Including a cancellation, whose payload carries `status: 'CANCELLED'`: a
 * dashboard that only learns the five events must still be told the run is
 * over, and a sixth terminal event it did not know about would leave the run
 * showing as live forever.
 */
export const PIPELINE_FAILED_EVENT = 'pipeline:failed';

export interface PipelineStartedPayload {
  projectId: string;
  /** The run's root thread, so the event routes to a room a dashboard watches. */
  threadId?: string;
  pipelineId: string;
  runId: string;
  name: string;
  /** Every step the run planned, in dependency order. */
  stepIds: string[];
}

export interface PipelineStepStartedPayload {
  projectId: string;
  threadId?: string;
  pipelineId: string;
  runId: string;
  stepId: string;
  stepName: string;
  roleProfileId: string;
  /** The steps dispatched together with this one. */
  batchStepIds: string[];
  /** Which attempt this is, counting from 1 (P9-02). */
  attempt?: number;
}

export interface PipelineStepCompletedPayload {
  projectId: string;
  threadId?: string;
  pipelineId: string;
  runId: string;
  step: PipelineStepRun;
}

export interface PipelineCompletedPayload {
  projectId: string;
  threadId?: string;
  pipelineId: string;
  run: PipelineRun;
}

export interface PipelineFailedPayload extends PipelineCompletedPayload {
  /** Why it ended, when there is a reason worth one line. */
  errorMessage?: string;
}
