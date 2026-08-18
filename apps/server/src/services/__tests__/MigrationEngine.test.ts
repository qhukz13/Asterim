/**
 * Tests for the Versioned SQL Migration Engine (P7-02, DEC-030).
 *
 * The claim under test is not "migrations run" — it is that a database can
 * never be left in a shape the Core cannot account for. Each section pins one
 * of the four properties the old ad-hoc `init()` lacked:
 *
 *   1. **Versioned.** A fresh database ends up with `schema_migrations` naming
 *      every migration it applied, with a checksum and a timestamp, and the
 *      consolidated Phase 1–6 schema present in full. A second run applies
 *      nothing.
 *   2. **Transactional.** A migration whose third statement is invalid leaves
 *      the database exactly as it was found — no half-created tables, and no
 *      row in `schema_migrations` claiming the version was applied.
 *   3. **Checksummed.** Editing a migration that has already run is detected on
 *      the next boot and stops the engine before any *pending* migration
 *      executes. So is a database from a build that knows more migrations than
 *      this one.
 *   4. **Recoverable.** A database with data in it is copied to
 *      `asterim.db.bak.<timestamp>`, owner-only, before the first pending
 *      migration touches it — and a first-boot empty file is not.
 *
 * Plus the compatibility property Phase 7 turns on: a database created by the
 * pre-DEC-030 `init()` — core tables present, `schema_migrations` absent, and
 * several columns behind — is adopted onto the versioned history, its rows
 * intact and its missing columns added.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/__tests__/MigrationEngine.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-migration-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

// `require`, not `import`: DatabaseService resolves its path at import time and
// an ESM binding would be hoisted above the ASTERIM_DATA_DIR assignment. Every
// other suite in this directory follows the same convention.
const { DatabaseSync } = require('node:sqlite');
const { MigrationEngine } = require('../MigrationEngine');
const { migrations: builtinMigrations, LATEST_SCHEMA_VERSION } = require('../../migrations');

type Db = InstanceType<typeof DatabaseSync>;

interface MigrationRecord {
  version: number;
  name: string;
  checksum: string;
  applied_at: number;
}

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

/** Asserts that `fn` throws, and that its message mentions `fragment`. */
function throws(label: string, fragment: string, fn: () => unknown): void {
  try {
    fn();
    check(label, false, 'did not throw');
  } catch (err) {
    const message = (err as Error).message;
    check(label, message.includes(fragment), `message was: ${message}`);
  }
}

function describe(name: string): void {
  console.log(`\n${name}`);
}

function cleanup(): void {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

const isPosix = process.platform !== 'win32';

/** A fresh directory per scenario, so snapshots from one never confuse another. */
function scenarioDir(name: string): string {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function openDb(dir: string): { db: Db; dbPath: string } {
  const dbPath = path.join(dir, 'asterim.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return { db, dbPath };
}

function tableNames(db: Db): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>
  ).map(row => row.name);
}

function columnNames(db: Db, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    row => row.name
  );
}

function snapshotsIn(dir: string): string[] {
  return fs.readdirSync(dir).filter(entry => entry.includes('.bak.'));
}

/** The tables listed in the P7-02 scope as the consolidated Phase 1–6 schema. */
const EXPECTED_TABLES = [
  'projects',
  'threads',
  'events',
  'candidate_decisions',
  'settings',
  'push_subscriptions',
  'sessions',
  'approvals',
  'contexts',
  'context_entries',
  'users',
  'accounts',
  'feature_entitlements',
  'user_sessions',
  'trusted_devices',
  'api_keys',
  'workspaces',
  'environments',
  'environment_project_attachments',
  'environment_knowledge_items',
  'environment_secrets',
  'environment_audit_logs',
  'workspace_memberships',
  'workspace_invitations',
  'audit_logs',
  'team_memberships',
  'project_decisions',
  'decision_code_refs',
  'project_intents',
  'architectural_rules',
  'mcp_servers',
  'agent_profiles'
];

