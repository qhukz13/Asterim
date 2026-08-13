/**
 * Unit tests for useMemoryStore (P5.2-01).
 *
 * The repository has no test runner, so this is a standalone script with its own
 * assertion harness, matching the convention in packages/mcp-memory-server.
 *
 * `fetch` and `localStorage` are stubbed before the store loads. The stub records
 * every request, so the tests assert the *exact* URLs, methods and bodies the store
 * sends — the endpoint prefix is `/api/v1/...`, and getting it wrong is the kind of
 * error a build cannot catch and a mock that merely returns data would hide.
 *
 * Run:  pnpm --filter @asterim/web exec tsx src/stores/__tests__/useMemoryStore.test.ts
 */

import type { ArchitecturalRule, ProjectBriefing, ProjectDecision, ProjectIntent } from '@asterim/shared';

// --- Environment stubs, installed before the store is imported ---

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

const requests: RecordedRequest[] = [];
let nextResponse: { status: number; body: any } = { status: 200, body: {} };

(globalThis as any).localStorage = {
  store: new Map<string, string>(),
  getItem(key: string) {
    return this.store.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    this.store.set(key, value);
  },
  removeItem(key: string) {
    this.store.delete(key);
  }
};
localStorage.setItem('asterim_token', 'test-token');

(globalThis as any).fetch = async (url: string, init?: any) => {
  requests.push({
    url,
    method: init?.method ?? 'GET',
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: init?.body ? JSON.parse(init.body) : undefined
  });
  const { status, body } = nextResponse;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
};

/** Queues the response the next fetch will receive. */
function respond(body: any, status = 200): void {
  nextResponse = { status, body };
}

