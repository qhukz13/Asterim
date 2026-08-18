import fs from 'fs';
import path from 'path';
import { enforceOwnerOnly } from '../utils/permissions';
import type { ParsedArgs } from './args';
import { booleanFlag, stringFlag } from './args';
import type { ChannelTarget, CliIo } from './context';
import {
  CliError,
  describeTarget,
  field,
  fileSize,
  formatBytes,
  requireChannel,
  resolveCommandChannel
} from './context';
import { copyOwnerOnly, snapshotTargetPath } from './snapshots';
import { readStatus } from './db';
import { checkpointWal, isSqliteFile, openDatabaseForReading } from './sqlite';

/**
 * `data:clone`, `data:backup` and `data:restore` (P7-03, DEC-029/DEC-030).
 *
 * DEC-029 gave the development channel its own directory so a development run
 * cannot touch the operator's data. That isolation is only useful if there is a
 * sanctioned way to move data *across* it — otherwise the first time a
 * developer needs to reproduce a bug against real content, they point
 * `ASTERIM_DATA_DIR` at `~/.asterim` and the isolation is gone. `data:clone` is
 * that way: one direction at a time, named explicitly, with the source opened
 * only to checkpoint it and never written.
 *
 * Every destructive path here takes a copy of what it is about to replace
 * first, and the copy lands in the same `asterim.db.bak.<timestamp>` series the
 * migration engine and `db:snapshot` write to — so `db:snapshot --keep` prunes
 * them too, and there is one retention policy rather than three.
 */

/**
 * Removes the write-ahead log sidecars next to a database that is being
 * replaced.
 *
 * This is the step whose absence corrupts. `-wal` and `-shm` describe the file
 * they sit beside; leaving the old ones next to a *different* database means
 * SQLite either replays changes that belong to another file or refuses to open
 * the result. Both are worse than the state the operator was trying to fix.
 */
function discardWalSidecars(dbPath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    try {
      fs.rmSync(`${dbPath}${suffix}`, { force: true });
    } catch (err) {
      throw new CliError(
        `Could not remove the stale ${suffix} sidecar at ${dbPath}${suffix}: ${(err as Error).message}`
      );
    }
  }
}

/** Checkpoints a database so a plain file copy of it is current, then closes it. */
function checkpointFile(dbPath: string, io: CliIo): void {
  // Read-mode open: the checkpoint has to rewrite the `-wal` sidecar, but
  // nothing here may change the database header, and `journal_mode` lives in
  // the header. A clone must not be able to convert its source.
  const db = openDatabaseForReading(dbPath);
  try {
    if (!checkpointWal(db)) {
      io.out(
        '  note: the write-ahead log could not be checkpointed (another process may be reading); ' +
          'the copy may be missing the most recent commits.'
      );
    }
  } finally {
    db.close();
  }
}

/**
 * Copies a database that is about to be overwritten into its own snapshot
 * series, and returns where it went.
 */
function safetyBackup(target: ChannelTarget, io: CliIo): string {
  checkpointFile(target.dbPath, io);
  const backup = snapshotTargetPath(target.dbPath);
  copyOwnerOnly(target.dbPath, backup);
  io.out(`  safety backup: ${backup} (${formatBytes(fileSize(backup))}, mode 0600)`);
  return backup;
}

/** Opens the result of a copy and reads its schema version, proving it is usable. */
function verifyCopy(dbPath: string, io: CliIo, label: string): void {
  if (!isSqliteFile(dbPath)) {
    throw new CliError(`${label} at ${dbPath} is not a SQLite database after the copy.`);
  }
  const db = openDatabaseForReading(dbPath);
  try {
    const status = readStatus(db);
    io.out(
      `  verified: ${label} opens, schema version ${status.currentVersion} of ${status.latestVersion}` +
        (status.pending.length > 0 ? ` (${status.pending.length} migration(s) pending)` : '')
    );
  } finally {
    db.close();
  }
}

/**
 * `asterim data:clone --from <channel> --to <channel> [--force]`.
 *
 * Refuses three things before it copies anything: a clone onto itself, a clone
 * between two channels that `ASTERIM_DATA_DIR` has collapsed onto one
 * directory, and a clone from a channel that has no database. The second is not
 * hypothetical — `resolveDataDir` lets `ASTERIM_DATA_DIR` override the channel,
 * so with it set both names resolve to the same path and the "clone" would be a
 * file copied over itself.
 */
