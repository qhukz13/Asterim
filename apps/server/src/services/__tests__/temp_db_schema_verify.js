/**
 * Temporary schema verification script for P5.0-03 (Project Memory Core DDL).
 *
 * The repository has no test runner (see docs/p5.0-01-verification-report.md), so this
 * is a standalone script rather than a spec file. It points ASTERIM_DATA_DIR at a fresh
 * temp directory *before* importing DatabaseService — the module exports a singleton
 * constructed at import time, so setting the variable any later would initialise (and
 * pollute) the real ~/.asterim/asterim.db.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/__tests__/temp_db_schema_verify.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-schema-verify-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

const EXPECTED_TABLES = [
  'project_decisions',
  'decision_code_refs',
  'project_intents',
  'architectural_rules'
];

const EXPECTED_INDEXES = [
  'idx_decisions_project_status',
  'idx_decision_refs_decision',
  'idx_decision_refs_file',
  'idx_intents_project_status',
  'idx_rules_project',
  'idx_sessions_project_started',
  'idx_approvals_project_created'
];

const results = [];
let failures = 0;

function check(label, passed, detail) {
  results.push({ label, passed, detail });
  if (!passed) failures++;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

function cleanup() {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, err.message);
  }
}

try {
  // Importing the module runs the constructor, which creates the directory and calls init().
  const { dbService } = require('../DatabaseService');
  const db = dbService.getDb();

  check(
    'database created inside the temp directory',
    dbService.dbPath.startsWith(tmpDir),
    dbService.dbPath
  );

  // --- Journal mode ---------------------------------------------------------
  const journal = db.prepare('PRAGMA journal_mode').get();
  check('journal_mode is WAL', String(journal.journal_mode).toLowerCase() === 'wal', JSON.stringify(journal));

  // --- Foreign key enforcement ---------------------------------------------
  const fk = db.prepare('PRAGMA foreign_keys').get();
  check('foreign key enforcement is on', fk.foreign_keys === 1, JSON.stringify(fk));

  // --- Tables ---------------------------------------------------------------
  const tableNames = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map(r => r.name);

  for (const table of EXPECTED_TABLES) {
    check(`table ${table} exists`, tableNames.includes(table));
  }

  // --- Indexes --------------------------------------------------------------
  const indexNames = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all()
    .map(r => r.name);

  for (const index of EXPECTED_INDEXES) {
    check(`index ${index} exists`, indexNames.includes(index));
  }

  // --- Pre-existing tables untouched ---------------------------------------
  for (const table of ['projects', 'threads', 'events', 'sessions', 'approvals', 'workspaces']) {
    check(`pre-existing table ${table} still present`, tableNames.includes(table));
  }

  // --- Idempotency: a second init() over the same file must not throw -------
  const { DatabaseService } = require('../DatabaseService');
  try {
    new DatabaseService();
    check('re-initialising over an existing database succeeds', true);
  } catch (err) {
    check('re-initialising over an existing database succeeds', false, err.message);
  }

  // --- Foreign key cascade on project deletion ------------------------------
  const now = Date.now();
  const projectId = 'proj-verify-1';
  const decisionId = 'dec-verify-1';
  const replacementId = 'dec-verify-2';

  db.prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)').run(
    projectId,
    'Schema Verify',
    '/tmp/schema-verify'
  );
  db.prepare(
    `INSERT INTO project_decisions (id, project_id, title, summary, rationale, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(decisionId, projectId, 'T', 'S', 'R', now, now);
  db.prepare(
    `INSERT INTO project_decisions (id, project_id, title, summary, rationale, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(replacementId, projectId, 'T2', 'S2', 'R2', now, now);
  db.prepare('INSERT INTO decision_code_refs (id, decision_id, file_path, created_at) VALUES (?, ?, ?, ?)').run(
    'ref-verify-1',
    decisionId,
    'src/index.ts',
    now
  );
  db.prepare(
    'INSERT INTO project_intents (id, project_id, goal, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run('intent-verify-1', projectId, 'Ship P5.0', now, now);
  db.prepare(
    'INSERT INTO architectural_rules (id, project_id, title, statement, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run('rule-verify-1', projectId, 'No direct SQL', 'Use the service layer.', now);

  // Column defaults applied on insert
  const inserted = db.prepare('SELECT * FROM project_decisions WHERE id = ?').get(decisionId);
  check(
    'project_decisions defaults applied',
    inserted.status === 'ACTIVE' &&
      inserted.provenance === 'HUMAN_CONFIRMED' &&
      inserted.confidence === 1.0 &&
      inserted.constraints_json === '[]' &&
      inserted.superseded_by === null,
    `status=${inserted.status} provenance=${inserted.provenance} confidence=${inserted.confidence}`
  );
  const insertedRule = db.prepare('SELECT * FROM architectural_rules WHERE id = ?').get('rule-verify-1');
  check(
    'architectural_rules defaults applied',
    insertedRule.severity === 'warning' && insertedRule.scope_pattern === '*',
    `severity=${insertedRule.severity} scope_pattern=${insertedRule.scope_pattern}`
  );
  const insertedIntent = db.prepare('SELECT * FROM project_intents WHERE id = ?').get('intent-verify-1');
  check(
    'project_intents defaults applied',
    insertedIntent.status === 'ACTIVE' &&
      insertedIntent.constraints_json === '[]' &&
      insertedIntent.non_goals_json === '[]',
    `status=${insertedIntent.status}`
  );

  // A superseded_by pointing at a missing decision must be rejected
  let rejected = false;
  try {
    db.prepare('UPDATE project_decisions SET superseded_by = ? WHERE id = ?').run('does-not-exist', decisionId);
  } catch {
    rejected = true;
  }
  check('superseded_by rejects a dangling reference', rejected);

  // superseded_by → ON DELETE SET NULL
  db.prepare('UPDATE project_decisions SET superseded_by = ?, status = ? WHERE id = ?').run(
    replacementId,
    'SUPERSEDED',
    decisionId
  );
  db.prepare('DELETE FROM project_decisions WHERE id = ?').run(replacementId);
  const afterReplacementDelete = db.prepare('SELECT superseded_by FROM project_decisions WHERE id = ?').get(decisionId);
  check(
    'deleting the replacement nulls superseded_by (ON DELETE SET NULL)',
    afterReplacementDelete.superseded_by === null,
    `superseded_by=${afterReplacementDelete.superseded_by}`
  );

  // Deleting the project must cascade to every memory table, including the
  // grandchild decision_code_refs via project_decisions.
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

  const counts = {
    project_decisions: db
      .prepare('SELECT COUNT(*) AS c FROM project_decisions WHERE project_id = ?')
      .get(projectId).c,
    decision_code_refs: db
      .prepare('SELECT COUNT(*) AS c FROM decision_code_refs WHERE decision_id = ?')
      .get(decisionId).c,
    project_intents: db.prepare('SELECT COUNT(*) AS c FROM project_intents WHERE project_id = ?').get(projectId).c,
    architectural_rules: db
      .prepare('SELECT COUNT(*) AS c FROM architectural_rules WHERE project_id = ?')
      .get(projectId).c
  };

  check('cascade removed project_decisions', counts.project_decisions === 0, `rows=${counts.project_decisions}`);
  check(
    'cascade removed decision_code_refs (grandchild)',
    counts.decision_code_refs === 0,
    `rows=${counts.decision_code_refs}`
  );
  check('cascade removed project_intents', counts.project_intents === 0, `rows=${counts.project_intents}`);
  check('cascade removed architectural_rules', counts.architectural_rules === 0, `rows=${counts.architectural_rules}`);

  // --- Index usage ----------------------------------------------------------
  const plan = db
    .prepare("EXPLAIN QUERY PLAN SELECT * FROM project_decisions WHERE project_id = ? AND status = 'ACTIVE'")
    .all(projectId)
    .map(r => r.detail)
    .join(' | ');
  check('briefing decision query uses idx_decisions_project_status', plan.includes('idx_decisions_project_status'), plan);

  const sessionPlan = db
    .prepare('EXPLAIN QUERY PLAN SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC')
    .all(projectId)
    .map(r => r.detail)
    .join(' | ');
  check('briefing session query uses idx_sessions_project_started', sessionPlan.includes('idx_sessions_project_started'), sessionPlan);

  const approvalPlan = db
    .prepare('EXPLAIN QUERY PLAN SELECT * FROM approvals WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId)
    .map(r => r.detail)
    .join(' | ');
  check('briefing approval query uses idx_approvals_project_created', approvalPlan.includes('idx_approvals_project_created'), approvalPlan);
} catch (err) {
  failures++;
  console.error('\nUNCAUGHT ERROR:', err);
} finally {
  cleanup();
}

console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
