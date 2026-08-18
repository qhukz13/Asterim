import type { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import { LATEST_SCHEMA_VERSION, migrations as builtinMigrations } from '../migrations';
import { enforceOwnerOnly } from '../utils/permissions';
import { MigrationEngine } from '../services/MigrationEngine';
import type { MigrationRecord, MigrationStatus } from '../services/MigrationEngine';
import type { ParsedArgs } from './args';
import { booleanFlag, stringFlag } from './args';
import type { ChannelTarget, CliIo } from './context';
import {
  CliError,
  describeTarget,
  field,
  fileSize,
  formatBytes,
  formatTimestamp,
  pad,
  resolveCommandChannel
} from './context';
import {
  DEFAULT_SNAPSHOT_RETENTION,
  createSnapshot,
  listSnapshots,
  pruneSnapshots
} from './snapshots';
import { openDatabase, openDatabaseForReading } from './sqlite';

/**
 * `db:status`, `db:migrate` and `db:snapshot` (P7-03, DEC-030).
 *
 * These are the operations the Core already performs on every boot, exposed so
 * that an operator, a deployment script or CI can perform them deliberately:
 * inspect the schema without starting a server, migrate before the first
 * request rather than during it, and take a snapshot before doing something
 * risky by hand.
 *
 * Two of the three promise not to change the database, and keeping that promise
 * is more delicate than it looks. `MigrationEngine.getStatus()` calls
 * `initMigrationsTable()`, which is a `CREATE TABLE` — harmless, but a write,
 * and a write is exactly what `--dry-run` says it will not do. So the read path
 * here goes through `readStatus` below, which looks the table up in
 * `sqlite_master` and reports a database that has never been migrated as
 * "everything pending" instead of creating anything to find out.
 */

/**
 * The migration status of `db`, without writing to it.
 *
 * Mirrors `MigrationEngine.getStatus()` for a database that has a
 * `schema_migrations` table, and answers for one that does not without making
 * the table exist.
 */
export function readStatus(db: DatabaseSync): MigrationStatus {
  const definitions = [...builtinMigrations].sort((a, b) => a.version - b.version);
  const latestVersion = definitions.reduce(
    (highest, definition) => Math.max(highest, definition.version),
    LATEST_SCHEMA_VERSION
  );

  const hasTable =
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
        )
        .get() as { count: number }
    ).count > 0;

  const applied = hasTable
    ? (db
        .prepare(
          'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC'
        )
        .all() as unknown as MigrationRecord[])
    : [];

  const appliedVersions = new Set(applied.map(record => record.version));

  return {
    currentVersion: applied.reduce((highest, record) => Math.max(highest, record.version), 0),
    latestVersion,
    applied,
    pending: definitions
      .filter(definition => !appliedVersions.has(definition.version))
      .map(definition => ({ version: definition.version, name: definition.name }))
  };
}

/** The status of a database that does not exist yet: nothing applied, all pending. */
function emptyStatus(): MigrationStatus {
  const definitions = [...builtinMigrations].sort((a, b) => a.version - b.version);
  return {
    currentVersion: 0,
    latestVersion: definitions.reduce(
      (highest, definition) => Math.max(highest, definition.version),
      LATEST_SCHEMA_VERSION
    ),
    applied: [],
    pending: definitions.map(definition => ({
      version: definition.version,
      name: definition.name
    }))
  };
}

/** Reads the status of a target, opening it only if there is a file to open. */
function statusOf(target: ChannelTarget): MigrationStatus {
  if (!target.exists) return emptyStatus();
  const db = openDatabaseForReading(target.dbPath);
  try {
    return readStatus(db);
  } finally {
    db.close();
  }
}

/** The channel banner every command prints, so the operator can see what it chose. */
function printTargetHeader(io: CliIo, target: ChannelTarget): void {
  io.out(field('Channel', target.channel));
  io.out(field('Data directory', target.dataDir));
  io.out(
    field(
      'Database',
      target.exists
        ? `${target.dbPath} (${formatBytes(fileSize(target.dbPath))})`
        : `${target.dbPath} (not created yet)`
    )
  );
}

/** The snapshot block shared by `db:status` and `db:snapshot`. */
function printSnapshots(io: CliIo, target: ChannelTarget): void {
  const snapshots = listSnapshots(target.dataDir).reverse();
  io.out('');
  io.out(`Snapshots (${snapshots.length})`);
  if (snapshots.length === 0) {
    io.out('  none');
    return;
  }
  for (const snapshot of snapshots) {
    io.out(
      `  ${pad(snapshot.name, 34)}${pad(formatBytes(snapshot.size), 12)}${formatTimestamp(
        snapshot.timestamp
      )}`
    );
  }
}

/**
 * `asterim db:status` — what shape is this database, and what would happen next.
 *
 * The question DEC-030 exists to make answerable. Before it, the only way to
 * know which schema a file was on was to read its tables and guess.
 */
export function commandDbStatus(args: ParsedArgs, io: CliIo): number {
  const target = describeTarget(resolveCommandChannel(args));
  const status = statusOf(target);

  io.out('Asterim — database status');
  io.out('');
  printTargetHeader(io, target);
  io.out(field('Schema version', String(status.currentVersion)));
  io.out(field('Latest version', String(status.latestVersion)));
  io.out(
    field(
      'State',
      status.pending.length === 0 ? 'up to date' : `${status.pending.length} migration(s) pending`
    )
  );

  io.out('');
  io.out(`Migrations (${status.applied.length} applied, ${status.pending.length} pending)`);
  for (const record of status.applied) {
    io.out(
      `  [applied] ${pad(String(record.version), 5)}${pad(record.name, 28)}` +
        `sha256:${record.checksum.slice(0, 12)}…  ${formatTimestamp(record.applied_at)}`
    );
  }
  for (const entry of status.pending) {
    io.out(`  [PENDING] ${pad(String(entry.version), 5)}${entry.name}`);
  }
  if (status.applied.length === 0 && status.pending.length === 0) {
    io.out('  none');
  }

  printSnapshots(io, target);
  return 0;
}

