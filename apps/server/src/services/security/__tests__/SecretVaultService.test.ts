/**
 * Tests for the Local Secret Vault (P9-01).
 *
 * The repository has no test runner (`docs/p5.0-01-verification-report.md` § 3),
 * so this is a standalone script with its own assertion harness, matching the
 * verification, worktree, delegation, billing and pairing suites.
 *
 * Nothing cryptographic is mocked. Every envelope here is produced by the real
 * AES-256-GCM implementation under a real PBKDF2-derived key, written to a real
 * SQLite database in a temp directory, and read back through the real service —
 * a faked cipher would prove only that the test agrees with itself, and the
 * entire claim of this subsystem is that a credential on disk is unreadable
 * without the machine it was stored on.
 *
 * The one concession to speed is the PBKDF2 iteration count: the instances built
 * by `vault()` derive at 1,000 rounds rather than the production 100,000, which
 * changes how long a key takes to derive and nothing else about what is being
 * asserted. The process-wide singleton — exercised in the redaction, EventBus
 * and REST sections — runs at the real count.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/security/__tests__/SecretVaultService.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-vault-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

const Fastify = require('fastify');
const { dbService } = require('../../DatabaseService');
const { eventBus } = require('../../EventBus');
const {
  SecretVaultService,
  SecretVaultError,
  secretVault,
  SECRET_SETTING_KEYS,
  VAULT_ENVELOPE_PREFIX,
  REDACTION_PLACEHOLDER
} = require('../SecretVaultService');
const { registerLogRedactor, clearLogRedactor, redactChunk } = require('../../../utils/logger');
const securityRoutes = require('../../../routes/security').default;

// --- Assertion harness ---

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(
    label,
    ok,
    ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function describe(name: string): void {
  console.log(`\n${name}`);
}

function cleanup(): void {
  try {
    dbService.close();
  } catch {
    /* already closed */
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

/** Catches a throw and reports the SecretVaultError code, or what happened instead. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'NO_THROW';
  } catch (err) {
    if (err instanceof SecretVaultError) return (err as { code: string }).code;
    return `WRONG_ERROR:${(err as Error).name}`;
  }
}

const THIS_MACHINE = 'test-machine-identity';

/** A vault bound to a named identity, sharing the temp data directory's salt. */
function vault(identity: string = THIS_MACHINE, overrides: Record<string, unknown> = {}) {
  return new SecretVaultService({
    dataDir: tmpDir,
    machineIdentity: identity,
    iterations: 1000,
    ...overrides
  });
}

