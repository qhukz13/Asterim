/**
 * Tests for the Pipeline Execution Dashboard (P9-03).
 *
 * Four layers, matching the convention the delegation, team agent, environment
 * and desktop suites established:
 *
 *   1. Pure helpers — the DAG layout above all. `dagColumns` is what decides
 *      which steps are drawn as running together, and it is the one place in
 *      this feature where being subtly wrong is invisible: a graph that puts a
 *      step one column too far left claims a parallelism the definition does
 *      not have, and nothing on screen contradicts it. It is asserted here
 *      across a single step, a chain, a fan-out and a diamond.
 *   2. `usePipelineStore` against a recording `fetch`, so the exact URLs, verbs
 *      and bodies are asserted — including that a synthesis sends the step ids
 *      the operator chose rather than every step, and that a 400 from the
 *      parser is reported with the line it named.
 *   3. The five `pipeline:*` transitions routed through `handlePipelineEvent`,
 *      which is exactly what the socket layer calls, including a run that
 *      arrives on the socket having never been fetched.
 *   4. Real rendering through `react-dom/server`, driving the props-only views
 *      across pending, running, passed, failed, retried, conflicted and
 *      consolidated states.
 *
 * What it does NOT cover: click handlers, which need an event loop and a DOM
 * the repository does not have. Each connected container is a thin wrapper over
 * a view and the store, both of which are covered directly.
 *
 * Run:  pnpm --filter @asterim/web exec tsx src/components/pipelines/__tests__/PipelineUI.test.ts
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PIPELINE_COMPLETED_EVENT,
  PIPELINE_FAILED_EVENT,
  PIPELINE_STARTED_EVENT,
  PIPELINE_STEP_COMPLETED_EVENT,
  PIPELINE_STEP_STARTED_EVENT
} from '@asterim/shared';
import type {
  Pipeline,
  PipelineConflictAnalysis,
  PipelineRun,
  PipelineStep,
  PipelineStepRun,
  PipelineStepStatus,
  PipelineSynthesisResult,
  VerificationPipelineReport
} from '@asterim/shared';

// --- Environment stubs, installed before the store loads ---

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

const requests: RecordedRequest[] = [];
let nextResponse: { status: number; body: unknown } = { status: 200, body: {} };
/** Queued answers, for the flows that make more than one request. */
const responseQueue: { status: number; body: unknown }[] = [];
/** Set to make the next `fetch` reject, standing in for a Core that is down. */
let nextNetworkError: string | null = null;

interface TestGlobals {
  localStorage?: unknown;
  fetch?: unknown;
  process?: { exit(code: number): void };
}
const testGlobals = globalThis as TestGlobals;

const memoryStorage = new Map<string, string>();
testGlobals.localStorage = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => memoryStorage.set(key, value),
  removeItem: (key: string) => memoryStorage.delete(key)
};
localStorage.setItem('asterim_token', 'test-token');

testGlobals.fetch = async (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => {
  requests.push({
    url,
    method: init?.method || 'GET',
    headers: init?.headers || {},
    body: init?.body ? JSON.parse(init.body) : undefined
  });
  if (nextNetworkError) {
    const message = nextNetworkError;
    nextNetworkError = null;
    throw new Error(message);
  }
  const { status, body } = responseQueue.length > 0 ? responseQueue.shift()! : nextResponse;
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
};

type StoreModule = typeof import('../../../stores/usePipelineStore');
type GraphModule = typeof import('../PipelineDagGraph');
type InspectorModule = typeof import('../PipelineStepInspector');
type RunViewModule = typeof import('../PipelineRunView');
type ConflictModule = typeof import('../PipelineConflictCard');
type SynthesisModule = typeof import('../PipelineSynthesisModal');
type EditorModule = typeof import('../PipelineEditorModal');
type DashboardModule = typeof import('../PipelineDashboard');

let storeMod: StoreModule;
let graph: GraphModule;
let inspector: InspectorModule;
let runView: RunViewModule;
let conflict: ConflictModule;
let synthesis: SynthesisModule;
let editor: EditorModule;
let dashboard: DashboardModule;

// --- Assertion harness ---

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(
    label,
    ok,
    ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function describe(name: string): void {
  console.log(`\n${name}`);
}

// --- Fixtures ---

const NOW = 1_700_000_000_000;

function step(id: string, dependsOn: string[] = [], overrides: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id,
    name: `Step ${id}`,
    roleProfileId: 'tech-lead',
    task: `Do ${id}.`,
    dependsOn,
    ...overrides
  };
}

/** implement → (security, docs) → release: the shape every topology test uses. */
const DIAMOND: PipelineStep[] = [
  step('implement'),
  step('security', ['implement']),
  step('docs', ['implement']),
  step('release', ['security', 'docs'])
];

function pipelineFixture(steps: PipelineStep[] = DIAMOND, overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'pipe_1',
    workspaceId: 'ws_1',
    name: 'Feature delivery',
    description: 'Implement, review, document, release.',
    yaml: 'name: Feature delivery\ntrigger: MANUAL\nsteps: []\n',
    definition: {
      name: 'Feature delivery',
      trigger: 'MANUAL',
      steps
    },
    createdAt: NOW - 86_400_000,
    updatedAt: NOW - 86_400_000,
    ...overrides
  };
}

function stepRunFixture(
  stepId: string,
  status: PipelineStepStatus,
  overrides: Partial<PipelineStepRun> = {}
): PipelineStepRun {
  return {
    id: `run_1:${stepId}`,
    pipelineRunId: 'run_1',
    stepId,
    stepName: `Step ${stepId}`,
    roleProfileId: 'tech-lead',
    status,
    ...overrides
  };
}

function runFixture(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: 'run_1',
    pipelineId: 'pipe_1',
    status: 'RUNNING',
    runContext: {},
    startedAt: NOW - 120_000,
    projectId: 'proj_1',
    rootThreadId: 'thread_root',
    baseCommit: 'abcdef1234567890',
    steps: [
      stepRunFixture('implement', 'PASSED', {
        startedAt: NOW - 120_000,
        completedAt: NOW - 90_000,
        worktreeBranch: 'asterim/pipeline/run_1/step-implement',
        commitSha: 'fedcba9876543210'
      }),
      stepRunFixture('security', 'RUNNING', { startedAt: NOW - 90_000 }),
      stepRunFixture('docs', 'PENDING'),
      stepRunFixture('release', 'PENDING')
    ],
    ...overrides
  };
}

