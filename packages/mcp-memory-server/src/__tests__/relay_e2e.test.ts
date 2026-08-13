/**
 * End-to-end proof of the cross-process relay (P5.4-01, DEC-026).
 *
 * Everything real: the Core Fastify server in its own process, a paired Socket.IO
 * client, and the built MCP binary driven over stdio. An agent records a decision
 * in one process, and the assertion is that a browser-equivalent client in a third
 * process is told about it — the claim the whole task exists to make.
 *
 * This is deliberately a standing test rather than a one-off probe. Cross-client
 * sync has been argued by composition in three previous reports (store handles the
 * event + socket registers the listener + a temporary probe once showed delivery);
 * that argument has to be re-derived each time and cannot fail in CI.
 *
 * Run:  pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/relay_e2e.test.ts
 */

import { spawn, ChildProcess } from 'child_process';
import { io, Socket } from 'socket.io-client';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const BINARY = path.join(PACKAGE_ROOT, 'dist', 'index.js');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const SERVER_ENTRY = path.join(REPO_ROOT, 'apps', 'server', 'src', 'index.ts');
// Spawned directly via tsx CLI, cross-platform
const TSX_CLI = require.resolve('tsx/cli');
const PORT = 3987;
const PROJECT_ID = 'proj-relay-e2e';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-relay-e2e-'));
const serverCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-relay-cwd-'));
const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-relay-proj-'));

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

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let core: ChildProcess | null = null;
let socket: Socket | null = null;
let coreLog = '';

function cleanup(): void {
  try {
    socket?.close();
  } catch {
    /* already closed */
  }
  if (core && !core.killed) core.kill('SIGKILL');
  for (const dir of [dataDir, serverCwd, projectDir]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  console.log('\n[cleanup] removed temp directories');
}

/** Runs the MCP binary through one record_decision and resolves its response. */
function recordDecisionViaMcp(title: string): Promise<{ ok: boolean; elapsedMs: number; decisionId?: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [BINARY, '--project', PROJECT_ID], {
      cwd: projectDir,
      env: { ...process.env, ASTERIM_DATA_DIR: dataDir },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let out = '';
    let settled = false;
    const started = Date.now();

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      out += chunk;
      for (const line of out.split('\n')) {
        if (!line.trim() || settled) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === 2) {
            settled = true;
            const elapsedMs = Date.now() - started;
            const isError = message.result?.isError === true;
            let decisionId: string | undefined;
            try {
              decisionId = JSON.parse(message.result.content[0].text).decision.id;
            } catch {
              /* left undefined on failure */
            }
            // Give the fire-and-forget relay a moment to leave the process.
            setTimeout(() => {
              child.kill('SIGTERM');
              resolve({ ok: !isError, elapsedMs, decisionId });
            }, 400);
          }
        } catch {
          /* partial frame */
        }
      }
    });

    child.stdin.write(
      [
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } }
        }),
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'record_decision',
            arguments: { title, summary: 'Recorded over MCP stdio.', rationale: 'Relay verification.' }
          }
        })
      ].join('\n') + '\n'
    );

    setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ ok: false, elapsedMs: Date.now() - started });
    }, 15_000);
  });
}

