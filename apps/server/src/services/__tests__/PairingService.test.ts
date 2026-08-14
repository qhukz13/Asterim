/**
 * Tests for the device pairing brute-force guard (P5.5-01).
 *
 * A 6-digit PIN is only a million wide, so the security of LAN pairing rests
 * entirely on how fast an attacker may guess. Two mechanisms are asserted here:
 * the exponential delay paid before each attempt that follows a failure, and
 * the lockout that stops the client once its consecutive-failure budget is
 * spent. Both are exercised through injected clock and sleeper so the suite
 * does not spend fifteen real minutes proving the cooldown expires; the HTTP
 * section then drives the real singleton through `POST /api/v1/auth/pair` and
 * therefore does pay the real delays (~7.5s for one lockout sequence).
 *
 * Run:  pnpm --filter asterim exec tsx src/services/__tests__/PairingService.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

// Both the database and the pairing PIN file are redirected into a scratch
// directory before anything imports them — PairingService writes
// pairing_pin.txt into the working directory at construction.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-pairing-'));
process.env.ASTERIM_DATA_DIR = tmpDir;
const originalCwd = process.cwd();
process.chdir(tmpDir);

import { PairingService, PairingServiceOptions, pairingService } from '../PairingService';

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
  process.chdir(originalCwd);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * A service whose clock and sleeper are controlled by the test. `slept` records
 * every delay that was awaited, which is how the exponential back-off is
 * observed without waiting for it.
 */
function harness(overrides: PairingServiceOptions = {}) {
  let clock = 1_000_000;
  const slept: number[] = [];
  const service = new PairingService({
    ...overrides,
    now: () => clock,
    sleep: async (ms: number) => {
      slept.push(ms);
      clock += ms;
    }
  });
  return {
    service,
    slept,
    advance: (ms: number) => {
      clock += ms;
    }
  };
}

const CLIENT = '192.168.1.50';
const OTHER_CLIENT = '192.168.1.51';
const WRONG_PIN = '000000';

/** A definitely-wrong PIN of the right shape, whatever the real one is. */
function wrongPin(service: PairingService): string {
  return service.getPin() === WRONG_PIN ? '111111' : WRONG_PIN;
}

