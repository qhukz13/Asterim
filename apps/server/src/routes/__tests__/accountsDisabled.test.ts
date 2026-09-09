/**
 * The account system must not be a second front door.
 *
 * Asterim authenticates a browser with a six-digit pairing PIN and nothing
 * else (ADR-003). The account system — register, login, refresh, JWTs — belongs
 * to the frozen cloud subsystems, but it shipped in the same binary with its
 * endpoints on the auth middleware's public allow-list.
 *
 * Verified live against the packaged build on 2026-09-09: a POST to
 * `/api/v1/auth/register` from the LAN, with any address and password,
 * returned a JWT; that JWT read the operator's projects and registered an MCP
 * server with an arbitrary command, which is remote code execution with no PIN
 * and no interaction from the operator. `docs/audit/security-audit.md`, S5.
 *
 * These assertions are the fix, written down. If one of them goes red, the
 * pairing PIN is optional again.
 *
 * Run:  pnpm --filter asterim exec tsx src/routes/__tests__/accountsDisabled.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-accounts-'));
process.env.ASTERIM_DATA_DIR = tmpDir;
// Explicitly not set, and not inherited: the whole point is the default.
delete process.env.ASTERIM_ENABLE_ACCOUNTS;
delete process.env.ASTERIM_DEV_AUTH_BYPASS;
delete process.env.ASTERIM_SOVEREIGN_MODE;

const Fastify = require('fastify');
const authRoutes = require('../auth').default;
const projectRoutes = require('../projects').default;
const { authMiddleware } = require('../../middleware/authMiddleware');
const { accountsEnabled } = require('../../services/AccountsFeature');

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

async function build() {
  const app = Fastify();
  await app.register(authMiddleware);
  await app.register(authRoutes);
  await app.register(projectRoutes);
  await app.ready();
  return app;
}

const CREDENTIALS = { email: 'intruder@example.invalid', password: 'Str0ngPassw0rd!x', name: 'Intruder' };
const LAN = '192.168.1.50';

async function main() {
  describe('With accounts off, which is the default');

  equal('accountsEnabled() is false with no environment set', accountsEnabled(), false);

  const app = await build();

  // The three on the middleware's public allow-list answer 404 from the route.
  // `logout` and `me` are not on that list, so the middleware refuses them
  // first with 401 — a different number, the same closed door. Both are
  // asserted rather than collapsed into "not 200", because which one answers
  // says where the request stopped.
  for (const [method, url, expected] of [
    ['POST', '/api/v1/auth/register', 404],
    ['POST', '/api/v1/auth/login', 404],
    ['POST', '/api/v1/auth/refresh', 404],
    ['POST', '/api/v1/auth/logout', 401],
    ['GET', '/api/v1/auth/me', 401]
  ] as [string, string, number][]) {
    const res = await app.inject({
      method,
      url,
      remoteAddress: LAN,
      payload: method === 'GET' ? undefined : CREDENTIALS
    });
    equal(`${method} ${url} is ${expected}`, res.statusCode, expected);
  }

  const registered = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    remoteAddress: LAN,
    payload: CREDENTIALS
  });
  check(
    'registering hands back no token of any kind',
    !/accessToken|refreshToken/.test(registered.body),
    registered.body.slice(0, 160)
  );

  const projects = await app.inject({
    method: 'GET',
    url: '/api/v1/projects',
    remoteAddress: LAN
  });
  equal('a protected route from the LAN without a token is 401', projects.statusCode, 401);

  await app.close();

  describe('An account token minted while accounts were on');

  // A token from a build that had the feature on, or from before it was turned
  // off, must not work either. Turning a feature off has to close the doors it
  // opened, not only stop opening new ones.
  process.env.ASTERIM_ENABLE_ACCOUNTS = 'true';
  const withAccounts = await build();
  const created = await withAccounts.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    remoteAddress: LAN,
    payload: CREDENTIALS
  });
  check('registering works when accounts are enabled', created.statusCode < 400, String(created.statusCode));
  const token = (() => {
    try {
      return JSON.parse(created.body)?.tokens?.accessToken as string | undefined;
    } catch {
      return undefined;
    }
  })();
  check('and returns an access token', typeof token === 'string' && token.length > 0);

  const allowed = await withAccounts.inject({
    method: 'GET',
    url: '/api/v1/projects',
    remoteAddress: LAN,
    headers: { authorization: `Bearer ${token}` }
  });
  equal('that token is accepted while accounts are on', allowed.statusCode, 200);
  await withAccounts.close();

  delete process.env.ASTERIM_ENABLE_ACCOUNTS;
  const withoutAccounts = await build();
  const refused = await withoutAccounts.inject({
    method: 'GET',
    url: '/api/v1/projects',
    remoteAddress: LAN,
    headers: { authorization: `Bearer ${token}` }
  });
  equal('and refused once they are off', refused.statusCode, 401);
  await withoutAccounts.close();

  describe('Sovereign mode overrides the switch');

  process.env.ASTERIM_ENABLE_ACCOUNTS = 'true';
  process.env.ASTERIM_SOVEREIGN_MODE = 'true';
  equal('accountsEnabled() is false in sovereign mode', accountsEnabled(), false);
  delete process.env.ASTERIM_SOVEREIGN_MODE;
  delete process.env.ASTERIM_ENABLE_ACCOUNTS;
}

main()
  .then(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* Windows may still hold the database file; the directory is disposable. */
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failures.length) console.log(`Failed assertions:\n  - ${failures.join('\n  - ')}`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