/** Indexes the consolidated schema declares. */
const EXPECTED_INDEXES = [
  'idx_candidate_decisions_project',
  'idx_candidate_decisions_status',
  'idx_events_project_timestamp',
  'idx_context_entries_context',
  'idx_context_entries_thread',
  'idx_user_sessions_user',
  'idx_trusted_devices_user',
  'idx_api_keys_account',
  'idx_workspaces_account',
  'idx_workspace_memberships_workspace',
  'idx_workspace_invitations_token',
  'idx_audit_logs_workspace',
  'idx_environments_account',
  'idx_env_knowledge_env',
  'idx_env_attachments_env',
  'idx_decisions_project_status',
  'idx_decision_refs_decision',
  'idx_decision_refs_file',
  'idx_intents_project_status',
  'idx_rules_project',
  'idx_sessions_project_started',
  'idx_approvals_project_created',
  'idx_mcp_servers_workspace',
  'idx_agent_profiles_workspace',
  'idx_agent_profiles_builtin',
  'idx_threads_parent'
];

/**
 * A database in the shape an Asterim from before the `ALTER TABLE` era left
 * behind: the original narrow tables, no `schema_migrations`, and with rows in
 * them, so adoption has something real to preserve.
 */
function seedLegacyDatabase(db: Db): void {
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      avatar_url TEXT,
      is_email_verified INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)').run(
    'proj_legacy',
    'Legacy Project',
    '/tmp/legacy'
  );
  db.prepare('INSERT INTO threads (id, project_id, name) VALUES (?, ?, ?)').run(
    'thr_legacy',
    'proj_legacy',
    'Legacy Thread'
  );
  db.prepare(
    'INSERT INTO events (id, project_id, timestamp, source, type, payload_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('evt_legacy', 'proj_legacy', 1, 'agent', 'agent.output', '{}');
}