async function main(): Promise<void> {
  describe('setup');

  check('the MCP binary is built', fs.existsSync(BINARY), BINARY);
  if (!fs.existsSync(BINARY)) return;

  core = spawn(process.execPath, [TSX_CLI, SERVER_ENTRY], {
    cwd: serverCwd,
    env: { ...process.env, ASTERIM_DATA_DIR: dataDir, PORT: String(PORT), MOCK_AGENT: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  core.stdout?.on('data', c => (coreLog += c));
  core.stderr?.on('data', c => (coreLog += c));

  // Readiness is the descriptor itself: it is written immediately after listen()
  // resolves, so its appearance means the port is accepting connections. Polling
  // the artifact beats grepping the child's log, which depends on wording.
  const descriptorFile = path.join(dataDir, 'server.json');
  for (let i = 0; i < 60 && !fs.existsSync(descriptorFile); i++) await wait(500);
  check('the Core server started', fs.existsSync(descriptorFile), coreLog.slice(-400));
  await wait(500);

  // --- The descriptor -------------------------------------------------------
  describe('the Core publishes its loopback descriptor');

  check('server.json exists', fs.existsSync(descriptorFile), descriptorFile);
  const descriptor = JSON.parse(fs.readFileSync(descriptorFile, 'utf8'));
  equal('it points at loopback on the right port', descriptor.url, `http://127.0.0.1:${PORT}`);
  check('it carries a token', typeof descriptor.token === 'string' && descriptor.token.length === 48);
  // Not compared to `core.pid`: the tsx launcher forks the actual node process,
  // so the descriptor's pid is that child's. What matters is that it identifies a
  // process that is alive — signal 0 checks existence without delivering anything.
  const pidIsLive = (() => {
    try {
      process.kill(descriptor.pid, 0);
      return true;
    } catch {
      return false;
    }
  })();
  check('it records a live process id', typeof descriptor.pid === 'number' && descriptor.pid > 0 && pidIsLive, `pid ${descriptor.pid}`);

  const mode = (fs.statSync(descriptorFile).mode & 0o777).toString(8);
  check('and is not world-readable', process.platform === 'win32' || mode === '600', `mode ${mode}`);

  // --- Pair and connect a client -------------------------------------------
  describe('a connected client');

  const pin = fs.readFileSync(path.join(serverCwd, 'pairing_pin.txt'), 'utf8').trim();
  const paired = await fetch(`http://127.0.0.1:${PORT}/api/v1/auth/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });
  check('pairing succeeded', paired.ok, `${paired.status}`);
  const { token } = (await paired.json()) as { token: string };

  const db = new DatabaseSync(path.join(dataDir, 'asterim.db'));
  db.prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)').run(PROJECT_ID, 'Relay E2E', projectDir);
  db.close();

  socket = io(`http://127.0.0.1:${PORT}`, { auth: { token }, transports: ['websocket'] });
  const received: any[] = [];
  socket.on('memory.decision_created', (event: any) => received.push({ at: Date.now(), event }));

  await new Promise<void>((resolve, reject) => {
    socket!.on('connect', () => resolve());
    socket!.on('connect_error', err => reject(err));
    setTimeout(() => reject(new Error('socket connect timeout')), 10_000);
  });
  check('the client connected', socket.connected);
  socket.emit('join_project', PROJECT_ID);
  await wait(400);

  // --- The actual claim -----------------------------------------------------
  describe('an MCP write in another process reaches the client');

  const before = Date.now();
  const recorded = await recordDecisionViaMcp('Relayed from an MCP session');
  check('record_decision succeeded over stdio', recorded.ok);
  check('and returned a decision id', typeof recorded.decisionId === 'string');

  await wait(800);
  equal('the client was told, without polling or reloading', received.length, 1);
  equal('the event is a decision_created', received[0]?.event?.type, 'memory.decision_created');
  equal('scoped to the right project', received[0]?.event?.payload?.projectId, PROJECT_ID);
  equal('carrying the decision the agent recorded', received[0]?.event?.payload?.decision?.id, recorded.decisionId);
  equal('with the title it was given', received[0]?.event?.payload?.decision?.title, 'Relayed from an MCP session');
  equal('and agent provenance preserved end to end', received[0]?.event?.payload?.decision?.provenance, 'AGENT_STATEMENT');
  equal('the Core marks itself as the relay source', received[0]?.event?.source, 'relay:mcp');

  const latency = (received[0]?.at ?? Date.now()) - before;
  check('delivery is prompt, not on a poll interval', latency < 10_000, `${latency}ms end to end including process spawn`);

  // --- With the Core stopped ------------------------------------------------
  describe('the agent is unaffected when the Core is not running');

  socket.close();
  const coreExit = new Promise<void>(res => {
    if (core?.exitCode !== null) return res();
    core?.on('exit', () => res());
  });
  core.kill('SIGTERM');
  await Promise.race([coreExit, wait(3000)]);
  if (core.exitCode === null) {
    try {
      process.kill(core.pid!, 'SIGKILL');
    } catch {}
  }
  await wait(500);

  check(
    'the Core removed its descriptor on shutdown',
    !fs.existsSync(descriptorFile) || process.platform === 'win32',
    'a stale descriptor costs every later write a doomed connection attempt'
  );

  const offline = await recordDecisionViaMcp('Recorded with no Core running');
  check('record_decision still succeeds', offline.ok);
  check('and returns a decision id', typeof offline.decisionId === 'string');

  await wait(500);
  const verifyDb = new DatabaseSync(path.join(dataDir, 'asterim.db'), { readOnly: true });
  const rows = verifyDb
    .prepare('SELECT id, title FROM project_decisions WHERE project_id = ? ORDER BY created_at ASC')
    .all(PROJECT_ID) as unknown as { id: string; title: string }[];
  verifyDb.close();

  equal('both decisions are durable regardless of the relay', rows.length, 2);
  equal('including the one recorded with no Core', rows[1]?.title, 'Recorded with no Core running');
}

main()
  .catch(err => {
    failed++;
    console.error('\nUNCAUGHT ERROR:', err);
    console.error('core log tail:', coreLog.slice(-600));
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
