import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import { dbService, resolveDataDir } from '../DatabaseService';
import { registerLogRedactor } from '../../utils/logger';
import { eventBus } from '../EventBus';

/**
 * Local Secret Vault (P9-01).
 *
 * Credentials the Core has to keep — the Gemini API key, the VAPID private key,
 * the JWT and pairing HMAC secrets, a Stripe secret key on a hosted deployment —
 * lived in the `settings` table as plaintext (`blueprint/audit/IMPLEMENTATION_DRIFT.md`
 * § 11). Anything that can read `~/.asterim/asterim.db` could read them: a backup,
 * a synced folder, a support bundle, another process running as the same user.
 *
 * This encrypts them at rest with AES-256-GCM under a key derived from the
 * machine and the account the Core runs as, plus a random salt kept beside the
 * database. The key is never written anywhere — not to the database, which is
 * the whole point, and not to the salt file, which holds only the salt.
 *
 * Two consequences follow from machine-derived keys and are deliberate:
 * copying `asterim.db` to another machine yields secrets that will not decrypt
 * there, and deleting `vault.salt` orphans every stored secret. Both are the
 * behaviour a local-first vault is supposed to have — the alternative is a key
 * that travels with the ciphertext, which is not encryption.
 */

/** Marks a value as encrypted, and pins the format its remainder is in. */
export const VAULT_ENVELOPE_PREFIX = 'vault:v1:';

/** AES-256-GCM's nonce. 12 bytes is the size the mode is defined for. */
const IV_BYTES = 12;
/** The GCM authentication tag. Full length; a truncated tag is a weaker tag. */
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha512';
const SALT_BYTES = 32;
const SALT_FILENAME = 'vault.salt';

/** The placeholder a redacted secret leaves behind. */
export const REDACTION_PLACEHOLDER = '[REDACTED_SECRET]';

/**
 * Values shorter than this are not registered for redaction. A secret that is
 * eight characters or fewer is likely to collide with ordinary log text, and
 * redacting half a terminal stream is worse than not redacting a weak key.
 */
const MIN_REDACTABLE_LENGTH = 8;

/**
 * The `settings` rows this service owns. Everything else in that table —
 * `first_run_completed`, `ai_provider`, `ai_model` — is configuration, stays
 * readable, and is deliberately not encrypted.
 */
export const SECRET_SETTING_KEYS = [
  'ai_api_key',
  'vapid_keys',
  'stripe_secret_key',
  'jwt_secret',
  'hmac_secret'
] as const;

export type SecretSettingKey = (typeof SECRET_SETTING_KEYS)[number];

export type SecretVaultErrorCode =
  | 'TAMPERED_SECRET_ERROR'
  | 'INVALID_ENVELOPE_ERROR'
  | 'VAULT_UNAVAILABLE_ERROR';

/** A vault failure that callers can branch on without matching message text. */
export class SecretVaultError extends Error {
  public readonly code: SecretVaultErrorCode;

  constructor(code: SecretVaultErrorCode, message: string) {
    super(message);
    this.name = 'SecretVaultError';
    this.code = code;
  }
}

export interface SecretVaultServiceOptions {
  /** Where `vault.salt` lives. Defaults to the Asterim data directory. */
  dataDir?: string;
  /** Database accessor. Called lazily, so constructing a vault opens nothing. */
  getDb?: () => DatabaseSync;
  /** PBKDF2 rounds. Lowered by tests that derive many keys; never in production. */
  iterations?: number;
  /**
   * Overrides the machine identity that feeds key derivation. Tests use it to
   * prove that a key derived elsewhere cannot read this vault.
   */
  machineIdentity?: string;
  /** Which `settings` rows this instance manages. */
  secretKeys?: readonly string[];
  /** Registers this instance as the redactor for the log streams and EventBus. */
  installRedaction?: boolean;
}

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

interface SettingRow {
  value: string;
}

/**
 * The identity the vault key is bound to.
 *
 * Windows has no `uid` and the user SID is not reachable from Node without a
 * native module, so the account is identified by its username and home
 * directory there — the same pair that decides which `~/.asterim` this is.
 */
