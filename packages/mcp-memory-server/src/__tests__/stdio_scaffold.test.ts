/**
 * Stdio protocol scaffold test (P5.1-02).
 *
 * Spawns the built binary as a real child process and speaks JSON-RPC to it over
 * stdin/stdout, which is the only way to prove the property that matters: that
 * `process.stdout` carries protocol frames and nothing else.
 *
 * The test is deliberately built so it cannot pass vacuously. It asserts both
 * halves of the stdio guard:
 *   1. stdout contains only parseable JSON-RPC frames, and
 *   2. stderr *does* contain the `[Database] Using database at …` line.
 * Without (2), a build in which DatabaseService never loaded would also produce a
 * clean stdout and the test would report success while proving nothing.
 *
 * Run:  pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/stdio_scaffold.test.ts
 */

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const BINARY = path.join(PACKAGE_ROOT, 'dist', 'index.js');

/** The subset of a JSON-RPC response this test inspects. */
interface RpcResponse {
  jsonrpc?: string;
  id?: number;
  error?: unknown;
  result?: {
    protocolVersion?: string;
    capabilities?: { tools?: unknown };
    serverInfo?: { name?: string; version?: string };
    tools?: unknown[];
  };
}

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-mcp-stdio-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

// Since P5.1-04 the server resolves a project at startup and exits 1 if it cannot,
// so this test must seed one before spawning. The database is opened here only to
// insert that row, then closed, leaving the child process to open it on its own.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- must load after ASTERIM_DATA_DIR is set
const { dbService } = require('asterim/src/services/DatabaseService');

const FIXTURE_PROJECT_ID = 'proj-stdio-scaffold';

let child: ChildProcessWithoutNullStreams | null = null;

function cleanup(): void {
  if (child && !child.killed) {
    child.kill('SIGTERM');
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

/** Resolves once `predicate` is satisfied, or rejects after `ms`. */
function waitFor(predicate: () => boolean, ms: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (predicate()) {
        clearInterval(poll);
        resolve();
      } else if (Date.now() - started > ms) {
        clearInterval(poll);
        reject(new Error(`timed out after ${ms}ms waiting for ${what}`));
      }
    }, 25);
  });
}