async function main(): Promise<void> {
  // --- PIN comparison -------------------------------------------------------
  describe('validatePin');
  {
    const { service } = harness();
    check('accepts the current PIN', service.validatePin(service.getPin()));
    check('rejects a wrong PIN of the same length', !service.validatePin(wrongPin(service)));
    check('rejects a PIN of a different length', !service.validatePin('12345'));
    check('rejects an empty string', !service.validatePin(''));
    check(
      'rejects a non-string without throwing',
      !service.validatePin(undefined as unknown as string)
    );
    check('the generated PIN is 6 digits', /^\d{6}$/.test(service.getPin()));
  }

  // --- Attempt accounting and exponential back-off --------------------------
  describe('attemptPairing — failure counter and back-off');
  {
    const { service, slept } = harness();
    const bad = wrongPin(service);

    const first = await service.attemptPairing(CLIENT, bad);
    equal('the first wrong PIN is rejected with 4 attempts left', first, {
      status: 'invalid',
      remainingAttempts: 4
    });
    equal('and is not delayed', slept, []);

    const second = await service.attemptPairing(CLIENT, bad);
    equal('the second leaves 3', second, { status: 'invalid', remainingAttempts: 3 });
    const third = await service.attemptPairing(CLIENT, bad);
    equal('the third leaves 2', third, { status: 'invalid', remainingAttempts: 2 });
    const fourth = await service.attemptPairing(CLIENT, bad);
    equal('the fourth leaves 1', fourth, { status: 'invalid', remainingAttempts: 1 });

    equal('each retry waits twice as long as the last', slept, [500, 1000, 2000]);
    equal('and the next one would wait 4s', service.getRetryDelayMs(CLIENT), 4000);
    equal('four consecutive failures are recorded', service.getFailedAttempts(CLIENT), 4);
    check('the client is not locked yet', !service.isLocked(CLIENT));
  }

  // --- Lockout --------------------------------------------------------------
  describe('attemptPairing — lockout after 5 consecutive failures');
  {
    const { service, slept } = harness();
    const bad = wrongPin(service);

    for (let i = 0; i < 4; i++) await service.attemptPairing(CLIENT, bad);
    const fifth = await service.attemptPairing(CLIENT, bad);

    equal('the fifth failure locks the client out for 15 minutes', fifth, {
      status: 'locked',
      retryAfterMs: LOCKOUT_MS
    });
    check('isLocked reports the lockout', service.isLocked(CLIENT));
    equal('the fifth attempt paid the 4s delay first', slept, [500, 1000, 2000, 4000]);

    const sleptBefore = slept.length;
    const during = await service.attemptPairing(CLIENT, service.getPin());
    equal('a locked client is refused even with the correct PIN', during.status, 'locked');
    equal('and is refused immediately, without paying a delay', slept.length, sleptBefore);
    check('no token is issued while locked', !('token' in during));
  }

  // --- Concurrent bursts ----------------------------------------------------
  describe('attemptPairing — a parallel burst cannot share one failure slot');
  {
    const { service, slept } = harness();
    const bad = wrongPin(service);

    // Ten guesses fired at once. If the attempt were charged after the delay,
    // every one of them would read the same failure count and the burst would
    // cost the attacker a single recorded failure — ten free guesses per round.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => service.attemptPairing(CLIENT, bad))
    );

    equal(
      'each request in the burst consumes its own attempt',
      results.map(r => r.status),
      [
        'invalid',
        'invalid',
        'invalid',
        'invalid',
        'locked',
        'locked',
        'locked',
        'locked',
        'locked',
        'locked'
      ]
    );
    check('the client ends the burst locked out', service.isLocked(CLIENT));
    equal('and the back-off still ramped across the burst', slept, [500, 1000, 2000, 4000]);
  }

  // --- Lockout is per client ------------------------------------------------
  describe('attemptPairing — isolation between clients');
  {
    const { service } = harness();
    const bad = wrongPin(service);

    for (let i = 0; i < 5; i++) await service.attemptPairing(CLIENT, bad);
    check('the offending client is locked', service.isLocked(CLIENT));
    check('a second client is untouched', !service.isLocked(OTHER_CLIENT));
    equal('and starts with a clean counter', service.getFailedAttempts(OTHER_CLIENT), 0);

    const other = await service.attemptPairing(OTHER_CLIENT, service.getPin());
    equal('so it can still pair', other.status, 'paired');
  }

  // --- Cooldown expiry ------------------------------------------------------
  describe('attemptPairing — the cooldown expires');
  {
    // No back-off here: the sleeper advances the fake clock, and this block
    // measures the cooldown against that clock.
    const { service, advance } = harness({ baseDelayMs: 0 });
    const bad = wrongPin(service);

    for (let i = 0; i < 5; i++) await service.attemptPairing(CLIENT, bad);
    check('locked immediately after the fifth failure', service.isLocked(CLIENT));

    advance(LOCKOUT_MS - 1000);
    check('still locked one second before the cooldown ends', service.isLocked(CLIENT));

    advance(2000);
    check('released once the cooldown has passed', !service.isLocked(CLIENT));
    equal('with the failure counter cleared', service.getFailedAttempts(CLIENT), 0);

    const after = await service.attemptPairing(CLIENT, service.getPin());
    equal('and pairing succeeds again', after.status, 'paired');
  }

  // --- Reset on success -----------------------------------------------------
  describe('attemptPairing — success clears the counter');
  {
    const { service } = harness();
    const bad = wrongPin(service);

    await service.attemptPairing(CLIENT, bad);
    await service.attemptPairing(CLIENT, bad);
    equal('two failures are recorded', service.getFailedAttempts(CLIENT), 2);

    const ok = await service.attemptPairing(CLIENT, service.getPin());
    equal('the correct PIN pairs', ok.status, 'paired');
    check(
      'and issues a token that validates',
      ok.status === 'paired' && service.validateToken(ok.token)
    );
    equal('the failure counter is reset', service.getFailedAttempts(CLIENT), 0);
    equal('so the next attempt is not delayed', service.getRetryDelayMs(CLIENT), 0);

    const next = await service.attemptPairing(CLIENT, bad);
    equal('and the full budget is available again', next, {
      status: 'invalid',
      remainingAttempts: 4
    });
  }

  // --- Failures stop being "consecutive" after the tracking window ----------
  describe('attemptPairing — stale failures are forgotten');
  {
    const { service, advance } = harness();
    const bad = wrongPin(service);

    await service.attemptPairing(CLIENT, bad);
    await service.attemptPairing(CLIENT, bad);
    equal('two failures recorded', service.getFailedAttempts(CLIENT), 2);

    advance(LOCKOUT_MS + 1000);
    equal('forgotten once they fall outside the window', service.getFailedAttempts(CLIENT), 0);
    equal('so no back-off is carried over', service.getRetryDelayMs(CLIENT), 0);
  }

  // --- The REST route -------------------------------------------------------
  describe('POST /api/v1/auth/pair');
  {
    const Fastify = require('fastify');
    const authRoutes = require('../../routes/auth').default;
    const app = Fastify();
    await app.register(authRoutes);
    await app.ready();

    // The route uses the real singleton, whose delays are real time. Reset
    // between blocks so each starts from a clean, undelayed state.
    pairingService.resetAttempts();

    const missing = await app.inject({ method: 'POST', url: '/api/v1/auth/pair', payload: {} });
    equal('a request without a PIN is a 400', missing.statusCode, 400);

    const bad = wrongPin(pairingService);
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/pair',
      payload: { pin: bad }
    });
    equal('a wrong PIN is a 401', rejected.statusCode, 401);
    equal('reporting the remaining budget', rejected.json().remainingAttempts, 4);

    pairingService.resetAttempts();
    const paired = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/pair',
      payload: { pin: pairingService.getPin() }
    });
    equal('the correct PIN is a 200', paired.statusCode, 200);
    check('carrying a valid session token', pairingService.validateToken(paired.json().token));

    // Five consecutive wrong PINs from the same IP. This pays the real
    // back-off — 0 + 500 + 1000 + 2000 + 4000 ms.
    pairingService.resetAttempts();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/pair',
        payload: { pin: bad }
      });
      statuses.push(res.statusCode);
    }
    equal('four 401s then a 429 on the fifth failure', statuses, [401, 401, 401, 401, 429]);

    const locked = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/pair',
      payload: { pin: pairingService.getPin() }
    });
    equal('further requests are 429 even with the correct PIN', locked.statusCode, 429);
    check('no token is handed out', !('token' in locked.json()));
    equal('the response is machine-readable', locked.json().code, 'PAIRING_RATE_LIMITED');
    check(
      'a Retry-After header tells the client when to return',
      Number(locked.headers['retry-after']) > 0
    );

    pairingService.resetAttempts();
    await app.close();
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
