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
import type {
  AgentProfile,
  DelegationChildSummary,
  DelegationContext,
  DelegationResult
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
    equal('all four event names are known', DELEGATION_EVENT_TYPES.length, 4);
    check('started is one of ours', isDelegationEvent({ type: 'delegation.started' }));
    check('parent_state is one of ours', isDelegationEvent({ type: 'delegation.parent_state' }));
    check('child_state is one of ours', isDelegationEvent({ type: 'delegation.child_state' }));
    check('completed is one of ours', isDelegationEvent({ type: 'delegation.completed' }));
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
    equal('behind the named child', state.pendingChildren['root'], 'child-1');

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
    equal('as does the pending child', synced.pendingChildren['root'], 'child-9');
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
      pendingChildThreadId: 'child-1',
      pendingChildRole: 'Security Auditor',
      pendingChildState: 'ACTIVE',
      pendingChildTask: 'Review the upload route for path traversal.'
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
      pendingChildThreadId: 'child-1',
      pendingChildRole: 'Security Auditor',
      pendingChildState: 'ACTIVE' as const,
      pendingChildTask: 'Review the upload route.'
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

    const cancelling = renderStatus({ ...waiting, onCancel: noop, isCancelling: true });
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
      childThreadId: 'child-1',
      role: 'Security Auditor',
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
      pendingChildThreadId: 'child-2',
      outcome: result()
    });
    check('a new delegation takes precedence over the last outcome', both.includes('Inspect Child Thread'));
    check('and the old card is not also shown', !both.includes('Open Transcript'));
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