function analysisFixture(overrides: Partial<PipelineConflictAnalysis> = {}): PipelineConflictAnalysis {
  return {
    hasConflicts: false,
    conflictedFiles: [],
    branches: ['asterim/pipeline/run_1/step-security', 'asterim/pipeline/run_1/step-docs'],
    conflicts: [],
    missingStepIds: [],
    ...overrides
  };
}

function synthesisFixture(overrides: Partial<PipelineSynthesisResult> = {}): PipelineSynthesisResult {
  return {
    branchName: 'asterim/pipeline/run_1/pr',
    commitSha: '1234567890abcdef',
    mergedStepIds: ['implement', 'security'],
    skippedStepIds: ['docs'],
    baseCommit: 'abcdef1234567890',
    ...overrides
  };
}

function verificationFixture(passing: boolean): VerificationPipelineReport {
  return {
    passed: passing,
    totalSteps: 2,
    passedSteps: passing ? 2 : 1,
    failedSteps: passing ? 0 : 1,
    durationMs: 4200,
    executedAt: NOW - 60_000,
    cwd: '/tmp/asterim/worktrees/pipeline/run_1/implement',
    steps: [
      { name: 'typecheck', command: 'pnpm run typecheck', passed: true, exitCode: 0, durationMs: 2000 },
      {
        name: 'test',
        command: 'pnpm run test',
        passed: passing,
        exitCode: passing ? 0 : 1,
        durationMs: 2200
      }
    ]
  };
}

const noop = () => undefined;

/** Puts the store back to the state a fresh mount would see. */
function resetStore(): void {
  storeMod.usePipelineStore.getState().reset();
  requests.length = 0;
  responseQueue.length = 0;
  nextResponse = { status: 200, body: {} };
  nextNetworkError = null;
}

function renderGraph(props: Partial<Parameters<typeof graph.PipelineDagGraph>[0]> = {}): string {
  return renderToStaticMarkup(
    React.createElement(graph.PipelineDagGraph, { steps: DIAMOND, ...props })
  );
}

function renderInspector(
  props: Partial<Parameters<typeof inspector.PipelineStepInspectorView>[0]> = {}
): string {
  return renderToStaticMarkup(
    React.createElement(inspector.PipelineStepInspectorView, { step: null, now: NOW, ...props })
  );
}

function renderRunView(props: Partial<Parameters<typeof runView.PipelineRunView>[0]> = {}): string {
  return renderToStaticMarkup(
    React.createElement(runView.PipelineRunView, {
      run: runFixture(),
      pipeline: pipelineFixture(),
      onCancel: noop,
      onCheckConflicts: noop,
      onSynthesize: noop,
      now: NOW,
      ...props
    })
  );
}

function renderConflict(
  props: Partial<Parameters<typeof conflict.PipelineConflictCard>[0]> = {}
): string {
  return renderToStaticMarkup(
    React.createElement(conflict.PipelineConflictCard, { analysis: null, ...props })
  );
}

function renderSynthesis(
  props: Partial<Parameters<typeof synthesis.PipelineSynthesisModalView>[0]> = {}
): string {
  return renderToStaticMarkup(
    React.createElement(synthesis.PipelineSynthesisModalView, {
      run: runFixture({ status: 'PASSED' }),
      selectedStepIds: ['implement'],
      onToggleStep: noop,
      message: '',
      onMessageChange: noop,
      onSubmit: noop,
      onClose: noop,
      ...props
    })
  );
}

function renderEditor(
  props: Partial<Parameters<typeof editor.PipelineEditorModalView>[0]> = {}
): string {
  return renderToStaticMarkup(
    React.createElement(editor.PipelineEditorModalView, {
      yaml: '',
      onYamlChange: noop,
      onSelectTemplate: noop,
      onSubmit: noop,
      onClose: noop,
      ...props
    })
  );
}

function renderDashboard(
  props: Partial<Parameters<typeof dashboard.PipelineDashboardView>[0]> = {}
): string {
  return renderToStaticMarkup(
    React.createElement(dashboard.PipelineDashboardView, {
      pipelines: [pipelineFixture()],
      activePipelineId: 'pipe_1',
      onSelectPipeline: noop,
      runs: [],
      activeRunId: null,
      onSelectRun: noop,
      now: NOW,
      ...props
    })
  );
}

