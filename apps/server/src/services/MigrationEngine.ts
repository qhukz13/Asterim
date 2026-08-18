import type { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { LATEST_SCHEMA_VERSION, migrations as builtinMigrations } from '../migrations';
import type { MigrationDefinition } from '../migrations/types';
import { enforceOwnerOnly } from '../utils/permissions';

/**
 * The versioned forward migration engine (DEC-030).
 *
 * What it replaces is the failure mode, not the SQL. The pre-Phase-7
 * `DatabaseService.init()` ran `CREATE TABLE IF NOT EXISTS` and a wall of
 * `ALTER TABLE ... try/catch (ignore if exists)` on every boot. That is
 * unversioned — nothing on disk says which shape a file is on — and, worse,
 * every failure looks like success: a swallowed exception cannot distinguish
 * "this column is already there" from "this statement is wrong", so a half-
 * applied schema change survives the boot that made it.
 *
 * The engine gives each schema state four properties the old code had none of:
 *
 *   - **Versioned.** `schema_migrations` records which migrations a file has
 *     seen, so the answer to "what shape is this database" is read, not guessed.
 *   - **Checksummed.** Each applied row carries the SHA-256 of the migration's
 *     content. An edit to a migration that has already run is detected on the
 *     next boot and stops the Core before any forward migration executes.
 *   - **Transactional.** A migration runs inside `BEGIN IMMEDIATE` and is
 *     committed only if every statement in it succeeded. Anything else rolls
 *     back and throws, which halts startup with the database on its previous
 *     shape rather than somewhere between two.
 *   - **Recoverable.** A timestamped, owner-only snapshot of the file is taken
 *     before the first pending migration touches it.
 *
 * Snapshots are written next to the database, which is inside the channel's
 * resolved data directory (DEC-029) — a development run cannot leave backup
 * files in the stable channel's directory or anywhere else on disk.
 */

/** One row of `schema_migrations`: a migration this database has already seen. */
export interface MigrationRecord {
  version: number;
  name: string;
  checksum: string;
  applied_at: number;
}

/** What `runMigrations()` did, for the caller that wants to log or assert on it. */
export interface MigrationRunResult {
  /** Migrations applied by this run, in order. Empty when the database was current. */
  applied: MigrationRecord[];
  /** The snapshot taken before the first migration, or `null` if none was needed. */
  snapshot: string | null;
  /** `true` when a pre-DEC-030 database was adopted onto the versioned history. */
  adoptedExistingSchema: boolean;
}

/** The diagnostic answer behind `db:status`. */
export interface MigrationStatus {
  currentVersion: number;
  latestVersion: number;
  applied: MigrationRecord[];
  pending: Array<{ version: number; name: string }>;
}

/**
 * Tables that only a pre-DEC-030 Asterim can have created.
 *
 * Their presence without a `schema_migrations` table is the signature of a
 * database built by the old `init()`, and the cue to adopt it as version 1
 * rather than treat it as a fresh install.
 */
const PRE_MIGRATION_TABLES = ['projects', 'events', 'users'];

export class MigrationEngine {
  private readonly db: DatabaseSync;
  private readonly dbPath: string;
  private readonly definitions: MigrationDefinition[];

  /**
   * @param db        An open connection. The engine never opens or closes one:
   *                  `DatabaseService` owns the connection's lifetime.
   * @param dbPath    The file behind `db`, used to place snapshots beside it.
   *                  `:memory:` is accepted and simply skips snapshotting.
   * @param overrides Migrations to run instead of the built-in set. Only the
   *                  test suite passes this; production always runs the list
   *                  compiled into the build.
   */
  constructor(db: DatabaseSync, dbPath: string, overrides?: MigrationDefinition[]) {
    this.db = db;
    this.dbPath = dbPath;
    this.definitions = [...(overrides ?? builtinMigrations)].sort((a, b) => a.version - b.version);

    const seen = new Set<number>();
    for (const definition of this.definitions) {
      if (seen.has(definition.version)) {
        throw new Error(
          `[MigrationEngine] Duplicate migration version ${definition.version} (${definition.name}). Versions must be unique.`
        );
      }
      seen.add(definition.version);
    }
  }

  /** Ensures `schema_migrations` exists. Idempotent, and outside any migration transaction. */
  public initMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);
  }

  /** The migrations this database has already seen, oldest first. */
  public getAppliedMigrations(): MigrationRecord[] {
    return this.db
      .prepare(
        'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC'
      )
      .all() as unknown as MigrationRecord[];
  }

  /** SHA-256, hex. */
  public computeChecksum(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * The exact bytes a migration's checksum is taken over.
   *
   * Runs of whitespace collapse to a single space first. The point of the
   * checksum is to catch a changed *schema*, and re-indenting a SQL template
   * literal — something a formatter does without being asked — changes no
   * schema. Hashing the raw text would turn every reformat into a false report
   * of tampering that bricks every existing database on the next boot.
   *
   * `prepare` is deliberately not part of this. It is a function, and a bundler
   * may rewrite its source text while preserving its behaviour.
   */
  public canonicalContent(definition: MigrationDefinition): string {
    const parts = [
      definition.sql,
      ...(definition.columns ?? []).map(
        column => `ALTER TABLE ${column.table} ADD COLUMN ${column.column} ${column.definition};`
      ),
      definition.postSql ?? ''
    ];
    return parts.join('\n').replace(/\s+/g, ' ').trim();
  }

  /**
   * Refuses to go forward when the recorded history and the code disagree.
   *
   * Two disagreements are possible and both are fatal:
   *
   *   - An applied version this build has no definition for. The file has been
   *     written by a newer Asterim; migrating it with an older engine would
   *     apply version N on top of a schema that already contains N+1.
   *   - An applied version whose checksum no longer matches its definition. The
   *     migration was edited after it ran, so what the code claims the database
   *     contains is not what it contains.
   *
   * Throws before any forward migration executes, so the database is left
   * exactly as it was found.
   */
  public verifyChecksums(applied: MigrationRecord[], available: MigrationDefinition[]): void {
    const byVersion = new Map(available.map(definition => [definition.version, definition]));

    for (const record of applied) {
      const definition = byVersion.get(record.version);
      if (!definition) {
        throw new Error(
          `[MigrationEngine] This database has migration ${record.version} (${record.name}) applied, ` +
            `which this build of Asterim does not know about. It was written by a newer version — ` +
            `upgrade Asterim rather than downgrading the database.`
        );
      }

      const expected = this.computeChecksum(this.canonicalContent(definition));
      if (expected !== record.checksum) {
        throw new Error(
          `[MigrationEngine] Checksum mismatch on applied migration ${record.version} (${record.name}). ` +
            `Recorded ${record.checksum.slice(0, 12)}…, computed ${expected.slice(0, 12)}…. ` +
            `An already-applied migration has been modified; historical migrations are immutable. ` +
            `Add a new migration instead of editing this one.`
        );
      }
    }
  }

  /**
   * Copies the database aside before anything is changed.
   *
   * Returns the snapshot path, or `null` when there is nothing worth copying:
   * an in-memory database, a file that does not exist, or a first run where the
   * file holds nothing but the header SQLite wrote when the connection opened.
   * A fresh install would otherwise litter the data directory with a backup of
   * an empty database on every very first boot.
   *
   * A failure to write the snapshot is fatal on purpose: proceeding would apply
   * a schema change with no way back, which is the one outcome DEC-030 exists
   * to prevent.
   *
   * The WAL is checkpointed first. In WAL mode recent commits live in the
   * `-wal` sidecar and not in the main file, so a plain copy taken without a
   * checkpoint is a copy of the database as of some earlier moment.
   */
  public createSnapshot(dbPath: string): string | null {
    if (!dbPath || dbPath === ':memory:') return null;
    if (!fs.existsSync(dbPath)) return null;
    if (fs.statSync(dbPath).size === 0) return null;
    if (!this.hasUserData()) return null;

    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch (err) {
      console.warn(
        `[MigrationEngine] Could not checkpoint the WAL before snapshotting: ${(err as Error).message}`
      );
    }

    const dataDir = path.dirname(dbPath);
    const base = path.basename(dbPath);
    // Two snapshots inside the same millisecond would otherwise overwrite each
    // other, and a backup that silently replaced another backup is not a backup.
    let target = path.join(dataDir, `${base}.bak.${Date.now()}`);
    for (let attempt = 1; fs.existsSync(target); attempt++) {
      target = path.join(dataDir, `${base}.bak.${Date.now()}-${attempt}`);
    }

    fs.copyFileSync(dbPath, target);
    // The snapshot holds every byte the database holds, so it inherits the
    // database's permissions rather than the umask's (DEC-028).
    enforceOwnerOnly(target, 0o600, 'MigrationEngine');
    console.log(`[MigrationEngine] Pre-migration snapshot written to ${target}`);
    return target;
  }

  /**
   * Brings the database up to `LATEST_SCHEMA_VERSION`.
   *
   * Order matters: the history is read and verified first, so a tampered or
   * newer-than-this-build database is rejected before a snapshot is taken or a
   * statement runs; the snapshot is taken second, so it captures the state the
   * first migration is about to change; migrations apply last, one transaction
   * each.
   */
  public runMigrations(): MigrationRunResult {
    this.initMigrationsTable();

    const applied = this.getAppliedMigrations();
    this.verifyChecksums(applied, this.definitions);

    const appliedVersions = new Set(applied.map(record => record.version));
    const pending = this.definitions.filter(definition => !appliedVersions.has(definition.version));

    if (pending.length === 0) {
      return { applied: [], snapshot: null, adoptedExistingSchema: false };
    }

    // A database that predates DEC-030 already contains everything the baseline
    // migration declares. It is adopted rather than rebuilt: the baseline is
    // written to converge on the same schema from either starting point, so
    // running it here creates nothing that exists and adds only the columns an
    // older Asterim never got around to adding.
    const adoptedExistingSchema = applied.length === 0 && this.hasPreMigrationSchema();
    if (adoptedExistingSchema) {
      console.log(
        '[MigrationEngine] Existing pre-migration database detected; adopting it onto the versioned schema history.'
      );
    }

    const snapshot = this.createSnapshot(this.dbPath);

    const results: MigrationRecord[] = [];
    for (const definition of pending) {
      results.push(this.applyMigration(definition));
    }

    console.log(
      `[MigrationEngine] Applied ${results.length} migration(s); schema is at version ${
        results[results.length - 1].version
      }.`
    );

    return { applied: results, snapshot, adoptedExistingSchema };
  }

  /** Applied versions, pending versions, and where the file currently sits. */
  public getStatus(): MigrationStatus {
    this.initMigrationsTable();
    const applied = this.getAppliedMigrations();
    const appliedVersions = new Set(applied.map(record => record.version));

    return {
      currentVersion: applied.reduce((highest, record) => Math.max(highest, record.version), 0),
      latestVersion: this.definitions.reduce(
        (highest, definition) => Math.max(highest, definition.version),
        LATEST_SCHEMA_VERSION
      ),
      applied,
      pending: this.definitions
        .filter(definition => !appliedVersions.has(definition.version))
        .map(definition => ({ version: definition.version, name: definition.name }))
    };
  }

  /**
   * One migration, all or nothing.
   *
   * The `schema_migrations` row is inserted inside the same transaction as the
   * statements it describes. Recording the migration outside it would allow a
   * database to claim a version it does not have, which is worse than having no
   * version at all.
   */
  private applyMigration(definition: MigrationDefinition): MigrationRecord {
    const checksum = this.computeChecksum(this.canonicalContent(definition));
    const record: MigrationRecord = {
      version: definition.version,
      name: definition.name,
      checksum,
      applied_at: Date.now()
    };

    // IMMEDIATE, not DEFERRED: the write lock is taken up front rather than at
    // the first write, so a competing writer (an MCP memory server holds the
    // same file open) is waited out by busy_timeout before any DDL has run,
    // instead of failing partway through.
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      definition.prepare?.(this.db);

      if (definition.sql.trim().length > 0) {
        this.db.exec(definition.sql);
      }

      for (const column of definition.columns ?? []) {
        if (this.columnExists(column.table, column.column)) continue;
        this.db.exec(
          `ALTER TABLE ${column.table} ADD COLUMN ${column.column} ${column.definition};`
        );
      }

      if (definition.postSql && definition.postSql.trim().length > 0) {
        this.db.exec(definition.postSql);
      }

      this.db
        .prepare(
          'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)'
        )
        .run(record.version, record.name, record.checksum, record.applied_at);

      this.db.exec('COMMIT;');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch (rollbackErr) {
        console.error(
          `[MigrationEngine] Rollback after a failed migration also failed: ${(rollbackErr as Error).message}`
        );
      }
      throw new Error(
        `[MigrationEngine] Migration ${definition.version} (${definition.name}) failed and was rolled back: ${(err as Error).message}`,
        { cause: err }
      );
    }

    console.log(`[MigrationEngine] Applied ${definition.version} (${definition.name}).`);
    return record;
  }

  /** `true` when `table` exists and has a column named `column`. */
  private columnExists(table: string, column: string): boolean {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name?: string;
    }>;
    return columns.some(existing => existing.name === column);
  }

  /**
   * `true` when the file holds something a snapshot would be protecting.
   *
   * `schema_migrations` is excluded because the engine itself creates it, so on
   * a first boot it is the only table present and its existence says nothing
   * about there being data at risk.
   */
  private hasUserData(): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'`
      )
      .get() as { count: number };
    return row.count > 0;
  }

  /** `true` when this database was built by the pre-DEC-030 `init()`. */
  private hasPreMigrationSchema(): boolean {
    const placeholders = PRE_MIGRATION_TABLES.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
      )
      .get(...PRE_MIGRATION_TABLES) as { count: number };
    return row.count > 0;
  }
}
