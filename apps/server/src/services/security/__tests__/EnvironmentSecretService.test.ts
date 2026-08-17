/**
 * Tests for workspace & environment secrets (P9-02).
 *
 * The repository has no test runner (`docs/p5.0-01-verification-report.md` § 3),
 * so this is a standalone script with its own assertion harness, matching the
 * vault, verification, worktree, delegation, billing and pairing suites.
 *
 * Nothing cryptographic is mocked. Every envelope here is produced by the real
 * AES-256-GCM vault, written to a real SQLite database in a temp directory, and
 * read back through the real service — and the assertions that matter most are
 * the ones that read the raw column bytes and the raw HTTP body, because the
 * claim of this subsystem is about exactly those two places: a credential must be
 * unreadable on disk, and must not appear in a response at all.
 *
 * Sovereign mode is set before the first import so that importing the system
 * routes cannot open a relay socket or start mDNS from a test process.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/security/__tests__/EnvironmentSecretService.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-envsec-'));
process.env.ASTERIM_DATA_DIR = tmpDir;
process.env.ASTERIM_SOVEREIGN_MODE = 'true';

const Fastify = require('fastify');
const { dbService } = require('../../DatabaseService');
const { eventBus } = require('../../EventBus');
const { SecretVaultService, secretVault, VAULT_ENVELOPE_PREFIX, REDACTION_PLACEHOLDER } = require('../SecretVaultService');
const {
  EnvironmentSecretService,
  EnvironmentSecretError,
  environmentSecretService,
  SECRET_MASK,
  isMasked
} = require('../EnvironmentSecretService');
const { registerLogRedactor, clearLogRedactor, redactChunk } = require('../../../utils/logger');
const environmentSecretRoutes = require('../../../routes/environmentSecrets').default;
const securityRoutes = require('../../../routes/security').default;
const systemRoutes = require('../../../routes/system').default;

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
  check(label, ok, ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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

/** Catches a throw and reports the EnvironmentSecretError code, or what happened instead. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'NO_THROW';
  } catch (err) {
    if (err instanceof EnvironmentSecretError) return (err as { code: string }).code;
    return `WRONG_ERROR:${(err as Error).name}:${(err as Error).message}`;
  }
}

const THIS_MACHINE = 'test-machine-identity';

/** A vault bound to a named identity, sharing the temp data directory's salt. */
function vault(identity: string = THIS_MACHINE) {
  return new SecretVaultService({ dataDir: tmpDir, machineIdentity: identity, iterations: 1000 });
}

const testVault = vault();
/** The service under test, on the fast test key. */
const secrets = new EnvironmentSecretService({ vault: testVault });

// --- Fixtures -------------------------------------------------------------

let envCounter = 0;

/**
 * The account and users the environment rows hang off. Foreign keys are enforced
 * (`node:sqlite` enables them by default), so these have to be real rows.
 */
function seed(): void {
  const db = dbService.getDb();
  const now = Date.now();
  for (const userId of ['usr_dev', 'usr_owner', 'usr_viewer', 'usr_outsider']) {
    db.prepare(
      `INSERT OR IGNORE INTO users (id, email, password_hash, full_name, created_at, updated_at)
       VALUES (?, ?, 'x', ?, ?, ?)`
    ).run(userId, `${userId}@test.local`, userId, now, now);
  }
  db.prepare(
    `INSERT OR IGNORE INTO accounts (id, owner_user_id, account_name, created_at, updated_at)
     VALUES ('acc_test', 'usr_dev', 'Test Account', ?, ?)`
  ).run(now, now);
}