function defaultMachineIdentity(): string {
  let username = 'unknown';
  let uid = -1;
  try {
    const info = os.userInfo();
    username = info.username || 'unknown';
    uid = typeof info.uid === 'number' ? info.uid : -1;
  } catch {
    /* userInfo throws when the account has no passwd entry; the rest still binds. */
  }
  return ['asterim-vault-v1', process.platform, os.arch(), os.hostname(), username, String(uid), os.homedir()].join(
    '|'
  );
}

export class SecretVaultService {
  private readonly dataDirOverride?: string;
  private readonly dbAccessor: () => DatabaseSync;
  private readonly iterations: number;
  private readonly machineIdentity: string;
  private readonly secretKeys: readonly string[];

  /** Derived once and held in memory only. */
  private derivedKey: Buffer | null = null;
  private saltPath: string | null = null;

  /**
   * Plaintext secret values seen this process, longest first, and the setting
   * key each came from so a rotated secret stops being redacted.
   */
  private readonly redactionSources = new Map<string, string[]>();
  private redactionIndex: string[] = [];

  constructor(options: SecretVaultServiceOptions = {}) {
    this.dataDirOverride = options.dataDir;
    this.dbAccessor = options.getDb ?? (() => dbService.getDb());
    this.iterations = options.iterations ?? PBKDF2_ITERATIONS;
    this.machineIdentity = options.machineIdentity ?? defaultMachineIdentity();
    this.secretKeys = options.secretKeys ?? SECRET_SETTING_KEYS;

    if (options.installRedaction) {
      // Inverted on purpose: the log stream and the EventBus know nothing about
      // this service, so neither of them can pull the database open at import
      // time just by being imported.
      registerLogRedactor(text => this.redactSecrets(text));
      eventBus.setRedactor(payload => this.redactPayload(payload));
    }
  }

  // --- Key material --------------------------------------------------------

  private dataDir(): string {
    return this.dataDirOverride ?? resolveDataDir();
  }

