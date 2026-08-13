/**
 * record_decision tool tests (P5.1-05).
 *
 * Drives the built binary as a real child process over stdio JSON-RPC, then reopens
 * the SQLite file with an independent connection to confirm what was actually
 * persisted — the tool's own response is not treated as evidence of a write.
 *
 * The fixture is built so the assertions cannot pass for the wrong reason:
 *   - A *second, genuinely registered* project is seeded, so the cross-project
 *     rejection proves a boundary check rather than a "no such project" error.
 *   - The decision count is captured before and after the validation block, so a
 *     rejection that still wrote a row would be caught rather than assumed absent.
 *   - Two decisions are anchored to the same file with different statuses, so the
 *     retrieval integration cannot be satisfied by anchor matching alone.
 *
 * Run:  pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/record_decision.test.ts
 */

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const BINARY = path.join(PACKAGE_ROOT, 'dist', 'index.js');

const PROJECT_ID = 'proj-record-fixture';
const PROJECT_NAME = 'Record Fixture';
const OTHER_PROJECT_ID = 'proj-the-neighbour';
const OTHER_PROJECT_NAME = 'The Neighbour';
const AUTH_FILE = 'src/auth.ts';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-mcp-record-'));
process.env.ASTERIM_DATA_DIR = tmpDir;
delete process.env.ASTERIM_PROJECT_ID;

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

// --- JSON-RPC over stdio ---

interface RpcResponse {
  jsonrpc?: string;
  id?: number;
  error?: { message?: string };
  result?: {
    tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
    isError?: boolean;
    content?: { type?: string; text?: string }[];
  };
}

let child: ChildProcessWithoutNullStreams | null = null;
const stdoutChunks: string[] = [];
const stderrChunks: string[] = [];
const pending = new Map<number, (response: RpcResponse) => void>();
let lineBuffer = '';
let nextId = 1;
let exitedEarly: number | null = null;

function handleLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed: RpcResponse;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return; // stdout purity is asserted separately against the raw chunks.
  }
  if (typeof parsed.id === 'number') {
    pending.get(parsed.id)?.(parsed);
    pending.delete(parsed.id);
  }
}

