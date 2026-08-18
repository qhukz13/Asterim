import fs from 'fs';
import path from 'path';
import type { AsterimChannel } from '@asterim/shared';
import { ASTERIM_CHANNELS, parseAsterimChannel } from '@asterim/shared';
import { getAsterimChannel, resolveDataDir } from '../utils/channel';
import type { ParsedArgs } from './args';
import { stringFlag } from './args';

/**
 * The bits every CLI command shares: where output goes, which channel it acts
 * on, and how numbers are printed (P7-03).
 */

/** Where a command writes. Injectable so the test suite can read what it printed. */
export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

/** The real one: stdout and stderr, one line at a time. */
export const consoleIo: CliIo = {
  out(line) {
    process.stdout.write(`${line}\n`);
  },
  err(line) {
    process.stderr.write(`${line}\n`);
  }
};

/** Thrown by a command to abort with a message and exit code 1. */
export class CliError extends Error {}

/** A channel, and the paths that belong to it. */
export interface ChannelTarget {
  channel: AsterimChannel;
  dataDir: string;
  dbPath: string;
  /** `true` when `asterim.db` exists and is not a zero-byte placeholder. */
  exists: boolean;
}

/** Everything about `channel` the commands need, without opening anything. */
export function describeTarget(channel: AsterimChannel): ChannelTarget {
  const dataDir = resolveDataDir(channel);
  const dbPath = path.join(dataDir, 'asterim.db');
  // A zero-byte `asterim.db` counts as absent: that is what an interrupted
  // first boot leaves behind, and there is nothing in it to clone or back up.
  let exists: boolean;
  try {
    exists = fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;
  } catch {
    exists = false;
  }
  return { channel, dataDir, dbPath, exists };
}

/**
 * Reads a channel name, or refuses.
 *
 * `parseAsterimChannel` returns `null` for anything it does not recognise, and
 * the CLI turns that into an error rather than the resolver's fallback. The
 * fallback is right for an environment variable a process inherited; it is
 * wrong for a flag a human just typed, where the only safe reading of
 * `--channel stble` is "you did not say which database to touch".
 */
export function requireChannel(value: string, label: string): AsterimChannel {
  const channel = parseAsterimChannel(value);
  if (!channel) {
    throw new CliError(`${label} must be one of ${ASTERIM_CHANNELS.join(', ')} — got "${value}".`);
  }
  return channel;
}

/**
 * The channel a `db:*` command acts on.
 *
 * `--channel` wins, then whatever the process would have run as. Note that
 * `ASTERIM_DATA_DIR`, if set, still overrides the directory for *both*
 * channels — that is `resolveDataDir`'s documented precedence and every test
 * suite in this repository depends on it, so the CLI does not carve an
 * exception out of it. `db:status` prints the directory it resolved for exactly
 * this reason.
 */
export function resolveCommandChannel(args: ParsedArgs): AsterimChannel {
  const explicit = stringFlag(args, 'channel');
  if (explicit !== undefined) return requireChannel(explicit, '--channel');
  return getAsterimChannel();
}

/** Human-readable byte count. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** A millisecond timestamp as an ISO-8601 instant, or `—` when there isn't one. */
export function formatTimestamp(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—';
  return new Date(ms).toISOString();
}

/** Right-pads to `width` so columns line up without a table library. */
export function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

/** `label` and `value` as one aligned line of a key/value block. */
export function field(label: string, value: string): string {
  return `  ${pad(label, 18)}${value}`;
}

/** The size of a file, or 0 when it isn't there. */
export function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}
