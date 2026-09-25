// The suite exercises routes through fastify.inject() as the local developer user
process.env.ASTERIM_DEV_AUTH_BYPASS = process.env.ASTERIM_DEV_AUTH_BYPASS ?? 'true';

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-system-test-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

const Fastify = require('fastify');
const systemRoutes = require('../system').default;
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

async function run(): Promise<void> {
  const app = Fastify({ logger: false });
  await app.register(authMiddleware);
  await app.register(systemRoutes);

  describe('GET /api/v1/system/providers');
  {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/system/providers',
      remoteAddress: '127.0.0.1'
    });

    equal('status is 200', res.statusCode, 200);
    const body = JSON.parse(res.body);
    check('returns providers array', Array.isArray(body.providers));
    const names = body.providers.map((p: any) => p.name);
    const statuses = body.providers.map((p: any) => p.status);
    check('includes Claude Code', names.includes('Claude Code'));
    check('includes Antigravity preview', names.some((n: string) => n.includes('Antigravity')));
    check('claude provider is stable', statuses.includes('stable'));
    check('aider is not present', !names.some((n: string) => n.toLowerCase().includes('aider')));
  }

  describe('GET /api/v1/system/channel');
  {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/system/channel',
      remoteAddress: '127.0.0.1'
    });

    equal('status is 200', res.statusCode, 200);
    const body = JSON.parse(res.body);
    check('returns channel string', typeof body.channel === 'string');
    check('returns isDev boolean', typeof body.isDev === 'boolean');
  }

  describe('GET /api/v1/system');
  {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/system',
      remoteAddress: '127.0.0.1'
    });

    equal('status is 200', res.statusCode, 200);
    const body = JSON.parse(res.body);
    check('returns binaries object', typeof body.binaries === 'object' && body.binaries !== null);
    check('binaries has claude check', typeof body.binaries.claude === 'boolean');
    check('binaries has antigravity check', typeof body.binaries.antigravity === 'boolean');
    check('binaries does not contain aider', body.binaries.aider === undefined);
  }

  await app.close();
}

run()
  .catch((err) => {
    console.error('Unhandled error during test run:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    cleanup();
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.log('Failures:\n - ' + failures.join('\n - '));
      process.exit(1);
    }
  });