// The store is loaded inside main(), after the globals above are installed — a
// static import would hoist above them. `typeof import(...)` is type-only, so it
// costs nothing at runtime and keeps the whole test typechecked by the web build.
type StoreModule = typeof import('../useMemoryStore');
let mod: StoreModule;

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
  check(label, ok, ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function describe(name: string): void {
  console.log(`\n${name}`);
}

const store = () => mod.useMemoryStore.getState();
const lastRequest = () => requests[requests.length - 1];

// --- Fixtures ---

const PROJECT = 'proj-alpha';
const OTHER_PROJECT = 'proj-beta';

function decision(over: Partial<ProjectDecision> = {}): ProjectDecision {
  return {
    id: 'dec-1',
    projectId: PROJECT,
    title: 'Use Argon2id',
    summary: 'Argon2id for password hashing.',
    rationale: 'Memory-hard.',
    constraints: [],
    status: 'ACTIVE',
    supersededBy: null,
    provenance: 'AGENT_STATEMENT',
    confidence: 0.75,
    createdAt: 1000,
    updatedAt: 1000,
    relatedFiles: [],
    ...over
  };
}

function rule(over: Partial<ArchitecturalRule> = {}): ArchitecturalRule {
  return {
    id: 'rule-1',
    projectId: PROJECT,
    title: 'No secrets in the repo',
    statement: 'Read secrets from the environment.',
    severity: 'error',
    scopePattern: '**',
    createdAt: 1000,
    ...over
  };
}

function intent(over: Partial<ProjectIntent> = {}): ProjectIntent {
  return {
    id: 'intent-1',
    projectId: PROJECT,
    goal: 'Migrate auth',
    constraints: [],
    nonGoals: [],
    status: 'ACTIVE',
    createdAt: 1000,
    updatedAt: 1000,
    ...over
  };
}

function briefing(over: Partial<ProjectBriefing> = {}): ProjectBriefing {
  return {
    projectId: PROJECT,
    activeDecisions: [],
    architecturalRules: [],
    currentIntent: null,
    recentAgentWork: [],
    recentApprovals: [],
    ...over
  };
}

function event(type: string, payload: any) {
  return { id: 'evt-1', type, timestamp: 1, source: 'server', payload };
}

async function main(): Promise<void> {
  mod = await import('../useMemoryStore');
  const { isMemoryEvent } = mod;

  // --- Initial state ---------------------------------------------------------
  describe('initial state');

  equal('projectId starts null', store().projectId, null);
  equal('briefing starts null', store().briefing, null);
  equal('decisions start empty', store().decisions, []);
  equal('rules start empty', store().rules, []);
  equal('activeIntent starts null', store().activeIntent, null);
  equal('loading starts false', store().loading, false);
  equal('error starts null', store().error, null);

  // --- Reads -----------------------------------------------------------------
  describe('fetchBriefing');

  respond({ briefing: briefing({ architecturalRules: [rule()], currentIntent: intent(), activeDecisions: [decision()] }) });
  await store().fetchBriefing(PROJECT);

  equal('it calls the v1 briefing endpoint', lastRequest().url, `/api/v1/projects/${PROJECT}/memory/briefing`);
  equal('it is a GET', lastRequest().method, 'GET');
  equal('it sends the bearer token', lastRequest().headers.Authorization, 'Bearer test-token');
  equal('the briefing is stored', store().briefing?.projectId, PROJECT);
  equal('the project is adopted', store().projectId, PROJECT);
  equal("the briefing's rules are adopted", store().rules.length, 1);
  equal("the briefing's intent is adopted", store().activeIntent?.id, 'intent-1');
  equal('loading is cleared', store().loading, false);
  equal('no error is set', store().error, null);

  describe('fetchDecisions');

  respond({ decisions: [decision({ id: 'dec-2', createdAt: 2000 }), decision()] });
  await store().fetchDecisions(PROJECT);
  equal('it calls the decisions endpoint', lastRequest().url, `/api/v1/projects/${PROJECT}/memory/decisions`);
  equal('both decisions are stored', store().decisions.length, 2);

  respond({ decisions: [] });
  await store().fetchDecisions(PROJECT, { status: 'ARCHIVED' });
  equal(
    'a status filter becomes a query parameter',
    lastRequest().url,
    `/api/v1/projects/${PROJECT}/memory/decisions?status=ARCHIVED`
  );

  describe('fetchRules and fetchIntent');

  respond({ rules: [rule(), rule({ id: 'rule-2' })] });
  await store().fetchRules(PROJECT);
  equal('it calls the rules endpoint', lastRequest().url, `/api/v1/projects/${PROJECT}/memory/rules`);
  equal('rules are stored', store().rules.length, 2);

  respond({ intent: intent({ id: 'intent-2' }) });
  await store().fetchIntent(PROJECT);
  equal('it calls the active-intent endpoint', lastRequest().url, `/api/v1/projects/${PROJECT}/memory/intents/active`);
  equal('the intent is stored', store().activeIntent?.id, 'intent-2');

  respond({ intent: null });
  await store().fetchIntent(PROJECT);
  equal('a project with no intent yields null, not an error', store().activeIntent, null);
  equal('and that is not treated as a failure', store().error, null);

  // --- Error handling --------------------------------------------------------
  describe('error handling');

  store().reset();
  respond({ error: "Invalid status 'nope'" }, 400);
  await store().fetchDecisions(PROJECT, { status: 'nope' as any });
  equal("the server's own message is surfaced", store().error, "Invalid status 'nope'");
  equal('loading is cleared on failure', store().loading, false);
  equal('a failed read leaves the data untouched', store().decisions, []);

  respond({}, 500);
  await store().fetchBriefing(PROJECT);
  check('a bodyless failure still produces a message', (store().error ?? '').includes('HTTP 500'), store().error ?? '');

  respond({ briefing: briefing() });
  await store().fetchBriefing(PROJECT);
  equal('a later success clears the error', store().error, null);

  // --- Writes ----------------------------------------------------------------
  describe('createDecision');

  store().reset();
  respond({ briefing: briefing() });
  await store().fetchBriefing(PROJECT);

  respond({ decision: decision({ id: 'dec-new', createdAt: 3000 }) }, 201);
  const created = await store().createDecision(PROJECT, {
    title: 'Use Argon2id',
    summary: 'S',
    rationale: 'R'
  });
  equal('it POSTs to the decisions endpoint', lastRequest().url, `/api/v1/projects/${PROJECT}/memory/decisions`);
  equal('it is a POST', lastRequest().method, 'POST');
  equal('it sends JSON', lastRequest().headers['Content-Type'], 'application/json');
  equal('the body carries no projectId — the path does', lastRequest().body.projectId, undefined);
  equal('the created decision is returned', created.id, 'dec-new');
  equal('it lands in the list', store().decisions.length, 1);
  equal('and in the briefing, since it is ACTIVE', store().briefing?.activeDecisions.length, 1);

  respond({ error: 'title, summary and rationale are required' }, 400);
  let threw = false;
  try {
    await store().createDecision(PROJECT, { title: '', summary: '', rationale: '' } as any);
  } catch (err) {
    threw = (err as Error).message.includes('required');
  }
  check('a rejected write throws so the caller learns of it', threw);
  equal('and the error is readable from state too', store().error, 'title, summary and rationale are required');
  equal('the rejected decision was not added', store().decisions.length, 1);

  describe('supersedeDecision');

  store().reset();
  respond({ briefing: briefing({ activeDecisions: [decision()] }) });
  await store().fetchBriefing(PROJECT);
  respond({ decisions: [decision()] });
  await store().fetchDecisions(PROJECT);

  respond({ decision: decision({ id: 'dec-replacement', createdAt: 4000 }) }, 201);
  await store().supersedeDecision(PROJECT, 'dec-1', { title: 'T', summary: 'S', rationale: 'R' });
  equal(
    'it POSTs to the supersede endpoint',
    lastRequest().url,
    `/api/v1/projects/${PROJECT}/memory/decisions/dec-1/supersede`
  );
  equal('the replaced decision is marked SUPERSEDED', store().decisions.find((d: ProjectDecision) => d.id === 'dec-1')?.status, 'SUPERSEDED');
  equal('and links to its replacement', store().decisions.find((d: ProjectDecision) => d.id === 'dec-1')?.supersededBy, 'dec-replacement');
  equal('both decisions are held', store().decisions.length, 2);
  equal('the briefing now lists only the replacement', store().briefing?.activeDecisions.map((d: ProjectDecision) => d.id), ['dec-replacement']);

  describe('updateDecisionStatus and archiveDecision');

  store().reset();
  respond({ briefing: briefing({ activeDecisions: [decision()] }) });
  await store().fetchBriefing(PROJECT);
  respond({ decisions: [decision()] });
  await store().fetchDecisions(PROJECT);

  respond({ decision: decision({ status: 'STALE' }) });
  const staled = await store().updateDecisionStatus(PROJECT, 'dec-1', 'STALE');
  equal(
    'it PATCHes the status endpoint',
    lastRequest().url,
    `/api/v1/projects/${PROJECT}/memory/decisions/dec-1/status`
  );
  equal('it uses PATCH', lastRequest().method, 'PATCH');
  equal('the body carries only the status', lastRequest().body, { status: 'STALE' });
  equal('the updated decision is returned', staled.status, 'STALE');
  equal('local state reflects the new status', store().decisions[0].status, 'STALE');
  equal('and it is dropped from the briefing', store().briefing?.activeDecisions, []);
  equal('without duplicating the decision', store().decisions.length, 1);

  respond({ decision: decision({ status: 'ACTIVE' }) });
  await store().updateDecisionStatus(PROJECT, 'dec-1', 'ACTIVE');
  equal('moving back to ACTIVE restores it to the briefing', store().briefing?.activeDecisions.map((d: ProjectDecision) => d.id), ['dec-1']);

  respond({ decision: decision({ status: 'ARCHIVED' }) });
  const archived = await store().archiveDecision(PROJECT, 'dec-1');
  equal('archiveDecision sends ARCHIVED', lastRequest().body, { status: 'ARCHIVED' });
  equal('it targets the same endpoint', lastRequest().url, `/api/v1/projects/${PROJECT}/memory/decisions/dec-1/status`);
  equal('and returns the archived decision', archived.status, 'ARCHIVED');
  equal('which leaves the briefing', store().briefing?.activeDecisions, []);

  respond({ error: "Decision dec-1 does not belong to project other" }, 400);
  let statusThrew = false;
  try {
    await store().updateDecisionStatus(PROJECT, 'dec-1', 'ACTIVE');
  } catch (err) {
    statusThrew = (err as Error).message.includes('does not belong');
  }
  check('a rejected status change throws', statusThrew);
  equal('and surfaces the server message', store().error, 'Decision dec-1 does not belong to project other');
  equal('while leaving the decision as it was', store().decisions[0].status, 'ARCHIVED');

  describe('handleMemoryEvent — decision_updated');

  store().reset();
  respond({ briefing: briefing({ activeDecisions: [decision()] }) });
  await store().fetchBriefing(PROJECT);
  respond({ decisions: [decision()] });
  await store().fetchDecisions(PROJECT);

  check('the event type is recognised', isMemoryEvent({ type: 'memory.decision_updated' }));

  store().handleMemoryEvent(
    event('memory.decision_updated', {
      projectId: PROJECT,
      decision: decision({ status: 'ARCHIVED' }),
      previousStatus: 'ACTIVE'
    })
  );
  equal('a live status change is applied', store().decisions[0].status, 'ARCHIVED');
  equal('and removes it from the briefing', store().briefing?.activeDecisions, []);
  equal('without adding a second copy', store().decisions.length, 1);

  store().handleMemoryEvent(
    event('memory.decision_updated', {
      projectId: PROJECT,
      decision: decision({ status: 'ACTIVE' }),
      previousStatus: 'ARCHIVED'
    })
  );
  equal('a reversal restores it to the briefing', store().briefing?.activeDecisions.map((d: ProjectDecision) => d.id), ['dec-1']);
  equal('and updates the stored status', store().decisions[0].status, 'ACTIVE');

  store().handleMemoryEvent(
    event('memory.decision_updated', {
      projectId: OTHER_PROJECT,
      decision: decision({ id: 'foreign', projectId: OTHER_PROJECT, status: 'ARCHIVED' }),
      previousStatus: 'ACTIVE'
    })
  );
  equal("another project's status change is ignored", store().decisions.length, 1);

  // A decision the client has never seen, updated remotely: it should appear
  // rather than be dropped, since the payload carries the whole decision.
  store().handleMemoryEvent(
    event('memory.decision_updated', {
      projectId: PROJECT,
      decision: decision({ id: 'unseen', status: 'STALE' }),
      previousStatus: 'ACTIVE'
    })
  );
  equal('an unseen decision arriving via an update is added', store().decisions.length, 2);
  check('and stays out of the briefing while non-ACTIVE', !store().briefing?.activeDecisions.some((d: ProjectDecision) => d.id === 'unseen'));

  describe('createRule and createIntent');

  store().reset();
  respond({ briefing: briefing() });
  await store().fetchBriefing(PROJECT);

  respond({ rule: rule({ id: 'rule-new' }) }, 201);
  const newRule = await store().createRule(PROJECT, { title: 'T', statement: 'S' });
  equal('it POSTs to the rules endpoint', lastRequest().url, `/api/v1/projects/${PROJECT}/memory/rules`);
  equal('the rule is returned', newRule.id, 'rule-new');
  equal('the rule lands in the list', store().rules.length, 1);
  equal('and in the briefing', store().briefing?.architecturalRules.length, 1);

  respond({ intent: intent({ id: 'intent-new' }) }, 201);
  const newIntent = await store().createIntent(PROJECT, { goal: 'G' });
  equal('the intent is returned', newIntent.id, 'intent-new');
  equal('it POSTs to the intents endpoint', lastRequest().url, `/api/v1/projects/${PROJECT}/memory/intents`);
  equal('the intent becomes active', store().activeIntent?.id, 'intent-new');
  equal('and replaces the briefing intent', store().briefing?.currentIntent?.id, 'intent-new');

  // --- Socket events ---------------------------------------------------------
  describe('isMemoryEvent');

  check('it recognises decision_created', isMemoryEvent({ type: 'memory.decision_created' }));
  check('it recognises decision_superseded', isMemoryEvent({ type: 'memory.decision_superseded' }));
  check('it recognises rule_created', isMemoryEvent({ type: 'memory.rule_created' }));
  check('it recognises intent_updated', isMemoryEvent({ type: 'memory.intent_updated' }));
  check('it rejects an unrelated event', !isMemoryEvent({ type: 'agent.log' }));
  check('it rejects undefined', !isMemoryEvent(undefined));

  describe('handleMemoryEvent — decision_created');

  store().reset();
  respond({ briefing: briefing() });
  await store().fetchBriefing(PROJECT);

  store().handleMemoryEvent(event('memory.decision_created', { projectId: PROJECT, decision: decision({ id: 'dec-live' }) }));
  equal('a live decision appears without a refetch', store().decisions.map((d: ProjectDecision) => d.id), ['dec-live']);
  equal('and appears in the briefing', store().briefing?.activeDecisions.map((d: ProjectDecision) => d.id), ['dec-live']);

  store().handleMemoryEvent(event('memory.decision_created', { projectId: PROJECT, decision: decision({ id: 'dec-live' }) }));
  equal('the same decision arriving twice is not duplicated', store().decisions.length, 1);

  store().handleMemoryEvent(
    event('memory.decision_created', { projectId: PROJECT, decision: decision({ id: 'dec-archived', status: 'ARCHIVED' }) })
  );
  equal('a non-ACTIVE decision is listed', store().decisions.length, 2);
  equal('but kept out of the briefing', store().briefing?.activeDecisions.length, 1);

  describe('handleMemoryEvent — ordering and project scoping');

  store().reset();
  respond({ decisions: [] });
  await store().fetchDecisions(PROJECT);
  store().handleMemoryEvent(event('memory.decision_created', { projectId: PROJECT, decision: decision({ id: 'old', createdAt: 1000 }) }));
  store().handleMemoryEvent(event('memory.decision_created', { projectId: PROJECT, decision: decision({ id: 'new', createdAt: 5000 }) }));
  store().handleMemoryEvent(event('memory.decision_created', { projectId: PROJECT, decision: decision({ id: 'mid', createdAt: 3000 }) }));
  equal('decisions are held newest first, whatever order they arrive in', store().decisions.map((d: ProjectDecision) => d.id), ['new', 'mid', 'old']);

  store().handleMemoryEvent(
    event('memory.decision_created', { projectId: OTHER_PROJECT, decision: decision({ id: 'foreign', projectId: OTHER_PROJECT }) })
  );
  equal("another project's decision is ignored", store().decisions.length, 3);

  store().handleMemoryEvent(event('memory.decision_created', { decision: decision({ id: 'no-project' }) }));
  equal('an event with no projectId is ignored', store().decisions.length, 3);

  store().handleMemoryEvent(event('agent.log', { projectId: PROJECT, decision: decision({ id: 'wrong-type' }) }));
  equal('a non-memory event is ignored', store().decisions.length, 3);

  describe('handleMemoryEvent — decision_superseded');

  store().reset();
  respond({ briefing: briefing({ activeDecisions: [decision()] }) });
  await store().fetchBriefing(PROJECT);
  respond({ decisions: [decision()] });
  await store().fetchDecisions(PROJECT);

  store().handleMemoryEvent(
    event('memory.decision_superseded', {
      projectId: PROJECT,
      decisionId: 'dec-1',
      supersededBy: 'dec-2',
      decision: decision({ id: 'dec-2', createdAt: 6000 })
    })
  );
  equal('the replaced decision is marked', store().decisions.find((d: ProjectDecision) => d.id === 'dec-1')?.status, 'SUPERSEDED');
  equal('the replacement is added', store().decisions.length, 2);
  equal('the briefing holds only the replacement', store().briefing?.activeDecisions.map((d: ProjectDecision) => d.id), ['dec-2']);

  // `decision` is optional on this payload.
  store().reset();
  respond({ decisions: [decision()] });
  await store().fetchDecisions(PROJECT);
  store().handleMemoryEvent(
    event('memory.decision_superseded', { projectId: PROJECT, decisionId: 'dec-1', supersededBy: 'dec-elsewhere' })
  );
  equal('a supersede without the replacement still marks the old decision', store().decisions[0].status, 'SUPERSEDED');
  equal('and records the link', store().decisions[0].supersededBy, 'dec-elsewhere');
  equal('without inventing a decision it was not sent', store().decisions.length, 1);

  describe('handleMemoryEvent — rules and intent');

  store().reset();
  respond({ briefing: briefing() });
  await store().fetchBriefing(PROJECT);

  store().handleMemoryEvent(event('memory.rule_created', { projectId: PROJECT, rule: rule({ id: 'rule-live' }) }));
  equal('a live rule appears', store().rules.map((r: ArchitecturalRule) => r.id), ['rule-live']);
  equal('and in the briefing', store().briefing?.architecturalRules.length, 1);
  store().handleMemoryEvent(event('memory.rule_created', { projectId: PROJECT, rule: rule({ id: 'rule-live' }) }));
  equal('a repeated rule is not duplicated', store().rules.length, 1);

  store().handleMemoryEvent(event('memory.intent_updated', { projectId: PROJECT, intent: intent({ id: 'intent-live' }) }));
  equal('a live intent replaces the active one', store().activeIntent?.id, 'intent-live');
  equal('and the briefing intent', store().briefing?.currentIntent?.id, 'intent-live');

  store().handleMemoryEvent(event('memory.intent_updated', { projectId: PROJECT, intent: null, previousIntentId: 'intent-live' }));
  equal('an archived intent with no replacement clears it', store().activeIntent, null);
  equal('and clears it in the briefing too', store().briefing?.currentIntent, null);

  describe('events before any fetch');

  store().reset();
  store().handleMemoryEvent(event('memory.decision_created', { projectId: PROJECT, decision: decision({ id: 'early' }) }));
  equal('an event arriving before the first fetch is accepted', store().decisions.length, 1);
  equal('and there is no briefing to corrupt', store().briefing, null);

  describe('reset');

  store().reset();
  equal('reset clears decisions', store().decisions, []);
  equal('reset clears rules', store().rules, []);
  equal('reset clears the briefing', store().briefing, null);
  equal('reset clears the intent', store().activeIntent, null);
  equal('reset clears the project', store().projectId, null);
  equal('reset clears the error', store().error, null);
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
    (globalThis as { process?: { exit(code: number): void } }).process?.exit(failed === 0 ? 0 : 1);
  });
