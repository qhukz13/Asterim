import crypto from 'crypto';
import type { DatabaseSync } from 'node:sqlite';
import { dbService } from '../DatabaseService';
import { SecretVaultService, secretVault } from './SecretVaultService';

/**
 * Workspace & environment secrets (P9-02).
 *
 * `environment_secrets` holds the credentials an environment lends to the agents
 * running inside it — a deploy token, a third-party API key, a database URL.
 * They were stored as cleartext (`reports/current.md` § 8.1) and never read by
 * anything, so nothing was leaking yet; this makes them usable and encrypted in
 * the same step rather than shipping a plaintext store and hardening it later.
 *
 * Three properties, in the order they matter:
 *
 * 1. **At rest** every value is an AES-256-GCM envelope produced by
 *    `SecretVaultService` — the same cipher, key and machine binding as the
 *    machine-level credentials in `settings`, so `asterim.db` carries no
 *    readable credential of either kind.
 * 2. **In transit** no read path returns a value. Listing a workspace's secrets
 *    returns key names, a fixed mask and a timestamp; the plaintext leaves this
 *    service only through `getSecretValue` and `resolveEnvironmentVariables`,
 *    which exist to hand it to a child process, not to a client.
 * 3. **In output** every plaintext this service decrypts is registered with the
 *    vault's redactor first, so a secret an agent echoes back is stripped from
 *    the log file and from the EventBus before any subscriber sees it.
 *
 * The environment binding is a real foreign key: a secret cannot outlive its
 * environment, and deleting one takes its credentials with it.
 */

/** What a secret looks like to anything that is not the process that uses it. */
export const SECRET_MASK = '••••••••';

/** Namespace for this service's entries in the vault's redaction index. */
export const ENV_SECRET_REDACTION_PREFIX = 'env-secret';

/**
 * True when a submitted value is a mask rather than a credential — the exact
 * placeholder, or any string made only of the characters a masked field is drawn
 * with. No real credential looks like that, and a client that round-trips what it
 * was shown must not overwrite the stored secret with it.
 */
export function isMasked(value: string): boolean {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) return false;
  return trimmed === SECRET_MASK || /^[•*·●]+$/u.test(trimmed);
}

/**
 * These values are injected into an agent's environment, so the key has to be a
 * usable variable name — a POSIX name, capped at a length no shell will truncate.
 */
const SECRET_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/**
 * Names that would let a stored credential change what the agent process *is*
 * rather than what it can reach. `PATH` decides which binary runs; the loader
 * variables and `NODE_OPTIONS` inject code into it before its first instruction.
 * A workspace secret is a credential, so nothing is lost by refusing these, and
 * accepting them would turn write access to a workspace's secrets into code
 * execution inside every agent it starts.
 */
const PROTECTED_ENV_NAMES = new Set([
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
]);

export type EnvironmentSecretErrorCode =
  | 'INVALID_SECRET_KEY_ERROR'
  | 'PROTECTED_SECRET_KEY_ERROR'
  | 'ENVIRONMENT_NOT_FOUND_ERROR'
  | 'SECRET_STORAGE_ERROR';

/** A failure callers can branch on — the routes map each code to a status. */
export class EnvironmentSecretError extends Error {
  public readonly code: EnvironmentSecretErrorCode;

  constructor(code: EnvironmentSecretErrorCode, message: string) {
    super(message);
    this.name = 'EnvironmentSecretError';
    this.code = code;
  }
}

/** The masked shape a client is allowed to see. Carries no value. */
export interface EnvironmentSecretSummary {
  key: string;
  maskedValue: string;
  isSet: boolean;
  createdAt: number;
}

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

export interface EnvironmentSecretServiceOptions {
  /** The vault that owns the cipher and the redaction index. */
  vault?: SecretVaultService;
  /** Database accessor. Called lazily, so constructing this opens nothing. */
  getDb?: () => DatabaseSync;
}

interface SecretRow {
  id: string;
  secret_key: string;
  secret_value: string;
  created_at: number;
}

export class EnvironmentSecretService {
  private readonly vault: SecretVaultService;
  private readonly dbAccessor: () => DatabaseSync;

  constructor(options: EnvironmentSecretServiceOptions = {}) {
    this.vault = options.vault ?? secretVault;
    this.dbAccessor = options.getDb ?? (() => dbService.getDb());
  }

  private db(): DatabaseSync {
    try {
      return this.dbAccessor();
    } catch (err) {
      throw new EnvironmentSecretError(
        'SECRET_STORAGE_ERROR',
        `Environment secret storage is unavailable: ${(err as Error).message}`
      );
    }
  }

  private redactionSource(environmentId: string, key: string): string {
    return `${ENV_SECRET_REDACTION_PREFIX}:${environmentId}:${key}`;
  }

