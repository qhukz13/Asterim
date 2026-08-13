/**
 * Retrieval tool tests (P5.1-04).
 *
 * Drives the built binary as a real child process over stdio JSON-RPC, which is the
 * only way to prove what a client actually sees: tool schemas as advertised, results
 * as framed, and — critically — that a failing tool call returns an in-band error
 * instead of tearing down the transport.
 *
 * The fixture is built so the assertions cannot pass for the wrong reason:
 *   - Both the ACTIVE and the ARCHIVED decision are anchored to `src/auth.ts`, so a
 *     filePath query that ignored status would return two rows, not one.
 *   - The seeded intent is created twice, the first archived by the second, so
 *     `currentIntent` is asserted against a project that has more than one intent row.
 *   - The database is seeded and closed before the server spawns, so every value the
 *     server returns crossed a process boundary.
 *
 * Run:  pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/retrieval_tools.test.ts
 */

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const BINARY = path.join(PACKAGE_ROOT, 'dist', 'index.js');

const PROJECT_ID = 'proj-memory-fixture';
const PROJECT_NAME = 'Memory Fixture';
const PROJECT_PATH = '/workspace/projects/memory-fixture';
const AUTH_FILE = 'src/auth.ts';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-mcp-tools-'));
process.env.ASTERIM_DATA_DIR = tmpDir;
delete process.env.ASTERIM_PROJECT_ID;

// eslint-disable-next-line @typescript-eslint/no-require-imports -- must load after ASTERIM_DATA_DIR is set; see resolver.test.ts header
const { dbService } = require('asterim/src/services/DatabaseService');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- must load after ASTERIM_DATA_DIR is set; see resolver.test.ts header
const { projectMemoryService } = require('asterim/src/services/ProjectMemoryService');

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

interface ToolContent {
  type?: string;
  text?: string;
}

