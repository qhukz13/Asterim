/**
 * Tests for the Collaborative Team Agent UI (P8-02, DEC-031).
 *
 * Four layers, matching the convention the delegation, profiles, environment
 * and desktop suites established:
 *
 *   1. Pure helpers — the queue reducer above all. `applyTurnEventToQueue` is
 *      what every member's sense of "whose turn is it, and where am I" is
 *      rebuilt from between fetches, and it is the one piece of this feature
 *      where being subtly wrong is invisible until two people are waiting on
 *      a turn that already finished. It is asserted here without a socket.
 *   2. `useTeamAgentStore` against a recording `fetch`, so the exact URLs,
 *      verbs, headers and bodies are asserted. Two of those matter more than
 *      the rest: `POST /turns` must be treated as 202-and-queued rather than
 *      as a completed request, and it must not carry an author — in a shared
 *      thread the name on a turn is what the whole team reads, so the Core
 *      takes it from the session.
 *   3. The four `team_turn:*` transitions routed through `handleTeamTurnEvent`,
 *      which is exactly what the socket layer calls.
 *   4. Real rendering through `react-dom/server`, driving the props-only views
 *      across idle, processing and awaiting-approval queues, populated and
 *      empty transcripts, and the explorer's loaded, empty and no-team states.
 *
 * What it does NOT cover: click handlers, which need an event loop and a DOM
 * the repository does not have. Each connected container is a thin wrapper over
 * a view and the store, both of which are covered directly.
 *
 * Run:  pnpm --filter @asterim/web exec tsx src/components/teamAgents/__tests__/TeamAgentUI.test.ts
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TEAM_TURN_CANCELLED_EVENT,
  TEAM_TURN_COMPLETED_EVENT,
  TEAM_TURN_QUEUED_EVENT,
  TEAM_TURN_STARTED_EVENT
} from '@asterim/shared';
import type {
  TeamAgent,
  TeamAgentMessage,
  TeamThread,
  TeamThreadTurnState,
  TeamTurnEventPayload,
  TeamTurnQueueItem,
  TeamTurnQueueState,
  TeamTurnStatus
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

type StoreModule = typeof import('../../../stores/useTeamAgentStore');
type InspectorModule = typeof import('../ActiveTurnQueueInspector');
type ChatModule = typeof import('../TeamThreadChatView');
type ExplorerModule = typeof import('../TeamAgentExplorer');
type ModalModule = typeof import('../CreateTeamAgentModal');

let storeMod: StoreModule;
let inspector: InspectorModule;
let chat: ChatModule;
let explorer: ExplorerModule;
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

const NOW = 1_700_000_000_000;

function agentFixture(overrides: Partial<TeamAgent> = {}): TeamAgent {
  return {
    id: 'tagent_1',
    teamId: 'team_1',
    name: 'Security Reviewer',
    role: 'security-reviewer',
    description: 'Reads changes for security defects before they are merged.',
    systemPrompt: 'You review changes for security defects and say what you would not merge.',
    model: 'claude-opus-5',
    enabledMcpServers: ['github'],
    enabledSkills: [],
    createdAt: NOW - 86_400_000,
    updatedAt: NOW - 86_400_000,
    ...overrides
  };
}

function threadFixture(overrides: Partial<TeamThread> = {}): TeamThread {
  return {
    id: 'tthread_1',
    teamAgentId: 'tagent_1',
    projectId: 'proj_1',
    title: 'Release 2.4 review',
    status: 'IDLE',
    createdAt: NOW - 3_600_000,
    updatedAt: NOW - 3_600_000,
    ...overrides
  };
}

function turnFixture(overrides: Partial<TeamTurnQueueItem> = {}): TeamTurnQueueItem {
  return {
    id: 'turn_1',
    teamThreadId: 'tthread_1',
    userId: 'user_ada',
    userName: 'Ada Lovelace',
    instruction: 'Review the auth middleware change.',
    status: 'QUEUED',
    queuedAt: NOW - 120_000,
    ...overrides
  };
}

function messageFixture(overrides: Partial<TeamAgentMessage> = {}): TeamAgentMessage {
  return {
    id: 'msg_1',
    teamThreadId: 'tthread_1',
    userId: 'user_ada',
    userName: 'Ada Lovelace',
    role: 'user',
    content: 'Review the auth middleware change.',
    createdAt: NOW - 120_000,
    ...overrides
  };
}

function queueFixture(overrides: Partial<TeamTurnQueueState> = {}): TeamTurnQueueState {
  return {
    threadId: 'tthread_1',
    state: 'IDLE',
    activeTurn: null,
    queuedTurns: [],
    ...overrides
  };
}

function eventFixture(
  turn: TeamTurnQueueItem,
  state: TeamThreadTurnState,
  overrides: Partial<TeamTurnEventPayload> = {}
): TeamTurnEventPayload {
  return {
    teamThreadId: turn.teamThreadId,
    teamAgentId: 'tagent_1',
    teamId: 'team_1',
    workspaceId: 'team_1',
    projectId: 'proj_1',
    turn,
    state,
    queuePosition: 0,
    queueLength: 0,
    ...overrides
  };
}

const noop = () => undefined;

/** Puts the store back to the state a fresh mount would see. */
function resetStore(): void {
  storeMod.useTeamAgentStore.getState().reset();
  requests.length = 0;
  responseQueue.length = 0;
  nextResponse = { status: 200, body: {} };
  nextNetworkError = null;
}

function renderInspector(
  props: Partial<Parameters<typeof inspector.ActiveTurnQueueInspectorView>[0]> = {}
): string {
  return renderToStaticMarkup(
    React.createElement(inspector.ActiveTurnQueueInspectorView, {
      queue: null,
      now: NOW,
      ...props
    })
  );
}

function renderChat(props: Partial<Parameters<typeof chat.TeamThreadChatView>[0]> = {}): string {
  return renderToStaticMarkup(
    React.createElement(chat.TeamThreadChatView, {
      thread: threadFixture(),
      agent: agentFixture(),
      transcript: [],
      queue: null,
      instruction: '',
      onInstructionChange: noop,
      onSubmit: noop,
      now: NOW,
      ...props
    })
  );
}

function renderExplorer(
  props: Partial<Parameters<typeof explorer.TeamAgentExplorerView>[0]> = {}
): string {
  return renderToStaticMarkup(
    React.createElement(explorer.TeamAgentExplorerView, {
      agents: [agentFixture()],
      threadsByAgent: {},
      search: '',
      onSearch: noop,
      teamId: 'team_1',
      ...props
    })
  );
}

function renderModal(props: Partial<Parameters<typeof modal.CreateTeamAgentModalView>[0]> = {}): string {
  return renderToStaticMarkup(
    React.createElement(modal.CreateTeamAgentModalView, {
      draft: modal.emptyTeamAgentDraft(),
      onDraftChange: noop,
      onSubmit: noop,
      onClose: noop,
      ...props
    })
  );
}