  // --- Validation ----------------------------------------------------------

  /** Normalizes and checks a key, or explains why it cannot be stored. */
  private validateKey(key: string): string {
    const trimmed = typeof key === 'string' ? key.trim() : '';
    if (!SECRET_KEY_PATTERN.test(trimmed)) {
      throw new EnvironmentSecretError(
        'INVALID_SECRET_KEY_ERROR',
        'A secret key must be a valid environment variable name: a letter or underscore followed by letters, digits or underscores.'
      );
    }
    if (PROTECTED_ENV_NAMES.has(trimmed.toUpperCase())) {
      throw new EnvironmentSecretError(
        'PROTECTED_SECRET_KEY_ERROR',
        `'${trimmed}' controls how the agent process itself is launched and cannot be stored as a secret.`
      );
    }
    return trimmed;
  }

  /**
   * Makes the foreign key hold.
   *
   * `WorkspaceService` writes every workspace to both `workspaces` and the
   * mirrored `environments` table, but the second insert is best-effort
   * (`WorkspaceService.ts` — "the mirrored environments row is optional"), so a
   * database can hold a perfectly valid workspace with no environment row and a
   * secret written against it would fail the constraint. The mirror is filled in
   * from the workspace it was supposed to come from.
   */
  private ensureEnvironmentRow(environmentId: string): void {
    const db = this.db();
    let exists: { id: string } | undefined;
    try {
      exists = db.prepare('SELECT id FROM environments WHERE id = ?').get(environmentId) as
        | { id: string }
        | undefined;
    } catch {
      // A database without the environments table cannot hold secrets at all;
      // the insert below reports that as storage failure.
    }
    if (exists) return;

    let mirrored = false;
    try {
      const result = db
        .prepare(
          `INSERT OR IGNORE INTO environments
             (id, account_id, name, slug, preset, execution_profile_id, is_personal, created_at, updated_at)
           SELECT id, account_id, name, slug, preset, execution_profile_id, is_personal, created_at, updated_at
             FROM workspaces WHERE id = ?`
        )
        .run(environmentId);
      mirrored = Number(result.changes) > 0;
    } catch (err) {
      console.error(
        `[EnvironmentSecrets] Could not mirror workspace ${environmentId} into environments: ${(err as Error).message}`
      );
    }

    if (!mirrored) {
      throw new EnvironmentSecretError(
        'ENVIRONMENT_NOT_FOUND_ERROR',
        `Environment ${environmentId} does not exist.`
      );
    }
  }

  /** True when the id names an environment or the workspace mirroring one. */
  public environmentExists(environmentId: string): boolean {
    const db = this.db();
    for (const table of ['environments', 'workspaces']) {
      try {
        const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(environmentId);
        if (row) return true;
      } catch {
        // Older databases predate one table or the other; try the next.
      }
    }
    return false;
  }

  // --- Reads ---------------------------------------------------------------

  /**
   * The list a client may have: which secrets exist, and since when. No value is
   * decrypted here — not as an optimization, but because nothing on this path
   * has any use for one, and code that never holds a plaintext cannot leak it.
   */
  public getSecrets(environmentId: string): EnvironmentSecretSummary[] {
    let rows: SecretRow[];
    try {
      rows = this.db()
        .prepare(
          'SELECT id, secret_key, secret_value, created_at FROM environment_secrets WHERE environment_id = ? ORDER BY secret_key'
        )
        .all(environmentId) as unknown as SecretRow[];
    } catch (err) {
      console.error(
        `[EnvironmentSecrets] Could not list secrets for ${environmentId}: ${(err as Error).message}`
      );
      return [];
    }

    return rows.map(row => ({
      key: row.secret_key,
      maskedValue: SECRET_MASK,
      isSet: true,
      createdAt: row.created_at
    }));
  }

  /**
   * Decrypts one secret and registers it for redaction.
   *
   * A row still in legacy cleartext is returned and upgraded to an envelope in
   * the same call, so a database written before this existed encrypts itself as
   * it is used rather than on a migration someone has to remember to run.
   *
   * Returns null when the secret is absent or the envelope cannot be opened on
   * this machine — a credential that will not decrypt is a credential the agent
   * does not get, which is the outcome that fails safely.
   */
  public getSecretValue(environmentId: string, key: string): string | null {
    let row: SecretRow | undefined;
    try {
      row = this.db()
        .prepare(
          'SELECT id, secret_key, secret_value, created_at FROM environment_secrets WHERE environment_id = ? AND secret_key = ?'
        )
        .get(environmentId, key) as SecretRow | undefined;
    } catch (err) {
      console.error(
        `[EnvironmentSecrets] Could not read '${key}' for ${environmentId}: ${(err as Error).message}`
      );
      return null;
    }
    if (!row || row.secret_value === null || row.secret_value === undefined) return null;

    return this.openRow(environmentId, row);
  }

