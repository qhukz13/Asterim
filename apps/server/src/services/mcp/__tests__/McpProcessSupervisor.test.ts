/**
 * Tests for the MCP Server Manager (P6-01).
 *
 * Real child processes, real SQLite. The processes are `node -e "…"` scripts
 * rather than mocks, because everything worth asserting here — that a pid
 * appears, that stderr reaches the ring buffer, that a SIGTERM-ignoring process
 * is eventually killed, that a crash is distinguishable from a shutdown — is a
 * property of an actual operating-system process and disappears the moment one
 * is faked.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpProcessSupervisor.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-mcp-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

const Fastify = require('fastify');
const { dbService } = require('../../DatabaseService');
const {
  McpProcessSupervisor,
  sanitizeMcpEnv,
  STDERR_BUFFER_LINES
} = require('../McpProcessSupervisor');
const mcpRoutes = require('../../../routes/mcp').default;

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
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const NODE = process.execPath;

/** A child that stays up until it is signalled. */
const STAY_ALIVE = 'setInterval(() => {}, 1000)';

/** A child that writes to stderr, then stays up. */
const NOISY = `
  let n = 0;
  const timer = setInterval(() => { console.error('log line ' + (++n)); }, 5);
  setTimeout(() => clearInterval(timer), 2000);
  setInterval(() => {}, 1000);
`;

/** A child that exits non-zero on its own. */
const CRASHER = "process.stderr.write('fatal: nothing to do\\n'); process.exit(3);";

/**
 * A child that refuses SIGTERM and has to be killed. It announces itself on
 * stderr because the handler is only installed once Node has finished booting
 * and run the script — a SIGTERM sent before that still terminates the process,
 * which is a race the test must not run into.
 */
const STUBBORN =
  "process.on('SIGTERM', () => {}); process.stderr.write('ready\\n'); setInterval(() => {}, 1000);";

/** A child that prints its own environment to stderr as JSON. */
const ENV_DUMP = 'process.stderr.write(JSON.stringify(process.env)); setInterval(() => {}, 1000);';

/** Polls until `predicate` holds or the deadline passes. */
async function until(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(25);
  }
  return predicate();
}