/**
 * `asterim db:migrate [--dry-run]` — apply what is pending, or say what is.
 *
 * The real run delegates to `MigrationEngine.runMigrations()` rather than
 * reimplementing it: the transaction boundaries, the checksum verification and
 * the pre-migration snapshot are the whole point of DEC-030, and a second
 * implementation of them in the CLI would be a second thing to keep correct.
 */
export function commandDbMigrate(args: ParsedArgs, io: CliIo): number {
  const dryRun = booleanFlag(args, 'dry-run');
  const target = describeTarget(resolveCommandChannel(args));

  io.out(dryRun ? 'Asterim — database migrate (dry run)' : 'Asterim — database migrate');
  io.out('');
  printTargetHeader(io, target);
  io.out('');

  if (dryRun) {
    const status = statusOf(target);
    if (status.pending.length === 0) {
      io.out(`Nothing to do — schema is at version ${status.currentVersion}.`);
      return 0;
    }
    io.out(
      `${status.pending.length} migration(s) would be applied, taking the schema from ` +
        `version ${status.currentVersion} to ${status.latestVersion}:`
    );
    for (const entry of status.pending) {
      io.out(`  ${pad(String(entry.version), 5)}${entry.name}`);
    }
    io.out('');
    io.out('Dry run — nothing was written. Re-run without --dry-run to apply.');
    return 0;
  }

  ensureChannelDir(target);
  const db = openDatabase(target.dbPath);
  try {
    enforceOwnerOnly(target.dbPath, 0o600, 'Asterim CLI');
    const engine = new MigrationEngine(db, target.dbPath);
    const result = engine.runMigrations();

    if (result.adoptedExistingSchema) {
      io.out('Adopted an existing pre-DEC-030 database onto the versioned schema history.');
    }
    if (result.snapshot) {
      io.out(`Pre-migration snapshot: ${result.snapshot}`);
    }
    if (result.applied.length === 0) {
      io.out(`Nothing to do — schema is at version ${engine.getStatus().currentVersion}.`);
      return 0;
    }
    for (const record of result.applied) {
      io.out(`  applied ${pad(String(record.version), 5)}${record.name}`);
    }
    io.out('');
    io.out(
      `Applied ${result.applied.length} migration(s); schema is at version ` +
        `${result.applied[result.applied.length - 1].version}.`
    );
    return 0;
  } finally {
    db.close();
    // WAL leaves two sidecars holding the same rows the database holds, so they
    // are restricted alongside it (DEC-028) — the same thing `DatabaseService`
    // does after its own `init()`.
    enforceOwnerOnly(target.dbPath, 0o600, 'Asterim CLI');
    enforceOwnerOnly(`${target.dbPath}-wal`, 0o600, 'Asterim CLI');
    enforceOwnerOnly(`${target.dbPath}-shm`, 0o600, 'Asterim CLI');
  }
}

/**
 * Creates the channel's data directory if `db:migrate` is the first thing to
 * touch it, owner-only, exactly as `DatabaseService` would have.
 */
function ensureChannelDir(target: ChannelTarget): void {
  if (!fs.existsSync(target.dataDir)) {
    fs.mkdirSync(target.dataDir, { recursive: true, mode: 0o700 });
  }
  enforceOwnerOnly(target.dataDir, 0o700, 'Asterim CLI');
}

/**
 * `asterim db:snapshot [--keep <count>]` — a copy now, and fewer copies after.
 *
 * Retention runs in the same command as creation on purpose. A snapshot command
 * that only ever adds files is one an operator stops running once the data
 * directory gets large, which is the moment they most need the snapshot.
 */
export function commandDbSnapshot(args: ParsedArgs, io: CliIo): number {
  const keepFlag = stringFlag(args, 'keep');
  let keep = DEFAULT_SNAPSHOT_RETENTION;
  if (keepFlag !== undefined) {
    const parsed = Number(keepFlag);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new CliError(`--keep must be a non-negative whole number — got "${keepFlag}".`);
    }
    keep = parsed;
  }

  const target = describeTarget(resolveCommandChannel(args));
  if (!target.exists) {
    throw new CliError(
      `There is no database to snapshot at ${target.dbPath}. ` +
        `Start Asterim on the ${target.channel} channel, or run "asterim db:migrate --channel ${target.channel}" first.`
    );
  }

  io.out('Asterim — database snapshot');
  io.out('');
  printTargetHeader(io, target);
  io.out('');

  // Read-mode open for the same reason `data:clone` uses one: the checkpoint
  // that makes the copy current is required, changing the database's journal
  // mode is not.
  const db = openDatabaseForReading(target.dbPath);
  let snapshotPath: string;
  try {
    snapshotPath = createSnapshot(db, target.dbPath);
  } finally {
    db.close();
  }

  io.out(
    `Snapshot written to ${snapshotPath} (${formatBytes(fileSize(snapshotPath))}, mode 0600).`
  );

  const pruned = pruneSnapshots(target.dataDir, keep);
  if (pruned.length === 0) {
    io.out(`Retention: keeping the ${keep} most recent snapshot(s); none needed removing.`);
  } else {
    io.out(`Retention: keeping the ${keep} most recent snapshot(s); removed ${pruned.length}:`);
    for (const name of pruned) io.out(`  removed ${name}`);
  }

  printSnapshots(io, target);
  return 0;
}