/** An environment row, plus its mirrored workspace row, so the FK holds. */
function makeEnvironment(prefix = 'env'): string {
  envCounter++;
  const id = `${prefix}_${envCounter}`;
  const now = Date.now();
  const db = dbService.getDb();
  db.prepare(
    `INSERT OR IGNORE INTO environments (id, account_id, name, slug, preset, execution_profile_id, is_personal, created_at, updated_at)
     VALUES (?, 'acc_test', ?, ?, 'personal', 'exec_default', 0, ?, ?)`
  ).run(id, `Environment ${envCounter}`, `slug-${id}`, now, now);
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, account_id, name, slug, preset, execution_profile_id, is_personal, created_at, updated_at)
     VALUES (?, 'acc_test', ?, ?, 'personal', 'exec_default', 0, ?, ?)`
  ).run(id, `Environment ${envCounter}`, `slug-${id}`, now, now);
  return id;
}

/** A workspace with no mirrored environments row — the case P9-02 has to repair. */
function makeWorkspaceOnly(): string {
  envCounter++;
  const id = `wsonly_${envCounter}`;
  const now = Date.now();
  dbService
    .getDb()
    .prepare(
      `INSERT INTO workspaces (id, account_id, name, slug, preset, execution_profile_id, is_personal, created_at, updated_at)
       VALUES (?, 'acc_test', ?, ?, 'personal', 'exec_default', 0, ?, ?)`
    )
    .run(id, `Workspace ${envCounter}`, `slug-${id}`, now, now);
  return id;
}

/** The raw stored bytes of a secret row, bypassing the service entirely. */
function rawSecret(environmentId: string, key: string): string | undefined {
  const row = dbService
    .getDb()
    .prepare('SELECT secret_value FROM environment_secrets WHERE environment_id = ? AND secret_key = ?')
    .get(environmentId, key) as { secret_value: string } | undefined;
  return row?.secret_value;
}

function writeRawSecret(environmentId: string, key: string, value: string, createdAt = Date.now()): void {
  dbService
    .getDb()
    .prepare(
      `INSERT INTO environment_secrets (id, environment_id, secret_key, secret_value, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(environment_id, secret_key) DO UPDATE SET secret_value = excluded.secret_value`
    )
    .run(`esec_raw_${environmentId}_${key}`, environmentId, key, value, createdAt);
}

function addMember(environmentId: string, userId: string, role: string): void {
  const now = Date.now();
  dbService
    .getDb()
    .prepare(
      `INSERT OR REPLACE INTO workspace_memberships (id, workspace_id, user_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(`wsm_${environmentId}_${userId}`, environmentId, userId, role, now);
}

/** True when the raw bytes of a file in the data directory contain `needle`. */
function fileContains(filename: string, needle: string): boolean {
  const file = path.join(tmpDir, filename);
  if (!fs.existsSync(file)) return false;
  return fs.readFileSync(file).toString('latin1').includes(needle);
}

function truncateSecrets(): void {
  dbService.getDb().exec('DELETE FROM environment_secrets');
}

const DEPLOY_TOKEN = 'ghp_9f3aa1c4d5e6f7089abcdef0123456789deadbeef';
const DATABASE_URL = 'postgres://asterim:s3cr3t-p4ssw0rd@db.internal:5432/production';

async function main(): Promise<void> {
  seed();

  // --- At rest --------------------------------------------------------------
  describe('setSecret — what lands in the column');
  {
    const env = makeEnvironment();
    secrets.setSecret(env, 'DEPLOY_TOKEN', DEPLOY_TOKEN);

    const stored = rawSecret(env, 'DEPLOY_TOKEN')!;
    check('the stored value is a vault envelope', stored.startsWith(VAULT_ENVELOPE_PREFIX));
    check('the plaintext is nowhere in the column', !stored.includes(DEPLOY_TOKEN));
    check('nor is any recognisable fragment of it', !stored.includes('ghp_'));
    equal('and it decrypts back to the secret', secrets.getSecretValue(env, 'DEPLOY_TOKEN'), DEPLOY_TOKEN);

    // Every write is a fresh IV, so the same secret must not produce the same
    // ciphertext twice — identical envelopes would leak that two environments
    // share a credential.
    const other = makeEnvironment();
    secrets.setSecret(other, 'DEPLOY_TOKEN', DEPLOY_TOKEN);
    check('the same secret in two environments stores differently', rawSecret(other, 'DEPLOY_TOKEN') !== stored);

    // A rewrite replaces the value and keeps the row's original timestamp.
    const before = secrets.getSecrets(env)[0].createdAt;
    secrets.setSecret(env, 'DEPLOY_TOKEN', 'ghp_rotated_0000000000000000000000');
    equal('a rotated secret reads back as the new value', secrets.getSecretValue(env, 'DEPLOY_TOKEN'), 'ghp_rotated_0000000000000000000000');
    equal('there is still one row for the key', secrets.getSecrets(env).length, 1);
    equal('and createdAt is when the secret was introduced', secrets.getSecrets(env)[0].createdAt, before);

    // An empty secret is a stored secret, not an absent one.
    secrets.setSecret(env, 'EMPTY_VALUE', '');
    check('an empty value still stores an envelope', rawSecret(env, 'EMPTY_VALUE')!.startsWith(VAULT_ENVELOPE_PREFIX));
    equal('and round-trips as empty', secrets.getSecretValue(env, 'EMPTY_VALUE'), '');

    // A multi-line credential — a PEM key is the realistic case.
    const pem = `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}\n-----END PRIVATE KEY-----`;
    secrets.setSecret(env, 'SERVICE_ACCOUNT_KEY', pem);
    equal('a multi-line credential round-trips byte for byte', secrets.getSecretValue(env, 'SERVICE_ACCOUNT_KEY'), pem);

    // Unicode, because the cipher operates on bytes and the envelope on hex.
    secrets.setSecret(env, 'UNICODE_SECRET', 'pässwörd-🔐-日本語');
    equal('as does a non-ASCII one', secrets.getSecretValue(env, 'UNICODE_SECRET'), 'pässwörd-🔐-日本語');

    truncateSecrets();
  }

  describe('getSecretValue — what is absent');
  {
    const env = makeEnvironment();
    equal('an unset key reads as null', secrets.getSecretValue(env, 'NOT_THERE'), null);
    equal('as does any key in an unknown environment', secrets.getSecretValue('env_missing', 'DEPLOY_TOKEN'), null);
    equal('and an unknown environment lists nothing', secrets.getSecrets('env_missing'), []);
  }

  // --- Key validation -------------------------------------------------------
  describe('setSecret — the key has to be an environment variable name');
  {
    const env = makeEnvironment();
    equal('a leading digit is rejected', codeOf(() => secrets.setSecret(env, '1TOKEN', 'x')), 'INVALID_SECRET_KEY_ERROR');
    equal('a hyphen is rejected', codeOf(() => secrets.setSecret(env, 'MY-TOKEN', 'x')), 'INVALID_SECRET_KEY_ERROR');
    equal('a space is rejected', codeOf(() => secrets.setSecret(env, 'MY TOKEN', 'x')), 'INVALID_SECRET_KEY_ERROR');
    equal('an empty key is rejected', codeOf(() => secrets.setSecret(env, '', 'x')), 'INVALID_SECRET_KEY_ERROR');
    equal('a shell-injecting key is rejected', codeOf(() => secrets.setSecret(env, 'A=B;rm -rf /', 'x')), 'INVALID_SECRET_KEY_ERROR');
    equal('a non-string value is rejected', codeOf(() => secrets.setSecret(env, 'TOKEN', 42 as any)), 'INVALID_SECRET_KEY_ERROR');

    // Names that would change what the agent process is, not what it can reach.
    equal('PATH cannot be stored as a secret', codeOf(() => secrets.setSecret(env, 'PATH', '/tmp/evil')), 'PROTECTED_SECRET_KEY_ERROR');
    equal('nor LD_PRELOAD', codeOf(() => secrets.setSecret(env, 'LD_PRELOAD', '/tmp/evil.so')), 'PROTECTED_SECRET_KEY_ERROR');
    equal('nor NODE_OPTIONS', codeOf(() => secrets.setSecret(env, 'NODE_OPTIONS', '--require /tmp/evil.js')), 'PROTECTED_SECRET_KEY_ERROR');
    equal('and the check is case-insensitive', codeOf(() => secrets.setSecret(env, 'Path', '/tmp/evil')), 'PROTECTED_SECRET_KEY_ERROR');

    // A valid name with surrounding whitespace is stored trimmed.
    secrets.setSecret(env, '  API_TOKEN  ', DEPLOY_TOKEN);
    equal('a padded key is stored trimmed', secrets.getSecrets(env)[0].key, 'API_TOKEN');
    equal('nothing was written under the padded form', secrets.getSecretValue(env, '  API_TOKEN  '), null);

    equal('a lowercase name is allowed', codeOf(() => secrets.setSecret(env, 'my_token', 'x-value-here')), 'NO_THROW');
    truncateSecrets();
  }

  describe('setSecret — the environment has to exist');
  {
    equal(
      'a secret for a nonexistent environment is rejected',
      codeOf(() => secrets.setSecret('env_does_not_exist', 'TOKEN', DEPLOY_TOKEN)),
      'ENVIRONMENT_NOT_FOUND_ERROR'
    );

    // A workspace whose mirrored environments row never landed still has to be
    // able to hold secrets; the mirror is filled in from the workspace.
    const wsOnly = makeWorkspaceOnly();
    equal('a workspace missing its environments mirror is repaired', codeOf(() => secrets.setSecret(wsOnly, 'TOKEN', DEPLOY_TOKEN)), 'NO_THROW');
    equal('and the secret is readable', secrets.getSecretValue(wsOnly, 'TOKEN'), DEPLOY_TOKEN);
    const mirrored = dbService.getDb().prepare('SELECT id FROM environments WHERE id = ?').get(wsOnly);
    check('the environments row now exists', Boolean(mirrored));
    truncateSecrets();
  }

  // --- Masking --------------------------------------------------------------
  describe('getSecrets — the masked inventory');
  {
    const env = makeEnvironment();
    secrets.setSecret(env, 'DEPLOY_TOKEN', DEPLOY_TOKEN);
    secrets.setSecret(env, 'DATABASE_URL', DATABASE_URL);

    const list = secrets.getSecrets(env);
    equal('both secrets are listed', list.length, 2);
    equal('sorted by key', list.map((s: any) => s.key), ['DATABASE_URL', 'DEPLOY_TOKEN']);
    equal('each carries the mask instead of a value', list[0].maskedValue, SECRET_MASK);
    check('each is reported as set', list.every((s: any) => s.isSet === true));
    check('each carries a timestamp', list.every((s: any) => typeof s.createdAt === 'number' && s.createdAt > 0));

    const serialized = JSON.stringify(list);
    check('the listing contains no secret value', !serialized.includes(DEPLOY_TOKEN));
    check('nor the second one', !serialized.includes(DATABASE_URL));
    check('nor its password', !serialized.includes('s3cr3t-p4ssw0rd'));
    check('nor any envelope', !serialized.includes(VAULT_ENVELOPE_PREFIX));
    equal('and the row shape carries nothing else', Object.keys(list[0]).sort(), ['createdAt', 'isSet', 'key', 'maskedValue']);

    truncateSecrets();
  }

  describe('isMasked — a mask must not be mistaken for a credential');
  {
    check('the exact placeholder is a mask', isMasked(SECRET_MASK));
    check('a row of bullets is a mask', isMasked('••••'));
    check('a row of asterisks is a mask', isMasked('********'));
    check('an empty string is not a mask', !isMasked(''));
    check('a real key is not a mask', !isMasked(DEPLOY_TOKEN));
    check('and neither is a key that merely contains a bullet', !isMasked(`${DEPLOY_TOKEN}•`));
  }

  // --- Tamper detection -----------------------------------------------------
  describe('a stored envelope that has been interfered with');
  {
    const env = makeEnvironment();
    secrets.setSecret(env, 'DEPLOY_TOKEN', DEPLOY_TOKEN);
    const envelope = rawSecret(env, 'DEPLOY_TOKEN')!;

    // One flipped hex digit in the ciphertext. GCM authenticates before it
    // decrypts, so this is rejected rather than returned as garbage.
    const flipped = envelope.slice(0, -1) + (envelope.endsWith('a') ? 'b' : 'a');
    writeRawSecret(env, 'DEPLOY_TOKEN', flipped);
    equal('a modified ciphertext is treated as absent, not decrypted', secrets.getSecretValue(env, 'DEPLOY_TOKEN'), null);

    writeRawSecret(env, 'DEPLOY_TOKEN', `${VAULT_ENVELOPE_PREFIX}not-even-hex`);
    equal('a malformed envelope is treated as absent', secrets.getSecretValue(env, 'DEPLOY_TOKEN'), null);

    // An envelope from another machine — a copied asterim.db.
    writeRawSecret(env, 'DEPLOY_TOKEN', vault('a-different-machine').encrypt(DEPLOY_TOKEN));
    equal('a foreign envelope does not open here', secrets.getSecretValue(env, 'DEPLOY_TOKEN'), null);

    const status = secrets.getStatus();
    equal('and it is counted as unreadable', status.unreadable, 1);
    equal('not as plaintext', status.plaintext, 0);

    // An unreadable secret is omitted from an agent's environment rather than
    // handed over as ciphertext.
    equal('an unreadable secret is not injected', secrets.resolveEnvironmentVariables(env), {});

    truncateSecrets();
  }

  // --- Legacy migration -----------------------------------------------------
  describe('legacy plaintext rows');
  {
    const env = makeEnvironment();
    writeRawSecret(env, 'DEPLOY_TOKEN', DEPLOY_TOKEN);

    const before = secrets.getStatus();
    equal('a cleartext row is counted as plaintext', before.plaintext, 1);
    check('so migration is reported incomplete', !before.migrationComplete);

    equal('reading it returns the value', secrets.getSecretValue(env, 'DEPLOY_TOKEN'), DEPLOY_TOKEN);
    check('and the row is upgraded in the same call', rawSecret(env, 'DEPLOY_TOKEN')!.startsWith(VAULT_ENVELOPE_PREFIX));
    check('with the plaintext gone from the column', !rawSecret(env, 'DEPLOY_TOKEN')!.includes(DEPLOY_TOKEN));
    equal('and it still reads back the same', secrets.getSecretValue(env, 'DEPLOY_TOKEN'), DEPLOY_TOKEN);

    // The startup sweep, for rows nothing has asked for yet.
    const other = makeEnvironment();
    writeRawSecret(env, 'LEGACY_A', 'legacy-value-aaaaaaaa');
    writeRawSecret(other, 'LEGACY_B', 'legacy-value-bbbbbbbb');
    writeRawSecret(other, 'ALREADY', testVault.encrypt('already-encrypted-value'));

    const swept = secrets.migrateLegacyPlaintext();
    equal('the sweep encrypts both cleartext rows', swept.migrated, 2);
    equal('and fails on none', swept.failed, 0);
    check('the first is an envelope', rawSecret(env, 'LEGACY_A')!.startsWith(VAULT_ENVELOPE_PREFIX));
    check('the second is too', rawSecret(other, 'LEGACY_B')!.startsWith(VAULT_ENVELOPE_PREFIX));
    equal('the first still decrypts to its value', secrets.getSecretValue(env, 'LEGACY_A'), 'legacy-value-aaaaaaaa');
    equal('the second as well', secrets.getSecretValue(other, 'LEGACY_B'), 'legacy-value-bbbbbbbb');
    equal('the already-encrypted row is untouched', secrets.getSecretValue(other, 'ALREADY'), 'already-encrypted-value');

    const after = secrets.getStatus();
    equal('nothing is left in plaintext', after.plaintext, 0);
    check('so migration is complete', after.migrationComplete);
    equal('a second sweep has nothing to do', secrets.migrateLegacyPlaintext().migrated, 0);

    truncateSecrets();
  }

  // --- Deletion -------------------------------------------------------------
  describe('deleteSecret');
  {
    const env = makeEnvironment();
    secrets.setSecret(env, 'DEPLOY_TOKEN', DEPLOY_TOKEN);
    secrets.setSecret(env, 'DATABASE_URL', DATABASE_URL);

    check('deleting a stored secret reports it', secrets.deleteSecret(env, 'DEPLOY_TOKEN') === true);
    equal('the row is gone', rawSecret(env, 'DEPLOY_TOKEN'), undefined);
    equal('the other secret is untouched', secrets.getSecretValue(env, 'DATABASE_URL'), DATABASE_URL);
    check('deleting it again reports nothing deleted', secrets.deleteSecret(env, 'DEPLOY_TOKEN') === false);
    check('as does deleting one that never existed', secrets.deleteSecret(env, 'NEVER_THERE') === false);

    equal('the environment drop removes what is left', secrets.deleteEnvironmentSecrets(env), 1);
    equal('and lists nothing afterwards', secrets.getSecrets(env), []);
  }

  describe('a deleted environment takes its secrets with it');
  {
    const env = makeEnvironment();
    secrets.setSecret(env, 'DEPLOY_TOKEN', DEPLOY_TOKEN);
    dbService.getDb().prepare('DELETE FROM environments WHERE id = ?').run(env);
    equal('the foreign key cascades the secret away', rawSecret(env, 'DEPLOY_TOKEN'), undefined);
    truncateSecrets();
  }

  // --- Agent injection & redaction ------------------------------------------
  describe('resolveEnvironmentVariables');
  {
    const env = makeEnvironment();
    secrets.setSecret(env, 'DEPLOY_TOKEN', DEPLOY_TOKEN);
    secrets.setSecret(env, 'DATABASE_URL', DATABASE_URL);

    const resolved = secrets.resolveEnvironmentVariables(env);
    equal('every secret is resolved as a decrypted variable', resolved, {
      DATABASE_URL,
      DEPLOY_TOKEN
    });
    equal('an environment with no secrets resolves to nothing', secrets.resolveEnvironmentVariables(makeEnvironment()), {});
    equal('and so does no environment at all', secrets.resolveEnvironmentVariables(''), {});

    // A row written by hand or by an older build under a name that cannot be
    // injected is skipped rather than passed to pty.spawn.
    writeRawSecret(env, 'PATH', testVault.encrypt('/tmp/evil'));
    const guarded = secrets.resolveEnvironmentVariables(env);
    check('a PATH row already in the table is not injected', !('PATH' in guarded));
    equal('while the legitimate secrets still are', Object.keys(guarded).sort(), ['DATABASE_URL', 'DEPLOY_TOKEN']);

    truncateSecrets();
  }

  describe('resolved secrets are redacted from the log stream');
  {
    const env = makeEnvironment();
    secrets.setSecret(env, 'DEPLOY_TOKEN', DEPLOY_TOKEN);

    // A fresh service on a fresh vault, so the assertion is that *resolving*
    // registers the value — not that an earlier setSecret in this process did.
    const coldVault = vault();
    const cold = new EnvironmentSecretService({ vault: coldVault });
    equal('nothing is registered before the resolve', coldVault.getRedactedValueCount(), 0);
    cold.resolveEnvironmentVariables(env);
    equal('resolving registers the secret', coldVault.getRedactedValueCount(), 1);

    registerLogRedactor((text: string) => coldVault.redactSecrets(text));
    const line = `[Agent] $ curl -H "Authorization: Bearer ${DEPLOY_TOKEN}"\n`;
    check('an echoed credential is stripped from a log line', !redactChunk(line).includes(DEPLOY_TOKEN));
    check('leaving the placeholder behind', redactChunk(line).includes(REDACTION_PLACEHOLDER));
    check('and a Buffer chunk is stripped too', !redactChunk(Buffer.from(line, 'utf8')).toString('utf8').includes(DEPLOY_TOKEN));

    clearLogRedactor();
    // The process-wide singleton owns this seam in production; put it back.
    registerLogRedactor((text: string) => secretVault.redactSecrets(text));

    // A deleted secret stops being redacted — the index must not grow forever.
    cold.deleteSecret(env, 'DEPLOY_TOKEN');
    equal('deleting the secret unregisters it', coldVault.getRedactedValueCount(), 0);
    truncateSecrets();
  }

  describe('resolved secrets are redacted from the EventBus');
  {
    // Through the process singleton, which installed itself as the EventBus
    // redactor on import — this is the production path.
    const env = makeEnvironment();
    const agentToken = 'ghp_singleton_path_00000000000000000000';
    environmentSecretService.setSecret(env, 'AGENT_TOKEN', agentToken);
    environmentSecretService.resolveEnvironmentVariables(env);

    const seen: any[] = [];
    const listener = (event: any) => seen.push(event);
    eventBus.subscribe('agent.output', listener);

    eventBus.publish({
      id: 'evt_envsec_test',
      type: 'agent.output',
      source: 'agent',
      timestamp: Date.now(),
      payload: { projectId: 'p1', threadId: 't1', content: `$ echo $AGENT_TOKEN\n${agentToken}\n` }
    });

    equal('the event still reaches its subscriber', seen.length, 1);
    check('but the workspace credential does not', !seen[0].payload.content.includes(agentToken));
    check('the placeholder is there instead', seen[0].payload.content.includes(REDACTION_PLACEHOLDER));
    equal('and the routing fields are intact', seen[0].payload.projectId, 'p1');
    equal('including the thread', seen[0].payload.threadId, 't1');

    eventBus.unsubscribe('agent.output', listener);
    environmentSecretService.deleteSecret(env, 'AGENT_TOKEN');
    truncateSecrets();
  }

  // --- The REST surface -----------------------------------------------------
  describe('the environment secrets endpoints');
  {
    // The routes read the process singleton, so seed through it.
    const env = makeEnvironment();
    let currentUser: any = { sub: 'usr_dev', acc: 'acc_test' };

    const app = Fastify();
    // Stands in for authMiddleware, which is registered on the real server.
    app.addHook('preHandler', async (request: any) => {
      request.user = currentUser;
    });
    await app.register(environmentSecretRoutes);
    await app.ready();

    // POST
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/environments/${env}/secrets`,
      payload: { key: 'DEPLOY_TOKEN', value: DEPLOY_TOKEN }
    });
    equal('POST answers 201', created.statusCode, 201);
    equal('reporting the key it stored', created.json().secret.key, 'DEPLOY_TOKEN');
    equal('masked', created.json().secret.maskedValue, SECRET_MASK);
    check('and the response carries no value', !created.body.includes(DEPLOY_TOKEN));
    check('the value landed as an envelope', rawSecret(env, 'DEPLOY_TOKEN')!.startsWith(VAULT_ENVELOPE_PREFIX));
    check('with no plaintext in the column', !rawSecret(env, 'DEPLOY_TOKEN')!.includes(DEPLOY_TOKEN));

    // The workspaces alias is the same handler on the same rows.
    const aliased = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${env}/secrets`,
      payload: { key: 'DATABASE_URL', value: DATABASE_URL }
    });
    equal('the /workspaces alias also answers 201', aliased.statusCode, 201);

    // GET
    const listed = await app.inject({ method: 'GET', url: `/api/v1/environments/${env}/secrets` });
    equal('GET answers 200', listed.statusCode, 200);
    equal('listing both secrets', listed.json().secrets.length, 2);
    equal('each masked', listed.json().secrets[0].maskedValue, SECRET_MASK);
    check('each flagged as set', listed.json().secrets.every((s: any) => s.isSet === true));
    check('the body contains no secret value', !listed.body.includes(DEPLOY_TOKEN));
    check('nor the second', !listed.body.includes(DATABASE_URL));
    check('nor its password', !listed.body.includes('s3cr3t-p4ssw0rd'));
    check('nor any envelope', !listed.body.includes(VAULT_ENVELOPE_PREFIX));

    const listedAlias = await app.inject({ method: 'GET', url: `/api/v1/workspaces/${env}/secrets` });
    equal('the /workspaces alias lists the same rows', listedAlias.json().secrets.length, 2);

    // Bad input
    equal(
      'POST without a key is a 400',
      (await app.inject({ method: 'POST', url: `/api/v1/environments/${env}/secrets`, payload: { value: 'x' } })).statusCode,
      400
    );
    equal(
      'POST without a value is a 400',
      (await app.inject({ method: 'POST', url: `/api/v1/environments/${env}/secrets`, payload: { key: 'TOKEN' } })).statusCode,
      400
    );
    equal(
      'POST of the mask itself is a 400',
      (await app.inject({ method: 'POST', url: `/api/v1/environments/${env}/secrets`, payload: { key: 'DEPLOY_TOKEN', value: SECRET_MASK } })).statusCode,
      400
    );
    // Read back through the singleton, which is the instance the routes use and
    // therefore the only one holding the key these envelopes were made with.
    equal('and the stored secret survived that attempt', environmentSecretService.getSecretValue(env, 'DEPLOY_TOKEN'), DEPLOY_TOKEN);
    equal(
      'POST of an unusable variable name is a 400',
      (await app.inject({ method: 'POST', url: `/api/v1/environments/${env}/secrets`, payload: { key: 'MY-TOKEN', value: 'x' } })).statusCode,
      400
    );
    const protectedPost = await app.inject({
      method: 'POST',
      url: `/api/v1/environments/${env}/secrets`,
      payload: { key: 'PATH', value: '/tmp/evil' }
    });
    equal('POST of PATH is a 400', protectedPost.statusCode, 400);
    equal('with the reason named', protectedPost.json().code, 'PROTECTED_SECRET_KEY_ERROR');

    // Unknown environment
    equal(
      'GET for an unknown environment is a 404',
      (await app.inject({ method: 'GET', url: '/api/v1/environments/env_nope/secrets' })).statusCode,
      404
    );
    const unknownPost = await app.inject({
      method: 'POST',
      url: '/api/v1/environments/env_nope/secrets',
      payload: { key: 'TOKEN', value: 'value-here-1234' }
    });
    equal('POST for an unknown environment is a 404', unknownPost.statusCode, 404);
    equal('with the reason named', unknownPost.json().code, 'ENVIRONMENT_NOT_FOUND_ERROR');

    // DELETE
    equal(
      'DELETE answers 200',
      (await app.inject({ method: 'DELETE', url: `/api/v1/environments/${env}/secrets/DEPLOY_TOKEN` })).statusCode,
      200
    );
    equal('the row is gone', rawSecret(env, 'DEPLOY_TOKEN'), undefined);
    equal('only the other secret is left', environmentSecretService.getSecrets(env).map((s: any) => s.key), ['DATABASE_URL']);
    equal(
      'DELETE of a secret that is not there is a 404',
      (await app.inject({ method: 'DELETE', url: `/api/v1/environments/${env}/secrets/DEPLOY_TOKEN` })).statusCode,
      404
    );
    equal(
      'the /workspaces alias deletes too',
      (await app.inject({ method: 'DELETE', url: `/api/v1/workspaces/${env}/secrets/DATABASE_URL` })).statusCode,
      200
    );
    equal('leaving nothing', environmentSecretService.getSecrets(env), []);

    // Authentication and membership
    currentUser = undefined;
    equal(
      'with no session the list is a 401',
      (await app.inject({ method: 'GET', url: `/api/v1/environments/${env}/secrets` })).statusCode,
      401
    );

    const managed = makeEnvironment('managed');
    addMember(managed, 'usr_owner', 'owner');
    addMember(managed, 'usr_viewer', 'viewer');

    currentUser = { sub: 'usr_owner' };
    equal(
      'an owner may store a secret',
      (await app.inject({ method: 'POST', url: `/api/v1/environments/${managed}/secrets`, payload: { key: 'TOKEN', value: DEPLOY_TOKEN } })).statusCode,
      201
    );

    currentUser = { sub: 'usr_viewer' };
    const viewerList = await app.inject({ method: 'GET', url: `/api/v1/environments/${managed}/secrets` });
    equal('a viewer may see the masked list', viewerList.statusCode, 200);
    check('still without any value in it', !viewerList.body.includes(DEPLOY_TOKEN));
    equal(
      'but may not store one',
      (await app.inject({ method: 'POST', url: `/api/v1/environments/${managed}/secrets`, payload: { key: 'OTHER', value: 'x-value-here' } })).statusCode,
      403
    );
    equal(
      'nor delete one',
      (await app.inject({ method: 'DELETE', url: `/api/v1/environments/${managed}/secrets/TOKEN` })).statusCode,
      403
    );

    currentUser = { sub: 'usr_outsider' };
    equal(
      'a non-member of a managed environment cannot list its secrets',
      (await app.inject({ method: 'GET', url: `/api/v1/environments/${managed}/secrets` })).statusCode,
      403
    );
    equal(
      'nor store one',
      (await app.inject({ method: 'POST', url: `/api/v1/environments/${managed}/secrets`, payload: { key: 'OTHER', value: 'x-value-here' } })).statusCode,
      403
    );
    equal('and the owner-stored secret is still there', environmentSecretService.getSecrets(managed).length, 1);

    await app.close();
    truncateSecrets();
  }

  // --- System settings masking ---------------------------------------------
  describe('GET /api/v1/system/settings — the machine credential');
  {
    const app = Fastify();
    await app.register(systemRoutes);
    await app.ready();

    const liveKey = 'AIzaSyD-live-gemini-key-000000000000000';
    secretVault.setSecret('ai_api_key', liveKey);
    dbService
      .getDb()
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_provider', 'gemini')")
      .run();
    dbService
      .getDb()
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_model', 'gemini-2.0-flash')")
      .run();

    const res = await app.inject({ method: 'GET', url: '/api/v1/system/settings' });
    equal('answers 200', res.statusCode, 200);
    const body = res.json();
    equal('the API key comes back masked', body.settings.ai_api_key, SECRET_MASK);
    check('presence is reported instead', body.hasApiKey === true);
    equal('and the masked keys are named', body.maskedKeys, ['ai_api_key']);
    equal('ordinary configuration is still readable', body.settings.ai_provider, 'gemini');
    equal('including the model', body.settings.ai_model, 'gemini-2.0-flash');
    check('the response body contains no part of the key', !res.body.includes(liveKey));
    check('nor its prefix', !res.body.includes('AIzaSy'));
    check('nor the stored envelope', !res.body.includes(VAULT_ENVELOPE_PREFIX));

    // POST: a re-submitted mask, and a blank field, both mean "unchanged".
    const masked = await app.inject({
      method: 'POST',
      url: '/api/v1/system/settings',
      payload: { settings: { ai_provider: 'gemini', ai_model: 'gemini-2.5-pro', ai_api_key: SECRET_MASK } }
    });
    equal('POST answers 200', masked.statusCode, 200);
    equal('the stored key is untouched by a re-submitted mask', secretVault.getSecret('ai_api_key'), liveKey);
    equal('while ordinary configuration was updated', (await app.inject({ method: 'GET', url: '/api/v1/system/settings' })).json().settings.ai_model, 'gemini-2.5-pro');

    await app.inject({
      method: 'POST',
      url: '/api/v1/system/settings',
      payload: { settings: { ai_api_key: '' } }
    });
    equal('a blank field leaves the stored key alone', secretVault.getSecret('ai_api_key'), liveKey);

    // A real new key replaces it, and lands encrypted.
    const rotated = 'AIzaSyD-rotated-gemini-key-11111111111';
    await app.inject({
      method: 'POST',
      url: '/api/v1/system/settings',
      payload: { settings: { ai_api_key: rotated } }
    });
    equal('a new key replaces the stored one', secretVault.getSecret('ai_api_key'), rotated);
    const storedRow = dbService.getDb().prepare("SELECT value FROM settings WHERE key = 'ai_api_key'").get() as { value: string };
    check('and rests as an envelope', storedRow.value.startsWith(VAULT_ENVELOPE_PREFIX));
    check('with no plaintext on disk', !storedRow.value.includes(rotated));

    // An explicit null is the only way to take a credential back out.
    await app.inject({
      method: 'POST',
      url: '/api/v1/system/settings',
      payload: { settings: { ai_api_key: null } }
    });
    equal('an explicit null clears the credential', secretVault.getSecret('ai_api_key'), null);
    const cleared = (await app.inject({ method: 'GET', url: '/api/v1/system/settings' })).json();
    check('and presence is reported as false', cleared.hasApiKey === false);
    equal('with nothing masked', cleared.maskedKeys, []);

    await app.close();
  }

  // --- Vault status ---------------------------------------------------------
  describe('GET /api/v1/security/vault-status — environment secret health');
  {
    const app = Fastify();
    await app.register(securityRoutes);
    await app.ready();

    truncateSecrets();
    const clean = (await app.inject({ method: 'GET', url: '/api/v1/security/vault-status' })).json();
    equal('an empty table reports nothing stored', clean.vault.environmentSecrets.total, 0);
    check('and the vault is healthy', clean.healthy === true);

    // Seeded through the singleton, which is what the route reads.
    const env = makeEnvironment();
    environmentSecretService.setSecret(env, 'DEPLOY_TOKEN', DEPLOY_TOKEN);
    const seeded = (await app.inject({ method: 'GET', url: '/api/v1/security/vault-status' })).json();
    equal('one stored secret is counted', seeded.vault.environmentSecrets.total, 1);
    equal('as encrypted', seeded.vault.environmentSecrets.encrypted, 1);
    equal('in one environment', seeded.vault.environmentSecrets.environments, 1);
    check('migration is complete', seeded.vault.environmentSecrets.migrationComplete === true);
    check('the vault is still healthy', seeded.healthy === true);
    check('and the status carries no value', !JSON.stringify(seeded).includes(DEPLOY_TOKEN));
    check('nor any envelope', !JSON.stringify(seeded).includes(VAULT_ENVELOPE_PREFIX));

    // A cleartext workspace credential has to make the endpoint say so — that is
    // the whole point of it for an audit.
    writeRawSecret(env, 'LEAKED', 'plaintext-workspace-token-000');
    const degraded = (await app.inject({ method: 'GET', url: '/api/v1/security/vault-status' })).json();
    equal('a plaintext environment secret is reported', degraded.vault.environmentSecrets.plaintext, 1);
    check('and the vault is not healthy', degraded.healthy === false);
    check('still without leaking it', !JSON.stringify(degraded).includes('plaintext-workspace-token-000'));

    environmentSecretService.migrateLegacyPlaintext();
    const repaired = (await app.inject({ method: 'GET', url: '/api/v1/security/vault-status' })).json();
    equal('the sweep leaves nothing in plaintext', repaired.vault.environmentSecrets.plaintext, 0);
    check('and the vault is healthy again', repaired.healthy === true);

    // The P9-01 fields are still there — this endpoint is shared.
    equal('the settings vault is still reported', repaired.vault.algorithm, 'AES-256-GCM');
    equal('with its key derivation', repaired.vault.keyDerivation, 'PBKDF2-HMAC-SHA512');

    await app.close();
    truncateSecrets();
  }

  // --- What is left in the file ---------------------------------------------
  describe('a migrated database keeps no cleartext in its freed pages');
  {
    // Through the singleton, so the sweep and the rebuild run on the connection
    // that owns the file — which is how the Core does it at startup.
    const env = makeEnvironment();
    const swept = 'plaintext-swept-token-4711-aaaaaaaa';
    writeRawSecret(env, 'SWEPT_TOKEN', swept);

    equal('the sweep encrypts the row', environmentSecretService.migrateLegacyPlaintext().migrated, 1);
    check('which now rests as an envelope', rawSecret(env, 'SWEPT_TOKEN')!.startsWith(VAULT_ENVELOPE_PREFIX));

    // SQLite frees the old page rather than overwriting it, so the encryption is
    // only true of the file once it has been rebuilt.
    check('the rebuild succeeds', dbService.compact() === true);
    check('and the cleartext is gone from the database file', !fileContains('asterim.db', swept));
    check('and from the write-ahead log', !fileContains('asterim.db-wal', swept));
    check('while the encrypted row still reads back', environmentSecretService.getSecretValue(env, 'SWEPT_TOKEN') === swept);

    truncateSecrets();
  }

  // --- Cross-machine ---------------------------------------------------------
  describe('a database carried to another machine');
  {
    const env = makeEnvironment();
    secrets.setSecret(env, 'DEPLOY_TOKEN', DEPLOY_TOKEN);

    // Same rows, same salt file, different machine identity — which is what a
    // copied ~/.asterim looks like on someone else's workstation.
    const elsewhere = new EnvironmentSecretService({ vault: vault('another-workstation') });
    equal('the secret does not decrypt there', elsewhere.getSecretValue(env, 'DEPLOY_TOKEN'), null);
    equal('nothing is injected into an agent there', elsewhere.resolveEnvironmentVariables(env), {});
    equal('but the key names are still visible', elsewhere.getSecrets(env).map((s: any) => s.key), ['DEPLOY_TOKEN']);
    equal('and it is reported as unreadable, not plaintext', elsewhere.getStatus().unreadable, 1);
    equal('while the original machine still reads it', secrets.getSecretValue(env, 'DEPLOY_TOKEN'), DEPLOY_TOKEN);

    truncateSecrets();
  }
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