async function main(): Promise<void> {
  storeMod = await import('../../../stores/useTeamAgentStore');
  inspector = await import('../ActiveTurnQueueInspector');
  chat = await import('../TeamThreadChatView');
  explorer = await import('../TeamAgentExplorer');
  modal = await import('../CreateTeamAgentModal');

  const {
    useTeamAgentStore,
    handleTeamTurnEvent,
    isTeamTurnEvent,
    applyTurnEventToQueue,
    describeTeamAgentError,
    filterTeamAgents,
    threadStateTone,
    turnStatusLabel,
    queuePositionLabel,
    pendingTurnCount,
    queueWaitNotice,
    activeOperator,
    canSubmitTurn,
    canCancelTurn,
    authorInitials,
    messageAuthorLabel,
    systemPromptPreview,
    formatRelativeTime,
    TEAM_TURN_EVENT_TYPES
  } = storeMod;

  // --- 1. Pure helpers -------------------------------------------------------

  describe('describeTeamAgentError names the two 409s apart');
  {
    equal(
      'a turn already running cannot be withdrawn',
      describeTeamAgentError('nope', 409, 'TURN_NOT_CANCELLABLE'),
      'That turn is already running, so it can no longer be withdrawn.'
    );
    check(
      'a thread with no project says what is missing',
      describeTeamAgentError('nope', 409, 'NO_PROJECT_BOUND').includes('not bound to a project')
    );
    check(
      'a 401 tells the member to sign in',
      describeTeamAgentError(undefined, 401).includes('Sign in')
    );
    equal(
      'a 403 keeps the Core’s own wording',
      describeTeamAgentError('Only admins may do that.', 403),
      'Only admins may do that.'
    );
    check(
      'a 404 is about the thing not existing',
      describeTeamAgentError(undefined, 404).includes('no longer exists')
    );
    equal(
      'a 400 is passed through verbatim',
      describeTeamAgentError('teamId is required.', 400),
      'teamId is required.'
    );
    equal('and a bare failure still says something', describeTeamAgentError(undefined), 'The request failed.');
  }

  describe('filterTeamAgents searches the three fields a member would');
  {
    const agents = [
      agentFixture(),
      agentFixture({ id: 'tagent_2', name: 'Tech Lead', role: 'tech-lead', description: 'Plans the work.' })
    ];
    equal('an empty search is every agent', filterTeamAgents(agents, '').length, 2);
    equal('whitespace is not a search', filterTeamAgents(agents, '   ').length, 2);
    equal('by name', filterTeamAgents(agents, 'tech').map(a => a.id), ['tagent_2']);
    equal('by role', filterTeamAgents(agents, 'security-rev').map(a => a.id), ['tagent_1']);
    equal('by description', filterTeamAgents(agents, 'plans').map(a => a.id), ['tagent_2']);
    equal('case does not matter', filterTeamAgents(agents, 'TECH LEAD').map(a => a.id), ['tagent_2']);
    equal('and a miss is empty, not everything', filterTeamAgents(agents, 'zzz').length, 0);
  }

  describe('threadStateTone keeps AWAITING_APPROVAL distinct from PROCESSING_TURN');
  {
    equal('idle', threadStateTone('IDLE').label, 'Idle');
    equal('processing', threadStateTone('PROCESSING_TURN').label, 'Processing turn');
    equal('awaiting approval', threadStateTone('AWAITING_APPROVAL').label, 'Awaiting approval');
    check(
      'the two busy states do not share a colour',
      threadStateTone('PROCESSING_TURN').color !== threadStateTone('AWAITING_APPROVAL').color
    );
    check(
      'and neither is the idle colour',
      threadStateTone('IDLE').color !== threadStateTone('PROCESSING_TURN').color &&
        threadStateTone('IDLE').color !== threadStateTone('AWAITING_APPROVAL').color
    );
    check(
      'every tone is a design token, not a hex value',
      (['IDLE', 'PROCESSING_TURN', 'AWAITING_APPROVAL'] as TeamThreadTurnState[]).every(
        state => !threadStateTone(state).color.includes('#')
      )
    );
  }

  describe('turnStatusLabel covers every status the contract has');
  {
    const statuses: TeamTurnStatus[] = [
      'QUEUED',
      'PROCESSING',
      'AWAITING_APPROVAL',
      'COMPLETED',
      'FAILED',
      'CANCELLED'
    ];
    equal(
      'each reads as words',
      statuses.map(turnStatusLabel),
      ['Queued', 'Running', 'Awaiting approval', 'Completed', 'Failed', 'Cancelled']
    );
    check('and none repeat', new Set(statuses.map(turnStatusLabel)).size === statuses.length);
  }

  describe('queuePositionLabel is one-based, because #0 means nothing');
  {
    equal('the head of the waiting list', queuePositionLabel(0), '#1 in queue');
    equal('the one behind it', queuePositionLabel(1), '#2 in queue');
  }

  describe('queueWaitNotice tells a member what they are about to join');
  {
    equal('an idle thread promises nothing', queueWaitNotice(queueFixture()), null);
    equal('and neither does a missing queue', queueWaitNotice(null), null);
    equal(
      'a busy thread with nobody waiting says the turn runs next',
      queueWaitNotice(
        queueFixture({ state: 'PROCESSING_TURN', activeTurn: turnFixture({ status: 'PROCESSING' }) })
      ),
      'Ada Lovelace is being served; your turn would run next.'
    );
    equal(
      'one waiting turn is singular',
      queueWaitNotice(
        queueFixture({
          state: 'PROCESSING_TURN',
          activeTurn: turnFixture({ status: 'PROCESSING' }),
          queuedTurns: [turnFixture({ id: 'turn_2' })]
        })
      ),
      'Ada Lovelace is being served, with 1 turn already waiting.'
    );
    check(
      'and two are plural',
      (queueWaitNotice(
        queueFixture({
          state: 'PROCESSING_TURN',
          activeTurn: turnFixture({ status: 'PROCESSING' }),
          queuedTurns: [turnFixture({ id: 'turn_2' }), turnFixture({ id: 'turn_3' })]
        })
      ) || '').includes('2 turns already waiting')
    );
    equal('pendingTurnCount ignores the active turn', pendingTurnCount(
      queueFixture({ activeTurn: turnFixture(), queuedTurns: [turnFixture({ id: 'turn_2' })] })
    ), 1);
    equal('and a missing queue is zero, not undefined', pendingTurnCount(null), 0);
  }

  describe('activeOperator answers "who has it"');
  {
    equal('nobody, on an idle thread', activeOperator(queueFixture()), null);
    const active = turnFixture({ status: 'PROCESSING', startedAt: NOW - 60_000 });
    equal(
      'the holder of the lock, by name',
      activeOperator(queueFixture({ state: 'PROCESSING_TURN', activeTurn: active }))?.userName,
      'Ada Lovelace'
    );
    equal(
      'and when they started',
      activeOperator(queueFixture({ state: 'PROCESSING_TURN', activeTurn: active }))?.startedAt,
      NOW - 60_000
    );
  }

  describe('canSubmitTurn and canCancelTurn refuse what the Core would refuse');
  {
    check('an empty instruction is not submittable', !canSubmitTurn('   ', false));
    check('nor is one while a submission is in flight', !canSubmitTurn('do it', true));
    check('a typed instruction is', canSubmitTurn('do it', false));
    check('a queued turn can be withdrawn', canCancelTurn(turnFixture()));
    check(
      'a running one cannot — the Core answers 409',
      !canCancelTurn(turnFixture({ status: 'PROCESSING' }))
    );
    check(
      'nor can one parked on an approval, which still holds the lock',
      !canCancelTurn(turnFixture({ status: 'AWAITING_APPROVAL' }))
    );
    check('nor a completed one', !canCancelTurn(turnFixture({ status: 'COMPLETED' })));
  }

  describe('authorInitials and messageAuthorLabel attribute every line');
  {
    equal('two names give two initials', authorInitials('Ada Lovelace'), 'AL');
    equal('one name gives two letters of it', authorInitials('ada'), 'AD');
    equal('a dotted login is split too', authorInitials('ada.lovelace'), 'AL');
    equal('three names use the first and last', authorInitials('Ada B Lovelace'), 'AL');
    equal('a missing name is not blank', authorInitials(undefined), '??');
    equal('nor is an empty one', authorInitials('   '), '??');

    equal(
      'a user line is attributed to the person',
      messageAuthorLabel(messageFixture(), 'Security Reviewer'),
      'Ada Lovelace'
    );
    equal(
      'a line with only an id still names something',
      messageAuthorLabel(messageFixture({ userName: undefined }), 'Security Reviewer'),
      'user_ada'
    );
    equal(
      'the agent’s line is attributed to the role, not a person',
      messageAuthorLabel(messageFixture({ role: 'assistant', userId: undefined, userName: undefined }), 'Security Reviewer'),
      'Security Reviewer'
    );
    equal(
      'and a system line says so',
      messageAuthorLabel(messageFixture({ role: 'system' })),
      'System'
    );
  }

  describe('systemPromptPreview shows the role without cutting mid-word');
  {
    equal('a short prompt is untouched', systemPromptPreview('Be terse.'), 'Be terse.');
    equal('newlines collapse to spaces', systemPromptPreview('one\n\ntwo'), 'one two');
    const long = 'word '.repeat(60);
    const preview = systemPromptPreview(long, 40);
    check('a long prompt is cut', preview.length <= 41);
    check('with an ellipsis', preview.endsWith('…'));
    check('and not mid-word', !preview.includes('wo…'));
  }

  describe('formatRelativeTime, with the clock passed in');
  {
    equal('a moment ago', formatRelativeTime(NOW - 5_000, NOW), 'just now');
    equal('minutes', formatRelativeTime(NOW - 5 * 60_000, NOW), '5m ago');
    equal('hours', formatRelativeTime(NOW - 3 * 3_600_000, NOW), '3h ago');
    equal('days', formatRelativeTime(NOW - 2 * 86_400_000, NOW), '2d ago');
    equal('a future timestamp does not read as negative', formatRelativeTime(NOW + 10_000, NOW), 'just now');
  }

  // --- 2. The queue reducer --------------------------------------------------

  describe('applyTurnEventToQueue rebuilds the queue from transitions');
  {
    const ada = turnFixture();
    const grace = turnFixture({ id: 'turn_2', userId: 'user_grace', userName: 'Grace Hopper' });

    let queue = applyTurnEventToQueue(null, TEAM_TURN_QUEUED_EVENT, eventFixture(ada, 'IDLE'));
    equal('a first queued turn starts the queue', queue.queuedTurns.map(t => t.id), ['turn_1']);
    equal('and the thread id comes from the event', queue.threadId, 'tthread_1');

    queue = applyTurnEventToQueue(queue, TEAM_TURN_QUEUED_EVENT, eventFixture(grace, 'PROCESSING_TURN'));
    equal('a second joins behind it', queue.queuedTurns.map(t => t.id), ['turn_1', 'turn_2']);

    queue = applyTurnEventToQueue(queue, TEAM_TURN_QUEUED_EVENT, eventFixture(ada, 'PROCESSING_TURN'));
    equal(
      'a repeated queued event does not duplicate the turn',
      queue.queuedTurns.map(t => t.id),
      ['turn_1', 'turn_2']
    );

    queue = applyTurnEventToQueue(
      queue,
      TEAM_TURN_STARTED_EVENT,
      eventFixture({ ...ada, status: 'PROCESSING', startedAt: NOW }, 'PROCESSING_TURN')
    );
    equal('starting promotes the turn to active', queue.activeTurn?.id, 'turn_1');
    equal('and takes it out of the waiting list', queue.queuedTurns.map(t => t.id), ['turn_2']);
    equal('the thread is processing', queue.state, 'PROCESSING_TURN');

    queue = applyTurnEventToQueue(
      queue,
      TEAM_TURN_STARTED_EVENT,
      eventFixture({ ...ada, status: 'AWAITING_APPROVAL' }, 'AWAITING_APPROVAL')
    );
    equal('parking on an approval re-emits started, and stays the same turn', queue.activeTurn?.id, 'turn_1');
    equal('with the thread now awaiting approval', queue.state, 'AWAITING_APPROVAL');
    equal('and nobody promoted behind it', queue.queuedTurns.map(t => t.id), ['turn_2']);

    const stale = applyTurnEventToQueue(
      queue,
      TEAM_TURN_COMPLETED_EVENT,
      eventFixture({ ...grace, status: 'COMPLETED' }, 'AWAITING_APPROVAL')
    );
    equal(
      'a completion naming a turn that is not active does not free the lock',
      stale.activeTurn?.id,
      'turn_1'
    );

    queue = applyTurnEventToQueue(
      queue,
      TEAM_TURN_COMPLETED_EVENT,
      eventFixture({ ...ada, status: 'COMPLETED', completedAt: NOW }, 'IDLE')
    );
    equal('a completion naming the active turn clears it', queue.activeTurn, null);
    equal('the thread goes idle', queue.state, 'IDLE');
    equal('and the turn behind it is still waiting', queue.queuedTurns.map(t => t.id), ['turn_2']);

    queue = applyTurnEventToQueue(
      queue,
      TEAM_TURN_CANCELLED_EVENT,
      eventFixture({ ...grace, status: 'CANCELLED' }, 'IDLE')
    );
    equal('cancelling removes a waiting turn', queue.queuedTurns.length, 0);
    equal('and leaves the thread idle', queue.state, 'IDLE');

    const untouched = applyTurnEventToQueue(queue, 'chat.message', eventFixture(ada, 'IDLE'));
    equal('an unrelated event changes nothing', untouched, queue);
  }

  // --- 3. Store REST behaviour ----------------------------------------------

  describe('fetchTeamAgents asks for one team, by id');
  {
    resetStore();
    nextResponse = { status: 200, body: { agents: [agentFixture()] } };
    await useTeamAgentStore.getState().fetchTeamAgents('team one');
    equal('the URL carries the team, encoded', requests[0].url, '/api/v1/team-agents?teamId=team%20one');
    equal('as a read', requests[0].method, 'GET');
    equal('authenticated', requests[0].headers.Authorization, 'Bearer test-token');
    equal('and the list is adopted', useTeamAgentStore.getState().teamAgents.length, 1);
    check('with nothing loading afterwards', !useTeamAgentStore.getState().isLoading);

    nextResponse = { status: 401, body: { error: 'Unauthorized' } };
    await useTeamAgentStore.getState().fetchTeamAgents('team_1');
    check('a 401 is reported', (useTeamAgentStore.getState().error || '').includes('Sign in'));
    equal(
      'and the list already on screen is left alone',
      useTeamAgentStore.getState().teamAgents.length,
      1
    );

    resetStore();
    nextNetworkError = 'fetch failed';
    await useTeamAgentStore.getState().fetchTeamAgents('team_1');
    equal('an unreachable Core is reported as such', useTeamAgentStore.getState().error, 'fetch failed');
    check('and does not leave the panel loading forever', !useTeamAgentStore.getState().isLoading);
  }

  describe('fetchTeamAgent brings the threads the list endpoint does not carry');
  {
    resetStore();
    nextResponse = {
      status: 200,
      body: { agent: agentFixture(), threads: [threadFixture(), threadFixture({ id: 'tthread_2' })] }
    };
    await useTeamAgentStore.getState().fetchTeamAgent('tagent_1');
    equal('one agent, by id', requests[0].url, '/api/v1/team-agents/tagent_1');
    equal('its threads are stored under it', useTeamAgentStore.getState().teamThreads['tagent_1'].length, 2);
    equal('and the agent itself is adopted', useTeamAgentStore.getState().teamAgents[0].id, 'tagent_1');
  }

  describe('createTeamAgent posts the whole role');
  {
    resetStore();
    nextResponse = { status: 201, body: { agent: agentFixture({ id: 'tagent_new' }) } };
    const created = await useTeamAgentStore.getState().createTeamAgent({
      teamId: 'team_1',
      name: 'Security Reviewer',
      role: 'security-reviewer',
      systemPrompt: 'Review changes.'
    });
    equal('to the collection', requests[0].url, '/api/v1/team-agents');
    equal('as a POST', requests[0].method, 'POST');
    equal('with a JSON content type', requests[0].headers['Content-Type'], 'application/json');
    equal('carrying the team', (requests[0].body as { teamId: string }).teamId, 'team_1');
    equal('and the prompt', (requests[0].body as { systemPrompt: string }).systemPrompt, 'Review changes.');
    equal('the created agent comes back', created?.id, 'tagent_new');
    equal('and joins the list', useTeamAgentStore.getState().teamAgents.length, 1);
    check(
      'with a notice that says it is shared',
      (useTeamAgentStore.getState().notice || '').includes('everyone on the team')
    );

    nextResponse = { status: 400, body: { error: 'systemPrompt is required.', code: 'INVALID_INPUT' } };
    const refused = await useTeamAgentStore.getState().createTeamAgent({
      teamId: 'team_1',
      name: 'x',
      role: 'x',
      systemPrompt: ''
    });
    equal('a refusal returns nothing', refused, null);
    equal('reports the Core’s reason', useTeamAgentStore.getState().error, 'systemPrompt is required.');
    check('and stops saving', !useTeamAgentStore.getState().isSaving);
    equal('without adding a phantom agent', useTeamAgentStore.getState().teamAgents.length, 1);
  }

  describe('updateTeamAgent patches in place');
  {
    resetStore();
    useTeamAgentStore.setState({ teamAgents: [agentFixture()] });
    nextResponse = { status: 200, body: { agent: agentFixture({ name: 'Sec Reviewer' }) } };
    await useTeamAgentStore.getState().updateTeamAgent('tagent_1', { name: 'Sec Reviewer' });
    equal('at the agent’s own URL', requests[0].url, '/api/v1/team-agents/tagent_1');
    equal('with PATCH', requests[0].method, 'PATCH');
    equal('carrying only what changed', requests[0].body, { name: 'Sec Reviewer' });
    equal('and the list holds the new copy', useTeamAgentStore.getState().teamAgents[0].name, 'Sec Reviewer');
    equal('rather than a second one', useTeamAgentStore.getState().teamAgents.length, 1);
  }

  describe('deleteTeamAgent takes its threads with it');
  {
    resetStore();
    useTeamAgentStore.setState({
      teamAgents: [agentFixture()],
      teamThreads: { tagent_1: [threadFixture()] },
      activeAgentId: 'tagent_1',
      activeThread: threadFixture(),
      activeTranscript: [messageFixture()],
      activeQueueState: queueFixture(),
      turnHistory: [turnFixture()]
    });
    nextResponse = { status: 200, body: { deleted: true, id: 'tagent_1' } };
    const removed = await useTeamAgentStore.getState().deleteTeamAgent('tagent_1');
    equal('with DELETE', requests[0].method, 'DELETE');
    equal('at the agent’s URL', requests[0].url, '/api/v1/team-agents/tagent_1');
    check('and it reports success', removed);
    equal('the agent is gone', useTeamAgentStore.getState().teamAgents.length, 0);
    equal('so are its threads', useTeamAgentStore.getState().teamThreads['tagent_1'], undefined);
    equal(
      'and the open thread is closed rather than left pointing at nothing',
      useTeamAgentStore.getState().activeThread,
      null
    );
    equal('with its transcript cleared', useTeamAgentStore.getState().activeTranscript.length, 0);
  }

  describe('fetchTeamThread loads a transcript, its queue and its history');
  {
    resetStore();
    nextResponse = {
      status: 200,
      body: {
        thread: threadFixture(),
        agent: agentFixture(),
        messages: [messageFixture()],
        queue: queueFixture({ state: 'PROCESSING_TURN', activeTurn: turnFixture({ status: 'PROCESSING' }) }),
        history: [turnFixture({ status: 'COMPLETED' })]
      }
    };
    await useTeamAgentStore.getState().fetchTeamThread('tthread_1');
    equal('from the thread endpoint', requests[0].url, '/api/v1/team-threads/tthread_1');
    equal('as a read', requests[0].method, 'GET');
    equal('the transcript is adopted', useTeamAgentStore.getState().activeTranscript.length, 1);
    equal('the queue is adopted whole', useTeamAgentStore.getState().activeQueueState?.state, 'PROCESSING_TURN');
    equal('and so is the durable history', useTeamAgentStore.getState().turnHistory.length, 1);

    // A silent refresh is a snapshot that may predate live transitions.
    requests.length = 0;
    useTeamAgentStore.setState({
      activeQueueState: queueFixture({
        state: 'AWAITING_APPROVAL',
        activeTurn: turnFixture({ status: 'AWAITING_APPROVAL' })
      })
    });
    nextResponse = {
      status: 200,
      body: {
        thread: threadFixture(),
        messages: [messageFixture(), messageFixture({ id: 'msg_2', role: 'assistant' })],
        queue: queueFixture(),
        history: []
      }
    };
    await useTeamAgentStore.getState().fetchTeamThread('tthread_1', { silent: true });
    equal('a silent refresh still takes the transcript', useTeamAgentStore.getState().activeTranscript.length, 2);
    equal(
      'but leaves the live queue to the socket',
      useTeamAgentStore.getState().activeQueueState?.state,
      'AWAITING_APPROVAL'
    );

    // A response for a thread the member has navigated away from.
    useTeamAgentStore.setState({ activeThread: threadFixture({ id: 'tthread_other' }) });
    await useTeamAgentStore.getState().fetchTeamThread('tthread_1', { silent: true });
    equal(
      'a silent response for another thread is dropped',
      useTeamAgentStore.getState().activeThread?.id,
      'tthread_other'
    );
  }

  describe('createTeamThread opens a conversation on a role');
  {
    resetStore();
    nextResponse = { status: 201, body: { thread: threadFixture({ id: 'tthread_new' }) } };
    const thread = await useTeamAgentStore
      .getState()
      .createTeamThread('tagent_1', { title: 'Release 2.4 review', projectId: 'proj_1' });
    equal('under the agent', requests[0].url, '/api/v1/team-agents/tagent_1/threads');
    equal('as a POST', requests[0].method, 'POST');
    equal('carrying the title and the project', requests[0].body, {
      title: 'Release 2.4 review',
      projectId: 'proj_1'
    });
    equal('the thread comes back', thread?.id, 'tthread_new');
    equal('and is filed under its agent', useTeamAgentStore.getState().teamThreads['tagent_1'].length, 1);
  }

  describe('submitTurn queues rather than sends');
  {
    resetStore();
    nextResponse = {
      status: 202,
      body: {
        turn: turnFixture({ id: 'turn_9' }),
        queuePosition: 2,
        queue: queueFixture({
          state: 'PROCESSING_TURN',
          activeTurn: turnFixture({ id: 'turn_7', status: 'PROCESSING' }),
          queuedTurns: [turnFixture({ id: 'turn_8' }), turnFixture({ id: 'turn_9' })]
        })
      }
    };
    const turn = await useTeamAgentStore
      .getState()
      .submitTurn('tthread_1', 'Review the auth middleware change.', { pr: 42 });
    equal('to the thread’s turn collection', requests[0].url, '/api/v1/team-threads/tthread_1/turns');
    equal('as a POST', requests[0].method, 'POST');
    equal('carrying the instruction', (requests[0].body as { instruction: string }).instruction, 'Review the auth middleware change.');
    equal('and whatever context came with it', (requests[0].body as { context: unknown }).context, { pr: 42 });
    check(
      'but never an author — the Core takes that from the session',
      !('userId' in (requests[0].body as Record<string, unknown>)) &&
        !('userName' in (requests[0].body as Record<string, unknown>))
    );
    equal('the 202 is a success, not a failure', turn?.id, 'turn_9');
    equal(
      'the queue that came back is adopted whole',
      useTeamAgentStore.getState().activeQueueState?.queuedTurns.map(t => t.id),
      ['turn_8', 'turn_9']
    );
    equal(
      'the member is told where they are',
      useTeamAgentStore.getState().notice,
      'Your instruction is #2 in queue.'
    );
    check('and the composer is released', !useTeamAgentStore.getState().isSubmitting);
    equal('the turn is recorded in the history', useTeamAgentStore.getState().turnHistory[0].id, 'turn_9');

    resetStore();
    nextResponse = {
      status: 202,
      body: { turn: turnFixture({ id: 'turn_10' }), queuePosition: 0, queue: queueFixture() }
    };
    await useTeamAgentStore.getState().submitTurn('tthread_1', 'go');
    equal(
      'a turn at the head is being served, not "#0 in queue"',
      useTeamAgentStore.getState().notice,
      'Your instruction is being served now.'
    );

    resetStore();
    nextResponse = {
      status: 409,
      body: { error: 'Thread has no project.', code: 'NO_PROJECT_BOUND' }
    };
    const refused = await useTeamAgentStore.getState().submitTurn('tthread_1', 'go');
    equal('a thread with no checkout refuses', refused, null);
    check(
      'and says what is missing',
      (useTeamAgentStore.getState().error || '').includes('not bound to a project')
    );
    check('without leaving the composer disabled', !useTeamAgentStore.getState().isSubmitting);
  }

  describe('cancelTurn withdraws a queued instruction');
  {
    resetStore();
    nextResponse = {
      status: 200,
      body: { turn: turnFixture({ status: 'CANCELLED' }), queue: queueFixture() }
    };
    const cancelled = await useTeamAgentStore.getState().cancelTurn('tthread_1', 'turn_1');
    equal('at the turn’s own URL', requests[0].url, '/api/v1/team-threads/tthread_1/turns/turn_1');
    equal('with DELETE', requests[0].method, 'DELETE');
    check('and it reports success', cancelled);
    equal('the queue that came back is adopted', useTeamAgentStore.getState().activeQueueState?.queuedTurns.length, 0);
    equal('the withdrawn turn is kept in the record', useTeamAgentStore.getState().turnHistory[0].status, 'CANCELLED');
    equal('no row is left showing a spinner', useTeamAgentStore.getState().cancellingTurnId, null);

    nextResponse = {
      status: 409,
      body: { error: 'Turn is running.', code: 'TURN_NOT_CANCELLABLE' }
    };
    const late = await useTeamAgentStore.getState().cancelTurn('tthread_1', 'turn_2');
    check('a turn that already started refuses', !late);
    check(
      'and says so in words',
      (useTeamAgentStore.getState().error || '').includes('already running')
    );
  }

  // --- 4. Socket synchronization --------------------------------------------

  describe('handleTeamTurnEvent claims exactly the four turn transitions');
  {
    equal('there are four', TEAM_TURN_EVENT_TYPES.length, 4);
    check('queued is one', isTeamTurnEvent({ type: TEAM_TURN_QUEUED_EVENT }));
    check('started is one', isTeamTurnEvent({ type: TEAM_TURN_STARTED_EVENT }));
    check('completed is one', isTeamTurnEvent({ type: TEAM_TURN_COMPLETED_EVENT }));
    check('cancelled is one', isTeamTurnEvent({ type: TEAM_TURN_CANCELLED_EVENT }));
    check('a chat message is not', !isTeamTurnEvent({ type: 'chat.message' }));
    check('and neither is nothing at all', !isTeamTurnEvent(null));

    resetStore();
    check('an unrelated event is not claimed', !handleTeamTurnEvent('chat.message', {}));
    check(
      'nor is a turn event with no thread',
      handleTeamTurnEvent(TEAM_TURN_QUEUED_EVENT, { turn: turnFixture() }) &&
        useTeamAgentStore.getState().activeQueueState === null
    );
  }

  describe('the four transitions drive the open thread’s queue');
  {
    resetStore();
    useTeamAgentStore.setState({
      activeThread: threadFixture(),
      activeQueueState: queueFixture(),
      teamThreads: { tagent_1: [threadFixture()] }
    });

    const ada = turnFixture();
    const grace = turnFixture({ id: 'turn_2', userId: 'user_grace', userName: 'Grace Hopper' });

    handleTeamTurnEvent(TEAM_TURN_QUEUED_EVENT, eventFixture(ada, 'IDLE'));
    handleTeamTurnEvent(TEAM_TURN_QUEUED_EVENT, eventFixture(grace, 'IDLE', { queuePosition: 1 }));
    equal(
      'both instructions are waiting, in the order they arrived',
      useTeamAgentStore.getState().activeQueueState?.queuedTurns.map(t => t.id),
      ['turn_1', 'turn_2']
    );

    handleTeamTurnEvent(
      TEAM_TURN_STARTED_EVENT,
      eventFixture({ ...ada, status: 'PROCESSING', startedAt: NOW }, 'PROCESSING_TURN')
    );
    equal('the first one takes the lock', useTeamAgentStore.getState().activeQueueState?.activeTurn?.id, 'turn_1');
    equal('the thread says it is processing', useTeamAgentStore.getState().activeThread?.status, 'PROCESSING_TURN');
    equal('and names who has it', useTeamAgentStore.getState().activeThread?.activeTurnUserId, 'user_ada');
    equal(
      'the explorer’s copy of the thread agrees',
      useTeamAgentStore.getState().teamThreads['tagent_1'][0].status,
      'PROCESSING_TURN'
    );

    handleTeamTurnEvent(
      TEAM_TURN_STARTED_EVENT,
      eventFixture({ ...ada, status: 'AWAITING_APPROVAL' }, 'AWAITING_APPROVAL')
    );
    equal(
      'parking on an approval is visible as its own state',
      useTeamAgentStore.getState().activeQueueState?.state,
      'AWAITING_APPROVAL'
    );
    equal(
      'and the turn still holds the lock',
      useTeamAgentStore.getState().activeQueueState?.activeTurn?.id,
      'turn_1'
    );

    requests.length = 0;
    nextResponse = {
      status: 200,
      body: {
        thread: threadFixture(),
        messages: [messageFixture(), messageFixture({ id: 'msg_2', role: 'assistant', content: 'Two findings.' })],
        queue: queueFixture(),
        history: []
      }
    };
    handleTeamTurnEvent(
      TEAM_TURN_COMPLETED_EVENT,
      eventFixture({ ...ada, status: 'COMPLETED', completedAt: NOW }, 'IDLE')
    );
    equal('completing frees the lock', useTeamAgentStore.getState().activeQueueState?.activeTurn, null);
    equal(
      'the completed turn lands in the record',
      useTeamAgentStore.getState().turnHistory[0].status,
      'COMPLETED'
    );
    equal(
      'and the transcript is re-read, because the answer arrives with no event of its own',
      requests[0]?.url,
      '/api/v1/team-threads/tthread_1'
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    equal(
      'so the agent’s answer appears',
      useTeamAgentStore.getState().activeTranscript.length,
      2
    );

    handleTeamTurnEvent(
      TEAM_TURN_CANCELLED_EVENT,
      eventFixture({ ...grace, status: 'CANCELLED' }, 'IDLE')
    );
    equal('a withdrawal empties the queue', useTeamAgentStore.getState().activeQueueState?.queuedTurns.length, 0);
    equal(
      'and is kept in the record too',
      useTeamAgentStore.getState().turnHistory.find(t => t.id === 'turn_2')?.status,
      'CANCELLED'
    );
  }

  describe('a transition for another thread updates that thread, not this one');
  {
    resetStore();
    useTeamAgentStore.setState({
      activeThread: threadFixture(),
      activeQueueState: queueFixture(),
      teamThreads: { tagent_1: [threadFixture(), threadFixture({ id: 'tthread_2', title: 'Other' })] }
    });

    requests.length = 0;
    handleTeamTurnEvent(
      TEAM_TURN_STARTED_EVENT,
      eventFixture(
        turnFixture({ id: 'turn_x', teamThreadId: 'tthread_2', userId: 'user_grace', userName: 'Grace Hopper', status: 'PROCESSING' }),
        'PROCESSING_TURN'
      )
    );
    equal(
      'the other thread shows as busy in the explorer',
      useTeamAgentStore.getState().teamThreads['tagent_1'][1].status,
      'PROCESSING_TURN'
    );
    equal(
      'the open thread’s queue is untouched',
      useTeamAgentStore.getState().activeQueueState?.activeTurn,
      null
    );
    equal('and the open thread is still idle', useTeamAgentStore.getState().activeThread?.status, 'IDLE');
    equal('with no transcript re-read for a thread nobody is reading', requests.length, 0);
  }

  // --- 5. Modal helpers ------------------------------------------------------

  describe('the team agent draft round-trips through the form');
  {
    const { emptyTeamAgentDraft, draftFromTeamAgent, validateTeamAgentDraft, buildCreateTeamAgentInput, buildUpdateTeamAgentInput, toggleSelection, capabilityListValue } = modal;

    const blank = emptyTeamAgentDraft();
    equal('a blank draft allows every capability', blank.mcpMode, 'all');
    equal('a name is required', validateTeamAgentDraft(blank), 'A name is required.');
    equal(
      'then a role',
      validateTeamAgentDraft({ ...blank, name: 'Tech Lead' }),
      'A role is required.'
    );
    check(
      'then the prompt, which is the role itself',
      (validateTeamAgentDraft({ ...blank, name: 'Tech Lead', role: 'tech-lead' }) || '').includes(
        'system prompt is required'
      )
    );
    const valid = { ...blank, name: 'Tech Lead', role: 'tech-lead', systemPrompt: 'Plan the work.' };
    equal('a complete draft passes', validateTeamAgentDraft(valid), null);
    equal(
      'a non-numeric temperature is refused',
      validateTeamAgentDraft({ ...valid, temperature: 'hot' }),
      'Temperature must be a number.'
    );
    check(
      'and one out of range says the range',
      (validateTeamAgentDraft({ ...valid, temperature: '3' }) || '').includes('between 0 and 2')
    );
    equal('the boundary is allowed', validateTeamAgentDraft({ ...valid, temperature: '2' }), null);
    check(
      'a Selected list with nothing selected is refused rather than silently meaning None',
      (validateTeamAgentDraft({ ...valid, mcpMode: 'list' }) || '').includes('at least one MCP server')
    );
    check(
      'and the same for skills',
      (validateTeamAgentDraft({ ...valid, skillMode: 'list' }) || '').includes('at least one skill')
    );

    equal('All is unset, not empty', capabilityListValue('all', []), undefined);
    equal('None is deliberately empty', capabilityListValue('none', []), []);
    equal('and Selected is what was picked', capabilityListValue('list', ['github', ' fs ']), ['github', 'fs']);

    equal('toggling adds', toggleSelection([], 'github'), ['github']);
    equal('and toggling again removes', toggleSelection(['github', 'fs'], 'github'), ['fs']);

    const body = buildCreateTeamAgentInput('team_1', {
      ...valid,
      description: ' Plans the work. ',
      model: ' claude-opus-5 ',
      temperature: '0.4',
      mcpMode: 'list',
      mcpSelection: ['github'],
      skillMode: 'none'
    });
    equal('the create body names the team', body.teamId, 'team_1');
    equal('trims the text', body.description, 'Plans the work.');
    equal('parses the temperature as a number', body.temperature, 0.4);
    equal('carries the chosen servers', body.enabledMcpServers, ['github']);
    equal('and an explicit empty skill list', body.enabledSkills, []);
    equal('an unset model is omitted rather than sent blank', buildCreateTeamAgentInput('team_1', valid).model, undefined);
    check('the update body carries no teamId', !('teamId' in buildUpdateTeamAgentInput(valid)));

    const roundTripped = draftFromTeamAgent(agentFixture({ temperature: 0.4 }));
    equal('an existing agent’s servers come back as a selection', roundTripped.mcpSelection, ['github']);
    equal('its empty skill list comes back as None', roundTripped.skillMode, 'none');
    equal('and its temperature as text', roundTripped.temperature, '0.4');
    equal(
      'an agent with no lists at all reads as All',
      draftFromTeamAgent(agentFixture({ enabledMcpServers: undefined, enabledSkills: undefined })).mcpMode,
      'all'
    );
  }

  // --- 6. Rendering ----------------------------------------------------------

  describe('ActiveTurnQueueInspectorView across the three thread states');
  {
    const idle = renderInspector({ queue: queueFixture() });
    check('an idle thread says nobody holds it', idle.includes('Nobody holds this thread right now'));
    check('and is badged Idle', idle.includes('Idle'));
    check('with no withdraw buttons', !idle.includes('Withdraw'));

    const busy = renderInspector({
      queue: queueFixture({
        state: 'PROCESSING_TURN',
        activeTurn: turnFixture({ id: 'turn_1', status: 'PROCESSING', startedAt: NOW - 120_000 }),
        queuedTurns: [
          turnFixture({ id: 'turn_2', userId: 'user_grace', userName: 'Grace Hopper', instruction: 'Check the migration.' }),
          turnFixture({ id: 'turn_3', userId: 'user_alan', userName: 'Alan Turing', instruction: 'Summarise the diff.' })
        ]
      }),
      onCancelTurn: noop
    });
    check('a busy thread is badged Processing turn', busy.includes('Processing turn'));
    check('names the operator holding it', busy.includes('Ada Lovelace'));
    check('with their initials', busy.includes('AL'));
    check('and when they started', busy.includes('started 2m ago'));
    check('the first waiting turn is #1', busy.includes('#1 in queue'));
    check('the second is #2', busy.includes('#2 in queue'));
    check('in service order', busy.indexOf('#1 in queue') < busy.indexOf('#2 in queue'));
    check('Grace before Alan', busy.indexOf('Grace Hopper') < busy.indexOf('Alan Turing'));
    check('each with its instruction', busy.includes('Check the migration.') && busy.includes('Summarise the diff.'));
    check('each with when it was submitted', busy.includes('submitted 2m ago'));
    check('two withdraw buttons, one per waiting turn', busy.split('>Withdraw<').length - 1 === 2);
    check('the running turn has none', !busy.includes('Withdraw the turn Ada Lovelace queued'));
    check('and the waiting ones are labelled for a screen reader', busy.includes('Withdraw the turn Grace Hopper queued'));

    const parked = renderInspector({
      queue: queueFixture({
        state: 'AWAITING_APPROVAL',
        activeTurn: turnFixture({ status: 'AWAITING_APPROVAL', startedAt: NOW - 300_000 })
      })
    });
    check('an approval-parked thread says so rather than "processing"', parked.includes('Awaiting approval'));
    check('and the badge is polite, not assertive', parked.includes('aria-live="polite"'));

    const cancelling = renderInspector({
      queue: queueFixture({
        state: 'PROCESSING_TURN',
        activeTurn: turnFixture({ status: 'PROCESSING' }),
        queuedTurns: [turnFixture({ id: 'turn_2' })]
      }),
      onCancelTurn: noop,
      cancellingTurnId: 'turn_2'
    });
    check('a withdrawal in flight shows on its own row', cancelling.includes('Withdrawing…'));
    check('and the button is disabled while it is', cancelling.includes('disabled'));

    const readOnly = renderInspector({
      queue: queueFixture({ queuedTurns: [turnFixture({ id: 'turn_2' })] })
    });
    check('an inspector with no handler offers no withdrawal', !readOnly.includes('Withdraw'));
    check('but still shows the queue', readOnly.includes('#1 in queue'));
  }

  describe('TeamThreadChatView attributes every line to somebody');
  {
    const empty = renderChat();
    check('an untouched thread says so', empty.includes('Nothing has been asked of this agent yet'));
    check('and explains what happens when someone does', empty.includes('attributed to them'));
    check('the composer invites a queued instruction', empty.includes('joins the queue'));

    const populated = renderChat({
      transcript: [
        messageFixture({ id: 'm1', userName: 'Ada Lovelace', content: 'Review the auth middleware change.' }),
        messageFixture({
          id: 'm2',
          role: 'assistant',
          userId: undefined,
          userName: undefined,
          content: 'Two findings, both in the token check.'
        }),
        messageFixture({ id: 'm3', userId: 'user_grace', userName: 'Grace Hopper', content: 'Which token check?' })
      ],
      queue: queueFixture({
        state: 'PROCESSING_TURN',
        activeTurn: turnFixture({ status: 'PROCESSING', userName: 'Grace Hopper', startedAt: NOW - 60_000 }),
        queuedTurns: [turnFixture({ id: 'turn_2', userName: 'Alan Turing' })]
      })
    });
    check('each member is named on their own line', populated.includes('Ada Lovelace') && populated.includes('Grace Hopper'));
    check('the agent’s answer is attributed to the role', populated.includes('Security Reviewer'));
    check('rather than to a person', !populated.includes('>undefined<'));
    check('every line is timestamped', populated.includes('2m ago'));
    check('the thread’s state is badged', populated.includes('Processing turn'));
    check('a generation indicator says who is being served', populated.includes('Grace Hopper is being served…'));
    check('politely', populated.includes('aria-live="polite"'));
    check('the wait is spelled out before typing', populated.includes('1 turn already waiting'));
    check('and the queue inspector is part of the view', populated.includes('#1 in queue'));

    const parked = renderChat({
      queue: queueFixture({
        state: 'AWAITING_APPROVAL',
        activeTurn: turnFixture({ status: 'AWAITING_APPROVAL', userName: 'Ada Lovelace' })
      })
    });
    check(
      'a parked turn says what it is waiting for',
      parked.includes('Waiting on an approval for Ada Lovelace')
    );

    const unbound = renderChat({ thread: threadFixture({ projectId: undefined }) });
    check('a thread with no checkout warns before a turn is queued', unbound.includes('not bound to a project'));

    const typing = renderChat({ instruction: 'Check the migration.' });
    check('a typed instruction enables the button', !typing.includes('disabled=""'));
    const blank = renderChat({ instruction: '   ' });
    check('and whitespace does not', blank.includes('disabled'));
    const submitting = renderChat({ instruction: 'go', isSubmitting: true });
    check('a submission in flight is visible', submitting.includes('Queueing…'));

    const failed = renderChat({ error: 'That turn is already running, so it can no longer be withdrawn.' });
    check('a failure is announced as an alert', failed.includes('role="alert"'));
    check('with the Core’s reason', failed.includes('already running'));
  }

  describe('TeamAgentExplorerView shows what distinguishes one role from another');
  {
    const loaded = renderExplorer({
      agents: [agentFixture(), agentFixture({ id: 'tagent_2', name: 'Tech Lead', role: 'tech-lead' })],
      threadsByAgent: {
        tagent_1: [threadFixture(), threadFixture({ id: 'tthread_2', title: 'Hotfix', status: 'PROCESSING_TURN' })]
      },
      expandedAgentId: 'tagent_1'
    });
    check('each agent is named', loaded.includes('Security Reviewer') && loaded.includes('Tech Lead'));
    check('with its role as a badge', loaded.includes('security-reviewer'));
    check('its description', loaded.includes('Reads changes for security defects'));
    check('a preview of the prompt that makes it that role', loaded.includes('You review changes for security defects'));
    check('the model it runs under', loaded.includes('claude-opus-5'));
    check('which MCP servers it may reach', loaded.includes('MCP: github'));
    check('and that it has been given no skills', loaded.includes('Skills: No skills'));
    check('the expanded agent lists its threads', loaded.includes('Release 2.4 review') && loaded.includes('Hotfix'));
    check('each with its own turn state', loaded.includes('Processing turn') && loaded.includes('Idle'));
    check('and the expansion is announced', loaded.includes('aria-expanded="true"'));
    check('with a count on the toggle', loaded.includes('2 threads'));
    check('the collapsed agent shows none', !loaded.includes('tagent_2 threads'));

    const collapsed = renderExplorer({ threadsByAgent: { tagent_1: [threadFixture()] } });
    check('a collapsed card counts its threads without listing them', collapsed.includes('1 thread'));
    check('and says so', collapsed.includes('aria-expanded="false"'));
    check('without the thread titles', !collapsed.includes('Release 2.4 review'));

    const singular = renderExplorer({
      agents: [agentFixture({ enabledMcpServers: undefined, enabledSkills: undefined, model: undefined })]
    });
    check('an unset server list reads as all, not none', singular.includes('MCP: All servers'));
    check('an unset skill list too', singular.includes('Skills: All skills'));
    check('and an unset model names the default', singular.includes('Workstation default model'));

    const none = renderExplorer({ agents: [] });
    check('a team with no agents is explained', none.includes('This team shares no agents yet'));
    check('in terms of what one is', none.includes('a role, not a session'));

    const noTeam = renderExplorer({ agents: [], teamId: null });
    check('and with no team selected there is nothing to create against', noTeam.includes('Select a team'));

    const filtered = renderExplorer({ search: 'zzz' });
    check('a search that matches nothing says so', filtered.includes('No team agent matches this search'));

    const failed = renderExplorer({ error: 'Sign in to use your team’s shared agents.' });
    check('a failure is an alert', failed.includes('role="alert"'));
  }

  describe('CreateTeamAgentModalView offers the whole persona');
  {
    const blank = renderModal();
    check('it says the role is shared', blank.includes('This role is shared'));
    check('a name field', blank.includes('aria-label="Team agent name"'));
    check('a role field', blank.includes('aria-label="Team agent role"'));
    check('a system prompt field', blank.includes('aria-label="Team agent system prompt"'));
    check('a model field', blank.includes('aria-label="Team agent model"'));
    check('a temperature field', blank.includes('aria-label="Team agent temperature"'));
    check('an MCP selector', blank.includes('aria-label="MCP Servers access"'));
    check('a skill selector', blank.includes('aria-label="Skills access"'));
    check('the empty draft cannot be saved', blank.includes('A name is required.'));
    check('and the save button is disabled while it cannot', blank.includes('disabled'));

    const filled = renderModal({
      draft: {
        ...modal.emptyTeamAgentDraft(),
        name: 'Tech Lead',
        role: 'tech-lead',
        systemPrompt: 'Plan the work.',
        mcpMode: 'list',
        mcpSelection: ['github']
      },
      mcpServers: [
        { id: 'srv_1', name: 'github' },
        { id: 'srv_2', name: 'filesystem' }
      ],
      skills: [{ id: 'skill_1', name: 'release-checklist' }]
    });
    check('the workstation’s servers are offered by name', filled.includes('github') && filled.includes('filesystem'));
    check('the chosen one is pressed', filled.includes('aria-pressed="true"'));
    check('and a complete draft has no validation message', !filled.includes('A name is required.'));

    const editing = renderModal({
      draft: modal.draftFromTeamAgent(agentFixture()),
      editingAgent: agentFixture()
    });
    check('editing names the agent being changed', editing.includes('Edit Security Reviewer'));
    check('and says the change is for the team', editing.includes('Save for the team'));

    const noneConfigured = renderModal({
      draft: { ...modal.emptyTeamAgentDraft(), mcpMode: 'list' },
      mcpServers: []
    });
    check(
      'a workstation with no servers says so rather than showing an empty box',
      noneConfigured.includes('none configured yet')
    );
  }

  describe('nothing rendered carries a credential');
  {
    const markup = [
      renderInspector({ queue: queueFixture({ activeTurn: turnFixture({ status: 'PROCESSING' }) }) }),
      renderChat({ transcript: [messageFixture()] }),
      renderExplorer({ threadsByAgent: { tagent_1: [threadFixture()] }, expandedAgentId: 'tagent_1' }),
      renderModal({ draft: modal.draftFromTeamAgent(agentFixture()) })
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