  /**
   * Decrypts a row, registers the plaintext for redaction, and upgrades the row
   * if it was still cleartext. Shared by the single read and the bulk resolve so
   * both migrate on exactly the same terms.
   */
  private openRow(environmentId: string, row: SecretRow): string | null {
    const source = this.redactionSource(environmentId, row.secret_key);

    if (!this.vault.isEnvelope(row.secret_value)) {
      const plaintext = row.secret_value;
      this.vault.registerRedactedValue(source, plaintext);
      try {
        this.writeEnvelope(row.id, this.vault.encrypt(plaintext));
        console.log(
          `[EnvironmentSecrets] Encrypted legacy plaintext secret '${row.secret_key}' at rest.`
        );
      } catch (err) {
        console.error(
          `[EnvironmentSecrets] Could not encrypt legacy secret '${row.secret_key}': ${(err as Error).message}`
        );
      }
      return plaintext;
    }

    try {
      const plaintext = this.vault.decrypt(row.secret_value);
      this.vault.registerRedactedValue(source, plaintext);
      return plaintext;
    } catch (err) {
      console.error(
        `[EnvironmentSecrets] Secret '${row.secret_key}' in environment ${environmentId} could not be decrypted on this machine (${
          (err as { code?: string }).code ?? 'UNKNOWN'
        }). It will be treated as absent.`
      );
      return null;
    }
  }

  // --- Writes --------------------------------------------------------------

  /**
   * Encrypts and stores one secret. Rewriting an existing key replaces the value
   * and keeps `created_at`, so the row's history is when the secret was first
   * introduced rather than when it was last rotated.
   */
  public setSecret(environmentId: string, key: string, value: string): void {
    const secretKey = this.validateKey(key);
    if (typeof value !== 'string') {
      throw new EnvironmentSecretError('INVALID_SECRET_KEY_ERROR', 'A secret value must be a string.');
    }

    this.ensureEnvironmentRow(environmentId);

    const envelope = this.vault.encrypt(value);
    try {
      this.db()
        .prepare(
          `INSERT INTO environment_secrets (id, environment_id, secret_key, secret_value, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(environment_id, secret_key)
             DO UPDATE SET secret_value = excluded.secret_value`
        )
        .run(`esec_${crypto.randomUUID()}`, environmentId, secretKey, envelope, Date.now());
    } catch (err) {
      throw new EnvironmentSecretError(
        'SECRET_STORAGE_ERROR',
        `Could not store secret '${secretKey}': ${(err as Error).message}`
      );
    }

    // After the write, so a value that never landed is never redacted — a
    // placeholder in the logs where a failed write happened would send whoever
    // reads them looking for a secret that does not exist.
    this.vault.registerRedactedValue(this.redactionSource(environmentId, secretKey), value);
  }

  /** Removes one secret and stops redacting the value it held. */
  public deleteSecret(environmentId: string, key: string): boolean {
    let deleted: boolean;
    try {
      const result = this.db()
        .prepare('DELETE FROM environment_secrets WHERE environment_id = ? AND secret_key = ?')
        .run(environmentId, key);
      deleted = Number(result.changes) > 0;
    } catch (err) {
      throw new EnvironmentSecretError(
        'SECRET_STORAGE_ERROR',
        `Could not delete secret '${key}': ${(err as Error).message}`
      );
    }

    if (deleted) this.vault.unregisterRedactedValue(this.redactionSource(environmentId, key));
    return deleted;
  }

  /**
   * Drops every secret an environment owns. Called when the environment itself
   * is deleted: the foreign key would cascade the rows away on its own, but the
   * redaction index lives in this process and has to be told.
   */
  public deleteEnvironmentSecrets(environmentId: string): number {
    const keys = this.getSecrets(environmentId).map(secret => secret.key);
    let removed: number;
    try {
      const result = this.db()
        .prepare('DELETE FROM environment_secrets WHERE environment_id = ?')
        .run(environmentId);
      removed = Number(result.changes);
    } catch (err) {
      console.error(
        `[EnvironmentSecrets] Could not delete secrets for ${environmentId}: ${(err as Error).message}`
      );
      return 0;
    }
    for (const key of keys) {
      this.vault.unregisterRedactedValue(this.redactionSource(environmentId, key));
    }
    return removed;
  }

  private writeEnvelope(rowId: string, envelope: string): void {
    this.db().prepare('UPDATE environment_secrets SET secret_value = ? WHERE id = ?').run(envelope, rowId);
  }

  // --- Agent injection -----------------------------------------------------

