/**
 * Tests for the database & data CLI tooling (P7-03, DEC-029 / DEC-030).
 *
 * The claim under test is not "the commands print something" — it is that the
 * `asterim` binary can be pointed at a channel's database from a terminal
 * without ever becoming a server, and that every path which replaces a database
 * file leaves a way back. So the suite is organised around the four properties
 * the commands have to have:
 *
 *   1. **Inert when it says it is.** `db:status` and `db:migrate --dry-run`
 *      report on a database that does not exist without creating it, and on one
 *      that does without writing to it.
 *   2. **Recoverable.** Every command that overwrites an existing database —
 *      `data:clone --force`, `data:restore --force` — copies it into the
 *      `asterim.db.bak.<timestamp>` series first, and refuses outright without
 *      `--force`. Retention (`pruneSnapshots`) removes the oldest and only the
 *      oldest.
 *   3. **Owner-only.** Every file written lands at 0600 inside a 0700
 *      directory (DEC-028), including clones into a channel directory that did
 *      not exist a moment ago.
 *   4. **Not a server.** Spawned as a real subprocess, `asterim db:status`
 *      exits on its own, prints to stdout rather than into `server.log`, and
 *      leaves no listener behind.
 *
 * Channel-crossing sections run against a fake `HOME` with `ASTERIM_DATA_DIR`
 * unset, because that variable overrides the per-channel directory for both
 * channels at once — the same technique `ChannelIsolation.test.ts` uses, and
 * the reason `data:clone` has an explicit guard against it.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/__tests__/CliDatabaseTooling.test.ts
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-cli-'));
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-cli-home-'));
process.env.ASTERIM_DATA_DIR = path.join(tmpDir, 'default');

// `require`, not `import`: the modules under test resolve their paths from
// `process.env` at call time, but the convention in this directory is to keep
// every load below the environment set-up above so a future import-time capture
// cannot silently break the suite.
const { DatabaseSync } = require('node:sqlite');
const { runCli, isCliInvocation } = require('../../cli');
const { parseArgs, stringFlag, booleanFlag } = require('../../cli/args');
const { pruneSnapshots, listSnapshots, SNAPSHOT_INFIX } = require('../../cli/snapshots');
const { migrations: builtinMigrations, LATEST_SCHEMA_VERSION } = require('../../migrations');

type Db = InstanceType<typeof DatabaseSync>;

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

function cleanup(): void {
  for (const dir of [tmpDir, fakeHome]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[cleanup] removed ${dir}`);
    } catch (err) {
      console.error(`[cleanup] failed to remove ${dir}:`, (err as Error).message);
    }
  }
}

const isPosix = process.platform !== 'win32';

// --- CLI harness ---

interface Run {
  code: number;
  out: string;
  err: string;
}

/** Runs one command in-process and captures everything it printed. */
function cli(...argv: string[]): Run {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCli(argv, {
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line)
  }) as number;
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function mode(target: string): number {
  return fs.statSync(target).mode & 0o777;
}

function snapshotNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(name => name.includes(SNAPSHOT_INFIX))
    .sort();
}

/** Opens a database read-only-ish, runs `fn`, and always closes it. */
function withDb<T>(dbPath: string, fn: (db: Db) => T): T {
  const db = new DatabaseSync(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function projectNames(dbPath: string): string[] {
  return withDb(dbPath, db =>
    (db.prepare('SELECT name FROM projects ORDER BY name').all() as Array<{ name: string }>).map(
      row => row.name
    )
  );
}

function insertProject(dbPath: string, id: string, name: string): void {
  withDb(dbPath, db => {
    db.exec('PRAGMA journal_mode = WAL;');
    db.prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)').run(
      id,
      name,
      `/tmp/${id}`
    );
  });
}

/** Uses the per-channel home-relative directories instead of ASTERIM_DATA_DIR. */
function useChannelDirs(): void {
  delete process.env.ASTERIM_DATA_DIR;
  process.env.HOME = fakeHome;
}

