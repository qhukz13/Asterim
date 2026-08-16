/**
 * Tests for the Multi-Agent Delegation UI (P7-02).
 *
 * Three layers, matching the convention the profiles, MCP and skills suites
 * established:
 *   1. Pure helpers — the tree transformation, the status vocabulary, the
 *      request body — called directly. `buildThreadTree` gets the most
 *      attention because it is the one piece here that can be handed data no
 *      one wrote deliberately: `parent_thread_id` is an ordinary column, and a
 *      cycle in it must cost a nesting level rather than the browser tab.
 *   2. `useProjectStore` driven through `handleDelegationEvent`, which is the
 *      exact entry point `useSocket` uses, plus `syncDelegations` against a
 *      recording `fetch` so the URL and method are asserted rather than assumed.
 *   3. Real rendering through `react-dom/server`, driving the props-only views.
 *
 * Click handlers are reached without a DOM by calling a props-only function
 * component directly and walking the element tree it returns for the button
 * (`findElement` below). That works precisely because these views hold no state
 * of their own; anything that used a hook would need a renderer, and the
 * repository has none.
 *
 * Run:  pnpm --filter @asterim/web exec tsx src/components/delegation/__tests__/DelegationUI.test.ts
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MAX_CONCURRENT_DELEGATIONS,
  aggregateDelegationStatus,
  aggregateReviewVerdict
} from '@asterim/shared';
import type {
  AgentProfile,
  BatchDelegationResult,
  DelegationChildSummary,
  DelegationContext,
  DelegationResult,
  ParallelDelegationItem,
  VerificationPipelineReport,
  VerificationStepResult,
  WorktreeInfo
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
  const { status, body } = nextResponse;
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
};

function respond(body: unknown, status = 200): void {
  nextResponse = { status, body };
}

type StoreModule = typeof import('../../../stores/useProjectStore');
type StatusModule = typeof import('../DelegationStatus');
type TreeModule = typeof import('../ThreadTree');
type ModalModule = typeof import('../DelegateModal');

let store: StoreModule;
let status: StatusModule;
let tree: TreeModule;
let modal: ModalModule;

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

const PROJECT = 'project-1';

function context(overrides: Partial<DelegationContext> = {}): string {
  return JSON.stringify({
    parentThreadId: 'root',
    depth: 1,
    kind: 'TASK',
    taskDescription: 'Harden the upload route.',
    role: 'Security Auditor',
    requestedAt: 100,
    ...overrides
  } as DelegationContext);
}

function thread(id: string, extra: Record<string, unknown> = {}) {
  return { id, project_id: PROJECT, name: id, ...extra };
}

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'builtin-security-auditor',
    name: 'Security Auditor',
    role: 'Security Auditor',
    description: 'Audits for injection and traversal.',
    systemPrompt: 'Look for the traversal.',
    enabledSkills: [],
    autoApprovalRules: [],
    isBuiltin: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function result(overrides: Partial<DelegationResult> = {}): DelegationResult {
  return {
    childThreadId: 'child-1',
    status: 'COMPLETED',
    summary: 'Added a path check to the upload route.',
    output: 'full transcript',
    role: 'Security Auditor',
    depth: 1,
    finishedAt: 500,
    ...overrides
  };
}

function batch(overrides: Partial<BatchDelegationResult> = {}): BatchDelegationResult {
  const results = overrides.results ?? [
    result({ childThreadId: 'child-a', role: 'Senior Backend Engineer' }),
    result({ childThreadId: 'child-b', role: 'QA Engineer', status: 'FAILED', summary: 'It crashed.' })
  ];
  return {
    parentThreadId: 'root',
    overallStatus: aggregateDelegationStatus(results),
    results,
    aggregatedVerdict: aggregateReviewVerdict(results),
    summary: `1 of ${results.length} delegated agents completed (1 failed).`,
    startedAt: 100,
    finishedAt: 900,
    ...overrides
  };
}

// --- Fixtures: sandboxes and verification (P8-03) ----------------------------

function step(overrides: Partial<VerificationStepResult> = {}): VerificationStepResult {
  return {
    name: 'typecheck',
    command: 'pnpm run typecheck',
    passed: true,
    exitCode: 0,
    durationMs: 400,
    ...overrides
  };
}

function report(overrides: Partial<VerificationPipelineReport> = {}): VerificationPipelineReport {
  const steps = overrides.steps ?? [
    step(),
    step({ name: 'lint', command: 'pnpm run lint' }),
    step({ name: 'test', command: 'pnpm run test' }),
    step({ name: 'build', command: 'pnpm run build' })
  ];
  const broken = steps.filter(entry => !entry.passed).length;
  return {
    passed: steps.length > 0 && broken === 0,
    totalSteps: steps.length,
    passedSteps: steps.length - broken,
    failedSteps: broken,
    durationMs: 1200,
    steps,
    executedAt: 1000,
    cwd: '/home/op/payments/.asterim/worktrees/child-1',
    ...overrides
  };
}

/** A report whose typecheck failed, with the output that says why. */
function failedReport(): VerificationPipelineReport {
  return report({
    steps: [
      step({
        passed: false,
        exitCode: 1,
        durationMs: 900,
        stdoutSummary: 'src/routes/upload.ts(14,3): error TS2345: Argument of type ...',
        stderrSummary: 'error: 1 problem'
      }),
      step({ name: 'lint', command: 'pnpm run lint' })
    ]
  });
}

function worktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    threadId: 'child-1',
    path: '/home/op/payments/.asterim/worktrees/child-1',
    branch: 'asterim/sandbox/child-1',
    baseCommit: 'abc1234',
    createdAt: 100,
    status: 'ACTIVE',
    ...overrides
  };
}

const SANDBOX_DIFF = [
  'diff --git a/apps/server/src/routes/upload.ts b/apps/server/src/routes/upload.ts',
  'index 1111111..2222222 100644',
  '--- a/apps/server/src/routes/upload.ts',
  '+++ b/apps/server/src/routes/upload.ts',
  '@@ -1,3 +1,4 @@',
  '+  assertInsideRoot(target);',
  '-  const target = join(root, name);',
  '   return target;'
].join('\n');

const noop = () => undefined;

interface ElementLike {
  props?: Record<string, unknown> & { children?: unknown };
}

/** The first node in a returned element tree whose props match. */
function findElement(
  node: unknown,
  match: (props: Record<string, unknown>) => boolean
): ElementLike | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findElement(entry, match);
      if (found) return found;
    }
    return null;
  }
  const element = node as ElementLike;
  if (!element.props) return null;
  if (match(element.props)) return element;
  return findElement(element.props.children, match);
}

function renderTree(props: Partial<Parameters<typeof tree.ThreadTreeView>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(tree.ThreadTreeView, {
      nodes: [],
      activeThreadId: null,
      parentStates: {},
      childStates: {},
      collapsed: {},
      onSelect: noop,
      onToggleCollapse: noop,
      ...props
    })
  );
}

function renderStatus(props: Partial<Parameters<typeof status.DelegationStatusView>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(status.DelegationStatusView, {
      parentState: 'ACTIVE',
      outcome: null,
      onInspectChild: noop,
      ...props
    })
  );
}

function renderModal(props: Partial<Parameters<typeof modal.DelegateModalView>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(modal.DelegateModalView, {
      profiles: [],
      mode: 'TASK',
      onModeChange: noop,
      profileId: '',
      onProfileChange: noop,
      task: '',
      onTaskChange: noop,
      context: '',
      onContextChange: noop,
      onSubmit: noop,
      onClose: noop,
      // The switches as a freshly opened TASK form has them (P8-03): a sandbox,
      // and the pipeline run in it. Passed explicitly so these renders match
      // what the container hands the view.
      isolateWorktree: true,
      verifyPipeline: true,
      ...props
    })
  );
}

