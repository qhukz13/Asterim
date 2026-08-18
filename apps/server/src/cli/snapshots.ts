import type { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { enforceOwnerOnly } from '../utils/permissions';
import { checkpointWal } from './sqlite';

/**
 * Snapshot naming, listing, creation and retention (P7-03, DEC-030).
 *
 * The migration engine already writes one snapshot per migrating boot. Left
 * alone that is a directory that only ever grows: every schema change on every
 * upgrade leaves behind a full copy of the database, and the copies are exactly
 * as large as the database is. Retention is therefore not housekeeping — it is
 * the reason an operator can keep taking snapshots at all.
 *
 * Pruning is by recorded timestamp rather than by mtime. A snapshot's name
 * states when it was taken; its mtime states when it was last written to disk,
 * which a restore-from-backup, a `cp -r` of the data directory, or a filesystem
 * migration will happily change. Sorting by the name keeps "oldest" meaning the
 * same thing after the directory has been moved.
 */

/** What separates a database filename from the timestamp of a copy of it. */
export const SNAPSHOT_INFIX = '.bak.';

/** How many snapshots a channel keeps when `--keep` is not given. */
export const DEFAULT_SNAPSHOT_RETENTION = 10;

/** One `asterim.db.bak.<timestamp>` file. */
export interface SnapshotFile {
  /** Filename only, e.g. `asterim.db.bak.1700000000000`. */
  name: string;
  /** Absolute path. */
  path: string;
  /** The millisecond timestamp encoded in the name. */
  timestamp: number;
  /** The `-N` disambiguator for snapshots taken in the same millisecond, else 0. */
  sequence: number;
  /** Size on disk, in bytes. */
  size: number;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every snapshot of `base` in `dataDir`, oldest first.
 *
 * Ordering is (timestamp, sequence) so the two copies of a database taken
 * inside the same millisecond keep the order they were written in. A missing
 * directory is an empty list rather than an error: a channel that has never
 * been started has no snapshots, which is a fact, not a failure.
 */
export function listSnapshots(dataDir: string, base = 'asterim.db'): SnapshotFile[] {
  if (!fs.existsSync(dataDir)) return [];

  const pattern = new RegExp(`^${escapeForRegExp(base + SNAPSHOT_INFIX)}(\\d+)(?:-(\\d+))?$`);
  const snapshots: SnapshotFile[] = [];

  for (const name of fs.readdirSync(dataDir)) {
    const match = pattern.exec(name);
    if (!match) continue;
    const full = path.join(dataDir, name);
    let size: number;
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      size = stat.size;
    } catch {
      continue;
    }
    snapshots.push({
      name,
      path: full,
      timestamp: Number(match[1]),
      sequence: match[2] ? Number(match[2]) : 0,
      size
    });
  }

  return snapshots.sort((a, b) =>
    a.timestamp === b.timestamp ? a.sequence - b.sequence : a.timestamp - b.timestamp
  );
}

/**
 * A snapshot path that does not already exist.
 *
 * Two snapshots inside the same millisecond would otherwise overwrite each
 * other, and a backup that silently replaced another backup is not a backup.
 * Same rule, and same `-N` suffix, as `MigrationEngine.createSnapshot`.
 */
export function snapshotTargetPath(dbPath: string, now: number = Date.now()): string {
  const dataDir = path.dirname(dbPath);
  const base = path.basename(dbPath);
  let target = path.join(dataDir, `${base}${SNAPSHOT_INFIX}${now}`);
  for (let attempt = 1; fs.existsSync(target); attempt++) {
    target = path.join(dataDir, `${base}${SNAPSHOT_INFIX}${now}-${attempt}`);
  }
  return target;
}

/**
 * Copies `sourcePath` to `targetPath`, owner-only.
 *
 * The copy holds every byte the original holds, so it inherits the original's
 * permissions rather than the umask's (DEC-028). Any directory it needs is
 * created 0700 for the same reason — a backup written into a world-readable
 * directory is a backup an operator did not agree to publish.
 */
export function copyOwnerOnly(sourcePath: string, targetPath: string): void {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  enforceOwnerOnly(dir, 0o700, 'Asterim CLI');
  fs.copyFileSync(sourcePath, targetPath);
  enforceOwnerOnly(targetPath, 0o600, 'Asterim CLI');
}

/**
 * Checkpoints the WAL and copies the database beside itself.
 *
 * `db` must be an open connection to `dbPath` — the checkpoint is what makes
 * the copy current, and only a connection can issue it.
 */
export function createSnapshot(db: DatabaseSync, dbPath: string): string {
  checkpointWal(db);
  const target = snapshotTargetPath(dbPath);
  copyOwnerOnly(dbPath, target);
  return target;
}

/**
 * Deletes the oldest snapshots until at most `maxKeep` remain.
 *
 * Returns the filenames it removed, newest-removed last, so a caller can print
 * exactly what is gone rather than a count. A snapshot that cannot be deleted
 * is skipped and left out of the returned list: retention failing is not a
 * reason for the command that triggered it to fail, and reporting a deletion
 * that did not happen would be worse than reporting nothing.
 */
export function pruneSnapshots(
  dataDir: string,
  maxKeep: number = DEFAULT_SNAPSHOT_RETENTION,
  base = 'asterim.db'
): string[] {
  const keep = Math.max(0, Math.floor(maxKeep));
  const snapshots = listSnapshots(dataDir, base);
  if (snapshots.length <= keep) return [];

  const pruned: string[] = [];
  for (const snapshot of snapshots.slice(0, snapshots.length - keep)) {
    try {
      fs.rmSync(snapshot.path, { force: true });
      pruned.push(snapshot.name);
    } catch (err) {
      console.warn(`[Asterim CLI] Could not remove ${snapshot.name}: ${(err as Error).message}`);
    }
  }
  return pruned;
}
