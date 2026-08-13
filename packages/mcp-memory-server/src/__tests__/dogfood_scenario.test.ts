/**
 * End-to-end dogfood scenario (P5.1-06).
 *
 * Three MCP server processes, spawned and terminated in sequence, exercising the
 * loop the product exists for: an agent session records an architectural decision,
 * a *later, unrelated* session finds it without being told, and a session in a
 * neighbouring project sees none of it and cannot write into it.
 *
 * What makes this different from the per-tool suites: nothing is passed between the
 * sessions. Each is a fresh `node dist/index.js` with its own database handle, its
 * own memory, and no argument naming the project — the working directory is the only
 * link, resolved through `resolveProjectContext` exactly as a real `claude mcp add`
 * invocation would. The project directories are real directories on disk, and
 * Session A starts in a *nested subdirectory* so the resolver's longest-match path
 * is on the critical path of the scenario rather than tested in isolation.
 *
 * Phase 4 probes the user's live ~/.asterim/asterim.db. It runs against a **copy**
 * and asserts the original is byte-identical afterwards — pointing the server at the
 * real file would run DatabaseService.init(), whose ALTER TABLE statements would
 * mutate the user's schema. See § 5 of tasks/current.md.
 *
 * Run:  pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/dogfood_scenario.test.ts
 */

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const BINARY = path.join(PACKAGE_ROOT, 'dist', 'index.js');

const PRIMARY_ID = 'proj-primary';
const PRIMARY_NAME = 'Project Primary';
const NEIGHBOUR_ID = 'proj-neighbour';
const NEIGHBOUR_NAME = 'Project Neighbor';
const JWT_FILE = 'src/auth/jwt.ts';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-dogfood-'));
process.env.ASTERIM_DATA_DIR = tmpDir;
delete process.env.ASTERIM_PROJECT_ID;