async function main(): Promise<void> {
  storeMod = await import('../../../stores/usePipelineStore');
  graph = await import('../PipelineDagGraph');
  inspector = await import('../PipelineStepInspector');
  runView = await import('../PipelineRunView');
  conflict = await import('../PipelineConflictCard');
  synthesis = await import('../PipelineSynthesisModal');
  editor = await import('../PipelineEditorModal');
  dashboard = await import('../PipelineDashboard');

  const {
    usePipelineStore,
    handlePipelineEvent,
    isPipelineEvent,
    reducePipelineEvent,
    describePipelineError,
    pipelineStepTone,
    pipelineRunTone,
    formatPipelineDuration,
    stepDurationMs,
    runDurationMs,
    attemptLabel,
    shortSha,
    runProgress,
    passingStepIds,
    isRunFinished,
    conflictSummary,
    orderedStepRuns,
    validatePipelineDraft,
    retriesByStepId,
    PIPELINE_TEMPLATES,
    PIPELINE_EVENT_TYPES
  } = storeMod;
  const { computeDagLayout, dagColumns, edgeIsActive, DAG_NODE_WIDTH, DAG_COLUMN_GAP } = graph;

  // --- 1. Pure DAG layout ----------------------------------------------------

  describe('dagColumns answers which steps run together');
  {
    equal('one step is one column', dagColumns([step('only')]), [['only']]);
    equal(
      'a chain is one step per column',
      dagColumns([step('a'), step('b', ['a']), step('c', ['b'])]),
      [['a'], ['b'], ['c']]
    );
    equal(
      'a fan-out puts the independent steps in the same column',
      dagColumns([step('a'), step('b', ['a']), step('c', ['a'])]),
      [['a'], ['b', 'c']]
    );
    equal('a diamond joins in a column of its own', dagColumns(DIAMOND), [
      ['implement'],
      ['security', 'docs'],
      ['release']
    ]);
    equal(
      'a step is ranked by its longest path, not its shortest',
      // `late` depends on a root and on a step two deep, so it cannot start
      // until the deeper one is done — drawing it beside `b` would be a lie.
      dagColumns([step('a'), step('b', ['a']), step('c', ['b']), step('late', ['a', 'c'])]),
      [['a'], ['b'], ['c'], ['late']]
    );
    equal(
      'a dependency on a step that does not exist is not an edge',
      dagColumns([step('a', ['ghost'])]),
      [['a']]
    );
    equal('two roots share the first column', dagColumns([step('a'), step('b')]), [['a', 'b']]);
    equal(
      'a column keeps the order the definition lists its steps in',
      dagColumns([step('a'), step('z', ['a']), step('m', ['a'])])[1],
      ['z', 'm']
    );
    equal('no steps is no columns', dagColumns([]), []);
    check(
      'a cycle still draws rather than hanging',
      dagColumns([step('a', ['b']), step('b', ['a'])]).flat().length === 2
    );
  }

  describe('computeDagLayout places nodes and edges');
  {
    const layout = computeDagLayout(DIAMOND);
    equal('every step becomes a node', layout.nodes.map(node => node.id), [
      'implement',
      'security',
      'docs',
      'release'
    ]);
    equal(
      'every declared dependency becomes an edge',
      layout.edges.map(edge => `${edge.from}->${edge.to}`),
      ['implement->security', 'implement->docs', 'security->release', 'docs->release']
    );
    const security = layout.nodes.find(node => node.id === 'security')!;
    const docs = layout.nodes.find(node => node.id === 'docs')!;
    equal('parallel steps share a column', [security.column, docs.column], [1, 1]);
    check('and are stacked, not overlaid', security.y < docs.y);
    equal('the second column is one node plus a gap to the right', security.x, DAG_NODE_WIDTH + DAG_COLUMN_GAP);
    check('every edge is a path from a source to a target', layout.edges.every(edge => edge.path.startsWith('M ')));
    check('the canvas is wide enough for three columns', layout.width >= 3 * DAG_NODE_WIDTH);
    check('and tall enough for two rows', layout.height > 100);

    const single = computeDagLayout([step('only')]);
    equal('a single step has no edges', single.edges, []);
    equal('and sits at the origin', [single.nodes[0].x, single.nodes[0].y], [0, 0]);

    const empty = computeDagLayout([]);
    equal('an empty definition lays out nothing', empty.nodes, []);
    check('but still has a non-zero canvas', empty.width > 0 && empty.height > 0);
  }

  describe('an edge is live only when it is feeding a running step');
  {
    const layout = computeDagLayout(DIAMOND);
    const edge = layout.edges.find(entry => entry.to === 'security')!;
    check(
      'a passed ancestor feeding a running step',
      edgeIsActive(edge, { implement: 'PASSED', security: 'RUNNING' })
    );
    check(
      'but not one feeding a step that has not started',
      !edgeIsActive(edge, { implement: 'PASSED', security: 'PENDING' })
    );
    check(
      'and not one whose source has not passed',
      !edgeIsActive(edge, { implement: 'RUNNING', security: 'RUNNING' })
    );
  }

  // --- 2. Pure presentation helpers -----------------------------------------

  describe('status tones tell the six step outcomes apart');
  {
    equal('pending', pipelineStepTone('PENDING').label, 'Pending');
    equal('running', pipelineStepTone('RUNNING').label, 'Running');
    equal('passed', pipelineStepTone('PASSED').label, 'Passed');
    equal('failed', pipelineStepTone('FAILED').label, 'Failed');
    equal('skipped', pipelineStepTone('SKIPPED').label, 'Skipped');
    equal('cancelled', pipelineStepTone('CANCELLED').label, 'Cancelled');
    check(
      'a step downstream of a failure does not read like one an operator stopped',
      pipelineStepTone('SKIPPED').color !== pipelineStepTone('CANCELLED').color
    );
    check(
      'and a failure does not read like a pass',
      pipelineStepTone('FAILED').color !== pipelineStepTone('PASSED').color
    );
    equal('a cancelled run says so', pipelineRunTone('CANCELLED').label, 'Cancelled');
    equal('and a failed one says so', pipelineRunTone('FAILED').label, 'Failed');
  }

  describe('durations, attempts and shas read the way a person would say them');
  {
    equal('seconds', formatPipelineDuration(42_000), '42s');
    equal('minutes and seconds', formatPipelineDuration(125_000), '2m 5s');
    equal('hours and minutes', formatPipelineDuration(7_200_000), '2h 0m');
    equal('an unknown duration is not zero', formatPipelineDuration(null), '—');
    equal(
      'a finished step is measured to its completion',
      stepDurationMs(stepRunFixture('a', 'PASSED', { startedAt: NOW - 5000, completedAt: NOW - 2000 })),
      3000
    );
    equal(
      'a running one is measured to now',
      stepDurationMs(stepRunFixture('a', 'RUNNING', { startedAt: NOW - 5000 }), NOW),
      5000
    );
    equal('a step that never started has no duration', stepDurationMs(stepRunFixture('a', 'PENDING')), null);
    equal('a live run is measured to now', runDurationMs(runFixture(), NOW), 120_000);

    equal('a step that worked first time carries no badge', attemptLabel({ attempts: 1 }), null);
    equal('and one with no record of attempts carries none either', attemptLabel({}), null);
    equal('a retried step says which attempt it is on', attemptLabel({ attempts: 2 }, 3), 'Attempt 2/4');
    equal(
      'and never claims more attempts than it was allowed',
      attemptLabel({ attempts: 2 }, 0),
      'Attempt 2/2'
    );
    equal('a sha is shown short', shortSha('abcdef1234567890'), 'abcdef1');
    equal('and an absent one is not shown as empty', shortSha(undefined), '—');
  }

  describe('a run summarizes its own progress');
  {
    const run = runFixture();
    equal('one of four steps has settled', runProgress(run), 0.25);
    equal('nothing known is no progress', runProgress(null), 0);
    equal(
      'a finished run is complete',
      runProgress(runFixture({ status: 'PASSED', steps: [stepRunFixture('a', 'PASSED')] })),
      1
    );
    equal('only the passing steps are offered to a synthesis', passingStepIds(run), ['implement']);
    check('a running run is not finished', !isRunFinished(run));
    check('a cancelled one is', isRunFinished(runFixture({ status: 'CANCELLED' })));
    equal(
      'steps are ordered by the definition rather than by the row order',
      orderedStepRuns(
        runFixture({ steps: [stepRunFixture('release', 'PENDING'), stepRunFixture('implement', 'PASSED')] }),
        DIAMOND
      ).map(entry => entry.stepId),
      ['implement', 'release']
    );
  }

  describe('the conflict summary says what an operator has to decide');
  {
    equal(
      'an unasked question is not an answer',
      conflictSummary(null),
      'These branches have not been compared yet.'
    );
    check('a clean analysis says how many branches', conflictSummary(analysisFixture()).includes('2 step branches'));
    check(
      'one branch cannot conflict with anything',
      conflictSummary(analysisFixture({ branches: ['asterim/pipeline/run_1/step-a'] })).includes('nothing to conflict')
    );
    check(
      'and a conflict counts the pairs and the files',
      conflictSummary(
        analysisFixture({
          hasConflicts: true,
          conflictedFiles: ['src/app.ts'],
          conflicts: [
            {
              stepIds: ['security', 'docs'],
              branches: ['asterim/pipeline/run_1/step-security', 'asterim/pipeline/run_1/step-docs'],
              files: ['src/app.ts']
            }
          ]
        })
      ) === '1 pair of step branches disagree on 1 file.'
    );
  }

  describe('a failure is described by its code, not by its status alone');
  {
    check('a pipeline already running', describePipelineError(undefined, 409, 'ALREADY_RUNNING').includes('already running'));
    check(
      'a run that has not finished',
      describePipelineError(undefined, 409, 'RUN_IN_PROGRESS').includes('has not finished')
    );
    check(
      'a synthesis conflict keeps the paths the Core named',
      describePipelineError('Step a conflicts in: src/app.ts.', 409, 'SYNTHESIS_CONFLICT').includes('src/app.ts')
    );
    check('an unauthenticated caller is told to sign in', describePipelineError(undefined, 401).includes('Sign in'));
    check('and a run with no fleet says why', describePipelineError(undefined, 400, 'NO_FLEET').includes('no step branches'));
  }

  describe('a draft is checked shallowly, and the Core stays the gate');
  {
    equal('an empty draft is refused', validatePipelineDraft('   ').length, 1);
    equal(
      'a complete draft has nothing to report',
      validatePipelineDraft(PIPELINE_TEMPLATES[0].yaml),
      []
    );
    check(
      'a draft with no name says so',
      validatePipelineDraft('steps:\n  - id: a\n').some(issue => issue.message.includes('`name:`'))
    );
    check(
      'a draft with no steps says so',
      validatePipelineDraft('name: x\n').some(issue => issue.message.includes('`steps:`'))
    );
    check(
      'a step with no id says so',
      validatePipelineDraft('name: x\nsteps:\n  - role: Tech Lead\n').some(issue =>
        issue.message.includes('`id:`')
      )
    );
    const tabbed = validatePipelineDraft('name: x\nsteps:\n\t- id: a\n');
    check('a tab is reported on the line it is on', tabbed.some(issue => issue.line === 3));
    check('every template is a draft this check accepts', PIPELINE_TEMPLATES.every(template => validatePipelineDraft(template.yaml).length === 0));
    check('and the templates cover a chain, a fan-out and a join', PIPELINE_TEMPLATES.length >= 3);
    equal(
      'retries are read off the definition per step',
      retriesByStepId([step('a', [], { retries: 2 }), step('b')]),
      { a: 2, b: 0 }
    );
  }

  // --- 3. Store against a recording fetch ------------------------------------

  describe('fetchPipelines asks for the workspace it was given');
  {
    resetStore();
    nextResponse = { status: 200, body: { pipelines: [pipelineFixture()] } };
    await usePipelineStore.getState().fetchPipelines('proj_1', 'ws_1');

    equal('one request', requests.length, 1);
    equal('to the pipelines route, scoped by workspace', requests[0].url, '/api/v1/pipelines?workspaceId=ws_1');
    equal('as a GET', requests[0].method, 'GET');
    check('carrying the pairing token', requests[0].headers['Authorization'] === 'Bearer test-token');
    equal('the list is adopted', usePipelineStore.getState().pipelines.length, 1);
    equal('the first pipeline is selected', usePipelineStore.getState().activePipelineId, 'pipe_1');
    equal('and the project is remembered', usePipelineStore.getState().projectId, 'proj_1');

    resetStore();
    nextResponse = { status: 200, body: { pipelines: [] } };
    await usePipelineStore.getState().fetchPipelines('proj_1');
    equal('without a workspace there is no query', requests[0].url, '/api/v1/pipelines');

    resetStore();
    nextResponse = { status: 200, body: { pipelines: [pipelineFixture()] } };
    await usePipelineStore.getState().fetchPipelines('proj_1');
    nextResponse = { status: 500, body: { error: 'boom' } };
    await usePipelineStore.getState().fetchPipelines('proj_1');
    equal('a failed refresh does not blank the list', usePipelineStore.getState().pipelines.length, 1);
    check('and it is reported', !!usePipelineStore.getState().error);

    resetStore();
    nextNetworkError = 'Failed to fetch';
    await usePipelineStore.getState().fetchPipelines('proj_1');
    equal('a Core that is down is reported as such', usePipelineStore.getState().error, 'Failed to fetch');
  }

  describe('fetchPipeline brings the definition and its runs');
  {
    resetStore();
    nextResponse = {
      status: 200,
      body: { pipeline: pipelineFixture(), runs: [runFixture({ id: 'run_old', startedAt: NOW - 500_000 }), runFixture()] }
    };
    await usePipelineStore.getState().fetchPipeline('pipe_1');

    equal('one request for the definition', requests[0].url, '/api/v1/pipelines/pipe_1');
    equal('the runs are held newest first', usePipelineStore.getState().runs.map(run => run.id), ['run_1', 'run_old']);
    equal('and the newest becomes the open one', usePipelineStore.getState().activeRunId, 'run_1');
  }

  describe('savePipeline sends the YAML as written');
  {
    resetStore();
    nextResponse = { status: 201, body: { pipeline: pipelineFixture() } };
    const saved = await usePipelineStore.getState().savePipeline({ workspaceId: 'ws_1', yaml: 'name: x\n' });

    equal('a POST', requests[0].method, 'POST');
    equal('to the collection', requests[0].url, '/api/v1/pipelines');
    equal('carrying the workspace and the text', requests[0].body, { workspaceId: 'ws_1', yaml: 'name: x\n' });
    check('the saved pipeline comes back', saved?.id === 'pipe_1');
    equal('and it becomes the selected one', usePipelineStore.getState().activePipelineId, 'pipe_1');

    resetStore();
    usePipelineStore.setState({ pipelines: [pipelineFixture()] });
    nextResponse = { status: 200, body: { pipeline: pipelineFixture(DIAMOND, { name: 'Renamed' }) } };
    await usePipelineStore.getState().savePipeline({ id: 'pipe_1', yaml: 'name: Renamed\n' });
    equal('an edit replaces rather than duplicates', usePipelineStore.getState().pipelines.length, 1);
    equal('with the new definition', usePipelineStore.getState().pipelines[0].name, 'Renamed');
    equal('and the id is sent', requests[0].body, { id: 'pipe_1', yaml: 'name: Renamed\n' });

    resetStore();
    nextResponse = {
      status: 400,
      body: { error: 'Duplicate step id `a`.', code: 'INVALID_DEFINITION', line: 7 }
    };
    const refused = await usePipelineStore.getState().savePipeline({ yaml: 'broken' });
    equal('a refused definition saves nothing', refused, null);
    check(
      'and the line the parser stopped on is kept',
      (usePipelineStore.getState().error || '').startsWith('Line 7: '),
      usePipelineStore.getState().error || ''
    );
  }

  describe('runPipeline, fetchRun and cancelRun address the right routes');
  {
    resetStore();
    nextResponse = { status: 200, body: { run: runFixture({ status: 'PASSED' }) } };
    const run = await usePipelineStore.getState().runPipeline('pipe_1', { ticket: 'ASTER-1' });

    equal('a POST to the run route', requests[0].url, '/api/v1/pipelines/pipe_1/run');
    equal('carrying the run context', requests[0].body, { runContext: { ticket: 'ASTER-1' } });
    equal('the outcome comes back', run?.status, 'PASSED');
    equal('and the run is opened', usePipelineStore.getState().activeRunId, 'run_1');

    resetStore();
    nextResponse = { status: 409, body: { error: 'already going', code: 'ALREADY_RUNNING' } };
    equal('a second run while one is going is refused', await usePipelineStore.getState().runPipeline('pipe_1'), null);
    check('and said so plainly', (usePipelineStore.getState().error || '').includes('already running'));

    resetStore();
    nextResponse = { status: 200, body: { run: runFixture() } };
    await usePipelineStore.getState().fetchRun('run_1');
    equal('a run is read by id', requests[0].url, '/api/v1/pipeline-runs/run_1');
    equal('and held', usePipelineStore.getState().runs.length, 1);

    resetStore();
    nextResponse = { status: 200, body: { success: true, cancelled: true, run: runFixture({ status: 'CANCELLED' }) } };
    equal('a cancellation answers true', await usePipelineStore.getState().cancelRun('run_1', 'enough'), true);
    equal('to the cancel route', requests[0].url, '/api/v1/pipeline-runs/run_1/cancel');
    equal('carrying the reason', requests[0].body, { reason: 'enough' });
    equal('and the run is now cancelled', usePipelineStore.getState().runs[0].status, 'CANCELLED');

    resetStore();
    nextResponse = { status: 200, body: { success: true, cancelled: false, run: runFixture({ status: 'PASSED' }) } };
    equal(
      'cancelling a run that had already finished is not a failure',
      await usePipelineStore.getState().cancelRun('run_1'),
      false
    );
    check('and is not reported as an error', !usePipelineStore.getState().error);
    check('but is explained', (usePipelineStore.getState().notice || '').includes('already finished'));
  }

  describe('conflicts and synthesis');
  {
    resetStore();
    nextResponse = { status: 200, body: { runId: 'run_1', analysis: analysisFixture() } };
    const analysis = await usePipelineStore.getState().checkConflicts('run_1');
    equal('a GET, because asking changes nothing', requests[0].method, 'GET');
    equal('to the conflicts route', requests[0].url, '/api/v1/pipeline-runs/run_1/conflicts');
    check('the answer is clean', analysis?.hasConflicts === false);
    check('and is kept against the run', !!usePipelineStore.getState().conflictAnalysisByRunId['run_1']);

    resetStore();
    nextResponse = { status: 200, body: { synthesis: synthesisFixture(), run: runFixture({ status: 'PASSED', synthesisBranch: 'asterim/pipeline/run_1/pr' }) } };
    const result = await usePipelineStore.getState().synthesizeRun('run_1', {
      stepIds: ['implement', 'security'],
      message: 'Ship it'
    });
    equal('a POST to the synthesize route', requests[0].url, '/api/v1/pipeline-runs/run_1/synthesize');
    equal('carrying exactly the steps chosen', requests[0].body, {
      stepIds: ['implement', 'security'],
      message: 'Ship it'
    });
    equal('the branch comes back', result?.branchName, 'asterim/pipeline/run_1/pr');
    equal('the run now records it', usePipelineStore.getState().runs[0].synthesisBranch, 'asterim/pipeline/run_1/pr');
    check('and the notice names it', (usePipelineStore.getState().notice || '').includes('asterim/pipeline/run_1/pr'));

    resetStore();
    nextResponse = { status: 200, body: { synthesis: synthesisFixture(), run: null } };
    await usePipelineStore.getState().synthesizeRun('run_1');
    equal('with nothing chosen the Core decides', requests[0].body, {});

    resetStore();
    nextResponse = {
      status: 409,
      body: { error: 'Step docs conflicts with the steps already consolidated, in: src/app.ts.', code: 'SYNTHESIS_CONFLICT' }
    };
    equal('a conflicted synthesis produces nothing', await usePipelineStore.getState().synthesizeRun('run_1'), null);
    check('and names the file', (usePipelineStore.getState().error || '').includes('src/app.ts'));
    equal('no branch is recorded', usePipelineStore.getState().synthesisByRunId['run_1'], undefined);
  }

  describe('a step’s verification is read from the thread it ran in');
  {
    resetStore();
    nextResponse = { status: 200, body: { threadId: 'thread_1', report: verificationFixture(false) } };
    const report = await usePipelineStore.getState().fetchStepVerification('thread_1');
    equal('the thread verification route', requests[0].url, '/api/v1/threads/thread_1/worktree/verify');
    check('the report comes back', report?.passed === false);
    check('and is kept by thread', !!usePipelineStore.getState().verificationByThreadId['thread_1']);

    resetStore();
    nextResponse = { status: 404, body: {} };
    equal('a thread with no report is not an error', await usePipelineStore.getState().fetchStepVerification('thread_x'), null);
    check('and is not reported as one', !usePipelineStore.getState().error);
  }

  // --- 4. Socket transitions -------------------------------------------------

  describe('the five pipeline transitions are the ones the socket routes');
  {
    equal('all five are listened for', PIPELINE_EVENT_TYPES.length, 5);
    check('a pipeline event is recognised', isPipelineEvent({ type: PIPELINE_STEP_STARTED_EVENT }));
    check('an unrelated one is not', !isPipelineEvent({ type: 'agent.log' }));
    check('and neither is nothing at all', !isPipelineEvent(null));
  }

  describe('a run that starts on the socket is drawn before it is fetched');
  {
    resetStore();
    usePipelineStore.setState({ activePipelineId: 'pipe_1' });
    handlePipelineEvent(PIPELINE_STARTED_EVENT, {
      projectId: 'proj_1',
      threadId: 'thread_root',
      pipelineId: 'pipe_1',
      runId: 'run_9',
      name: 'Feature delivery',
      stepIds: ['implement', 'security', 'docs', 'release']
    });

    const planted = usePipelineStore.getState().runs[0];
    equal('the run is planted', planted.id, 'run_9');
    equal('with every step it planned', planted.steps.map(entry => entry.stepId), [
      'implement',
      'security',
      'docs',
      'release'
    ]);
    check('all of them pending', planted.steps.every(entry => entry.status === 'PENDING'));
    equal('and it is adopted, because its pipeline is the open one', usePipelineStore.getState().activeRunId, 'run_9');

    // A run starting elsewhere must not pull the panel off what is being read.
    handlePipelineEvent(PIPELINE_STARTED_EVENT, {
      projectId: 'proj_1',
      pipelineId: 'pipe_other',
      runId: 'run_other',
      name: 'Nightly',
      stepIds: ['a']
    });
    equal('another pipeline’s run is held but not adopted', usePipelineStore.getState().activeRunId, 'run_9');
    equal('though it is known about', usePipelineStore.getState().runs.length, 2);

    // Pressing Run while an older run of the same pipeline is open is a request
    // to watch the new one.
    handlePipelineEvent(PIPELINE_STARTED_EVENT, {
      projectId: 'proj_1',
      pipelineId: 'pipe_1',
      runId: 'run_10',
      name: 'Feature delivery',
      stepIds: ['implement']
    });
    equal('a newer run of the open pipeline takes the panel', usePipelineStore.getState().activeRunId, 'run_10');

    // The same event twice must not duplicate or reset it.
    usePipelineStore.getState().handlePipelineEvent(PIPELINE_STARTED_EVENT, {
      projectId: 'proj_1',
      pipelineId: 'pipe_1',
      runId: 'run_9',
      name: 'Feature delivery',
      stepIds: ['implement']
    });
    equal('a repeated start does not re-plant the run', usePipelineStore.getState().runs.filter(run => run.id === 'run_9').length, 1);
    equal('nor shrink it', usePipelineStore.getState().runs.find(run => run.id === 'run_9')!.steps.length, 4);
  }

  describe('a node moves PENDING → RUNNING → PASSED without a fetch');
  {
    resetStore();
    usePipelineStore.setState({ runs: [runFixture({ steps: [stepRunFixture('implement', 'PENDING')] })] });

    handlePipelineEvent(PIPELINE_STEP_STARTED_EVENT, {
      projectId: 'proj_1',
      pipelineId: 'pipe_1',
      runId: 'run_1',
      stepId: 'implement',
      stepName: 'Implement the change',
      roleProfileId: 'tech-lead',
      batchStepIds: ['implement'],
      attempt: 1
    });
    const running = usePipelineStore.getState().runs[0];
    equal('the node is running', running.steps[0].status, 'RUNNING');
    equal('named by the event rather than by its id', running.steps[0].stepName, 'Implement the change');
    equal('and its role is known', running.steps[0].roleProfileId, 'tech-lead');
    equal('the run points at it', running.currentStepId, 'implement');

    handlePipelineEvent(PIPELINE_STEP_COMPLETED_EVENT, {
      projectId: 'proj_1',
      pipelineId: 'pipe_1',
      runId: 'run_1',
      step: stepRunFixture('implement', 'PASSED', {
        stepName: 'Implement the change',
        worktreeBranch: 'asterim/pipeline/run_1/step-implement',
        commitSha: 'aaaabbbb',
        output: 'done',
        diff: '--- a\n+++ b\n',
        attempts: 1,
        startedAt: NOW - 5000,
        completedAt: NOW
      })
    });
    const settled = usePipelineStore.getState().runs[0].steps[0];
    equal('the node passed', settled.status, 'PASSED');
    equal('carrying its branch', settled.worktreeBranch, 'asterim/pipeline/run_1/step-implement');
    equal('and its diff', settled.diff, '--- a\n+++ b\n');

    // A retry is a second `step_started` for a step that already settled.
    handlePipelineEvent(PIPELINE_STEP_STARTED_EVENT, {
      projectId: 'proj_1',
      pipelineId: 'pipe_1',
      runId: 'run_1',
      stepId: 'implement',
      stepName: 'Implement the change',
      roleProfileId: 'tech-lead',
      batchStepIds: ['implement'],
      attempt: 2
    });
    const retried = usePipelineStore.getState().runs[0].steps[0];
    equal('a retry puts the node back to running', retried.status, 'RUNNING');
    equal('on the attempt the engine says it is', retried.attempts, 2);
    equal('and clears the failure it is retrying', retried.errorMessage, undefined);

    // A step of a run this tab does not hold changes nothing.
    const before = JSON.stringify(usePipelineStore.getState().runs);
    handlePipelineEvent(PIPELINE_STEP_STARTED_EVENT, {
      projectId: 'proj_1',
      pipelineId: 'pipe_1',
      runId: 'run_unknown',
      stepId: 'implement',
      stepName: 'Implement',
      roleProfileId: 'tech-lead',
      batchStepIds: ['implement']
    });
    equal('an unknown run is ignored rather than invented', JSON.stringify(usePipelineStore.getState().runs), before);
  }

  describe('a run that ends stops looking live, however it ended');
  {
    resetStore();
    usePipelineStore.setState({ runs: [runFixture()] });
    handlePipelineEvent(PIPELINE_COMPLETED_EVENT, {
      projectId: 'proj_1',
      pipelineId: 'pipe_1',
      run: runFixture({ status: 'PASSED', completedAt: NOW })
    });
    equal('a completed run is passed', usePipelineStore.getState().runs[0].status, 'PASSED');

    resetStore();
    usePipelineStore.setState({ runs: [runFixture()] });
    handlePipelineEvent(PIPELINE_FAILED_EVENT, {
      projectId: 'proj_1',
      pipelineId: 'pipe_1',
      run: runFixture({ status: 'FAILED', completedAt: NOW }),
      errorMessage: 'Step security did not complete.'
    });
    equal('a failed run is failed', usePipelineStore.getState().runs[0].status, 'FAILED');
    equal('and carries why', usePipelineStore.getState().runs[0].errorMessage, 'Step security did not complete.');

    resetStore();
    usePipelineStore.setState({ runs: [runFixture()] });
    handlePipelineEvent(PIPELINE_FAILED_EVENT, {
      projectId: 'proj_1',
      pipelineId: 'pipe_1',
      run: runFixture({ status: 'CANCELLED', completedAt: NOW })
    });
    equal(
      'a cancellation arrives on the failure event and is still a cancellation',
      usePipelineStore.getState().runs[0].status,
      'CANCELLED'
    );

    equal(
      'an event nothing knows about leaves the runs alone',
      reducePipelineEvent([runFixture()], 'pipeline:nonsense', {})[0].status,
      'RUNNING'
    );
  }

  // --- 5. Rendering ----------------------------------------------------------

  describe('PipelineDagGraph draws the graph, the roles and the retries');
  {
    const markup = renderGraph({
      stepRuns: runFixture().steps,
      selectedStepId: 'security',
      retriesByStepId: { security: 2 }
    });
    check('every step is a node', ['implement', 'security', 'docs', 'release'].every(id => markup.includes(`data-step-id="${id}"`)));
    check('the edges are drawn', markup.includes('<path'));
    check('with arrow heads', markup.includes('marker-end'));
    check('a passed step says so', markup.includes('Passed'));
    check('a running one says so', markup.includes('Running'));
    check('a pending one says so', markup.includes('Pending'));
    check('the role is a pill on the node', markup.includes('tech-lead'));
    check('the selected node is pressed', markup.includes('aria-pressed="true"'));
    check('a node is a real button a keyboard can reach', markup.includes('<button'));
    check('and is labelled by its name and status', markup.includes('aria-label="Step Step security — Running"'));

    const retried = renderGraph({
      stepRuns: [stepRunFixture('implement', 'FAILED', { attempts: 3 })],
      retriesByStepId: { implement: 3 }
    });
    check('a retried node carries its attempt', retried.includes('Attempt 3/4'));
    const first = renderGraph({ stepRuns: [stepRunFixture('implement', 'PASSED', { attempts: 1 })] });
    check('and a step that worked first time carries no badge', !first.includes('Attempt'));

    check('a definition with no steps says so', renderGraph({ steps: [] }).includes('declares no steps'));
    check('a single step still draws', renderGraph({ steps: [step('only')] }).includes('data-step-id="only"'));
  }

  describe('PipelineStepInspectorView shows the evidence, not a summary of it');
  {
    const nothing = renderInspector();
    check('with nothing selected it says so', nothing.includes('Select a step'));

    const full = renderInspector({
      step: stepRunFixture('implement', 'PASSED', {
        threadId: 'thread_1',
        worktreeBranch: 'asterim/pipeline/run_1/step-implement',
        worktreePath: '/tmp/repo/.asterim/worktrees/pipeline/run_1/implement',
        commitSha: 'fedcba9876543210',
        output: 'I changed the auth middleware.',
        diff: '--- a/src/auth.ts\n+++ b/src/auth.ts\n',
        attempts: 2,
        startedAt: NOW - 30_000,
        completedAt: NOW
      }),
      definition: step('implement', [], { retries: 2, task: 'Implement the auth change.' }),
      verification: verificationFixture(false)
    });
    check('the brief it was handed', full.includes('Implement the auth change.'));
    check('what it said', full.includes('I changed the auth middleware.'));
    check('what it changed', full.includes('--- a/src/auth.ts'));
    check('the branch its work is on', full.includes('asterim/pipeline/run_1/step-implement'));
    check('the checkout it worked in', full.includes('.asterim/worktrees/pipeline/run_1/implement'));
    check('the commit it settled at', full.includes('fedcba9'));
    check('how long it took', full.includes('30s'));
    check('which attempt it was on', full.includes('Attempt 2/3'));
    check('what the project’s own checks said', full.includes('typecheck') && full.includes('test'));
    check('and that they did not all pass', full.includes('failed (1)'));

    const bare = renderInspector({ step: stepRunFixture('docs', 'PENDING'), definition: step('docs') });
    check('a step that has not run says it has said nothing', bare.includes('said nothing yet'));
    check('and changed nothing', bare.includes('changed nothing'));
    check('and that nothing was verified', bare.includes('Nothing was verified'));

    const broken = renderInspector({
      step: stepRunFixture('security', 'FAILED', { errorMessage: 'The step timed out. (after 3 attempts)' }),
      definition: step('security')
    });
    check('a failure is an alert', broken.includes('role="alert"'));
    check('naming what happened', broken.includes('after 3 attempts'));

    const skipped = renderInspector({ step: stepRunFixture('release', 'SKIPPED'), definition: step('release') });
    check('a skipped step is not shown as cancelled', skipped.includes('Skipped') && !skipped.includes('Cancelled'));
  }

  describe('PipelineRunView carries the facts that are true of the whole run');
  {
    const live = renderRunView();
    check('the pipeline’s name', live.includes('Feature delivery'));
    check('its status', live.includes('Running'));
    check('the commit every step branched from', live.includes('abcdef1'));
    check('how many steps have passed', live.includes('1/4 passed'));
    check('progress as a bar, not a guess', live.includes('role="progressbar"') && live.includes('aria-valuenow="25"'));
    check('a live run can be cancelled', live.includes('Cancel run'));
    check('but not consolidated', !live.includes('Synthesize PR'));

    const done = renderRunView({
      run: runFixture({
        status: 'PASSED',
        completedAt: NOW,
        synthesisBranch: 'asterim/pipeline/run_1/pr',
        steps: runFixture().steps.map(entry => ({ ...entry, status: 'PASSED' as PipelineStepStatus }))
      }),
      onCheckConflicts: noop,
      onSynthesize: noop,
      onCancel: noop
    });
    check('a finished run offers a conflict check', done.includes('Check conflicts'));
    check('and a synthesis', done.includes('Synthesize PR'));
    check('but no longer a cancellation', !done.includes('Cancel run'));
    check('and names the branch a synthesis produced', done.includes('asterim/pipeline/run_1/pr'));

    const failed = renderRunView({
      run: runFixture({ status: 'FAILED', completedAt: NOW, errorMessage: 'Step security failed.' })
    });
    check('a failure is an alert', failed.includes('role="alert"'));
    check('naming the step', failed.includes('Step security failed.'));

    const undefinedGraph = renderRunView({ pipeline: null });
    check(
      'a run whose definition has not arrived still draws its own steps',
      undefinedGraph.includes('data-step-id="security"')
    );
  }

  describe('PipelineConflictCard says whether a merge would work');
  {
    const unasked = renderConflict({ onCheck: noop });
    check('an unasked question offers to ask it', unasked.includes('Check conflicts'));
    check('and does not claim an answer', unasked.includes('have not been compared'));

    const clean = renderConflict({ analysis: analysisFixture(), onCheck: noop });
    check('a clean answer says how many branches merge', clean.includes('2 step branches merge cleanly'));
    check('and offers to ask again', clean.includes('Check again'));

    const dirty = renderConflict({
      analysis: analysisFixture({
        hasConflicts: true,
        conflictedFiles: ['src/app.ts', 'src/auth.ts'],
        conflicts: [
          {
            stepIds: ['security', 'docs'],
            branches: ['asterim/pipeline/run_1/step-security', 'asterim/pipeline/run_1/step-docs'],
            files: ['src/app.ts', 'src/auth.ts']
          }
        ],
        missingStepIds: ['release']
      })
    });
    check('a conflict names the pair', dirty.includes('security') && dirty.includes('docs'));
    check('and every file they disagree on', dirty.includes('src/app.ts, src/auth.ts'));
    check('and says which steps had no branch to compare', dirty.includes('release'));

    const checking = renderConflict({ analysis: null, isChecking: true, onCheck: noop });
    check('a check in flight says so', checking.includes('Checking…'));
  }

  describe('PipelineSynthesisModalView is a choice, not a button');
  {
    const dialog = renderSynthesis();
    check('it is a dialog', dialog.includes('role="dialog"'));
    check('naming the branch it would build', dialog.includes('asterim/pipeline/run_1/pr'));
    check('and saying the operator’s branch is untouched', dialog.includes('not touched'));
    check('only the passing steps are offered', dialog.includes('Include Step implement'));
    check('and the ones that did not pass are not', !dialog.includes('Include Step docs'));
    check('the chosen one is checked', dialog.includes('checked=""'));
    check('there is a commit message field', dialog.includes('aria-label="Synthesis commit message"'));

    const nothing = renderSynthesis({ selectedStepIds: [] });
    check('with nothing chosen the button is disabled', nothing.includes('disabled'));

    const nonePassed = renderSynthesis({
      run: runFixture({ status: 'FAILED', steps: [stepRunFixture('implement', 'FAILED')] })
    });
    check('a run with no passing step says there is nothing to consolidate', nonePassed.includes('nothing to consolidate'));

    const done = renderSynthesis({ result: synthesisFixture() });
    check('a finished synthesis names the branch', done.includes('asterim/pipeline/run_1/pr'));
    check('the steps it carries', done.includes('implement, security'));
    check('and the ones that contributed nothing', done.includes('docs had nothing to contribute'));

    const refused = renderSynthesis({ error: 'These step branches cannot be combined.' });
    check('a refusal is an alert', refused.includes('role="alert"'));
  }

  describe('PipelineEditorModalView edits the text, not a form over it');
  {
    const blank = renderEditor();
    check('there is a YAML field', blank.includes('aria-label="Pipeline YAML"'));
    check('an empty draft cannot be saved', blank.includes('cannot be empty'));
    check('and the button is disabled while it cannot', blank.includes('disabled'));
    check('the presets are offered', PIPELINE_TEMPLATES.every(template => blank.includes(template.name)));

    const good = renderEditor({ yaml: PIPELINE_TEMPLATES[0].yaml });
    check('a complete draft reports nothing', !good.includes('Draft problems'));
    check('and can be created', good.includes('Create pipeline'));

    const tabbed = renderEditor({ yaml: 'name: x\nsteps:\n\t- id: a\n' });
    check('a tab is reported with its line', tabbed.includes('Line 3'));

    const editing = renderEditor({ yaml: 'name: x\nsteps:\n  - id: a\n', editing: pipelineFixture() });
    check('editing names the pipeline', editing.includes('Edit Feature delivery'));
    check('and saves rather than creates', editing.includes('Save definition'));
    check('the presets are not offered over an existing definition', !editing.includes('Fan out and join'));

    const refused = renderEditor({
      yaml: 'name: x\nsteps:\n  - id: a\n',
      error: 'Line 7: Duplicate step id `a`.'
    });
    check('what the Core refused is shown with its line', refused.includes('Line 7'));
  }

  describe('PipelineDashboardView is a master-detail over definitions and runs');
  {
    const empty = renderDashboard({ pipelines: [], activePipelineId: null });
    check('no definitions says so', empty.includes('No pipeline is defined yet'));
    check('and explains what one is', empty.includes('written down once'));
    check('while still offering to create one', empty.includes('aria-label="New pipeline"'));

    const listed = renderDashboard();
    check('the definition is listed', listed.includes('Feature delivery'));
    check('with its size and trigger', listed.includes('4 steps · MANUAL'));
    check('it can be run', listed.includes('aria-label="Run Feature delivery"'));
    check('and edited', listed.includes('aria-label="Edit Feature delivery"'));
    check('a pipeline that has not run says so', listed.includes('has not run yet'));
    check('and the panel asks for a run to show', listed.includes('pick a run from its history'));

    const withRun = renderDashboard({
      runs: [runFixture()],
      activeRunId: 'run_1',
      selectedStepId: 'security',
      inspector: React.createElement(inspector.PipelineStepInspectorView, {
        step: stepRunFixture('security', 'RUNNING', { startedAt: NOW - 1000 }),
        definition: step('security', ['implement']),
        now: NOW
      })
    });
    check('the open run is drawn', withRun.includes('data-step-id="release"'));
    check('the run history is listed', withRun.includes('aria-label="Run history"'));
    check('and the inspector sits beside the graph', withRun.includes('aria-label="Step inspector"'));

    const loading = renderDashboard({ pipelines: [], activePipelineId: null, loading: true });
    check('a first load says so', loading.includes('Loading pipelines…'));

    const failed = renderDashboard({ error: 'Sign in to run pipelines on this workstation.' });
    check('a failure is an alert', failed.includes('role="alert"'));
  }

  describe('nothing rendered carries a credential');
  {
    const markup = [
      renderGraph({ stepRuns: runFixture().steps }),
      renderInspector({ step: stepRunFixture('implement', 'PASSED', { output: 'ok' }), definition: step('implement') }),
      renderRunView(),
      renderConflict({ analysis: analysisFixture() }),
      renderSynthesis({ result: synthesisFixture() }),
      renderEditor({ yaml: PIPELINE_TEMPLATES[0].yaml }),
      renderDashboard({ runs: [runFixture()], activeRunId: 'run_1' })
    ].join('');
    check('no token appears', !markup.includes('test-token') && !markup.includes('Bearer'));
  }
}

main()
  .catch(err => {
    failed++;
    console.error('\nUNCAUGHT ERROR:', err);
  })
  .finally(() => {
    console.log(`\n${passed}/${passed + failed} assertions passed`);
    if (failures.length > 0) {
      console.log('Failed assertions:');
      for (const f of failures) console.log(`  - ${f}`);
    }
    testGlobals.process?.exit(failed === 0 ? 0 : 1);
  });