/** Pins both channels onto one explicit directory again. */
function useExplicitDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  process.env.ASTERIM_DATA_DIR = dir;
}

function main(): void {
  const originalHome = process.env.HOME;
  const stableDir = path.join(fakeHome, '.asterim');
  const devDir = path.join(fakeHome, '.asterim-dev');
  const stableDb = path.join(stableDir, 'asterim.db');
  const devDb = path.join(devDir, 'asterim.db');

  // --- 1. Argument parsing and dispatch detection ---------------------------
  describe('the command line is read the way the commands document it');

  const migrateArgs = parseArgs(['db:migrate', '--dry-run']);
  equal('the first token is the command', migrateArgs.command, 'db:migrate');
  check('a trailing bare flag is boolean true', booleanFlag(migrateArgs, 'dry-run') === true);

  const cloneArgs = parseArgs(['data:clone', '--from', 'stable', '--to', 'dev', '--force']);
  equal('--from takes the token after it', stringFlag(cloneArgs, 'from'), 'stable');
  equal('and so does --to', stringFlag(cloneArgs, 'to'), 'dev');
  check('--force stays boolean', booleanFlag(cloneArgs, 'force') === true);

  equal(
    '--name=value is split on the equals sign',
    stringFlag(parseArgs(['db:snapshot', '--keep=3']), 'keep'),
    '3'
  );

  // The case a naive parser gets wrong: a boolean flag immediately followed by
  // an option that does take a value.
  const restoreArgs = parseArgs(['data:restore', '--force', '--file', '/x/backup.db']);
  check('a boolean flag does not swallow the option after it', booleanFlag(restoreArgs, 'force'));
  equal('so --file keeps its value', stringFlag(restoreArgs, 'file'), '/x/backup.db');
  equal(
    'a bare --file is not read as the string "true"',
    stringFlag(parseArgs(['data:restore', '--file']), 'file'),
    undefined
  );
  equal(
    'and an empty --out= (an unset shell variable) reads as absent',
    stringFlag(parseArgs(['data:backup', '--out=']), 'out'),
    undefined
  );
  equal(
    'a negative value is read as a value, so the command can reject it',
    stringFlag(parseArgs(['db:snapshot', '--keep', '-2']), 'keep'),
    '-2'
  );

  check('db: commands are recognised as CLI', isCliInvocation(['db:status']) === true);
  check('so are data: commands', isCliInvocation(['data:clone', '--from', 'stable']) === true);
  check('and help', isCliInvocation(['--help']) === true && isCliInvocation(['help']) === true);
  check('an empty argv is a server boot', isCliInvocation([]) === false);
  check('and so is anything else', isCliInvocation(['--inspect']) === false);
  check(
    'a misspelled subcommand is still a CLI invocation, not a silent server boot',
    isCliInvocation(['db:staus']) === true
  );

  // --- 2. db:status on a database that does not exist -----------------------
  describe('db:status reports on a database that is not there without creating one');

  const emptyDir = path.join(tmpDir, 'empty');
  useExplicitDir(emptyDir);

  const emptyStatus = cli('db:status');
  equal('the command succeeds', emptyStatus.code, 0);
  check('it says the file has not been created', emptyStatus.out.includes('not created yet'));
  check('the schema version is 0', /Schema version\s+0/.test(emptyStatus.out));
  check(
    'the latest version is the one this build ships',
    emptyStatus.out.includes(`Latest version    ${LATEST_SCHEMA_VERSION}`) ||
      new RegExp(`Latest version\\s+${LATEST_SCHEMA_VERSION}`).test(emptyStatus.out)
  );
  check(
    'every built-in migration is listed as pending',
    emptyStatus.out.includes(`${builtinMigrations.length} migration(s) pending`)
  );
  check('the baseline is one of them', emptyStatus.out.includes('[PENDING]'));
  check('and there are no snapshots', emptyStatus.out.includes('Snapshots (0)'));
  check(
    'nothing was written to disk',
    fs.readdirSync(emptyDir).length === 0,
    fs.readdirSync(emptyDir).join(', ')
  );

  // --- 3. db:migrate, dry run and real ---------------------------------------
  describe('db:migrate --dry-run says what would happen and changes nothing');

  const migrateDir = path.join(tmpDir, 'migrate');
  useExplicitDir(migrateDir);

  const dryRun = cli('db:migrate', '--dry-run');
  equal('the dry run succeeds', dryRun.code, 0);
  check('it names the migrations it would apply', dryRun.out.includes('would be applied'));
  check('it says it wrote nothing', dryRun.out.includes('Dry run — nothing was written'));
  check(
    'and the database still does not exist',
    fs.readdirSync(migrateDir).length === 0,
    fs.readdirSync(migrateDir).join(', ')
  );

  describe('db:migrate applies the pending migrations');

  const migrated = cli('db:migrate');
  equal('the migration succeeds', migrated.code, 0);
  check(
    `it reports applying ${builtinMigrations.length} migration(s)`,
    migrated.out.includes(`Applied ${builtinMigrations.length} migration(s)`)
  );
  check('the database now exists', fs.existsSync(path.join(migrateDir, 'asterim.db')));
  if (isPosix) {
    equal('owner-only (0600)', mode(path.join(migrateDir, 'asterim.db')), 0o600);
    equal('inside an owner-only directory (0700)', mode(migrateDir), 0o700);
  }
  equal('a fresh database takes no pre-migration snapshot', snapshotNames(migrateDir).length, 0);

  const afterMigrate = cli('db:status');
  check(
    'db:status now reports the latest schema version',
    new RegExp(`Schema version\\s+${LATEST_SCHEMA_VERSION}`).test(afterMigrate.out)
  );
  check('and up to date', afterMigrate.out.includes('up to date'));
  check('the baseline is listed as applied', afterMigrate.out.includes('[applied]'));
  check('with its name', afterMigrate.out.includes('001_baseline'));
  check(
    'and a SHA-256 checksum prefix',
    /sha256:[0-9a-f]{12}…/.test(afterMigrate.out),
    afterMigrate.out
  );
  check(
    'the applied timestamp is an ISO instant',
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/.test(afterMigrate.out)
  );

  const rerun = cli('db:migrate');
  equal('re-running applies nothing', rerun.code, 0);
  check('and says so', rerun.out.includes('Nothing to do'));
  check(
    'the dry run agrees the database is current',
    cli('db:migrate', '--dry-run').out.includes('Nothing to do')
  );

  // --- 4. db:snapshot and retention -----------------------------------------
  describe('db:snapshot copies the database aside, owner-only');

  const migrateDbPath = path.join(migrateDir, 'asterim.db');
  insertProject(migrateDbPath, 'proj_snapshot', 'Snapshot Project');

  const snapshotRun = cli('db:snapshot');
  equal('the snapshot succeeds', snapshotRun.code, 0);
  const firstSnapshots = snapshotNames(migrateDir);
  equal('exactly one snapshot exists', firstSnapshots.length, 1);
  check(
    'named asterim.db.bak.<timestamp>',
    /^asterim\.db\.bak\.\d+$/.test(firstSnapshots[0]),
    firstSnapshots[0]
  );
  if (isPosix) {
    equal('at mode 0600', mode(path.join(migrateDir, firstSnapshots[0])), 0o600);
  }
  equal(
    'and it holds the rows the database held',
    projectNames(path.join(migrateDir, firstSnapshots[0])),
    ['Snapshot Project']
  );
  check('the command reports the retention policy', snapshotRun.out.includes('Retention: keeping'));
  check('and lists the snapshot it made', snapshotRun.out.includes(firstSnapshots[0]));

  describe('retention prunes the oldest snapshots and only those');

  // Hand-written snapshots with known timestamps, so "oldest" is a fact rather
  // than a race against the clock.
  const retentionDir = path.join(tmpDir, 'retention');
  fs.mkdirSync(retentionDir, { recursive: true, mode: 0o700 });
  for (const stamp of [1000, 2000, 3000, 4000, 5000]) {
    fs.writeFileSync(path.join(retentionDir, `asterim.db.bak.${stamp}`), `snapshot-${stamp}`);
  }
  fs.writeFileSync(path.join(retentionDir, 'asterim.db'), 'not a snapshot');
  fs.writeFileSync(path.join(retentionDir, 'server.log'), 'not a snapshot either');

  equal(
    'listSnapshots returns only the snapshots, oldest first',
    (listSnapshots(retentionDir) as Array<{ name: string }>).map(entry => entry.name),
    [
      'asterim.db.bak.1000',
      'asterim.db.bak.2000',
      'asterim.db.bak.3000',
      'asterim.db.bak.4000',
      'asterim.db.bak.5000'
    ]
  );

  equal('pruning to 2 removes the three oldest', pruneSnapshots(retentionDir, 2), [
    'asterim.db.bak.1000',
    'asterim.db.bak.2000',
    'asterim.db.bak.3000'
  ]);
  equal('leaving the two newest', snapshotNames(retentionDir), [
    'asterim.db.bak.4000',
    'asterim.db.bak.5000'
  ]);
  check('the database itself is untouched', fs.existsSync(path.join(retentionDir, 'asterim.db')));
  check(
    'and so is anything else in the directory',
    fs.existsSync(path.join(retentionDir, 'server.log'))
  );
  equal('pruning again removes nothing', pruneSnapshots(retentionDir, 2), []);
  equal('pruning to more than there are removes nothing', pruneSnapshots(retentionDir, 99), []);
  equal('pruning to 0 removes all of them', pruneSnapshots(retentionDir, 0).length, 2);
  equal('and the directory has no snapshots left', snapshotNames(retentionDir), []);

  describe('db:snapshot --keep enforces the retention threshold end to end');

  useExplicitDir(migrateDir);
  for (const stamp of [100, 200, 300, 400, 500, 600, 700, 800]) {
    fs.writeFileSync(path.join(migrateDir, `asterim.db.bak.${stamp}`), `old-${stamp}`);
  }
  const keepRun = cli('db:snapshot', '--keep', '3');
  equal('the command succeeds', keepRun.code, 0);
  const kept = snapshotNames(migrateDir);
  equal('exactly three snapshots survive', kept.length, 3);
  check(
    'the new one is among them',
    kept.some(name => Number(name.split(SNAPSHOT_INFIX)[1]) > 1000)
  );
  check('and the oldest hand-made ones are gone', !kept.includes('asterim.db.bak.100'));
  check('the command lists what it removed', keepRun.out.includes('removed asterim.db.bak.100'));

  describe('db:snapshot refuses what it cannot do');

  equal('a non-numeric --keep is rejected', cli('db:snapshot', '--keep', 'lots').code, 1);
  check(
    'with an explanation',
    cli('db:snapshot', '--keep', 'lots').err.includes('non-negative whole number')
  );
  equal('a negative --keep is rejected', cli('db:snapshot', '--keep', '-2').code, 1);
  equal('and a fractional one', cli('db:snapshot', '--keep', '2.5').code, 1);

  // The failure that would hurt: `--keep=$UNSET` must not read as zero and
  // delete every snapshot the channel has.
  useExplicitDir(migrateDir);
  const beforeEmptyKeep = snapshotNames(migrateDir).length;
  const emptyKeep = cli('db:snapshot', '--keep=');
  equal('an empty --keep= falls back to the default retention', emptyKeep.code, 0);
  check(
    'rather than pruning everything',
    snapshotNames(migrateDir).length >= beforeEmptyKeep,
    `${beforeEmptyKeep} → ${snapshotNames(migrateDir).length}`
  );

  useExplicitDir(path.join(tmpDir, 'nodb'));
  const noDb = cli('db:snapshot');
  equal('snapshotting a channel with no database fails', noDb.code, 1);
  check('and says which file is missing', noDb.err.includes('no database to snapshot'));

  // --- 5. data:clone ---------------------------------------------------------
  describe('data:clone seeds one channel from another without touching the source');

  useChannelDirs();

  const cloneFromNothing = cli('data:clone', '--from', 'dev', '--to', 'stable');
  equal('cloning from a channel with no database fails', cloneFromNothing.code, 1);
  check(
    'and names the channel and path',
    cloneFromNothing.err.includes('dev channel has no database'),
    cloneFromNothing.err
  );

  equal('migrating the stable channel succeeds', cli('db:migrate', '--channel', 'stable').code, 0);
  check('and creates ~/.asterim/asterim.db', fs.existsSync(stableDb));
  check('leaving ~/.asterim-dev absent', !fs.existsSync(devDir));
  insertProject(stableDb, 'proj_stable', 'Stable Project');

  const cloned = cli('data:clone', '--from', 'stable', '--to', 'dev');
  equal('the clone succeeds', cloned.code, 0);
  check('the dev channel now has a database', fs.existsSync(devDb));
  equal('holding the rows the stable database held', projectNames(devDb), ['Stable Project']);
  if (isPosix) {
    equal('at mode 0600', mode(devDb), 0o600);
    equal('inside a 0700 directory that did not exist before', mode(devDir), 0o700);
  }
  check('the command verifies the copy opens', cloned.out.includes('verified:'));
  check('and reports the source untouched', cloned.out.includes('source untouched'));
  equal('the stable database still has its row', projectNames(stableDb), ['Stable Project']);
  equal('and no snapshot was needed at the destination', snapshotNames(devDir), []);

  describe('data:clone refuses to overwrite without --force, and backs up with it');

  insertProject(devDb, 'proj_dev_only', 'Dev Only Project');
  const refused = cli('data:clone', '--from', 'stable', '--to', 'dev');
  equal('a second clone is refused', refused.code, 1);
  check('and points at --force', refused.err.includes('--force'), refused.err);
  equal('the dev database is untouched', projectNames(devDb), [
    'Dev Only Project',
    'Stable Project'
  ]);

  const forced = cli('data:clone', '--from', 'stable', '--to', 'dev', '--force');
  equal('with --force the clone succeeds', forced.code, 0);
  check('a safety backup was taken first', forced.out.includes('safety backup:'));
  equal('exactly one backup sits in the dev directory', snapshotNames(devDir).length, 1);
  equal(
    'and it holds what the dev database held before the clone',
    projectNames(path.join(devDir, snapshotNames(devDir)[0])),
    ['Dev Only Project', 'Stable Project']
  );
  equal('the dev database now matches stable', projectNames(devDb), ['Stable Project']);
  equal('and the stable database is still untouched', projectNames(stableDb), ['Stable Project']);
  if (isPosix) {
    equal(
      'the safety backup is owner-only',
      mode(path.join(devDir, snapshotNames(devDir)[0])),
      0o600
    );
  }

  describe('data:clone rejects the arguments that cannot mean anything');

  const sameChannel = cli('data:clone', '--from', 'stable', '--to', 'stable');
  equal('cloning a channel onto itself fails', sameChannel.code, 1);
  check('and says there is nothing to clone', sameChannel.err.includes('nothing to clone'));

  const badChannel = cli('data:clone', '--from', 'stble', '--to', 'dev');
  equal('an unrecognised channel fails', badChannel.code, 1);
  check('rather than guessing what it meant', badChannel.err.includes('--from must be one of'));

  const missingTo = cli('data:clone', '--from', 'stable');
  equal('a missing --to fails', missingTo.code, 1);
  check('with the usage line', missingTo.err.includes('--from <stable|dev> and --to'));

  // With ASTERIM_DATA_DIR set, both channel names resolve to one directory —
  // the clone would be a file copied over itself, so it is refused.
  useExplicitDir(path.join(tmpDir, 'collapsed'));
  const collapsed = cli('data:clone', '--from', 'stable', '--to', 'dev');
  equal('a clone between channels collapsed onto one directory fails', collapsed.code, 1);
  check(
    'and names ASTERIM_DATA_DIR as the reason',
    collapsed.err.includes('ASTERIM_DATA_DIR'),
    collapsed.err
  );

  // --- 6. data:backup and data:restore --------------------------------------
  describe('data:backup writes a standalone copy');

  useChannelDirs();

  const exportPath = path.join(tmpDir, 'exports', 'stable-export.db');
  const backup = cli('data:backup', '--channel', 'stable', '--out', exportPath);
  equal('the backup succeeds', backup.code, 0);
  check('the file exists', fs.existsSync(exportPath));
  if (isPosix) {
    equal('owner-only (0600)', mode(exportPath), 0o600);
    equal('in a directory it created 0700', mode(path.dirname(exportPath)), 0o700);
  }
  equal('and it holds the live rows', projectNames(exportPath), ['Stable Project']);
  check('the command verifies the copy opens', backup.out.includes('verified: the backup'));

  const defaultBackup = cli('data:backup', '--channel', 'stable');
  equal('a backup with no --out succeeds', defaultBackup.code, 0);
  equal('and lands in the channel directory as a snapshot', snapshotNames(stableDir).length, 1);
  check(
    'named asterim.db.bak.<timestamp>',
    /^asterim\.db\.bak\.\d+$/.test(snapshotNames(stableDir)[0]),
    snapshotNames(stableDir)[0]
  );

  const backupOntoItself = cli('data:backup', '--channel', 'stable', '--out', stableDb);
  equal('backing up onto the live database is refused', backupOntoItself.code, 1);
  check('with an explanation', backupOntoItself.err.includes('must be a second file'));

  describe('data:restore replaces a database and keeps a way back');

  insertProject(stableDb, 'proj_after_backup', 'Written After The Backup');
  equal('the stable database has moved on', projectNames(stableDb), [
    'Stable Project',
    'Written After The Backup'
  ]);

  const restoreRefused = cli('data:restore', '--channel', 'stable', '--file', exportPath);
  equal('restoring over a live database is refused', restoreRefused.code, 1);
  check('and points at --force', restoreRefused.err.includes('--force'));
  equal('the database is untouched', projectNames(stableDb), [
    'Stable Project',
    'Written After The Backup'
  ]);

  const snapshotsBefore = snapshotNames(stableDir).length;
  const restored = cli('data:restore', '--channel', 'stable', '--file', exportPath, '--force');
  equal('with --force the restore succeeds', restored.code, 0);
  check('a safety backup was taken first', restored.out.includes('safety backup:'));
  equal(
    'so the stable directory has one more snapshot',
    snapshotNames(stableDir).length,
    snapshotsBefore + 1
  );
  equal('the database is back to what the backup held', projectNames(stableDb), ['Stable Project']);
  if (isPosix) {
    equal('still owner-only', mode(stableDb), 0o600);
  }
  check('the restore verifies the result opens', restored.out.includes('verified:'));

  // The row written after the backup is not lost — it is in the safety copy.
  const safetyCopy = snapshotNames(stableDir)
    .map(name => path.join(stableDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  check(
    'and the rows it replaced survive in the safety backup',
    projectNames(safetyCopy).includes('Written After The Backup'),
    projectNames(safetyCopy).join(', ')
  );

  describe('data:restore refuses a file that is not a backup');

  const noFile = cli('data:restore', '--channel', 'stable');
  equal('a missing --file fails', noFile.code, 1);
  check('with the usage line', noFile.err.includes('--file <path>'));

  const missingFile = cli(
    'data:restore',
    '--channel',
    'stable',
    '--file',
    path.join(tmpDir, 'nope.db')
  );
  equal('a non-existent file fails', missingFile.code, 1);
  check('and says so', missingFile.err.includes('No such backup file'));

  const notADatabase = path.join(tmpDir, 'not-a-database.db');
  fs.writeFileSync(notADatabase, 'this is a log file, not a database\n'.repeat(20));
  const wrongFile = cli('data:restore', '--channel', 'stable', '--file', notADatabase, '--force');
  equal('a file that is not SQLite fails', wrongFile.code, 1);
  check('the header check catches it', wrongFile.err.includes('is not a SQLite database'));
  equal('and the live database is untouched', projectNames(stableDb), ['Stable Project']);

  // --- 7. Help and unknown commands ------------------------------------------
  describe('help is printed for --help, for no arguments, and after a typo');

  const help = cli('--help');
  equal('--help succeeds', help.code, 0);
  for (const command of [
    'db:status',
    'db:migrate',
    'db:snapshot',
    'data:clone',
    'data:backup',
    'data:restore'
  ]) {
    check(`it documents ${command}`, help.out.includes(command));
  }
  check('and the --channel option', help.out.includes('--channel <stable|dev>'));

  equal('no arguments prints help', cli().code, 0);
  check('and the usage line', cli().out.includes('asterim <command> [options]'));

  const unknown = cli('db:staus');
  equal('an unknown command exits non-zero', unknown.code, 1);
  check('naming what it did not recognise', unknown.err.includes('Unknown command: db:staus'));
  check('and printing the help', unknown.err.includes('db:status'));

  // --- 8. The binary as a subprocess: a command, not a server ----------------
  describe('spawned for real, a CLI invocation exits without becoming a server');

  process.env.HOME = originalHome;
  const tsxBin = path.resolve(__dirname, '../../../node_modules/.bin/tsx');
  const entrypoint = path.resolve(__dirname, '../../index.ts');
  const spawnDir = path.join(tmpDir, 'spawned');
  fs.mkdirSync(spawnDir, { recursive: true, mode: 0o700 });

  if (!fs.existsSync(tsxBin)) {
    check('tsx is available to spawn the entrypoint', false, `not found at ${tsxBin}`);
  } else {
    const spawned = spawnSync(tsxBin, [entrypoint, 'db:status'], {
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        ASTERIM_DATA_DIR: spawnDir,
        // A port nothing else in this repository uses, so an accidental listen
        // is a listen and not a collision with a developer's running Core.
        PORT: '39217'
      }
    });

    equal('the process exits 0', spawned.status, 0);
    check('it did not time out', spawned.signal === null, String(spawned.signal));
    check(
      'the status went to real stdout rather than into server.log',
      spawned.stdout.includes('Asterim — database status'),
      spawned.stdout.slice(0, 400)
    );
    check(
      'initLogger never ran, so no server.log was created',
      !fs.existsSync(path.join(spawnDir, 'server.log')),
      fs.readdirSync(spawnDir).join(', ')
    );
    check(
      'and db:status created no database',
      !fs.existsSync(path.join(spawnDir, 'asterim.db')),
      fs.readdirSync(spawnDir).join(', ')
    );
    check(
      'nothing from the server boot sequence was printed',
      !spawned.stdout.includes('[DEBUG] Registering') &&
        !spawned.stdout.includes('listening on port'),
      spawned.stdout.slice(0, 400)
    );

    const spawnedHelp = spawnSync(tsxBin, [entrypoint, '--help'], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, ASTERIM_DATA_DIR: spawnDir, PORT: '39217' }
    });
    equal('--help exits 0 as a subprocess too', spawnedHelp.status, 0);
    check('printing the command list', spawnedHelp.stdout.includes('data:clone'));

    const spawnedBad = spawnSync(tsxBin, [entrypoint, 'db:staus'], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, ASTERIM_DATA_DIR: spawnDir, PORT: '39217' }
    });
    equal('an unknown command exits 1 as a subprocess', spawnedBad.status, 1);
    check(
      'on stderr',
      spawnedBad.stderr.includes('Unknown command'),
      spawnedBad.stderr.slice(0, 300)
    );
  }
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
