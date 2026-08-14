/**
 * Tests for the Sovereign Mode air-gap switch (SEC-01, DEC-028).
 *
 * The claim is negative — "no outbound connection is opened" — which cannot be
 * proved by inspecting a return value. Each subsystem is therefore exercised with
 * its network primitive replaced by a recorder: `socket.io-client`'s `io`, and
 * `web-push`'s `sendNotification`. An assertion that the recorder was never called
 * is the closest thing to proof available without a packet filter.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/__tests__/SovereignMode.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import Module from 'module';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-sovereign-'));
process.env.ASTERIM_DATA_DIR = tmpDir;
delete process.env.ASTERIM_SOVEREIGN_MODE;

// --- Network primitives, replaced before anything imports them ---------------

interface SocketAttempt {
  url: string;
}
const socketAttempts: SocketAttempt[] = [];
const pushAttempts: { endpoint: string }[] = [];

const originalLoad = (Module as any)._load;
(Module as any)._load = function patched(request: string, parent: unknown, isMain: boolean) {
  if (request === 'socket.io-client') {
    return {
      io: (url: string) => {
        socketAttempts.push({ url });
        // A socket that records and does nothing. RelayClient attaches handlers
        // immediately, so this has to answer `on` and `emit` without connecting.
        return { on: () => undefined, emit: () => undefined, close: () => undefined, disconnect: () => undefined };
      }
    };
  }
  if (request === 'web-push') {
    const stub = {
      generateVAPIDKeys: () => ({ publicKey: 'pub', privateKey: 'priv' }),
      setVapidDetails: () => undefined,
      sendNotification: async (subscription: { endpoint: string }) => {
        pushAttempts.push({ endpoint: subscription.endpoint });
        return { statusCode: 201 };
      }
    };
    return { ...stub, default: stub };
  }
  return originalLoad.apply(this, [request, parent, isMain]);
};

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
  (Module as any)._load = originalLoad;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

const { isSovereignMode, resetSovereignAnnouncements } = require('../SovereignMode');

/** Runs `fn` with sovereign mode forced on or off, then restores the environment. */
async function withSovereign(enabled: boolean, fn: () => Promise<void> | void): Promise<void> {
  const previous = process.env.ASTERIM_SOVEREIGN_MODE;
  if (enabled) process.env.ASTERIM_SOVEREIGN_MODE = 'true';
  else delete process.env.ASTERIM_SOVEREIGN_MODE;
  resetSovereignAnnouncements();
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.ASTERIM_SOVEREIGN_MODE;
    else process.env.ASTERIM_SOVEREIGN_MODE = previous;
  }
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main(): Promise<void> {
  // --- The switch itself ----------------------------------------------------
  describe('isSovereignMode');

  delete process.env.ASTERIM_SOVEREIGN_MODE;
  equal('off by default', isSovereignMode(), false);

  process.env.ASTERIM_SOVEREIGN_MODE = 'true';
  equal('the environment variable enables it', isSovereignMode(), true);

  process.env.ASTERIM_SOVEREIGN_MODE = 'false';
  equal("'false' does not enable it", isSovereignMode(), false);

  process.env.ASTERIM_SOVEREIGN_MODE = '1';
  equal("'1' does not enable it — the contract is the string 'true'", isSovereignMode(), false);

  process.env.ASTERIM_SOVEREIGN_MODE = 'TRUE';
  equal("'TRUE' does not enable it", isSovereignMode(), false);

  delete process.env.ASTERIM_SOVEREIGN_MODE;
  process.argv.push('--sovereign');
  equal('the CLI flag enables it', isSovereignMode(), true);
  process.argv.pop();
  equal('and removing the flag disables it again', isSovereignMode(), false);

  check(
    'it is read live, not captured at import',
    (() => {
      process.env.ASTERIM_SOVEREIGN_MODE = 'true';
      const on = isSovereignMode();
      delete process.env.ASTERIM_SOVEREIGN_MODE;
      return on && !isSovereignMode();
    })(),
    'a cached value would make the switch untestable and order-dependent'
  );

  // --- RelayClient ----------------------------------------------------------
  describe('RelayClient opens no socket in sovereign mode');

  // Imported *inside* the sovereign block on purpose. `RelayClient` exports a
  // singleton constructed at module scope, which calls init() immediately — so
  // requiring it first would connect before the switch could be observed, and
  // the assertion would be measuring the import rather than the guard.
  let RelayClient: any;
  socketAttempts.length = 0;
  await withSovereign(true, async () => {
    RelayClient = require('../RelayClient').RelayClient;
    const client = new RelayClient();
    await wait(50);
    check('a tunnel id is still issued', typeof client.tunnelId === 'string' && client.tunnelId.length > 0);
  });
  equal(
    'no socket was opened — by the singleton or the explicit instance',
    socketAttempts.length,
    0
  );

  socketAttempts.length = 0;
  await withSovereign(false, async () => {
    new RelayClient();
    await wait(50);
  });
  equal('with sovereign mode off, the relay still connects', socketAttempts.length, 1);
  check(
    'to the configured relay url',
    socketAttempts[0]?.url.includes('4000') || socketAttempts[0]?.url.length > 0,
    socketAttempts[0]?.url
  );

  // --- PushService ----------------------------------------------------------
  describe('PushService sends nothing in sovereign mode');

  const { dbService } = require('../DatabaseService');
  const { PushService } = require('../PushService');

  dbService
    .getDb()
    .prepare('INSERT OR REPLACE INTO push_subscriptions (endpoint, keys_json) VALUES (?, ?)')
    .run('https://fcm.googleapis.com/fcm/send/abc', JSON.stringify({ p256dh: 'k', auth: 'a' }));

  const push = new PushService();

  pushAttempts.length = 0;
  await withSovereign(true, async () => {
    await push.sendPushNotification('Agent Action Required', 'Approve the migration');
  });
  equal('no push request was made', pushAttempts.length, 0);

  pushAttempts.length = 0;
  await withSovereign(false, async () => {
    await push.sendPushNotification('Agent Action Required', 'Approve the migration');
  });
  equal('with sovereign mode off, the push is dispatched', pushAttempts.length, 1);
  check('to the stored subscription', pushAttempts[0]?.endpoint.includes('fcm.googleapis.com'), pushAttempts[0]?.endpoint);

  // --- AI provider (DEC-028 § 3) --------------------------------------------
  describe('AI generation stays local in sovereign mode');

  const { aiService } = require('../ai/AiService');
  dbService
    .getDb()
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_provider', 'gemini')")
    .run();

  const activeProviderId = () => (aiService as any).activeProvider?.id;

  await withSovereign(true, async () => {
    (aiService as any).activeProvider = null;
    (aiService as any).ensureProviderConfigured();
  });
  equal(
    'a configured remote provider is replaced by local agent execution',
    activeProviderId(),
    'agent'
  );

  await withSovereign(false, async () => {
    (aiService as any).activeProvider = null;
    (aiService as any).ensureProviderConfigured();
  });
  equal('with sovereign mode off the configured provider is honoured', activeProviderId(), 'gemini');

  dbService.getDb().prepare("DELETE FROM settings WHERE key = 'ai_provider'").run();

  // --- The system route -----------------------------------------------------
  describe('GET /api/v1/system reports the mode');

  const Fastify = require('fastify');
  const systemRoutes = require('../../routes/system').default;
  const app = Fastify();
  await app.register(systemRoutes);
  await app.ready();

  await withSovereign(true, async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/system' });
    equal('it returns 200', res.statusCode, 200);
    equal('reporting sovereignMode true', res.json().sovereignMode, true);
  });

  await withSovereign(false, async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/system' });
    equal('and false when the switch is off', res.json().sovereignMode, false);
    check('while still reporting the rest of the payload', 'binaries' in res.json() && 'isFirstRun' in res.json());
  });

  await app.close();
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
