/**
 * Release channels (DEC-029).
 *
 * Asterim is written by people who also run it all day. A development build
 * started from this repository must not open the same SQLite file, bind the
 * same port, or overwrite the same loopback descriptor as the copy the operator
 * depends on — so the channel a process belongs to is part of its identity, not
 * a build flag, and it is what decides where every runtime file lives.
 *
 * Declared here because the dashboard renders the answer: a second declaration
 * in the server would be the same contract in two places.
 */

/** Which release channel a Core process belongs to. */
export type AsterimChannel = 'stable' | 'dev';

/** What a Core reports about the channel it is running on. */
export interface ChannelInfo {
  /** The resolved channel. */
  channel: AsterimChannel;
  /** The directory holding `asterim.db`, `server.json` and the logs. */
  dataDir: string;
  /** The port this Core listens on. */
  port: number;
  /** `channel === 'dev'`, so a view does not have to compare strings. */
  isDev: boolean;
  /** The Core's package version. */
  version: string;
}