async function main(): Promise<void> {
  describe('build artifact');

  check('dist/index.js exists (run `pnpm --filter @asterim/mcp-memory-server build` first)', fs.existsSync(BINARY), BINARY);
  if (!fs.existsSync(BINARY)) return;

  const source = fs.readFileSync(BINARY, 'utf8');
  equal('the bundle starts with the node shebang', source.split('\n')[0], '#!/usr/bin/env node');
  check('the bundle is marked executable', process.platform === 'win32' || (fs.statSync(BINARY).mode & 0o111) !== 0);
  check('the stdio guard is emitted before the SDK is required', (() => {
    const guard = source.indexOf('new console.Console(process.stderr, process.stderr)');
    const sdk = source.indexOf('@modelcontextprotocol/sdk/server/index.js');
    return guard !== -1 && sdk !== -1 && guard < sdk;
  })());
  check('the stdio guard is emitted before the DatabaseService log', (() => {
    const guard = source.indexOf('new console.Console(process.stderr, process.stderr)');
    const dbLog = source.indexOf('[Database] Using database at');
    return guard !== -1 && dbLog !== -1 && guard < dbLog;
  })());
  check('no Fastify or Socket.IO reached the bundle', !/require\("fastify"\)|require\("socket\.io"\)/.test(source));

  describe('stdio transport handshake');

  dbService
    .getDb()
    .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
    .run(FIXTURE_PROJECT_ID, 'Stdio Scaffold Fixture', '/workspace/projects/stdio-scaffold');
  dbService.getDb().close();

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  child = spawn(process.execPath, [BINARY, '--project', FIXTURE_PROJECT_ID], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, ASTERIM_DATA_DIR: tmpDir },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', c => stdoutChunks.push(c));
  child.stderr.on('data', c => stderrChunks.push(c));

  let exitedEarly: number | null = null;
  child.on('exit', code => {
    exitedEarly = code;
  });

  const frames = () =>
    stdoutChunks
      .join('')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

  const send = (message: unknown) => child!.stdin.write(`${JSON.stringify(message)}\n`);

  // 1. initialize
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  });

  await waitFor(() => frames().length >= 1, 10_000, 'the initialize response');
  check('the server did not exit during handshake', exitedEarly === null, `exit code ${exitedEarly}`);

  const initFrame = frames()[0];
  let initResponse: RpcResponse | null = null;
  try {
    initResponse = JSON.parse(initFrame);
  } catch {
    check('the first stdout line is valid JSON', false, JSON.stringify(initFrame.slice(0, 120)));
  }

  if (initResponse) {
    check('the first stdout line is valid JSON', true);
    equal('the response is JSON-RPC 2.0', initResponse.jsonrpc, '2.0');
    equal('the response correlates to request id 1', initResponse.id, 1);
    check('the response is a result, not an error', initResponse.error === undefined, JSON.stringify(initResponse.error));
    equal('serverInfo.name is asterim-mcp-memory', initResponse.result?.serverInfo?.name, 'asterim-mcp-memory');
    equal('serverInfo.version is 0.1.0', initResponse.result?.serverInfo?.version, '0.1.0');
    check('a protocol version was negotiated', typeof initResponse.result?.protocolVersion === 'string', initResponse.result?.protocolVersion);
    check('tools capability is advertised', initResponse.result?.capabilities?.tools !== undefined, JSON.stringify(initResponse.result?.capabilities));
  }

  // 2. initialized notification, then tools/list
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

  await waitFor(() => frames().length >= 2, 10_000, 'the tools/list response');

  let toolsResponse: RpcResponse | null = null;
  try {
    toolsResponse = JSON.parse(frames()[1]);
  } catch {
    /* asserted below */
  }
  check('tools/list returned a parseable frame', toolsResponse !== null);
  if (toolsResponse) {
    equal('the tools/list response correlates to request id 2', toolsResponse.id, 2);
    check('the tools/list response is a result, not an error', toolsResponse.error === undefined, JSON.stringify(toolsResponse.error));
    // P5.1-02 asserted an empty list here; P5.1-04 registered the retrieval tools.
    // Their behaviour is covered by retrieval_tools.test.ts — this only pins the
    // fact that tools/list answers over the transport at all.
    equal(
      'tools/list reports the registered memory tools',
      (toolsResponse.result?.tools as { name: string }[] | undefined)?.map(t => t.name).sort(),
      ['get_project_briefing', 'query_decisions', 'record_decision']
    );
  }

  describe('stdout purity');

  const allFrames = frames();
  const unparseable = allFrames.filter(line => {
    try {
      JSON.parse(line);
      return false;
    } catch {
      return true;
    }
  });
  equal('every stdout line parses as JSON', unparseable, []);
  check(
    'every stdout frame is a JSON-RPC 2.0 message',
    allFrames.every(l => {
      try {
        return JSON.parse(l).jsonrpc === '2.0';
      } catch {
        return false;
      }
    })
  );
  check(
    'stdout contains no raw log text',
    !stdoutChunks.join('').includes('[Database]') && !stdoutChunks.join('').includes('[asterim-mcp-memory]'),
    JSON.stringify(stdoutChunks.join('').slice(0, 160))
  );

  describe('the guard is actually doing work');

  const stderrText = stderrChunks.join('');
  check(
    'the DatabaseService log was emitted — to stderr',
    stderrText.includes('[Database] Using database at'),
    'if this fails the stdout assertions above prove nothing: the log never fired'
  );
  check('the server announced readiness on stderr', stderrText.includes('ready on stdio'), stderrText.slice(0, 200));
  check(
    'the database was opened inside the temp directory',
    stderrText.includes(tmpDir),
    'ASTERIM_DATA_DIR was not honoured'
  );
  check(
    'the temp database file was created',
    fs.existsSync(path.join(tmpDir, 'asterim.db')),
    'DatabaseService did not run, so the guard was never exercised'
  );

  describe('graceful shutdown');

  const exitCode = await new Promise<number | null>(resolve => {
    child!.on('exit', code => resolve(code));
    if (process.platform === 'win32') {
      child!.kill();
    } else {
      child!.kill('SIGTERM');
    }
    setTimeout(() => resolve(-1), 5_000);
  });
  check('the server exits cleanly on termination', exitCode === 0 || (process.platform === 'win32' && exitCode !== -1), `exit code ${exitCode}`);
  check(
    'shutdown occurred',
    process.platform === 'win32' ? child!.killed : stderrChunks.join('').includes('received SIGTERM'),
    stderrChunks.join('').slice(-200)
  );
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
