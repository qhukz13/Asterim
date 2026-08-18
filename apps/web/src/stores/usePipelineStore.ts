import { create } from 'zustand';
import {
  MAX_PIPELINE_STEP_RETRIES,
  MAX_PIPELINE_YAML_CHARS,
  PIPELINE_COMPLETED_EVENT,
  PIPELINE_FAILED_EVENT,
  PIPELINE_STARTED_EVENT,
  PIPELINE_STEP_COMPLETED_EVENT,
  PIPELINE_STEP_STARTED_EVENT,
  isTerminalPipelineRunStatus
} from '@asterim/shared';
import type {
  Pipeline,
  PipelineCompletedPayload,
  PipelineConflictAnalysis,
  PipelineFailedPayload,
  PipelineRun,
  PipelineRunStatus,
  PipelineStartedPayload,
  PipelineStep,
  PipelineStepCompletedPayload,
  PipelineStepRun,
  PipelineStepStartedPayload,
  PipelineStepStatus,
  PipelineSynthesisResult,
  VerificationPipelineReport
} from '@asterim/shared';
import { getAuthHeaders, resolveBackendUrl } from '../utils/auth';

/**
 * Declarative pipelines, their runs, and what a run's branches would do if they
 * were merged, as the dashboard holds them (P9-03).
 *
 * A pipeline run is the one thing in Asterim that is *several* agent sessions at
 * once, so the state here is shaped around the two questions an operator has
 * while watching one: which step is the graph currently on, and what did the
 * step I am looking at actually do. Everything else — the conflict analysis, the
 * synthesis result — hangs off a run id rather than off the run, because both
 * are answers about a run that are asked for after it is over and neither
 * belongs on the row the Core keeps.
 *
 * Two sources feed the run state, and they are not equal:
 *
 *   - **REST is the snapshot.** `GET /pipeline-runs/:id` answers with every
 *     step, its status, its branch and its transcript at one instant. It is what
 *     an operator opening a finished run reads, and what a reload starts from.
 *   - **The socket is the authority while the page is open.** The five
 *     `pipeline:*` transitions carry each step as it starts and as it settles,
 *     so a DAG node moves PENDING → RUNNING → PASSED without anything being
 *     polled. `pipeline:started` may arrive for a run this tab has never
 *     fetched, so it plants a skeleton run built from the step ids it carries;
 *     `pipeline:step_started` fills in each node's name and role as it is
 *     dispatched, and `pipeline:step_completed` replaces the node with the whole
 *     row.
 *
 * The selection — `activeRunId`, `selectedStepId` — is selection and nothing
 * else, per `blueprint/STORE_ARCHITECTURE.md`: the inspector reads the step out
 * of `runs` by that id rather than being handed a copy of it, so a step that
 * moves while it is open moves on screen too.
 */

const PIPELINES_BASE = '/api/v1/pipelines';
const RUNS_BASE = '/api/v1/pipeline-runs';

/** The run transitions the Core publishes, as the socket sees them. */
export const PIPELINE_EVENT_TYPES: readonly string[] = [
  PIPELINE_STARTED_EVENT,
  PIPELINE_STEP_STARTED_EVENT,
  PIPELINE_STEP_COMPLETED_EVENT,
  PIPELINE_COMPLETED_EVENT,
  PIPELINE_FAILED_EVENT
];

/** Whether an event belongs to the pipeline subsystem. */
export function isPipelineEvent(event: { type?: string } | null | undefined): boolean {
  return !!event?.type && PIPELINE_EVENT_TYPES.includes(event.type);
}

// --- Pure helpers ------------------------------------------------------------

/**
 * The Core's refusal, in words an operator can act on.
 *
 * Branched on the `code` where the routes send one, because the two 409s mean
 * entirely different things: one says the pipeline is already running and the
 * other says its branches cannot be combined, and "conflict" tells nobody which.
 */
export function describePipelineError(
  message: string | undefined,
  status?: number,
  code?: string
): string {
  if (code === 'ALREADY_RUNNING') {
    return 'This pipeline is already running. Wait for it to finish, or cancel it first.';
  }
  if (code === 'RUN_IN_PROGRESS') {
    return 'This run has not finished yet, so its work cannot be consolidated.';
  }
  if (code === 'SYNTHESIS_CONFLICT') {
    return message || 'These step branches cannot be combined. Nothing was merged.';
  }
  if (code === 'NO_FLEET') {
    return (
      message ||
      'This run kept no worktree fleet, so it has no step branches to compare or consolidate.'
    );
  }
  if (code === 'INVALID_DEFINITION') return message || 'This pipeline definition is not valid.';
  if (status === 401) return 'Sign in to run pipelines on this workstation.';
  if (status === 403) return message || 'You do not have permission to do that in this workspace.';
  if (status === 404) return message || 'That pipeline or run no longer exists.';
  return message || 'The request failed.';
}

