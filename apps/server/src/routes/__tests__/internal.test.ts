/**
 * HTTP tests for the loopback relay endpoint (P5.4-01).
 *
 * Requests go through `fastify.inject()`, so routing, the auth middleware and the
 * status-code path are all exercised without binding a port. `remoteAddress` is
 * set explicitly per request, because the loopback check is one of the two things
 * standing in front of an endpoint that publishes onto the EventBus.
 *
 * Run:  pnpm --filter asterim exec tsx src/routes/__tests__/internal.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-internal-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

const Fastify = require('fastify');
const { eventBus } = require('../../services/EventBus');
const { serverRegistry } = require('../../services/ServerRegistry');
const internalRoutes = require('../internal').default;
const { isLoopbackAddress, validateRelayedEvent, LOOPBACK_TOKEN_HEADER } = require('../internal');
const { authMiddleware } = require('../../middleware/authMiddleware');

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

const decisionEvent = (over: Record<string, unknown> = {}) => ({
  id: 'evt-1',
  timestamp: 1_700_000_000_000,
  source: 'mcp:asterim-mcp-memory',
  type: 'memory.decision_created',
  payload: { projectId: 'proj-a', decision: { id: 'dec-1', title: 'T' } },
  ...over
});

async function main(): Promise<void> {
  // --- Pure guards ----------------------------------------------------------
  describe('isLoopbackAddress');

  check('IPv4 loopback', isLoopbackAddress('127.0.0.1'));
  check('anywhere in 127/8', isLoopbackAddress('127.13.2.9'));
  check('IPv6 loopback', isLoopbackAddress('::1'));
  check('IPv4-mapped IPv6, as a dual-stack socket reports it', isLoopbackAddress('::ffff:127.0.0.1'));
  check('a LAN address is not loopback', !isLoopbackAddress('192.168.1.42'));
  check('a mapped LAN address is not loopback', !isLoopbackAddress('::ffff:192.168.1.42'));
  check('a public address is not loopback', !isLoopbackAddress('8.8.8.8'));
  check('an address that merely starts with 1 is not loopback', !isLoopbackAddress('12.7.0.1'));
  check('undefined is not loopback', !isLoopbackAddress(undefined));

  describe('validateRelayedEvent');

  check('a well-formed memory event is accepted', validateRelayedEvent(decisionEvent()).ok);
  check('a non-memory type is refused', !validateRelayedEvent(decisionEvent({ type: 'agent.log' })).ok);
  check('an absent type is refused', !validateRelayedEvent(decisionEvent({ type: undefined })).ok);
  check('a payload without projectId is refused', !validateRelayedEvent(decisionEvent({ payload: { decision: {} } })).ok);
  check('a non-object payload is refused', !validateRelayedEvent(decisionEvent({ payload: 'nope' })).ok);
  check('an array body is refused', !validateRelayedEvent([]).ok);
  check('null is refused', !validateRelayedEvent(null).ok);

  const normalised = validateRelayedEvent(decisionEvent({ source: 'i-am-the-core' }));
  equal(
    'a caller cannot claim to be another source',
    normalised.ok && normalised.event.source,
    'relay:mcp'
  );
  const generated = validateRelayedEvent(decisionEvent({ id: undefined, timestamp: undefined }));
  check('a missing id is generated', generated.ok && typeof generated.event.id === 'string' && generated.event.id.length > 0);
  check('a missing timestamp is stamped', generated.ok && typeof generated.event.timestamp === 'number');

  // --- Over HTTP ------------------------------------------------------------
  describe('POST /api/v1/internal/memory-events');

  const app = Fastify();
  await app.register(authMiddleware);
  await app.register(internalRoutes);
  await app.ready();

  const descriptor = serverRegistry.publish(3999);
  check('publishing writes server.json', fs.existsSync(serverRegistry.filePath));
  check('the descriptor carries a loopback url', descriptor.url.includes('127.0.0.1'));
  check('and a token of usable length', typeof descriptor.token === 'string' && descriptor.token.length === 48);
  equal('and this process id', descriptor.pid, process.pid);

  const relayed: any[] = [];
  const listener = (event: any) => relayed.push(event);
  eventBus.subscribe('memory.decision_created', listener);

  const post = (payload: unknown, headers: Record<string, string> = {}, remoteAddress = '127.0.0.1') =>
    app.inject({
      method: 'POST',
      url: '/api/v1/internal/memory-events',
      payload,
      headers,
      remoteAddress
    });

  const accepted = await post(decisionEvent(), { [LOOPBACK_TOKEN_HEADER]: descriptor.token });
  equal('a valid relayed event returns 200', accepted.statusCode, 200);
  equal('and acknowledges', accepted.json(), { ok: true });
  equal('the event reached the EventBus', relayed.length, 1);
  equal('with its type intact', relayed[0]?.type, 'memory.decision_created');
  equal('and its payload intact', relayed[0]?.payload?.projectId, 'proj-a');
  equal('and the relay recorded as the source', relayed[0]?.source, 'relay:mcp');

  relayed.length = 0;
  const noToken = await post(decisionEvent());
  equal('a request with no token is refused', noToken.statusCode, 401);
  equal('and publishes nothing', relayed.length, 0);

  const wrongToken = await post(decisionEvent(), { [LOOPBACK_TOKEN_HEADER]: 'a'.repeat(48) });
  equal('a wrong token of the right length is refused', wrongToken.statusCode, 401);

  const shortToken = await post(decisionEvent(), { [LOOPBACK_TOKEN_HEADER]: 'short' });
  equal('a token of the wrong length is refused', shortToken.statusCode, 401);

  const prefixToken = await post(decisionEvent(), { [LOOPBACK_TOKEN_HEADER]: descriptor.token.slice(0, -1) + 'x' });
  equal('a token differing in one character is refused', prefixToken.statusCode, 401);
  equal('none of the rejected requests published', relayed.length, 0);

  // The server binds `::`, so this is the case that matters.
  const fromLan = await post(decisionEvent(), { [LOOPBACK_TOKEN_HEADER]: descriptor.token }, '192.168.1.42');
  equal('a request from the LAN is refused even with a valid token', fromLan.statusCode, 403);
  check('and says why', /this machine only/.test(fromLan.json().error));
  equal('and publishes nothing', relayed.length, 0);

  const fromMappedLoopback = await post(
    decisionEvent(),
    { [LOOPBACK_TOKEN_HEADER]: descriptor.token },
    '::ffff:127.0.0.1'
  );
  equal('a dual-stack loopback request is accepted', fromMappedLoopback.statusCode, 200);
  relayed.length = 0;

  const wrongType = await post(decisionEvent({ type: 'agent.log' }), { [LOOPBACK_TOKEN_HEADER]: descriptor.token });
  equal('a non-memory event is refused', wrongType.statusCode, 400);
  check('and says only memory events may be relayed', /memory/.test(wrongType.json().error));
  equal('and nothing is published', relayed.length, 0);

  const noProject = await post(
    decisionEvent({ payload: { decision: {} } }),
    { [LOOPBACK_TOKEN_HEADER]: descriptor.token }
  );
  equal('an event with no projectId is refused', noProject.statusCode, 400);

  // --- Production auth path -------------------------------------------------
  describe('the relay survives NODE_ENV=production');

  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const inProduction = await post(decisionEvent(), { [LOOPBACK_TOKEN_HEADER]: descriptor.token });
  process.env.NODE_ENV = previousEnv;

  equal(
    'the global bearer-token middleware does not 401 the relay',
    inProduction.statusCode,
    200
  );
  check(
    'because internal routes are exempt, not because auth is absent',
    (await app.inject({ method: 'GET', url: '/api/v1/does-not-exist', remoteAddress: '127.0.0.1' })).statusCode === 404
  );

  eventBus.unsubscribe('memory.decision_created', listener);

  // --- Descriptor lifecycle -------------------------------------------------
  describe('descriptor lifecycle');

  const firstToken = descriptor.token;
  const republished = serverRegistry.publish(3999);
  check('restarting mints a new token', republished.token !== firstToken, 'a stale descriptor must not authorise the next process');

  const staleAccepted = await post(decisionEvent(), { [LOOPBACK_TOKEN_HEADER]: firstToken });
  equal('the previous token stops working', staleAccepted.statusCode, 401);

  serverRegistry.clear();
  check('clear removes server.json', !fs.existsSync(serverRegistry.filePath));
  equal('and nothing authorises afterwards', serverRegistry.isAuthorized(republished.token), false);

  const afterClear = await post(decisionEvent(), { [LOOPBACK_TOKEN_HEADER]: republished.token });
  equal('the endpoint refuses everything once cleared', afterClear.statusCode, 401);

  serverRegistry.clear();
  check('clearing twice is safe', !fs.existsSync(serverRegistry.filePath));

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
