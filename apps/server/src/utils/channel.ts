import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AsterimChannel, ChannelInfo } from '@asterim/shared';
import {
  ASTERIM_CHANNEL_ENV,
  dataDirNameForChannel,
  defaultPortForChannel,
  parseAsterimChannel
} from '@asterim/shared';

/**
 * Which Asterim this process is, and where it is allowed to write (DEC-029).
 *
 * Everything that lands on disk at runtime — `asterim.db`, `server.json`,
 * `server.log`, `crash.log`, the vault salt, the skills directory — is joined
 * onto `resolveDataDir()`. Routing that single function through the channel is
 * what makes a development run physically incapable of touching the database
 * the operator depends on, rather than merely unlikely to.
 *
 * Both functions read `process.env` on every call. That is deliberate: the test
 * suites set `ASTERIM_DATA_DIR` to a temp directory and services are module-level
 * singletons, so a value captured at import time would be the wrong one.
 */

/**
 * The active channel.
 *
 * An explicit `ASTERIM_CHANNEL` wins. With nothing set the channel follows
 * `NODE_ENV`, so `pnpm dev` and a packaged binary each land on the right side
 * without the operator having to remember a second variable. An unrecognised
 * value is not honoured — falling through to the `NODE_ENV` rule is the safe
 * reading of a typo, because guessing would mean pointing at whichever
 * directory the misspelling happened to resemble.
 */
export function getAsterimChannel(): AsterimChannel {
  const explicit = parseAsterimChannel(process.env[ASTERIM_CHANNEL_ENV]);
  if (explicit) return explicit;
  return process.env.NODE_ENV === 'development' ? 'dev' : 'stable';
}

/** `true` when this process is running on the development channel. */
export function isDevChannel(): boolean {
  return getAsterimChannel() === 'dev';
}

/**
 * The directory holding this channel's runtime files.
 *
 * `ASTERIM_DATA_DIR` still wins over the channel: it is how every test suite
 * points a service at a temp directory, and how an operator relocates their
 * data. Otherwise the channel decides, `~/.asterim` for stable and
 * `~/.asterim-dev` for development.
 */
export function resolveDataDir(channel: AsterimChannel = getAsterimChannel()): string {
  const envDir = process.env.ASTERIM_DATA_DIR;
  if (envDir) {
    return path.resolve(envDir);
  }
  return path.join(os.homedir(), dataDirNameForChannel(channel));
}

/**
 * The port this process listens on.
 *
 * An explicit `PORT` wins, so an operator who already pins one keeps it. With
 * nothing set the channel supplies the default, which is what lets a stable
 * Core and a development Core be up at the same time.
 */
export function resolvePort(channel: AsterimChannel = getAsterimChannel()): number {
  const explicit = process.env.PORT ? parseInt(process.env.PORT, 10) : NaN;
  return Number.isFinite(explicit) ? explicit : defaultPortForChannel(channel);
}

/** Cached so the upward walk for `package.json` happens at most once. */
let cachedVersion: string | null = null;

/**
 * The Core's version.
 *
 * `apps/server/package.json` sits one directory above `dist/` in a packaged
 * build and three above `src/utils/` under `tsx watch`, so the file is looked
 * for by walking up rather than by a fixed relative path. A build that somehow
 * ships without it still starts — the channel endpoint is not worth a crash.
 */
export function resolveServerVersion(): string {
  if (cachedVersion !== null) return cachedVersion;

  let dir = __dirname;
  for (let depth = 0; depth < 6; depth++) {
    try {
      const candidate = path.join(dir, 'package.json');
      if (fs.existsSync(candidate)) {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version?: string };
        if (typeof parsed.version === 'string' && parsed.version.length > 0) {
          cachedVersion = parsed.version;
          return cachedVersion;
        }
      }
    } catch {
      /* An unreadable or malformed manifest just means keep walking. */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  cachedVersion = '0.0.0';
  return cachedVersion;
}

/** Everything a caller — a log line or the dashboard — needs about this run. */
export function describeChannel(): ChannelInfo {
  const channel = getAsterimChannel();
  return {
    channel,
    dataDir: resolveDataDir(channel),
    port: resolvePort(channel),
    isDev: channel === 'dev',
    version: resolveServerVersion()
  };
}
