/**
 * HTTP tests for the candidate review lifecycle (P5.4-03, DEC-027).
 *
 * The property the whole staging table exists for is negative: an unreviewed
 * candidate must not be able to reach `project_decisions`. Every assertion about
 * approval and rejection therefore also checks what happened to the decisions
 * table, not just what the endpoint returned.
 *
 * Run:  pnpm --filter asterim exec tsx src/routes/__tests__/memory-candidates.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-candidates-'));
process.env.ASTERIM_DATA_DIR = tmpDir;
const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-candidates-proj-'));

const Fastify = require('fastify');
const { dbService } = require('../../services/DatabaseService');
const { eventBus } = require('../../services/EventBus');
const memoryRoutes = require('../memory').default;

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

function cleanup(): void {
  for (const dir of [tmpDir, projectDir]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  console.log('\n[cleanup] removed temp directories');
}

const PROJECT_A = 'cand-project-a';
const PROJECT_B = 'cand-project-b';

async function main(): Promise<void> {
  const app = Fastify();
  await app.register(memoryRoutes);
  await app.ready();

  const insertProject = dbService.getDb().prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)');
  insertProject.run(PROJECT_A, 'Candidate Project A', projectDir);
  insertProject.run(PROJECT_B, 'Candidate Project B', projectDir);

  const insertEvent = dbService
    .getDb()
    .prepare('INSERT INTO events (id, project_id, thread_id, timestamp, source, type, payload_json) VALUES (?,?,?,?,?,?,?)');
  const chat = (id: string, content: string, project = PROJECT_A, threadId = 'thread-1', ts = 1000) =>
    insertEvent.run(id, project, threadId, ts, 'agent:claude', 'chat.message', JSON.stringify({ payload: { role: 'agent', content } }));

  chat('c1', 'Opening the auth service.', PROJECT_A, 'thread-1', 1000);
  chat('c2', 'Decision: hash passwords with Argon2id because it is memory-hard. Never log the derived key.', PROJECT_A, 'thread-1', 1001);
  chat('c3', 'Decision: expire session tokens after 15 minutes because a leak is then bounded.', PROJECT_A, 'thread-2', 1002);

  const post = (url: string, payload: unknown = {}) => app.inject({ method: 'POST', url, payload });
  const get = (url: string) => app.inject({ method: 'GET', url });

  const decisionEvents: any[] = [];
  const listener = (event: any) => decisionEvents.push(event);
  eventBus.subscribe('memory.decision_created', listener);

  // --- Extraction -----------------------------------------------------------
  describe('POST /memory/candidates/extract');

  const extracted = await post(`/api/v1/projects/${PROJECT_A}/memory/candidates/extract`, {});
  equal('extraction returns 201', extracted.statusCode, 201);
  equal('two candidates were staged', extracted.json().extracted, 2);
  const staged = extracted.json().candidates;
  equal('all are PENDING', [...new Set(staged.map((c: any) => c.status))], ['PENDING']);
  check('each carries a title', staged.every((c: any) => typeof c.title === 'string' && c.title.length > 0));
  check('each carries an extraction time', staged.every((c: any) => typeof c.extractedAt === 'number'));
  equal('none has been reviewed', staged.filter((c: any) => c.reviewedAt !== undefined).length, 0);

  // Criterion 1 and forbidden change 1: staging writes nowhere else.
  const decisionsAfterExtract = await get(`/api/v1/projects/${PROJECT_A}/memory/decisions`);
  equal('extraction wrote nothing to project_decisions', decisionsAfterExtract.json().decisions, []);
  equal('and published no decision event', decisionEvents.length, 0);

  const threadScoped = await post(`/api/v1/projects/${PROJECT_A}/memory/candidates/extract`, { threadId: 'thread-2' });
  equal('a thread-scoped extraction returns 201', threadScoped.statusCode, 201);
  check('and stages from that thread', threadScoped.json().candidates.every((c: any) => /15 minutes/.test(c.title)), JSON.stringify(threadScoped.json().candidates.map((c: any) => c.title)));

  const emptyProject = await post(`/api/v1/projects/${PROJECT_B}/memory/candidates/extract`, {});
  equal('a project with no transcript stages nothing', emptyProject.json().extracted, 0);

  const unknownProject = await post('/api/v1/projects/cand-nope/memory/candidates/extract', {});
  equal('an unknown project stages nothing rather than erroring', unknownProject.json().extracted, 0);

  // --- Listing --------------------------------------------------------------
  describe('GET /memory/candidates');

  const listed = await get(`/api/v1/projects/${PROJECT_A}/memory/candidates`);
  equal('listing returns 200', listed.statusCode, 200);
  equal('all staged candidates are listed', listed.json().candidates.length, 3);

  const pending = await get(`/api/v1/projects/${PROJECT_A}/memory/candidates?status=PENDING`);
  equal('PENDING returns the same set', pending.json().candidates.length, 3);

  const approvedNone = await get(`/api/v1/projects/${PROJECT_A}/memory/candidates?status=APPROVED`);
  equal('APPROVED is empty before any review', approvedNone.json().candidates, []);

  const badStatus = await get(`/api/v1/projects/${PROJECT_A}/memory/candidates?status=MAYBE`);
  equal('an unrecognised status returns 400', badStatus.statusCode, 400);
  check('listing the valid values', /PENDING, APPROVED, REJECTED/.test(badStatus.json().error));

  const otherProject = await get(`/api/v1/projects/${PROJECT_B}/memory/candidates`);
  equal("another project sees none of A's candidates", otherProject.json().candidates, []);

  // --- Approval -------------------------------------------------------------
  describe('POST /memory/candidates/:id/approve');

  const target = staged[0];
  decisionEvents.length = 0;
  const approved = await post(`/api/v1/projects/${PROJECT_A}/memory/candidates/${target.id}/approve`, {});

  equal('approval returns 201', approved.statusCode, 201);
  const decision = approved.json().decision;
  equal('a decision is created', typeof decision?.id === 'string', true);
  equal('recorded as human-confirmed', decision.provenance, 'HUMAN_CONFIRMED');
  equal('at full confidence', decision.confidence, 1);
  equal('and ACTIVE', decision.status, 'ACTIVE');
  equal('in the right project', decision.projectId, PROJECT_A);
  equal('carrying the candidate title', decision.title, target.title);

  equal('memory.decision_created was published', decisionEvents.length, 1);
  equal('with the new decision', decisionEvents[0]?.payload?.decision?.id, decision.id);

  const afterApprove = await get(`/api/v1/projects/${PROJECT_A}/memory/candidates`);
  const reviewed = afterApprove.json().candidates.find((c: any) => c.id === target.id);
  equal('the candidate is APPROVED', reviewed.status, 'APPROVED');
  check('and stamped as reviewed', typeof reviewed.reviewedAt === 'number' && reviewed.reviewedAt > 0);

  const decisionsNow = await get(`/api/v1/projects/${PROJECT_A}/memory/decisions`);
  equal('exactly one decision exists', decisionsNow.json().decisions.length, 1);

  const reApprove = await post(`/api/v1/projects/${PROJECT_A}/memory/candidates/${target.id}/approve`, {});
  equal('approving twice returns 400', reApprove.statusCode, 400);
  check('saying it was already reviewed', /already been reviewed/.test(reApprove.json().error));
  equal('and creates no second decision', (await get(`/api/v1/projects/${PROJECT_A}/memory/decisions`)).json().decisions.length, 1);

  describe('approval with edits');

  const editable = staged[1];
  const edited = await post(`/api/v1/projects/${PROJECT_A}/memory/candidates/${editable.id}/approve`, {
    title: 'Corrected by the reviewer',
    constraints: ['Reviewed constraint']
  });
  equal('an edited approval returns 201', edited.statusCode, 201);
  equal('the reviewer title wins', edited.json().decision.title, 'Corrected by the reviewer');
  equal('the reviewer constraints win', edited.json().decision.constraints, ['Reviewed constraint']);
  equal('untouched fields come from the candidate', edited.json().decision.summary, editable.summary);
  equal('and it is still human-confirmed', edited.json().decision.provenance, 'HUMAN_CONFIRMED');

  // --- Rejection ------------------------------------------------------------
  describe('POST /memory/candidates/:id/reject');

  const toReject = (await get(`/api/v1/projects/${PROJECT_A}/memory/candidates?status=PENDING`)).json().candidates[0];
  const decisionsBeforeReject = (await get(`/api/v1/projects/${PROJECT_A}/memory/decisions`)).json().decisions.length;
  decisionEvents.length = 0;

  const rejected = await post(`/api/v1/projects/${PROJECT_A}/memory/candidates/${toReject.id}/reject`, {});
  equal('rejection returns 200', rejected.statusCode, 200);
  equal('the candidate is REJECTED', rejected.json().candidate.status, 'REJECTED');
  check('and stamped as reviewed', typeof rejected.json().candidate.reviewedAt === 'number');

  equal(
    'project_decisions is unchanged (criterion 4)',
    (await get(`/api/v1/projects/${PROJECT_A}/memory/decisions`)).json().decisions.length,
    decisionsBeforeReject
  );
  equal('and no event was published', decisionEvents.length, 0);

  const approveRejected = await post(`/api/v1/projects/${PROJECT_A}/memory/candidates/${toReject.id}/approve`, {});
  equal('a rejected candidate cannot then be approved', approveRejected.statusCode, 400);

  // --- Boundaries -----------------------------------------------------------
  describe('project boundaries');

  const freshExtract = await post(`/api/v1/projects/${PROJECT_A}/memory/candidates/extract`, { threadId: 'thread-1' });
  const crossTarget = freshExtract.json().candidates[0];

  const crossApprove = await post(`/api/v1/projects/${PROJECT_B}/memory/candidates/${crossTarget.id}/approve`, {});
  equal("approving another project's candidate returns 400", crossApprove.statusCode, 400);
  equal(
    'and creates nothing in that project',
    (await get(`/api/v1/projects/${PROJECT_B}/memory/decisions`)).json().decisions,
    []
  );

  const crossReject = await post(`/api/v1/projects/${PROJECT_B}/memory/candidates/${crossTarget.id}/reject`, {});
  equal("rejecting another project's candidate returns 400", crossReject.statusCode, 400);
  equal(
    'and leaves it PENDING',
    (await get(`/api/v1/projects/${PROJECT_A}/memory/candidates`)).json().candidates.find((c: any) => c.id === crossTarget.id).status,
    'PENDING'
  );

  const missingApprove = await post(`/api/v1/projects/${PROJECT_A}/memory/candidates/no-such-id/approve`, {});
  equal('an unknown candidate returns 404 on approve', missingApprove.statusCode, 404);
  const missingReject = await post(`/api/v1/projects/${PROJECT_A}/memory/candidates/no-such-id/reject`, {});
  equal('and 404 on reject', missingReject.statusCode, 404);

  describe('human-confirmed decisions survive rejection');

  const humanDecision = await post(`/api/v1/projects/${PROJECT_A}/memory/decisions`, {
    title: 'A decision a person made directly',
    summary: 's',
    rationale: 'r'
  });
  const humanId = humanDecision.json().decision.id;
  const stillPending = (await get(`/api/v1/projects/${PROJECT_A}/memory/candidates?status=PENDING`)).json().candidates;
  for (const candidate of stillPending) {
    await post(`/api/v1/projects/${PROJECT_A}/memory/candidates/${candidate.id}/reject`, {});
  }
  const survivors = (await get(`/api/v1/projects/${PROJECT_A}/memory/decisions`)).json().decisions;
  check(
    'rejecting every candidate deletes no existing decision (forbidden change 3)',
    survivors.some((d: any) => d.id === humanId),
    `${survivors.length} decisions remain`
  );

  eventBus.unsubscribe('memory.decision_created', listener);
  await app.close();
}

main()
  .catch(err => {
    failed++;
    console.error('\nUNCAUGHT ERROR:', err);
  })
  .finally(() => {
    cleanup();
    console.log(`\n${passed}/${passed + failed} assertions passed`);
    if (failures.length > 0) {
      console.log('Failed assertions:');
      for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed === 0 ? 0 : 1);
  });
