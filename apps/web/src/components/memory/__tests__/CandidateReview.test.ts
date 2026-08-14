/**
 * Tests for the Candidate Review drawer and its store actions (P5.4-03).
 *
 * Rendering is asserted through `react-dom/server` against a props-driven view,
 * and the store actions are driven against a recording `fetch` — so the URLs,
 * methods and resulting state transitions are checked, not just that something
 * happened.
 *
 * Run:  pnpm --filter @asterim/web exec tsx src/components/memory/__tests__/CandidateReview.test.ts
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CandidateDecision, ProjectDecision } from '@asterim/shared';

// --- Environment stubs, installed before the store loads ---

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

interface RecordedRequest {
  url: string;
  method: string;
  body: any;
}
const requests: RecordedRequest[] = [];
let nextResponse: { status: number; body: any } = { status: 200, body: {} };

(globalThis as any).fetch = async (url: string, init?: any) => {
  requests.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
  const { status, body } = nextResponse;
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
};

function respond(body: any, status = 200): void {
  nextResponse = { status, body };
}

type DrawerModule = typeof import('../CandidateReviewDrawer');
type StoreModule = typeof import('../../../stores/useMemoryStore');
type ExplorerModule = typeof import('../DecisionExplorer');

let drawerMod: DrawerModule;
let storeMod: StoreModule;
let explorerMod: ExplorerModule;

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

const PROJECT = 'proj-candidates';
const store = () => storeMod.useMemoryStore.getState();
const lastRequest = () => requests[requests.length - 1];

function candidate(over: Partial<CandidateDecision> = {}): CandidateDecision {
  return {
    id: 'cand-1',
    projectId: PROJECT,
    threadId: 'thread-1',
    title: 'Hash passwords with Argon2id',
    summary: 'Argon2id for password hashing.',
    rationale: 'Memory-hard, resists GPU attack.',
    constraints: ['Never log the derived key'],
    relatedFiles: ['src/auth.ts'],
    codeRefs: [{ filePath: 'src/auth.ts', symbolName: 'hashPassword' }],
    confidence: 0.9,
    status: 'PENDING',
    extractedAt: 1_700_000_000_000,
    ...over
  };
}

function decision(over: Partial<ProjectDecision> = {}): ProjectDecision {
  return {
    id: 'dec-approved',
    projectId: PROJECT,
    title: 'Hash passwords with Argon2id',
    summary: 's',
    rationale: 'r',
    constraints: [],
    status: 'ACTIVE',
    supersededBy: null,
    provenance: 'HUMAN_CONFIRMED',
    confidence: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    relatedFiles: [],
    ...over
  };
}

const renderDrawer = (candidates: CandidateDecision[], open = false, projectId: string | null = PROJECT) =>
  renderToStaticMarkup(
    React.createElement(drawerMod.CandidateReviewDrawer, { projectId, candidates, initiallyOpen: open })
  );

async function main(): Promise<void> {
  drawerMod = await import('../CandidateReviewDrawer');
  storeMod = await import('../../../stores/useMemoryStore');
  explorerMod = await import('../DecisionExplorer');

  // --- Collapsed banner -----------------------------------------------------
  describe('render — the queue banner');

  const collapsed = renderDrawer([candidate(), candidate({ id: 'cand-2', title: 'Second suggestion' })]);
  check('the pending count is shown', collapsed.includes('>2<'), 'expected a badge showing 2');
  check('it says where they came from', collapsed.includes('Suggested from your sessions'));
  check('and that nothing is recorded yet', collapsed.includes('Nothing is recorded until you approve it'));
  check('a review control is offered', collapsed.includes('Review'));
  check('collapsed, the candidate bodies are not shown', !collapsed.includes('Memory-hard'));

  equal('no candidates renders nothing at all', renderDrawer([]), '');
  equal('no project renders nothing', renderDrawer([candidate()], false, null), '');

  // --- Expanded queue -------------------------------------------------------
  describe('render — the expanded queue');

  const open = renderDrawer([candidate()], true);
  check('the title is shown', open.includes('Hash passwords with Argon2id'));
  check('the rationale is shown', open.includes('Memory-hard'));
  check('constraints are shown', open.includes('Never log the derived key'));
  check('anchors are shown', open.includes('src/auth.ts'));
  check('the extractor confidence is labelled as a suggestion', open.includes('suggested · 90%'));
  check('an Approve control exists', open.includes('Approve'));
  check('a Discard control exists', open.includes('Discard'));
  check(
    'the controls are labelled with the candidate they act on',
    open.includes('Approve: Hash passwords with Argon2id') && open.includes('Discard: Hash passwords with Argon2id')
  );

  const many = renderDrawer([candidate(), candidate({ id: 'c2', title: 'Second' }), candidate({ id: 'c3', title: 'Third' })], true);
  check('every candidate gets a card', many.includes('Second') && many.includes('Third'));

  // --- Store actions --------------------------------------------------------
  describe('fetchCandidates');

  store().reset();
  requests.length = 0;
  respond({ candidates: [candidate(), candidate({ id: 'cand-2' })] });
  await store().fetchCandidates(PROJECT);

  equal(
    'it asks only for the pending queue',
    lastRequest().url,
    `/api/v1/projects/${PROJECT}/memory/candidates?status=PENDING`
  );
  equal('both candidates are stored', store().candidates.length, 2);
  equal('and the project is adopted', store().projectId, PROJECT);

  describe('approveCandidate');

  respond({ decision: decision() }, 201);
  const approved = await store().approveCandidate(PROJECT, 'cand-1');

  equal(
    'it POSTs to the approve endpoint',
    lastRequest().url,
    `/api/v1/projects/${PROJECT}/memory/candidates/cand-1/approve`
  );
  equal('it is a POST', lastRequest().method, 'POST');
  equal('the created decision is returned', approved.id, 'dec-approved');
  equal('it is human-confirmed', approved.provenance, 'HUMAN_CONFIRMED');
  equal('the candidate leaves the queue', store().candidates.map(c => c.id), ['cand-2']);
  equal('and the decision joins the list', store().decisions.map(d => d.id), ['dec-approved']);

  describe('rejectCandidate');

  const decisionsBefore = store().decisions.length;
  respond({ candidate: candidate({ id: 'cand-2', status: 'REJECTED' }) });
  await store().rejectCandidate(PROJECT, 'cand-2');

  equal(
    'it POSTs to the reject endpoint',
    lastRequest().url,
    `/api/v1/projects/${PROJECT}/memory/candidates/cand-2/reject`
  );
  equal('the candidate leaves the queue', store().candidates, []);
  equal(
    'and no decision is created (DEC-027)',
    store().decisions.length,
    decisionsBefore
  );

  describe('failures are surfaced, not swallowed');

  respond({ candidates: [candidate()] });
  await store().fetchCandidates(PROJECT);

  respond({ error: 'Candidate cand-1 has already been reviewed (APPROVED)' }, 400);
  let threw = false;
  try {
    await store().approveCandidate(PROJECT, 'cand-1');
  } catch (err) {
    threw = (err as Error).message.includes('already been reviewed');
  }
  check('a rejected approval throws', threw);
  equal('the server message is readable from state', store().error, 'Candidate cand-1 has already been reviewed (APPROVED)');
  equal('and the candidate stays in the queue', store().candidates.length, 1);

  respond({ error: 'Candidate cand-1 does not belong to project other' }, 400);
  threw = false;
  try {
    await store().rejectCandidate(PROJECT, 'cand-1');
  } catch {
    threw = true;
  }
  check('a rejected discard throws too', threw);
  equal('leaving the queue untouched', store().candidates.length, 1);

  // --- Explorer integration -------------------------------------------------
  describe('the Explorer surfaces the queue');

  const withQueue = renderToStaticMarkup(
    React.createElement(explorerMod.DecisionExplorerView, {
      projectId: PROJECT,
      decisions: [],
      rules: [],
      activeIntent: null,
      briefing: null,
      loading: false,
      error: null,
      candidates: [candidate()]
    })
  );
  check('the banner appears in the Explorer', withQueue.includes('Suggested from your sessions'));
  check('with a count', withQueue.includes('>1<'));

  const withoutQueue = renderToStaticMarkup(
    React.createElement(explorerMod.DecisionExplorerView, {
      projectId: PROJECT,
      decisions: [],
      rules: [],
      activeIntent: null,
      briefing: null,
      loading: false,
      error: null,
      candidates: []
    })
  );
  check('and is absent when nothing is queued', !withoutQueue.includes('Suggested from your sessions'));

  const readOnly = renderToStaticMarkup(
    React.createElement(explorerMod.DecisionExplorerView, {
      projectId: null,
      decisions: [],
      rules: [],
      activeIntent: null,
      briefing: null,
      loading: false,
      error: null,
      candidates: [candidate()]
    })
  );
  check('and absent without a project to act on', !readOnly.includes('Suggested from your sessions'));
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
