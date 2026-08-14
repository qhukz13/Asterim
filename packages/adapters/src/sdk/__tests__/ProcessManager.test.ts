/**
 * Tests for agent subprocess environment sanitization (SEC-01).
 *
 * `sanitizeAgentEnv` is exported and tested directly, and the spawn path is
 * exercised with `node-pty` replaced by a recorder — so the assertions cover both
 * the rule and the fact that `start()` actually applies it. Testing only the pure
 * function would leave "and it is wired in" unverified, which is precisely where
 * a sanitizer stops working.
 *
 * Run:  pnpm --filter @asterim/adapters exec tsx src/sdk/__tests__/ProcessManager.test.ts
 */

import Module from 'module';

// --- node-pty, replaced before ProcessManager imports it ---------------------

interface SpawnCall {
  cmd: string;
  args: string[];
  options: { cwd: string; env: Record<string, string | undefined> };
}
const spawnCalls: SpawnCall[] = [];

const originalLoad = (Module as any)._load;
(Module as any)._load = function patched(request: string, parent: unknown, isMain: boolean) {
  if (request === 'node-pty') {
    return {
      spawn: (cmd: string, args: string[], options: SpawnCall['options']) => {
        spawnCalls.push({ cmd, args, options });
        return {
          onData: () => undefined,
          onExit: () => undefined,
          write: () => undefined,
          kill: () => undefined,
          resize: () => undefined,
          pid: 4242
        };
      }
    };
  }
  return originalLoad.apply(this, [request, parent, isMain]);
};

const { ProcessManager, sanitizeAgentEnv, INHERITABLE_ASTERIM_ENV } = require('../ProcessManager');

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

async function main(): Promise<void> {
  // --- The rule -------------------------------------------------------------
  describe('sanitizeAgentEnv');

  const source = {
    PATH: '/usr/bin',
    HOME: '/home/dev',
    SHELL: '/bin/bash',
    ASTERIM_DATA_DIR: '/home/dev/.asterim',
    ASTERIM_RELAY_URL: 'https://relay.asterim.dev',
    ASTERIM_SOVEREIGN_MODE: 'true',
    ASTERIM_LOOPBACK_TOKEN: 'deadbeef',
    ASTERIM_ANYTHING_ADDED_LATER: 'secret',
    OPENAI_API_KEY: 'sk-user-supplied'
  };
  const clean = sanitizeAgentEnv(source);

  equal('ASTERIM_DATA_DIR survives', clean.ASTERIM_DATA_DIR, '/home/dev/.asterim');
  equal('ASTERIM_RELAY_URL is stripped', clean.ASTERIM_RELAY_URL, undefined);
  equal('ASTERIM_SOVEREIGN_MODE is stripped', clean.ASTERIM_SOVEREIGN_MODE, undefined);
  equal('ASTERIM_LOOPBACK_TOKEN is stripped', clean.ASTERIM_LOOPBACK_TOKEN, undefined);
  equal(
    'a variable nobody has invented yet is stripped',
    clean.ASTERIM_ANYTHING_ADDED_LATER,
    undefined,
    );
  equal('PATH is untouched', clean.PATH, '/usr/bin');
  equal('HOME is untouched', clean.HOME, '/home/dev');
  equal('SHELL is untouched', clean.SHELL, '/bin/bash');
  equal(
    "the user's own API key is not Asterim's to remove",
    clean.OPENAI_API_KEY,
    'sk-user-supplied'
  );

  equal(
    'exactly one ASTERIM_ variable is inheritable',
    [...INHERITABLE_ASTERIM_ENV],
    ['ASTERIM_DATA_DIR']
  );
  check(
    'it is an allow-list, so new variables are private by default',
    sanitizeAgentEnv({ ASTERIM_FUTURE_SECRET: 'x' }).ASTERIM_FUTURE_SECRET === undefined,
    'a deny-list would only cover the names someone remembered'
  );

  equal('the source is not mutated', source.ASTERIM_RELAY_URL, 'https://relay.asterim.dev');
  equal('an empty environment stays empty', sanitizeAgentEnv({}), {});
  equal(
    'a name merely containing ASTERIM_ is untouched',
    sanitizeAgentEnv({ MY_ASTERIM_THING: 'v' }).MY_ASTERIM_THING,
    'v'
  );

  // --- The wiring -----------------------------------------------------------
  describe('ProcessManager.start applies it');

  process.env.ASTERIM_RELAY_URL = 'https://relay.asterim.dev';
  process.env.ASTERIM_SOVEREIGN_MODE = 'true';
  process.env.ASTERIM_DATA_DIR = '/tmp/asterim-test-data';

  spawnCalls.length = 0;
  const manager = new ProcessManager();
  await manager.start({
    cmd: 'claude',
    args: ['--version'],
    cwd: '/tmp',
    onData: () => undefined,
    onExit: () => undefined
  });

  equal('one process was spawned', spawnCalls.length, 1);
  const spawned = spawnCalls[0].options.env;
  equal('the child cannot see the relay url', spawned.ASTERIM_RELAY_URL, undefined);
  equal('nor the sovereign flag', spawned.ASTERIM_SOVEREIGN_MODE, undefined);
  equal('but keeps the data directory', spawned.ASTERIM_DATA_DIR, '/tmp/asterim-test-data');
  equal('and still gets colour', spawned.FORCE_COLOR, '1');
  check('and the rest of the environment', typeof spawned.PATH === 'string' && spawned.PATH.length > 0);

  spawnCalls.length = 0;
  await manager.start({
    cmd: 'claude',
    args: [],
    cwd: '/tmp',
    // An adapter passing a variable explicitly is making a choice; sanitization
    // must not quietly override it.
    env: { ASTERIM_RELAY_URL: 'http://explicit', CUSTOM: 'kept' },
    onData: () => undefined,
    onExit: () => undefined
  });
  const withExplicit = spawnCalls[0].options.env;
  equal('an explicitly passed variable wins over the scrub', withExplicit.ASTERIM_RELAY_URL, 'http://explicit');
  equal('alongside other explicit values', withExplicit.CUSTOM, 'kept');
  equal('and the data directory is still there', withExplicit.ASTERIM_DATA_DIR, '/tmp/asterim-test-data');

  delete process.env.ASTERIM_RELAY_URL;
  delete process.env.ASTERIM_SOVEREIGN_MODE;
}

main()
  .catch(err => {
    failed++;
    console.error('\nUNCAUGHT ERROR:', err);
  })
  .finally(() => {
    (Module as any)._load = originalLoad;
    console.log(`\n${passed}/${passed + failed} assertions passed`);
    if (failures.length > 0) {
      console.log('Failed assertions:');
      for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed === 0 ? 0 : 1);
  });
