/**
 * The credential-management contract (P9-01 / P9-02 / P9-03).
 *
 * The vault and the environment-secret store live entirely in the Core, and
 * everything they expose is deliberately shaped so that it cannot carry a
 * credential: a listing is key names plus a fixed mask, and a status is counts
 * plus algorithm names. That shape is what the dashboard renders, so it belongs
 * here rather than being restated in `apps/web` — a mask the client drew
 * differently, or a status field the client thought was optional, would be a
 * silent disagreement about what is safe to display.
 *
 * The key rules travel with it. The dashboard validates a secret key before
 * sending it purely so the operator gets an answer without a round trip; the
 * Core validates it again on arrival, against the same constants, and its
 * verdict is the one that counts.
 */

/** What a secret looks like to anything that is not the process that uses it. */
export const SECRET_MASK = '••••••••';

/**
 * These values are injected into an agent's environment, so a key has to be a
 * usable variable name — a POSIX name, capped at a length no shell will
 * truncate.
 */
export const SECRET_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/**
 * Names that would let a stored credential change what the agent process *is*
 * rather than what it can reach. `PATH` decides which binary runs; the loader
 * variables and `NODE_OPTIONS` inject code into it before its first
 * instruction. A workspace secret is a credential, so nothing is lost by
 * refusing these, and accepting them would turn write access to a workspace's
 * secrets into code execution inside every agent it starts.
 */
export const PROTECTED_SECRET_KEYS = [
  'PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS',
  'BASH_ENV',
  'ENV',
  'IFS',
  'SHELL'
] as const;

/** True when a key names something the loader or the shell reads. */
export function isProtectedSecretKey(key: string): boolean {
  const upper = (key || '').trim().toUpperCase();
  return (PROTECTED_SECRET_KEYS as readonly string[]).includes(upper);
}

/** True when a key is a POSIX variable name of an acceptable length. */
export function isValidSecretKeyFormat(key: string): boolean {
  return SECRET_KEY_PATTERN.test((key || '').trim());
}

/** The masked shape a client is allowed to see. Carries no value. */
export interface EnvironmentSecretSummary {
  key: string;
  maskedValue: string;
  isSet: boolean;
  createdAt: number;
}

/** Counts per state across `environment_secrets`. Carries no value. */
export interface EnvironmentSecretStatus {
  /** Rows in `environment_secrets`, whatever state they are in. */
  total: number;
  encrypted: number;
  plaintext: number;
  /** Envelopes this machine's vault key cannot open. */
  unreadable: number;
  environments: number;
  migrationComplete: boolean;
}

/** A failure callers can branch on — the routes map each code to a status. */
export type EnvironmentSecretErrorCode =
  | 'INVALID_SECRET_KEY_ERROR'
  | 'PROTECTED_SECRET_KEY_ERROR'
  | 'ENVIRONMENT_NOT_FOUND_ERROR'
  | 'SECRET_STORAGE_ERROR';

/**
 * What the vault can say about itself without saying anything about what is in
 * it: the algorithm, whether the salt is there, and a count per state of the
 * `settings` rows it manages.
 */
export interface VaultStatus {
  ready: boolean;
  algorithm: 'AES-256-GCM';
  keyDerivation: string;
  iterations: number;
  ivBytes: number;
  authTagBytes: number;
  envelopeVersion: string;
  saltPresent: boolean;
  managedKeys: string[];
  encryptedKeys: number;
  plaintextKeys: number;
  unreadableKeys: number;
  migrationComplete: boolean;
  redactedValues: number;
}

/** `GET /api/v1/security/vault-status`. */
export interface VaultStatusResponse {
  vault: VaultStatus & { environmentSecrets: EnvironmentSecretStatus };
  /**
   * The vault can derive its key and nothing either store owns is still
   * readable on disk. One flag, because it is the one question an operator or
   * an audit actually asks.
   */
  healthy: boolean;
}

/** `GET /api/v1/environments/:id/secrets`. */
export interface EnvironmentSecretsResponse {
  secrets: EnvironmentSecretSummary[];
  /** The mask the Core used, so a client never has to assume the glyph. */
  mask?: string;
}