export interface PipelineTone {
  label: string;
  color: string;
  background: string;
}

/**
 * How one step's status is shown.
 *
 * `SKIPPED` and `CANCELLED` are deliberately not the same tone. A skipped step
 * never ran because the step it depended on failed; a cancelled one never ran
 * because a person stopped the run. Showing both as "did not run" would lose the
 * only fact that tells a broken pipeline from an abandoned one.
 */
export function pipelineStepTone(status: PipelineStepStatus): PipelineTone {
  switch (status) {
    case 'RUNNING':
      return {
        label: 'Running',
        color: 'var(--color-state-working)',
        background: 'var(--color-state-working-bg)'
      };
    case 'PASSED':
      return {
        label: 'Passed',
        color: 'var(--color-state-completed)',
        background: 'var(--color-state-completed-bg)'
      };
    case 'FAILED':
      return {
        label: 'Failed',
        color: 'var(--color-state-error)',
        background: 'var(--color-state-error-bg)'
      };
    case 'SKIPPED':
      return {
        label: 'Skipped',
        color: 'var(--color-state-paused)',
        background: 'var(--color-state-paused-bg)'
      };
    case 'CANCELLED':
      return {
        label: 'Cancelled',
        color: 'var(--color-text-muted)',
        background: 'rgba(148, 163, 184, 0.12)'
      };
    default:
      return {
        label: 'Pending',
        color: 'var(--color-text-secondary)',
        background: 'rgba(148, 163, 184, 0.08)'
      };
  }
}

/** How a whole run's status is shown. */
export function pipelineRunTone(status: PipelineRunStatus): PipelineTone {
  switch (status) {
    case 'RUNNING':
      return {
        label: 'Running',
        color: 'var(--color-state-working)',
        background: 'var(--color-state-working-bg)'
      };
    case 'PASSED':
      return {
        label: 'Passed',
        color: 'var(--color-state-completed)',
        background: 'var(--color-state-completed-bg)'
      };
    case 'FAILED':
      return {
        label: 'Failed',
        color: 'var(--color-state-error)',
        background: 'var(--color-state-error-bg)'
      };
    case 'CANCELLED':
      return {
        label: 'Cancelled',
        color: 'var(--color-text-muted)',
        background: 'rgba(148, 163, 184, 0.12)'
      };
    default:
      return {
        label: 'Pending',
        color: 'var(--color-text-secondary)',
        background: 'rgba(148, 163, 184, 0.08)'
      };
  }
}

/** A duration in the coarsest unit that is still readable. */
export function formatPipelineDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** How long a step took, or how long it has been going. */
export function stepDurationMs(step: PipelineStepRun, now = Date.now()): number | null {
  if (!step.startedAt) return null;
  return (step.completedAt ?? now) - step.startedAt;
}

/** How long a run took, or how long it has been going. */
export function runDurationMs(run: PipelineRun, now = Date.now()): number {
  return (run.completedAt ?? now) - run.startedAt;
}

/**
 * Which attempt a step is on, when it took more than one.
 *
 * `null` for the ordinary case, so a graph of steps that all worked first time
 * carries no badges at all — a retry counter on every node would make the one
 * node that actually retried invisible.
 */
export function attemptLabel(
  step: Pick<PipelineStepRun, 'attempts'>,
  retries?: number
): string | null {
  const attempts = step.attempts ?? 1;
  if (attempts <= 1) return null;
  const allowed = Math.min(Math.max(retries ?? MAX_PIPELINE_STEP_RETRIES, 0), MAX_PIPELINE_STEP_RETRIES) + 1;
  return `Attempt ${attempts}/${Math.max(attempts, allowed)}`;
}

/** Short form of a commit, which is all a card has room for. */
export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : '—';
}

/** How far through its steps a run is, as a fraction between 0 and 1. */
export function runProgress(run: PipelineRun | null | undefined): number {
  const total = run?.steps.length ?? 0;
  if (!run || total === 0) return 0;
  const settled = run.steps.filter(step => step.status !== 'PENDING' && step.status !== 'RUNNING');
  return settled.length / total;
}