export function commandDataClone(args: ParsedArgs, io: CliIo): number {
  const fromFlag = stringFlag(args, 'from');
  const toFlag = stringFlag(args, 'to');
  if (!fromFlag || !toFlag) {
    throw new CliError(
      'data:clone needs both --from <stable|dev> and --to <stable|dev>. ' +
        'Example: asterim data:clone --from stable --to dev'
    );
  }

  const from = requireChannel(fromFlag, '--from');
  const to = requireChannel(toFlag, '--to');
  if (from === to) {
    throw new CliError(`--from and --to are both "${from}"; there is nothing to clone.`);
  }

  const source = describeTarget(from);
  const destination = describeTarget(to);
  if (path.resolve(source.dbPath) === path.resolve(destination.dbPath)) {
    throw new CliError(
      `The ${from} and ${to} channels both resolve to ${source.dbPath}. ` +
        'ASTERIM_DATA_DIR overrides the per-channel directory — unset it to clone between channels.'
    );
  }
  if (!source.exists) {
    throw new CliError(`The ${from} channel has no database at ${source.dbPath}.`);
  }

  const force = booleanFlag(args, 'force');
  if (destination.exists && !force) {
    throw new CliError(
      `The ${to} channel already has a database at ${destination.dbPath} ` +
        `(${formatBytes(fileSize(destination.dbPath))}). Re-run with --force to replace it; ` +
        'a safety backup of it will be taken first.'
    );
  }

  io.out('Asterim — clone channel data');
  io.out('');
  io.out(field('Source', `${from} · ${source.dbPath} (${formatBytes(fileSize(source.dbPath))})`));
  io.out(field('Destination', `${to} · ${destination.dbPath}`));
  io.out('');

  const sizeBefore = fileSize(source.dbPath);
  checkpointFile(source.dbPath, io);

  if (destination.exists) {
    safetyBackup(destination, io);
  }

  discardWalSidecars(destination.dbPath);
  copyOwnerOnly(source.dbPath, destination.dbPath);
  enforceOwnerOnly(destination.dataDir, 0o700, 'Asterim CLI');

  verifyCopy(destination.dbPath, io, `the ${to} database`);

  // The source is only ever read and checkpointed. Saying so with a number is
  // worth more than saying so in prose: a clone that quietly moved data instead
  // of copying it is the failure this command must never have.
  const sizeAfter = fileSize(source.dbPath);
  io.out(
    `  source untouched: ${source.dbPath} is ${formatBytes(sizeAfter)}` +
      (sizeAfter === sizeBefore ? '' : ` (was ${formatBytes(sizeBefore)} before the checkpoint)`)
  );

  io.out('');
  io.out(`Cloned ${from} → ${to}. The ${to} channel now has its own copy, mode 0600.`);
  return 0;
}

/**
 * `asterim data:backup [--out <path>]`.
 *
 * The one command allowed to write outside the channel's directory, and only
 * when `--out` says where. An `--out` naming an existing directory is treated
 * as a directory rather than refused — `asterim data:backup --out /mnt/usb` is
 * what an operator means, and failing it on a technicality helps nobody.
 */
export function commandDataBackup(args: ParsedArgs, io: CliIo): number {
  const target = describeTarget(resolveCommandChannel(args));
  if (!target.exists) {
    throw new CliError(`There is no database to back up at ${target.dbPath}.`);
  }

  const out = stringFlag(args, 'out');
  let destination: string;
  if (out === undefined) {
    destination = snapshotTargetPath(target.dbPath);
  } else {
    const resolved = path.resolve(out);
    const isDirectory = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
    destination = isDirectory
      ? snapshotTargetPath(path.join(resolved, path.basename(target.dbPath)))
      : resolved;
  }

  if (path.resolve(destination) === path.resolve(target.dbPath)) {
    throw new CliError('--out points at the live database itself; a backup must be a second file.');
  }

  io.out('Asterim — database backup');
  io.out('');
  io.out(field('Channel', target.channel));
  io.out(field('Database', `${target.dbPath} (${formatBytes(fileSize(target.dbPath))})`));
  io.out(field('Backup', destination));
  io.out('');

  checkpointFile(target.dbPath, io);
  copyOwnerOnly(target.dbPath, destination);
  verifyCopy(destination, io, 'the backup');

  io.out('');
  io.out(`Backup written to ${destination} (${formatBytes(fileSize(destination))}, mode 0600).`);
  return 0;
}

/**
 * `asterim data:restore --file <path> [--force]`.
 *
 * The only command here that destroys something, so it checks the most: the
 * backup has to exist, has to actually be a SQLite file, and — when the channel
 * already has a database — `--force` has to be present. A copy of what is being
 * replaced is taken regardless, into the same snapshot series, so even a forced
 * restore of the wrong file is recoverable.
 */
export function commandDataRestore(args: ParsedArgs, io: CliIo): number {
  const file = stringFlag(args, 'file');
  if (!file) {
    throw new CliError(
      'data:restore needs --file <path> naming the backup to restore. ' +
        'Run "asterim db:status" to list the snapshots this channel has.'
    );
  }

  const sourcePath = path.resolve(file);
  if (!fs.existsSync(sourcePath)) {
    throw new CliError(`No such backup file: ${sourcePath}`);
  }
  if (!isSqliteFile(sourcePath)) {
    throw new CliError(
      `${sourcePath} is not a SQLite database. Point --file at an asterim.db.bak.* snapshot ` +
        'or a file written by "asterim data:backup".'
    );
  }

  const target = describeTarget(resolveCommandChannel(args));
  if (path.resolve(target.dbPath) === sourcePath) {
    throw new CliError('--file names the live database itself; there is nothing to restore from.');
  }

  const force = booleanFlag(args, 'force');
  if (target.exists && !force) {
    throw new CliError(
      `The ${target.channel} channel already has a database at ${target.dbPath} ` +
        `(${formatBytes(fileSize(target.dbPath))}). Re-run with --force to replace it; ` +
        'a safety backup of it will be taken first.'
    );
  }

  io.out('Asterim — database restore');
  io.out('');
  io.out(field('Channel', target.channel));
  io.out(field('Backup', `${sourcePath} (${formatBytes(fileSize(sourcePath))})`));
  io.out(field('Database', target.dbPath));
  io.out('');

  if (target.exists) {
    safetyBackup(target, io);
  }

  discardWalSidecars(target.dbPath);
  copyOwnerOnly(sourcePath, target.dbPath);
  enforceOwnerOnly(target.dataDir, 0o700, 'Asterim CLI');

  verifyCopy(target.dbPath, io, `the ${target.channel} database`);

  io.out('');
  io.out(`Restored ${target.dbPath} from ${sourcePath} (mode 0600).`);
  io.out('Run "asterim db:migrate" if the restored database is behind this build.');
  return 0;
}