async function main(): Promise<void> {
  store = await import('../../../stores/useProjectStore');
  status = await import('../DelegationStatus');
  tree = await import('../ThreadTree');
  modal = await import('../DelegateModal');

  const {
    buildThreadTree,
    flattenThreadTree,
    parseDelegationContext,
    delegationStatusTone,
    threadStatusTone,
    latestOutcomeFor,
    isDelegationEvent,
    handleDelegationEvent,
    useProjectStore,
    DELEGATION_EVENT_TYPES
  } = store;

  // --- Pure helpers ---------------------------------------------------------

  describe('buildThreadTree');
  {
    const flat = buildThreadTree([thread('a'), thread('b')]);
    equal('a flat list is all roots', flat.length, 2);
    equal('at depth 0', flat.map(node => node.depth), [0, 0]);

    const nested = buildThreadTree([
      thread('root'),
      thread('child', { parent_thread_id: 'root', delegation_context_json: context() }),
      thread('grandchild', {
        parent_thread_id: 'child',
        delegation_context_json: context({ parentThreadId: 'child', depth: 2 })
      })
    ]);
    equal('a delegated thread is not a root', nested.length, 1);
    equal('it hangs from its parent', nested[0].children[0].thread.id, 'child');
    equal('at depth 1', nested[0].children[0].depth, 1);
    equal('and its own child at depth 2', nested[0].children[0].children[0].depth, 2);
    equal(
      'the brief is parsed onto the node',
      nested[0].children[0].context?.role,
      'Security Auditor'
    );
    equal('the parent carries no brief', nested[0].context, null);

    const orphan = buildThreadTree([
      thread('child', { parent_thread_id: 'a-thread-in-another-project' })
    ]);
    equal('a child whose parent is absent is shown as a root', orphan.length, 1);
    equal('rather than dropped', orphan[0].thread.id, 'child');

    const selfParent = buildThreadTree([thread('a', { parent_thread_id: 'a' })]);
    equal('a thread that names itself is a root', selfParent.length, 1);
    equal('and has no children', selfParent[0].children.length, 0);

    const cycle = buildThreadTree([
      thread('a', { parent_thread_id: 'b' }),
      thread('b', { parent_thread_id: 'a' })
    ]);
    check('a two-thread cycle still terminates', Array.isArray(cycle));
    check(
      'and every thread appears exactly once',
      flattenThreadTree(cycle).length === 2,
      `got ${flattenThreadTree(cycle).length}`
    );

    equal(
      'order follows the list the Core served',
      buildThreadTree([
        thread('root'),
        thread('second', { parent_thread_id: 'root' }),
        thread('first', { parent_thread_id: 'root' })
      ])[0].children.map(node => node.thread.id),
      ['second', 'first']
    );
  }

  describe('parseDelegationContext');
  {
    equal('null for an absent column', parseDelegationContext(null), null);
    equal('null for unparseable JSON', parseDelegationContext('{oops'), null);
    equal('null for a JSON scalar', parseDelegationContext('42'), null);
    equal('the brief when it is an object', parseDelegationContext(context())?.depth, 1);
  }

  describe('delegationStatusTone');
  {
    equal('COMPLETED reads as completed', delegationStatusTone('COMPLETED').tone, 'completed');
    equal('FAILED reads as failed', delegationStatusTone('FAILED').tone, 'failed');
    equal('TIMEOUT is a failure with its own words', delegationStatusTone('TIMEOUT').label, 'Timed out');
    equal('RUNNING reads as running', delegationStatusTone('RUNNING').tone, 'running');
    equal('an unrecorded status is idle', delegationStatusTone(undefined).tone, 'idle');
    check(
      'every tone comes from a token, never a hex value',
      ['COMPLETED', 'FAILED', 'TIMEOUT', 'RUNNING'].every(value =>
        delegationStatusTone(value as 'COMPLETED').color.startsWith('var(--')
      )
    );
  }

  describe('threadStatusTone');
  {
    const node = buildThreadTree([
      thread('root'),
      thread('child', { parent_thread_id: 'root', delegation_context_json: context() })
    ])[0].children[0];

    equal(
      'a child with no live state falls back to its stored status',
      threadStatusTone(node, { parentStates: {}, childStates: {} }).tone,
      'running'
    );
    equal(
      'a live ACTIVE state wins',
      threadStatusTone(node, { parentStates: {}, childStates: { child: 'ACTIVE' } }).label,
      'Working'
    );
    equal(
      'as does a live terminal one',
      threadStatusTone(node, { parentStates: {}, childStates: { child: 'FAILED' } }).tone,
      'failed'
    );

    const settled = buildThreadTree([
      thread('root'),
      thread('child', {
        parent_thread_id: 'root',
        delegation_context_json: context({ status: 'COMPLETED' })
      })
    ])[0].children[0];
    equal(
      'a settled child reads from the row',
      threadStatusTone(settled, { parentStates: {}, childStates: {} }).tone,
      'completed'
    );

    const root = buildThreadTree([thread('root')])[0];
    equal(
      'a parked parent is amber',
      threadStatusTone(root, {
        parentStates: { root: 'WAITING_FOR_CHILD' },
        childStates: {}
      }).tone,
      'waiting'
    );
    equal(
      'an ordinary thread says nothing',
      threadStatusTone(root, { parentStates: {}, childStates: {} }).tone,
      'idle'
    );
  }

  describe('latestOutcomeFor');
  {
    equal('nothing for no thread', latestOutcomeFor(null, {}, {}), null);
    equal('nothing when nothing has finished', latestOutcomeFor('root', {}, { root: [] }), null);

    const live = result();
    equal(
      'the live outcome wins',
      latestOutcomeFor('root', { root: live }, {})?.childThreadId,
      'child-1'
    );

    const children: DelegationChildSummary[] = [
      {
        threadId: 'child-old',
        projectId: PROJECT,
        name: 'old',
        parentThreadId: 'root',
        depth: 1,
        kind: 'TASK',
        taskDescription: 'first',
        status: 'COMPLETED',
        summary: 'the first one',
        requestedAt: 1,
        finishedAt: 10
      },
      {
        threadId: 'child-new',
        projectId: PROJECT,
        name: 'new',
        parentThreadId: 'root',
        depth: 1,
        kind: 'REVIEW',
        taskDescription: 'second',
        status: 'COMPLETED',
        summary: 'the second one',
        verdict: 'NEEDS_FIX',
        requestedAt: 2,
        finishedAt: 20
      },
      {
        threadId: 'child-running',
        projectId: PROJECT,
        name: 'running',
        parentThreadId: 'root',
        depth: 1,
        kind: 'TASK',
        taskDescription: 'third',
        status: 'RUNNING',
        requestedAt: 3
      }
    ];

    const fromList = latestOutcomeFor('root', {}, { root: children });
    equal('the newest settled child is used after a reload', fromList?.childThreadId, 'child-new');
    equal('carrying its verdict', fromList?.verdict, 'NEEDS_FIX');
    check('and a child still running is never the outcome', fromList?.childThreadId !== 'child-running');
  }

  describe('isDelegationEvent');
  {
    equal('all five event names are known', DELEGATION_EVENT_TYPES.length, 5);
    check('started is one of ours', isDelegationEvent({ type: 'delegation.started' }));
    check('parent_state is one of ours', isDelegationEvent({ type: 'delegation.parent_state' }));
    check('child_state is one of ours', isDelegationEvent({ type: 'delegation.child_state' }));
    check('completed is one of ours', isDelegationEvent({ type: 'delegation.completed' }));
    check('and so is a finished batch', isDelegationEvent({ type: 'delegation.batch_completed' }));
    check('a chat message is not', !isDelegationEvent({ type: 'chat.message' }));
    check('nor is nothing at all', !isDelegationEvent(null));
  }

  // --- Store: the four socket events ---------------------------------------

  describe('useProjectStore — delegation events');
  {
    useProjectStore.getState().resetDelegation();
    useProjectStore.getState().setThreads([thread('root')]);

    check(
      'delegation.started is routed',
      handleDelegationEvent('delegation.started', {
        projectId: PROJECT,
        threadId: 'root',
        childThreadId: 'child-1',
        depth: 1,
        kind: 'TASK',
        role: 'Security Auditor',
        taskDescription: 'Harden the upload route.'
      })
    );

    let state = useProjectStore.getState();
    equal('the child joins the thread list', state.threads.length, 2);
    equal('hanging from its parent', state.threads[1].parent_thread_id, 'root');
    equal('with its brief attached', parseDelegationContext(state.threads[1].delegation_context_json)?.depth, 1);
    equal('the child starts as STARTING', state.childStates['child-1'], 'STARTING');
    equal('its task is remembered', state.childTasks['child-1'], 'Harden the upload route.');
    equal('and its role', state.childRoles['child-1'], 'Security Auditor');
    equal(
      'the tree now nests it',
      buildThreadTree(state.threads)[0].children[0].thread.id,
      'child-1'
    );

    handleDelegationEvent('delegation.parent_state', {
      projectId: PROJECT,
      threadId: 'root',
      state: 'WAITING_FOR_CHILD',
      childThreadId: 'child-1'
    });
    state = useProjectStore.getState();
    equal('the parent is parked', state.parentStates['root'], 'WAITING_FOR_CHILD');
    equal('behind the named child', state.pendingChildren['root'], ['child-1']);

    handleDelegationEvent('delegation.child_state', {
      projectId: PROJECT,
      threadId: 'child-1',
      parentThreadId: 'root',
      state: 'ACTIVE'
    });
    equal(
      'the child goes active',
      useProjectStore.getState().childStates['child-1'],
      'ACTIVE'
    );

    handleDelegationEvent('delegation.completed', {
      projectId: PROJECT,
      threadId: 'root',
      result: result({ artifacts: ['apps/server/src/routes/upload.ts'] })
    });
    state = useProjectStore.getState();
    equal('the parent is released', state.parentStates['root'], 'ACTIVE');
    equal('and is no longer waiting on anything', state.pendingChildren['root'], undefined);
    equal('the child ends COMPLETED', state.childStates['child-1'], 'COMPLETED');
    equal('the outcome is kept for the parent', state.delegationOutcomes['root']?.summary, 'Added a path check to the upload route.');
    equal(
      'and written back onto the stored brief',
      parseDelegationContext(state.threads[1].delegation_context_json)?.status,
      'COMPLETED'
    );

    check('an unrelated event is not claimed', !handleDelegationEvent('chat.message', {}));

    useProjectStore.getState().resetDelegation();
    equal(
      'resetDelegation clears every map',
      Object.keys(useProjectStore.getState().parentStates).length +
        Object.keys(useProjectStore.getState().childStates).length +
        Object.keys(useProjectStore.getState().delegationOutcomes).length,
      0
    );
    equal(
      'without touching the thread list',
      useProjectStore.getState().threads.length,
      2
    );
  }

  describe('useProjectStore — upsertThread');
  {
    useProjectStore.getState().setThreads([thread('root')]);
    useProjectStore.getState().upsertThread(thread('root', { name: 'renamed' }));
    equal('a known thread is merged, not duplicated', useProjectStore.getState().threads.length, 1);
    equal('with the newer fields', useProjectStore.getState().threads[0].name, 'renamed');
    useProjectStore.getState().upsertThread(thread('other'));
    equal('an unknown one is appended', useProjectStore.getState().threads.length, 2);
  }

  describe('useProjectStore — syncDelegations');
  {
    useProjectStore.getState().resetDelegation();
    requests.length = 0;
    respond({
      threadId: 'root',
      depth: 0,
      parentState: 'WAITING_FOR_CHILD',
      pendingChildThreadId: 'child-9',
      children: [
        {
          threadId: 'child-9',
          projectId: PROJECT,
          name: 'Security Auditor',
          parentThreadId: 'root',
          depth: 1,
          role: 'Security Auditor',
          kind: 'REVIEW',
          taskDescription: 'Review the diff.',
          status: 'RUNNING',
          requestedAt: 1
        }
      ]
    });

    await useProjectStore.getState().syncDelegations('root');

    equal('it reads the children endpoint', requests[0]?.url.endsWith('/api/v1/threads/root/children'), true);
    equal('with GET', requests[0]?.method, 'GET');
    equal('carrying the token', requests[0]?.headers['Authorization'], 'Bearer test-token');

    const synced = useProjectStore.getState();
    equal('the parent state comes from the Core', synced.parentStates['root'], 'WAITING_FOR_CHILD');
    equal('as does the pending child', synced.pendingChildren['root'], ['child-9']);
    equal('a RUNNING child is shown as ACTIVE', synced.childStates['child-9'], 'ACTIVE');
    equal('its brief is picked up', synced.childTasks['child-9'], 'Review the diff.');
    equal('and its role', synced.childRoles['child-9'], 'Security Auditor');
    equal('the children list is kept', synced.delegationChildren['root']?.length, 1);

    requests.length = 0;
    respond({ threadId: 'root', depth: 0, parentState: 'ACTIVE', children: [] });
    await useProjectStore.getState().syncDelegations('root');
    equal('a released parent stops waiting', useProjectStore.getState().parentStates['root'], 'ACTIVE');
    equal('and drops its pending child', useProjectStore.getState().pendingChildren['root'], undefined);

    requests.length = 0;
    respond({ error: 'Unauthorized' }, 401);
    await useProjectStore.getState().syncDelegations('root');
    equal(
      'a refused read changes nothing',
      useProjectStore.getState().parentStates['root'],
      'ACTIVE'
    );

    requests.length = 0;
    await useProjectStore.getState().syncDelegations('');
    equal('and no thread means no request', requests.length, 0);
  }

  describe('useProjectStore — cancelDelegation');
  {
    useProjectStore.getState().resetDelegation();
    useProjectStore.getState().setActiveProject(PROJECT);
    useProjectStore.getState().setThreads([thread('root')]);

    // A parent parked behind a child, exactly as the socket would have left it.
    handleDelegationEvent('delegation.started', {
      projectId: PROJECT,
      threadId: 'root',
      childThreadId: 'child-1',
      depth: 1,
      kind: 'TASK',
      role: 'Security Auditor',
      taskDescription: 'Harden the upload route.'
    });
    handleDelegationEvent('delegation.parent_state', {
      projectId: PROJECT,
      threadId: 'root',
      state: 'WAITING_FOR_CHILD',
      childThreadId: 'child-1'
    });

    requests.length = 0;
    respond({
      success: true,
      result: result({ status: 'FAILED', summary: 'Delegation cancelled by operator' })
    });
    const accepted = await useProjectStore
      .getState()
      .cancelDelegation('root', 'Stopped from the banner.');

    equal('it posts to the cancel endpoint', requests[0]?.url.endsWith('/api/v1/threads/root/delegate/cancel'), true);
    equal('with POST', requests[0]?.method, 'POST');
    equal('carrying the reason', (requests[0]?.body as { reason?: string })?.reason, 'Stopped from the banner.');
    equal('and the token', requests[0]?.headers['Authorization'], 'Bearer test-token');
    equal('the Core accepted it', accepted, true);

    const after = useProjectStore.getState();
    equal('the parent is released without waiting for the socket', after.parentStates['root'], 'ACTIVE');
    equal('the banner has nothing left to show', after.pendingChildren['root'], undefined);
    equal('the child ends FAILED', after.childStates['child-1'], 'FAILED');
    equal(
      'and the outcome card gets the cancellation',
      after.delegationOutcomes['root']?.summary,
      'Delegation cancelled by operator'
    );
    equal(
      'and it is written back onto the stored brief',
      parseDelegationContext(after.threads[1]?.delegation_context_json)?.status,
      'FAILED'
    );
    equal('nothing is left marked as cancelling', Object.keys(after.cancellingChildren).length, 0);

    // A refusal — the Core says this thread is not delegating.
    requests.length = 0;
    respond({ error: 'Thread root is not waiting on a delegated agent.', code: 'NOT_DELEGATING' }, 409);
    const refused = await useProjectStore.getState().cancelDelegation('root');
    equal('a refusal is reported back to the caller', refused, false);
    equal('no reason is sent when none was given', (requests[0]?.body as { reason?: string })?.reason, undefined);
    equal(
      'and the spinner is cleared anyway',
      Object.keys(useProjectStore.getState().cancellingChildren).length,
      0
    );

    // Cancelling from the tree names the child, not the parent.
    requests.length = 0;
    respond({ success: true, result: result({ childThreadId: 'child-9', status: 'FAILED' }) });
    const byChild = await useProjectStore.getState().cancelDelegation('child-9', 'Stopped from the thread list.');
    equal('it addresses that child', requests[0]?.url.endsWith('/api/v1/threads/child-9/delegate/cancel'), true);
    equal('the Core accepted it', byChild, true);
    equal('and the row goes terminal', useProjectStore.getState().childStates['child-9'], 'FAILED');
    equal(
      'without inventing a parent to release',
      useProjectStore.getState().parentStates['child-9'],
      undefined
    );

    requests.length = 0;
    equal('no thread means no request', await useProjectStore.getState().cancelDelegation(''), false);
    equal('and nothing is sent', requests.length, 0);
  }

  // --- Store: a fan-out (P7-04) ---------------------------------------------

  describe('useProjectStore — several children at once');
  {
    useProjectStore.getState().resetDelegation();
    useProjectStore.getState().setThreads([thread('root')]);

    for (const [childThreadId, role] of [
      ['child-a', 'Senior Backend Engineer'],
      ['child-b', 'Frontend Reviewer'],
      ['child-c', 'QA Engineer']
    ]) {
      handleDelegationEvent('delegation.started', {
        projectId: PROJECT,
        threadId: 'root',
        childThreadId,
        depth: 1,
        kind: 'TASK',
        role,
        taskDescription: `Work for ${role}.`
      });
      handleDelegationEvent('delegation.parent_state', {
        projectId: PROJECT,
        threadId: 'root',
        state: 'WAITING_FOR_CHILD',
        childThreadId
      });
    }

    let state = useProjectStore.getState();
    equal('the parent is parked behind all three', state.pendingChildren['root'], [
      'child-a',
      'child-b',
      'child-c'
    ]);
    equal('each of them is on the thread list', state.threads.length, 4);
    equal('as siblings under the same parent', buildThreadTree(state.threads)[0].children.length, 3);
    equal('every role is remembered', state.childRoles['child-b'], 'Frontend Reviewer');

    // The same child announced twice — a socket reconnect replaying — must not
    // make the banner show it twice.
    handleDelegationEvent('delegation.parent_state', {
      projectId: PROJECT,
      threadId: 'root',
      state: 'WAITING_FOR_CHILD',
      childThreadId: 'child-a'
    });
    equal(
      'a repeated announcement does not duplicate a child',
      useProjectStore.getState().pendingChildren['root']?.length,
      3
    );

    handleDelegationEvent('delegation.completed', {
      projectId: PROJECT,
      threadId: 'root',
      result: result({ childThreadId: 'child-a', summary: 'Backend done.' })
    });
    state = useProjectStore.getState();
    equal('one child finishing leaves the others pending', state.pendingChildren['root'], [
      'child-b',
      'child-c'
    ]);
    equal('and the parent stays parked', state.parentStates['root'], 'WAITING_FOR_CHILD');
    equal('while that child goes terminal', state.childStates['child-a'], 'COMPLETED');

    handleDelegationEvent('delegation.completed', {
      projectId: PROJECT,
      threadId: 'root',
      result: result({ childThreadId: 'child-b', status: 'FAILED', summary: 'Frontend crashed.' })
    });
    handleDelegationEvent('delegation.completed', {
      projectId: PROJECT,
      threadId: 'root',
      result: result({ childThreadId: 'child-c', summary: 'QA done.' })
    });
    state = useProjectStore.getState();
    equal('the last one releases the parent', state.parentStates['root'], 'ACTIVE');
    equal('with nothing pending', state.pendingChildren['root'], undefined);

    const batchResult = batch({
      results: [
        result({ childThreadId: 'child-a', summary: 'Backend done.' }),
        result({ childThreadId: 'child-b', status: 'FAILED', summary: 'Frontend crashed.' }),
        result({ childThreadId: 'child-c', summary: 'QA done.' })
      ]
    });
    check(
      'a finished batch is routed',
      handleDelegationEvent('delegation.batch_completed', {
        projectId: PROJECT,
        threadId: 'root',
        batch: batchResult
      })
    );
    state = useProjectStore.getState();
    equal('and kept for the parent', state.batchOutcomes['root']?.results.length, 3);
    equal('with its overall status', state.batchOutcomes['root']?.overallStatus, 'PARTIAL_SUCCESS');
    equal(
      'the single-outcome card is cleared so the last child is not shown twice',
      state.delegationOutcomes['root'],
      undefined
    );
    equal('and the parent is active', state.parentStates['root'], 'ACTIVE');

    useProjectStore.getState().resetDelegation();
    equal(
      'resetDelegation clears the batch too',
      Object.keys(useProjectStore.getState().batchOutcomes).length,
      0
    );
  }

  describe('useProjectStore — delegateParallel');
  {
    useProjectStore.getState().resetDelegation();
    useProjectStore.getState().setActiveProject(PROJECT);
    requests.length = 0;

    const dispatched = batch({ overallStatus: 'COMPLETED' });
    respond({ batch: dispatched });
    const returned = await useProjectStore.getState().delegateParallel('root', [
      { targetRole: 'Senior Backend Engineer', taskDescription: 'Add the endpoint.' },
      { targetRole: 'QA Engineer', taskDescription: 'Test it.' }
    ]);

    equal(
      'it posts to the parallel endpoint',
      requests[0]?.url.endsWith('/api/v1/threads/root/delegate/parallel'),
      true
    );
    equal('with POST', requests[0]?.method, 'POST');
    equal('carrying the token', requests[0]?.headers['Authorization'], 'Bearer test-token');
    equal(
      'and both pieces of work',
      (requests[0]?.body as { delegations?: unknown[] })?.delegations?.length,
      2
    );
    equal('the batch comes back to the caller', returned?.overallStatus, 'COMPLETED');
    equal(
      'and is applied without waiting for the socket',
      useProjectStore.getState().batchOutcomes['root']?.overallStatus,
      'COMPLETED'
    );

    requests.length = 0;
    respond({ error: 'Too many', code: 'CONCURRENCY_LIMIT_EXCEEDED' }, 409);
    equal(
      'a refusal comes back as nothing',
      await useProjectStore.getState().delegateParallel('root', [
        { targetRole: 'QA Engineer', taskDescription: 'x' }
      ]),
      null
    );

    requests.length = 0;
    equal('an empty batch is not sent at all', await useProjectStore.getState().delegateParallel('root', []), null);
    equal('nor is one with no thread', await useProjectStore.getState().delegateParallel('', [
      { targetRole: 'QA Engineer', taskDescription: 'x' }
    ]), null);
    equal('and nothing was requested', requests.length, 0);
  }

  describe('useProjectStore — cancelAllDelegations');
  {
    useProjectStore.getState().resetDelegation();
    useProjectStore.getState().setActiveProject(PROJECT);
    useProjectStore.getState().setThreads([thread('root')]);

    for (const childThreadId of ['child-a', 'child-b']) {
      handleDelegationEvent('delegation.started', {
        projectId: PROJECT,
        threadId: 'root',
        childThreadId,
        depth: 1,
        kind: 'TASK',
        role: 'QA Engineer',
        taskDescription: 'Work.'
      });
      handleDelegationEvent('delegation.parent_state', {
        projectId: PROJECT,
        threadId: 'root',
        state: 'WAITING_FOR_CHILD',
        childThreadId
      });
    }

    requests.length = 0;
    respond({
      success: true,
      cancelled: 2,
      results: [
        result({ childThreadId: 'child-a', status: 'FAILED', summary: 'Stopped.' }),
        result({ childThreadId: 'child-b', status: 'FAILED', summary: 'Stopped.' })
      ]
    });
    const accepted = await useProjectStore
      .getState()
      .cancelAllDelegations('root', 'Stopped the fan-out.');

    equal(
      'it posts to the cancel-all endpoint',
      requests[0]?.url.endsWith('/api/v1/threads/root/delegate/cancel-all'),
      true
    );
    equal('with POST', requests[0]?.method, 'POST');
    equal('carrying the reason', (requests[0]?.body as { reason?: string })?.reason, 'Stopped the fan-out.');
    equal('the Core accepted it', accepted, true);

    const after = useProjectStore.getState();
    equal('every child ends failed', [after.childStates['child-a'], after.childStates['child-b']], [
      'FAILED',
      'FAILED'
    ]);
    equal('the parent is released', after.parentStates['root'], 'ACTIVE');
    equal('with nothing left pending', after.pendingChildren['root'], undefined);
    equal('and nothing marked as cancelling', Object.keys(after.cancellingChildren).length, 0);

    requests.length = 0;
    respond({ error: 'nope' }, 500);
    equal('a refusal is reported back', await useProjectStore.getState().cancelAllDelegations('root'), false);
    equal(
      'and the spinners are cleared anyway',
      Object.keys(useProjectStore.getState().cancellingChildren).length,
      0
    );
    equal('no thread means no request', await useProjectStore.getState().cancelAllDelegations(''), false);
  }

  describe('useProjectStore — syncDelegations reads the whole pending list');
  {
    useProjectStore.getState().resetDelegation();
    requests.length = 0;
    respond({
      threadId: 'root',
      depth: 0,
      parentState: 'WAITING_FOR_CHILD',
      pendingChildThreadId: 'child-a',
      pendingChildThreadIds: ['child-a', 'child-b'],
      children: []
    });
    await useProjectStore.getState().syncDelegations('root');
    equal(
      'a fan-out is picked up whole after a reload',
      useProjectStore.getState().pendingChildren['root'],
      ['child-a', 'child-b']
    );

    respond({
      threadId: 'root',
      depth: 0,
      parentState: 'WAITING_FOR_CHILD',
      pendingChildThreadId: 'child-a',
      children: []
    });
    await useProjectStore.getState().syncDelegations('root');
    equal(
      'and a Core that only sends the single id is still understood',
      useProjectStore.getState().pendingChildren['root'],
      ['child-a']
    );
  }

  describe('batchStatusTone');
  {
    equal('a batch that all worked reads as completed', store.batchStatusTone('COMPLETED').tone, 'completed');
    equal('a partial one is something to look at', store.batchStatusTone('PARTIAL_SUCCESS').tone, 'waiting');
    equal('and is labelled as such', store.batchStatusTone('PARTIAL_SUCCESS').label, 'Partial success');
    equal('a failed one is a failure', store.batchStatusTone('FAILED').tone, 'failed');
    equal('and a timed-out one too', store.batchStatusTone('TIMEOUT').tone, 'failed');
  }

  // --- Views ----------------------------------------------------------------

  describe('ThreadTreeView');
  {
    const nodes = buildThreadTree([
      thread('root', { name: 'Payments refactor' }),
      thread('child-1', {
        name: 'Security review',
        parent_thread_id: 'root',
        delegation_context_json: context({ role: 'Security Auditor' })
      }),
      thread('child-2', {
        name: 'Deep child',
        parent_thread_id: 'child-1',
        delegation_context_json: context({ parentThreadId: 'child-1', depth: 2, role: 'QA Engineer' })
      })
    ]);

    const html = renderTree({
      nodes,
      activeThreadId: 'child-1',
      parentStates: { root: 'WAITING_FOR_CHILD' },
      childStates: { 'child-1': 'ACTIVE' }
    });

    check('the parent is rendered', html.includes('Payments refactor'));
    check('and its child', html.includes('Security review'));
    check('and the grandchild', html.includes('Deep child'));
    check('the role badge is shown', html.includes('Security Auditor'));
    check('depth reads as a level pill', html.includes('L1'));
    check('two levels down as L2', html.includes('L2'));
    check('a running child pulses', html.includes('delegation-pulse'));
    check('a parked parent is labelled', html.includes('Waiting on child'));
    check('a working child is labelled', html.includes('Working'));
    check('nesting is by indentation', html.includes('margin-left:14px'));
    check('the deeper level indents further', html.includes('margin-left:28px'));
    check('rows are reachable by keyboard', html.includes('tabindex="0"'));
    check('a row with children can be collapsed', html.includes('aria-expanded="true"'));
    check('no colour is hardcoded', !/#[0-9a-fA-F]{6}/.test(html));

    const collapsed = renderTree({ nodes, activeThreadId: null, collapsed: { root: true } });
    check('a collapsed parent still shows', collapsed.includes('Payments refactor'));
    check('but hides its children', !collapsed.includes('Security review'));
    check('and says it is collapsed', collapsed.includes('aria-expanded="false"'));

    const settled = renderTree({
      nodes: buildThreadTree([
        thread('root'),
        thread('child', {
          parent_thread_id: 'root',
          delegation_context_json: context({ status: 'TIMEOUT' })
        })
      ]),
      activeThreadId: null
    });
    check('a timed-out child says so', settled.includes('Timed out'));
    check('and does not pulse', !settled.includes('delegation-pulse'));
  }

  describe('ThreadTreeView — stopping a child from the list (P7-03)');
  {
    const nodes = buildThreadTree([
      thread('root', { name: 'Payments refactor' }),
      thread('running', {
        name: 'Security review',
        parent_thread_id: 'root',
        delegation_context_json: context()
      }),
      thread('done', {
        name: 'Finished child',
        parent_thread_id: 'root',
        delegation_context_json: context({ status: 'COMPLETED' })
      })
    ]);

    equal(
      'a child with a live ACTIVE state can be stopped',
      tree.isCancellableChild(nodes[0].children[0], { running: 'ACTIVE' }),
      true
    );
    equal(
      'so can one nothing has said anything about yet',
      tree.isCancellableChild(nodes[0].children[0], {}),
      true
    );
    equal(
      'one that already finished cannot',
      tree.isCancellableChild(nodes[0].children[1], {}),
      false
    );
    equal(
      'and neither can it once the socket says so',
      tree.isCancellableChild(nodes[0].children[0], { running: 'FAILED' }),
      false
    );
    equal(
      'a root thread is not a delegated child at all',
      tree.isCancellableChild(nodes[0], { root: 'ACTIVE' }),
      false
    );

    const html = renderTree({ nodes, onCancelChild: noop, childStates: { running: 'ACTIVE' } });
    check('the running child gets a stop control', html.includes('aria-label="Stop Security review"'));
    check('named for what it does', html.includes('>Stop</button>'));
    check('with a tooltip', html.includes('Stop this delegated agent'));
    check('the finished one does not', !html.includes('aria-label="Stop Finished child"'));
    check('nor does the parent', !html.includes('aria-label="Stop Payments refactor"'));
    check('and no colour is hardcoded', !/#[0-9a-fA-F]{6}/.test(html));

    const busy = renderTree({
      nodes,
      onCancelChild: noop,
      childStates: { running: 'ACTIVE' },
      cancellingThreads: { running: true }
    });
    check('a stop already in flight is disabled', busy.includes('disabled=""'));
    check('and says nothing more', !busy.includes('>Stop</button>'));

    const readOnly = renderTree({ nodes, childStates: { running: 'ACTIVE' } });
    check('a tree with no cancel handler offers no stop', !readOnly.includes('aria-label="Stop Security review"'));
  }

  describe('DelegationWaitingBanner');
  {
    const html = renderStatus({
      parentState: 'WAITING_FOR_CHILD',
      pendingChildren: [
        {
          childThreadId: 'child-1',
          role: 'Security Auditor',
          state: 'ACTIVE',
          taskDescription: 'Review the upload route for path traversal.'
        }
      ]
    });

    check('the banner names the role', html.includes('Security Auditor'));
    check('says the thread is waiting', html.includes('waiting on'));
    check('shows what the child is doing', html.includes('Working'));
    check('with the task snippet', html.includes('Review the upload route for path traversal.'));
    check('and offers a way into the child', html.includes('Inspect Child Thread'));
    check('announced as a status', html.includes('role="status"'));

    const noChild = renderStatus({ parentState: 'WAITING_FOR_CHILD' });
    equal('a waiting state with no child renders nothing', noChild, '');

    equal('a long task is cut', status.summarySnippet('x'.repeat(400)).length, 180);
    equal('a short one is left alone', status.summarySnippet('short'), 'short');
    equal('newlines are collapsed', status.summarySnippet('a\n\nb'), 'a b');
    equal('nothing stays nothing', status.summarySnippet(undefined), '');
    equal('an unknown child state reads as working', status.childStateLabel(undefined), 'Working');
    equal('STARTING has its own words', status.childStateLabel('STARTING'), 'Starting up');
  }

  describe('DelegationWaitingBanner — cancelling (P7-03)');
  {
    const waiting = {
      parentState: 'WAITING_FOR_CHILD' as const,
      pendingChildren: [
        {
          childThreadId: 'child-1',
          role: 'Security Auditor',
          state: 'ACTIVE' as const,
          taskDescription: 'Review the upload route.'
        }
      ]
    };

    const withCancel = renderStatus({ ...waiting, onCancel: noop });
    check('the banner offers a way out', withCancel.includes('Cancel Delegation'));
    check('labelled for a screen reader', withCancel.includes('aria-label="Cancel delegation"'));
    check('and it says what it will do', withCancel.includes('Stop the delegated agent'));
    check('alongside the way in', withCancel.includes('Inspect Child Thread'));
    check('with no hardcoded colour', !/#[0-9a-fA-F]{6}/.test(withCancel));

    const noCancel = renderStatus(waiting);
    check('a banner given nothing to cancel with does not offer it', !noCancel.includes('Cancel Delegation'));
    check('but still shows the child', noCancel.includes('Inspect Child Thread'));

    const cancelling = renderStatus({
      ...waiting,
      onCancel: noop,
      cancellingChildren: { 'child-1': true }
    });
    check('a cancellation in flight is visible', cancelling.includes('Cancelling…'));
    check('and the button is spent', cancelling.includes('disabled=""'));
    check('the way into the child stays open', cancelling.includes('Inspect Child Thread'));

    const refused = renderStatus({
      ...waiting,
      onCancel: noop,
      cancelError: 'The workstation would not stop this delegation.'
    });
    check('a refusal is shown on the banner', refused.includes('would not stop this delegation'));
    check('as an alert', refused.includes('role="alert"'));
    check('and the button comes back', refused.includes('Cancel Delegation'));

    // The click itself. `DelegationWaitingBanner` holds no state, so calling it
    // returns the element tree its button lives in.
    let cancelled: string | null = null;
    const tree = (status.DelegationWaitingBanner as unknown as (props: unknown) => unknown)({
      children: [{ childThreadId: 'child-1', role: 'Security Auditor' }],
      onInspectChild: noop,
      onCancel: (childThreadId: string) => {
        cancelled = childThreadId;
      }
    });
    const button = findElement(tree, props => props['aria-label'] === 'Cancel delegation');
    check('the cancel button is in the tree', !!button);
    (button?.props?.onClick as () => void)();
    equal('clicking it names the child to stop', cancelled, 'child-1');
    equal('and it is enabled by default', button?.props?.disabled, false);
  }

  describe('DelegationOutcomeCard');
  {
    const completed = renderStatus({
      outcome: result({ artifacts: ['apps/server/src/routes/upload.ts', 'docs/notes.md'] })
    });
    check('the status badge is shown', completed.includes('COMPLETED'));
    check('the role is named', completed.includes('Security Auditor'));
    check('the summary is readable', completed.includes('Added a path check to the upload route.'));
    check('artifacts are listed', completed.includes('apps/server/src/routes/upload.ts'));
    check('all of them', completed.includes('docs/notes.md'));
    check('the transcript can be opened', completed.includes('Open Transcript'));
    check('the card is labelled', completed.includes('aria-label="Delegation outcome"'));

    const review = renderStatus({ outcome: result({ verdict: 'PASS' }) });
    check('a passing review shows its verdict', review.includes('>PASS<'));

    const needsFix = renderStatus({
      outcome: result({ status: 'FAILED', verdict: 'NEEDS_FIX', summary: 'Traversal is still reachable.' })
    });
    check('a failing one too', needsFix.includes('>NEEDS_FIX<'));
    check('alongside the failure', needsFix.includes('>FAILED<'));
    check('with the finding', needsFix.includes('Traversal is still reachable.'));

    const timeout = renderStatus({ outcome: result({ status: 'TIMEOUT', summary: '' }) });
    check('a timeout is its own status', timeout.includes('>TIMEOUT<'));
    check('and an empty summary is stated', timeout.includes('returned no summary'));

    const quiet = renderStatus({});
    equal('an ordinary thread shows nothing', quiet, '');

    const both = renderStatus({
      parentState: 'WAITING_FOR_CHILD',
      pendingChildren: [{ childThreadId: 'child-2' }],
      outcome: result()
    });
    check('a new delegation takes precedence over the last outcome', both.includes('Inspect Child Thread'));
    check('and the old card is not also shown', !both.includes('Open Transcript'));
  }

  // --- Views: a fan-out (P7-04) ---------------------------------------------

  describe('DelegationWaitingBanner — several children at once');
  {
    const waitingOnThree = {
      parentState: 'WAITING_FOR_CHILD' as const,
      pendingChildren: [
        {
          childThreadId: 'child-a',
          role: 'Senior Backend Engineer',
          state: 'ACTIVE' as const,
          taskDescription: 'Add the endpoint.'
        },
        {
          childThreadId: 'child-b',
          role: 'Frontend Reviewer',
          state: 'STARTING' as const,
          taskDescription: 'Wire the form.'
        },
        {
          childThreadId: 'child-c',
          role: 'QA Engineer',
          state: 'COMPLETED' as const,
          taskDescription: 'Test it.'
        }
      ]
    };

    const html = renderStatus({ ...waitingOnThree, onCancel: noop, onCancelAll: noop });
    check('the banner counts the subagents', html.includes('waiting on 3 subagents'));
    check('and says how far along they are', html.includes('1 of 3 finished'));
    check('every role is named', html.includes('Senior Backend Engineer'));
    check('including the one still booting', html.includes('Frontend Reviewer'));
    check('and the one already done', html.includes('QA Engineer'));
    check('each with its own state', html.includes('Starting up') && html.includes('Working') && html.includes('Finished'));
    check('each with a way into its transcript', html.includes('aria-label="Inspect Senior Backend Engineer"'));
    check('and its own stop control', html.includes('aria-label="Stop Frontend Reviewer"'));
    check('the whole fan-out can be stopped at once', html.includes('aria-label="Cancel all delegations"'));
    check('labelled for what it does', html.includes('>Cancel All</button>'));
    check('announced as a status', html.includes('role="status"'));
    check('with no hardcoded colour', !/#[0-9a-fA-F]{6}/.test(html));

    const noBatchControls = renderStatus(waitingOnThree);
    check('a banner with no cancel handler offers no stop', !noBatchControls.includes('aria-label="Stop QA Engineer"'));
    check('nor a cancel-all', !noBatchControls.includes('Cancel All'));
    check('but still shows every child', noBatchControls.includes('Frontend Reviewer'));

    const oneChild = renderStatus({
      parentState: 'WAITING_FOR_CHILD',
      pendingChildren: [{ childThreadId: 'child-a', role: 'QA Engineer', state: 'ACTIVE' }],
      onCancel: noop,
      onCancelAll: noop
    });
    check('a single delegation reads as a sentence, as it always has', oneChild.includes('Delegated — waiting on QA Engineer'));
    check('with the one button it had', oneChild.includes('Cancel Delegation'));
    check('and no batch control it would not need', !oneChild.includes('Cancel All'));

    const stopping = renderStatus({
      ...waitingOnThree,
      onCancel: noop,
      onCancelAll: noop,
      cancellingChildren: { 'child-b': true }
    });
    check('a stop in flight on one child is visible', stopping.includes('disabled=""'));
    check('while its siblings can still be stopped', stopping.includes('aria-label="Stop QA Engineer"'));

    const stoppingAll = renderStatus({
      ...waitingOnThree,
      onCancel: noop,
      onCancelAll: noop,
      cancellingChildren: { 'child-a': true, 'child-b': true, 'child-c': true }
    });
    check('stopping all of them spends the batch button', stoppingAll.includes('Cancelling…'));

    const refused = renderStatus({
      ...waitingOnThree,
      onCancel: noop,
      onCancelAll: noop,
      cancelError: 'The workstation would not stop these delegations.'
    });
    check('a refusal is shown on the banner', refused.includes('would not stop these delegations'));
    check('as an alert', refused.includes('role="alert"'));

    // The clicks themselves, through the props-only component.
    let stopped: string | null = null;
    let inspected: string | null = null;
    let cancelledAll = 0;
    const rendered = (status.DelegationWaitingBanner as unknown as (props: unknown) => unknown)({
      children: waitingOnThree.pendingChildren,
      onInspectChild: (childThreadId: string) => {
        inspected = childThreadId;
      },
      onCancel: (childThreadId: string) => {
        stopped = childThreadId;
      },
      onCancelAll: () => {
        cancelledAll++;
      }
    });

    const stopButton = findElement(rendered, props => props['aria-label'] === 'Stop Frontend Reviewer');
    check('the per-child stop is in the tree', !!stopButton);
    (stopButton?.props?.onClick as () => void)();
    equal('and it names that child, not the parent', stopped, 'child-b');

    const inspectButton = findElement(rendered, props => props['aria-label'] === 'Inspect QA Engineer');
    (inspectButton?.props?.onClick as () => void)();
    equal('inspecting opens that child’s thread', inspected, 'child-c');

    const cancelAllButton = findElement(rendered, props => props['aria-label'] === 'Cancel all delegations');
    (cancelAllButton?.props?.onClick as () => void)();
    equal('and Cancel All takes no child at all', cancelledAll, 1);

    equal('an empty pending list renders nothing', renderStatus({ parentState: 'WAITING_FOR_CHILD', pendingChildren: [] }), '');
    equal('a child with no role is still counted', status.pendingProgress([
      { childThreadId: 'x', state: 'ACTIVE' },
      { childThreadId: 'y', state: 'TIMEOUT' }
    ]), '1 of 2 finished');
  }

  describe('DelegationBatchOutcomeCard');
  {
    const mixed = renderStatus({
      batchOutcome: batch({
        results: [
          result({
            childThreadId: 'child-a',
            role: 'Senior Backend Engineer',
            summary: 'Added the endpoint.',
            artifacts: ['apps/server/src/routes/upload.ts']
          }),
          result({
            childThreadId: 'child-b',
            role: 'Security Auditor',
            status: 'COMPLETED',
            verdict: 'NEEDS_FIX',
            summary: 'Traversal is still reachable.'
          }),
          result({
            childThreadId: 'child-c',
            role: 'QA Engineer',
            status: 'TIMEOUT',
            summary: 'The delegated session did not finish within 600s.'
          })
        ]
      })
    });

    check('the card is labelled', mixed.includes('aria-label="Parallel delegation outcome"'));
    check('it says how many agents ran', mixed.includes('3 agents — parallel delegation'));
    check('with the overall status', mixed.includes('>PARTIAL_SUCCESS<'));
    check('and the verdict over every review in it', mixed.includes('>NEEDS_FIX<'));
    check('the batch summary is readable', mixed.includes('delegated agents completed'));
    check('every child is broken out', mixed.includes('Senior Backend Engineer') && mixed.includes('Security Auditor') && mixed.includes('QA Engineer'));
    check('with its own status', mixed.includes('>TIMEOUT<'));
    check('its own answer', mixed.includes('Added the endpoint.'));
    check('the finding of the one that failed its review', mixed.includes('Traversal is still reachable.'));
    check('its artifacts', mixed.includes('apps/server/src/routes/upload.ts'));
    check('and a way into each transcript', mixed.includes('aria-label="Open transcript for QA Engineer"'));
    check('no colour is hardcoded', !/#[0-9a-fA-F]{6}/.test(mixed));

    const clean = renderStatus({
      batchOutcome: batch({
        results: [result({ childThreadId: 'child-a' }), result({ childThreadId: 'child-b' })],
        overallStatus: 'COMPLETED',
        aggregatedVerdict: 'PASS',
        summary: 'All 2 delegated agents completed.'
      })
    });
    check('a batch that all worked says so', clean.includes('>COMPLETED<'));
    check('with the passing verdict', clean.includes('>PASS<'));

    const unstarted = renderStatus({
      batchOutcome: batch({
        results: [
          result({ childThreadId: '', role: 'QA Engineer', status: 'FAILED', summary: 'Could not be created.' })
        ]
      })
    });
    check('a child that never got a thread is still reported', unstarted.includes('Could not be created.'));
    check('but offers no transcript to open', !unstarted.includes('Open Transcript'));

    const overSingle = renderStatus({ batchOutcome: batch(), outcome: result() });
    check('a batch takes precedence over a single outcome', overSingle.includes('Parallel delegation outcome'));
    check('and the single card is not also shown', !overSingle.includes('aria-label="Delegation outcome"'));

    const waitingWins = renderStatus({
      parentState: 'WAITING_FOR_CHILD',
      pendingChildren: [{ childThreadId: 'child-x', role: 'QA Engineer' }],
      batchOutcome: batch()
    });
    check('a new fan-out takes precedence over the last one', waitingWins.includes('Inspect Child Thread'));
    check('and the old card is not also shown', !waitingWins.includes('Parallel delegation outcome'));
  }

  describe('ThreadTreeView — siblings under one parent (P7-04)');
  {
    const nodes = buildThreadTree([
      thread('root', { name: 'Payments refactor' }),
      thread('sib-a', {
        name: 'Backend work',
        parent_thread_id: 'root',
        delegation_context_json: context({ role: 'Senior Backend Engineer' })
      }),
      thread('sib-b', {
        name: 'Frontend work',
        parent_thread_id: 'root',
        delegation_context_json: context({ role: 'Frontend Reviewer' })
      }),
      thread('sib-c', {
        name: 'Audit',
        parent_thread_id: 'root',
        delegation_context_json: context({ role: 'Security Auditor', status: 'COMPLETED' })
      })
    ]);

    equal('all three hang from the same parent', nodes[0].children.length, 3);
    equal('at the same level', nodes[0].children.map(child => child.depth), [1, 1, 1]);

    const html = renderTree({
      nodes,
      activeThreadId: 'sib-b',
      parentStates: { root: 'WAITING_FOR_CHILD' },
      childStates: { 'sib-a': 'ACTIVE', 'sib-b': 'STARTING', 'sib-c': 'COMPLETED' },
      onCancelChild: noop
    });

    check('every sibling is rendered', html.includes('Backend work') && html.includes('Frontend work') && html.includes('Audit'));
    check('each with its own role badge', html.includes('Senior Backend Engineer') && html.includes('Frontend Reviewer'));
    check('all indented one level', (html.match(/margin-left:14px/g) || []).length === 3);
    check('the parent says it is waiting', html.includes('Waiting on child'));
    check('the working sibling says so', html.includes('Working'));
    check('the starting one too', html.includes('Starting'));
    check('and the finished one is done', html.includes('Completed'));
    check('the two still running can be stopped', html.includes('aria-label="Stop Backend work"') && html.includes('aria-label="Stop Frontend work"'));
    check('the finished one cannot', !html.includes('aria-label="Stop Audit"'));

    const stopping = renderTree({
      nodes,
      onCancelChild: noop,
      childStates: { 'sib-a': 'ACTIVE', 'sib-b': 'ACTIVE' },
      cancellingThreads: { 'sib-a': true }
    });
    check('stopping one sibling leaves the other stoppable', stopping.includes('aria-label="Stop Frontend work"'));
    check('while the one being stopped is spent', stopping.includes('disabled=""'));
  }

  describe('DelegateModalView');
  {
    const task = renderModal({ profiles: [profile(), profile({ id: 'p2', name: 'Backend', role: 'Senior Backend Engineer' })] });
    check('the task form is titled', task.includes('Delegate Work'));
    check('both modes are offered', task.includes('Request Review'));
    check('the profiles populate the role list', task.includes('Security Auditor'));
    check('including a renamed one', task.includes('Backend — Senior Backend Engineer'));
    check('a default option exists', task.includes('Let the Core match a role'));
    check('there is a task field', task.includes('aria-label="Task description"'));
    check('and a context field', task.includes('aria-label="Supporting context"'));
    check('submitting is refused while empty', task.includes('disabled=""'));

    const ready = renderModal({ task: 'Add rate limiting to /api/v1/auth/login.' });
    check('a filled task enables the button', !ready.includes('disabled=""'));

    const review = renderModal({ mode: 'REVIEW', context: 'diff --git a b' });
    check('the review form is titled', review.includes('>Request Review</h3>'));
    check('it asks for criteria', review.includes('aria-label="Review criteria"'));
    check('and for the changes', review.includes('aria-label="Changes to review"'));
    check('a filled diff enables the button', !review.includes('disabled=""'));

    const busy = renderModal({ task: 'x', isSubmitting: true });
    check('dispatching is visible', busy.includes('Dispatching…'));

    const parked = renderModal({ task: 'x', isDelegating: true });
    check('a thread already waiting is told so', parked.includes('already waiting on a delegated agent'));
    check('and cannot submit', parked.includes('disabled=""'));

    const failed = renderModal({ error: 'Delegation depth 4 exceeds the limit of 3.' });
    check('the Core’s refusal is shown', failed.includes('exceeds the limit of 3'));
    check('as an alert', failed.includes('role="alert"'));
  }

  describe('canSubmitDelegation / buildDelegationBody');
  {
    check('a task needs a description', !modal.canSubmitDelegation('TASK', '   ', 'context'));
    check('and is enough on its own', modal.canSubmitDelegation('TASK', 'do the thing', ''));
    check('a review needs the changes', !modal.canSubmitDelegation('REVIEW', 'criteria', ''));
    check('not the criteria', modal.canSubmitDelegation('REVIEW', '', 'diff'));

    const taskBody = modal.buildDelegationBody('TASK', {
      profileId: 'p2',
      task: '  Add rate limiting.  ',
      context: '  See ADR-012.  '
    });
    equal('a task posts kind TASK', taskBody.kind, 'TASK');
    equal('with the chosen profile', taskBody.profileId, 'p2');
    equal('a trimmed task', taskBody.task, 'Add rate limiting.');
    equal('and trimmed context', taskBody.context, 'See ADR-012.');

    const noContext = modal.buildDelegationBody('TASK', { task: 'x', context: '   ' });
    equal('empty context is omitted rather than sent blank', noContext.context, undefined);
    equal('and no profile is omitted too', noContext.profileId, undefined);

    const reviewBody = modal.buildDelegationBody('REVIEW', {
      task: '- No secrets in the diff\n* Input validation\n\n',
      context: 'diff --git a b'
    });
    equal('a review posts kind REVIEW', reviewBody.kind, 'REVIEW');
    equal('the changes go in diff', reviewBody.diff, 'diff --git a b');
    equal('criteria are one per line, bullets stripped', reviewBody.criteria, [
      'No secrets in the diff',
      'Input validation'
    ]);

    equal(
      'role options carry the underlying role',
      modal.roleOptionsFrom([profile()])[0].role,
      'Security Auditor'
    );

    check('a batch is never decided from the single fields', !modal.canSubmitDelegation('PARALLEL', 'x', 'y'));
  }

  // --- The batch builder (P7-05) --------------------------------------------

  describe('parallel batch helpers');
  {
    const start = modal.defaultParallelItems();
    equal('a batch opens with two subagents', start.length, 2);
    check('each with its own id', start[0].id !== start[1].id);
    equal('and nothing filled in', [start[0].task, start[0].context, start[0].profileId], ['', '', '']);

    check('two more can be added', modal.canAddParallelItem(start));
    check('but none removed', !modal.canRemoveParallelItem(start));

    const three = modal.addParallelItem(start);
    equal('adding one makes three', three.length, 3);
    const four = modal.addParallelItem(three);
    equal('and another makes four', four.length, 4);
    check('which is the concurrency limit', four.length === MAX_CONCURRENT_DELEGATIONS);
    check('so no more may be added', !modal.canAddParallelItem(four));
    equal('and asking anyway changes nothing', modal.addParallelItem(four), four);
    check('while three can be removed', modal.canRemoveParallelItem(four));

    const removed = modal.removeParallelItem(four, four[1].id);
    equal('removing one takes it out', removed.length, 3);
    check('the named one', !removed.some(item => item.id === four[1].id));
    check('leaving the others in order', removed.map(item => item.id).join() === [four[0].id, four[2].id, four[3].id].join());
    const atFloor = modal.removeParallelItem(modal.removeParallelItem(removed, removed[2].id), start[0].id);
    equal('and a batch of two cannot be cut further', atFloor.length, 2);
    equal('an unknown id removes nothing', modal.removeParallelItem(three, 'nope').length, 3);

    const edited = modal.updateParallelItem(start, start[1].id, { task: 'Wire the form.' });
    equal('editing one row writes it', edited[1].task, 'Wire the form.');
    equal('and leaves its sibling alone', edited[0].task, '');
    equal('keeping the ids stable', edited[1].id, start[1].id);

    check('an empty batch cannot be dispatched', !modal.canSubmitParallelDelegation(edited));
    const ready = modal.updateParallelItem(edited, start[0].id, { task: 'Add the endpoint.' });
    check('one with every task filled can', modal.canSubmitParallelDelegation(ready));
    check(
      'whitespace is not a task',
      !modal.canSubmitParallelDelegation(modal.updateParallelItem(ready, start[0].id, { task: '   ' }))
    );
    check('a single delegation is not a batch', !modal.canSubmitParallelDelegation([ready[0]]));
    check(
      'and neither is a fifth subagent',
      !modal.canSubmitParallelDelegation([ready[0], ready[1], ready[0], ready[1], ready[0]])
    );
  }

  describe('buildParallelDelegationBody');
  {
    const items = modal.defaultParallelItems();
    const filled = modal.updateParallelItem(
      modal.updateParallelItem(items, items[0].id, {
        profileId: 'p2',
        task: '  Add the endpoint.  ',
        context: '  See ADR-012.  '
      }),
      items[1].id,
      { task: 'Test it.', context: '   ' }
    );

    const body = modal.buildParallelDelegationBody(filled) as {
      delegations: Record<string, unknown>[];
    };
    equal('one delegation per row', body.delegations.length, 2);
    equal('the chosen profile is sent', body.delegations[0].profileId, 'p2');
    equal('the task is trimmed', body.delegations[0].taskDescription, 'Add the endpoint.');
    equal('as is the context', body.delegations[0].inputContext, 'See ADR-012.');
    equal('every piece is a TASK', body.delegations.map(item => item.kind), ['TASK', 'TASK']);
    equal('an unchosen role is omitted rather than sent blank', body.delegations[1].profileId, undefined);
    equal('and so is empty context', body.delegations[1].inputContext, undefined);
    equal('the second task is carried', body.delegations[1].taskDescription, 'Test it.');
  }

  describe('DelegateModalView — parallel batch');
  {
    const items = modal.defaultParallelItems();
    const profiles = [profile(), profile({ id: 'p2', name: 'Backend', role: 'Senior Backend Engineer' })];
    const html = renderModal({
      mode: 'PARALLEL',
      profiles,
      parallelItems: items,
      onAddParallelItem: noop,
      onRemoveParallelItem: noop,
      onParallelItemChange: noop
    });

    check('the batch form is titled', html.includes('>Parallel Batch</h3>'));
    check('the tab is offered alongside the other two', html.includes('Delegate Task') && html.includes('Request Review'));
    check('the batch size is counted', html.includes('Subagents (2/4)'));
    check('the copy says what a batch does', html.includes('Dispatch up to 4 concurrent subagents'));
    check('and that the thread waits for all of them', html.includes('This thread will wait until all subagents finish'));
    check('the first subagent is rendered', html.includes('>Subagent 1</span>'));
    check('and the second', html.includes('>Subagent 2</span>'));
    check('but not a third', !html.includes('>Subagent 3</span>'));
    check('each with its own role selector', html.includes('aria-label="Subagent 1 role"') && html.includes('aria-label="Subagent 2 role"'));
    check('populated from the profiles', html.includes('Backend — Senior Backend Engineer'));
    check('each with its own task field', html.includes('aria-label="Subagent 1 task"') && html.includes('aria-label="Subagent 2 task"'));
    check('and its own context field', html.includes('aria-label="Subagent 2 context"'));
    check('a subagent can be added', html.includes('+ Add Subagent'));
    check('and each one removed', html.includes('aria-label="Remove subagent 1"'));
    check('the single-delegation fields are gone', !html.includes('aria-label="Task description"'));
    check('as is the review form', !html.includes('aria-label="Changes to review"'));
    check('an unfilled batch says what it needs', html.includes('Every subagent needs a task'));
    check('and cannot be dispatched', html.includes('disabled=""'));
    check('no colour is hardcoded', !/#[0-9a-fA-F]{6}/.test(html));

    const ready = modal.updateParallelItem(
      modal.updateParallelItem(items, items[0].id, { task: 'Add the endpoint.' }),
      items[1].id,
      { task: 'Test it.' }
    );
    const dispatchable = renderModal({ mode: 'PARALLEL', parallelItems: ready, onAddParallelItem: noop });
    check('a filled batch drops the warning', !dispatchable.includes('Every subagent needs a task'));
    check('and names what it will dispatch', dispatchable.includes('Dispatch 2 Subagents'));

    const four = modal.addParallelItem(modal.addParallelItem(ready));
    const full = renderModal({ mode: 'PARALLEL', parallelItems: four, onAddParallelItem: noop, onRemoveParallelItem: noop });
    check('a full batch counts to the limit', full.includes('Subagents (4/4)'));
    check('and shows every subagent', full.includes('>Subagent 4</span>'));
    check('the button names the four', full.includes('Dispatch 4 Subagents'));

    const busy = renderModal({ mode: 'PARALLEL', parallelItems: ready, isSubmitting: true });
    check('dispatching is visible', busy.includes('Dispatching…'));

    const parked = renderModal({ mode: 'PARALLEL', parallelItems: ready, isDelegating: true });
    check('a thread already waiting cannot fan out either', parked.includes('already waiting on a delegated agent'));

    const refused = renderModal({
      mode: 'PARALLEL',
      parallelItems: ready,
      error: 'Thread root already has 4 delegations running; the limit is 4.'
    });
    check('a concurrency refusal is shown', refused.includes('the limit is 4'));
    check('as an alert', refused.includes('role="alert"'));
  }

  describe('DelegateModalView — adding and removing subagents');
  {
    // The view holds no state of its own, so calling it returns the element
    // tree its buttons live in — the same trick the banner tests use.
    const callView = (props: Record<string, unknown>) =>
      (modal.DelegateModalView as unknown as (props: unknown) => unknown)({
        profiles: [],
        mode: 'PARALLEL',
        onModeChange: noop,
        profileId: '',
        onProfileChange: noop,
        task: '',
        onTaskChange: noop,
        context: '',
        onContextChange: noop,
        onSubmit: noop,
        onClose: noop,
        ...props
      });

    const two = modal.defaultParallelItems();
    let added = 0;
    let removed: string | null = null;
    const patches: { id: string; patch: Record<string, unknown> }[] = [];
    const lastPatch = () => patches[patches.length - 1];

    const atFloor = callView({
      parallelItems: two,
      onAddParallelItem: () => {
        added++;
      },
      onRemoveParallelItem: (id: string) => {
        removed = id;
      },
      onParallelItemChange: (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      }
    });

    const addButton = findElement(atFloor, props => props['aria-label'] === 'Add subagent');
    check('the add control is in the tree', !!addButton);
    equal('and is enabled at two', addButton?.props?.disabled, false);
    (addButton?.props?.onClick as () => void)();
    equal('clicking it asks for another subagent', added, 1);

    const removeFirst = findElement(atFloor, props => props['aria-label'] === 'Remove subagent 1');
    check('every row offers a removal', !!removeFirst);
    equal('which is refused at the minimum of two', removeFirst?.props?.disabled, true);
    check('and says why', String(removeFirst?.props?.title).includes('at least 2 subagents'));

    const taskField = findElement(atFloor, props => props['aria-label'] === 'Subagent 2 task');
    (taskField?.props?.onChange as (event: unknown) => void)({ target: { value: 'Test it.' } });
    equal('typing into a row names that row', lastPatch()?.id, two[1].id);
    equal('and carries what was typed', lastPatch()?.patch, { task: 'Test it.' });

    const roleField = findElement(atFloor, props => props['aria-label'] === 'Subagent 1 role');
    (roleField?.props?.onChange as (event: unknown) => void)({ target: { value: 'p2' } });
    equal('choosing a role writes the profile', lastPatch()?.patch, { profileId: 'p2' });
    equal('on the row it was chosen in', lastPatch()?.id, two[0].id);

    const contextField = findElement(atFloor, props => props['aria-label'] === 'Subagent 1 context');
    (contextField?.props?.onChange as (event: unknown) => void)({ target: { value: 'See ADR-012.' } });
    equal('and the context is its own field', lastPatch()?.patch, { context: 'See ADR-012.' });

    const three = modal.addParallelItem(two);
    const aboveFloor = callView({
      parallelItems: three,
      onAddParallelItem: noop,
      onRemoveParallelItem: (id: string) => {
        removed = id;
      },
      onParallelItemChange: noop
    });
    const removeSecond = findElement(aboveFloor, props => props['aria-label'] === 'Remove subagent 2');
    equal('above the minimum a row can be dropped', removeSecond?.props?.disabled, false);
    (removeSecond?.props?.onClick as () => void)();
    equal('and it names that row, not another', removed, three[1].id);

    const full = modal.addParallelItem(modal.addParallelItem(three));
    const atCeiling = callView({
      parallelItems: full,
      onAddParallelItem: noop,
      onRemoveParallelItem: noop,
      onParallelItemChange: noop
    });
    const cappedAdd = findElement(atCeiling, props => props['aria-label'] === 'Add subagent');
    equal('at four the add control is spent', cappedAdd?.props?.disabled, true);
    check('and says what the bound is', String(cappedAdd?.props?.title).includes('at most 4 subagents'));

    const submitButton = findElement(atCeiling, props => props['type'] === 'submit');
    equal('a batch with empty tasks cannot be submitted', submitButton?.props?.disabled, true);
  }

  describe('parallel batch — dispatch and refusal');
  {
    useProjectStore.getState().resetDelegation();
    useProjectStore.getState().setActiveProject(PROJECT);
    useProjectStore.getState().setThreads([thread('root')]);
    requests.length = 0;

    // What the form composes is what the batch endpoint is posted.
    const items = modal.defaultParallelItems();
    const composed = modal.updateParallelItem(
      modal.updateParallelItem(items, items[0].id, {
        profileId: 'p2',
        task: 'Add the endpoint.',
        context: 'See ADR-012.'
      }),
      items[1].id,
      { task: 'Test it.' }
    );
    const payload = modal.buildParallelDelegationBody(composed) as {
      delegations: ParallelDelegationItem[];
    };

    respond({ batch: batch({ overallStatus: 'COMPLETED' }) });
    const dispatched = await useProjectStore.getState().delegateParallel('root', payload.delegations);

    equal(
      'the batch goes to the parallel endpoint',
      requests[0]?.url.endsWith('/api/v1/threads/root/delegate/parallel'),
      true
    );
    equal('with POST', requests[0]?.method, 'POST');
    equal('carrying the token', requests[0]?.headers['Authorization'], 'Bearer test-token');
    equal(
      'and both subagents as the Core reads them',
      (requests[0]?.body as { delegations?: ParallelDelegationItem[] })?.delegations?.map(
        item => item.taskDescription
      ),
      ['Add the endpoint.', 'Test it.']
    );
    equal('the Core accepted it', dispatched?.overallStatus, 'COMPLETED');

    // What closes the modal is the socket saying children have started, not the
    // response — the request is held open for the length of the whole batch.
    useProjectStore.getState().resetDelegation();
    useProjectStore.getState().setThreads([thread('root')]);
    for (const childThreadId of ['child-a', 'child-b']) {
      handleDelegationEvent('delegation.started', {
        projectId: PROJECT,
        threadId: 'root',
        childThreadId,
        depth: 1,
        kind: 'TASK',
        role: 'QA Engineer',
        taskDescription: 'Work.'
      });
      handleDelegationEvent('delegation.parent_state', {
        projectId: PROJECT,
        threadId: 'root',
        state: 'WAITING_FOR_CHILD',
        childThreadId
      });
    }
    check(
      'the modal’s close condition is met once the children start',
      (useProjectStore.getState().pendingChildren['root'] || []).length > 0
    );

    requests.length = 0;
    respond(
      {
        error: 'Thread root already has 4 delegations running; the limit is 4.',
        code: 'CONCURRENCY_LIMIT_EXCEEDED'
      },
      409
    );
    equal(
      'a batch over the limit is refused',
      await useProjectStore.getState().delegateParallel('root', payload.delegations),
      null
    );
    const shown = renderModal({
      mode: 'PARALLEL',
      parallelItems: composed,
      error: 'Thread root already has 4 delegations running; the limit is 4.'
    });
    check('and the refusal is what the modal shows', shown.includes('already has 4 delegations running'));
  }

  // --- Verification & sandbox evidence (P8-03) ------------------------------

  describe('verificationStatusTone');
  {
    const { verificationStatusTone, verificationStepTone } = store;

    equal('a clean pipeline reads as completed', verificationStatusTone(report()).tone, 'completed');
    equal(
      'and counts the steps and the time',
      verificationStatusTone(report()).label,
      '4/4 verification steps passed (1.2s)'
    );

    const failing = verificationStatusTone(failedReport());
    equal('a red pipeline reads as failed', failing.tone, 'failed');
    equal('naming the step and its exit code', failing.label, 'typecheck failed (exit 1)');

    const twoBroken = verificationStatusTone(
      report({
        steps: [
          step({ passed: false, exitCode: 2 }),
          step({ name: 'test', command: 'pnpm run test', passed: false, exitCode: 1 })
        ]
      })
    );
    check('several failures name the first and count the rest', twoBroken.label.includes('+1 more'));

    const timedOut = verificationStatusTone(
      report({
        steps: [step({ passed: false, exitCode: null, error: 'timed out after 60000ms' })]
      })
    );
    check('a step that never exited says why instead', timedOut.label.includes('timed out after 60000ms'));

    // The case the whole subsystem exists to keep honest.
    const nothing = verificationStatusTone(report({ steps: [], passed: false, totalSteps: 0, passedSteps: 0, failedSteps: 0 }));
    equal('a pipeline with nothing in it is not a pass', nothing.tone, 'idle');
    equal('and says so in words', nothing.label, 'No verification pipeline configured');
    equal('an absent report is not verified', verificationStatusTone(null).label, 'Not verified');
    equal('nor is an undefined one', verificationStatusTone(undefined).tone, 'idle');

    check(
      'every verification tone comes from a token',
      [verificationStatusTone(report()), failing, nothing].every(descriptor =>
        descriptor.color.startsWith('var(--')
      )
    );
    equal('a passing step is emerald', verificationStepTone(true).tone, 'completed');
    equal('and a failing one is not', verificationStepTone(false).tone, 'failed');
  }

  describe('diff and step presentation helpers');
  {
    equal('a file header is metadata', status.diffLineTone('diff --git a/x b/x'), 'meta');
    equal('so is an index line', status.diffLineTone('index 1111111..2222222 100644'), 'meta');
    equal('and a hunk header', status.diffLineTone('@@ -1,3 +1,4 @@'), 'meta');
    equal('--- is a file header, not a deletion', status.diffLineTone('--- a/x'), 'meta');
    equal('+++ is a file header, not an addition', status.diffLineTone('+++ b/x'), 'meta');
    equal('an added line is an addition', status.diffLineTone('+  const x = 1;'), 'added');
    equal('a removed one is a removal', status.diffLineTone('-  const x = 1;'), 'removed');
    equal('and everything else is context', status.diffLineTone('   return x;'), 'context');
    equal('a new file mode line is metadata', status.diffLineTone('new file mode 100644'), 'meta');

    check('additions are emerald', status.diffLineColor('added').startsWith('var(--'));
    check('removals are rose', status.diffLineColor('removed') === 'var(--color-state-error)');
    check('nothing is a hex value', !/#[0-9a-fA-F]{6}/.test(status.diffLineColor('meta')));

    equal('a short patch is shown whole', status.diffPreview(SANDBOX_DIFF).lines.length, 8);
    equal('with nothing hidden', status.diffPreview(SANDBOX_DIFF).hidden, 0);
    const huge = Array.from({ length: 500 }, (_, index) => `+ line ${index}`).join('\n');
    equal('a long one is bounded', status.diffPreview(huge).lines.length, status.MAX_DIFF_PREVIEW_LINES);
    equal('and says how much was left out', status.diffPreview(huge).hidden, 500 - status.MAX_DIFF_PREVIEW_LINES);
    equal('no patch is no lines', status.diffPreview(undefined).lines.length, 0);

    equal(
      'a sandbox branch is named after its thread',
      status.sandboxBranchLabel('child-1'),
      'asterim/sandbox/child-1'
    );
    equal(
      'unless the Core said what it is',
      status.sandboxBranchLabel('child-1', 'asterim/sandbox/other'),
      'asterim/sandbox/other'
    );

    equal(
      'a step detail carries the command, the time and the exit code',
      status.verificationStepDetail(step()),
      'pnpm run typecheck · 0.4s · exit 0'
    );
    equal(
      'a killed step says why rather than exiting',
      status.verificationStepDetail(step({ passed: false, exitCode: null, error: 'timed out' })),
      'pnpm run typecheck · 0.4s · timed out'
    );
    check(
      'a failing step’s output is both streams',
      status.stepOutput(failedReport().steps[0]).includes('error TS2345') &&
        status.stepOutput(failedReport().steps[0]).includes('1 problem')
    );
    equal('a quiet step has no output at all', status.stepOutput(step()), '');
  }

  describe('resolveEvidence');
  {
    const withSandbox = result({
      worktreePath: '/repo/.asterim/worktrees/child-1',
      diff: SANDBOX_DIFF,
      changedFiles: ['apps/server/src/routes/upload.ts'],
      verificationReport: report()
    });

    const fromResult = status.resolveEvidence(withSandbox);
    check('the result’s own evidence is enough', fromResult.hasSandbox && fromResult.hasVerification);
    equal('the diff comes off the payload', fromResult.changes?.changedFiles.length, 1);
    equal('as does the report', fromResult.report?.totalSteps, 4);

    const fresher = status.resolveEvidence(withSandbox, {
      reports: { 'child-1': failedReport() },
      diffs: { 'child-1': { diff: 'diff --git a/b b/b', changedFiles: ['b'] } },
      worktrees: { 'child-1': worktree({ branch: 'asterim/sandbox/child-1' }) }
    });
    equal('an on-demand report wins over the one that arrived', fresher.report?.failedSteps, 1);
    equal('as does a re-read diff', fresher.changes?.changedFiles, ['b']);
    equal('and the branch the Core named', fresher.branch, 'asterim/sandbox/child-1');

    // A discarded sandbox is an explicit null, not an absent key.
    const discarded = status.resolveEvidence(withSandbox, {
      diffs: { 'child-1': null },
      reports: { 'child-1': null }
    });
    equal('a discarded sandbox does not fall back to the stale diff', discarded.changes, null);
    equal('nor to the stale report', discarded.report, null);
    check('so the card stops claiming it is verified', !discarded.hasVerification);

    const plain = status.resolveEvidence(result());
    check('an unsandboxed delegation has nothing to show', !plain.hasSandbox && !plain.hasVerification);
    equal('and no diff was invented for it', plain.changes, null);

    const isolatedButClean = status.resolveEvidence(
      result({ worktreePath: '/repo/.asterim/worktrees/child-1', diff: '', changedFiles: [] })
    );
    check('a sandbox that changed nothing is still a sandbox', isolatedButClean.hasSandbox);
    equal('with no files in it', isolatedButClean.changes?.changedFiles.length, 0);
  }

  // --- Store: evidence off the socket ---------------------------------------

  describe('useProjectStore — evidence from a finished delegation');
  {
    useProjectStore.getState().resetDelegation();
    useProjectStore.getState().setThreads([thread('root')]);

    handleDelegationEvent('delegation.completed', {
      projectId: PROJECT,
      threadId: 'root',
      result: result({
        worktreePath: '/repo/.asterim/worktrees/child-1',
        diff: SANDBOX_DIFF,
        changedFiles: ['apps/server/src/routes/upload.ts'],
        verificationReport: report()
      })
    });

    let state = useProjectStore.getState();
    equal(
      'the diff is kept against the child, not the parent',
      state.threadDiffs['child-1']?.changedFiles,
      ['apps/server/src/routes/upload.ts']
    );
    equal('with the patch itself', state.threadDiffs['child-1']?.diff.startsWith('diff --git'), true);
    equal('and the verification report', state.threadVerificationReports['child-1']?.passedSteps, 4);
    equal('nothing was written against the parent', state.threadDiffs['root'], undefined);

    // A second delegation with no sandbox must not erase the first one's.
    handleDelegationEvent('delegation.completed', {
      projectId: PROJECT,
      threadId: 'root',
      result: result({ childThreadId: 'child-2', summary: 'Nothing to isolate.' })
    });
    state = useProjectStore.getState();
    equal('an unsandboxed sibling records no diff', state.threadDiffs['child-2'], undefined);
    equal('and leaves the sandboxed one alone', state.threadDiffs['child-1']?.changedFiles.length, 1);

    handleDelegationEvent('delegation.batch_completed', {
      projectId: PROJECT,
      threadId: 'root',
      batch: batch({
        results: [
          result({
            childThreadId: 'child-a',
            worktreePath: '/repo/.asterim/worktrees/child-a',
            diff: SANDBOX_DIFF,
            changedFiles: ['a.ts'],
            verificationReport: report()
          }),
          result({
            childThreadId: 'child-b',
            status: 'FAILED',
            worktreePath: '/repo/.asterim/worktrees/child-b',
            diff: '',
            changedFiles: [],
            verificationReport: failedReport()
          })
        ]
      })
    });
    state = useProjectStore.getState();
    equal('every child of a batch keeps its own diff', state.threadDiffs['child-a']?.changedFiles, ['a.ts']);
    equal('and its own report', state.threadVerificationReports['child-b']?.failedSteps, 1);
    check('which is not the sibling’s', state.threadVerificationReports['child-a']?.passed === true);

    useProjectStore.getState().resetDelegation();
    state = useProjectStore.getState();
    equal(
      'resetDelegation forgets the sandboxes too',
      Object.keys(state.threadDiffs).length +
        Object.keys(state.threadVerificationReports).length +
        Object.keys(state.threadWorktrees).length +
        Object.keys(state.worktreeActions).length,
      0
    );
  }

  // --- Store: the worktree REST surface -------------------------------------

  describe('useProjectStore — fetchThreadWorktree');
  {
    useProjectStore.getState().resetDelegation();
    requests.length = 0;
    respond({
      threadId: 'child-1',
      worktree: worktree(),
      diff: {
        worktreePath: '/repo/.asterim/worktrees/child-1',
        baseCommit: 'abc1234',
        diff: SANDBOX_DIFF,
        changedFiles: ['apps/server/src/routes/upload.ts'],
        clean: false
      }
    });

    const found = await useProjectStore.getState().fetchThreadWorktree('child-1');
    equal(
      'it reads the worktree endpoint',
      requests[0]?.url.endsWith('/api/v1/threads/child-1/worktree'),
      true
    );
    equal('with GET', requests[0]?.method, 'GET');
    equal('carrying the token', requests[0]?.headers['Authorization'], 'Bearer test-token');
    equal('the sandbox comes back to the caller', found?.branch, 'asterim/sandbox/child-1');
    equal('and is kept', useProjectStore.getState().threadWorktrees['child-1']?.status, 'ACTIVE');
    equal(
      'alongside what it changed',
      useProjectStore.getState().threadDiffs['child-1']?.changedFiles.length,
      1
    );

    requests.length = 0;
    respond({ threadId: 'child-2', worktree: null, recordedPath: null, recordedBranch: null, diff: null });
    equal('a thread with no sandbox answers null', await useProjectStore.getState().fetchThreadWorktree('child-2'), null);
    equal(
      'and the null is recorded rather than skipped',
      'child-2' in useProjectStore.getState().threadWorktrees,
      true
    );
    equal('with no diff either', useProjectStore.getState().threadDiffs['child-2'], null);

    requests.length = 0;
    respond({ error: 'Unauthorized' }, 401);
    equal('a refused read answers nothing', await useProjectStore.getState().fetchThreadWorktree('child-3'), null);
    equal(
      'and changes nothing',
      'child-3' in useProjectStore.getState().threadWorktrees,
      false
    );

    requests.length = 0;
    equal('no thread means no request', await useProjectStore.getState().fetchThreadWorktree(''), null);
    equal('and nothing was sent', requests.length, 0);
  }

  describe('useProjectStore — mergeThreadWorktree');
  {
    useProjectStore.getState().resetDelegation();
    requests.length = 0;
    respond({ threadId: 'child-1', worktree: worktree(), diff: null });
    await useProjectStore.getState().fetchThreadWorktree('child-1');

    requests.length = 0;
    respond({
      success: true,
      result: {
        threadId: 'child-1',
        branch: 'asterim/sandbox/child-1',
        targetBranch: 'main',
        merged: true,
        commit: 'deadbee',
        conflicts: []
      }
    });
    const merged = await useProjectStore.getState().mergeThreadWorktree('child-1');
    equal(
      'it posts to the merge endpoint',
      requests[0]?.url.endsWith('/api/v1/threads/child-1/worktree/merge'),
      true
    );
    equal('with POST', requests[0]?.method, 'POST');
    equal('carrying the token', requests[0]?.headers['Authorization'], 'Bearer test-token');
    equal('and no branch when none was chosen', (requests[0]?.body as { targetBranch?: string })?.targetBranch, undefined);
    equal('the merge is reported as done', merged.success, true);
    equal(
      'and the sandbox is no longer active',
      useProjectStore.getState().threadWorktrees['child-1']?.status,
      'MERGED'
    );
    equal('with nothing left in flight', Object.keys(useProjectStore.getState().worktreeActions).length, 0);

    requests.length = 0;
    respond({ success: true, result: { threadId: 'child-1', branch: 'b', targetBranch: 'release', merged: true, conflicts: [] } });
    await useProjectStore.getState().mergeThreadWorktree('child-1', 'release');
    equal('a chosen branch is sent', (requests[0]?.body as { targetBranch?: string })?.targetBranch, 'release');

    // A merge git could not make: 200, `merged: false`, and the reason.
    requests.length = 0;
    respond({
      success: false,
      result: {
        threadId: 'child-1',
        branch: 'asterim/sandbox/child-1',
        targetBranch: 'main',
        merged: false,
        conflicts: ['apps/server/src/routes/upload.ts'],
        reason: 'The sandbox conflicts with main.'
      }
    });
    const conflicted = await useProjectStore.getState().mergeThreadWorktree('child-1');
    equal('a conflict is not a success', conflicted.success, false);
    check('the reason is passed on', conflicted.error?.includes('conflicts with main') === true);
    check('with the paths that clashed', conflicted.error?.includes('apps/server/src/routes/upload.ts') === true);

    requests.length = 0;
    respond({ error: 'The working tree has uncommitted changes.', code: 'DIRTY_TARGET' }, 409);
    const refused = await useProjectStore.getState().mergeThreadWorktree('child-1');
    equal('an HTTP refusal is a failure too', refused.success, false);
    equal('in the Core’s own words', refused.error, 'The working tree has uncommitted changes.');
    equal('and nothing is left spinning', Object.keys(useProjectStore.getState().worktreeActions).length, 0);

    requests.length = 0;
    equal('no thread means no merge', (await useProjectStore.getState().mergeThreadWorktree('')).success, false);
    equal('and nothing was sent', requests.length, 0);
  }

  describe('useProjectStore — discardThreadWorktree');
  {
    useProjectStore.getState().resetDelegation();
    requests.length = 0;
    respond({ threadId: 'child-1', worktree: worktree(), diff: { worktreePath: 'p', baseCommit: 'c', diff: SANDBOX_DIFF, changedFiles: ['x.ts'], clean: false } });
    await useProjectStore.getState().fetchThreadWorktree('child-1');

    requests.length = 0;
    respond({ success: true, removed: true, threadId: 'child-1' });
    const discarded = await useProjectStore.getState().discardThreadWorktree('child-1');
    equal(
      'it addresses the worktree endpoint',
      requests[0]?.url.endsWith('/api/v1/threads/child-1/worktree'),
      true
    );
    equal('with DELETE', requests[0]?.method, 'DELETE');
    equal('carrying the token', requests[0]?.headers['Authorization'], 'Bearer test-token');
    equal('the sandbox is gone', discarded.success, true);
    equal('and the dashboard forgets it', useProjectStore.getState().threadWorktrees['child-1'], null);
    equal('along with its diff', useProjectStore.getState().threadDiffs['child-1'], null);
    equal('with nothing left in flight', Object.keys(useProjectStore.getState().worktreeActions).length, 0);

    requests.length = 0;
    respond({ error: 'No thread with id child-9.', code: 'THREAD_NOT_FOUND' }, 404);
    const missing = await useProjectStore.getState().discardThreadWorktree('child-9');
    equal('a refusal is reported', missing.success, false);
    equal('with what the Core said', missing.error, 'No thread with id child-9.');

    requests.length = 0;
    equal('no thread means no request', (await useProjectStore.getState().discardThreadWorktree('')).success, false);
    equal('and nothing was sent', requests.length, 0);
  }

  describe('useProjectStore — verifyThreadWorktree');
  {
    useProjectStore.getState().resetDelegation();
    requests.length = 0;
    respond({ threadId: 'child-1', sandboxed: true, report: failedReport() });

    const ran = await useProjectStore.getState().verifyThreadWorktree('child-1');
    equal(
      'it posts to the verify endpoint',
      requests[0]?.url.endsWith('/api/v1/threads/child-1/worktree/verify'),
      true
    );
    equal('with POST', requests[0]?.method, 'POST');
    equal('carrying the token', requests[0]?.headers['Authorization'], 'Bearer test-token');
    equal('and no step list when all of them were wanted', (requests[0]?.body as { steps?: string[] })?.steps, undefined);
    equal('the report comes back to the caller', ran?.failedSteps, 1);
    equal(
      'and is kept for the card',
      useProjectStore.getState().threadVerificationReports['child-1']?.failedSteps,
      1
    );
    equal('with nothing left verifying', Object.keys(useProjectStore.getState().worktreeActions).length, 0);

    requests.length = 0;
    respond({ threadId: 'child-1', sandboxed: true, report: report() });
    await useProjectStore.getState().verifyThreadWorktree('child-1', ['typecheck', 'test']);
    equal(
      'a subset is sent by name, never as commands',
      (requests[0]?.body as { steps?: string[] })?.steps,
      ['typecheck', 'test']
    );
    equal(
      'and a clean re-run replaces the failure',
      useProjectStore.getState().threadVerificationReports['child-1']?.passed,
      true
    );

    requests.length = 0;
    respond({ error: 'Verification pipeline failed to run' }, 500);
    equal('a pipeline that could not run answers nothing', await useProjectStore.getState().verifyThreadWorktree('child-1'), null);
    equal(
      'leaving the last report alone',
      useProjectStore.getState().threadVerificationReports['child-1']?.passed,
      true
    );
    equal('and nothing spinning', Object.keys(useProjectStore.getState().worktreeActions).length, 0);

    requests.length = 0;
    equal('no thread means no request', await useProjectStore.getState().verifyThreadWorktree(''), null);
    equal('and nothing was sent', requests.length, 0);
  }

  describe('useProjectStore — fetchThreadVerification');
  {
    useProjectStore.getState().resetDelegation();
    requests.length = 0;
    respond({ threadId: 'child-1', report: report() });

    const known = await useProjectStore.getState().fetchThreadVerification('child-1');
    equal(
      'it reads the verify endpoint',
      requests[0]?.url.endsWith('/api/v1/threads/child-1/worktree/verify'),
      true
    );
    equal('with GET, so nothing is run', requests[0]?.method, 'GET');
    equal('carrying the token', requests[0]?.headers['Authorization'], 'Bearer test-token');
    equal('the last report comes back', known?.passedSteps, 4);
    equal(
      'and the card gets it after a reload',
      useProjectStore.getState().threadVerificationReports['child-1']?.passed,
      true
    );

    requests.length = 0;
    respond({ threadId: 'child-2', report: null });
    equal('a thread never verified answers null', await useProjectStore.getState().fetchThreadVerification('child-2'), null);
    equal(
      'recorded as null rather than skipped',
      'child-2' in useProjectStore.getState().threadVerificationReports,
      true
    );

    requests.length = 0;
    respond({ error: 'No thread with id child-9.' }, 404);
    equal('a refused read answers nothing', await useProjectStore.getState().fetchThreadVerification('child-9'), null);
    equal(
      'and records nothing',
      'child-9' in useProjectStore.getState().threadVerificationReports,
      false
    );

    requests.length = 0;
    equal('no thread means no request', await useProjectStore.getState().fetchThreadVerification(''), null);
    equal('and nothing was sent', requests.length, 0);
  }

  describe('ThreadSandboxIndicator — the thread header');
  {
    const render = (props: Record<string, unknown>) =>
      renderToStaticMarkup(React.createElement(status.ThreadSandboxIndicator, props));

    const both = render({
      branch: 'asterim/sandbox/child-1',
      worktreePath: '/repo/.asterim/worktrees/child-1',
      report: report()
    });
    check('the header says the thread is sandboxed', both.includes('aria-label="Thread sandbox"'));
    check('naming the branch', both.includes('asterim/sandbox/child-1'));
    check('and what verification said', both.includes('4/4 verification steps passed (1.2s)'));
    check('no colour is hardcoded', !/#[0-9a-fA-F]{6}/.test(both));

    const failed = render({ branch: 'asterim/sandbox/child-1', report: failedReport() });
    check('a failed pipeline is shown in the header too', failed.includes('typecheck failed (exit 1)'));

    const sandboxOnly = render({ worktreePath: '/repo/.asterim/worktrees/child-1' });
    check('a sandbox with no report still shows', sandboxOnly.includes('sandboxed'));
    check('and claims nothing about verification', !sandboxOnly.includes('verification steps'));

    equal('an ordinary thread shows nothing at all', render({}), '');
  }

  // --- Views: verification evidence on the outcome card ---------------------

  describe('DelegationOutcomeCard — verification evidence');
  {
    const passing = renderStatus({
      outcome: result({ verificationReport: report() }),
      evidence: { expandedSteps: { 'child-1': true }, onToggleSteps: noop, onReverify: noop }
    });
    check('the card has a verification block', passing.includes('aria-label="Verification evidence"'));
    check('with the summary badge', passing.includes('4/4 verification steps passed (1.2s)'));
    check('marked as passed', passing.includes('✓'));
    check('the steps can be opened', passing.includes('aria-expanded="true"'));
    check('every step is broken out', passing.includes('typecheck') && passing.includes('lint') && passing.includes('test') && passing.includes('build'));
    check('with the command behind it', passing.includes('pnpm run build'));
    check('its duration', passing.includes('0.4s'));
    check('and its exit code', passing.includes('exit 0'));
    check('verification can be re-run', passing.includes('aria-label="Re-run verification"'));
    check('named for what it does', passing.includes('Re-run Verification'));
    check('no colour is hardcoded', !/#[0-9a-fA-F]{6}/.test(passing));

    const collapsed = renderStatus({
      outcome: result({ verificationReport: report() }),
      evidence: { onToggleSteps: noop }
    });
    check('the breakdown starts closed', collapsed.includes('aria-expanded="false"'));
    check('offering to open it', collapsed.includes('Show Steps (4)'));
    check('while the summary is always there', collapsed.includes('verification steps passed'));
    check('and the commands are not', !collapsed.includes('pnpm run build'));

    const failing = renderStatus({
      outcome: result({ status: 'FAILED', verificationReport: failedReport() }),
      evidence: { expandedSteps: { 'child-1': true }, onToggleSteps: noop, onCopy: noop }
    });
    check('a red pipeline says which step', failing.includes('typecheck failed (exit 1)'));
    check('marked as failed', failing.includes('✗'));
    check('the failing step’s output is shown', failing.includes('error TS2345'));
    check('both streams of it', failing.includes('1 problem'));
    check('in a labelled box', failing.includes('aria-label="typecheck output"'));
    check('that can be copied', failing.includes('aria-label="Copy typecheck output"'));
    check('and the passing step carries no diagnostic box', !failing.includes('aria-label="lint output"'));
    check('with no hardcoded colour', !/#[0-9a-fA-F]{6}/.test(failing));

    const nothingRan = renderStatus({
      outcome: result({
        verificationReport: report({ steps: [], passed: false, totalSteps: 0, passedSteps: 0, failedSteps: 0 })
      }),
      evidence: { onToggleSteps: noop, onReverify: noop }
    });
    check('an empty pipeline says so plainly', nothingRan.includes('No verification pipeline configured'));
    check('and never claims a pass', !nothingRan.includes('steps passed'));
    check('with nothing to expand', !nothingRan.includes('Show Steps'));
    check('but it can still be re-run', nothingRan.includes('Re-run Verification'));

    const verifying = renderStatus({
      outcome: result({ verificationReport: report() }),
      evidence: { busy: { 'child-1': 'VERIFYING' }, onReverify: noop }
    });
    check('a verification in flight is visible', verifying.includes('Verifying…'));
    check('and the button is spent', verifying.includes('disabled=""'));

    const unverified = renderStatus({ outcome: result() });
    check('a delegation with no evidence shows no block', !unverified.includes('aria-label="Verification evidence"'));
    check('and no sandbox panel either', !unverified.includes('aria-label="Sandbox"'));
    check('while the summary is untouched', unverified.includes('Added a path check to the upload route.'));
  }

  describe('DelegationOutcomeCard — sandbox diff and lifecycle');
  {
    const sandboxed = result({
      worktreePath: '/repo/.asterim/worktrees/child-1',
      diff: SANDBOX_DIFF,
      changedFiles: ['apps/server/src/routes/upload.ts', 'apps/server/src/routes/__tests__/upload.test.ts']
    });

    const html = renderStatus({
      outcome: sandboxed,
      evidence: { onToggleDiff: noop, onMerge: noop, onDiscard: noop }
    });
    check('the sandbox panel is labelled', html.includes('aria-label="Sandbox"'));
    check('naming the branch it sits on', html.includes('Sandbox: asterim/sandbox/child-1'));
    check('counting the files it changed', html.includes('2 files changed'));
    check('and listing them', html.includes('apps/server/src/routes/upload.ts'));
    check('the diff can be opened', html.includes('aria-label="View diff"'));
    check('the work can be kept', html.includes('aria-label="Merge changes"'));
    check('named for what it does', html.includes('Merge Changes'));
    check('or thrown away', html.includes('aria-label="Discard sandbox"'));
    check('also named', html.includes('Discard Sandbox'));
    check('the patch is not shown until it is asked for', !html.includes('assertInsideRoot'));
    check('no colour is hardcoded', !/#[0-9a-fA-F]{6}/.test(html));

    const one = renderStatus({
      outcome: result({ worktreePath: '/w', diff: 'x', changedFiles: ['only.ts'] }),
      evidence: {}
    });
    check('one file is counted in the singular', one.includes('1 file changed'));

    const clean = renderStatus({
      outcome: result({ worktreePath: '/w', diff: '', changedFiles: [] }),
      evidence: { onToggleDiff: noop, onMerge: noop }
    });
    check('a sandbox that changed nothing still shows', clean.includes('aria-label="Sandbox"'));
    check('saying so', clean.includes('0 files changed'));
    check('with no diff to open', !clean.includes('aria-label="View diff"'));

    const opened = renderStatus({
      outcome: sandboxed,
      evidence: { expandedDiffs: { 'child-1': true }, onToggleDiff: noop }
    });
    check('an opened diff is rendered', opened.includes('aria-label="Sandbox diff"'));
    check('with the patch in it', opened.includes('assertInsideRoot'));
    check('additions tinted with the completed token', opened.includes('color:var(--color-state-completed)'));
    check('removals with the error token', opened.includes('color:var(--color-state-error)'));
    check('and the headers muted', opened.includes('color:var(--color-text-muted)'));
    check('it can be closed again', opened.includes('aria-label="Hide diff"'));
    check('in a monospace box', opened.includes('var(--font-family-mono)'));
    check('with no hardcoded colour', !/#[0-9a-fA-F]{6}/.test(opened));

    const long = renderStatus({
      outcome: result({
        worktreePath: '/w',
        diff: Array.from({ length: 500 }, (_, index) => `+ line ${index}`).join('\n'),
        changedFiles: ['big.ts']
      }),
      evidence: { expandedDiffs: { 'child-1': true }, onToggleDiff: noop }
    });
    check('a huge patch is bounded', long.includes('more lines'));
    check('and says how much is missing', long.includes(`${500 - status.MAX_DIFF_PREVIEW_LINES} more lines`));

    const confirming = renderStatus({
      outcome: sandboxed,
      evidence: { confirming: { 'child-1': 'MERGE' }, onMerge: noop, onDiscard: noop }
    });
    check('a merge asks a second time before it happens', confirming.includes('Confirm Merge'));
    check('while discarding is untouched by it', confirming.includes('Discard Sandbox'));

    const confirmingDiscard = renderStatus({
      outcome: sandboxed,
      evidence: { confirming: { 'child-1': 'DISCARD' }, onMerge: noop, onDiscard: noop }
    });
    check('and so does a discard', confirmingDiscard.includes('Confirm Discard'));

    const merging = renderStatus({
      outcome: sandboxed,
      evidence: { busy: { 'child-1': 'MERGING' }, onMerge: noop, onDiscard: noop }
    });
    check('a merge in flight is visible', merging.includes('Merging…'));
    check('and its button is spent', merging.includes('disabled=""'));

    const discarding = renderStatus({
      outcome: sandboxed,
      evidence: { busy: { 'child-1': 'DISCARDING' }, onMerge: noop, onDiscard: noop }
    });
    check('as is a discard', discarding.includes('Discarding…'));

    const refused = renderStatus({
      outcome: sandboxed,
      evidence: {
        onMerge: noop,
        notices: { 'child-1': { tone: 'error', message: 'The working tree has uncommitted changes.' } }
      }
    });
    check('a refused merge is shown on the card', refused.includes('uncommitted changes'));
    check('as an alert', refused.includes('role="alert"'));

    const kept = renderStatus({
      outcome: sandboxed,
      evidence: {
        onMerge: noop,
        notices: { 'child-1': { tone: 'success', message: 'Merged into the working branch.' } }
      }
    });
    check('and a merge that worked says so', kept.includes('Merged into the working branch.'));

    const readOnly = renderStatus({ outcome: sandboxed, evidence: {} });
    check('a card given no handlers offers no merge', !readOnly.includes('aria-label="Merge changes"'));
    check('nor a discard', !readOnly.includes('aria-label="Discard sandbox"'));
    check('but still says what changed', readOnly.includes('2 files changed'));
  }

  describe('DelegationBatchOutcomeCard — evidence per child');
  {
    const html = renderStatus({
      batchOutcome: batch({
        results: [
          result({
            childThreadId: 'child-a',
            role: 'Senior Backend Engineer',
            worktreePath: '/repo/.asterim/worktrees/child-a',
            diff: SANDBOX_DIFF,
            changedFiles: ['apps/server/src/routes/upload.ts'],
            verificationReport: report()
          }),
          result({
            childThreadId: 'child-b',
            role: 'Frontend Engineer',
            status: 'FAILED',
            worktreePath: '/repo/.asterim/worktrees/child-b',
            diff: SANDBOX_DIFF,
            changedFiles: ['apps/web/src/App.tsx'],
            verificationReport: failedReport()
          })
        ]
      }),
      evidence: {
        expandedSteps: { 'child-b': true },
        onToggleSteps: noop,
        onToggleDiff: noop,
        onMerge: noop,
        onDiscard: noop,
        onReverify: noop,
        onCopy: noop
      }
    });

    check('each child names its own sandbox', html.includes('Sandbox: asterim/sandbox/child-a') && html.includes('Sandbox: asterim/sandbox/child-b'));
    check('the one that passed says so', html.includes('4/4 verification steps passed'));
    check('and the one that failed says which step', html.includes('typecheck failed (exit 1)'));
    check('only the opened child shows its output', html.includes('error TS2345'));
    check('each keeps its own changed files', html.includes('apps/web/src/App.tsx'));
    check('every child can be merged on its own', (html.match(/aria-label="Merge changes"/g) || []).length === 2);
    check('and discarded on its own', (html.match(/aria-label="Discard sandbox"/g) || []).length === 2);
    check('with a re-run each', (html.match(/aria-label="Re-run verification"/g) || []).length === 2);
    check('no colour is hardcoded', !/#[0-9a-fA-F]{6}/.test(html));

    const plain = renderStatus({ batchOutcome: batch() });
    check('a fan-out that isolated nothing shows no sandbox panel', !plain.includes('aria-label="Sandbox"'));
    check('and no verification block', !plain.includes('aria-label="Verification evidence"'));
    check('while every child is still reported', plain.includes('Senior Backend Engineer'));
  }

  describe('sandbox and verification controls — the clicks themselves');
  {
    // The leaf views hold no state, so calling them returns the element tree
    // their buttons live in — the same trick the banner tests use.
    const callSandbox = (props: Record<string, unknown>) =>
      (status.SandboxEvidence as unknown as (props: unknown) => unknown)({
        childThreadId: 'child-1',
        worktreePath: '/repo/.asterim/worktrees/child-1',
        changes: { diff: SANDBOX_DIFF, changedFiles: ['upload.ts'] },
        ...props
      });

    let merged: string | null = null;
    let discarded: string | null = null;
    let toggledDiff: string | null = null;

    const panel = callSandbox({
      evidence: {
        onMerge: (childThreadId: string) => {
          merged = childThreadId;
        },
        onDiscard: (childThreadId: string) => {
          discarded = childThreadId;
        },
        onToggleDiff: (childThreadId: string) => {
          toggledDiff = childThreadId;
        }
      }
    });

    const mergeButton = findElement(panel, props => props['aria-label'] === 'Merge changes');
    check('the merge button is in the tree', !!mergeButton);
    equal('and is not already spent', mergeButton?.props?.disabled, false);
    (mergeButton?.props?.onClick as () => void)();
    equal('clicking it names the child whose sandbox it is', merged, 'child-1');

    const discardButton = findElement(panel, props => props['aria-label'] === 'Discard sandbox');
    (discardButton?.props?.onClick as () => void)();
    equal('as does discarding', discarded, 'child-1');

    const diffToggle = findElement(panel, props => props['aria-label'] === 'View diff');
    (diffToggle?.props?.onClick as () => void)();
    equal('and opening the diff', toggledDiff, 'child-1');

    const busyPanel = callSandbox({ evidence: { busy: { 'child-1': 'MERGING' }, onMerge: noop } });
    equal(
      'a merge already running cannot be asked for twice',
      findElement(busyPanel, props => props['aria-label'] === 'Merge changes')?.props?.disabled,
      true
    );

    let reverified: string | null = null;
    let toggledSteps: string | null = null;
    let copied: string | null = null;
    const verification = (status.VerificationEvidence as unknown as (props: unknown) => unknown)({
      childThreadId: 'child-1',
      report: failedReport(),
      evidence: {
        expandedSteps: { 'child-1': true },
        onReverify: (childThreadId: string) => {
          reverified = childThreadId;
        },
        onToggleSteps: (childThreadId: string) => {
          toggledSteps = childThreadId;
        },
        onCopy: (text: string) => {
          copied = text;
        }
      }
    });

    const reverifyButton = findElement(verification, props => props['aria-label'] === 'Re-run verification');
    check('the re-run control is in the tree', !!reverifyButton);
    (reverifyButton?.props?.onClick as () => void)();
    equal('and it names the thread to verify', reverified, 'child-1');

    const stepsToggle = findElement(verification, props => props['aria-label'] === 'Hide verification steps');
    (stepsToggle?.props?.onClick as () => void)();
    equal('the breakdown can be closed again', toggledSteps, 'child-1');

    const copyButton = findElement(verification, props => props['aria-label'] === 'Copy typecheck output');
    check('the failing step offers a copy', !!copyButton);
    (copyButton?.props?.onClick as () => void)();
    check('which hands over exactly what the step printed', String(copied).includes('error TS2345'));
  }

  // --- Views: the thread list ------------------------------------------------

  describe('ThreadTreeView — sandbox and verification badges (P8-03)');
  {
    const nodes = buildThreadTree([
      thread('root', { name: 'Payments refactor' }),
      thread('sandboxed', {
        name: 'Backend work',
        parent_thread_id: 'root',
        delegation_context_json: context({
          role: 'Senior Backend Engineer',
          status: 'COMPLETED',
          worktreePath: '/repo/.asterim/worktrees/sandboxed',
          worktreeBranch: 'asterim/sandbox/sandboxed'
        })
      }),
      thread('plain', {
        name: 'Review',
        parent_thread_id: 'root',
        delegation_context_json: context({ role: 'Security Auditor', status: 'COMPLETED' })
      })
    ]);

    equal(
      'a sandboxed child is recognised from its brief',
      tree.threadSandbox(nodes[0].children[0])?.branch,
      'asterim/sandbox/sandboxed'
    );
    equal('a reviewer that got none is not', tree.threadSandbox(nodes[0].children[1]), null);
    equal('and neither is a root thread', tree.threadSandbox(nodes[0]), null);
    equal(
      'the thread row itself is read when the brief is silent',
      tree.threadSandbox(
        buildThreadTree([thread('t', { worktree_path: '/repo/.asterim/worktrees/t' })])[0]
      )?.path,
      '/repo/.asterim/worktrees/t'
    );

    const html = renderTree({
      nodes,
      activeThreadId: null,
      verificationReports: { sandboxed: report(), plain: failedReport() }
    });
    check('the sandboxed row is badged', html.includes('>sandbox<'));
    check('and says where it is isolated', html.includes('Isolated in asterim/sandbox/sandboxed'));
    check('a verified row carries a tick', html.includes('4/4 verification steps passed (1.2s)'));
    check('a failed one carries the reason', html.includes('typecheck failed (exit 1)'));
    check('exactly one row is badged as a sandbox', (html.match(/>sandbox</g) || []).length === 1);
    check('no colour is hardcoded', !/#[0-9a-fA-F]{6}/.test(html));

    const bare = renderTree({ nodes, activeThreadId: null });
    check('a tree with no reports badges nothing about verification', !bare.includes('verification steps passed'));
    check('but still badges the sandbox', bare.includes('>sandbox<'));
    check('and still names the role', bare.includes('Senior Backend Engineer'));

    const nested = renderTree({
      nodes: buildThreadTree([
        thread('root'),
        thread('mid', { parent_thread_id: 'root', delegation_context_json: context() }),
        thread('deep', {
          parent_thread_id: 'mid',
          delegation_context_json: context({
            parentThreadId: 'mid',
            depth: 2,
            worktreePath: '/repo/.asterim/worktrees/deep'
          })
        })
      ]),
      activeThreadId: null,
      verificationReports: { deep: report() }
    });
    check('a grandchild’s badges reach it too', nested.includes('>sandbox<'));
    check('reports included', nested.includes('verification steps passed'));
  }

  // --- The delegate form's Phase 8 switches ---------------------------------

  describe('defaultSandboxOptions / applySandboxOption');
  {
    equal('a task is isolated by default', modal.defaultSandboxOptions('TASK').isolateWorktree, true);
    equal('and verified in that sandbox', modal.defaultSandboxOptions('TASK').verifyPipeline, true);
    equal('a batch is too', modal.defaultSandboxOptions('PARALLEL').isolateWorktree, true);
    equal('a review changes nothing, so it is not isolated', modal.defaultSandboxOptions('REVIEW').isolateWorktree, false);
    equal('nor verified', modal.defaultSandboxOptions('REVIEW').verifyPipeline, false);

    const both = modal.defaultSandboxOptions('TASK');
    equal(
      'turning isolation off takes verification with it',
      modal.applySandboxOption(both, { isolateWorktree: false }),
      { isolateWorktree: false, verifyPipeline: false }
    );
    equal(
      'verification can be turned off on its own',
      modal.applySandboxOption(both, { verifyPipeline: false }),
      { isolateWorktree: true, verifyPipeline: false }
    );
    equal(
      'and asking for it without a sandbox is refused',
      modal.applySandboxOption({ isolateWorktree: false, verifyPipeline: false }, { verifyPipeline: true }),
      { isolateWorktree: false, verifyPipeline: false }
    );
    equal(
      'turning isolation back on does not silently re-arm the pipeline',
      modal.applySandboxOption({ isolateWorktree: false, verifyPipeline: false }, { isolateWorktree: true }),
      { isolateWorktree: true, verifyPipeline: false }
    );
  }

  describe('DelegateModalView — sandbox switches');
  {
    const html = renderModal({ task: 'Add rate limiting.' });
    check('the switches are grouped', html.includes('aria-label="Sandbox options"'));
    check('isolation is offered', html.includes('aria-label="Isolate in Git worktree"'));
    check('and named in the operator’s words', html.includes('Isolate in Git Worktree'));
    check('with what it means', html.includes('Nothing touches your working tree until you merge it.'));
    check('verification is offered', html.includes('aria-label="Run verification pipeline"'));
    check('and named', html.includes('Run Verification Pipeline'));
    check('saying what will be run', html.includes('typecheck, lint, test and build'));
    check('both are on for a task', (html.match(/checked=""/g) || []).length === 2);
    check('and nothing on the form is refused', !html.includes('disabled=""'));
    check('no colour is hardcoded', !/#[0-9a-fA-F]{6}/.test(html));

    const noSandbox = renderModal({ task: 'x', isolateWorktree: false, verifyPipeline: false });
    check('with no sandbox nothing is checked', !noSandbox.includes('checked=""'));
    check('verification cannot be asked for', noSandbox.includes('disabled=""'));
    check('and says why', noSandbox.includes('Needs a sandbox'));

    const reviewForm = renderModal({ mode: 'REVIEW', context: 'diff --git a b', isolateWorktree: false, verifyPipeline: false });
    check('a review is offered the same switches', reviewForm.includes('aria-label="Isolate in Git worktree"'));
    check('turned off', !reviewForm.includes('checked=""'));

    const batchForm = renderModal({
      mode: 'PARALLEL',
      parallelItems: modal.defaultParallelItems(),
      onAddParallelItem: noop
    });
    check('a batch gets them too', batchForm.includes('aria-label="Sandbox options"'));
    check('with a sandbox each', batchForm.includes('checked=""'));

    // The switches themselves, through the props-only view.
    const patches: { isolate?: boolean; verify?: boolean }[] = [];
    const rendered = (modal.DelegateModalView as unknown as (props: unknown) => unknown)({
      profiles: [],
      mode: 'TASK',
      onModeChange: noop,
      profileId: '',
      onProfileChange: noop,
      task: 'x',
      onTaskChange: noop,
      context: '',
      onContextChange: noop,
      onSubmit: noop,
      onClose: noop,
      isolateWorktree: true,
      verifyPipeline: true,
      onIsolateWorktreeChange: (isolate: boolean) => patches.push({ isolate }),
      onVerifyPipelineChange: (verify: boolean) => patches.push({ verify })
    });

    const isolateBox = findElement(rendered, props => props['aria-label'] === 'Isolate in Git worktree');
    check('the isolation switch is in the tree', !!isolateBox);
    equal('and is on', isolateBox?.props?.checked, true);
    (isolateBox?.props?.onChange as (event: unknown) => void)({ target: { checked: false } });
    equal('turning it off is reported', patches[patches.length - 1], { isolate: false });

    const verifyBox = findElement(rendered, props => props['aria-label'] === 'Run verification pipeline');
    equal('the verification switch is on alongside it', verifyBox?.props?.checked, true);
    equal('and is available while there is a sandbox', verifyBox?.props?.disabled, false);
    (verifyBox?.props?.onChange as (event: unknown) => void)({ target: { checked: false } });
    equal('turning it off is reported too', patches[patches.length - 1], { verify: false });

    const withoutSandbox = (modal.DelegateModalView as unknown as (props: unknown) => unknown)({
      profiles: [],
      mode: 'TASK',
      onModeChange: noop,
      profileId: '',
      onProfileChange: noop,
      task: 'x',
      onTaskChange: noop,
      context: '',
      onContextChange: noop,
      onSubmit: noop,
      onClose: noop,
      isolateWorktree: false,
      verifyPipeline: false
    });
    equal(
      'without a sandbox verification cannot be switched on',
      findElement(withoutSandbox, props => props['aria-label'] === 'Run verification pipeline')?.props?.disabled,
      true
    );
  }

  describe('buildDelegationBody / buildParallelDelegationBody — the switches');
  {
    const body = modal.buildDelegationBody('TASK', {
      task: 'Add rate limiting.',
      context: '',
      isolateWorktree: true,
      verifyPipeline: true
    });
    equal('a task asks for a sandbox', body.isolateWorktree, true);
    equal('and for the pipeline', body.verifyPipeline, true);

    const off = modal.buildDelegationBody('TASK', {
      task: 'x',
      context: '',
      isolateWorktree: false,
      verifyPipeline: false
    });
    equal('turning them off is stated rather than omitted', off.isolateWorktree, false);
    equal('for both', off.verifyPipeline, false);

    const untouched = modal.buildDelegationBody('TASK', { task: 'x', context: '' });
    equal('a form that says nothing sends nothing', untouched.isolateWorktree, undefined);
    equal('so the Core keeps its own default', untouched.verifyPipeline, undefined);

    const reviewBody = modal.buildDelegationBody('REVIEW', {
      task: '',
      context: 'diff --git a b',
      isolateWorktree: false,
      verifyPipeline: false
    });
    equal('a review carries them as well', reviewBody.isolateWorktree, false);
    equal('and is still a review', reviewBody.kind, 'REVIEW');

    const rows = modal.defaultParallelItems();
    const filled = modal.updateParallelItem(
      modal.updateParallelItem(rows, rows[0].id, { task: 'Add the endpoint.' }),
      rows[1].id,
      { task: 'Test it.' }
    );
    const batchBody = modal.buildParallelDelegationBody(filled, {
      isolateWorktree: true,
      verifyPipeline: true
    }) as { delegations: Record<string, unknown>[] };
    equal('every subagent of a batch gets a sandbox', batchBody.delegations.map(row => row.isolateWorktree), [true, true]);
    equal('and is verified in it', batchBody.delegations.map(row => row.verifyPipeline), [true, true]);

    const silentBatch = modal.buildParallelDelegationBody(filled) as {
      delegations: Record<string, unknown>[];
    };
    equal('a batch composed without options states nothing', silentBatch.delegations[0].isolateWorktree, undefined);
    equal('leaving the Core’s defaults alone', silentBatch.delegations[0].verifyPipeline, undefined);
    equal('while still carrying the work', silentBatch.delegations[0].taskDescription, 'Add the endpoint.');
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