/** The steps a synthesis would consolidate unless the operator says otherwise. */
export function passingStepIds(run: PipelineRun | null | undefined): string[] {
  return (run?.steps ?? []).filter(step => step.status === 'PASSED').map(step => step.stepId);
}

/** Whether a run is over, so the actions that need it to be may be offered. */
export function isRunFinished(run: PipelineRun | null | undefined): boolean {
  return !!run && isTerminalPipelineRunStatus(run.status);
}

/** One sentence saying whether a run's branches can be combined. */
export function conflictSummary(analysis: PipelineConflictAnalysis | null | undefined): string {
  if (!analysis) return 'These branches have not been compared yet.';
  if (analysis.branches.length < 2) {
    return 'Only one step branch exists, so there is nothing to conflict with.';
  }
  if (!analysis.hasConflicts) {
    return `${analysis.branches.length} step branches merge cleanly.`;
  }
  const files = analysis.conflictedFiles.length;
  return `${analysis.conflicts.length} pair${analysis.conflicts.length === 1 ? '' : 's'} of step branches disagree on ${files} file${files === 1 ? '' : 's'}.`;
}

/** The steps of a run, in the order the definition declares them. */
export function orderedStepRuns(run: PipelineRun | null | undefined, steps?: PipelineStep[]): PipelineStepRun[] {
  const rows = run?.steps ?? [];
  if (!steps || steps.length === 0) return rows;
  const position = new Map(steps.map((step, index) => [step.id, index]));
  return [...rows].sort(
    (left, right) =>
      (position.get(left.stepId) ?? Number.MAX_SAFE_INTEGER) -
      (position.get(right.stepId) ?? Number.MAX_SAFE_INTEGER)
  );
}

// --- Event reduction ---------------------------------------------------------

/** A run built from the one event that may arrive before anything was fetched. */
function skeletonRun(payload: PipelineStartedPayload): PipelineRun {
  return {
    id: payload.runId,
    pipelineId: payload.pipelineId,
    status: 'RUNNING',
    runContext: {},
    startedAt: Date.now(),
    rootThreadId: payload.threadId,
    projectId: payload.projectId,
    steps: payload.stepIds.map(stepId => ({
      id: `${payload.runId}:${stepId}`,
      pipelineRunId: payload.runId,
      stepId,
      // The name and the role are not on this event; the step's own
      // `step_started` carries both, so a node is labelled by its id for as
      // long as it has not been dispatched.
      stepName: stepId,
      roleProfileId: '',
      status: 'PENDING' as PipelineStepStatus
    }))
  };
}

/** One run with one of its steps replaced, leaving every other step alone. */
function withStep(
  run: PipelineRun,
  stepId: string,
  update: (step: PipelineStepRun) => PipelineStepRun
): PipelineRun {
  const known = run.steps.some(step => step.stepId === stepId);
  return {
    ...run,
    steps: known
      ? run.steps.map(step => (step.stepId === stepId ? update(step) : step))
      : [
          ...run.steps,
          update({
            id: `${run.id}:${stepId}`,
            pipelineRunId: run.id,
            stepId,
            stepName: stepId,
            roleProfileId: '',
            status: 'PENDING'
          })
        ]
  };
}

/**
 * One `pipeline:*` transition applied to the runs a tab is holding.
 *
 * Pure, and exported, because this is the part of the store that has to be
 * right: it is what a live DAG is redrawn from between fetches, and it is
 * reachable in a test without a socket.
 *
 * The rules follow the engine's own:
 *   - `started` plants the run when it is unknown, and otherwise leaves the
 *     fetched one alone — a snapshot taken after the run began knows more than
 *     this event does.
 *   - `step_started` is the first thing that knows a step's name and role, and
 *     is idempotent for a step already running, because a retry publishes it
 *     again with a higher attempt.
 *   - `step_completed` carries the whole row and replaces the node with it.
 *   - `completed` and `failed` carry the whole run, including a cancellation —
 *     the engine publishes `failed` with `status: 'CANCELLED'` rather than a
 *     sixth event, so a run stopped by an operator still stops looking live.
 */
