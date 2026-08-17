/**
 * Tests for Release Channel Runtime Isolation (P7-01, DEC-029).
 *
 * The property under test is not "the resolver returns a string" — it is that a
 * process running on the development channel is physically unable to open, write
 * to, or advertise anything belonging to the operator's stable Asterim. So the
 * suite works in four layers:
 *
 *   1. `getAsterimChannel` against every combination of `ASTERIM_CHANNEL` and
 *      `NODE_ENV`, including a misspelled channel — which must NOT be honoured,
 *      because guessing what a typo meant is how a development run ends up
 *      pointed at `~/.asterim`.
 *   2. `resolveDataDir` / `resolvePort` for both channels, and the precedence of
 *      `ASTERIM_DATA_DIR` and `PORT` over the channel defaults. That precedence
 *      is load-bearing: every other suite in this repository sets
 *      `ASTERIM_DATA_DIR` to a temp directory, so breaking it breaks all of them.
 *   3. The real consumers — `DatabaseService`, `ServerRegistry`, `SkillService`,
 *      `DesktopDaemonService` — against a fake `HOME`, asserting that a dev-channel
 *      run creates `~/.asterim-dev` with owner-only permissions and leaves
 *      `~/.asterim` untouched and absent.
 *   4. `GET /api/v1/system/channel` through `fastify.inject()`, so the metadata
 *      the dashboard badges off is the same metadata the resolvers produced.
 *
 * `HOME` is overridden rather than mocked because `os.homedir()` reads it on
 * POSIX; the two home-relative assertions are skipped on Windows, where the
 * permission bits are meaningless anyway.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/__tests__/ChannelIsolation.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-channel-'));
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-home-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

// `require`, not `import`: the service singletons below resolve their paths at
// import time, and an ESM binding would be hoisted above the ASTERIM_DATA_DIR
// assignment — which is the convention every other suite here already follows.
const {
  getAsterimChannel,
  isDevChannel,
  resolveDataDir,
  resolvePort,
  resolveServerVersion,
  describeChannel
} = require('../../utils/channel');
const {
  DATA_DIR_STABLE_NAME,
  DATA_DIR_DEV_NAME,
  DEFAULT_STABLE_PORT,
  DEFAULT_DEV_PORT,
  ASTERIM_CHANNELS,
  DEV_CHANNEL_BADGE_LABEL,
  parseAsterimChannel,
  dataDirNameForChannel,
  defaultPortForChannel
} = require('@asterim/shared');
const { DatabaseService } = require('../DatabaseService');
const { ServerRegistry } = require('../ServerRegistry');
const { globalSkillsDir } = require('../skills/SkillService');
const { DesktopDaemonService } = require('../desktop/DesktopDaemonService');
const Fastify = require('fastify');
const systemRoutes = require('../../routes/system').default;

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
  for (const dir of [tmpDir, fakeHome]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[cleanup] removed ${dir}`);
    } catch (err) {
      console.error(`[cleanup] failed to remove ${dir}:`, (err as Error).message);
    }
  }
}

/**
 * Runs `fn` with the given environment, restoring exactly what was there before.
 *
 * `undefined` deletes the variable rather than setting it to the string
 * "undefined" — the difference between "no override" and a nonsense data
 * directory.
 */
function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/**
 * The same, for work that is not finished when the call returns.
 *
 * `fastify.inject()` hands back a promise and the route handler runs after it,
 * so the synchronous `withEnv` would have already put the environment back by
 * the time the endpoint read it — and the endpoint would answer about the wrong
 * channel.
 */
async function withEnvAsync<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(saved)) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** The environment of a run that has nothing set: no override, no NODE_ENV. */
const BARE = {
  ASTERIM_DATA_DIR: undefined,
  ASTERIM_CHANNEL: undefined,
  NODE_ENV: undefined,
  PORT: undefined,
  HOME: fakeHome,
  USERPROFILE: fakeHome
};

/** Just enough of a `fastify.inject()` reply for the assertions below. */
interface InjectedReply {
  statusCode: number;
  json(): Record<string, unknown>;
}

const isPosix = process.platform !== 'win32';

function modeOf(target: string): number {
  return fs.statSync(target).mode & 0o777;
}