// Real directories, so the sessions can be spawned inside them and resolution runs
// the same way it will for a user.
const PRIMARY_PATH = path.join(tmpDir, 'workspaces', 'primary');
const NEIGHBOUR_PATH = path.join(tmpDir, 'workspaces', 'neighbour');
const PRIMARY_NESTED = path.join(PRIMARY_PATH, 'src', 'auth');
fs.mkdirSync(PRIMARY_NESTED, { recursive: true });
fs.mkdirSync(NEIGHBOUR_PATH, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-require-imports -- must load after ASTERIM_DATA_DIR is set; see resolver.test.ts header
const { dbService } = require('asterim/src/services/DatabaseService');

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

// --- A single MCP server process ---

interface RpcResponse {
  id?: number;
  error?: { message?: string };
  result?: {
    tools?: { name: string }[];
    isError?: boolean;
    content?: { type?: string; text?: string }[];
  };
}

/**
 * One agent session: a spawned server process speaking JSON-RPC over stdio.
 *
 * Each instance owns its own child, its own request ids and its own captured
 * streams, so nothing can leak between sessions inside the test either.
 */
class Session {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<number, (r: RpcResponse) => void>();
  private lineBuffer = '';
  private nextId = 1;
  readonly stdout: string[] = [];
  readonly stderr: string[] = [];
  exitCode: number | null = null;

  constructor(
    readonly label: string,
    cwd: string,
    dataDir: string = tmpDir
  ) {
    this.child = spawn(process.execPath, [BINARY], {
      cwd,
      env: { ...process.env, ASTERIM_DATA_DIR: dataDir },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      this.stdout.push(chunk);
      this.lineBuffer += chunk;
      const lines = this.lineBuffer.split('\n');
      this.lineBuffer = lines.pop() ?? '';
      for (const line of lines) this.handleLine(line);
    });
    this.child.stderr.on('data', c => this.stderr.push(c));
    this.child.on('exit', code => {
      this.exitCode = code;
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: RpcResponse;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (typeof parsed.id === 'number') {
      this.pending.get(parsed.id)?.(parsed);
      this.pending.delete(parsed.id);
    }
  }

  request(method: string, params: unknown): Promise<RpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[${this.label}] timed out on ${method}; stderr: ${this.stderr.join('').slice(-300)}`));
      }, 10_000);
      this.pending.set(id, response => {
        clearTimeout(timer);
        resolve(response);
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async handshake(): Promise<RpcResponse> {
    const init = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: `dogfood-${this.label}`, version: '1.0.0' }
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    return init;
  }

  call(name: string, args: Record<string, unknown>): Promise<RpcResponse> {
    return this.request('tools/call', { name, arguments: args });
  }

  /** Parses the JSON payload of a successful tool result. */
  static payload(response: RpcResponse): Record<string, unknown> | null {
    const text = response.result?.content?.[0]?.text;
    if (typeof text !== 'string') return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  static text(response: RpcResponse): string {
    return response.result?.content?.[0]?.text ?? '';
  }

  /** Terminates the process and resolves once it has actually exited. */
  stop(): Promise<number | null> {
    return new Promise(resolve => {
      if (this.exitCode !== null) return resolve(this.exitCode);
      const timer = setTimeout(() => {
        if (process.platform === 'win32') {
          this.child.kill();
        } else {
          this.child.kill('SIGKILL');
        }
        resolve(-1);
      }, 5_000);
      this.child.on('exit', code => {
        clearTimeout(timer);
        resolve(code);
      });
      if (process.platform === 'win32') {
        this.child.kill();
      } else {
        this.child.kill('SIGTERM');
      }
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  /** Every stdout line this session emitted, as raw text. */
  rawStdout(): string {
    return this.stdout.join('');
  }
}

/** Asserts a session's stdout carried protocol frames and nothing else. */
function assertStdoutPurity(session: Session): void {
  const raw = session.rawStdout();
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const bad = lines.filter(l => {
    try {
      return JSON.parse(l).jsonrpc !== '2.0';
    } catch {
      return true;
    }
  });
  equal(`${session.label}: stdout carried only JSON-RPC frames`, bad, []);
  check(
    `${session.label}: no log text reached stdout`,
    !raw.includes('[Database]') && !raw.includes('[asterim-mcp-memory]'),
    raw.slice(0, 160)
  );
}

function cleanup(): void {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// --- Scenario ---

async function main(): Promise<void> {
  describe('fixture');
  check('dist/index.js exists (run `pnpm --filter @asterim/mcp-memory-server build` first)', fs.existsSync(BINARY), BINARY);
  if (!fs.existsSync(BINARY)) return;

  const insert = dbService.getDb().prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)');
  insert.run(PRIMARY_ID, PRIMARY_NAME, PRIMARY_PATH);
  insert.run(NEIGHBOUR_ID, NEIGHBOUR_NAME, NEIGHBOUR_PATH);
  dbService.getDb().close();
  check('two projects are registered and no session has run yet', true);

  // === Phase 1 — Session A ==================================================
  describe('Session A — first agent session in Project Primary');

  const a = new Session('A', PRIMARY_NESTED);
  const aInit = await a.handshake();
  check('Session A completed initialize', aInit.error === undefined, JSON.stringify(aInit.error));
  check(
    'Session A resolved Project Primary from a nested subdirectory, with no --project flag',
    a.stderr.join('').includes(PRIMARY_ID),
    a.stderr.join('').slice(0, 300)
  );

  const aBriefing = Session.payload(await a.call('get_project_briefing', {}))?.briefing as Record<string, unknown>;
  equal('Session A: the project starts with no active decisions', aBriefing?.activeDecisions, []);
  equal('Session A: no architectural rules yet', aBriefing?.architecturalRules, []);
  equal('Session A: no intent yet', aBriefing?.currentIntent, null);
  equal('Session A: the briefing is scoped to Primary', aBriefing?.projectId, PRIMARY_ID);

  const aLookup = await a.call('query_decisions', { filePath: JWT_FILE });
  equal('Session A: nothing is known about the file it is about to change', Session.payload(aLookup)?.decisions, []);

  const aWrite = await a.call('record_decision', {
    title: 'Use Ed25519 for session token signing',
    summary: 'Session tokens are signed with Ed25519 rather than RS256.',
    rationale: 'Smaller keys and signatures, constant-time verification, no parameter negotiation to get wrong.',
    relatedFiles: [JWT_FILE]
  });
  check('Session A recorded its decision', aWrite.result?.isError !== true, Session.text(aWrite));
  const decisionA = Session.payload(aWrite)?.decision as Record<string, unknown>;
  equal('Session A: the decision is attributed to an agent', decisionA?.provenance, 'AGENT_STATEMENT');
  equal('Session A: the decision belongs to Primary', decisionA?.projectId, PRIMARY_ID);

  assertStdoutPurity(a);
  const aExit = await a.stop();
  check('Session A exited cleanly', aExit === 0 || (process.platform === 'win32' && aExit !== -1), `exit code ${aExit}`);

  // === Phase 2 — Session B ==================================================
  describe('Session B — a later, independent session in the same project');

  const b = new Session('B', PRIMARY_PATH);
  const bInit = await b.handshake();
  check('Session B completed initialize', bInit.error === undefined, JSON.stringify(bInit.error));
  check('Session B is a different process from Session A', b.pid !== undefined && b.pid !== a.pid, `A=${a.pid} B=${b.pid}`);
  check(
    'Session B resolved Project Primary from the project root',
    b.stderr.join('').includes(PRIMARY_ID),
    b.stderr.join('').slice(0, 300)
  );

  const bBriefing = Session.payload(await b.call('get_project_briefing', {}))?.briefing as Record<string, unknown>;
  const bActive = (bBriefing?.activeDecisions ?? []) as Record<string, unknown>[];
  equal("Session B sees exactly the decision Session A left behind", bActive.length, 1);
  equal('Session B: it is the same decision, by id', bActive[0]?.id, decisionA?.id);
  equal('Session B: the title survived the process boundary', bActive[0]?.title, 'Use Ed25519 for session token signing');
  equal('Session B: the rationale survived too', bActive[0]?.rationale, decisionA?.rationale);
  equal('Session B: provenance is still AGENT_STATEMENT', bActive[0]?.provenance, 'AGENT_STATEMENT');
  equal('Session B: confidence is still the agent default', bActive[0]?.confidence, 0.75);

  const bLookup = await b.call('query_decisions', { filePath: JWT_FILE });
  const bByFile = (Session.payload(bLookup)?.decisions ?? []) as Record<string, unknown>[];
  equal('Session B: querying the file it is about to change surfaces the decision', bByFile.length, 1);
  equal('Session B: and it is the right one', bByFile[0]?.id, decisionA?.id);

  const bWrite = await b.call('record_decision', {
    title: 'Set 15-minute expiration for session tokens',
    summary: 'Session tokens expire 15 minutes after issue.',
    rationale: 'Bounds the damage from a leaked token without forcing a visible re-login.',
    constraints: ['Rotate signing keys every 30 days'],
    relatedFiles: [JWT_FILE, 'src/auth/session.ts']
  });
  check('Session B recorded a follow-up decision', bWrite.result?.isError !== true, Session.text(bWrite));
  const decisionB = Session.payload(bWrite)?.decision as Record<string, unknown>;
  equal('Session B: the constraint was stored', decisionB?.constraints, ['Rotate signing keys every 30 days']);
  check('Session B: the follow-up is a distinct decision', decisionB?.id !== decisionA?.id);

  assertStdoutPurity(b);
  const bExit = await b.stop();
  check('Session B exited cleanly', bExit === 0 || (process.platform === 'win32' && bExit !== -1), `exit code ${bExit}`);

  // === Phase 3 — Session C ==================================================
  describe('Session C — a session in the neighbouring project');

  const c = new Session('C', NEIGHBOUR_PATH);
  const cInit = await c.handshake();
  check('Session C completed initialize', cInit.error === undefined, JSON.stringify(cInit.error));
  check(
    'Session C resolved Project Neighbor, not Primary',
    c.stderr.join('').includes(NEIGHBOUR_ID) && !c.stderr.join('').includes(PRIMARY_ID),
    c.stderr.join('').slice(0, 300)
  );

  const cBriefing = Session.payload(await c.call('get_project_briefing', {}))?.briefing as Record<string, unknown>;
  equal('Session C: the briefing is scoped to Neighbor', cBriefing?.projectId, NEIGHBOUR_ID);
  equal('Session C: no decisions bled across from Primary', cBriefing?.activeDecisions, []);
  equal('Session C: no rules bled across', cBriefing?.architecturalRules, []);
  equal('Session C: no intent bled across', cBriefing?.currentIntent, null);

  const cLookup = await c.call('query_decisions', { filePath: JWT_FILE });
  equal("Session C: Primary's file path matches nothing here", Session.payload(cLookup)?.decisions, []);

  const cAll = await c.call('query_decisions', {});
  equal('Session C: the neighbouring project has no decisions at all', Session.payload(cAll)?.decisions, []);

  const cCrossWrite = await c.call('record_decision', {
    title: 'Reach into the neighbour',
    summary: 'Should never be stored.',
    rationale: 'Primary is a real, registered project, so this is a boundary check and not a lookup failure.',
    projectId: PRIMARY_ID
  });
  equal('Session C: a write aimed at Primary is rejected', cCrossWrite.result?.isError, true);
  check(
    'Session C: the rejection names both projects',
    Session.text(cCrossWrite).includes(PRIMARY_ID) && Session.text(cCrossWrite).includes(NEIGHBOUR_ID),
    Session.text(cCrossWrite)
  );

  assertStdoutPurity(c);
  const cExit = await c.stop();
  check('Session C exited cleanly', cExit === 0 || (process.platform === 'win32' && cExit !== -1), `exit code ${cExit}`);

  // === Cross-session state, read from SQLite directly =======================
  describe('final state, read straight from SQLite');

  const db = new DatabaseSync(path.join(tmpDir, 'asterim.db'));
  const counts = db
    .prepare('SELECT project_id, COUNT(*) AS n FROM project_decisions GROUP BY project_id')
    .all() as unknown as { project_id: string; n: number }[];
  equal('only one project has decisions', counts.length, 1);
  equal('and it is Primary', counts[0]?.project_id, PRIMARY_ID);
  equal('Primary holds exactly the two decisions the sessions recorded', counts[0]?.n, 2);

  const anchored = db
    .prepare(
      `SELECT COUNT(DISTINCT d.id) AS n
         FROM project_decisions d
         JOIN decision_code_refs r ON r.decision_id = d.id
        WHERE r.file_path = ?`
    )
    .get(JWT_FILE) as unknown as { n: number };
  equal('both decisions are anchored to the shared file', anchored.n, 2);
  db.close();

  // === Phase 4 — live database probe ========================================
  describe('Phase 4 — live ~/.asterim/asterim.db compatibility probe (read-only)');

  const livePath = path.join(os.homedir(), '.asterim', 'asterim.db');
  if (!fs.existsSync(livePath)) {
    console.log(`  SKIP  no live database at ${livePath} — nothing to probe`);
  } else {
    const beforeHash = sha256(livePath);
    const beforeSize = fs.statSync(livePath).size;

    // The server runs against a SNAPSHOT. Pointing it at the real file would run
    // DatabaseService.init(), whose ALTER TABLE statements mutate the schema.
    //
    // The snapshot is taken with VACUUM INTO over a read-only connection rather
    // than by copying files. The live database is in WAL mode, so a plain copy of
    // asterim.db alone would miss every committed transaction still in the -wal,
    // and copying the three files in sequence can tear if the user's own Asterim
    // server writes between the calls. VACUUM INTO reads through one transaction
    // and emits a single consistent file.
    const liveCopyDir = path.join(tmpDir, 'live-copy');
    fs.mkdirSync(liveCopyDir, { recursive: true });
    const snapshot = path.join(liveCopyDir, 'asterim.db');

    const liveDb = new DatabaseSync(livePath, { readOnly: true });

    // Positive control: prove this handle genuinely cannot write, rather than
    // relying on the flag having been passed. Without this, the "unmodified"
    // assertions below could pass simply because nothing happened to try.
    let writeRejected = false;
    try {
      liveDb.exec("INSERT INTO projects (id, name, path) VALUES ('p5.1-06-probe', 'probe', '/tmp/probe')");
    } catch {
      writeRejected = true;
    }
    check('the live database is opened through a handle that rejects writes', writeRejected);

    liveDb.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
    const liveProjects = liveDb.prepare('SELECT id, name, path FROM projects').all() as unknown as {
      id: string;
      name: string;
      path: string;
    }[];
    liveDb.close();

    check('a consistent snapshot was taken without copying WAL files', fs.existsSync(snapshot), snapshot);

    check(`the live database registers ${liveProjects.length} project(s)`, liveProjects.length > 0, 'no projects registered');

    const onDisk = liveProjects.filter(p => {
      try {
        return fs.statSync(path.resolve(p.path)).isDirectory();
      } catch {
        return false;
      }
    });
    console.log(`  INFO  ${onDisk.length}/${liveProjects.length} registered project paths still exist on disk`);

    if (onDisk.length === 0) {
      console.log('  SKIP  no registered project directory exists on this machine — cannot probe CWD resolution');
    } else {
      // Deepest path first: on a machine where one project is an ancestor of the
      // others, this is the case the longest-match rule exists for.
      const target = onDisk.slice().sort((x, y) => path.resolve(y.path).length - path.resolve(x.path).length)[0];
      const probe = new Session('live', path.resolve(target.path), liveCopyDir);
      const probeInit = await probe.handshake();
      check('a session resolves against real registered project paths', probeInit.error === undefined, JSON.stringify(probeInit.error));
      check(
        `the live probe resolved to the most specific project (${target.name})`,
        probe.stderr.join('').includes(target.id),
        probe.stderr.join('').slice(0, 400)
      );

      const liveBriefing = await probe.call('get_project_briefing', {});
      check('get_project_briefing runs against the real schema', liveBriefing.result?.isError !== true, Session.text(liveBriefing).slice(0, 200));
      const lb = Session.payload(liveBriefing)?.briefing as Record<string, unknown> | undefined;
      check('the briefing came back with the expected shape', lb !== undefined && Array.isArray(lb.activeDecisions));
      console.log(
        `  INFO  live briefing: ${(lb?.activeDecisions as unknown[])?.length ?? 0} active decisions, ` +
          `${(lb?.recentAgentWork as unknown[])?.length ?? 0} recent sessions, ` +
          `${(lb?.recentApprovals as unknown[])?.length ?? 0} recent approvals`
      );

      assertStdoutPurity(probe);
      equal('the live probe exited cleanly', await probe.stop(), 0);
    }

    equal('the live database was not modified — size unchanged', fs.statSync(livePath).size, beforeSize);
    equal('the live database was not modified — sha256 unchanged', sha256(livePath), beforeHash);
    check(
      'no rollback journal was left beside the live database',
      !fs.existsSync(`${livePath}-journal`),
      'a rollback journal would mean a write transaction was opened on the original'
    );
    // -wal and -shm are NOT asserted absent: the database is in WAL mode and those
    // files belong to the user's own Asterim server. Their presence says nothing
    // about this probe, which is why the read-only positive control above carries
    // the non-destructiveness claim instead.
    if (fs.existsSync(`${livePath}-wal`)) {
      console.log('  INFO  the live database is in WAL mode; its -wal/-shm files belong to the running Asterim server');
    }
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