export function reducePipelineEvent(
  runs: PipelineRun[],
  eventType: string,
  payload: unknown
): PipelineRun[] {
  const replace = (run: PipelineRun): PipelineRun[] =>
    runs.some(entry => entry.id === run.id)
      ? runs.map(entry => (entry.id === run.id ? run : entry))
      : [run, ...runs];

  switch (eventType) {
    case PIPELINE_STARTED_EVENT: {
      const started = payload as PipelineStartedPayload;
      if (!started?.runId) return runs;
      if (runs.some(entry => entry.id === started.runId)) return runs;
      return [skeletonRun(started), ...runs];
    }
    case PIPELINE_STEP_STARTED_EVENT: {
      const step = payload as PipelineStepStartedPayload;
      const run = runs.find(entry => entry.id === step?.runId);
      if (!run) return runs;
      return replace({
        ...withStep(run, step.stepId, existing => ({
          ...existing,
          stepName: step.stepName || existing.stepName,
          roleProfileId: step.roleProfileId || existing.roleProfileId,
          status: 'RUNNING',
          attempts: step.attempt ?? (existing.attempts ?? 0) + 1,
          startedAt: existing.startedAt ?? Date.now(),
          completedAt: undefined,
          errorMessage: undefined
        })),
        status: 'RUNNING',
        currentStepId: step.stepId
      });
    }
    case PIPELINE_STEP_COMPLETED_EVENT: {
      const completed = payload as PipelineStepCompletedPayload;
      const run = runs.find(entry => entry.id === completed?.runId);
      if (!run || !completed.step) return runs;
      return replace(withStep(run, completed.step.stepId, () => completed.step));
    }
    case PIPELINE_COMPLETED_EVENT:
    case PIPELINE_FAILED_EVENT: {
      const finished = payload as PipelineCompletedPayload & PipelineFailedPayload;
      if (!finished?.run?.id) return runs;
      return replace({
        ...finished.run,
        errorMessage: finished.run.errorMessage ?? finished.errorMessage
      });
    }
    default:
      return runs;
  }
}

// --- Store -------------------------------------------------------------------

interface PipelineState {
  /** The definitions the last fetch could see. */
  pipelines: Pipeline[];
  /** Which definition's runs are on screen. */
  activePipelineId: string | null;
  /** Every run this tab knows about, newest first. */
  runs: PipelineRun[];
  activeRunId: string | null;
  /** Which node the inspector is open on. A reference, never a copy. */
  selectedStepId: string | null;
  conflictAnalysisByRunId: Record<string, PipelineConflictAnalysis>;
  synthesisByRunId: Record<string, PipelineSynthesisResult>;
  /** What the project's own checks said about a step's thread, once asked. */
  verificationByThreadId: Record<string, VerificationPipelineReport | null>;
  /** The project the dashboard is scoped to, so a change reloads rather than filters. */
  projectId: string | null;

  loading: boolean;
  isSaving: boolean;
  isRunning: boolean;
  isCheckingConflicts: boolean;
  isSynthesizing: boolean;
  error: string | null;
  notice: string | null;

  fetchPipelines: (
    projectId: string | null,
    workspaceId?: string | null,
    backendUrl?: string | null
  ) => Promise<void>;
  fetchPipeline: (pipelineId: string, backendUrl?: string | null) => Promise<void>;
  savePipeline: (
    input: { id?: string; workspaceId?: string | null; yaml: string },
    backendUrl?: string | null
  ) => Promise<Pipeline | null>;
  runPipeline: (
    pipelineId: string,
    runContext?: Record<string, unknown>,
    backendUrl?: string | null
  ) => Promise<PipelineRun | null>;
  fetchRun: (runId: string, backendUrl?: string | null) => Promise<PipelineRun | null>;
  cancelRun: (runId: string, reason?: string, backendUrl?: string | null) => Promise<boolean>;
  checkConflicts: (
    runId: string,
    backendUrl?: string | null
  ) => Promise<PipelineConflictAnalysis | null>;
  synthesizeRun: (
    runId: string,
    options?: { stepIds?: string[]; message?: string },
    backendUrl?: string | null
  ) => Promise<PipelineSynthesisResult | null>;
  /** What the project's own commands said about the thread a step ran in. */
  fetchStepVerification: (
    threadId: string,
    backendUrl?: string | null
  ) => Promise<VerificationPipelineReport | null>;