  /**
   * The decrypted environment for an agent process.
   *
   * This is the only bulk plaintext path, and it exists for one caller:
   * `AgentService`, handing a child process the credentials its environment was
   * configured with. Every value returned has been registered with the vault's
   * redactor by the time this returns, so the agent echoing one back reaches the
   * log file and the EventBus already stripped.
   *
   * A secret that cannot be decrypted is omitted rather than raised: one
   * unreadable credential must not stop a session from starting, and an agent
   * that gets a variable it can use is better than one that gets a broken value.
   */
  public resolveEnvironmentVariables(environmentId: string): Record<string, string> {
    if (!environmentId) return {};

    let rows: SecretRow[];
    try {
      rows = this.db()
        .prepare(
          'SELECT id, secret_key, secret_value, created_at FROM environment_secrets WHERE environment_id = ? ORDER BY secret_key'
        )
        .all(environmentId) as unknown as SecretRow[];
    } catch (err) {
      console.error(
        `[EnvironmentSecrets] Could not resolve variables for ${environmentId}: ${(err as Error).message}`
      );
      return {};
    }

    const resolved: Record<string, string> = {};
    for (const row of rows) {
      // Re-checked on the way out, not only on the way in: a row could have been
      // written by an older build, or by hand.
      if (!SECRET_KEY_PATTERN.test(row.secret_key) || PROTECTED_ENV_NAMES.has(row.secret_key.toUpperCase())) {
        console.warn(
          `[EnvironmentSecrets] Skipping '${row.secret_key}' in environment ${environmentId}: not an injectable variable name.`
        );
        continue;
      }
      const plaintext = this.openRow(environmentId, row);
      if (plaintext === null) continue;
      resolved[row.secret_key] = plaintext;
    }
    return resolved;
  }

  // --- Migration & status --------------------------------------------------

  /**
   * Encrypts every row still in cleartext, across every environment. Runs once
   * at startup so a database carried over from an earlier version is not left
   * holding readable credentials until something happens to ask for them.
   *
   * Values are not registered for redaction here: this walks the whole table,
   * and a startup sweep that loaded every workspace credential into a
   * process-lifetime index would make the redactor scan output against secrets
   * no running session is using.
   */
  public migrateLegacyPlaintext(): { migrated: number; failed: number } {
    let rows: Array<{ id: string; secret_value: string }>;
    try {
      rows = this.db()
        .prepare('SELECT id, secret_value FROM environment_secrets')
        .all() as Array<{ id: string; secret_value: string }>;
    } catch (err) {
      console.error(`[EnvironmentSecrets] Migration could not read the table: ${(err as Error).message}`);
      return { migrated: 0, failed: 0 };
    }

    let migrated = 0;
    let failed = 0;
    for (const row of rows) {
      if (this.vault.isEnvelope(row.secret_value)) continue;
      try {
        this.writeEnvelope(row.id, this.vault.encrypt(row.secret_value));
        migrated++;
      } catch (err) {
        console.error(
          `[EnvironmentSecrets] Migration could not encrypt row ${row.id}: ${(err as Error).message}`
        );
        failed++;
      }
    }

    if (migrated > 0) {
      console.log(`[EnvironmentSecrets] Encrypted ${migrated} legacy plaintext environment secret(s) at rest.`);
    }
    return { migrated, failed };
  }

  /**
   * Counts per state, for the vault status endpoint. Classifying an envelope as
   * readable means opening it, so this decrypts — and deliberately keeps nothing:
   * no plaintext is returned, registered or logged.
   */
  public getStatus(): EnvironmentSecretStatus {
    let rows: Array<{ environment_id: string; secret_value: string }>;
    try {
      rows = this.db()
        .prepare('SELECT environment_id, secret_value FROM environment_secrets')
        .all() as Array<{ environment_id: string; secret_value: string }>;
    } catch (err) {
      console.error(`[EnvironmentSecrets] Could not read status: ${(err as Error).message}`);
      return { total: 0, encrypted: 0, plaintext: 0, unreadable: 0, environments: 0, migrationComplete: true };
    }

    const environments = new Set<string>();
    let encrypted = 0;
    let plaintext = 0;
    let unreadable = 0;

    for (const row of rows) {
      environments.add(row.environment_id);
      if (!this.vault.isEnvelope(row.secret_value)) {
        plaintext++;
        continue;
      }
      try {
        this.vault.decrypt(row.secret_value);
        encrypted++;
      } catch {
        unreadable++;
      }
    }

    return {
      total: rows.length,
      encrypted,
      plaintext,
      unreadable,
      environments: environments.size,
      migrationComplete: plaintext === 0
    };
  }
}

/** The process-wide instance, sharing the singleton vault's key and redactor. */
export const environmentSecretService = new EnvironmentSecretService();
