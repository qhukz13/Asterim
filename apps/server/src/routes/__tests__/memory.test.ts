/**
 * HTTP tests for the Project Memory REST surface (P5.0-08).
 *
 * The repository has no test runner (docs/p5.0-01-verification-report.md § 3), so this
 * is a standalone script with its own assertion harness. Requests go through
 * fastify.inject(), so the full routing, serialization and status-code path is
 * exercised without binding a port.
 *
 * ASTERIM_DATA_DIR is pointed at a temp directory before the service modules load —
 * DatabaseService exports a singleton constructed at import time, so `require` is
 * used instead of `import`, whose bindings would hoist above the assignment.
 *
 * Run:  pnpm --filter asterim exec tsx src/routes/__tests__/memory.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-memory-routes-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

const Fastify = require('fastify');
const { dbService } = require('../../services/DatabaseService');
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
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

const PROJECT_A = 'route-project-a';
const PROJECT_B = 'route-project-b';
const UNKNOWN_PROJECT = 'route-project-missing';

async function main(): Promise<void> {
  const app = Fastify();
  await app.register(memoryRoutes);
  await app.ready();

  const insertProject = dbService.getDb().prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)');
  insertProject.run(PROJECT_A, 'Route Project A', '/tmp/route-a');
  insertProject.run(PROJECT_B, 'Route Project B', '/tmp/route-b');

  const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload });
  const get = (url: string) => app.inject({ method: 'GET', url });

  // --- Decisions: create --------------------------------------------------
  describe('POST /memory/decisions');

  const created = await post(`/api/v1/projects/${PROJECT_A}/memory/decisions`, {
    title: 'Use node:sqlite',
    summary: 'Persistence is node:sqlite.',
    rationale: 'No native build step.',
    constraints: ['Idempotent schema changes'],
    provenance: 'REPOSITORY_EVIDENCE',
    confidence: 0.8,
    relatedFiles: ['apps/server/src/services/DatabaseService.ts']
  });

  equal('creating a decision returns 201', created.statusCode, 201);
  const createdBody = created.json();
  check('the response carries the decision', typeof createdBody.decision?.id === 'string');
  equal('the projectId comes from the path, not the body', createdBody.decision.projectId, PROJECT_A);
  equal('the decision starts ACTIVE', createdBody.decision.status, 'ACTIVE');
  equal('provenance is persisted', createdBody.decision.provenance, 'REPOSITORY_EVIDENCE');
  equal('confidence is persisted', createdBody.decision.confidence, 0.8);
  equal('relatedFiles round-trips', createdBody.decision.relatedFiles, [
    'apps/server/src/services/DatabaseService.ts'
  ]);
  equal('content-type is JSON', created.headers['content-type']?.includes('application/json'), true);

  const decisionId = createdBody.decision.id;

  const missingFields = await post(`/api/v1/projects/${PROJECT_A}/memory/decisions`, { title: 'Only a title' });
  equal('a decision missing required fields returns 400', missingFields.statusCode, 400);
  check('the 400 explains what is required', /required/.test(missingFields.json().error));

  const emptyBody = await post(`/api/v1/projects/${PROJECT_A}/memory/decisions`, {});
  equal('an empty body returns 400', emptyBody.statusCode, 400);

  const badProvenance = await post(`/api/v1/projects/${PROJECT_A}/memory/decisions`, {
    title: 't',
    summary: 's',
    rationale: 'r',
    provenance: 'GUESSED'
  });
  equal('an unrecognised provenance returns 400', badProvenance.statusCode, 400);
  check('the 400 names the offending field', /provenance/.test(badProvenance.json().error));

  const unknownProject = await post(`/api/v1/projects/${UNKNOWN_PROJECT}/memory/decisions`, {
    title: 't',
    summary: 's',
    rationale: 'r'
  });
  equal('a decision for an unknown project returns 404', unknownProject.statusCode, 404);
  equal('the 404 says the project is missing', unknownProject.json().error, 'Project not found');

  // --- Decisions: list ----------------------------------------------------
  describe('GET /memory/decisions');

  const listed = await get(`/api/v1/projects/${PROJECT_A}/memory/decisions`);
  equal('listing decisions returns 200', listed.statusCode, 200);
  equal('the list contains the created decision', listed.json().decisions.length, 1);
  equal('the listed decision is the right one', listed.json().decisions[0].id, decisionId);

  const filtered = await get(`/api/v1/projects/${PROJECT_A}/memory/decisions?status=ACTIVE`);
  equal('filtering by ACTIVE returns 200', filtered.statusCode, 200);
  equal('the ACTIVE filter matches', filtered.json().decisions.length, 1);

  const filteredEmpty = await get(`/api/v1/projects/${PROJECT_A}/memory/decisions?status=ARCHIVED`);
  equal('a filter with no matches returns 200', filteredEmpty.statusCode, 200);
  equal('a filter with no matches returns an empty list', filteredEmpty.json().decisions, []);

  const badStatus = await get(`/api/v1/projects/${PROJECT_A}/memory/decisions?status=active`);
  equal('a lowercase status is rejected with 400', badStatus.statusCode, 400);
  check('the 400 lists the accepted values', /ACTIVE, STALE, SUPERSEDED, ARCHIVED/.test(badStatus.json().error));

  const emptyProjectList = await get(`/api/v1/projects/${UNKNOWN_PROJECT}/memory/decisions`);
  equal('listing an unknown project returns 200 with an empty list', emptyProjectList.statusCode, 200);
  equal('an unknown project has no decisions', emptyProjectList.json().decisions, []);

  // --- Decisions: supersede -----------------------------------------------
  describe('POST /memory/decisions/:decisionId/supersede');

  const superseded = await post(
    `/api/v1/projects/${PROJECT_A}/memory/decisions/${decisionId}/supersede`,
    { title: 'Use Postgres', summary: 'Moved off SQLite.', rationale: 'Multi-user.' }
  );
  equal('superseding returns 201', superseded.statusCode, 201);
  const replacement = superseded.json().decision;
  equal('the replacement is ACTIVE', replacement.status, 'ACTIVE');
  equal('the replacement links back to what it replaced', replacement.supersededBy, decisionId);

  const afterSupersede = await get(`/api/v1/projects/${PROJECT_A}/memory/decisions?status=SUPERSEDED`);
  equal('the old decision is now SUPERSEDED', afterSupersede.json().decisions[0].id, decisionId);
  equal(
    'the old decision points at its replacement',
    afterSupersede.json().decisions[0].supersededBy,
    replacement.id
  );

  const supersedeMissing = await post(
    `/api/v1/projects/${PROJECT_A}/memory/decisions/no-such-decision/supersede`,
    { title: 't', summary: 's', rationale: 'r' }
  );
  equal('superseding an unknown decision returns 404', supersedeMissing.statusCode, 404);
  check('the 404 names the missing decision', /not found/.test(supersedeMissing.json().error));

  const supersedeCrossProject = await post(
    `/api/v1/projects/${PROJECT_B}/memory/decisions/${replacement.id}/supersede`,
    { title: 't', summary: 's', rationale: 'r' }
  );
  equal('superseding across projects returns 400', supersedeCrossProject.statusCode, 400);
  check('the 400 explains the project conflict', /across projects/.test(supersedeCrossProject.json().error));

  const supersedeNoBody = await post(
    `/api/v1/projects/${PROJECT_A}/memory/decisions/${replacement.id}/supersede`,
    {}
  );
  equal('superseding without required fields returns 400', supersedeNoBody.statusCode, 400);

  // --- Intents -------------------------------------------------------------
  describe('/memory/intents');

  const noIntent = await get(`/api/v1/projects/${PROJECT_A}/memory/intents/active`);
  equal('a project with no intent returns 200', noIntent.statusCode, 200);
  equal('a project with no intent returns null, not 404', noIntent.json().intent, null);

  const intent1 = await post(`/api/v1/projects/${PROJECT_A}/memory/intents`, {
    goal: 'Ship Project Memory',
    constraints: ['No new deps'],
    nonGoals: ['Rewrites']
  });
  equal('creating an intent returns 201', intent1.statusCode, 201);
  equal('the intent is ACTIVE', intent1.json().intent.status, 'ACTIVE');
  equal('nonGoals round-trip', intent1.json().intent.nonGoals, ['Rewrites']);

  const activeIntent = await get(`/api/v1/projects/${PROJECT_A}/memory/intents/active`);
  equal('the active intent is returned with 200', activeIntent.statusCode, 200);
  equal('the active intent is the one just created', activeIntent.json().intent.id, intent1.json().intent.id);

  const intent2 = await post(`/api/v1/projects/${PROJECT_A}/memory/intents`, { goal: 'Ship the REST surface' });
  equal('replacing an intent returns 201', intent2.statusCode, 201);
  const activeAfter = await get(`/api/v1/projects/${PROJECT_A}/memory/intents/active`);
  equal('the newest intent becomes active', activeAfter.json().intent.id, intent2.json().intent.id);

  const intentNoGoal = await post(`/api/v1/projects/${PROJECT_A}/memory/intents`, {});
  equal('an intent without a goal returns 400', intentNoGoal.statusCode, 400);
  check('the 400 names the missing field', /goal/.test(intentNoGoal.json().error));

  const intentUnknownProject = await post(`/api/v1/projects/${UNKNOWN_PROJECT}/memory/intents`, { goal: 'g' });
  equal('an intent for an unknown project returns 404', intentUnknownProject.statusCode, 404);

  // --- Rules ---------------------------------------------------------------
  describe('/memory/rules');

  const rule = await post(`/api/v1/projects/${PROJECT_A}/memory/rules`, {
    title: 'No hardcoded colors',
    statement: 'Use the tokens in tokens.css.',
    severity: 'error',
    scopePattern: 'apps/web/src/**'
  });
  equal('creating a rule returns 201', rule.statusCode, 201);
  equal('severity is persisted', rule.json().rule.severity, 'error');
  equal('scopePattern is persisted', rule.json().rule.scopePattern, 'apps/web/src/**');

  const defaultedRule = await post(`/api/v1/projects/${PROJECT_A}/memory/rules`, {
    title: 'Reference the Blueprint',
    statement: 'Do not duplicate rationale into comments.'
  });
  equal('a rule without a severity returns 201', defaultedRule.statusCode, 201);
  equal('severity defaults to warning', defaultedRule.json().rule.severity, 'warning');

  const badSeverity = await post(`/api/v1/projects/${PROJECT_A}/memory/rules`, {
    title: 't',
    statement: 's',
    severity: 'critical'
  });
  equal('an unrecognised severity returns 400', badSeverity.statusCode, 400);
  check('the 400 names the offending field', /severity/.test(badSeverity.json().error));

  const ruleMissing = await post(`/api/v1/projects/${PROJECT_A}/memory/rules`, { title: 'Only a title' });
  equal('a rule without a statement returns 400', ruleMissing.statusCode, 400);

  const ruleUnknownProject = await post(`/api/v1/projects/${UNKNOWN_PROJECT}/memory/rules`, {
    title: 't',
    statement: 's'
  });
  equal('a rule for an unknown project returns 404', ruleUnknownProject.statusCode, 404);

  const rules = await get(`/api/v1/projects/${PROJECT_A}/memory/rules`);
  equal('listing rules returns 200', rules.statusCode, 200);
  equal('both rules are listed', rules.json().rules.length, 2);
  equal('rules are newest first', rules.json().rules[0].id, defaultedRule.json().rule.id);

  // --- Briefing -------------------------------------------------------------
  describe('GET /memory/briefing');

  const briefing = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing`);
  equal('the briefing returns 200', briefing.statusCode, 200);
  const b = briefing.json().briefing;
  equal('the briefing carries the projectId', b.projectId, PROJECT_A);
  equal('the briefing lists only ACTIVE decisions', b.activeDecisions.length, 1);
  equal('the briefing decision is the replacement', b.activeDecisions[0].id, replacement.id);
  equal('the briefing lists the rules', b.architecturalRules.length, 2);
  equal('the briefing carries the active intent', b.currentIntent.id, intent2.json().intent.id);
  equal('the briefing has no agent work yet', b.recentAgentWork, []);
  equal('the briefing has no approvals yet', b.recentApprovals, []);
  equal(
    'the briefing exposes exactly the six keys',
    Object.keys(b).sort(),
    ['activeDecisions', 'architecturalRules', 'currentIntent', 'projectId', 'recentAgentWork', 'recentApprovals']
  );

  const emptyBriefing = await get(`/api/v1/projects/${PROJECT_B}/memory/briefing`);
  equal('an untouched project still briefs with 200', emptyBriefing.statusCode, 200);
  equal('an untouched project has no decisions', emptyBriefing.json().briefing.activeDecisions, []);
  equal('an untouched project has a null intent', emptyBriefing.json().briefing.currentIntent, null);

  // --- Project isolation over HTTP -----------------------------------------
  describe('project isolation over HTTP');

  const bDecisions = await get(`/api/v1/projects/${PROJECT_B}/memory/decisions`);
  equal('Project B sees none of Project A decisions', bDecisions.json().decisions, []);
  const bRules = await get(`/api/v1/projects/${PROJECT_B}/memory/rules`);
  equal('Project B sees none of Project A rules', bRules.json().rules, []);
  const bIntent = await get(`/api/v1/projects/${PROJECT_B}/memory/intents/active`);
  equal('Project B sees none of Project A intent', bIntent.json().intent, null);

  // --- Routing --------------------------------------------------------------
  describe('routing');

  const wrongMethod = await app.inject({ method: 'DELETE', url: `/api/v1/projects/${PROJECT_A}/memory/rules` });
  equal('an unsupported method returns 404', wrongMethod.statusCode, 404);

  const unknownPath = await get(`/api/v1/projects/${PROJECT_A}/memory/nope`);
  equal('an unknown memory path returns 404', unknownPath.statusCode, 404);

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