  selectPipeline: (pipelineId: string | null) => void;
  selectRun: (runId: string | null) => void;
  selectStep: (stepId: string | null) => void;
  /** Applies one `pipeline:*` transition. */
  handlePipelineEvent: (eventType: string, payload: unknown) => void;
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
  const base = describePipelineError(
    body.error as string | undefined,
    res.status,
    body.code as string | undefined
  );
  // The parser answers with the line it stopped on, and that line is the whole
  // of what the operator has to fix.
  return typeof body.line === 'number' && body.line > 0 ? `Line ${body.line}: ${base}` : base;
}

/** A thrown request: the Core being unreachable rather than refusing. */
function networkFailure(err: unknown): string {
  return (err as Error)?.message || 'Could not reach the Core.';
}

/** Runs newest first, however they arrived. */
function sortRuns(runs: PipelineRun[]): PipelineRun[] {
  return [...runs].sort((left, right) => right.startedAt - left.startedAt);
}

/** The runs list with these runs merged in, newest first. */
function mergeRuns(runs: PipelineRun[], incoming: PipelineRun[]): PipelineRun[] {
  const byId = new Map(runs.map(run => [run.id, run]));
  for (const run of incoming) byId.set(run.id, run);
  return sortRuns([...byId.values()]);
}

/**
 * The state a fresh mount sees.
 *
 * A function rather than a shared constant, so a reset cannot hand back the
 * same array a previous project's list was built on.
 */
function emptyState() {
  return {
    pipelines: [] as Pipeline[],
    activePipelineId: null,
    runs: [] as PipelineRun[],
    activeRunId: null,
    selectedStepId: null,
    conflictAnalysisByRunId: {} as Record<string, PipelineConflictAnalysis>,
    synthesisByRunId: {} as Record<string, PipelineSynthesisResult>,
    verificationByThreadId: {} as Record<string, VerificationPipelineReport | null>,
    projectId: null,
    loading: false,
    isSaving: false,
    isRunning: false,
    isCheckingConflicts: false,
    isSynthesizing: false,
    error: null,
    notice: null
  };
}