async function main(): Promise<void> {
  // --- Shared constants -----------------------------------------------------
  describe('the channel constants are the two directories and the two ports');

  equal('there are exactly two channels', ASTERIM_CHANNELS, ['stable', 'dev']);
  equal('stable owns ~/.asterim', DATA_DIR_STABLE_NAME, '.asterim');
  equal('dev owns ~/.asterim-dev', DATA_DIR_DEV_NAME, '.asterim-dev');
  check('and they are different directories', DATA_DIR_STABLE_NAME !== DATA_DIR_DEV_NAME);
  equal('stable defaults to 3000', DEFAULT_STABLE_PORT, 3000);
  equal('dev defaults to 3001', DEFAULT_DEV_PORT, 3001);
  check('and they are different ports', DEFAULT_STABLE_PORT !== DEFAULT_DEV_PORT);
  equal('the badge the dashboard renders is named once', DEV_CHANNEL_BADGE_LABEL, 'DEV-CHANNEL');
  equal('dataDirNameForChannel(stable)', dataDirNameForChannel('stable'), '.asterim');
  equal('dataDirNameForChannel(dev)', dataDirNameForChannel('dev'), '.asterim-dev');
  equal('defaultPortForChannel(stable)', defaultPortForChannel('stable'), 3000);
  equal('defaultPortForChannel(dev)', defaultPortForChannel('dev'), 3001);

  // --- parseAsterimChannel --------------------------------------------------
  describe('parseAsterimChannel reads what an operator would have typed');

  equal('stable', parseAsterimChannel('stable'), 'stable');
  equal('dev', parseAsterimChannel('dev'), 'dev');
  equal('development, the NODE_ENV spelling', parseAsterimChannel('development'), 'dev');
  equal('production, the NODE_ENV spelling', parseAsterimChannel('production'), 'stable');
  equal('case and surrounding whitespace are ignored', parseAsterimChannel('  DEV \n'), 'dev');
  equal('a misspelling is not guessed at', parseAsterimChannel('stabel'), null);
  equal('an empty string is not a channel', parseAsterimChannel(''), null);
  equal('undefined is not a channel', parseAsterimChannel(undefined), null);

  // --- getAsterimChannel ----------------------------------------------------
  describe('getAsterimChannel: an explicit channel wins, NODE_ENV decides otherwise');

  equal(
    'ASTERIM_CHANNEL=stable resolves to stable',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'stable' }, getAsterimChannel),
    'stable'
  );
  equal(
    'ASTERIM_CHANNEL=dev resolves to dev',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'dev' }, getAsterimChannel),
    'dev'
  );
  equal(
    'ASTERIM_CHANNEL=stable beats NODE_ENV=development',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'stable', NODE_ENV: 'development' }, getAsterimChannel),
    'stable'
  );
  equal(
    'ASTERIM_CHANNEL=dev beats NODE_ENV=production',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'dev', NODE_ENV: 'production' }, getAsterimChannel),
    'dev'
  );
  equal(
    'no channel and NODE_ENV=development falls back to dev',
    withEnv({ ...BARE, NODE_ENV: 'development' }, getAsterimChannel),
    'dev'
  );
  equal(
    'no channel and NODE_ENV=production is stable',
    withEnv({ ...BARE, NODE_ENV: 'production' }, getAsterimChannel),
    'stable'
  );
  equal(
    'a packaged binary with nothing set is stable',
    withEnv(BARE, getAsterimChannel),
    'stable'
  );
  equal(
    'a misspelled channel is not honoured; NODE_ENV decides',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'devv', NODE_ENV: 'development' }, getAsterimChannel),
    'dev'
  );
  equal(
    'and a misspelled channel with no NODE_ENV is stable, not a new directory',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'stabel' }, getAsterimChannel),
    'stable'
  );
  equal(
    'isDevChannel agrees on dev',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'dev' }, isDevChannel),
    true
  );
  equal(
    'isDevChannel agrees on stable',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'stable' }, isDevChannel),
    false
  );

  // --- resolveDataDir -------------------------------------------------------
  describe('resolveDataDir maps each channel onto its own directory');

  const stableDir = withEnv({ ...BARE, ASTERIM_CHANNEL: 'stable' }, () => resolveDataDir());
  const devDir = withEnv({ ...BARE, ASTERIM_CHANNEL: 'dev' }, () => resolveDataDir());

  equal('stable resolves to ~/.asterim', stableDir, path.join(fakeHome, '.asterim'));
  equal('dev resolves to ~/.asterim-dev', devDir, path.join(fakeHome, '.asterim-dev'));
  check('the two never coincide', stableDir !== devDir);
  check('and dev is not nested inside stable', !devDir.startsWith(stableDir + path.sep));

  equal(
    'an explicit channel argument overrides the ambient one',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'stable' }, () => resolveDataDir('dev')),
    path.join(fakeHome, '.asterim-dev')
  );
  equal(
    'NODE_ENV=development alone is enough to move the directory',
    withEnv({ ...BARE, NODE_ENV: 'development' }, () => resolveDataDir()),
    path.join(fakeHome, '.asterim-dev')
  );

  describe('ASTERIM_DATA_DIR still outranks the channel');

  equal(
    'an override wins on stable',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'stable', ASTERIM_DATA_DIR: tmpDir }, () =>
      resolveDataDir()
    ),
    tmpDir
  );
  equal(
    'an override wins on dev too',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'dev', ASTERIM_DATA_DIR: tmpDir }, () => resolveDataDir()),
    tmpDir
  );
  equal(
    'and it wins over an explicit channel argument',
    withEnv({ ...BARE, ASTERIM_DATA_DIR: tmpDir }, () => resolveDataDir('dev')),
    tmpDir
  );
  equal(
    'a relative override is resolved to an absolute path',
    withEnv({ ...BARE, ASTERIM_DATA_DIR: '.' }, () => resolveDataDir()),
    path.resolve('.')
  );

  // --- resolvePort ----------------------------------------------------------
  describe('resolvePort keeps the two channels off each other’s socket');

  equal(
    'stable listens on 3000',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'stable' }, () => resolvePort()),
    3000
  );
  equal(
    'dev listens on 3001',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'dev' }, () => resolvePort()),
    3001
  );
  equal(
    'an explicit PORT wins on stable',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'stable', PORT: '8080' }, () => resolvePort()),
    8080
  );
  equal(
    'an explicit PORT wins on dev',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'dev', PORT: '8080' }, () => resolvePort()),
    8080
  );
  equal(
    'a non-numeric PORT falls back to the channel default rather than NaN',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'dev', PORT: 'not-a-port' }, () => resolvePort()),
    3001
  );
  equal(
    'an empty PORT is treated as unset',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'dev', PORT: '' }, () => resolvePort()),
    3001
  );

  // --- describeChannel ------------------------------------------------------
  describe('describeChannel is what the REST endpoint and the badge read');

  const version = resolveServerVersion();
  check('the version is a non-empty string', typeof version === 'string' && version.length > 0, version);
  check('and it is not the "could not read the manifest" fallback', version !== '0.0.0', version);

  const devInfo = withEnv({ ...BARE, ASTERIM_CHANNEL: 'dev' }, () => describeChannel());
  equal('a dev run reports the dev channel', devInfo.channel, 'dev');
  equal('with isDev set, so a view need not compare strings', devInfo.isDev, true);
  equal('the dev data directory', devInfo.dataDir, path.join(fakeHome, '.asterim-dev'));
  equal('and the dev port', devInfo.port, 3001);
  equal('carrying the Core version', devInfo.version, version);

  const stableInfo = withEnv({ ...BARE, ASTERIM_CHANNEL: 'stable' }, () => describeChannel());
  equal('a stable run reports the stable channel', stableInfo.channel, 'stable');
  equal('with isDev clear', stableInfo.isDev, false);
  equal('the stable data directory', stableInfo.dataDir, path.join(fakeHome, '.asterim'));
  equal('and the stable port', stableInfo.port, 3000);

  // --- The real consumers ---------------------------------------------------
  describe('every runtime path follows the channel');

  const registry = new ServerRegistry();
  equal(
    'the loopback descriptor is inside the dev directory',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'dev' }, () => registry.filePath),
    path.join(fakeHome, '.asterim-dev', 'server.json')
  );
  equal(
    'and inside the stable directory on stable',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'stable' }, () => registry.filePath),
    path.join(fakeHome, '.asterim', 'server.json')
  );

  equal(
    'the workstation skills directory follows the channel',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'dev' }, () => globalSkillsDir()),
    path.join(fakeHome, '.asterim-dev', 'skills')
  );
  equal(
    'and honours ASTERIM_DATA_DIR like everything else',
    withEnv({ ...BARE, ASTERIM_DATA_DIR: tmpDir }, () => globalSkillsDir()),
    path.join(tmpDir, 'skills')
  );

  const daemon = new DesktopDaemonService({ platform: 'linux', homeDir: fakeHome, env: {} });
  equal(
    'the tray opens the dev dashboard on 3001',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'dev' }, () => daemon.webUrl()),
    'http://localhost:3001'
  );
  equal(
    'and the stable dashboard on 3000',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'stable' }, () => daemon.webUrl()),
    'http://localhost:3000'
  );
  equal(
    'the server log a dev run wrote is looked for in the dev directory',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'dev' }, () => daemon.logFilePath()),
    path.join(fakeHome, '.asterim-dev', 'server.log')
  );
  equal(
    'and never in the stable one',
    withEnv({ ...BARE, ASTERIM_CHANNEL: 'stable' }, () => daemon.logFilePath()),
    path.join(fakeHome, '.asterim', 'server.log')
  );

  // --- Physical isolation ---------------------------------------------------
  describe('a dev-channel database is created owner-only and leaves ~/.asterim alone');

  const devDb = withEnv({ ...BARE, ASTERIM_CHANNEL: 'dev' }, () => new DatabaseService());
  const devDbDir = path.join(fakeHome, '.asterim-dev');

  check('the dev data directory was created', fs.existsSync(devDbDir));
  equal('and the database is inside it', devDb.dbPath, path.join(devDbDir, 'asterim.db'));
  check('the database file exists', fs.existsSync(devDb.dbPath));
  check(
    'the operator’s ~/.asterim was never created',
    !fs.existsSync(path.join(fakeHome, '.asterim')),
    'a dev run must not touch the stable data directory'
  );

  if (isPosix) {
    equal('the directory is owner-only (0700)', modeOf(devDbDir).toString(8), '700');
    equal('and the database file is 0600', modeOf(devDb.dbPath).toString(8), '600');
  } else {
    console.log('  SKIP  permission bits are not POSIX modes on this platform');
  }
  devDb.close();

  describe('a stable-channel database lands in the other directory entirely');

  const stableDb = withEnv({ ...BARE, ASTERIM_CHANNEL: 'stable' }, () => new DatabaseService());
  equal(
    'the stable database is under ~/.asterim',
    stableDb.dbPath,
    path.join(fakeHome, '.asterim', 'asterim.db')
  );
  check('which is a different file from the dev one', stableDb.dbPath !== devDb.dbPath);
  if (isPosix) {
    equal(
      'created owner-only as well',
      modeOf(path.join(fakeHome, '.asterim')).toString(8),
      '700'
    );
  }
  stableDb.close();

  describe('ASTERIM_DATA_DIR keeps pointing a service at a temp directory');

  const overrideDir = path.join(tmpDir, 'explicit');
  const overrideDb = withEnv(
    { ...BARE, ASTERIM_CHANNEL: 'dev', ASTERIM_DATA_DIR: overrideDir },
    () => new DatabaseService()
  );
  equal(
    'the override beats the channel even on dev',
    overrideDb.dbPath,
    path.join(overrideDir, 'asterim.db')
  );
  if (isPosix) {
    equal('and the created directory is still 0700', modeOf(overrideDir).toString(8), '700');
  }
  overrideDb.close();

  // --- REST endpoint --------------------------------------------------------
  describe('GET /api/v1/system/channel reports what the resolvers decided');

  const app = Fastify();
  await app.register(systemRoutes);
  await app.ready();

  const devRes = await withEnvAsync<InjectedReply>({ ...BARE, ASTERIM_CHANNEL: 'dev' }, () =>
    app.inject({ method: 'GET', url: '/api/v1/system/channel' })
  );
  equal('it answers 200', devRes.statusCode, 200);
  const devBody = devRes.json();
  equal('reporting the dev channel', devBody.channel, 'dev');
  equal('with isDev set', devBody.isDev, true);
  equal('the dev data directory', devBody.dataDir, path.join(fakeHome, '.asterim-dev'));
  equal('the dev port', devBody.port, 3001);
  equal('and the Core version', devBody.version, version);

  const stableRes = await withEnvAsync<InjectedReply>({ ...BARE, ASTERIM_CHANNEL: 'stable' }, () =>
    app.inject({ method: 'GET', url: '/api/v1/system/channel' })
  );
  equal('a stable Core answers 200 too', stableRes.statusCode, 200);
  const stableBody = stableRes.json();
  equal('reporting the stable channel', stableBody.channel, 'stable');
  equal('with isDev clear', stableBody.isDev, false);
  equal('the stable data directory', stableBody.dataDir, path.join(fakeHome, '.asterim'));
  equal('and the stable port', stableBody.port, 3000);

  const overrideRes = await withEnvAsync<InjectedReply>({ ...BARE, ASTERIM_DATA_DIR: tmpDir }, () =>
    app.inject({ method: 'GET', url: '/api/v1/system/channel' })
  );
  equal(
    'the endpoint reports the override rather than the channel default',
    overrideRes.json().dataDir,
    tmpDir
  );

  check(
    'nothing the caller sends changes the answer',
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/system/channel',
        headers: { 'x-asterim-channel': 'dev' },
        query: { channel: 'dev', dataDir: '/etc' }
      })
    ).json().dataDir !== '/etc'
  );

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
