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
  const patch = (url: string, payload: unknown) => app.inject({ method: 'PATCH', url, payload });

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

  // --- Decisions: status lifecycle -----------------------------------------
  describe('PATCH /memory/decisions/:decisionId/status');

  const lifecycle = await post(`/api/v1/projects/${PROJECT_A}/memory/decisions`, {
    title: 'A decision that will be retired',
    summary: 's',
    rationale: 'r'
  });
  const lifecycleId = lifecycle.json().decision.id;
  equal('it starts ACTIVE', lifecycle.json().decision.status, 'ACTIVE');

  const toStale = await patch(
    `/api/v1/projects/${PROJECT_A}/memory/decisions/${lifecycleId}/status`,
    { status: 'STALE' }
  );
  equal('a valid transition returns 200', toStale.statusCode, 200);
  equal('the response carries the updated decision', toStale.json().decision.id, lifecycleId);
  equal('the new status is applied', toStale.json().decision.status, 'STALE');
  equal('the decision stays in its project', toStale.json().decision.projectId, PROJECT_A);
  check(
    'updated_at moves forward',
    toStale.json().decision.updatedAt >= lifecycle.json().decision.updatedAt,
    `${toStale.json().decision.updatedAt} vs ${lifecycle.json().decision.updatedAt}`
  );

  const persisted = await get(`/api/v1/projects/${PROJECT_A}/memory/decisions?status=STALE`);
  equal('the change is persisted, not just echoed', persisted.json().decisions.map((d: any) => d.id), [lifecycleId]);

  const briefingAfterStale = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing`);
  check(
    'a non-ACTIVE decision drops out of the briefing',
    !briefingAfterStale.json().briefing.activeDecisions.some((d: any) => d.id === lifecycleId)
  );

  const backToActive = await patch(
    `/api/v1/projects/${PROJECT_A}/memory/decisions/${lifecycleId}/status`,
    { status: 'ACTIVE' }
  );
  equal('a decision can be moved back to ACTIVE', backToActive.json().decision.status, 'ACTIVE');
  const briefingAfterRestore = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing`);
  check(
    'and reappears in the briefing',
    briefingAfterRestore.json().briefing.activeDecisions.some((d: any) => d.id === lifecycleId)
  );

  const archived = await patch(
    `/api/v1/projects/${PROJECT_A}/memory/decisions/${lifecycleId}/status`,
    { status: 'ARCHIVED' }
  );
  equal('archiving works through the same endpoint', archived.json().decision.status, 'ARCHIVED');

  const noStatus = await patch(`/api/v1/projects/${PROJECT_A}/memory/decisions/${lifecycleId}/status`, {});
  equal('a missing status returns 400', noStatus.statusCode, 400);
  check('the 400 says status is required', /status is required/.test(noStatus.json().error));

  const unknownStatus = await patch(
    `/api/v1/projects/${PROJECT_A}/memory/decisions/${lifecycleId}/status`,
    { status: 'RETIRED' }
  );
  equal('an unrecognised status returns 400', unknownStatus.statusCode, 400);
  check('the 400 lists the valid statuses', /ACTIVE, STALE, SUPERSEDED, ARCHIVED/.test(unknownStatus.json().error));

  const lowercase = await patch(
    `/api/v1/projects/${PROJECT_A}/memory/decisions/${lifecycleId}/status`,
    { status: 'active' }
  );
  equal('status matching is case-sensitive', lowercase.statusCode, 400);

  const missingDecision = await patch(
    `/api/v1/projects/${PROJECT_A}/memory/decisions/no-such-decision/status`,
    { status: 'ARCHIVED' }
  );
  equal('an unknown decision returns 404', missingDecision.statusCode, 404);

  // The decision exists, but belongs to Project A. Asking as Project B must fail.
  const crossProject = await patch(
    `/api/v1/projects/${PROJECT_B}/memory/decisions/${lifecycleId}/status`,
    { status: 'ACTIVE' }
  );
  equal('a cross-project status change returns 400', crossProject.statusCode, 400);
  // Read defensively: if the guard ever regresses the body has no `error` at all,
  // and an assertion that throws would abort the run and hide every check after it.
  const crossError = String(crossProject.json().error ?? '');
  check('the error names the decision', crossError.includes(lifecycleId), crossError);
  check(
    'and does not disclose the owning project',
    crossError.length > 0 && !crossError.includes(PROJECT_A),
    'see blueprint/audit/IMPLEMENTATION_DRIFT.md § 8'
  );

  const stillArchived = await get(`/api/v1/projects/${PROJECT_A}/memory/decisions?status=ARCHIVED`);
  check(
    'the rejected cross-project write changed nothing',
    stillArchived.json().decisions.some((d: any) => d.id === lifecycleId),
    'the decision should still be ARCHIVED'
  );

  // --- Drift ----------------------------------------------------------------
  describe('GET /memory/drift');

  // PROJECT_A's path is /tmp/route-a, which does not exist, so every anchored
  // file is missing — exactly the FILE_DELETED case, without needing a repo here
  // (GitDriftDetector.test.ts covers the git paths against a real repository).
  const anchored = await post(`/api/v1/projects/${PROJECT_A}/memory/decisions`, {
    title: 'Anchored to a file that is not there',
    summary: 's',
    rationale: 'r',
    relatedFiles: ['src/vanished.ts']
  });
  const anchoredId = anchored.json().decision.id;

  const drift = await get(`/api/v1/projects/${PROJECT_A}/memory/drift`);
  equal('the drift endpoint returns 200', drift.statusCode, 200);
  const driftBody = drift.json().drift;
  check('it is keyed by decision id', typeof driftBody === 'object' && driftBody !== null);
  check('the anchored decision is present', anchoredId in driftBody, Object.keys(driftBody).join(','));
  equal('and reports drift', driftBody[anchoredId]?.drifted, true);
  equal('as a missing file', driftBody[anchoredId]?.worst, 'FILE_DELETED');
  check('naming the anchor', driftBody[anchoredId]?.refs?.[0]?.filePath === 'src/vanished.ts');

  const unanchoredDrift = driftBody[decisionId];
  if (unanchoredDrift) {
    equal('a decision with no anchors is not drifted', unanchoredDrift.drifted, false);
  }

  const emptyDrift = await get(`/api/v1/projects/${PROJECT_B}/memory/drift`);
  equal('a project with no decisions returns an empty map', emptyDrift.json().drift, {});

  const unknownDrift = await get(`/api/v1/projects/${UNKNOWN_PROJECT}/memory/drift`);
  equal('an unknown project returns 200 with nothing', unknownDrift.statusCode, 200);
  equal('and no drift', unknownDrift.json().drift, {});

  describe('drift is opt-in on the briefing');

  const plainBriefing = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing`);
  const plainActive = plainBriefing.json().briefing.activeDecisions.find((d: any) => d.id === anchoredId);
  equal('the briefing carries no drift by default', plainActive?.drift, undefined);

  const driftBriefing = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing?drift=true`);
  const driftedActive = driftBriefing.json().briefing.activeDecisions.find((d: any) => d.id === anchoredId);
  equal('asking for drift attaches it', driftedActive?.drift?.drifted, true);
  equal('with the same verdict as the drift endpoint', driftedActive?.drift?.worst, 'FILE_DELETED');

  const cleanInBriefing = driftBriefing.json().briefing.activeDecisions.find((d: any) => d.id === decisionId);
  equal('a clean decision carries no drift key even when asked', cleanInBriefing?.drift, undefined);

  describe('drift never mutates the decision (DEC-027)');

  const afterDrift = await get(`/api/v1/projects/${PROJECT_A}/memory/decisions`);
  const stillActive = afterDrift.json().decisions.find((d: any) => d.id === anchoredId);
  equal('the drifted decision is still ACTIVE', stillActive?.status, 'ACTIVE');
  equal('and its stored row carries no drift column', stillActive?.drift, undefined);

  // --- Scoped briefings (P5.4-04) -------------------------------------------
  describe('GET /memory/briefing — scoping');

  // Order matters: the target is recorded *first* and a decoy after it. Ties break
  // on recency, so if scoping were a no-op the decoy would win every assertion
  // below — which is exactly how an earlier version of this block passed against a
  // route that ignored `?files` entirely.
  const scopedTarget = await post(`/api/v1/projects/${PROJECT_A}/memory/decisions`, {
    title: 'Rotate the signing key quarterly',
    summary: 'Keys live no longer than 90 days.',
    rationale: 'Limits the blast radius of a leak.',
    relatedFiles: ['src/security/keys.ts']
  });
  const scopedTargetId = scopedTarget.json().decision.id;

  const decoy = await post(`/api/v1/projects/${PROJECT_A}/memory/decisions`, {
    title: 'Use tabs in the theme file',
    summary: 'Indentation is tabs.',
    rationale: 'Matches the editor default.',
    relatedFiles: ['src/ui/theme.ts']
  });
  const decoyId = decoy.json().decision.id;

  const unscopedBriefing = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing`);
  const unscopedDecisions = unscopedBriefing.json().briefing.activeDecisions;
  check('an unscoped briefing still returns every active decision', unscopedDecisions.length >= 3, `${unscopedDecisions.length}`);
  equal(
    'and carries no relevance score, so the old response shape is unchanged',
    unscopedDecisions[0].relevanceScore,
    undefined
  );

  const limited = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing?limit=1`);
  equal('?limit caps the decisions', limited.json().briefing.activeDecisions.length, 1);
  check(
    'while every architectural rule survives the cap',
    limited.json().briefing.architecturalRules.length === unscopedBriefing.json().briefing.architecturalRules.length,
    'rules are governance invariants, not context filler'
  );
  equal(
    'and so does the intent',
    limited.json().briefing.currentIntent?.id,
    unscopedBriefing.json().briefing.currentIntent?.id
  );

  // The control for every ranking assertion below: unscoped, the newest decision
  // wins. Anything that displaces it did so because of the scope, not the clock.
  equal('unscoped, the most recent decision leads', limited.json().briefing.activeDecisions[0]?.id, decoyId);

  const byFile = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing?files=src/security/keys.ts&limit=1`);
  equal(
    '?files promotes the decision anchored to that file over a newer one',
    byFile.json().briefing.activeDecisions[0]?.id,
    scopedTargetId
  );
  check(
    'and the returned decision explains its own rank',
    typeof byFile.json().briefing.activeDecisions[0]?.relevanceScore === 'number'
  );

  const byFolder = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing?files=src/security&limit=1`);
  equal(
    'a folder in ?files matches the files under it',
    byFolder.json().briefing.activeDecisions[0]?.id,
    scopedTargetId
  );

  const wrongFolder = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing?files=src/sec&limit=1`);
  equal(
    'but a partial folder name does not — src/sec is not src/security',
    wrongFolder.json().briefing.activeDecisions[0]?.id,
    decoyId
  );

  const byTask = await get(
    `/api/v1/projects/${PROJECT_A}/memory/briefing?task=${encodeURIComponent('rotate the signing key')}&limit=1`
  );
  equal(
    '?task promotes the lexically closest decision over a newer one',
    byTask.json().briefing.activeDecisions[0]?.id,
    scopedTargetId
  );

  const multiFile = await get(
    `/api/v1/projects/${PROJECT_A}/memory/briefing?files=src/security/keys.ts,src/vanished.ts&limit=2`
  );
  const multiIds = multiFile.json().briefing.activeDecisions.map((d: any) => d.id);
  check(
    'a comma-separated ?files list matches every path in it',
    multiIds.includes(scopedTargetId) && multiIds.includes(anchoredId),
    multiIds.join(',')
  );
  check('and leaves the newer unrelated decision out', !multiIds.includes(decoyId), multiIds.join(','));

  const emptyFiles = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing?files=`);
  equal('an empty ?files is not an error', emptyFiles.statusCode, 200);
  check('and still returns the decisions', emptyFiles.json().briefing.activeDecisions.length > 0);

  const zeroLimit = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing?limit=0`);
  equal('?limit=0 returns no decisions', zeroLimit.json().briefing.activeDecisions.length, 0);
  check(
    'but still every rule',
    zeroLimit.json().briefing.architecturalRules.length === unscopedBriefing.json().briefing.architecturalRules.length,
    'a limit must never be able to silence governance'
  );
  equal('and still the intent', zeroLimit.json().briefing.currentIntent?.id, unscopedBriefing.json().briefing.currentIntent?.id);

  const negativeLimit = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing?limit=-1`);
  equal('a negative ?limit is rejected', negativeLimit.statusCode, 400);
  check('with a message naming the value', negativeLimit.json().error.includes('-1'), negativeLimit.json().error);

  const nonNumericLimit = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing?limit=lots`);
  equal('a non-numeric ?limit is rejected', nonNumericLimit.statusCode, 400);

  const scopedWithDrift = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing?drift=true&files=src/vanished.ts&limit=5`);
  equal('scoping and drift compose', scopedWithDrift.statusCode, 200);
  const driftedScoped = scopedWithDrift.json().briefing.activeDecisions.find((d: any) => d.id === anchoredId);
  check('the drifted decision is still returned, not filtered out (DEC-027)', driftedScoped !== undefined);
  equal('carrying its drift annotation', driftedScoped?.drift?.drifted, true);

  const repeat1 = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing?task=signing%20key&files=src&limit=3`);
  const repeat2 = await get(`/api/v1/projects/${PROJECT_A}/memory/briefing?task=signing%20key&files=src&limit=3`);
  equal('the same scoped request returns a byte-identical briefing', repeat1.body, repeat2.body);

  const unknownScoped = await get(`/api/v1/projects/${UNKNOWN_PROJECT}/memory/briefing?task=anything&limit=3`);
  equal('scoping an unknown project is not an error', unknownScoped.statusCode, 200);
  equal('it simply has nothing to rank', unknownScoped.json().briefing.activeDecisions, []);

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