/** True while the process is alive; signal 0 only probes. */
function alive(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  dbService.getDb();
  const supervisor = new McpProcessSupervisor();

  // --- Schema ---------------------------------------------------------------
  describe('the mcp_servers table');
  {
    const table = dbService
      .getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mcp_servers'")
      .get();
    check('is created during database initialisation', Boolean(table));

    const index = dbService
      .getDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_mcp_servers_workspace'"
      )
      .get();
    check('with the workspace index', Boolean(index));
  }

  // --- Environment sanitisation --------------------------------------------
  describe('sanitizeMcpEnv');
  {
    const source = {
      PATH: '/usr/bin',
      HOME: '/home/dev',
      ASTERIM_DATA_DIR: '/home/dev/.asterim',
      ASTERIM_RELAY_URL: 'https://relay.example.com',
      ASTERIM_RELAY_SECRET: 'relay-secret-value',
      RELAY_SECRET: 'relay-secret-value',
      STRIPE_SECRET_KEY: 'sk_live_secret',
      STRIPE_WEBHOOK_SECRET: 'whsec_secret',
      GITHUB_TOKEN: 'ghp_secret',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      DB_PASSWORD: 'hunter2',
      MY_API_KEY: 'key',
      LANG: 'en_US.UTF-8'
    };
    const clean = sanitizeMcpEnv(source);

    equal('PATH is passed through', clean.PATH, '/usr/bin');
    equal('and HOME', clean.HOME, '/home/dev');
    equal('and the locale', clean.LANG, 'en_US.UTF-8');
    equal(
      'ASTERIM_DATA_DIR is kept, so an MCP memory server can find the database',
      clean.ASTERIM_DATA_DIR,
      '/home/dev/.asterim'
    );

    for (const blocked of [
      'ASTERIM_RELAY_URL',
      'ASTERIM_RELAY_SECRET',
      'RELAY_SECRET',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'GITHUB_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'DB_PASSWORD',
      'MY_API_KEY'
    ]) {
      check(`${blocked} never reaches the child`, !(blocked in clean));
    }

    const configured = sanitizeMcpEnv(source, { GITHUB_TOKEN: 'explicitly-granted' });
    equal(
      'a variable the operator sets explicitly is honoured',
      configured.GITHUB_TOKEN,
      'explicitly-granted'
    );
  }

  // --- CRUD -----------------------------------------------------------------
  describe('configuration CRUD');
  let crudId: string;
  {
    const created = await supervisor.saveServer({
      name: 'filesystem',
      command: NODE,
      args: ['-e', STAY_ALIVE],
      env: { EXAMPLE: '1' },
      workspaceId: 'ws_alpha'
    });
    crudId = created.id;

    check('a created server gets an id', created.id.startsWith('mcp_'));
    equal('with the name it was given', created.name, 'filesystem');
    equal('defaulting to stdio', created.transport, 'stdio');
    equal('and enabled', created.isEnabled, true);

    const row = dbService.getDb().prepare('SELECT * FROM mcp_servers WHERE id = ?').get(created.id);
    check('and it is in SQLite', Boolean(row));
    equal('with its args serialised', row.args_json, JSON.stringify(['-e', STAY_ALIVE]));
    equal('and its env', row.env_json, JSON.stringify({ EXAMPLE: '1' }));

    const updated = await supervisor.saveServer(
      { name: 'filesystem-v2', isEnabled: false },
      created.id
    );
    equal('an update renames it', updated.name, 'filesystem-v2');
    equal('and disables it', updated.isEnabled, false);
    equal('without changing the command', updated.command, NODE);
    equal('or the id', updated.id, created.id);
    check('and keeps the creation time', updated.createdAt === created.createdAt);

    await supervisor.saveServer({
      name: 'global-server',
      command: NODE,
      args: ['-e', STAY_ALIVE],
      isGlobal: true
    });
    await supervisor.saveServer({
      name: 'other-workspace',
      command: NODE,
      args: ['-e', STAY_ALIVE],
      workspaceId: 'ws_beta'
    });

    const all = supervisor.listConfigs();
    equal('every server is listed unfiltered', all.length, 3);

    const scoped = supervisor.listConfigs('ws_alpha');
    equal('a workspace sees its own servers and the global ones', scoped.length, 2);
    check(
      'but not another workspace',
      !scoped.some((s: { name: string }) => s.name === 'other-workspace')
    );

    for (const bad of [
      { command: NODE },
      { name: 'no command' },
      { name: 'bad transport', command: NODE, transport: 'carrier-pigeon' },
      { name: 'bad args', command: NODE, args: [1, 2] }
    ]) {
      let code = '';
      try {
        await supervisor.saveServer(bad as never);
      } catch (err) {
        code = (err as { code: string }).code;
      }
      equal(
        `invalid configuration is refused: ${JSON.stringify(bad).slice(0, 40)}`,
        code,
        'INVALID_CONFIG'
      );
    }

    let notFound = '';
    try {
      await supervisor.saveServer({ name: 'x' }, 'mcp_missing');
    } catch (err) {
      notFound = (err as { code: string }).code;
    }
    equal('updating a server that does not exist is NOT_FOUND', notFound, 'NOT_FOUND');
  }

  // --- Starting and stopping -------------------------------------------------
  describe('starting a server');
  let liveId = '';
  {
    const config = await supervisor.saveServer({
      name: 'stay-alive',
      command: NODE,
      args: ['-e', STAY_ALIVE]
    });
    liveId = config.id;

    const started = await supervisor.startServer(liveId);
    equal('the status becomes RUNNING', started.status, 'RUNNING');
    check('a pid is tracked', typeof started.pid === 'number' && started.pid > 0);
    check('and the process really exists', alive(started.pid));
    equal('with no error recorded', started.lastError, null);
    equal('and one start counted', started.startCount, 1);

    const again = await supervisor.startServer(liveId);
    equal('starting an already-running server is a no-op', again.pid, started.pid);
    equal('and does not count a second start', again.startCount, 1);

    const listed = supervisor.listServers().find((s: { id: string }) => s.id === liveId);
    equal('the list reports it as running', listed.status, 'RUNNING');
    check('with an uptime', typeof listed.uptimeSeconds === 'number');
  }

  describe('stopping a server');
  {
    const before = supervisor.getServerStatus(liveId);
    const pid = before.pid;

    const stopped = await supervisor.stopServer(liveId);
    equal('the status becomes STOPPED', stopped.status, 'STOPPED');
    equal('the pid is released', stopped.pid, null);
    check('and the process is gone', await until(() => !alive(pid)));
    equal('a shutdown is not reported as a crash', stopped.lastError, null);

    const idempotent = await supervisor.stopServer(liveId);
    equal('stopping an already-stopped server is harmless', idempotent.status, 'STOPPED');
  }

  describe('restarting a server');
  {
    const first = await supervisor.startServer(liveId);
    const restarted = await supervisor.restartServer(liveId);

    equal('it is running again', restarted.status, 'RUNNING');
    check('under a new pid', restarted.pid !== first.pid);
    check('and the old process is gone', await until(() => !alive(first.pid)));
    equal('the start count reflects both runs', restarted.startCount, 3);

    await supervisor.stopServer(liveId);
  }

  // --- stderr ----------------------------------------------------------------
  describe('the stderr ring buffer');
  {
    const config = await supervisor.saveServer({
      name: 'noisy',
      command: NODE,
      args: ['-e', NOISY]
    });
    await supervisor.startServer(config.id);

    check(
      'stderr from the child is captured',
      await until(() => supervisor.getLogs(config.id).length > 0)
    );

    check(
      'and the buffer stops growing at its limit',
      await until(() => supervisor.getLogs(config.id).length >= STDERR_BUFFER_LINES, 4000)
    );
    await wait(300);
    const logs = supervisor.getLogs(config.id);
    equal(
      `the buffer holds exactly ${STDERR_BUFFER_LINES} lines`,
      logs.length,
      STDERR_BUFFER_LINES
    );
    check('the oldest lines are the ones dropped', !logs.includes('log line 1'));
    check('and the newest are kept', logs[logs.length - 1].startsWith('log line '));
    check(
      'the runtime info carries the same tail',
      supervisor.getServerStatus(config.id).recentStderrLogs.length === STDERR_BUFFER_LINES
    );

    await supervisor.stopServer(config.id);
  }

  // --- Failure modes ---------------------------------------------------------
  describe('a process that crashes');
  {
    const config = await supervisor.saveServer({
      name: 'crasher',
      command: NODE,
      args: ['-e', CRASHER]
    });
    await supervisor.startServer(config.id);

    check(
      'the status becomes CRASHED',
      await until(() => supervisor.getServerStatus(config.id).status === 'CRASHED')
    );
    const info = supervisor.getServerStatus(config.id);
    equal('the exit code is recorded', info.lastExitCode, 3);
    check('with an explanation', (info.lastError || '').includes('exited with code 3'));
    equal('and no pid is left behind', info.pid, null);
    check(
      'the child’s last words are in the log',
      info.recentStderrLogs.includes('fatal: nothing to do')
    );
  }

  describe('a command that does not exist');
  {
    const config = await supervisor.saveServer({
      name: 'ghost',
      command: '/nonexistent/mcp-server-binary',
      args: []
    });
    const started = await supervisor.startServer(config.id);

    equal('the status is ERROR, not CRASHED', started.status, 'ERROR');
    check('with the spawn failure recorded', (started.lastError || '').length > 0);
    equal('and no pid', started.pid, null);
  }

  describe('a process that ignores SIGTERM');
  {
    const config = await supervisor.saveServer({
      name: 'stubborn',
      command: NODE,
      args: ['-e', STUBBORN]
    });
    const started = await supervisor.startServer(config.id);
    const pid = started.pid;
    check('it is running', alive(pid));
    check(
      'and has installed its signal handler',
      await until(() => supervisor.getLogs(config.id).includes('ready'))
    );

    const t0 = Date.now();
    const stopped = await supervisor.stopServer(config.id);
    const elapsed = Date.now() - t0;

    equal('it still ends up STOPPED', stopped.status, 'STOPPED');
    check('the process is gone', await until(() => !alive(pid)));
    check(
      `SIGKILL followed the grace period (took ${elapsed}ms)`,
      elapsed >= 2500 && elapsed < 8000
    );
  }

  describe('a disabled server');
  {
    let code = '';
    try {
      await supervisor.startServer(crudId);
    } catch (err) {
      code = (err as { code: string }).code;
    }
    equal('refuses to start', code, 'SERVER_DISABLED');
  }

  describe('a non-stdio transport');
  {
    const config = await supervisor.saveServer({
      name: 'remote-sse',
      command: 'https://mcp.example.com/sse',
      transport: 'sse'
    });
    let code = '';
    try {
      await supervisor.startServer(config.id);
    } catch (err) {
      code = (err as { code: string }).code;
    }
    equal('is not spawned as a child process', code, 'UNSUPPORTED_TRANSPORT');
    await supervisor.deleteServer(config.id);
  }

  describe('the child environment, observed');
  {
    // Set on this process, then asserted absent from the child's own view of
    // its environment — the sanitiser is checked against reality, not its own
    // return value.
    process.env.STRIPE_SECRET_KEY = 'sk_live_should_not_leak';
    process.env.ASTERIM_RELAY_SECRET = 'relay_should_not_leak';
    process.env.ASTERIM_MCP_TEST_MARKER = 'marker_should_not_leak';

    const config = await supervisor.saveServer({
      name: 'env-dump',
      command: NODE,
      args: ['-e', ENV_DUMP],
      env: { EXPLICIT_VALUE: 'granted' }
    });
    await supervisor.startServer(config.id);
    await until(() => supervisor.getLogs(config.id).length > 0);

    const dumped = JSON.parse(supervisor.getLogs(config.id).join(''));
    check('the child sees PATH', typeof dumped.PATH === 'string');
    equal('and the env its configuration granted', dumped.EXPLICIT_VALUE, 'granted');
    check('but not the Stripe key', !('STRIPE_SECRET_KEY' in dumped));
    check('nor the relay secret', !('ASTERIM_RELAY_SECRET' in dumped));
    check('nor any other internal ASTERIM_ variable', !('ASTERIM_MCP_TEST_MARKER' in dumped));
    equal('while ASTERIM_DATA_DIR is deliberately present', dumped.ASTERIM_DATA_DIR, tmpDir);

    await supervisor.stopServer(config.id);
    await supervisor.deleteServer(config.id);
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.ASTERIM_RELAY_SECRET;
    delete process.env.ASTERIM_MCP_TEST_MARKER;
  }

  // --- Deleting and shutting down ---------------------------------------------
  describe('deleting a server');
  {
    const config = await supervisor.saveServer({
      name: 'to-delete',
      command: NODE,
      args: ['-e', STAY_ALIVE]
    });
    const started = await supervisor.startServer(config.id);
    const pid = started.pid;

    const deleted = await supervisor.deleteServer(config.id);
    equal('the delete is acknowledged', deleted, true);
    check('the running process is stopped first', await until(() => !alive(pid)));
    equal('and the row is gone', supervisor.getConfig(config.id), null);
    equal('deleting it twice is harmless', await supervisor.deleteServer(config.id), false);
  }

  describe('disabling a running server');
  {
    const config = await supervisor.saveServer({
      name: 'to-disable',
      command: NODE,
      args: ['-e', STAY_ALIVE]
    });
    const started = await supervisor.startServer(config.id);
    const pid = started.pid;

    await supervisor.saveServer({ isEnabled: false }, config.id);
    check('stops it, because disabled means not running', await until(() => !alive(pid)));
    equal('and the status agrees', supervisor.getServerStatus(config.id).status, 'STOPPED');

    await supervisor.deleteServer(config.id);
  }

  describe('shutdownAll');
  {
    const ids: string[] = [];
    const pids: (number | null)[] = [];
    for (const name of ['shutdown-a', 'shutdown-b', 'shutdown-c']) {
      const config = await supervisor.saveServer({ name, command: NODE, args: ['-e', STAY_ALIVE] });
      ids.push(config.id);
      pids.push((await supervisor.startServer(config.id)).pid);
    }
    check(
      'three servers are running',
      pids.every(pid => alive(pid))
    );

    await supervisor.shutdownAll();

    check('every child is stopped', await until(() => pids.every(pid => !alive(pid))));
    check(
      'and each is reported as STOPPED',
      ids.every((id: string) => supervisor.getServerStatus(id).status === 'STOPPED')
    );

    for (const id of ids) await supervisor.deleteServer(id);
  }

  // --- The REST surface --------------------------------------------------------
  describe('the MCP routes');
  {
    const app = Fastify();
    // Stands in for authMiddleware, which has its own suites.
    app.addHook(
      'preHandler',
      async (request: { headers: Record<string, unknown>; user?: unknown }) => {
        if (request.headers['x-test-anonymous']) return;
        request.user = { acc: 'acc_dev', sub: 'usr_dev' };
      }
    );
    await app.register(mcpRoutes);
    await app.ready();

    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/mcp/servers',
      headers: { 'x-test-anonymous': '1' }
    });
    equal('an unauthenticated caller is refused', anonymous.statusCode, 401);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/servers',
      payload: { name: 'via-http', command: NODE, args: ['-e', STAY_ALIVE], workspaceId: 'ws_http' }
    });
    equal('a server can be created', created.statusCode, 201);
    const id = created.json().server.id;
    equal('and comes back STOPPED', created.json().server.status, 'STOPPED');

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/servers',
      payload: { name: 'no command' }
    });
    equal('a configuration with no command is a 400', invalid.statusCode, 400);
    equal('with a machine-readable code', invalid.json().code, 'INVALID_CONFIG');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/mcp/servers?workspaceId=ws_http'
    });
    equal('listing by workspace works', list.statusCode, 200);
    check(
      'and includes the new server',
      list.json().servers.some((s: { id: string }) => s.id === id)
    );

    const started = await app.inject({ method: 'POST', url: `/api/v1/mcp/servers/${id}/start` });
    equal('it can be started over HTTP', started.statusCode, 200);
    equal('and reports RUNNING', started.json().server.status, 'RUNNING');
    const httpPid = started.json().server.pid;
    check('with a live pid', alive(httpPid));

    const fetched = await app.inject({ method: 'GET', url: `/api/v1/mcp/servers/${id}` });
    equal('a single server can be fetched', fetched.statusCode, 200);
    equal('with its runtime status', fetched.json().server.status, 'RUNNING');

    const restarted = await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${id}/restart`
    });
    equal('it can be restarted', restarted.statusCode, 200);
    check('under a new pid', restarted.json().server.pid !== httpPid);

    const logs = await app.inject({ method: 'GET', url: `/api/v1/mcp/servers/${id}/logs` });
    equal('logs are retrievable', logs.statusCode, 200);
    check('as an array', Array.isArray(logs.json().logs));

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/mcp/servers/${id}`,
      payload: { name: 'renamed-over-http' }
    });
    equal('it can be renamed', patched.statusCode, 200);
    equal('and the new name comes back', patched.json().server.name, 'renamed-over-http');

    const stopped = await app.inject({ method: 'POST', url: `/api/v1/mcp/servers/${id}/stop` });
    equal('it can be stopped', stopped.statusCode, 200);
    equal('and reports STOPPED', stopped.json().server.status, 'STOPPED');

    const missing = await app.inject({ method: 'GET', url: '/api/v1/mcp/servers/mcp_nope' });
    equal('an unknown id is a 404', missing.statusCode, 404);
    const missingStart = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/servers/mcp_nope/start'
    });
    equal('and so is starting one', missingStart.statusCode, 404);
    const missingLogs = await app.inject({
      method: 'GET',
      url: '/api/v1/mcp/servers/mcp_nope/logs'
    });
    equal('and asking for its logs', missingLogs.statusCode, 404);

    const removed = await app.inject({ method: 'DELETE', url: `/api/v1/mcp/servers/${id}` });
    equal('it can be deleted', removed.statusCode, 200);
    const gone = await app.inject({ method: 'GET', url: `/api/v1/mcp/servers/${id}` });
    equal('and is then unknown', gone.statusCode, 404);

    await app.close();
  }

  await supervisor.shutdownAll();
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