export const usePipelineStore = create<PipelineState>(set => ({
  ...emptyState(),

  fetchPipelines: async (projectId, workspaceId, backendUrl) => {
    const base = resolveBackendUrl(backendUrl) || '';
    set({ loading: true, error: null, projectId: projectId ?? null });
    try {
      const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
      const res = await fetch(`${base}${PIPELINES_BASE}${query}`, {
        headers: getAuthHeaders({ backendUrl })
      });
      const body = await readBody(res);
      if (!res.ok) {
        // The list already on screen is left in place: a transient failure must
        // not blank a panel someone is reading.
        set({ error: failureOf(res, body), loading: false });
        return;
      }
      const pipelines = (body.pipelines as Pipeline[]) ?? [];
      set(state => ({
        pipelines,
        loading: false,
        activePipelineId:
          state.activePipelineId && pipelines.some(entry => entry.id === state.activePipelineId)
            ? state.activePipelineId
            : (pipelines[0]?.id ?? null)
      }));
    } catch (err) {
      set({ error: networkFailure(err), loading: false });
    }
  },

  fetchPipeline: async (pipelineId, backendUrl) => {
    if (!pipelineId) return;
    const base = resolveBackendUrl(backendUrl) || '';
    try {
      const res = await fetch(`${base}${PIPELINES_BASE}/${encodeURIComponent(pipelineId)}`, {
        headers: getAuthHeaders({ backendUrl })
      });
      const body = await readBody(res);
      if (!res.ok) {
        set({ error: failureOf(res, body) });
        return;
      }
      const pipeline = body.pipeline as Pipeline | undefined;
      const runs = (body.runs as PipelineRun[]) ?? [];
      set(state => ({
        pipelines: pipeline
          ? state.pipelines.some(entry => entry.id === pipeline.id)
            ? state.pipelines.map(entry => (entry.id === pipeline.id ? pipeline : entry))
            : [...state.pipelines, pipeline]
          : state.pipelines,
        runs: mergeRuns(state.runs, runs),
        // Opening a pipeline whose newest run nothing is looking at yet lands on
        // that run, which is the one an operator came to see.
        activeRunId: state.activeRunId ?? sortRuns(runs)[0]?.id ?? null
      }));
    } catch (err) {
      set({ error: networkFailure(err) });
    }
  },

  savePipeline: async (input, backendUrl) => {
    const base = resolveBackendUrl(backendUrl) || '';
    set({ isSaving: true, error: null, notice: null });
    try {
      const res = await fetch(`${base}${PIPELINES_BASE}`, {
        method: 'POST',
        headers: getAuthHeaders({ backendUrl, json: true }),
        body: JSON.stringify({
          ...(input.id ? { id: input.id } : {}),
          ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
          yaml: input.yaml
        })
      });
      const body = await readBody(res);
      if (!res.ok) {
        set({ error: failureOf(res, body), isSaving: false });
        return null;
      }
      const pipeline = body.pipeline as Pipeline;
      set(state => ({
        pipelines: state.pipelines.some(entry => entry.id === pipeline.id)
          ? state.pipelines.map(entry => (entry.id === pipeline.id ? pipeline : entry))
          : [...state.pipelines, pipeline],
        activePipelineId: pipeline.id,
        isSaving: false,
        notice: `${pipeline.name} saved.`
      }));
      return pipeline;
    } catch (err) {
      set({ error: networkFailure(err), isSaving: false });
      return null;
    }
  },

  runPipeline: async (pipelineId, runContext, backendUrl) => {
    const base = resolveBackendUrl(backendUrl) || '';
    set({ isRunning: true, error: null, notice: null });
    try {
      // The route holds the request open until the run reaches a terminal
      // status, so what comes back is the outcome — the live transitions in
      // between arrive on the socket, which is what the graph is drawn from.
      const res = await fetch(
        `${base}${PIPELINES_BASE}/${encodeURIComponent(pipelineId)}/run`,
        {
          method: 'POST',
          headers: getAuthHeaders({ backendUrl, json: true }),
          body: JSON.stringify({ runContext: runContext ?? {} })
        }
      );
      const body = await readBody(res);
      if (!res.ok) {
        set({ error: failureOf(res, body), isRunning: false });
        return null;
      }
      const run = body.run as PipelineRun;
      set(state => ({
        runs: mergeRuns(state.runs, [run]),
        activeRunId: run.id,
        isRunning: false,
        notice: `Run finished as ${run.status.toLowerCase()}.`
      }));
      return run;
    } catch (err) {
      set({ error: networkFailure(err), isRunning: false });
      return null;
    }
  },

  fetchRun: async (runId, backendUrl) => {
    if (!runId) return null;
    const base = resolveBackendUrl(backendUrl) || '';
    try {
      const res = await fetch(`${base}${RUNS_BASE}/${encodeURIComponent(runId)}`, {
        headers: getAuthHeaders({ backendUrl })
      });
      const body = await readBody(res);
      if (!res.ok) {
        set({ error: failureOf(res, body) });
        return null;
      }
      const run = body.run as PipelineRun;
      set(state => ({ runs: mergeRuns(state.runs, [run]) }));
      return run;
    } catch (err) {
      set({ error: networkFailure(err) });
      return null;
    }
  },

  cancelRun: async (runId, reason, backendUrl) => {
    const base = resolveBackendUrl(backendUrl) || '';
    set({ error: null, notice: null });
    try {
      const res = await fetch(`${base}${RUNS_BASE}/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST',
        headers: getAuthHeaders({ backendUrl, json: true }),
        body: JSON.stringify(reason ? { reason } : {})
      });
      const body = await readBody(res);
      if (!res.ok) {
        set({ error: failureOf(res, body) });
        return false;
      }
      const run = body.run as PipelineRun | null;
      set(state => ({
        runs: run ? mergeRuns(state.runs, [run]) : state.runs,
        // A run that settled a moment before the click is not a failure: it
        // answers with what it settled as, and saying so is the honest notice.
        notice: body.cancelled ? 'The run was stopped.' : 'That run had already finished.'
      }));
      return !!body.cancelled;
    } catch (err) {
      set({ error: networkFailure(err) });
      return false;
    }
  },

  checkConflicts: async (runId, backendUrl) => {
    const base = resolveBackendUrl(backendUrl) || '';
    set({ isCheckingConflicts: true, error: null, notice: null });
    try {
      const res = await fetch(`${base}${RUNS_BASE}/${encodeURIComponent(runId)}/conflicts`, {
        headers: getAuthHeaders({ backendUrl })
      });
      const body = await readBody(res);
      if (!res.ok) {
        set({ error: failureOf(res, body), isCheckingConflicts: false });
        return null;
      }
      const analysis = body.analysis as PipelineConflictAnalysis;
      set(state => ({
        conflictAnalysisByRunId: { ...state.conflictAnalysisByRunId, [runId]: analysis },
        isCheckingConflicts: false,
        notice: conflictSummary(analysis)
      }));
      return analysis;
    } catch (err) {
      set({ error: networkFailure(err), isCheckingConflicts: false });
      return null;
    }
  },

  synthesizeRun: async (runId, options, backendUrl) => {
    const base = resolveBackendUrl(backendUrl) || '';
    set({ isSynthesizing: true, error: null, notice: null });
    try {
      const res = await fetch(`${base}${RUNS_BASE}/${encodeURIComponent(runId)}/synthesize`, {
        method: 'POST',
        headers: getAuthHeaders({ backendUrl, json: true }),
        body: JSON.stringify({
          ...(options?.stepIds?.length ? { stepIds: options.stepIds } : {}),
          ...(options?.message ? { message: options.message } : {})
        })
      });
      const body = await readBody(res);
      if (!res.ok) {
        set({ error: failureOf(res, body), isSynthesizing: false });
        return null;
      }
      const synthesis = body.synthesis as PipelineSynthesisResult;
      const run = body.run as PipelineRun | null;
      set(state => ({
        synthesisByRunId: { ...state.synthesisByRunId, [runId]: synthesis },
        runs: run ? mergeRuns(state.runs, [run]) : state.runs,
        isSynthesizing: false,
        notice: `Consolidated ${synthesis.mergedStepIds.length} step branch${synthesis.mergedStepIds.length === 1 ? '' : 'es'} into ${synthesis.branchName}.`
      }));
      return synthesis;
    } catch (err) {
      set({ error: networkFailure(err), isSynthesizing: false });
      return null;
    }
  },

  fetchStepVerification: async (threadId, backendUrl) => {
    if (!threadId) return null;
    const base = resolveBackendUrl(backendUrl) || '';
    try {
      const res = await fetch(
        `${base}/api/v1/threads/${encodeURIComponent(threadId)}/worktree/verify`,
        { headers: getAuthHeaders({ backendUrl }) }
      );
      if (!res.ok) return null;
      const body = await readBody(res);
      const report = (body.report as VerificationPipelineReport | null) ?? null;
      set(state => ({
        verificationByThreadId: { ...state.verificationByThreadId, [threadId]: report }
      }));
      return report;
    } catch {
      // A verification report is evidence a panel shows when it has it; failing
      // to read one is not a failure of the run it belongs to.
      return null;
    }
  },

  selectPipeline: pipelineId =>
    set({ activePipelineId: pipelineId, activeRunId: null, selectedStepId: null }),
  selectRun: runId => set({ activeRunId: runId, selectedStepId: null }),
  selectStep: stepId => set({ selectedStepId: stepId }),

  handlePipelineEvent: (eventType, payload) =>
    set(state => {
      const runs = reducePipelineEvent(state.runs, eventType, payload);
      if (runs === state.runs) return {};

      // A run that has just started is adopted only when the operator is
      // already looking at the pipeline that started it — which is the whole
      // point of pressing Run, and is why it outranks whatever older run of the
      // same pipeline was open. A run of a *different* pipeline is not adopted:
      // a scheduled pipeline firing elsewhere must not pull the panel off the
      // run somebody is reading.
      const started =
        eventType === PIPELINE_STARTED_EVENT ? (payload as PipelineStartedPayload) : null;
      const adopt =
        started && started.pipelineId === state.activePipelineId
          ? started.runId
          : state.activeRunId;

      return { runs, activeRunId: adopt };
    }),

  clearError: () => set({ error: null }),
  clearNotice: () => set({ notice: null }),
  reset: () => set(emptyState())
}));

/** What the socket layer calls for every `pipeline:*` event it receives. */
export function handlePipelineEvent(eventType: string, payload: unknown): void {
  usePipelineStore.getState().handlePipelineEvent(eventType, payload);
}

// --- Definition drafting -----------------------------------------------------

/** One thing wrong with a draft, and the line it is on. */
export interface PipelineDraftIssue {
  line: number;
  message: string;
}

/**
 * What is obviously wrong with a YAML draft, before the Core is asked.
 *
 * Deliberately shallow. The parser on the Core is the gate — it is what decides
 * whether a definition is a DAG with resolvable roles, and it answers with the
 * line it stopped on — so this checks only the handful of mistakes that are
 * worth catching without a round trip, and never claims a draft is valid.
 * Anything it does not recognise is left for the save to refuse.
 */
export function validatePipelineDraft(yaml: string): PipelineDraftIssue[] {
  const issues: PipelineDraftIssue[] = [];
  if (!yaml.trim()) {
    return [{ line: 0, message: 'A pipeline definition cannot be empty.' }];
  }
  if (yaml.length > MAX_PIPELINE_YAML_CHARS) {
    return [
      {
        line: 0,
        message: `A definition may be at most ${MAX_PIPELINE_YAML_CHARS} characters; this one is ${yaml.length}.`
      }
    ];
  }

  const lines = yaml.split('\n');
  lines.forEach((line, index) => {
    // YAML forbids tabs for indentation, and an editor that inserts them
    // produces a file that fails on a line the operator cannot see anything
    // wrong with.
    if (/^\s*\t/.test(line)) {
      issues.push({ line: index + 1, message: 'Indent with spaces; YAML does not allow tabs.' });
    }
  });

  const topLevel = (key: string): boolean =>
    lines.some(line => new RegExp(`^${key}\\s*:`).test(line));

  if (!topLevel('name')) issues.push({ line: 0, message: '`name:` is required.' });
  if (!topLevel('steps')) {
    issues.push({ line: 0, message: '`steps:` is required, with at least one step under it.' });
  } else if (!lines.some(line => /^\s*-\s*id\s*:/.test(line))) {
    issues.push({ line: 0, message: 'Each step needs an `id:`.' });
  }

  return issues;
}

/** A starting point an operator edits, rather than a blank page. */
export interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  yaml: string;
}

/**
 * The presets the editor offers.
 *
 * Three shapes rather than three features: a chain, a fan-out and a join. They
 * exist because the thing that is hard to write from memory is not the keys, it
 * is `dependsOn` — and those three are every topology a pipeline can have.
 */
export const PIPELINE_TEMPLATES: readonly PipelineTemplate[] = [
  {
    id: 'sequential',
    name: 'Sequential chain',
    description: 'Implement, then test what was implemented.',
    yaml: [
      'name: Implement and test',
      'trigger: MANUAL',
      'steps:',
      '  - id: implement',
      '    name: Implement the change',
      '    role: Tech Lead',
      '    task: Implement the change described in the run parameters.',
      '  - id: test',
      '    name: Test the change',
      '    role: Tech Lead',
      '    task: Write tests for the change the previous step made, and run them.',
      '    dependsOn: [implement]',
      ''
    ].join('\n')
  },
  {
    id: 'fanout',
    name: 'Parallel review',
    description: 'Two reviewers read the same change at the same time.',
    yaml: [
      'name: Parallel review',
      'trigger: MANUAL',
      'steps:',
      '  - id: implement',
      '    name: Implement the change',
      '    role: Tech Lead',
      '    task: Implement the change described in the run parameters.',
      '  - id: security',
      '    name: Security review',
      '    role: Tech Lead',
      '    task: Review the change for security defects and say what you would not merge.',
      '    dependsOn: [implement]',
      '  - id: docs',
      '    name: Documentation',
      '    role: Tech Lead',
      '    task: Update the documentation the change makes wrong.',
      '    dependsOn: [implement]',
      ''
    ].join('\n')
  },
  {
    id: 'diamond',
    name: 'Fan out and join',
    description: 'Two steps run in parallel and a third consolidates both.',
    yaml: [
      'name: Fan out and join',
      'trigger: MANUAL',
      'steps:',
      '  - id: plan',
      '    name: Plan the work',
      '    role: Tech Lead',
      '    task: Break the request in the run parameters into the work it needs.',
      '  - id: backend',
      '    name: Backend',
      '    role: Tech Lead',
      '    task: Implement the server side of the plan.',
      '    dependsOn: [plan]',
      '    retries: 1',
      '  - id: frontend',
      '    name: Frontend',
      '    role: Tech Lead',
      '    task: Implement the dashboard side of the plan.',
      '    dependsOn: [plan]',
      '  - id: verify',
      '    name: Verify both',
      '    role: Tech Lead',
      '    task: Check that the two implementations agree, and fix them where they do not.',
      '    dependsOn: [backend, frontend]',
      '    verifyPipeline: true',
      ''
    ].join('\n')
  }
];

/** How many attempts each step of a definition is allowed, by step id. */
export function retriesByStepId(steps: readonly PipelineStep[] | undefined): Record<string, number> {
  const map: Record<string, number> = {};
  for (const step of steps ?? []) map[step.id] = step.retries ?? 0;
  return map;
}
