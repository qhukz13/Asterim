import type { AsterimChannel } from '../types/channels';

/**
 * The fixed side of DEC-029: the two channels, the directory each one owns, and
 * the port each one defaults to.
 *
 * These are the only values that decide whether two Asterim processes can
 * collide, so they live in one place rather than being repeated at each site
 * that joins a path or reads `PORT`.
 */

/** Every channel that exists, in the order a UI would list them. */
export const ASTERIM_CHANNELS: readonly AsterimChannel[] = ['stable', 'dev'];

/** The environment variable that names the channel explicitly. */
export const ASTERIM_CHANNEL_ENV = 'ASTERIM_CHANNEL';

/** Stable listens here unless `PORT` says otherwise. */
export const DEFAULT_STABLE_PORT = 3000;

/** Development is offset by one, so both channels can run at once. */
export const DEFAULT_DEV_PORT = 3001;

/** `~/.asterim` — the operator's real data. */
export const DATA_DIR_STABLE_NAME = '.asterim';

/** `~/.asterim-dev` — everything a development run is allowed to touch. */
export const DATA_DIR_DEV_NAME = '.asterim-dev';

/** What the dashboard shows when it is talking to a development Core. */
export const DEV_CHANNEL_BADGE_LABEL = 'DEV-CHANNEL';

/** The home-relative directory name a channel owns. */
export function dataDirNameForChannel(channel: AsterimChannel): string {
  return channel === 'dev' ? DATA_DIR_DEV_NAME : DATA_DIR_STABLE_NAME;
}

/** The port a channel listens on when `PORT` is not set. */
export function defaultPortForChannel(channel: AsterimChannel): number {
  return channel === 'dev' ? DEFAULT_DEV_PORT : DEFAULT_STABLE_PORT;
}

/**
 * Reads a channel name as a human would have written it.
 *
 * `development` is accepted alongside `dev` because that is the spelling
 * `NODE_ENV` uses, and an operator who exports one is not saying something
 * different from an operator who exports the other. Anything unrecognised
 * returns `null` rather than guessing — the caller then falls back to the
 * `NODE_ENV` rule instead of silently running a typo against `~/.asterim`.
 */
export function parseAsterimChannel(value: string | undefined | null): AsterimChannel | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'stable' || normalized === 'production' || normalized === 'prod') {
    return 'stable';
  }
  if (normalized === 'dev' || normalized === 'development') return 'dev';
  return null;
}