function send(message: unknown): void {
  child!.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(method: string, params: unknown): Promise<RpcResponse> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timed out waiting for ${method} (id ${id}); stderr: ${stderrChunks.join('').slice(-300)}`));
    }, 10_000);
    pending.set(id, response => {
      clearTimeout(timer);
      resolve(response);
    });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function callTool(name: string, args: Record<string, unknown>): Promise<RpcResponse> {
  return request('tools/call', { name, arguments: args });
}

function payloadOf(response: RpcResponse): Record<string, unknown> | null {
  const text = response.result?.content?.[0]?.text;
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function textOf(response: RpcResponse): string {
  return response.result?.content?.[0]?.text ?? '';
}

/** Records a decision and returns the created object, or null if the call failed. */
async function record(args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const response = await callTool('record_decision', args);
  if (response.result?.isError) return null;
  return (payloadOf(response)?.decision as Record<string, unknown>) ?? null;
}

/** Asserts a record_decision call is rejected in band and that the message explains why. */
async function rejects(label: string, args: Record<string, unknown>, ...needles: string[]): Promise<void> {
  const response = await callTool('record_decision', args);
  const message = textOf(response);
  const missing = needles.filter(n => !message.includes(n));
  check(
    label,
    response.result?.isError === true && missing.length === 0,
    response.result?.isError !== true
      ? `expected isError, got ${message.slice(0, 120)}`
      : `message missing ${missing.join(', ')} — got: ${message}`
  );
}

/** Counts decisions currently visible to the server for the resolved project. */
async function decisionCount(): Promise<number> {
  const response = await callTool('query_decisions', {});
  return ((payloadOf(response)?.decisions as unknown[]) ?? []).length;
}

function cleanup(): void {
  if (child && !child.killed) child.kill('SIGTERM');
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

// --- Test body ---

async function main(): Promise<void> {
  describe('build artifact');
  check('dist/index.js exists (run `pnpm --filter @asterim/mcp-memory-server build` first)', fs.existsSync(BINARY), BINARY);
  if (!fs.existsSync(BINARY)) return;

  // Two real projects. The neighbour exists so that a rejected cross-project write
  // is a boundary check, not an unknown-id lookup failure.
  const insert = dbService.getDb().prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)');
  insert.run(PROJECT_ID, PROJECT_NAME, '/workspace/projects/record-fixture');
  insert.run(OTHER_PROJECT_ID, OTHER_PROJECT_NAME, '/workspace/projects/the-neighbour');
  dbService.getDb().close();

  child = spawn(process.execPath, [BINARY, '--project', PROJECT_ID], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, ASTERIM_DATA_DIR: tmpDir },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdoutChunks.push(chunk);
    lineBuffer += chunk;
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  });
  child.stderr.on('data', c => stderrChunks.push(c));
  child.on('exit', code => {
    exitedEarly = code;
  });

  const init = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'p5.1-05-test', version: '1.0.0' }
  });
  check('the server completed initialize', init.error === undefined, JSON.stringify(init.error));
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  // --- tools/list -----------------------------------------------------------
  describe('tools/list');

  const tools = (await request('tools/list', {})).result?.tools ?? [];
  equal(
    'all three memory tools are advertised',
    tools.map(t => t.name).sort(),
    ['get_project_briefing', 'query_decisions', 'record_decision']
  );

  const tool = tools.find(t => t.name === 'record_decision');
  const schema = tool?.inputSchema ?? {};
  const props = (schema.properties as Record<string, Record<string, unknown>>) ?? {};

  check('record_decision carries a description', typeof tool?.description === 'string' && tool.description.length > 0);
  equal('record_decision declares an object schema', schema.type, 'object');
  equal('title, summary and rationale are required', schema.required, ['title', 'summary', 'rationale']);
  equal(
    'the full parameter set is advertised',
    Object.keys(props).sort(),
    ['codeRefs', 'confidence', 'constraints', 'projectId', 'provenance', 'rationale', 'relatedFiles', 'status', 'summary', 'title']
  );
  equal(
    'the status enum matches the decision lifecycle',
    (props.status?.enum as string[])?.slice().sort(),
    ['ACTIVE', 'ARCHIVED', 'STALE', 'SUPERSEDED']
  );
  equal(
    'the provenance enum matches the domain type',
    (props.provenance?.enum as string[])?.slice().sort(),
    ['AGENT_STATEMENT', 'HUMAN_CONFIRMED', 'INFERRED', 'REPOSITORY_EVIDENCE']
  );
  equal('confidence is bounded at 0', props.confidence?.minimum, 0);
  equal('confidence is bounded at 1', props.confidence?.maximum, 1);
  equal('constraints is an array of strings', (props.constraints?.items as Record<string, unknown>)?.type, 'string');

  // --- Minimal record -------------------------------------------------------
  describe('record_decision — minimal required fields');

  const minimal = await record({
    title: 'Route all writes through ProjectMemoryService',
    summary: 'No package writes memory tables directly.',
    rationale: 'The service is the only place enum validation and transactions live.'
  });
  check('the minimal call succeeds', minimal !== null);

  if (minimal) {
    equal('the decision is scoped to the resolved project', minimal.projectId, PROJECT_ID);
    equal('the title round-trips', minimal.title, 'Route all writes through ProjectMemoryService');
    equal('status defaults to ACTIVE', minimal.status, 'ACTIVE');
    equal('provenance defaults to AGENT_STATEMENT', minimal.provenance, 'AGENT_STATEMENT');
    equal('confidence defaults to 0.75', minimal.confidence, 0.75);
    equal('supersededBy is null on a new decision', minimal.supersededBy, null);
    equal('constraints default to an empty array', minimal.constraints, []);
    equal('relatedFiles default to an empty array', minimal.relatedFiles, []);
    check('the decision carries an id', typeof minimal.id === 'string' && (minimal.id as string).length > 0);
    check('createdAt is a timestamp', typeof minimal.createdAt === 'number' && (minimal.createdAt as number) > 0);
  }

  // --- Full record ----------------------------------------------------------
  describe('record_decision — full field set');

  const full = await record({
    title: 'Hash passwords with Argon2id',
    summary: 'Argon2id, 64 MiB memory cost, 3 iterations.',
    rationale: 'Memory-hard; resists GPU attack in a way bcrypt does not.',
    constraints: ['Never log the derived key', '  ', 'Re-hash on login when parameters change'],
    relatedFiles: [AUTH_FILE, 'src/session.ts'],
    codeRefs: [{ filePath: AUTH_FILE, symbolName: 'hashPassword' }, { symbolName: 'verifyPassword' }],
    confidence: 0.4,
    provenance: 'HUMAN_CONFIRMED'
  });
  check('the full call succeeds', full !== null);

  if (full) {
    equal('an explicit confidence is preserved exactly', full.confidence, 0.4);
    equal('an explicit provenance overrides the agent default', full.provenance, 'HUMAN_CONFIRMED');
    equal('status still defaults to ACTIVE', full.status, 'ACTIVE');
    equal(
      'blank constraints are dropped and the rest keep their order',
      full.constraints,
      ['Never log the derived key', 'Re-hash on login when parameters change']
    );

    const codeRefs = (full.codeRefs ?? []) as { filePath?: string; symbolName?: string }[];
    equal('relatedFiles are folded into code refs without duplicating the anchored path', codeRefs.length, 3);
    equal(
      'the explicit anchor keeps its symbol',
      codeRefs.find(r => r.filePath === AUTH_FILE)?.symbolName,
      'hashPassword'
    );
    check(
      'the symbol-only ref survives without a file path',
      codeRefs.some(r => r.filePath === undefined && r.symbolName === 'verifyPassword')
    );
    check('the second related file becomes its own anchor', codeRefs.some(r => r.filePath === 'src/session.ts'));
    equal(
      'relatedFiles reflects the anchored paths',
      (full.relatedFiles as string[]).slice().sort(),
      [AUTH_FILE, 'src/session.ts']
    );
  }

  // A STALE decision on the same file, so retrieval cannot pass on anchors alone.
  const stale = await record({
    title: 'Hash passwords with bcrypt',
    summary: 'bcrypt at cost factor 12.',
    rationale: 'Superseded by the Argon2id decision.',
    relatedFiles: [AUTH_FILE],
    status: 'STALE'
  });
  check('a decision can be recorded with an explicit non-default status', stale?.status === 'STALE', JSON.stringify(stale?.status));

  // --- Retrieval integration ------------------------------------------------
  describe('recorded decisions are immediately retrievable');

  const byFile = await callTool('query_decisions', { filePath: AUTH_FILE });
  const byFileList = (payloadOf(byFile)?.decisions ?? []) as { id: string }[];
  equal('query_decisions on the anchored file returns one decision', byFileList.length, 1);
  equal('and it is the ACTIVE one', byFileList[0]?.id, full?.id);
  check('the STALE decision on the same file is excluded', !byFileList.some(d => d.id === stale?.id));

  const briefingResponse = await callTool('get_project_briefing', {});
  const briefing = payloadOf(briefingResponse)?.briefing as Record<string, unknown> | undefined;
  const active = (briefing?.activeDecisions ?? []) as { id: string }[];
  equal('the briefing lists both ACTIVE decisions', active.length, 2);
  check('the minimal decision is in the briefing', active.some(d => d.id === minimal?.id));
  check('the full decision is in the briefing', active.some(d => d.id === full?.id));
  check('the STALE decision is not in the briefing', !active.some(d => d.id === stale?.id));

  // --- Project scoping ------------------------------------------------------
  describe('project boundary enforcement');

  const explicitSelf = await record({
    title: 'Explicit self-scoped write',
    summary: 'projectId equal to the resolved project is accepted.',
    rationale: 'The guard rejects mismatches, not explicitness.',
    projectId: PROJECT_ID
  });
  check('an explicit projectId matching the resolved project is accepted', explicitSelf !== null);
  equal('and the decision belongs to that project', explicitSelf?.projectId, PROJECT_ID);

  await rejects(
    'a write aimed at another registered project is rejected',
    {
      title: 'Cross-project write',
      summary: 'Should never be stored.',
      rationale: 'The neighbour is a real project, so this proves a boundary check.',
      projectId: OTHER_PROJECT_ID
    },
    'Cannot record decision for project',
    OTHER_PROJECT_ID,
    PROJECT_ID
  );

  await rejects(
    'a write aimed at an unregistered project is rejected the same way',
    {
      title: 'Write to nowhere',
      summary: 'Should never be stored.',
      rationale: 'The guard does not consult the database.',
      projectId: 'proj-does-not-exist'
    },
    'Cannot record decision for project'
  );

  // --- Validation -----------------------------------------------------------
  describe('input validation');

  const beforeRejections = await decisionCount();

  const body = {
    title: 'Some decision',
    summary: 'Some summary.',
    rationale: 'Some rationale.'
  };

  await rejects('a missing title is rejected', { summary: body.summary, rationale: body.rationale }, "'title' is required");
  await rejects('a missing summary is rejected', { title: body.title, rationale: body.rationale }, "'summary' is required");
  await rejects('a missing rationale is rejected', { title: body.title, summary: body.summary }, "'rationale' is required");
  await rejects('a whitespace-only title is rejected', { ...body, title: '   ' }, "'title' is required");
  await rejects('a non-string title is rejected', { ...body, title: 42 }, "'title' must be a string");

  await rejects('a misspelled status is rejected', { ...body, status: 'active' }, 'Unknown status', 'SUPERSEDED');
  await rejects(
    'a misspelled provenance is rejected',
    { ...body, provenance: 'agent_statement' },
    'Unknown provenance',
    'AGENT_STATEMENT'
  );

  await rejects('a confidence above 1 is rejected rather than clamped', { ...body, confidence: 75 }, 'between 0 and 1', '75');
  await rejects('a negative confidence is rejected', { ...body, confidence: -0.1 }, 'between 0 and 1');
  await rejects('a non-numeric confidence is rejected', { ...body, confidence: 'high' }, "'confidence' must be a finite number");
  // NaN and Infinity are not expressible in JSON — JSON.stringify emits null, which
  // readConfidence treats as absent — so the finiteness guard is unreachable over
  // this transport. It stays because the reader is not transport-specific.

  await rejects('a non-array constraints value is rejected', { ...body, constraints: 'one' }, "'constraints' must be an array");
  await rejects('a non-string constraint entry is rejected', { ...body, constraints: ['ok', 7] }, "'constraints[1]' must be a string");
  await rejects('a non-array codeRefs value is rejected', { ...body, codeRefs: 'src/a.ts' }, "'codeRefs' must be an array");
  await rejects('a non-object codeRef entry is rejected', { ...body, codeRefs: ['src/a.ts'] }, "'codeRefs[0]' must be an object");
  await rejects('an empty codeRef entry is rejected rather than silently dropped', { ...body, codeRefs: [{}] }, "'codeRefs[0]' must set at least one");
  await rejects(
    'a non-string codeRef field is rejected',
    { ...body, codeRefs: [{ filePath: 3 }] },
    "'codeRefs[0].filePath' must be a string"
  );

  const afterRejections = await decisionCount();
  equal('not one rejected call wrote a decision', afterRejections, beforeRejections);

  describe('the transport survives every rejection above');
  check('the server has not exited', exitedEarly === null, `exit code ${exitedEarly}`);
  const stillWorks = await record({
    title: 'Recorded after the rejections',
    summary: 'The server is still serving writes.',
    rationale: 'Proves the rejections were in-band.'
  });
  check('a valid write still succeeds afterwards', stillWorks !== null);

  // --- Direct persistence check ---------------------------------------------
  describe('persistence, read from SQLite directly');

  child.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 300));

  const db = new DatabaseSync(path.join(tmpDir, 'asterim.db'));
  const rows = db
    .prepare('SELECT id, project_id, title, status, provenance, confidence FROM project_decisions ORDER BY created_at ASC, id ASC')
    .all() as unknown as {
    id: string;
    project_id: string;
    title: string;
    status: string;
    provenance: string;
    confidence: number;
  }[];

  equal('five decisions reached the table', rows.length, 5);
  check('every row belongs to the resolved project', rows.every(r => r.project_id === PROJECT_ID));

  const neighbourRows = db
    .prepare('SELECT COUNT(*) AS n FROM project_decisions WHERE project_id = ?')
    .get(OTHER_PROJECT_ID) as unknown as { n: number };
  equal('nothing was written to the neighbouring project', neighbourRows.n, 0);

  const minimalRow = rows.find(r => r.id === minimal?.id);
  equal('the minimal decision persisted its default status', minimalRow?.status, 'ACTIVE');
  equal('the minimal decision persisted its agent provenance', minimalRow?.provenance, 'AGENT_STATEMENT');
  equal('the minimal decision persisted its default confidence', minimalRow?.confidence, 0.75);

  const fullRow = rows.find(r => r.id === full?.id);
  equal('the full decision persisted its explicit confidence', fullRow?.confidence, 0.4);
  equal('the full decision persisted its explicit provenance', fullRow?.provenance, 'HUMAN_CONFIRMED');

  const refRows = db
    .prepare('SELECT file_path, symbol_name FROM decision_code_refs WHERE decision_id = ? ORDER BY created_at ASC, id ASC')
    .all(full?.id as string) as unknown as { file_path: string | null; symbol_name: string | null }[];
  equal('the full decision persisted three code refs', refRows.length, 3);
  check(
    'the anchored file and symbol are on the same row',
    refRows.some(r => r.file_path === AUTH_FILE && r.symbol_name === 'hashPassword')
  );
  check('the symbol-only ref persisted with a null file path', refRows.some(r => r.file_path === null && r.symbol_name === 'verifyPassword'));

  const constraintsRow = db
    .prepare('SELECT constraints_json FROM project_decisions WHERE id = ?')
    .get(full?.id as string) as unknown as { constraints_json: string };
  equal(
    'constraints persisted as JSON without the blank entry',
    JSON.parse(constraintsRow.constraints_json),
    ['Never log the derived key', 'Re-hash on login when parameters change']
  );
  db.close();

  // --- stdout purity --------------------------------------------------------
  describe('stdout purity');

  const raw = stdoutChunks.join('');
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const unparseable = lines.filter(l => {
    try {
      JSON.parse(l);
      return false;
    } catch {
      return true;
    }
  });
  equal('every stdout line parses as JSON', unparseable, []);
  check(
    'no log text leaked into stdout',
    !raw.includes('[Database]') && !raw.includes('[asterim-mcp-memory]'),
    raw.slice(0, 200)
  );
  check(
    'the database log went to stderr instead',
    stderrChunks.join('').includes('[Database] Using database at'),
    'without this the stdout assertions prove nothing'
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
