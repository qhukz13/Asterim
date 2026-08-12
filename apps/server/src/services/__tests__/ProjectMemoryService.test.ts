/**
 * Unit tests for ProjectMemoryService (P5.0-04).
 *
 * The repository has no test runner (docs/p5.0-01-verification-report.md § 3), so this
 * file is a standalone script with its own assertion harness rather than a spec for
 * vitest/jest. Run it with:
 *
 *   pnpm --filter asterim exec tsx src/services/__tests__/ProjectMemoryService.test.ts
 *
 * ASTERIM_DATA_DIR is set before the service modules are loaded. DatabaseService exports
 * a singleton constructed at import time, so `require` is used instead of `import` —
 * ESM import bindings are hoisted and would initialise the real ~/.asterim/asterim.db.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-memory-test-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

const { dbService } = require('../DatabaseService');
const { projectMemoryService } = require('../ProjectMemoryService');
const { eventBus } = require('../EventBus');

// --- Minimal assertion harness ---

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

function throws(label: string, fn: () => void): void {
  try {
    fn();
    check(label, false, 'expected a throw, but the call succeeded');
  } catch {
    check(label, true);
  }
}

function describe(name: string): void {
  console.log(`\n${name}`);
}

/** Busy-waits until Date.now() advances, so created_at values are distinct and ordering is deterministic. */
function tick(): void {
  const start = Date.now();
  while (Date.now() === start) {
    /* spin */
  }
}

function cleanup(): void {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

// --- Fixtures ---

const PROJECT_A = 'project-a';
const PROJECT_B = 'project-b';

function seedProjects(): void {
  const db = dbService.getDb();
  const insert = db.prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)');
  insert.run(PROJECT_A, 'Project A', '/tmp/project-a');
  insert.run(PROJECT_B, 'Project B', '/tmp/project-b');
}