/** The raw stored bytes of a settings row, bypassing the vault entirely. */
function rawSetting(key: string): string | undefined {
  const row = dbService.getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function writePlaintextSetting(key: string, value: string): void {
  dbService
    .getDb()
    .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(key, value);
}

function deleteSetting(key: string): void {
  dbService.getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
}

const SAMPLE_KEY = 'sk-live-51H8xQ2eZvKYlo2C0000000000deadbeefcafef00d';

async function main(): Promise<void> {
  // --- Envelope shape -------------------------------------------------------
  describe('encrypt — the serialized envelope');
  {
    const v = vault();
    const envelope = v.encrypt(SAMPLE_KEY);

    check('is tagged with the versioned vault prefix', envelope.startsWith(VAULT_ENVELOPE_PREFIX));
    check('does not contain the plaintext', !envelope.includes(SAMPLE_KEY));

    const parts = envelope.split(':');
    equal('is five colon-separated fields', parts.length, 5);
    equal('named vault', parts[0], 'vault');
    equal('at version v1', parts[1], 'v1');
    equal('carrying a 12-byte IV', parts[2].length, 24);
    equal('and a 16-byte authentication tag', parts[3].length, 32);
    check('all of it hex', /^[0-9a-f]+$/.test(parts[2] + parts[3] + parts[4]));
    check('recognised as an envelope', v.isEnvelope(envelope));
    check('while a plain string is not', !v.isEnvelope(SAMPLE_KEY));
  }

  // --- Round trip -----------------------------------------------------------
  describe('encrypt/decrypt — round trip');
  {
    const v = vault();
    const cases: Array<[string, string]> = [
      ['an API key', SAMPLE_KEY],
      ['a JSON blob', JSON.stringify({ publicKey: 'BPub', privateKey: 'kPriv-0123456789' })],
      ['an empty string', ''],
      ['a single character', 'x'],
      ['unicode', 'clé-secrète-🔐-пароль'],
      ['a value containing colons', 'vault:v1:not:really:an:envelope'],
      ['64KB of key material', 'A'.repeat(65536)]
    ];

    for (const [label, plaintext] of cases) {
      equal(`${label} survives a round trip`, v.decrypt(v.encrypt(plaintext)), plaintext);
    }
  }

  // --- IV freshness ---------------------------------------------------------
  describe('encrypt — a fresh IV for every call');
  {
    const v = vault();
    const envelopes = Array.from({ length: 50 }, () => v.encrypt(SAMPLE_KEY));
    const ivs = new Set(envelopes.map((e: string) => e.split(':')[2]));
    const ciphertexts = new Set(envelopes.map((e: string) => e.split(':')[4]));

    equal('50 encryptions of one plaintext produce 50 distinct IVs', ivs.size, 50);
    equal('and 50 distinct ciphertexts', ciphertexts.size, 50);
    check(
      'every one of which decrypts back to the same secret',
      envelopes.every((e: string) => v.decrypt(e) === SAMPLE_KEY)
    );
  }

  // --- Tamper detection -----------------------------------------------------
  describe('decrypt — tamper detection');
  {
    const v = vault();
    const envelope = v.encrypt(SAMPLE_KEY);
    const [, , iv, tag, ciphertext] = envelope.split(':');

    // Flip one bit of the ciphertext. GCM authenticates the ciphertext, so this
    // is caught before any plaintext is produced — not decrypted into garbage.
    const flipped = ciphertext.slice(0, -1) + (ciphertext.slice(-1) === '0' ? '1' : '0');
    equal(
      'a modified ciphertext is rejected',
      codeOf(() => v.decrypt(`vault:v1:${iv}:${tag}:${flipped}`)),
      'TAMPERED_SECRET_ERROR'
    );

    const forgedTag = tag.slice(0, -1) + (tag.slice(-1) === '0' ? '1' : '0');
    equal(
      'a forged authentication tag is rejected',
      codeOf(() => v.decrypt(`vault:v1:${iv}:${forgedTag}:${ciphertext}`)),
      'TAMPERED_SECRET_ERROR'
    );

    const otherIv = v.encrypt(SAMPLE_KEY).split(':')[2];
    equal(
      'a substituted IV is rejected',
      codeOf(() => v.decrypt(`vault:v1:${otherIv}:${tag}:${ciphertext}`)),
      'TAMPERED_SECRET_ERROR'
    );

    equal(
      'truncating the tag is rejected as malformed, not attempted',
      codeOf(() => v.decrypt(`vault:v1:${iv}:${tag.slice(0, 16)}:${ciphertext}`)),
      'INVALID_ENVELOPE_ERROR'
    );
    equal(
      'so is an IV of the wrong length',
      codeOf(() => v.decrypt(`vault:v1:${iv.slice(0, 12)}:${tag}:${ciphertext}`)),
      'INVALID_ENVELOPE_ERROR'
    );
    equal(
      'so is a missing field',
      codeOf(() => v.decrypt(`vault:v1:${iv}:${tag}`)),
      'INVALID_ENVELOPE_ERROR'
    );
    equal(
      'so is a non-hex body',
      codeOf(() => v.decrypt(`vault:v1:${iv}:${tag}:zzzz`)),
      'INVALID_ENVELOPE_ERROR'
    );
    equal(
      'and a value that is not an envelope at all',
      codeOf(() => v.decrypt(SAMPLE_KEY)),
      'INVALID_ENVELOPE_ERROR'
    );

    check(
      'the untampered envelope still decrypts',
      v.decrypt(envelope) === SAMPLE_KEY,
      'tamper cases must not have disturbed the original'
    );
  }

  // --- Key binding ----------------------------------------------------------
  describe('decrypt — the key is bound to the machine');
  {
    const mine = vault();
    const envelope = mine.encrypt(SAMPLE_KEY);

    // A second instance with the same identity and salt: this is what a restart
    // of the Core looks like.
    const afterRestart = vault();
    equal('a fresh instance on this machine reads it', afterRestart.decrypt(envelope), SAMPLE_KEY);

    // A different identity against the same salt file: this is what copying
    // asterim.db to another workstation looks like.
    const elsewhere = vault('a-different-machine');
    equal(
      'an instance on another machine cannot',
      codeOf(() => elsewhere.decrypt(envelope)),
      'TAMPERED_SECRET_ERROR'
    );

    check('the salt file was created', fs.existsSync(path.join(tmpDir, 'vault.salt')));
    if (process.platform !== 'win32') {
      const mode = fs.statSync(path.join(tmpDir, 'vault.salt')).mode & 0o777;
      equal('owner-only', mode, 0o600);
    }
    const salt = fs.readFileSync(path.join(tmpDir, 'vault.salt'), 'utf8').trim();
    equal('holding 32 bytes of hex salt', salt.length, 64);
    check('and nothing that looks like a key', !salt.includes(SAMPLE_KEY));
  }

  // --- Stored secrets -------------------------------------------------------
  describe('setSecret/getSecret/deleteSecret');
  {
    const v = vault();
    v.setSecret('ai_api_key', SAMPLE_KEY);

    const stored = rawSetting('ai_api_key');
    check('the row on disk is an envelope', Boolean(stored && stored.startsWith(VAULT_ENVELOPE_PREFIX)));
    check('and does not contain the plaintext', Boolean(stored && !stored.includes(SAMPLE_KEY)));
    equal('the vault reads it back', v.getSecret('ai_api_key'), SAMPLE_KEY);

    v.setSecret('ai_api_key', 'sk-live-rotated-0123456789abcdef');
    equal('a rotated secret replaces the old one', v.getSecret('ai_api_key'), 'sk-live-rotated-0123456789abcdef');
    equal(
      'and leaves exactly one row',
      (dbService.getDb().prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'ai_api_key'").get() as { n: number })
        .n,
      1
    );

    equal('an absent key reads as null', v.getSecret('no_such_secret'), null);

    v.deleteSecret('ai_api_key');
    equal('a deleted secret is gone', v.getSecret('ai_api_key'), null);
    equal('and so is its row', rawSetting('ai_api_key'), undefined);

    // The database is never a place a decryption key may live.
    const allSettings = dbService.getDb().prepare('SELECT key, value FROM settings').all() as Array<{
      key: string;
      value: string;
    }>;
    check(
      'no settings row holds the vault salt',
      !allSettings.some(row => row.value.includes(salt())),
      'the key material must never round-trip into the database it protects'
    );
  }

  // --- Legacy migration -----------------------------------------------------
  describe('getSecret — transparent migration of legacy plaintext');
  {
    const v = vault();
    const legacy = 'AIzaSyLegacyPlaintextGeminiKey_0000000';
    writePlaintextSetting('ai_api_key', legacy);
    equal('a plaintext row is still readable', rawSetting('ai_api_key'), legacy);

    equal('the first read returns the legacy value', v.getSecret('ai_api_key'), legacy);

    const upgraded = rawSetting('ai_api_key');
    check('and the row is upgraded in place', Boolean(upgraded && upgraded.startsWith(VAULT_ENVELOPE_PREFIX)));
    check('with the plaintext gone from disk', Boolean(upgraded && !upgraded.includes(legacy)));
    equal('the second read goes through the cipher', v.getSecret('ai_api_key'), legacy);

    v.deleteSecret('ai_api_key');
  }

  describe('migrateLegacyPlaintext — the startup sweep');
  {
    const v = vault();
    writePlaintextSetting('ai_api_key', 'AIzaSy-plaintext-one-0000000');
    writePlaintextSetting('stripe_secret_key', 'sk_test_plaintext_two_00000000');
    v.setSecret('jwt_secret', 'already-encrypted-jwt-secret-000');
    writePlaintextSetting('ai_provider', 'gemini');
    writePlaintextSetting('first_run_completed', 'true');

    const result = v.migrateLegacyPlaintext();

    equal('both plaintext credentials are migrated', result.migrated.sort(), [
      'ai_api_key',
      'stripe_secret_key'
    ]);
    equal('the encrypted one is left alone', result.alreadyEncrypted, ['jwt_secret']);
    equal('nothing failed', result.failed, []);

    check(
      'ai_api_key is now an envelope',
      String(rawSetting('ai_api_key')).startsWith(VAULT_ENVELOPE_PREFIX)
    );
    check(
      'stripe_secret_key is now an envelope',
      String(rawSetting('stripe_secret_key')).startsWith(VAULT_ENVELOPE_PREFIX)
    );
    equal('the migrated Gemini key still decrypts', v.getSecret('ai_api_key'), 'AIzaSy-plaintext-one-0000000');
    equal(
      'and so does the migrated Stripe key',
      v.getSecret('stripe_secret_key'),
      'sk_test_plaintext_two_00000000'
    );

    equal('non-secret configuration is untouched', rawSetting('ai_provider'), 'gemini');
    equal('including the first-run flag', rawSetting('first_run_completed'), 'true');

    const second = v.migrateLegacyPlaintext();
    equal('a second sweep migrates nothing', second.migrated, []);
    equal('and reports the same rows as already encrypted', second.alreadyEncrypted.sort(), [
      'ai_api_key',
      'jwt_secret',
      'stripe_secret_key'
    ]);
  }

  // --- Bulk reads -----------------------------------------------------------
  describe('decryptIfEnvelope — mixed result sets');
  {
    const v = vault();
    equal('a plain configuration value passes through', v.decryptIfEnvelope('gemini'), 'gemini');
    equal('an envelope is decrypted', v.decryptIfEnvelope(v.encrypt(SAMPLE_KEY)), SAMPLE_KEY);

    const foreign = vault('a-different-machine').encrypt(SAMPLE_KEY);
    equal(
      'an envelope this machine cannot read is returned as-is rather than throwing',
      v.decryptIfEnvelope(foreign),
      foreign
    );
  }

  // --- Unreadable rows ------------------------------------------------------
  describe('getSecret — a row this machine cannot decrypt');
  {
    const v = vault();
    const foreign = vault('yet-another-machine').encrypt('someone-elses-secret-value');
    writePlaintextSetting('ai_api_key', foreign);

    equal('reads as absent rather than throwing', v.getSecret('ai_api_key'), null);
    equal('and the unreadable row is left in place, not destroyed', rawSetting('ai_api_key'), foreign);

    const status = v.getStatus();
    equal('the status counts it', status.unreadableKeys, 1);
    deleteSetting('ai_api_key');
  }

  // --- Redaction ------------------------------------------------------------
  describe('redactSecrets');
  {
    const v = vault();
    v.setSecret('ai_api_key', SAMPLE_KEY);

    const line = `[GeminiProvider] request failed with key ${SAMPLE_KEY} (401)`;
    const redacted = v.redactSecrets(line);
    check('the secret is gone from the line', !redacted.includes(SAMPLE_KEY));
    check('replaced by the placeholder', redacted.includes(REDACTION_PLACEHOLDER));
    check('and the rest of the line survives', redacted.includes('request failed with key'));

    equal(
      'every occurrence is replaced',
      v.redactSecrets(`${SAMPLE_KEY} ${SAMPLE_KEY}`),
      `${REDACTION_PLACEHOLDER} ${REDACTION_PLACEHOLDER}`
    );
    equal('text with no secret in it is untouched', v.redactSecrets('nothing to see'), 'nothing to see');
    equal('an empty string is safe', v.redactSecrets(''), '');

    // A JSON secret contributes its leaves: the private half of the VAPID pair
    // is what would actually appear in a stack trace, not the whole blob.
    v.setSecret(
      'vapid_keys',
      JSON.stringify({ publicKey: 'BPublicKeyValue123', privateKey: 'vapidPrivateKeyValue456' })
    );
    const pushLine = 'webpush failed: privateKey=vapidPrivateKeyValue456 endpoint=https://fcm/x';
    check('the VAPID private key is redacted', !v.redactSecrets(pushLine).includes('vapidPrivateKeyValue456'));
    check(
      'the public key, which is meant to be published, is not',
      v.redactSecrets('publicKey=BPublicKeyValue123').includes('BPublicKeyValue123')
    );

    // A short value would collide with ordinary log text; it is not registered.
    v.setSecret('jwt_secret', 'short');
    check('a value of 8 characters or fewer is not redacted', v.redactSecrets('short circuit') === 'short circuit');

    v.deleteSecret('ai_api_key');
    check(
      'a deleted secret stops being redacted',
      v.redactSecrets(`key=${SAMPLE_KEY}`).includes(SAMPLE_KEY)
    );

    v.deleteSecret('vapid_keys');
    v.deleteSecret('jwt_secret');
  }

  describe('redactPayload — nested structures');
  {
    const v = vault();
    v.setSecret('ai_api_key', SAMPLE_KEY);

    const payload = {
      content: `export const KEY = '${SAMPLE_KEY}';`,
      meta: { nested: [{ line: `Authorization: Bearer ${SAMPLE_KEY}` }] },
      count: 3,
      flag: true,
      missing: null
    };
    const out = v.redactPayload(payload);

    check('a top-level string is redacted', !out.content.includes(SAMPLE_KEY));
    check('so is one nested in an array inside an object', !out.meta.nested[0].line.includes(SAMPLE_KEY));
    equal('numbers survive', out.count, 3);
    equal('booleans survive', out.flag, true);
    equal('null survives', out.missing, null);
    check('and the original object is not mutated', payload.content.includes(SAMPLE_KEY));

    // Every event the Core publishes passes through this, and almost none carry
    // a secret; a clean payload must come back by reference rather than as a
    // rebuilt copy.
    const clean = { content: 'ordinary output', meta: { nested: [{ line: 'still ordinary' }] } };
    check('a payload with no secret in it is returned by reference', v.redactPayload(clean) === clean);
    check('nested structures included', v.redactPayload(clean).meta === clean.meta);

    v.deleteSecret('ai_api_key');
    const untouched = { content: 'no secrets here' };
    check('with nothing registered the payload is returned by reference', v.redactPayload(untouched) === untouched);
  }

  describe('the log stream redactor');
  {
    const v = vault();
    v.setSecret('ai_api_key', SAMPLE_KEY);
    registerLogRedactor((text: string) => v.redactSecrets(text));

    const chunk = `[AiService] configured with ${SAMPLE_KEY}\n`;
    equal('a string chunk is redacted on its way to the log file', redactChunk(chunk), `[AiService] configured with ${REDACTION_PLACEHOLDER}\n`);
    check(
      'a Buffer chunk is redacted too',
      !redactChunk(Buffer.from(chunk, 'utf8')).toString('utf8').includes(SAMPLE_KEY)
    );

    clearLogRedactor();
    equal('and with no redactor installed the chunk passes through', redactChunk(chunk), chunk);
    // The process-wide singleton owns this seam in production; put it back.
    registerLogRedactor((text: string) => secretVault.redactSecrets(text));
    v.deleteSecret('ai_api_key');
  }

  describe('the EventBus payload redactor');
  {
    // Through the process singleton, which installed itself as the EventBus
    // redactor on import — this is the production path, not a local instance.
    const agentKey = 'sk-live-agent-echoed-this-0123456789';
    secretVault.setSecret('ai_api_key', agentKey);

    const seen: any[] = [];
    const listener = (event: any) => seen.push(event);
    eventBus.subscribe('agent.output', listener);

    eventBus.publish({
      id: 'evt_vault_test',
      type: 'agent.output',
      source: 'agent',
      timestamp: Date.now(),
      payload: { projectId: 'p1', threadId: 't1', content: `$ echo $API_KEY\n${agentKey}\n` }
    });

    equal('the event still reaches its subscriber', seen.length, 1);
    check('but the echoed credential does not', !seen[0].payload.content.includes(agentKey));
    check('the placeholder is there instead', seen[0].payload.content.includes(REDACTION_PLACEHOLDER));
    equal('and the routing fields are intact', seen[0].payload.projectId, 'p1');
    equal('including the thread', seen[0].payload.threadId, 't1');
    equal('and the event type', seen[0].type, 'agent.output');

    eventBus.unsubscribe('agent.output', listener);
    secretVault.deleteSecret('ai_api_key');
  }

  // --- Status ---------------------------------------------------------------
  describe('getStatus');
  {
    const v = vault();
    for (const key of SECRET_SETTING_KEYS) deleteSetting(key);

    const empty = v.getStatus();
    equal('reports the algorithm', empty.algorithm, 'AES-256-GCM');
    equal('and the key derivation function', empty.keyDerivation, 'PBKDF2-HMAC-SHA512');
    equal('a 12-byte IV', empty.ivBytes, 12);
    equal('a 16-byte tag', empty.authTagBytes, 16);
    equal('the envelope version', empty.envelopeVersion, 'v1');
    check('the vault is ready', empty.ready);
    check('the salt is present', empty.saltPresent);
    equal('nothing is stored yet', empty.encryptedKeys, 0);
    equal('nothing is plaintext', empty.plaintextKeys, 0);
    check('so migration is complete', empty.migrationComplete);
    equal('and the managed key names are reported', empty.managedKeys.sort(), [
      'ai_api_key',
      'hmac_secret',
      'jwt_secret',
      'stripe_secret_key',
      'vapid_keys'
    ]);

    v.setSecret('ai_api_key', SAMPLE_KEY);
    writePlaintextSetting('stripe_secret_key', 'sk_test_still_plaintext_000');
    const mixed = v.getStatus();
    equal('one encrypted row is counted', mixed.encryptedKeys, 1);
    equal('one plaintext row is counted', mixed.plaintextKeys, 1);
    check('and migration is reported incomplete', !mixed.migrationComplete);

    v.migrateLegacyPlaintext();
    const after = v.getStatus();
    equal('after the sweep both are encrypted', after.encryptedKeys, 2);
    equal('none are plaintext', after.plaintextKeys, 0);
    check('and migration is complete', after.migrationComplete);

    const serialized = JSON.stringify(after);
    check('the status carries no secret value', !serialized.includes(SAMPLE_KEY));
    check('and none of the plaintext Stripe key', !serialized.includes('sk_test_still_plaintext_000'));
    for (const key of SECRET_SETTING_KEYS) deleteSetting(key);
  }

  // --- The REST route -------------------------------------------------------
  describe('GET /api/v1/security/vault-status');
  {
    // The route reads the process singleton, so seed through it.
    secretVault.setSecret('ai_api_key', SAMPLE_KEY);

    const app = Fastify();
    await app.register(securityRoutes);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/v1/security/vault-status' });
    equal('answers 200', res.statusCode, 200);

    const body = res.json();
    equal('reporting the cipher', body.vault.algorithm, 'AES-256-GCM');
    equal('the key derivation', body.vault.keyDerivation, 'PBKDF2-HMAC-SHA512');
    equal('the production iteration count', body.vault.iterations, 100000);
    check('the vault is ready', body.vault.ready);
    equal('the encrypted row is counted', body.vault.encryptedKeys, 1);
    equal('with nothing left in plaintext', body.vault.plaintextKeys, 0);
    equal('and nothing unreadable', body.vault.unreadableKeys, 0);
    check('so the vault reports healthy', body.healthy);

    const raw = res.body;
    check('the response body contains no secret value', !raw.includes(SAMPLE_KEY));
    check('nor any envelope', !raw.includes(VAULT_ENVELOPE_PREFIX));
    check(
      'nor the salt',
      !raw.includes(fs.readFileSync(path.join(tmpDir, 'vault.salt'), 'utf8').trim())
    );

    // A plaintext row must show up as unhealthy — that is the whole point of
    // the endpoint for an audit.
    writePlaintextSetting('stripe_secret_key', 'sk_test_audit_visible_0000');
    const degraded = (await app.inject({ method: 'GET', url: '/api/v1/security/vault-status' })).json();
    equal('a plaintext credential is reported', degraded.vault.plaintextKeys, 1);
    check('and the vault is not healthy', !degraded.healthy);
    check(
      'still without leaking it',
      !JSON.stringify(degraded).includes('sk_test_audit_visible_0000')
    );

    await app.close();
    for (const key of SECRET_SETTING_KEYS) deleteSetting(key);
  }

  // --- Production defaults --------------------------------------------------
  describe('the process singleton');
  {
    const status = secretVault.getStatus();
    equal('derives at 100,000 PBKDF2 rounds', status.iterations, 100000);
    equal('under HMAC-SHA512', status.keyDerivation, 'PBKDF2-HMAC-SHA512');
    check('and is ready on this machine', status.ready);

    // Bound to the real machine identity, so it must not read an envelope made
    // under the test identity.
    equal(
      'and cannot read a foreign envelope',
      codeOf(() => secretVault.decrypt(vault('a-different-machine').encrypt(SAMPLE_KEY))),
      'TAMPERED_SECRET_ERROR'
    );

    const roundTripped = secretVault.encrypt(SAMPLE_KEY);
    equal('its own envelopes round-trip', secretVault.decrypt(roundTripped), SAMPLE_KEY);
  }
}

function salt(): string {
  return fs.readFileSync(path.join(tmpDir, 'vault.salt'), 'utf8').trim();
}

main()
  .catch(err => {
    failed++;
    console.error('\nUNCAUGHT ERROR:', err);
  })
  .finally(() => {
    cleanup();
    console.log(`\n${passed}/${passed + failed} assertions passed`);
    if (failures.length > 0) {
      console.log('Failed assertions:');
      for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed === 0 ? 0 : 1);
  });