function main(): void {
  // --- 1. Fresh install ------------------------------------------------------
  describe('a fresh database is migrated to the latest version and records what it applied');

  const freshDir = scenarioDir('fresh');
  const fresh = openDb(freshDir);
  const freshEngine = new MigrationEngine(fresh.db, fresh.dbPath);
  const freshRun = freshEngine.runMigrations();

  equal('every built-in migration was applied', freshRun.applied.length, builtinMigrations.length);
  check('and none of them was an adoption', freshRun.adoptedExistingSchema === false);

  const freshTables = tableNames(fresh.db);
  check('schema_migrations exists', freshTables.includes('schema_migrations'));

  const missingTables = EXPECTED_TABLES.filter(table => !freshTables.includes(table));
  equal('every consolidated Phase 1–6 table is present', missingTables, []);

  const freshIndexes = (
    fresh.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
      .all() as Array<{ name: string }>
  ).map(row => row.name);
  equal(
    'and every declared index',
    EXPECTED_INDEXES.filter(index => !freshIndexes.includes(index)),
    []
  );

  const records = fresh.db
    .prepare('SELECT * FROM schema_migrations ORDER BY version')
    .all() as MigrationRecord[];
  equal('one row per applied migration', records.length, builtinMigrations.length);
  equal('the baseline is version 1', records[0].version, 1);
  equal('named 001_baseline', records[0].name, '001_baseline');
  check(
    'with a 64-character SHA-256 checksum',
    /^[0-9a-f]{64}$/.test(records[0].checksum),
    records[0].checksum
  );
  check('and an applied_at timestamp', records[0].applied_at > 0);
  equal(
    'the checksum is the hash of the migration content',
    records[0].checksum,
    freshEngine.computeChecksum(freshEngine.canonicalContent(builtinMigrations[0]))
  );

  const freshStatus = freshEngine.getStatus();
  equal('status reports the latest version', freshStatus.currentVersion, LATEST_SCHEMA_VERSION);
  equal('and nothing pending', freshStatus.pending, []);

  // The columns the pre-DEC-030 code used to bolt on afterwards are part of the
  // baseline now, so a fresh install has them without a second pass.
  const threadColumns = columnNames(fresh.db, 'threads');
  equal(
    'threads carries every column the old ALTER block added',
    [
      'profile_id',
      'parent_thread_id',
      'delegation_context_json',
      'worktree_path',
      'worktree_branch',
      'verification_report_json'
    ].filter(column => !threadColumns.includes(column)),
    []
  );

  // --- 2. Idempotency --------------------------------------------------------
  describe('running again applies nothing');

  const secondRun = freshEngine.runMigrations();
  equal('no migration is re-executed', secondRun.applied, []);
  equal('and no snapshot is taken', secondRun.snapshot, null);
  equal(
    'schema_migrations is unchanged',
    (fresh.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number })
      .count,
    builtinMigrations.length
  );

  const reopenedEngine = new MigrationEngine(fresh.db, fresh.dbPath);
  equal(
    'and a freshly constructed engine agrees the file is current',
    reopenedEngine.runMigrations().applied,
    []
  );
  fresh.db.close();

  // --- 3. Transactional rollback --------------------------------------------
  describe('a migration that fails partway leaves nothing behind');

  const rollbackDir = scenarioDir('rollback');
  const rollback = openDb(rollbackDir);
  const brokenMigration = {
    version: 1,
    name: '001_broken',
    sql: `
      CREATE TABLE IF NOT EXISTS rollback_first (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS rollback_second (id TEXT PRIMARY KEY);
      CREATE TABLE rollback_third (id TEXT PRIMARY KEY, THIS IS NOT VALID SQL);
    `
  };
  const rollbackEngine = new MigrationEngine(rollback.db, rollback.dbPath, [brokenMigration]);

  throws('the engine throws and says it rolled back', 'rolled back', () =>
    rollbackEngine.runMigrations()
  );

  const rollbackTables = tableNames(rollback.db);
  check(
    'the table created before the bad statement is gone',
    !rollbackTables.includes('rollback_first'),
    rollbackTables.join(', ')
  );
  check('as is the second', !rollbackTables.includes('rollback_second'));
  equal(
    'and no version was recorded',
    (
      rollback.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
        count: number;
      }
    ).count,
    0
  );
  check(
    'the connection is left usable, not stuck in a transaction',
    (() => {
      try {
        rollback.db.exec('CREATE TABLE rollback_after (id TEXT PRIMARY KEY);');
        rollback.db.exec('DROP TABLE rollback_after;');
        return true;
      } catch {
        return false;
      }
    })()
  );

  // A constraint violation, not a syntax error: the failure arrives from the
  // data rather than the parser, and must roll back just the same.
  const constraintEngine = new MigrationEngine(rollback.db, rollback.dbPath, [
    {
      version: 1,
      name: '001_constraint',
      sql: `
        CREATE TABLE constraint_target (id TEXT PRIMARY KEY);
        INSERT INTO constraint_target (id) VALUES ('same');
        INSERT INTO constraint_target (id) VALUES ('same');
      `
    }
  ]);
  throws('a constraint violation rolls back too', 'rolled back', () =>
    constraintEngine.runMigrations()
  );
  check(
    'and its table never existed',
    !tableNames(rollback.db).includes('constraint_target'),
    tableNames(rollback.db).join(', ')
  );

  // A later migration failing must not undo an earlier one that committed.
  const partialEngine = new MigrationEngine(rollback.db, rollback.dbPath, [
    { version: 1, name: '001_ok', sql: 'CREATE TABLE partial_ok (id TEXT PRIMARY KEY);' },
    { version: 2, name: '002_bad', sql: 'CREATE TABLE partial_bad (NOT VALID);' }
  ]);
  throws('a failure in migration 2 throws', 'Migration 2', () => partialEngine.runMigrations());
  check('migration 1 stays committed', tableNames(rollback.db).includes('partial_ok'));
  check('migration 2 left nothing', !tableNames(rollback.db).includes('partial_bad'));
  equal(
    'and only version 1 is recorded',
    (
      rollback.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
        version: number;
      }>
    ).map(row => row.version),
    [1]
  );
  rollback.db.close();

  // --- 4. Checksum verification ---------------------------------------------
  describe('an edited historical migration is refused');

  const checksumDir = scenarioDir('checksum');
  const checksum = openDb(checksumDir);
  const original = { version: 1, name: '001_original', sql: 'CREATE TABLE checksum_a (id TEXT);' };
  new MigrationEngine(checksum.db, checksum.dbPath, [original]).runMigrations();

  const tampered = {
    version: 1,
    name: '001_original',
    sql: 'CREATE TABLE checksum_a (id TEXT, injected TEXT);'
  };
  const nextMigration = { version: 2, name: '002_next', sql: 'CREATE TABLE checksum_b (id TEXT);' };
  const tamperedEngine = new MigrationEngine(checksum.db, checksum.dbPath, [
    tampered,
    nextMigration
  ]);

  throws('the engine reports a checksum mismatch', 'Checksum mismatch', () =>
    tamperedEngine.runMigrations()
  );
  check(
    'and refuses before running the pending migration behind it',
    !tableNames(checksum.db).includes('checksum_b'),
    tableNames(checksum.db).join(', ')
  );

  // Reformatting the SQL is not tampering: the checksum is taken over the
  // statements, not over their indentation.
  const reformatted = {
    version: 1,
    name: '001_original',
    sql: '\n   CREATE TABLE checksum_a\n      (id TEXT);\n'
  };
  const reformattedEngine = new MigrationEngine(checksum.db, checksum.dbPath, [reformatted]);
  equal(
    're-indenting an applied migration is not a mismatch',
    reformattedEngine.runMigrations().applied,
    []
  );

  // A file written by a build that knows migrations this one does not.
  checksum.db
    .prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?,?,?,?)')
    .run(99, '099_from_the_future', 'deadbeef', Date.now());
  throws(
    'a database from a newer Asterim is refused rather than downgraded',
    'does not know about',
    () => new MigrationEngine(checksum.db, checksum.dbPath, [original]).runMigrations()
  );
  checksum.db.exec('DELETE FROM schema_migrations WHERE version = 99;');
  checksum.db.close();

  // --- 5. Snapshots ----------------------------------------------------------
  describe('a database with data in it is copied aside before it is migrated');

  const snapshotDir = scenarioDir('snapshot');
  const snapshot = openDb(snapshotDir);
  new MigrationEngine(snapshot.db, snapshot.dbPath, [
    { version: 1, name: '001_seed', sql: 'CREATE TABLE snap (id TEXT PRIMARY KEY);' }
  ]).runMigrations();

  equal('a first boot on an empty file takes no snapshot', snapshotsIn(snapshotDir), []);

  snapshot.db.prepare('INSERT INTO snap (id) VALUES (?)').run('row-that-matters');

  const snapshotRun = new MigrationEngine(snapshot.db, snapshot.dbPath, [
    { version: 1, name: '001_seed', sql: 'CREATE TABLE snap (id TEXT PRIMARY KEY);' },
    { version: 2, name: '002_more', sql: 'CREATE TABLE snap_more (id TEXT PRIMARY KEY);' }
  ]).runMigrations();

  const files = snapshotsIn(snapshotDir);
  equal('a pending migration produces exactly one snapshot', files.length, 1);
  check(
    'named asterim.db.bak.<timestamp>',
    /^asterim\.db\.bak\.\d+$/.test(files[0] ?? ''),
    files[0]
  );
  equal(
    'and the run reports where it put it',
    snapshotRun.snapshot,
    path.join(snapshotDir, files[0] ?? '')
  );
  check(
    'the snapshot is inside the channel data directory',
    path.dirname(snapshotRun.snapshot as string) === snapshotDir
  );
  if (isPosix) {
    equal(
      'and is owner-only (0600)',
      fs.statSync(snapshotRun.snapshot as string).mode & 0o777,
      0o600
    );
  }

  const restored = new DatabaseSync(snapshotRun.snapshot as string);
  equal(
    'the snapshot holds the rows the database held',
    (restored.prepare('SELECT id FROM snap').get() as { id: string }).id,
    'row-that-matters'
  );
  check(
    'and predates the migration it was taken for',
    !tableNames(restored).includes('snap_more'),
    tableNames(restored).join(', ')
  );
  restored.close();
  snapshot.db.close();

  // --- 6. Legacy database adoption ------------------------------------------
  describe('a pre-DEC-030 database is adopted rather than rebuilt');

  const legacyDir = scenarioDir('legacy');
  const legacy = openDb(legacyDir);
  seedLegacyDatabase(legacy.db);

  const legacyEngine = new MigrationEngine(legacy.db, legacy.dbPath);
  const legacyRun = legacyEngine.runMigrations();

  check('the engine recognises the existing schema', legacyRun.adoptedExistingSchema === true);
  equal('and records the baseline as applied', legacyRun.applied.length, builtinMigrations.length);
  equal(
    'the file is on the latest version',
    legacyEngine.getStatus().currentVersion,
    LATEST_SCHEMA_VERSION
  );

  equal(
    'the rows that were already there survive',
    (
      legacy.db.prepare('SELECT name FROM projects WHERE id = ?').get('proj_legacy') as {
        name: string;
      }
    ).name,
    'Legacy Project'
  );
  equal(
    'including the events',
    (legacy.db.prepare('SELECT COUNT(*) AS count FROM events').get() as { count: number }).count,
    1
  );

  const legacyProjectColumns = columnNames(legacy.db, 'projects');
  equal(
    'columns the old build never added are added now',
    ['workspace_id', 'visibility'].filter(column => !legacyProjectColumns.includes(column)),
    []
  );
  const legacyThreadColumns = columnNames(legacy.db, 'threads');
  equal(
    'on threads too',
    [
      'profile_id',
      'parent_thread_id',
      'delegation_context_json',
      'worktree_path',
      'worktree_branch',
      'verification_report_json'
    ].filter(column => !legacyThreadColumns.includes(column)),
    []
  );
  check('and events gained thread_id', columnNames(legacy.db, 'events').includes('thread_id'));

  const legacyTables = tableNames(legacy.db);
  equal(
    'the tables the old database never had are created',
    EXPECTED_TABLES.filter(table => !legacyTables.includes(table)),
    []
  );
  check(
    'the index over the newly added parent_thread_id exists',
    (
      legacy.db
        .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'idx_threads_parent'")
        .get() as { count: number }
    ).count === 1
  );

  equal('adoption snapshotted the database first', snapshotsIn(legacyDir).length, 1);
  equal('and a second boot changes nothing', legacyEngine.runMigrations().applied, []);
  legacy.db.close();

  // --- 7. Engine invariants --------------------------------------------------
  describe('the engine refuses a malformed migration set');

  const invariantDir = scenarioDir('invariants');
  const invariant = openDb(invariantDir);
  throws('duplicate versions are rejected at construction', 'Duplicate migration version', () => {
    return new MigrationEngine(invariant.db, invariant.dbPath, [
      { version: 1, name: 'a', sql: '' },
      { version: 1, name: 'b', sql: '' }
    ]);
  });
  check(
    'out-of-order definitions are applied lowest version first',
    (() => {
      const engine = new MigrationEngine(invariant.db, invariant.dbPath, [
        { version: 2, name: '002_second', sql: 'CREATE TABLE ordered_second (id TEXT);' },
        { version: 1, name: '001_first', sql: 'CREATE TABLE ordered_first (id TEXT);' }
      ]);
      const applied = engine.runMigrations().applied as MigrationRecord[];
      return applied.map(record => record.version).join(',') === '1,2';
    })()
  );
  invariant.db.close();
}

try {
  main();
} catch (err) {
  failed++;
  console.error('\nUNCAUGHT ERROR:', err);
} finally {
  cleanup();
  console.log(`\n${passed}/${passed + failed} assertions passed`);
  if (failures.length > 0) {
    console.log('Failed assertions:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}