  /**
   * The per-installation salt. Created on first use with owner-only permissions;
   * losing it makes every stored secret unreadable, which is why it is written
   * once and never rewritten.
   */
  private loadSalt(): Buffer {
    const dir = this.dataDir();
    const file = path.join(dir, SALT_FILENAME);
    this.saltPath = file;

    if (fs.existsSync(file)) {
      const stored = fs.readFileSync(file, 'utf8').trim();
      const salt = Buffer.from(stored, 'hex');
      if (salt.length === SALT_BYTES) return salt;
      console.warn(`[SecretVault] ${SALT_FILENAME} is malformed; regenerating it. Existing secrets will not decrypt.`);
    }

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const salt = crypto.randomBytes(SALT_BYTES);
    fs.writeFileSync(file, salt.toString('hex'), { mode: 0o600 });
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(file, 0o600);
      } catch {
        /* a filesystem that cannot express the mode must not stop the Core. */
      }
    }
    return salt;
  }

  /** PBKDF2-HMAC-SHA512 over the machine identity. Derived once per process. */
  private key(): Buffer {
    if (!this.derivedKey) {
      this.derivedKey = crypto.pbkdf2Sync(
        this.machineIdentity,
        this.loadSalt(),
        this.iterations,
        KEY_BYTES,
        PBKDF2_DIGEST
      );
    }
    return this.derivedKey;
  }

  // --- Primitives ----------------------------------------------------------

  /** True when a stored value is already in vault format. */
  public isEnvelope(value: string): boolean {
    return typeof value === 'string' && value.startsWith(VAULT_ENVELOPE_PREFIX);
  }

  /**
   * `vault:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>`, with a fresh random IV every
   * call — reusing a nonce under one key is the way GCM fails catastrophically.
   */
  public encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VAULT_ENVELOPE_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  /**
   * Reverses `encrypt`. The authentication tag is verified before any plaintext
   * is returned: `decipher.final()` throws unless the tag matches, and OpenSSL
   * compares it in constant time, so a modified ciphertext, a forged tag or a
   * value encrypted under another machine's key all fail the same way and in
   * the same amount of time.
   */
  public decrypt(envelope: string): string {
    if (!this.isEnvelope(envelope)) {
      throw new SecretVaultError('INVALID_ENVELOPE_ERROR', 'Value is not a vault envelope.');
    }

    const parts = envelope.split(':');
    // 'vault', 'v1', iv, tag, ciphertext — ciphertext is empty for an empty secret.
    if (parts.length !== 5) {
      throw new SecretVaultError('INVALID_ENVELOPE_ERROR', 'Vault envelope is malformed.');
    }

    const [, , ivHex, tagHex, ciphertextHex] = parts;
    if (!/^[0-9a-f]*$/i.test(ivHex + tagHex + ciphertextHex)) {
      throw new SecretVaultError('INVALID_ENVELOPE_ERROR', 'Vault envelope is not hex-encoded.');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    if (iv.length !== IV_BYTES) {
      throw new SecretVaultError('INVALID_ENVELOPE_ERROR', `Vault IV must be ${IV_BYTES} bytes.`);
    }
    if (tag.length !== TAG_BYTES) {
      throw new SecretVaultError('INVALID_ENVELOPE_ERROR', `Vault authentication tag must be ${TAG_BYTES} bytes.`);
    }

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(), iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextHex, 'hex')),
        decipher.final()
      ]);
      return plaintext.toString('utf8');
    } catch (err) {
      throw new SecretVaultError(
        'TAMPERED_SECRET_ERROR',
        `Vault secret failed authentication and was rejected: ${(err as Error).message}`
      );
    }
  }

  // --- Stored secrets ------------------------------------------------------

  private db(): DatabaseSync {
    try {
      return this.dbAccessor();
    } catch (err) {
      throw new SecretVaultError('VAULT_UNAVAILABLE_ERROR', `Vault storage is unavailable: ${(err as Error).message}`);
    }
  }

  /** Encrypts and persists. The row is replaced, never appended to. */
  public setSecret(key: string, plaintext: string): void {
    const envelope = this.encrypt(plaintext);
    this.db().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, envelope);
    this.registerForRedaction(key, plaintext);
  }

  /**
   * Reads and decrypts. A row still in legacy plaintext is returned as-is and
   * upgraded to an envelope in the same call, so a workstation that has been
   * running since before this existed encrypts itself the first time each
   * secret is used rather than on a migration the user has to run.
   *
   * Returns null when the row is absent or cannot be decrypted. Callers that
   * generate their own secret — TokenService, PairingService, PushService —
   * then mint a fresh one, which costs a re-login on a machine whose vault key
   * no longer matches and is the only outcome that still boots.
   */
  public getSecret(key: string): string | null {
    let row: SettingRow | undefined;
    try {
      row = this.db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as SettingRow | undefined;
    } catch (err) {
      console.error(`[SecretVault] Could not read '${key}': ${(err as Error).message}`);
      return null;
    }
    if (!row || row.value === undefined || row.value === null) return null;

    if (!this.isEnvelope(row.value)) {
      // Legacy plaintext. Return it, then upgrade the row.
      const plaintext = row.value;
      this.registerForRedaction(key, plaintext);
      try {
        this.setSecret(key, plaintext);
        console.log(`[SecretVault] Encrypted legacy plaintext secret '${key}' at rest.`);
      } catch (err) {
        console.error(`[SecretVault] Could not encrypt legacy secret '${key}': ${(err as Error).message}`);
      }
      return plaintext;
    }

    try {
      const plaintext = this.decrypt(row.value);
      this.registerForRedaction(key, plaintext);
      return plaintext;
    } catch (err) {
      console.error(
        `[SecretVault] Stored secret '${key}' could not be decrypted on this machine (${
          (err as SecretVaultError).code ?? 'UNKNOWN'
        }). It will be treated as absent.`
      );
      return null;
    }
  }

  /** Removes the row and stops redacting the value it held. */
  public deleteSecret(key: string): void {
    try {
      this.db().prepare('DELETE FROM settings WHERE key = ?').run(key);
    } catch (err) {
      console.error(`[SecretVault] Could not delete '${key}': ${(err as Error).message}`);
    }
    this.unregisterFromRedaction(key);
  }

  /**
   * Decrypts a value that may or may not be an envelope.
   *
   * For call sites that read `settings` in bulk — `AiService` loading every
   * `ai_*` row, the settings route — where a non-secret and a secret arrive in
   * the same result set. A value that will not decrypt is returned untouched
   * rather than throwing, because one unreadable row must not take out the
   * whole configuration read.
   */
  public decryptIfEnvelope(value: string, keyForRedaction?: string): string {
    if (!this.isEnvelope(value)) return value;
    try {
      const plaintext = this.decrypt(value);
      if (keyForRedaction) this.registerForRedaction(keyForRedaction, plaintext);
      return plaintext;
    } catch (err) {
      console.error(`[SecretVault] Could not decrypt a stored value: ${(err as SecretVaultError).code ?? 'UNKNOWN'}`);
      return value;
    }
  }

  /**
   * Encrypts every managed row still in plaintext. Called once at startup so a
   * database carried over from an earlier version is not left holding readable
   * credentials until something happens to ask for them.
   */
  public migrateLegacyPlaintext(): { migrated: string[]; alreadyEncrypted: string[]; failed: string[] } {
    const migrated: string[] = [];
    const alreadyEncrypted: string[] = [];
    const failed: string[] = [];

    for (const key of this.secretKeys) {
      let row: SettingRow | undefined;
      try {
        row = this.db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as SettingRow | undefined;
      } catch (err) {
        console.error(`[SecretVault] Migration could not read '${key}': ${(err as Error).message}`);
        failed.push(key);
        continue;
      }
      if (!row) continue;

      if (this.isEnvelope(row.value)) {
        alreadyEncrypted.push(key);
        continue;
      }

      try {
        this.setSecret(key, row.value);
        migrated.push(key);
      } catch (err) {
        console.error(`[SecretVault] Migration could not encrypt '${key}': ${(err as Error).message}`);
        failed.push(key);
      }
    }

    if (migrated.length > 0) {
      console.log(`[SecretVault] Encrypted ${migrated.length} legacy plaintext secret(s) at rest: ${migrated.join(', ')}.`);
    }
    return { migrated, alreadyEncrypted, failed };
  }

  // --- Redaction -----------------------------------------------------------

  /**
   * Remembers a plaintext value so it can be stripped from anything on its way
   * to a log file or a WebSocket. A structured secret contributes its leaves as
   * well as the whole blob: the VAPID pair is stored as JSON, and what would
   * actually appear in a stack trace is the private key on its own.
   */
  private registerForRedaction(key: string, plaintext: string): void {
    const values: string[] = [];
    const add = (value: unknown): void => {
      if (typeof value !== 'string') return;
      if (value.length <= MIN_REDACTABLE_LENGTH) return;
      values.push(value);
    };

    add(plaintext);
    if (plaintext.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(plaintext);
        if (parsed && typeof parsed === 'object') {
          for (const [field, value] of Object.entries(parsed as Record<string, unknown>)) {
            // A public key is meant to be published; redacting it would only
            // corrupt the logs that report it.
            if (/^public/i.test(field)) continue;
            add(value);
          }
        }
      } catch {
        /* not JSON after all; the whole value is already registered. */
      }
    }

    if (values.length === 0) {
      this.redactionSources.delete(key);
    } else {
      this.redactionSources.set(key, values);
    }
    this.rebuildRedactionIndex();
  }

  private unregisterFromRedaction(key: string): void {
    if (this.redactionSources.delete(key)) this.rebuildRedactionIndex();
  }

  /** Longest first, so a secret that contains another is replaced whole. */
  private rebuildRedactionIndex(): void {
    const unique = new Set<string>();
    for (const values of this.redactionSources.values()) {
      for (const value of values) unique.add(value);
    }
    this.redactionIndex = [...unique].sort((a, b) => b.length - a.length);
  }

  /** Replaces every known secret value in `text` with the placeholder. */
  public redactSecrets(text: string): string {
    if (this.redactionIndex.length === 0 || !text) return text;
    let out = text;
    for (const secret of this.redactionIndex) {
      if (out.includes(secret)) out = out.split(secret).join(REDACTION_PLACEHOLDER);
    }
    return out;
  }

  /**
   * The same replacement over an event payload. Returns the input unchanged
   * when nothing is registered, so the common case costs one length check on a
   * path that carries every byte of agent output.
   */
  public redactPayload<T>(payload: T): T {
    if (this.redactionIndex.length === 0) return payload;
    return this.redactValue(payload, 0) as T;
  }

  /**
   * Returns the input by reference when nothing in it changed. Every event the
   * Core publishes passes through here, and almost none of them contain a
   * secret — copying each one would put an allocation per subtree on the path
   * that carries every byte of agent output.
   */
  private redactValue(value: unknown, depth: number): unknown {
    if (depth > 8) return value;
    if (typeof value === 'string') return this.redactSecrets(value);

    if (Array.isArray(value)) {
      let changed = false;
      const out = value.map(item => {
        const redacted = this.redactValue(item, depth + 1);
        if (redacted !== item) changed = true;
        return redacted;
      });
      return changed ? out : value;
    }

    if (value && typeof value === 'object') {
      // Only plain objects are walked; a class instance rebuilt as a literal
      // would lose its prototype, which is a worse bug than an unredacted field.
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return value;

      let changed = false;
      const out: Record<string, unknown> = {};
      for (const [field, item] of Object.entries(value as Record<string, unknown>)) {
        const redacted = this.redactValue(item, depth + 1);
        if (redacted !== item) changed = true;
        out[field] = redacted;
      }
      return changed ? out : value;
    }

    return value;
  }

  /** How many distinct values are currently being stripped from output. */
  public getRedactedValueCount(): number {
    return this.redactionIndex.length;
  }

  // --- Status --------------------------------------------------------------

  /**
   * What the vault can say about itself without saying anything about what is
   * in it: the algorithm, whether the salt is there, and a count per state of
   * the rows it manages. Names of managed keys are configuration, not secrets;
   * no value is read into the result.
   */
  public getStatus(): VaultStatus {
    let ready = true;
    let saltPresent = false;
    try {
      this.key();
      saltPresent = Boolean(this.saltPath && fs.existsSync(this.saltPath));
    } catch (err) {
      console.error(`[SecretVault] Key derivation failed: ${(err as Error).message}`);
      ready = false;
    }

    let encryptedKeys = 0;
    let plaintextKeys = 0;
    let unreadableKeys = 0;

    if (ready) {
      for (const key of this.secretKeys) {
        let row: SettingRow | undefined;
        try {
          row = this.db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as SettingRow | undefined;
        } catch {
          ready = false;
          break;
        }
        if (!row) continue;
        if (!this.isEnvelope(row.value)) {
          plaintextKeys++;
          continue;
        }
        try {
          this.decrypt(row.value);
          encryptedKeys++;
        } catch {
          unreadableKeys++;
        }
      }
    }

    return {
      ready,
      algorithm: 'AES-256-GCM',
      keyDerivation: `PBKDF2-HMAC-${PBKDF2_DIGEST.toUpperCase()}`,
      iterations: this.iterations,
      ivBytes: IV_BYTES,
      authTagBytes: TAG_BYTES,
      envelopeVersion: 'v1',
      saltPresent,
      managedKeys: [...this.secretKeys],
      encryptedKeys,
      plaintextKeys,
      unreadableKeys,
      migrationComplete: ready && plaintextKeys === 0,
      redactedValues: this.redactionIndex.length
    };
  }
}

/**
 * The process-wide vault. Constructed on import and installed as the redactor
 * for the log streams and the EventBus; no key is derived and no file is
 * touched until the first secret is actually read or written.
 */
export const secretVault = new SecretVaultService({ installRedaction: true });
