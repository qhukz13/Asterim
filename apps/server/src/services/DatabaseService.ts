import type { DatabaseSync } from 'node:sqlite';
// Hack to prevent esbuild from stripping the node: prefix
const req = typeof require !== 'undefined' ? require : (module as any).require;
const { DatabaseSync: DBSync } = req('node:sqlite');
import path from 'path';
import fs from 'fs';
import { getAsterimChannel, resolveDataDir } from '../utils/channel';
import { enforceOwnerOnly } from '../utils/permissions';
import { MigrationEngine } from './MigrationEngine';
import type { MigrationStatus } from './MigrationEngine';

/**
 * The directory holding asterim.db and the loopback descriptor.
 *
 * Re-exported from `utils/channel` rather than declared here: the channel
 * decides the path now (DEC-029), and the services that already import it from
 * this module keep working unchanged.
 */
export { resolveDataDir };

export class DatabaseService {
  private db: DatabaseSync;
  private migrations: MigrationEngine;
  public readonly dbPath: string;

  constructor() {
    const dataDir = resolveDataDir();

    // Ensure the data directory exists. DEC-028 (Local-First Data Sovereignty):
    // project memory never leaves the machine, so the files holding it are
    // owner-only — 0700 on the directory, 0600 on the database below.
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    }
    enforceOwnerOnly(dataDir, 0o700);

    this.dbPath = path.join(dataDir, 'asterim.db');
    // The channel is named on the same line as the file it chose, so a run that
    // opened the wrong database is visible in the first lines of the log rather
    // than after it has written to it (DEC-029). The existing prefix is kept
    // verbatim: the MCP memory server's stdio guard suites assert on it.
    console.log(`[Database] Using database at: ${this.dbPath} (channel: ${getAsterimChannel()})`);

    this.db = new DBSync(this.dbPath);
    this.migrations = new MigrationEngine(this.db, this.dbPath);

    // After open, so the file exists on a first run. WAL leaves two sidecar
    // files next to it holding the same data, so they are restricted too.
    enforceOwnerOnly(this.dbPath, 0o600);

    this.init();

    enforceOwnerOnly(`${this.dbPath}-wal`, 0o600);
    enforceOwnerOnly(`${this.dbPath}-shm`, 0o600);
  }

  private init() {
    // Write-Ahead Logging: concurrent readers during writes, and fewer fsyncs.
    // Persisted in the database header, so this applies once per database file.
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      console.warn('[Database] Could not enable WAL journal mode; continuing with the default journal.');
    }

    // Wait for a competing writer instead of failing on contact. WAL keeps readers
    // out of the way, but writers still serialize, and SQLite's default timeout is
    // zero — a second writer gets SQLITE_BUSY within a millisecond. That matters
    // because the Core is not the only process writing this file: each MCP memory
    // server (packages/mcp-memory-server) opens it too, and a decision an agent
    // recorded while the Core happened to be mid-write would simply be lost.
    // Unlike journal_mode, this is a per-connection setting, so it is re-applied
    // by every process that constructs a DatabaseService.
    try {
      this.db.exec('PRAGMA busy_timeout = 5000;');
    } catch {
      console.warn('[Database] Could not set busy_timeout; concurrent writes may fail immediately.');
    }

    // The schema itself is no longer built here (DEC-030). What used to be six
    // hundred lines of `CREATE TABLE IF NOT EXISTS` followed by a wall of
    // `ALTER TABLE ... try/catch` now lives in `src/migrations/`, versioned and
    // checksummed; this method keeps only the two PRAGMAs, which are properties
    // of the file and of this connection rather than of the schema.
    //
    // The engine is allowed to throw, and the throw is deliberately not caught.
    // `dbService` below is constructed at import time, so a failed migration
    // takes the process down before any route, socket or adapter can read a
    // database whose shape the Core cannot vouch for — which is the whole point
    // of running each migration in a transaction: the file is left on its
    // previous version, with a snapshot of it sitting beside it.
    this.migrations.runMigrations();
  }

  /**
   * Which migrations this database has applied, and which are still pending.
   *
   * Read-only and safe to call after startup: it is the diagnostic behind
   * "what shape is this file on", a question that before DEC-030 had no answer.
   */
  public getMigrationStatus(): MigrationStatus {
    return this.migrations.getStatus();
  }

  public getDb(): DatabaseSync {
    return this.db;
  }

  /**
   * Rebuilds the database file, discarding what its freed pages still hold.
   *
   * SQLite does not overwrite a page when a row moves or shrinks; it marks it
   * free and reuses it later. So encrypting a credential in place leaves the
   * cleartext readable in the file afterwards — verified on a real migration,
   * and exactly the exposure the vault exists to close, since a backup or a
   * support bundle copies free pages along with everything else.
   *
   * VACUUM alone is not enough here: in WAL mode the rebuilt pages sit in the
   * sidecar and the original file keeps its old content until a checkpoint moves
   * them, so the truncating checkpoint is part of the operation rather than
   * housekeeping after it.
   *
   * Never throws. This runs at startup, needs a lock no other connection is
   * holding — the MCP memory servers open the same file — and a database that
   * could not be compacted is still a correct, encrypted database.
   */
  public compact(): boolean {
    try {
      this.db.exec('VACUUM;');
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      return true;
    } catch (err) {
      console.warn(`[Database] Could not compact the database: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Closes the connection so WAL is checkpointed rather than abandoned.
   * Idempotent: shutdown may reach this more than once.
   */
  public close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } catch (err) {
      console.warn('[Database] Could not close cleanly:', (err as Error).message);
    }
  }

  private closed = false;
}

export const dbService = new DatabaseService();
