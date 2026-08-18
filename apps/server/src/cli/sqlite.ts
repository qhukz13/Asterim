import type { DatabaseSync } from 'node:sqlite';
import fs from 'fs';

/**
 * Opening a SQLite connection from the CLI, without going through
 * `DatabaseService`.
 *
 * The service is a module-level singleton that resolves the *active* channel's
 * path at import time and migrates it on construction. Both are wrong here: a
 * CLI invocation names the channel it wants (`--channel`, and `data:clone`
 * names two of them at once), and `db:status` must be able to look at a
 * database without changing it.
 */

// The same guard `DatabaseService` uses: esbuild rewrites a bare
// `import 'node:sqlite'` in a way that strips the `node:` prefix, and the
// module does not exist without it.
const req: (id: string) => unknown = typeof require !== 'undefined' ? require : module.require;
const { DatabaseSync: DBSync } = req('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSync;
};

/** The first sixteen bytes of every SQLite database file. */
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'binary');

/**
 * Opens `dbPath` with the same connection settings the Core runs with.
 *
 * `journal_mode` is persisted in the file header, so setting it here only ever
 * confirms what a Core-created database already says; `busy_timeout` is
 * per-connection and has to be re-applied, because the CLI is not the only
 * process that holds this file open — each MCP memory server does too, and the
 * SQLite default of zero would make a `db:migrate` run during an active session
 * fail on contact instead of waiting.
 */
export function openDatabase(dbPath: string): DatabaseSync {
  const db = new DBSync(dbPath);
  try {
    db.exec('PRAGMA journal_mode = WAL;');
  } catch {
    /* A database on a filesystem that cannot do WAL still opens. */
  }
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
  } catch {
    /* Older SQLite builds; the default of 0 is survivable for a one-shot command. */
  }
  return db;
}

/**
 * Opens `dbPath` without changing anything about the file.
 *
 * The connection every command that has promised not to modify a database uses
 * — `db:status`, `db:migrate --dry-run`, and the source side of `data:clone`
 * and `data:backup`. The difference from `openDatabase` is `journal_mode`,
 * which is stored in the database header: setting it on a file in rollback-
 * journal mode would convert it, and converting a database is not something a
 * command called "status" is allowed to do. `busy_timeout` is still applied,
 * because it lives on the connection rather than in the file and without it a
 * read that meets an active writer fails within a millisecond.
 */
export function openDatabaseForReading(dbPath: string): DatabaseSync {
  const db = new DBSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
  } catch {
    /* Older SQLite builds; the default of 0 is survivable for a one-shot command. */
  }
  return db;
}

/**
 * `true` when the file starts with the SQLite magic string.
 *
 * The check `data:restore` runs before it overwrites a live database. It is not
 * an integrity check of the whole file — that would mean opening and scanning
 * it — but it is what catches the overwhelmingly likely mistake, which is
 * pointing `--file` at a log, a tarball, or a `-wal` sidecar.
 */
export function isSqliteFile(filePath: string): boolean {
  let handle: number | null = null;
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < SQLITE_HEADER.length) return false;
    handle = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(SQLITE_HEADER.length);
    fs.readSync(handle, header, 0, header.length, 0);
    return header.equals(SQLITE_HEADER);
  } catch {
    return false;
  } finally {
    if (handle !== null) {
      try {
        fs.closeSync(handle);
      } catch {
        /* Nothing useful to do about a failed close on a read-only handle. */
      }
    }
  }
}

/**
 * Folds the write-ahead log back into the main database file.
 *
 * Every copy this CLI takes — snapshot, backup, clone — copies `asterim.db`
 * alone. In WAL mode the most recent commits live in the `-wal` sidecar and not
 * in that file, so a copy taken without this is a copy of the database as of
 * some earlier, unknowable moment. Failure is reported rather than thrown: a
 * checkpoint can be blocked by another reader, and a slightly stale backup is
 * worth more than no backup.
 */
export function checkpointWal(db: DatabaseSync): boolean {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    return true;
  } catch {
    return false;
  }
}