try {
  check('test database is isolated in the temp directory', dbService.dbPath.startsWith(tmpDir), dbService.dbPath);
  seedProjects();

  // --- createDecision & getDecision ---------------------------------------
  describe('createDecision & getDecision');

  const decision = projectMemoryService.createDecision({
    projectId: PROJECT_A,
    title: 'Use SQLite via node:sqlite',
    summary: 'Persistence is node:sqlite, not better-sqlite3.',
    rationale: 'Zero native build step for the packaged binary.',
    constraints: ['No migration framework', 'Schema changes must stay idempotent'],
    provenance: 'REPOSITORY_EVIDENCE',
    confidence: 0.9
  });

  check('createDecision returns a generated id', typeof decision.id === 'string' && decision.id.length > 0);
  equal('projectId is persisted', decision.projectId, PROJECT_A);
  equal('title is persisted', decision.title, 'Use SQLite via node:sqlite');
  equal('constraints round-trip through JSON', decision.constraints, [
    'No migration framework',
    'Schema changes must stay idempotent'
  ]);
  equal('provenance is persisted', decision.provenance, 'REPOSITORY_EVIDENCE');
  equal('confidence is persisted', decision.confidence, 0.9);
  equal('status defaults to ACTIVE', decision.status, 'ACTIVE');
  equal('supersededBy is null on a new decision', decision.supersededBy, null);
  equal('codeRefs is empty when none were supplied', decision.codeRefs, []);
  equal('relatedFiles is empty when none were supplied', decision.relatedFiles, []);
  check('createdAt is a timestamp', typeof decision.createdAt === 'number' && decision.createdAt > 0);
  equal('updatedAt equals createdAt on insert', decision.updatedAt, decision.createdAt);

  const fetched = projectMemoryService.getDecision(decision.id);
  equal('getDecision returns the same record', fetched, decision);
  equal('getDecision returns null for an unknown id', projectMemoryService.getDecision('nope'), null);

  // --- Validation -----------------------------------------------------------
  describe('input validation');

  const clampedHigh = projectMemoryService.createDecision({
    projectId: PROJECT_A,
    title: 'Clamp high',
    summary: 's',
    rationale: 'r',
    confidence: 4.2
  });
  equal('confidence above 1 is clamped to 1.0', clampedHigh.confidence, 1.0);

  const clampedLow = projectMemoryService.createDecision({
    projectId: PROJECT_A,
    title: 'Clamp low',
    summary: 's',
    rationale: 'r',
    confidence: -3
  });
  equal('confidence below 0 is clamped to 0', clampedLow.confidence, 0);

  const defaulted = projectMemoryService.createDecision({
    projectId: PROJECT_A,
    title: 'Default confidence',
    summary: 's',
    rationale: 'r'
  });
  equal('confidence defaults to 1.0', defaulted.confidence, 1.0);
  equal('provenance defaults to HUMAN_CONFIRMED', defaulted.provenance, 'HUMAN_CONFIRMED');

  throws('an unrecognised status is rejected', () =>
    projectMemoryService.createDecision({
      projectId: PROJECT_A,
      title: 'Bad status',
      summary: 's',
      rationale: 'r',
      status: 'active'
    })
  );
  throws('an unrecognised provenance is rejected', () =>
    projectMemoryService.createDecision({
      projectId: PROJECT_A,
      title: 'Bad provenance',
      summary: 's',
      rationale: 'r',
      provenance: 'GUESSED'
    })
  );
  throws('an empty title is rejected', () =>
    projectMemoryService.createDecision({
      projectId: PROJECT_A,
      title: '   ',
      summary: 's',
      rationale: 'r'
    })
  );
  throws('a decision for an unknown project is rejected by the foreign key', () =>
    projectMemoryService.createDecision({
      projectId: 'project-does-not-exist',
      title: 'Orphan',
      summary: 's',
      rationale: 'r'
    })
  );

  const decisionCountBefore = projectMemoryService.listDecisions(PROJECT_A).length;

  // --- Code references & findRelevantDecisions -----------------------------
  describe('code references & findRelevantDecisions');

  tick();
  const anchored = projectMemoryService.createDecision({
    projectId: PROJECT_A,
    title: 'EventBus is the only async channel',
    summary: 'All asynchronous work flows through the EventBus singleton.',
    rationale: 'ADR-008.',
    codeRefs: [
      { filePath: 'apps/server/src/services/EventBus.ts', symbolName: 'EventBus', commitHash: 'abc1234' },
      { filePath: 'apps/server/src/services/AgentService.ts' }
    ],
    relatedFiles: ['apps/server/src/sockets/socketManager.ts']
  });

  equal('explicit and derived code refs are both stored', anchored.codeRefs.length, 3);
  equal(
    'relatedFiles is derived from the code refs',
    [...anchored.relatedFiles].sort(),
    [
      'apps/server/src/services/AgentService.ts',
      'apps/server/src/services/EventBus.ts',
      'apps/server/src/sockets/socketManager.ts'
    ]
  );
  const eventBusRef = anchored.codeRefs.find(
    (r: { filePath?: string }) => r.filePath === 'apps/server/src/services/EventBus.ts'
  );
  equal('symbolName is persisted', eventBusRef.symbolName, 'EventBus');
  equal('commitHash is persisted', eventBusRef.commitHash, 'abc1234');
  equal('decisionId back-reference is set', eventBusRef.decisionId, anchored.id);
  const bareRef = anchored.codeRefs.find(
    (r: { filePath?: string }) => r.filePath === 'apps/server/src/services/AgentService.ts'
  );
  equal('an omitted symbolName reads back as undefined', bareRef.symbolName, undefined);

  const duplicated = projectMemoryService.createDecision({
    projectId: PROJECT_A,
    title: 'Dedup check',
    summary: 's',
    rationale: 'r',
    codeRefs: [{ filePath: 'src/dup.ts', symbolName: 'thing' }],
    relatedFiles: ['src/dup.ts']
  });
  equal('a relatedFile already covered by a code ref is not duplicated', duplicated.codeRefs.length, 1);

  const relevant = projectMemoryService.findRelevantDecisions(
    PROJECT_A,
    'apps/server/src/services/EventBus.ts'
  );
  equal('findRelevantDecisions matches on file path', relevant.length, 1);
  equal('findRelevantDecisions returns the anchored decision', relevant[0].id, anchored.id);
  equal(
    'findRelevantDecisions attaches code refs to its results',
    relevant[0].codeRefs.length,
    3
  );
  equal(
    'findRelevantDecisions matches a path contributed via relatedFiles',
    projectMemoryService.findRelevantDecisions(PROJECT_A, 'apps/server/src/sockets/socketManager.ts').length,
    1
  );
  equal(
    'findRelevantDecisions returns nothing for an unreferenced file',
    projectMemoryService.findRelevantDecisions(PROJECT_A, 'no/such/file.ts').length,
    0
  );

  // A non-ACTIVE decision must drop out of the relevance lookup.
  dbService
    .getDb()
    .prepare("UPDATE project_decisions SET status = 'ARCHIVED' WHERE id = ?")
    .run(anchored.id);
  equal(
    'findRelevantDecisions ignores non-ACTIVE decisions',
    projectMemoryService.findRelevantDecisions(PROJECT_A, 'apps/server/src/services/EventBus.ts').length,
    0
  );
  dbService
    .getDb()
    .prepare("UPDATE project_decisions SET status = 'ACTIVE' WHERE id = ?")
    .run(anchored.id);

  // --- listDecisions --------------------------------------------------------
  describe('listDecisions');

  const listed = projectMemoryService.listDecisions(PROJECT_A);
  equal('listDecisions returns every decision for the project', listed.length, decisionCountBefore + 2);
  check(
    'listDecisions is ordered by created_at DESC',
    listed.every(
      (d: { createdAt: number }, i: number) => i === 0 || listed[i - 1].createdAt >= d.createdAt
    )
  );

  dbService
    .getDb()
    .prepare("UPDATE project_decisions SET status = 'STALE' WHERE id = ?")
    .run(clampedHigh.id);

  const stale = projectMemoryService.listDecisions(PROJECT_A, { status: 'STALE' });
  equal('status filter returns only matching rows', stale.length, 1);
  equal('status filter returns the right row', stale[0].id, clampedHigh.id);
  equal(
    'status filter excludes the STALE row from an ACTIVE query',
    projectMemoryService
      .listDecisions(PROJECT_A, { status: 'ACTIVE' })
      .some((d: { id: string }) => d.id === clampedHigh.id),
    false
  );
  equal(
    'a status with no rows returns an empty array',
    projectMemoryService.listDecisions(PROJECT_A, { status: 'SUPERSEDED' }),
    []
  );

  // --- Intents --------------------------------------------------------------
  describe('createIntent & getActiveIntent');

  equal('getActiveIntent returns null before any intent is set', projectMemoryService.getActiveIntent(PROJECT_A), null);

  const firstIntent = projectMemoryService.createIntent({
    projectId: PROJECT_A,
    goal: 'Ship Project Memory Core',
    constraints: ['No new dependencies'],
    nonGoals: ['Cloud sync']
  });

  equal('createIntent returns an ACTIVE intent', firstIntent.status, 'ACTIVE');
  equal('goal is persisted', firstIntent.goal, 'Ship Project Memory Core');
  equal('constraints round-trip', firstIntent.constraints, ['No new dependencies']);
  equal('nonGoals round-trip', firstIntent.nonGoals, ['Cloud sync']);
  equal('getActiveIntent returns the new intent', projectMemoryService.getActiveIntent(PROJECT_A).id, firstIntent.id);

  tick();
  const secondIntent = projectMemoryService.createIntent({
    projectId: PROJECT_A,
    goal: 'Ship the REST surface'
  });

  equal('getActiveIntent returns the newest intent', projectMemoryService.getActiveIntent(PROJECT_A).id, secondIntent.id);
  equal('the previous intent is archived', projectMemoryService.getIntent(firstIntent.id).status, 'ARCHIVED');
  check(
    'archiving stamps updated_at on the previous intent',
    projectMemoryService.getIntent(firstIntent.id).updatedAt > firstIntent.updatedAt
  );

  const activeIntentRows = dbService
    .getDb()
    .prepare("SELECT COUNT(*) AS c FROM project_intents WHERE project_id = ? AND status = 'ACTIVE'")
    .get(PROJECT_A) as { c: number };
  equal('exactly one intent is ACTIVE per project', activeIntentRows.c, 1);

  throws('an intent for an unknown project is rejected', () =>
    projectMemoryService.createIntent({ projectId: 'project-does-not-exist', goal: 'Orphan' })
  );
  throws('an empty goal is rejected', () =>
    projectMemoryService.createIntent({ projectId: PROJECT_A, goal: '  ' })
  );
  equal(
    'a rejected intent leaves the active intent untouched',
    projectMemoryService.getActiveIntent(PROJECT_A).id,
    secondIntent.id
  );

  // --- Rules ----------------------------------------------------------------
  describe('createRule & listRules');

  const rule = projectMemoryService.createRule({
    projectId: PROJECT_A,
    title: 'No hardcoded colors',
    statement: 'Use the CSS custom properties in tokens.css.',
    severity: 'error',
    scopePattern: 'apps/web/src/**'
  });

  equal('severity is persisted', rule.severity, 'error');
  equal('scopePattern is persisted', rule.scopePattern, 'apps/web/src/**');
  equal('title is persisted', rule.title, 'No hardcoded colors');

  tick();
  const defaultedRule = projectMemoryService.createRule({
    projectId: PROJECT_A,
    title: 'Reference the Blueprint',
    statement: 'Do not duplicate Blueprint rationale into code comments.'
  });
  equal('severity defaults to warning', defaultedRule.severity, 'warning');
  equal('scopePattern defaults to the schema default', defaultedRule.scopePattern, '*');

  throws('an unrecognised severity is rejected', () =>
    projectMemoryService.createRule({
      projectId: PROJECT_A,
      title: 'Bad severity',
      statement: 's',
      severity: 'critical'
    })
  );

  const rules = projectMemoryService.listRules(PROJECT_A);
  equal('listRules returns both rules', rules.length, 2);
  equal('listRules is ordered by created_at DESC', rules[0].id, defaultedRule.id);

  // --- Project boundary isolation ------------------------------------------
  describe('project boundary isolation');

  const bDecision = projectMemoryService.createDecision({
    projectId: PROJECT_B,
    title: 'Project B decision',
    summary: 's',
    rationale: 'r',
    codeRefs: [{ filePath: 'apps/server/src/services/EventBus.ts' }]
  });
  projectMemoryService.createIntent({ projectId: PROJECT_B, goal: 'Project B goal' });
  projectMemoryService.createRule({
    projectId: PROJECT_B,
    title: 'Project B rule',
    statement: 'Applies only to B.'
  });

  const aDecisions = projectMemoryService.listDecisions(PROJECT_A);
  check(
    'listDecisions never returns another project rows',
    aDecisions.every((d: { projectId: string }) => d.projectId === PROJECT_A)
  );
  equal(
    'Project B decision is absent from Project A',
    aDecisions.some((d: { id: string }) => d.id === bDecision.id),
    false
  );

  const bRelevant = projectMemoryService.findRelevantDecisions(
    PROJECT_B,
    'apps/server/src/services/EventBus.ts'
  );
  equal('findRelevantDecisions is scoped to the project', bRelevant.length, 1);
  equal('findRelevantDecisions returns only the B decision', bRelevant[0].id, bDecision.id);

  equal(
    'getActiveIntent is scoped to the project',
    projectMemoryService.getActiveIntent(PROJECT_B).goal,
    'Project B goal'
  );
  equal(
    'setting Project B intent did not archive Project A intent',
    projectMemoryService.getActiveIntent(PROJECT_A).id,
    secondIntent.id
  );

  const bRules = projectMemoryService.listRules(PROJECT_B);
  equal('listRules is scoped to the project', bRules.length, 1);
  equal('listRules returns the B rule', bRules[0].title, 'Project B rule');
  equal(
    'an empty project returns no rules',
    projectMemoryService.listRules('project-with-no-memory'),
    []
  );

  // --- Transactional integrity ---------------------------------------------
  describe('transactional integrity');

  const refCountBefore = dbService.getDb().prepare('SELECT COUNT(*) AS c FROM decision_code_refs').get().c;
  const decisionCountBeforeRollback = dbService
    .getDb()
    .prepare('SELECT COUNT(*) AS c FROM project_decisions')
    .get().c;

  // Force a failure *after* the decision row is inserted: with every generated id
  // identical, the decision insert and the first code ref succeed (different tables)
  // and the second code ref violates the primary key. The whole write must unwind.
  throws('a createDecision that fails mid-transaction throws', () => {
    const originalRandomUUID = crypto.randomUUID;
    try {
      (crypto as { randomUUID: () => string }).randomUUID = () => 'collision-id';
      projectMemoryService.createDecision({
        projectId: PROJECT_A,
        title: 'Rollback probe',
        summary: 's',
        rationale: 'r',
        codeRefs: [{ filePath: 'rollback-a.ts' }, { filePath: 'rollback-b.ts' }]
      });
    } finally {
      (crypto as { randomUUID: () => string }).randomUUID = originalRandomUUID;
    }
  });

  const refCountAfter = dbService.getDb().prepare('SELECT COUNT(*) AS c FROM decision_code_refs').get().c;
  const decisionCountAfter = dbService
    .getDb()
    .prepare('SELECT COUNT(*) AS c FROM project_decisions')
    .get().c;
  equal('a failed createDecision leaves no decision row behind', decisionCountAfter, decisionCountBeforeRollback);
  equal('a failed createDecision leaves no code ref rows behind', refCountAfter, refCountBefore);

  // --- supersedeDecision ----------------------------------------------------
  describe('supersedeDecision');

  tick();
  const original = projectMemoryService.createDecision({
    projectId: PROJECT_A,
    title: 'Store data in JSON files',
    summary: 'Persistence is a flat JSON file per project.',
    rationale: 'Simplest thing that works.',
    codeRefs: [{ filePath: 'apps/server/src/store.ts', symbolName: 'writeStore' }]
  });

  tick();
  const replacement = projectMemoryService.supersedeDecision(original.id, {
    projectId: PROJECT_A,
    title: 'Store data in SQLite',
    summary: 'Persistence is node:sqlite.',
    rationale: 'JSON files corrupt under concurrent writes.',
    provenance: 'HUMAN_CONFIRMED',
    codeRefs: [{ filePath: 'apps/server/src/services/DatabaseService.ts', symbolName: 'DatabaseService' }]
  });

  const supersededOriginal = projectMemoryService.getDecision(original.id);
  equal('the old decision transitions to SUPERSEDED', supersededOriginal.status, 'SUPERSEDED');
  equal('the old decision points at its replacement', supersededOriginal.supersededBy, replacement.id);
  check(
    'the old decision updated_at advances',
    supersededOriginal.updatedAt > original.updatedAt,
    `${supersededOriginal.updatedAt} vs ${original.updatedAt}`
  );
  equal('the old decision createdAt is unchanged', supersededOriginal.createdAt, original.createdAt);

  equal('the replacement is ACTIVE', replacement.status, 'ACTIVE');
  equal('the replacement points back at what it replaced', replacement.supersededBy, original.id);
  equal('the replacement belongs to the same project', replacement.projectId, PROJECT_A);
  equal('the replacement returns its code refs', replacement.codeRefs.length, 1);
  equal(
    'the replacement code ref is the new one',
    replacement.codeRefs[0].filePath,
    'apps/server/src/services/DatabaseService.ts'
  );
  equal(
    'the replacement relatedFiles is derived from its own refs',
    replacement.relatedFiles,
    ['apps/server/src/services/DatabaseService.ts']
  );

  equal(
    'the superseded decision drops out of findRelevantDecisions',
    projectMemoryService.findRelevantDecisions(PROJECT_A, 'apps/server/src/store.ts').length,
    0
  );
  equal(
    'the replacement is returned by findRelevantDecisions',
    projectMemoryService.findRelevantDecisions(PROJECT_A, 'apps/server/src/services/DatabaseService.ts')[0].id,
    replacement.id
  );
  equal(
    'the superseded decision is listed under the SUPERSEDED filter',
    projectMemoryService
      .listDecisions(PROJECT_A, { status: 'SUPERSEDED' })
      .some((d: { id: string }) => d.id === original.id),
    true
  );

  throws('superseding a non-existent decision fails', () =>
    projectMemoryService.supersedeDecision('no-such-decision', {
      projectId: PROJECT_A,
      title: 'Replacement',
      summary: 's',
      rationale: 'r'
    })
  );

  throws('superseding across projects fails', () =>
    projectMemoryService.supersedeDecision(replacement.id, {
      projectId: PROJECT_B,
      title: 'Cross-project replacement',
      summary: 's',
      rationale: 'r'
    })
  );
  equal(
    'a rejected cross-project supersede leaves the target ACTIVE',
    projectMemoryService.getDecision(replacement.id).status,
    'ACTIVE'
  );

  // A supersede that fails partway must leave both decisions untouched.
  const beforeRollback = projectMemoryService.getDecision(replacement.id);
  const decisionCountBeforeSupersedeRollback = dbService
    .getDb()
    .prepare('SELECT COUNT(*) AS c FROM project_decisions')
    .get().c;

  throws('a supersede that fails mid-transaction throws', () => {
    const originalRandomUUID = crypto.randomUUID;
    try {
      (crypto as { randomUUID: () => string }).randomUUID = () => 'supersede-collision-id';
      projectMemoryService.supersedeDecision(replacement.id, {
        projectId: PROJECT_A,
        title: 'Rollback replacement',
        summary: 's',
        rationale: 'r',
        codeRefs: [{ filePath: 'x.ts' }, { filePath: 'y.ts' }]
      });
    } finally {
      (crypto as { randomUUID: () => string }).randomUUID = originalRandomUUID;
    }
  });

  equal(
    'a failed supersede inserts no decision',
    dbService.getDb().prepare('SELECT COUNT(*) AS c FROM project_decisions').get().c,
    decisionCountBeforeSupersedeRollback
  );
  equal(
    'a failed supersede leaves the target status unchanged',
    projectMemoryService.getDecision(replacement.id).status,
    beforeRollback.status
  );
  equal(
    'a failed supersede leaves the target supersededBy unchanged',
    projectMemoryService.getDecision(replacement.id).supersededBy,
    beforeRollback.supersededBy
  );

  // --- archiveDecision & updateDecisionStatus -------------------------------
  describe('archiveDecision & updateDecisionStatus');

  tick();
  const lifecycle = projectMemoryService.createDecision({
    projectId: PROJECT_A,
    title: 'Lifecycle subject',
    summary: 's',
    rationale: 'r'
  });
  equal('a new decision starts ACTIVE', lifecycle.status, 'ACTIVE');

  tick();
  const staled = projectMemoryService.updateDecisionStatus(lifecycle.id, 'STALE');
  equal('ACTIVE → STALE', staled.status, 'STALE');
  check('updateDecisionStatus advances updated_at', staled.updatedAt > lifecycle.updatedAt);
  equal('updateDecisionStatus preserves created_at', staled.createdAt, lifecycle.createdAt);
  equal('updateDecisionStatus preserves the payload', staled.title, 'Lifecycle subject');

  tick();
  const archived = projectMemoryService.archiveDecision(lifecycle.id);
  equal('STALE → ARCHIVED', archived.status, 'ARCHIVED');
  check('archiveDecision advances updated_at', archived.updatedAt > staled.updatedAt);
  equal(
    'archiveDecision persists, not just returns',
    projectMemoryService.getDecision(lifecycle.id).status,
    'ARCHIVED'
  );

  tick();
  const reactivated = projectMemoryService.updateDecisionStatus(lifecycle.id, 'ACTIVE');
  equal('ARCHIVED → ACTIVE is permitted', reactivated.status, 'ACTIVE');

  throws('an unrecognised status is rejected by updateDecisionStatus', () =>
    projectMemoryService.updateDecisionStatus(lifecycle.id, 'RETIRED')
  );
  equal(
    'a rejected status change leaves the decision untouched',
    projectMemoryService.getDecision(lifecycle.id).status,
    'ACTIVE'
  );
  throws('updateDecisionStatus on a missing decision fails', () =>
    projectMemoryService.updateDecisionStatus('no-such-decision', 'ARCHIVED')
  );
  throws('archiveDecision on a missing decision fails', () =>
    projectMemoryService.archiveDecision('no-such-decision')
  );

  // --- Deterministic ordering ----------------------------------------------
  describe('deterministic ordering within one millisecond');

  const tiedIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    tiedIds.push(
      projectMemoryService.createDecision({
        projectId: PROJECT_A,
        title: `Tied decision ${i}`,
        summary: 's',
        rationale: 'r'
      }).id
    );
  }
  // Force an exact timestamp collision, which Date.now() cannot be relied on to produce.
  const tiedTimestamp = Date.now() + 60_000;
  const tieUpdate = dbService.getDb().prepare('UPDATE project_decisions SET created_at = ? WHERE id = ?');
  for (const id of tiedIds) tieUpdate.run(tiedTimestamp, id);

  const tiedRows = dbService
    .getDb()
    .prepare('SELECT COUNT(DISTINCT created_at) AS c FROM project_decisions WHERE id IN (?, ?, ?, ?, ?)')
    .get(...tiedIds) as { c: number };
  equal('the five decisions share one created_at', tiedRows.c, 1);

  const orderedIds = projectMemoryService
    .listDecisions(PROJECT_A)
    .map((d: { id: string }) => d.id)
    .filter((id: string) => tiedIds.includes(id));
  equal(
    'listDecisions breaks the tie by id DESC',
    orderedIds,
    [...tiedIds].sort().reverse()
  );
  equal(
    'listDecisions returns the same order on a repeat call',
    projectMemoryService
      .listDecisions(PROJECT_A)
      .map((d: { id: string }) => d.id)
      .filter((id: string) => tiedIds.includes(id)),
    orderedIds
  );
  equal(
    'the status-filtered query breaks ties the same way',
    projectMemoryService
      .listDecisions(PROJECT_A, { status: 'ACTIVE' })
      .map((d: { id: string }) => d.id)
      .filter((id: string) => tiedIds.includes(id)),
    orderedIds
  );

  // Rules tie-break
  const tiedRuleIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    tiedRuleIds.push(
      projectMemoryService.createRule({
        projectId: PROJECT_A,
        title: `Tied rule ${i}`,
        statement: 's'
      }).id
    );
  }
  const ruleTieUpdate = dbService.getDb().prepare('UPDATE architectural_rules SET created_at = ? WHERE id = ?');
  for (const id of tiedRuleIds) ruleTieUpdate.run(tiedTimestamp, id);
  equal(
    'listRules breaks the tie by id DESC',
    projectMemoryService
      .listRules(PROJECT_A)
      .map((r: { id: string }) => r.id)
      .filter((id: string) => tiedRuleIds.includes(id)),
    [...tiedRuleIds].sort().reverse()
  );

  // findRelevantDecisions tie-break
  const tiedRefIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    tiedRefIds.push(
      projectMemoryService.createDecision({
        projectId: PROJECT_A,
        title: `Tied anchored ${i}`,
        summary: 's',
        rationale: 'r',
        relatedFiles: ['shared/tied.ts']
      }).id
    );
  }
  for (const id of tiedRefIds) tieUpdate.run(tiedTimestamp, id);
  equal(
    'findRelevantDecisions breaks the tie by id DESC',
    projectMemoryService
      .findRelevantDecisions(PROJECT_A, 'shared/tied.ts')
      .map((d: { id: string }) => d.id),
    [...tiedRefIds].sort().reverse()
  );

  // getActiveIntent tie-break: two ACTIVE intents forced to the same created_at
  const intentA = projectMemoryService.createIntent({ projectId: PROJECT_A, goal: 'Tie intent 1' });
  const intentB = projectMemoryService.createIntent({ projectId: PROJECT_A, goal: 'Tie intent 2' });
  const intentDb = dbService.getDb();
  intentDb
    .prepare("UPDATE project_intents SET created_at = ?, status = 'ACTIVE' WHERE id IN (?, ?)")
    .run(tiedTimestamp, intentA.id, intentB.id);
  const expectedIntentId = [intentA.id, intentB.id].sort().reverse()[0];
  equal(
    'getActiveIntent breaks the tie by id DESC',
    projectMemoryService.getActiveIntent(PROJECT_A).id,
    expectedIntentId
  );
  // Restore a single active intent so later assertions are unaffected.
  intentDb
    .prepare("UPDATE project_intents SET status = 'ARCHIVED' WHERE project_id = ? AND id != ?")
    .run(PROJECT_A, expectedIntentId);

  // --- getProjectBriefing ---------------------------------------------------
  describe('getProjectBriefing — empty project');

  const PROJECT_C = 'project-c';
  dbService
    .getDb()
    .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
    .run(PROJECT_C, 'Project C', '/tmp/project-c');

  const emptyBriefing = projectMemoryService.getProjectBriefing(PROJECT_C);
  equal('empty briefing carries the projectId', emptyBriefing.projectId, PROJECT_C);
  equal('empty briefing has no active decisions', emptyBriefing.activeDecisions, []);
  equal('empty briefing has no rules', emptyBriefing.architecturalRules, []);
  equal('empty briefing has a null intent', emptyBriefing.currentIntent, null);
  equal('empty briefing has no agent work', emptyBriefing.recentAgentWork, []);
  equal('empty briefing has no approvals', emptyBriefing.recentApprovals, []);
  equal(
    'empty briefing exposes exactly the six briefing keys',
    Object.keys(emptyBriefing).sort(),
    [
      'activeDecisions',
      'architecturalRules',
      'currentIntent',
      'projectId',
      'recentAgentWork',
      'recentApprovals'
    ]
  );

  describe('getProjectBriefing — populated project');

  // Sessions and approvals have no service API — they are written by AgentService
  // and ApprovalManager — so the fixtures go in through SQL, exactly as those
  // services write them.
  const insertSession = dbService
    .getDb()
    .prepare(
      'INSERT INTO sessions (id, project_id, thread_id, agent_type, status, pid, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
  const insertApproval = dbService
    .getDb()
    .prepare(
      'INSERT INTO approvals (id, project_id, action_id, description, command, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );

  const base = 1_700_000_000_000;
  // Seven of each, so the LIMIT 5 is actually exercised.
  for (let i = 0; i < 7; i++) {
    insertSession.run(
      `c-session-${i}`,
      PROJECT_C,
      `c-thread-${i}`,
      i % 2 === 0 ? 'claude' : 'aider',
      i === 6 ? 'running' : 'exited',
      1000 + i,
      base + i * 1000,
      base + i * 1000 + 500
    );
    insertApproval.run(
      `c-approval-row-${i}`,
      PROJECT_C,
      `c-action-${i}`,
      `Approval ${i}`,
      `rm -rf /tmp/target-${i}`,
      i === 6 ? 'pending' : 'approved',
      base + i * 1000
    );
  }
  // A legacy session written before sessions.thread_id existed.
  insertSession.run('c-session-legacy', PROJECT_C, null, 'antigravity', 'crashed', null, base - 1000, base - 500);

  const cActive = projectMemoryService.createDecision({
    projectId: PROJECT_C,
    title: 'C active decision',
    summary: 's',
    rationale: 'r',
    relatedFiles: ['src/c.ts']
  });
  const cArchived = projectMemoryService.createDecision({
    projectId: PROJECT_C,
    title: 'C archived decision',
    summary: 's',
    rationale: 'r'
  });
  projectMemoryService.archiveDecision(cArchived.id);
  const cRule = projectMemoryService.createRule({
    projectId: PROJECT_C,
    title: 'C rule',
    statement: 'Applies to C.',
    severity: 'error'
  });
  const cIntent = projectMemoryService.createIntent({
    projectId: PROJECT_C,
    goal: 'Finish Project C',
    constraints: ['No new deps'],
    nonGoals: ['Rewrites']
  });

  const briefing = projectMemoryService.getProjectBriefing(PROJECT_C);

  equal('briefing includes only ACTIVE decisions', briefing.activeDecisions.length, 1);
  equal('briefing returns the active decision', briefing.activeDecisions[0].id, cActive.id);
  equal(
    'briefing decisions carry their code refs',
    briefing.activeDecisions[0].codeRefs.length,
    1
  );
  equal('briefing excludes the archived decision',
    briefing.activeDecisions.some((d: { id: string }) => d.id === cArchived.id),
    false
  );

  equal('briefing includes the rules', briefing.architecturalRules.length, 1);
  equal('briefing rule is the right one', briefing.architecturalRules[0].id, cRule.id);
  equal('briefing rule keeps its severity', briefing.architecturalRules[0].severity, 'error');

  equal('briefing carries the active intent', briefing.currentIntent.id, cIntent.id);
  equal('briefing intent keeps its goal', briefing.currentIntent.goal, 'Finish Project C');
  equal('briefing intent keeps its nonGoals', briefing.currentIntent.nonGoals, ['Rewrites']);

  equal('recentAgentWork is capped at 5', briefing.recentAgentWork.length, 5);
  equal(
    'recentAgentWork is ordered by started_at DESC',
    briefing.recentAgentWork.map((w: { sessionId: string }) => w.sessionId),
    ['c-session-6', 'c-session-5', 'c-session-4', 'c-session-3', 'c-session-2']
  );
  equal('recentAgentWork maps sessionId', briefing.recentAgentWork[0].sessionId, 'c-session-6');
  equal('recentAgentWork maps threadId', briefing.recentAgentWork[0].threadId, 'c-thread-6');
  equal('recentAgentWork maps agentType', briefing.recentAgentWork[0].agentType, 'claude');
  equal('recentAgentWork maps status', briefing.recentAgentWork[0].status, 'running');
  equal('recentAgentWork maps startedAt', briefing.recentAgentWork[0].startedAt, base + 6000);
  equal('recentAgentWork maps updatedAt', briefing.recentAgentWork[0].updatedAt, base + 6500);
  equal(
    'recentAgentWork exposes exactly the summary keys',
    Object.keys(briefing.recentAgentWork[0]).sort(),
    ['agentType', 'sessionId', 'startedAt', 'status', 'threadId', 'updatedAt']
  );

  equal('recentApprovals is capped at 5', briefing.recentApprovals.length, 5);
  equal(
    'recentApprovals is ordered by created_at DESC',
    briefing.recentApprovals.map((a: { actionId: string }) => a.actionId),
    ['c-action-6', 'c-action-5', 'c-action-4', 'c-action-3', 'c-action-2']
  );
  equal('recentApprovals maps actionId, not the row id', briefing.recentApprovals[0].actionId, 'c-action-6');
  equal('recentApprovals maps description', briefing.recentApprovals[0].description, 'Approval 6');
  equal('recentApprovals maps command', briefing.recentApprovals[0].command, 'rm -rf /tmp/target-6');
  equal('recentApprovals maps status', briefing.recentApprovals[0].status, 'pending');
  equal('recentApprovals maps createdAt', briefing.recentApprovals[0].createdAt, base + 6000);
  equal(
    'recentApprovals exposes exactly the summary keys',
    Object.keys(briefing.recentApprovals[0]).sort(),
    ['actionId', 'command', 'createdAt', 'description', 'status']
  );

  // A NULL thread_id must surface as an absent optional, never as null.
  const legacyWork = dbService
    .getDb()
    .prepare(
      `SELECT id AS sessionId, thread_id AS threadId, agent_type AS agentType, status,
              started_at AS startedAt, updated_at AS updatedAt
         FROM sessions WHERE id = 'c-session-legacy'`
    )
    .get();
  equal('the legacy fixture really has a NULL thread_id', legacyWork.threadId, null);

  // Project C's legacy session is the oldest of eight, so it falls outside the
  // LIMIT 5 window. Give it its own project to observe how the mapper treats NULL.
  const PROJECT_LEGACY = 'project-legacy';
  dbService
    .getDb()
    .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
    .run(PROJECT_LEGACY, 'Legacy', '/tmp/legacy');
  insertSession.run('legacy-only-session', PROJECT_LEGACY, null, 'antigravity', 'crashed', null, base, base);
  const legacyOnly = projectMemoryService.getProjectBriefing(PROJECT_LEGACY).recentAgentWork[0];
  equal('a NULL thread_id is omitted rather than null', 'threadId' in legacyOnly, false);
  equal(
    'a NULL thread_id survives JSON serialization as absent',
    JSON.parse(JSON.stringify(legacyOnly)).threadId,
    undefined
  );

  describe('getProjectBriefing — project isolation');

  insertSession.run('b-session-1', PROJECT_B, 'b-thread', 'claude', 'exited', 99, base + 99_000, base + 99_000);
  insertApproval.run('b-approval-row', PROJECT_B, 'b-action', 'B approval', 'echo b', 'approved', base + 99_000);

  const cBriefing = projectMemoryService.getProjectBriefing(PROJECT_C);
  const bBriefing = projectMemoryService.getProjectBriefing(PROJECT_B);

  check(
    'briefing decisions all belong to the queried project',
    cBriefing.activeDecisions.every((d: { projectId: string }) => d.projectId === PROJECT_C)
  );
  check(
    'briefing rules all belong to the queried project',
    cBriefing.architecturalRules.every((r: { projectId: string }) => r.projectId === PROJECT_C)
  );
  equal(
    'briefing intent belongs to the queried project',
    cBriefing.currentIntent.projectId,
    PROJECT_C
  );
  equal(
    'no Project B session leaks into the Project C briefing',
    cBriefing.recentAgentWork.some((w: { sessionId: string }) => w.sessionId === 'b-session-1'),
    false
  );
  equal(
    'no Project B approval leaks into the Project C briefing',
    cBriefing.recentApprovals.some((a: { actionId: string }) => a.actionId === 'b-action'),
    false
  );
  equal('the Project B briefing sees only its own session', bBriefing.recentAgentWork.length, 1);
  equal('the Project B briefing session is the B one', bBriefing.recentAgentWork[0].sessionId, 'b-session-1');
  equal('the Project B briefing sees only its own approval', bBriefing.recentApprovals.length, 1);
  equal(
    'no Project C decision leaks into the Project B briefing',
    bBriefing.activeDecisions.some((d: { id: string }) => d.id === cActive.id),
    false
  );

  describe('getProjectBriefing — determinism');

  const run1 = JSON.stringify(projectMemoryService.getProjectBriefing(PROJECT_C));
  const run2 = JSON.stringify(projectMemoryService.getProjectBriefing(PROJECT_C));
  const run3 = JSON.stringify(projectMemoryService.getProjectBriefing(PROJECT_C));
  equal('two briefings of an unchanged database are byte-identical', run1, run2);
  equal('a third briefing is identical too', run1, run3);
  check('the briefing is not trivially empty', run1.length > 200, `${run1.length} bytes`);

  // Determinism must hold when every sort key is tied, which is where an
  // unstable ORDER BY would show up.
  const tiedTs = base + 500_000;
  dbService
    .getDb()
    .prepare("UPDATE sessions SET started_at = ? WHERE project_id = ?")
    .run(tiedTs, PROJECT_C);
  dbService
    .getDb()
    .prepare('UPDATE approvals SET created_at = ? WHERE project_id = ?')
    .run(tiedTs, PROJECT_C);
  dbService
    .getDb()
    .prepare('UPDATE project_decisions SET created_at = ? WHERE project_id = ?')
    .run(tiedTs, PROJECT_C);

  const tiedRun1 = JSON.stringify(projectMemoryService.getProjectBriefing(PROJECT_C));
  const tiedRun2 = JSON.stringify(projectMemoryService.getProjectBriefing(PROJECT_C));
  equal('briefings stay identical when every timestamp is tied', tiedRun1, tiedRun2);

  const tiedSessionOrder = projectMemoryService
    .getProjectBriefing(PROJECT_C)
    .recentAgentWork.map((w: { sessionId: string }) => w.sessionId);
  equal(
    'tied sessions fall back to id DESC',
    tiedSessionOrder,
    [...tiedSessionOrder].sort().reverse()
  );

  // --- EventBus integration -------------------------------------------------
  describe('EventBus integration');

  // Events cross the require() boundary untyped, so the captured envelope is
  // inspected structurally rather than against the compiled AsterimEvent type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type CapturedEvent = { type: string; event: any };
  const captured: CapturedEvent[] = [];
  const MEMORY_EVENT_TYPES = [
    'memory.decision_created',
    'memory.decision_superseded',
    'memory.intent_updated',
    'memory.rule_created'
  ];
  const listeners = MEMORY_EVENT_TYPES.map(type => {
    const listener = (event: CapturedEvent['event']) => captured.push({ type, event });
    eventBus.subscribe(type, listener);
    return { type, listener };
  });

  const PROJECT_E = 'project-e';
  dbService
    .getDb()
    .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
    .run(PROJECT_E, 'Project E', '/tmp/project-e');

  equal('initEventBusListeners registers on the first call', projectMemoryService.initEventBusListeners(), true);
  equal('initEventBusListeners is idempotent', projectMemoryService.initEventBusListeners(), false);

  // memory.decision_created
  captured.length = 0;
  const eventDecision = projectMemoryService.createDecision({
    projectId: PROJECT_E,
    title: 'E decision',
    summary: 's',
    rationale: 'r',
    relatedFiles: ['src/e.ts']
  });

  equal('createDecision publishes exactly one event', captured.length, 1);
  equal('the event type is memory.decision_created', captured[0].event.type, 'memory.decision_created');
  equal('the event source is system:memory', captured[0].event.source, 'system:memory');
  check('the event carries a generated id', typeof captured[0].event.id === 'string' && captured[0].event.id.length > 0);
  check('the event carries a timestamp', typeof captured[0].event.timestamp === 'number' && captured[0].event.timestamp > 0);
  equal('the payload carries the projectId', captured[0].event.payload.projectId, PROJECT_E);
  equal('the payload carries the decision', captured[0].event.payload.decision.id, eventDecision.id);
  equal(
    'the payload decision is the fully mapped record',
    JSON.stringify(captured[0].event.payload.decision),
    JSON.stringify(eventDecision)
  );
  equal(
    'the payload decision includes code refs',
    captured[0].event.payload.decision.codeRefs.length,
    1
  );
  equal(
    'the envelope exposes exactly the AsterimEvent keys',
    Object.keys(captured[0].event).sort(),
    ['id', 'payload', 'source', 'timestamp', 'type']
  );

  // memory.rule_created
  captured.length = 0;
  const eventRule = projectMemoryService.createRule({
    projectId: PROJECT_E,
    title: 'E rule',
    statement: 'Applies to E.',
    severity: 'info'
  });
  equal('createRule publishes exactly one event', captured.length, 1);
  equal('the event type is memory.rule_created', captured[0].event.type, 'memory.rule_created');
  equal('the rule payload carries the projectId', captured[0].event.payload.projectId, PROJECT_E);
  equal('the rule payload carries the rule', captured[0].event.payload.rule.id, eventRule.id);
  equal('the rule payload keeps the severity', captured[0].event.payload.rule.severity, 'info');

  // memory.intent_updated — first intent has no predecessor
  captured.length = 0;
  const eventIntent1 = projectMemoryService.createIntent({ projectId: PROJECT_E, goal: 'E goal 1' });
  equal('createIntent publishes exactly one event', captured.length, 1);
  equal('the event type is memory.intent_updated', captured[0].event.type, 'memory.intent_updated');
  equal('the intent payload carries the projectId', captured[0].event.payload.projectId, PROJECT_E);
  equal('the intent payload carries the intent', captured[0].event.payload.intent.id, eventIntent1.id);
  equal(
    'the first intent reports no previousIntentId',
    'previousIntentId' in captured[0].event.payload,
    false
  );

  // memory.intent_updated — a replacement names what it archived
  captured.length = 0;
  const eventIntent2 = projectMemoryService.createIntent({ projectId: PROJECT_E, goal: 'E goal 2' });
  equal('replacing an intent publishes one event', captured.length, 1);
  equal('the replacement intent is in the payload', captured[0].event.payload.intent.id, eventIntent2.id);
  equal(
    'the payload names the archived intent',
    captured[0].event.payload.previousIntentId,
    eventIntent1.id
  );

  // memory.decision_superseded
  captured.length = 0;
  const eventReplacement = projectMemoryService.supersedeDecision(eventDecision.id, {
    projectId: PROJECT_E,
    title: 'E decision v2',
    summary: 's2',
    rationale: 'r2'
  });
  equal('supersedeDecision publishes exactly one event', captured.length, 1);
  equal(
    'the event type is memory.decision_superseded',
    captured[0].event.type,
    'memory.decision_superseded'
  );
  equal(
    'supersede does not also publish decision_created',
    captured.some(c => c.type === 'memory.decision_created'),
    false
  );
  equal('the payload names the superseded decision', captured[0].event.payload.decisionId, eventDecision.id);
  equal('the payload names the replacement', captured[0].event.payload.supersededBy, eventReplacement.id);
  equal('the payload carries the replacement record', captured[0].event.payload.decision.id, eventReplacement.id);
  equal('the payload projectId is the shared project', captured[0].event.payload.projectId, PROJECT_E);

  // Reads and failed writes must stay silent.
  captured.length = 0;
  projectMemoryService.getProjectBriefing(PROJECT_E);
  projectMemoryService.listDecisions(PROJECT_E);
  projectMemoryService.getActiveIntent(PROJECT_E);
  equal('read methods publish nothing', captured.length, 0);

  try {
    projectMemoryService.createDecision({
      projectId: 'project-does-not-exist',
      title: 'Never persisted',
      summary: 's',
      rationale: 'r'
    });
  } catch {
    /* expected */
  }
  equal('a rejected write publishes nothing', captured.length, 0);

  try {
    projectMemoryService.supersedeDecision('no-such-decision', {
      projectId: PROJECT_E,
      title: 'Never persisted',
      summary: 's',
      rationale: 'r'
    });
  } catch {
    /* expected */
  }
  equal('a rejected supersede publishes nothing', captured.length, 0);

  // A subscriber that throws must not corrupt the caller's contract: the write
  // has already committed by the time the event goes out.
  const thrower = () => {
    throw new Error('subscriber blew up');
  };
  eventBus.subscribe('memory.rule_created', thrower);
  let ruleAfterThrow: { id: string } | null = null;
  let threwToCaller = false;
  try {
    ruleAfterThrow = projectMemoryService.createRule({
      projectId: PROJECT_E,
      title: 'Rule despite a bad subscriber',
      statement: 's'
    });
  } catch {
    threwToCaller = true;
  }
  eventBus.unsubscribe('memory.rule_created', thrower);
  equal('a throwing subscriber does not surface to the caller', threwToCaller, false);
  check('the write survived a throwing subscriber', ruleAfterThrow !== null);
  equal(
    'the rule really persisted despite the throw',
    ruleAfterThrow ? projectMemoryService.getRule(ruleAfterThrow.id).title : null,
    'Rule despite a bad subscriber'
  );

  // A subscriber that writes memory in reaction to a memory event would recurse
  // forever on a synchronous EventEmitter. The publish-depth guard bounds it.
  let reentrantCalls = 0;
  const reentrant = () => {
    reentrantCalls++;
    if (reentrantCalls > 50) return; // safety net: the guard should stop us long before
    projectMemoryService.createRule({
      projectId: PROJECT_E,
      title: `Reentrant ${reentrantCalls}`,
      statement: 's'
    });
  };
  eventBus.subscribe('memory.rule_created', reentrant);
  let loopThrew = false;
  try {
    projectMemoryService.createRule({ projectId: PROJECT_E, title: 'Loop seed', statement: 's' });
  } catch {
    loopThrew = true;
  }
  eventBus.unsubscribe('memory.rule_created', reentrant);

  equal('a re-entrant subscriber does not blow the stack', loopThrew, false);
  check(
    'the publish-depth guard bounds the recursion',
    reentrantCalls > 0 && reentrantCalls < 10,
    `reentrantCalls=${reentrantCalls}`
  );
  check(
    'the guard resets after the cycle unwinds',
    (() => {
      captured.length = 0;
      projectMemoryService.createRule({ projectId: PROJECT_E, title: 'After the loop', statement: 's' });
      return captured.length === 1;
    })(),
    'a later publish still reaches subscribers'
  );

  // Unsubscribing must actually detach.
  captured.length = 0;
  for (const { type, listener } of listeners) eventBus.unsubscribe(type, listener);
  projectMemoryService.createRule({ projectId: PROJECT_E, title: 'After unsubscribe', statement: 's' });
  equal('unsubscribed listeners receive nothing', captured.length, 0);

  // --- Cascade -------------------------------------------------------------
  describe('cascade on project deletion');

  dbService.getDb().prepare('DELETE FROM projects WHERE id = ?').run(PROJECT_B);
  equal('deleting a project removes its decisions', projectMemoryService.listDecisions(PROJECT_B), []);
  equal('deleting a project removes its intent', projectMemoryService.getActiveIntent(PROJECT_B), null);
  equal('deleting a project removes its rules', projectMemoryService.listRules(PROJECT_B), []);
  check('Project A memory survives Project B deletion', projectMemoryService.listDecisions(PROJECT_A).length > 0);

  const deletedBriefing = projectMemoryService.getProjectBriefing(PROJECT_B);
  equal('a deleted project briefs with no decisions', deletedBriefing.activeDecisions, []);
  equal('a deleted project briefs with no rules', deletedBriefing.architecturalRules, []);
  equal('a deleted project briefs with a null intent', deletedBriefing.currentIntent, null);
  // sessions and approvals declare no foreign key on project_id
  // (docs/p5.0-01-verification-report.md § 2), so their rows outlive the project.
  equal('session history outlives the deleted project', deletedBriefing.recentAgentWork.length, 1);
  equal('approval history outlives the deleted project', deletedBriefing.recentApprovals.length, 1);
} catch (err) {
  failed++;
  console.error('\nUNCAUGHT ERROR:', err);
} finally {
  cleanup();
}

console.log(`\n${passed}/${passed + failed} assertions passed`);
if (failures.length > 0) {
  console.log('Failed assertions:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