interface RpcResponse {
  jsonrpc?: string;
  id?: number;
  error?: { message?: string };
  result?: {
    tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
    isError?: boolean;
    content?: ToolContent[];
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

/** Sends a request and resolves with its correlated response. */
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

/** Parses the JSON a successful tool result carries in its text content. */
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

function cleanup(): void {
  if (child && !child.killed) child.kill('SIGTERM');
  try {
    dbService.getDb().close();
  } catch {
    /* ignore if already closed */
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

// --- Fixture ---

interface SeededIds {
  activeDecisionId: string;
  archivedDecisionId: string;
  ruleId: string;
  intentId: string;
}

function seed(): SeededIds {
  const db = dbService.getDb();
  db.prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)').run(PROJECT_ID, PROJECT_NAME, PROJECT_PATH);

  // Archived first, so the ACTIVE decision is also the newest — a listing that
  // ignored ORDER BY would still have to put them in this order to pass.
  const archived = projectMemoryService.createDecision({
    projectId: PROJECT_ID,
    title: 'Hash passwords with bcrypt',
    summary: 'bcrypt at cost factor 12.',
    rationale: 'Chosen before Argon2id was available in the runtime.',
    status: 'ARCHIVED',
    provenance: 'HUMAN_CONFIRMED',
    codeRefs: [{ filePath: AUTH_FILE, symbolName: 'hashPassword' }]
  });

  const active = projectMemoryService.createDecision({
    projectId: PROJECT_ID,
    title: 'Hash passwords with Argon2id',
    summary: 'Argon2id, 64 MiB memory cost, 3 iterations.',
    rationale: 'Memory-hard; resists GPU attack in a way bcrypt does not.',
    constraints: ['Never log the derived key', 'Re-hash on login when parameters change'],
    status: 'ACTIVE',
    provenance: 'HUMAN_CONFIRMED',
    codeRefs: [{ filePath: AUTH_FILE, symbolName: 'hashPassword' }]
  });

  const rule = projectMemoryService.createRule({
    projectId: PROJECT_ID,
    title: 'No credentials in the repository',
    statement: 'Secrets are read from the environment; never commit them.',
    severity: 'error',
    scopePattern: '**'
  });

  // Two intents: creating the second archives the first, so currentIntent is
  // asserted against a project whose project_intents table holds more than one row.
  projectMemoryService.createIntent({
    projectId: PROJECT_ID,
    goal: 'Ship the legacy login form',
    constraints: [],
    nonGoals: []
  });
  const intent = projectMemoryService.createIntent({
    projectId: PROJECT_ID,
    goal: 'Migrate authentication to Argon2id',
    constraints: ['No downtime'],
    nonGoals: ['Changing the session format']
  });

  return {
    activeDecisionId: active.id,
    archivedDecisionId: archived.id,
    ruleId: rule.id,
    intentId: intent.id
  };
}

// --- Startup resolution failure (separate process) ---

interface SpawnOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the binary to completion with the given args and captures its streams.
 *
 * `stdinPayload` is written the instant the process starts. That is what makes the
 * ordering of resolution and transport connection observable: a server that connects
 * the transport first will answer this frame on stdout before it discovers the
 * project is unresolvable, so stdout is no longer empty on the failure path.
 */
function runToExit(args: string[], stdinPayload?: unknown, timeoutMs = 10_000): Promise<SpawnOutcome> {
  return new Promise(resolve => {
    const proc = spawn(process.execPath, [BINARY, ...args], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, ASTERIM_DATA_DIR: tmpDir },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    if (stdinPayload !== undefined) {
      proc.stdin.write(`${JSON.stringify(stdinPayload)}\n`);
    }
    let out = '';
    let err = '';
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', c => (out += c));
    proc.stderr.on('data', c => (err += c));
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({ code: -1, stdout: out, stderr: err });
    }, timeoutMs);
    proc.on('exit', code => {
      clearTimeout(timer);
      resolve({ code, stdout: out, stderr: err });
    });
  });
}

// --- Test body ---

async function main(): Promise<void> {
  describe('build artifact');
  check('dist/index.js exists (run `pnpm --filter @asterim/mcp-memory-server build` first)', fs.existsSync(BINARY), BINARY);
  if (!fs.existsSync(BINARY)) return;

  const seeded = seed();
  check('the fixture seeded two decisions with distinct ids', seeded.activeDecisionId !== seeded.archivedDecisionId);
  dbService.getDb().close();

  // --- Startup resolution ---------------------------------------------------
  describe('startup project resolution');

  // An initialize frame is delivered at spawn time, so this also pins the ordering:
  // resolution must happen before the transport connects, or the SDK answers this
  // request on stdout before the process discovers it has no project.
  const badProject = await runToExit(['--project', 'no-such-project'], {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '1.0.0' } }
  });
  equal('an unresolvable --project exits 1', badProject.code, 1);
  equal(
    'nothing is written to stdout when resolution fails, even with a request already queued',
    badProject.stdout,
    ''
  );
  check(
    'the resolution error is reported on stderr',
    badProject.stderr.includes("--project 'no-such-project'") && badProject.stderr.includes('Registered projects:'),
    badProject.stderr.slice(0, 300)
  );
  check(
    'the failure message names the registered project',
    badProject.stderr.includes(PROJECT_NAME),
    badProject.stderr.slice(0, 300)
  );

  // --- Connected server -----------------------------------------------------
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
    clientInfo: { name: 'p5.1-04-test', version: '1.0.0' }
  });
  check('the server completed initialize', init.error === undefined, JSON.stringify(init.error));
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  check(
    'the resolved project is announced on stderr',
    stderrChunks.join('').includes(PROJECT_ID),
    stderrChunks.join('').slice(0, 400)
  );

  // --- tools/list -----------------------------------------------------------
  describe('tools/list');

  const listed = await request('tools/list', {});
  const tools = listed.result?.tools ?? [];
  equal('three tools are advertised', tools.length, 3);
  equal(
    'the tool names are the three memory tools',
    tools.map(t => t.name).sort(),
    ['get_project_briefing', 'query_decisions', 'record_decision']
  );
  check('every tool carries a description', tools.every(t => typeof t.description === 'string' && t.description.length > 0));

  const briefingTool = tools.find(t => t.name === 'get_project_briefing');
  const queryTool = tools.find(t => t.name === 'query_decisions');

  const props = (tool: typeof briefingTool): Record<string, unknown> =>
    (tool?.inputSchema?.properties as Record<string, unknown>) ?? {};

  equal('get_project_briefing declares an object schema', briefingTool?.inputSchema?.type, 'object');
  equal('get_project_briefing accepts projectId', Object.keys(props(briefingTool)).sort(), ['projectId']);
  equal('query_decisions declares an object schema', queryTool?.inputSchema?.type, 'object');
  equal(
    'query_decisions accepts filePath, projectId and status',
    Object.keys(props(queryTool)).sort(),
    ['filePath', 'projectId', 'status']
  );
  equal(
    'the status parameter enumerates the decision lifecycle',
    ((props(queryTool).status as Record<string, unknown>)?.enum as string[])?.slice().sort(),
    ['ACTIVE', 'ARCHIVED', 'STALE', 'SUPERSEDED']
  );
  check(
    'neither retrieval tool declares a required parameter',
    !briefingTool?.inputSchema?.required && !queryTool?.inputSchema?.required
  );

  // --- get_project_briefing -------------------------------------------------
  describe('tools/call — get_project_briefing');

  const briefingResponse = await callTool('get_project_briefing', {});
  check('the call is not an error', briefingResponse.result?.isError !== true, textOf(briefingResponse));
  equal('the result carries one text content block', briefingResponse.result?.content?.length, 1);
  equal('the content block is of type text', briefingResponse.result?.content?.[0]?.type, 'text');

  const briefing = (payloadOf(briefingResponse)?.briefing ?? null) as Record<string, unknown> | null;
  check('the payload is keyed under "briefing"', briefing !== null, textOf(briefingResponse).slice(0, 200));

  if (briefing) {
    equal('the briefing is scoped to the resolved project', briefing.projectId, PROJECT_ID);

    const activeDecisions = briefing.activeDecisions as { id: string; title: string }[];
    equal('exactly one decision is ACTIVE', activeDecisions?.length, 1);
    equal('the ACTIVE decision is the Argon2id one', activeDecisions?.[0]?.id, seeded.activeDecisionId);
    check(
      'the ARCHIVED decision is excluded from the briefing',
      !activeDecisions?.some(d => d.id === seeded.archivedDecisionId)
    );

    const rules = briefing.architecturalRules as { id: string }[];
    equal('the architectural rule is present', rules?.length, 1);
    equal('the rule is the seeded one', rules?.[0]?.id, seeded.ruleId);

    const intent = briefing.currentIntent as { id: string; goal: string } | null;
    equal('the current intent is the most recent one', intent?.id, seeded.intentId);
    equal('the superseded intent is not returned', intent?.goal, 'Migrate authentication to Argon2id');

    equal('recentAgentWork is an empty array for an unused project', briefing.recentAgentWork, []);
    equal('recentApprovals is an empty array for an unused project', briefing.recentApprovals, []);
  }

  const briefingAgain = await callTool('get_project_briefing', {});
  equal(
    'two briefings of an unchanged database are byte-identical',
    textOf(briefingAgain),
    textOf(briefingResponse)
  );

  const explicitProject = await callTool('get_project_briefing', { projectId: PROJECT_ID });
  equal('an explicit projectId matching the resolved one returns the same briefing', textOf(explicitProject), textOf(briefingResponse));

  const unknownProject = await callTool('get_project_briefing', { projectId: 'proj-does-not-exist' });
  check('a briefing for an unknown project is not an error', unknownProject.result?.isError !== true, textOf(unknownProject));
  const emptyBriefing = payloadOf(unknownProject)?.briefing as Record<string, unknown> | undefined;
  equal('an unknown project yields no active decisions', emptyBriefing?.activeDecisions, []);
  equal('an unknown project yields no rules', emptyBriefing?.architecturalRules, []);
  equal('an unknown project yields a null intent', emptyBriefing?.currentIntent, null);

  // --- query_decisions ------------------------------------------------------
  describe('tools/call — query_decisions');

  const byFile = await callTool('query_decisions', { filePath: AUTH_FILE });
  check('the filePath query is not an error', byFile.result?.isError !== true, textOf(byFile));
  const byFileDecisions = payloadOf(byFile)?.decisions as { id: string; status: string }[] | undefined;
  equal('the payload is keyed under "decisions"', Array.isArray(byFileDecisions), true);
  equal('only the ACTIVE decision anchored to the file is returned', byFileDecisions?.length, 1);
  equal('it is the Argon2id decision', byFileDecisions?.[0]?.id, seeded.activeDecisionId);
  check(
    'the ARCHIVED decision anchored to the same file is excluded',
    !byFileDecisions?.some(d => d.id === seeded.archivedDecisionId),
    'both fixture decisions reference src/auth.ts, so this proves status filtering'
  );
  equal(
    'the returned decision carries its code refs',
    (byFileDecisions?.[0] as unknown as { codeRefs?: { filePath?: string }[] })?.codeRefs?.[0]?.filePath,
    AUTH_FILE
  );

  const unanchored = await callTool('query_decisions', { filePath: 'src/nowhere.ts' });
  equal('a file with no decisions returns an empty array', payloadOf(unanchored)?.decisions, []);

  const activeOnly = await callTool('query_decisions', { status: 'ACTIVE' });
  const activeList = payloadOf(activeOnly)?.decisions as { id: string }[] | undefined;
  equal('status ACTIVE returns one decision', activeList?.length, 1);
  equal('status ACTIVE returns the Argon2id decision', activeList?.[0]?.id, seeded.activeDecisionId);

  const archivedOnly = await callTool('query_decisions', { status: 'ARCHIVED' });
  const archivedList = payloadOf(archivedOnly)?.decisions as { id: string }[] | undefined;
  equal('status ARCHIVED returns one decision', archivedList?.length, 1);
  equal('status ARCHIVED returns the bcrypt decision', archivedList?.[0]?.id, seeded.archivedDecisionId);

  const staleOnly = await callTool('query_decisions', { status: 'STALE' });
  equal('a status with no matches returns an empty array', payloadOf(staleOnly)?.decisions, []);

  const allDecisions = await callTool('query_decisions', {});
  const allList = payloadOf(allDecisions)?.decisions as { id: string }[] | undefined;
  equal('no filter returns every decision', allList?.length, 2);
  equal('decisions are returned newest first', allList?.[0]?.id, seeded.activeDecisionId);

  const filePathWins = await callTool('query_decisions', { filePath: AUTH_FILE, status: 'ARCHIVED' });
  const filePathWinsList = payloadOf(filePathWins)?.decisions as { id: string }[] | undefined;
  equal('filePath takes precedence over status', filePathWinsList?.length, 1);
  equal('and returns the ACTIVE decision, per findRelevantDecisions', filePathWinsList?.[0]?.id, seeded.activeDecisionId);

  const otherProject = await callTool('query_decisions', { projectId: 'proj-does-not-exist' });
  check('querying an unknown project is not an error', otherProject.result?.isError !== true, textOf(otherProject));
  equal('an unknown project has no decisions', payloadOf(otherProject)?.decisions, []);

  // --- Error handling -------------------------------------------------------
  describe('error handling');

  // Must be a name no tool will ever claim. This probe was `record_decision` until
  // P5.1-05 registered it, at which point the call still returned isError — for a
  // missing title — and the assertion silently stopped testing dispatch.
  const unknownTool = await callTool('forget_everything', {});
  equal('an unknown tool returns isError', unknownTool.result?.isError, true);
  check('the unknown-tool message names the tool', textOf(unknownTool).includes('forget_everything'), textOf(unknownTool));
  check('an unknown tool is not a JSON-RPC protocol error', unknownTool.error === undefined, JSON.stringify(unknownTool.error));

  const badStatus = await callTool('query_decisions', { status: 'active' });
  equal('a misspelled status returns isError rather than an empty list', badStatus.result?.isError, true);
  check(
    'the message lists the valid statuses',
    textOf(badStatus).includes('ACTIVE') && textOf(badStatus).includes('SUPERSEDED'),
    textOf(badStatus)
  );

  const badType = await callTool('query_decisions', { filePath: 42 });
  equal('a non-string argument returns isError', badType.result?.isError, true);
  check('the message names the offending parameter', textOf(badType).includes('filePath'), textOf(badType));

  const emptyProjectId = await callTool('query_decisions', { projectId: '   ' });
  check('a blank projectId falls back to the resolved project', emptyProjectId.result?.isError !== true, textOf(emptyProjectId));
  equal('and returns that project\'s decisions', (payloadOf(emptyProjectId)?.decisions as unknown[])?.length, 2);

  describe('the transport survives every failure above');

  check('the server has not exited', exitedEarly === null, `exit code ${exitedEarly}`);
  const afterErrors = await callTool('get_project_briefing', {});
  check('a normal call still succeeds after four failed calls', afterErrors.result?.isError !== true, textOf(afterErrors));
  equal('and returns the same briefing as before', textOf(afterErrors), textOf(briefingResponse));

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
    'every stdout frame is a JSON-RPC 2.0 message',
    lines.every(l => {
      try {
        return JSON.parse(l).jsonrpc === '2.0';
      } catch {
        return false;
      }
    })
  );
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
