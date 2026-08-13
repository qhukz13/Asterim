/**
 * Tests for the MCP loopback relay client (P5.4-01).
 *
 * A real HTTP server stands in for the Core, so the happy path exercises an actual
 * socket rather than a mocked `fetch`. The failure paths matter more than the happy
 * one: `record_decision` has already committed by the time this runs, so every way
 * the Core can be unavailable must cost nothing and raise nothing.
 *
 * Run:  pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/relay-client.test.ts
 */

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-relay-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

// eslint-disable-next-line @typescript-eslint/no-require-imports -- must load after ASTERIM_DATA_DIR is set; see resolver.test.ts header
const relay = require('../relay-client');
const { notifyCoreServer, readDescriptor, descriptorPath, LOOPBACK_TOKEN_HEADER, RELAY_TIMEOUT_MS } = relay;

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
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

interface Received {
  url?: string;
  token?: string;
  body: any;
}

/** A stand-in Core server. `delayMs` lets a test outlast the relay's timeout. */
function startFakeCore(options: { token: string; status?: number; delayMs?: number }) {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      received.push({
        url: req.url,
        token: req.headers[LOOPBACK_TOKEN_HEADER] as string | undefined,
        body: (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        })()
      });
      const respond = () => {
        res.writeHead(options.status ?? 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      };
      if (options.delayMs) setTimeout(respond, options.delayMs);
      else respond();
    });
  });
  return new Promise<{ port: number; received: Received[]; close: () => Promise<void> }>(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        received,
        close: () =>
          new Promise<void>(done => {
            server.closeAllConnections?.();
            server.close(() => done());
          })
      });
    });
  });
}

function writeDescriptor(descriptor: unknown): void {
  fs.writeFileSync(descriptorPath(), typeof descriptor === 'string' ? descriptor : JSON.stringify(descriptor));
}

function removeDescriptor(): void {
  try {
    fs.unlinkSync(descriptorPath());
  } catch {
    /* already gone */
  }
}

const event = {
  type: 'memory.decision_created',
  source: 'mcp:asterim-mcp-memory',
  timestamp: 1_700_000_000_000,
  payload: { projectId: 'proj-a', decision: { id: 'dec-1' } }
};

async function main(): Promise<void> {
  describe('descriptorPath');

  equal('it sits beside the database this process opened', descriptorPath(), path.join(tmpDir, 'server.json'));

  describe('readDescriptor');

  removeDescriptor();
  equal('no file means no descriptor', readDescriptor(), null);

  writeDescriptor('{ not json');
  equal('unparseable JSON means no descriptor', readDescriptor(), null);

  writeDescriptor({ url: 'http://127.0.0.1:1', pid: 1 });
  equal('a descriptor without a token is unusable', readDescriptor(), null);

  writeDescriptor({ token: 'abc', pid: 1 });
  equal('a descriptor without a url is unusable', readDescriptor(), null);

  writeDescriptor({ url: '', token: '' });
  equal('empty strings are unusable', readDescriptor(), null);

  writeDescriptor({ url: 'http://127.0.0.1:3000', token: 'tok', pid: 42, startedAt: 1 });
  equal('a complete descriptor is read', readDescriptor()?.token, 'tok');

  // --- The Core is running --------------------------------------------------
  describe('notifyCoreServer — the Core is running');

  const core = await startFakeCore({ token: 'good-token' });
  writeDescriptor({ url: `http://127.0.0.1:${core.port}`, token: 'good-token', pid: 1, startedAt: 1 });

  const delivered = await notifyCoreServer(event);
  equal('it reports success', delivered, true);
  equal('exactly one request was made', core.received.length, 1);
  equal('to the internal endpoint', core.received[0]?.url, '/api/v1/internal/memory-events');
  equal('carrying the descriptor token', core.received[0]?.token, 'good-token');
  equal('and the event type', core.received[0]?.body?.type, 'memory.decision_created');
  equal('and the payload', core.received[0]?.body?.payload?.projectId, 'proj-a');

  const refused = await startFakeCore({ token: 'good-token', status: 401 });
  writeDescriptor({ url: `http://127.0.0.1:${refused.port}`, token: 'stale', pid: 1, startedAt: 1 });
  equal('a rejected relay reports failure rather than throwing', await notifyCoreServer(event), false);
  await refused.close();

  // --- The Core is not running ----------------------------------------------
  describe('notifyCoreServer — the Core is not running');

  removeDescriptor();
  const startedNoFile = Date.now();
  const noFile = await notifyCoreServer(event);
  const elapsedNoFile = Date.now() - startedNoFile;
  equal('with no descriptor it reports failure', noFile, false);
  check(
    'and returns immediately, without attempting a connection',
    elapsedNoFile < 50,
    `${elapsedNoFile}ms — a headless agent must pay nothing for a dashboard that is not open`
  );

  // A descriptor left behind by a Core that has since stopped.
  await core.close();
  writeDescriptor({ url: `http://127.0.0.1:${core.port}`, token: 'good-token', pid: 1, startedAt: 1 });
  const startedRefused = Date.now();
  const connRefused = await notifyCoreServer(event);
  const elapsedRefused = Date.now() - startedRefused;
  equal('a stale descriptor pointing at a dead port reports failure', connRefused, false);
  check(
    'and fails fast rather than waiting out the timeout',
    elapsedRefused < RELAY_TIMEOUT_MS,
    `${elapsedRefused}ms vs ${RELAY_TIMEOUT_MS}ms timeout`
  );

  describe('notifyCoreServer — the Core is unresponsive');

  const slow = await startFakeCore({ token: 'good-token', delayMs: RELAY_TIMEOUT_MS * 4 });
  writeDescriptor({ url: `http://127.0.0.1:${slow.port}`, token: 'good-token', pid: 1, startedAt: 1 });

  const startedSlow = Date.now();
  const timedOut = await notifyCoreServer(event);
  const elapsedSlow = Date.now() - startedSlow;
  equal('a hanging Core reports failure', timedOut, false);
  check(
    'and is abandoned at the timeout, not when the Core eventually answers',
    elapsedSlow < RELAY_TIMEOUT_MS * 2,
    `${elapsedSlow}ms — the agent must not wait on a wedged dashboard`
  );
  check('the request did reach the Core, so the timeout is real', slow.received.length === 1);
  await slow.close();

  describe('notifyCoreServer never throws');

  writeDescriptor({ url: 'http://127.0.0.1:1', token: 'tok', pid: 1, startedAt: 1 });
  let threw = false;
  try {
    await notifyCoreServer(event);
  } catch {
    threw = true;
  }
  check('a connection failure does not surface to the caller', !threw);

  writeDescriptor({ url: 'not-a-url', token: 'tok', pid: 1, startedAt: 1 });
  threw = false;
  try {
    await notifyCoreServer(event);
  } catch {
    threw = true;
  }
  check('a malformed url does not surface to the caller', !threw);
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
