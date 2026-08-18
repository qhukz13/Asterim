/**
 * Tests for Shared Team Agents and the Turn Concurrency Engine (P8-01, DEC-031).
 *
 * The claim under test is not "turns run" — it is that a shared agent stays
 * coherent when several people talk to it at once. Each section pins one part
 * of that:
 *
 *   1. **The schema.** Migration 002 applies through the real `MigrationEngine`,
 *      producing all four tables and all four indexes, and a second run applies
 *      nothing.
 *   2. **The records.** Team agents and their threads survive a round trip
 *      through SQLite with every field intact — including the distinction
 *      between an unset capability list and a deliberately empty one.
 *   3. **Order.** Five members submitting concurrently are served in submission
 *      order, and the order is fixed at submission rather than by whichever
 *      promise the runtime resumed first.
 *   4. **Atomicity.** No two turns on one thread are ever in flight together.
 *      The executor records every entry and exit, and the assertion is on the
 *      shape of that trace: strictly alternating, never nested.
 *   5. **Withdrawal.** A queued turn can be taken back; the executor never sees
 *      it, the queue closes over the gap, and the durable row says CANCELLED.
 *      A turn that is already being served refuses.
 *   6. **The broadcast.** Every transition reaches the room, in order, with the
 *      queue position a dashboard would render.
 *   7. **The REST surface.** All nine routes, their status codes, and the two
 *      guards that matter: anonymous requests are refused, and the author of a
 *      turn comes from the session rather than the body.
 *
 * Everything runs against a real SQLite file in a temp directory rather than a
 * mocked database, matching the other suites in this directory: most of what is
 * worth asserting here *is* storage behaviour, and a mock answering whatever
 * the test asks would prove only that the test agrees with itself.
 *
 * What is substituted is the agent: a `TeamTurnExecutor` that answers in
 * milliseconds, or when the test says so. That is the point of the indirection
 * — the queueing guarantees are exercised without an agent CLI that may not be
 * installed on the machine running the suite.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/ai/__tests__/TeamAgentService.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-team-agents-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

// `require`, not `import`: DatabaseService resolves its path and constructs its
// singleton at import time, and an ESM binding would be hoisted above the
// ASTERIM_DATA_DIR assignment. Every other suite here follows the convention.
const { DatabaseSync } = require('node:sqlite');
const { MigrationEngine } = require('../../MigrationEngine');
const {
  migrations: builtinMigrations,
  LATEST_SCHEMA_VERSION
} = require('../../../migrations');
const { dbService } = require('../../DatabaseService');
const { AgentTurnLock } = require('../AgentTurnLock');
const {
  TeamAgentService,
  TeamAgentError,
  composeTeamAgentBrief,
  formatTeamTurnInstruction,
  teamAgentService
} = require('../TeamAgentService');
const teamAgentRoutes = require('../../../routes/teamAgents').default;
const Fastify = require('fastify');

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

function throws(label: string, code: string, fn: () => unknown): void {
  try {
    fn();
    check(label, false, 'did not throw');
  } catch (err) {
    const actual = (err as { code?: string }).code;
    check(label, actual === code, `expected code ${code}, got ${actual}: ${(err as Error).message}`);
  }
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

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Test doubles ---

interface RunParams {
  agent: { id: string; name: string };
  thread: { id: string };
  turn: { id: string; instruction: string; userName: string };
  timeoutMs: number;
}

/**
 * An agent that answers instantly, and records exactly when it was in flight.
 *
 * `trace` is the whole point: `start:<id>` and `end:<id>` in the order they
 * happened. Two turns that overlapped produce a nested trace, which no amount
 * of asserting on final state would reveal.
 */
class RecordingExecutor {
  public trace: string[] = [];
  public served: string[] = [];
  public sessions: string[] = [];
  public inFlight = 0;
  public peakInFlight = 0;
  /** Turn id → the resolver that lets it finish, when `manual` is on. */
  private gates = new Map<string, () => void>();
  public manual = false;
  /** Turn ids that should fail instead of answering. */
  public failOn = new Set<string>();

  public async run(params: RunParams): Promise<{ output: string }> {
    const { turn } = params;
    this.inFlight++;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    this.trace.push(`start:${turn.id}`);
    this.served.push(turn.id);
    if (!this.sessions.includes(params.thread.id)) this.sessions.push(params.thread.id);

    try {
      if (this.manual) {
        await new Promise<void>(resolve => this.gates.set(turn.id, resolve));
      } else {
        // A real turn is not instantaneous, and a zero-cost executor would let
        // an overlap that a slower agent would expose slip through unobserved.
        await delay(5);
      }
      if (this.failOn.has(turn.id)) throw new Error(`refused ${turn.id}`);
      return { output: `answer[${turn.userName}]: ${turn.instruction}` };
    } finally {
      this.trace.push(`end:${turn.id}`);
      this.inFlight--;
    }
  }

  /** Lets a manually gated turn finish. */
  public release(turnId: string): boolean {
    const gate = this.gates.get(turnId);
    if (!gate) return false;
    this.gates.delete(turnId);
    gate();
    return true;
  }

  /** Waits until `turnId` has entered the executor, or gives up. */
  public async waitForStart(turnId: string, timeoutMs = 2000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.served.includes(turnId)) return true;
      await delay(2);
    }
    return false;
  }
}

/** Every turn event the lock broadcast, in order. */
interface CapturedEvent {
  type: string;
  turnId: string;
  status: string;
  state: string;
  queuePosition: number;
  queueLength: number;
  teamId: string;
  teamAgentId: string;
}

function captureLock(): { lock: any; events: CapturedEvent[] } {
  const events: CapturedEvent[] = [];
  const lock = new AgentTurnLock((type: string, payload: any) => {
    events.push({
      type,
      turnId: payload.turn.id,
      status: payload.turn.status,
      state: payload.state,
      queuePosition: payload.queuePosition,
      queueLength: payload.queueLength,
      teamId: payload.teamId,
      teamAgentId: payload.teamAgentId
    });
  });
  return { lock, events };
}

// --- Suite ---

async function main(): Promise<void> {
  // --- 1. The migration ------------------------------------------------------
  describe('migration 002 applies cleanly through the migration engine');

  {
    const dir = path.join(tmpDir, 'migration');
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, 'asterim.db');
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL;');

    const engine = new MigrationEngine(db, dbPath);
    const run = engine.runMigrations();

    equal('every built-in migration was applied', run.applied.length, builtinMigrations.length);
    check(
      'and 002_team_agents is among them',
      run.applied.some((record: { name: string }) => record.name === '002_team_agents')
    );
    equal('the schema is at version 2 or later', LATEST_SCHEMA_VERSION >= 2, true);

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map(row => row.name);
    equal(
      'all four team tables exist',
      ['team_agents', 'team_threads', 'team_turn_queue', 'team_agent_messages'].filter(
        table => !tables.includes(table)
      ),
      []
    );

    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{
        name: string;
      }>
    ).map(row => row.name);
    equal(
      'and all four declared indexes',
      [
        'idx_team_agents_team',
        'idx_team_threads_agent',
        'idx_team_queue_thread_status',
        'idx_team_messages_thread'
      ].filter(index => !indexes.includes(index)),
      []
    );

    const columns = (
      db.prepare('PRAGMA table_info(team_turn_queue)').all() as Array<{ name: string }>
    ).map(row => row.name);
    equal(
      'the queue carries every column DEC-031 names',
      [
        'id',
        'team_thread_id',
        'user_id',
        'user_name',
        'instruction',
        'context_json',
        'status',
        'queued_at',
        'started_at',
        'completed_at',
        'error_message'
      ].filter(column => !columns.includes(column)),
      []
    );

    equal('running again applies nothing', engine.runMigrations().applied, []);

    // The Core's own database went through the same engine at import time.
    const liveTables = (
      dbService
        .getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'team_%'")
        .all() as Array<{ name: string }>
    ).map(row => row.name);
    equal(
      'and the running Core has the same tables',
      ['team_agents', 'team_threads', 'team_turn_queue', 'team_agent_messages'].filter(
        table => !liveTables.includes(table)
      ),
      []
    );

    db.close();
  }

  // --- 2. Agent and thread records ------------------------------------------
  describe('team agents and threads round-trip through SQLite');

  const executor = new RecordingExecutor();
  const { lock, events } = captureLock();
  const service = new TeamAgentService({ lock, executor, turnTimeoutMs: 5000 });

  const agent = service.createTeamAgent({
    teamId: 'team-alpha',
    name: 'Tech Lead',
    role: 'tech-lead',
    description: 'Owns architectural coherence.',
    systemPrompt: 'You keep the team honest about the architecture.',
    model: 'claude-opus-5',
    temperature: 0.2,
    enabledMcpServers: ['memory'],
    // Deliberately empty: this agent reaches no skills at all, which is not the
    // same as an agent whose skill list was never set.
    enabledSkills: [],
    createdBy: 'user-ana'
  });

  check('creating a team agent returns an id', typeof agent.id === 'string' && agent.id.length > 0);
  equal('it belongs to the team', agent.teamId, 'team-alpha');

  const readBack = service.getTeamAgent(agent.id);
  equal('it reads back with its prompt', readBack.systemPrompt, agent.systemPrompt);
  equal('its temperature survives', readBack.temperature, 0.2);
  equal('an explicit capability list survives', readBack.enabledMcpServers, ['memory']);
  equal('and an empty one is still empty, not absent', readBack.enabledSkills, []);
  equal('the creator is recorded', readBack.createdBy, 'user-ana');

  const second = service.createTeamAgent({
    teamId: 'team-alpha',
    name: 'Security Reviewer',
    role: 'security',
    systemPrompt: 'You look for the way in.'
  });
  const otherTeam = service.createTeamAgent({
    teamId: 'team-beta',
    name: 'Database Architect',
    role: 'dba',
    systemPrompt: 'You own the schema.'
  });

  equal('an unset capability list stays unset', second.enabledMcpServers, undefined);
  equal('listing is scoped to one team', service.listTeamAgents('team-alpha').length, 2);
  equal('and does not leak another team', service.listTeamAgents('team-beta').length, 1);
  equal(
    'the other team sees only its own',
    service.listTeamAgents('team-beta')[0].id,
    otherTeam.id
  );

  const updated = service.updateTeamAgent(agent.id, {
    description: 'Owns architectural coherence and reviews interfaces.',
    enabledSkills: ['review']
  });
  equal('an update changes what it names', updated.enabledSkills, ['review']);
  equal('and leaves what it does not', updated.systemPrompt, agent.systemPrompt);
  equal(
    'the change is persisted',
    service.getTeamAgent(agent.id).description,
    'Owns architectural coherence and reviews interfaces.'
  );

  throws('an agent with no prompt is rejected', 'INVALID_INPUT', () =>
    service.createTeamAgent({ teamId: 't', name: 'n', role: 'r', systemPrompt: '   ' })
  );
  throws('an out-of-range temperature is rejected', 'INVALID_INPUT', () =>
    service.createTeamAgent({
      teamId: 't',
      name: 'n',
      role: 'r',
      systemPrompt: 'p',
      temperature: 7
    })
  );
  throws('a missing agent is a NOT_FOUND', 'AGENT_NOT_FOUND', () =>
    service.requireTeamAgent('tagent_nope')
  );
  check('and the error is a TeamAgentError', (() => {
    try {
      service.requireTeamAgent('tagent_nope');
      return false;
    } catch (err) {
      return err instanceof TeamAgentError;
    }
  })());

  const thread = service.createTeamThread({
    teamAgentId: agent.id,
    title: 'Rework the event bus',
    projectId: 'proj-1'
  });
  equal('a new thread is idle', thread.status, 'IDLE');
  equal('and bound to its project', thread.projectId, 'proj-1');
  equal('it reads back', service.getTeamThread(thread.id).title, 'Rework the event bus');
  equal('and is listed under its agent', service.listTeamThreads(agent.id).length, 1);
  equal(
    'a thread on another agent is not',
    service.listTeamThreads(second.id).length,
    0
  );
  throws('a thread on a missing agent is refused', 'AGENT_NOT_FOUND', () =>
    service.createTeamThread({ teamAgentId: 'tagent_nope' })
  );
  throws('a missing thread is a NOT_FOUND', 'THREAD_NOT_FOUND', () =>
    service.requireTeamThread('tthread_nope')
  );

  // --- 3. FIFO ordering under concurrent submission --------------------------
  describe('five members submitting at once are served in submission order');

  const members = [
    { userId: 'user-ana', userName: 'Ana' },
    { userId: 'user-ben', userName: 'Ben' },
    { userId: 'user-cai', userName: 'Cai' },
    { userId: 'user-dee', userName: 'Dee' },
    { userId: 'user-eli', userName: 'Eli' }
  ];

  // Each submission is dispatched as its own microtask, so the five calls
  // genuinely interleave with one another rather than running as a straight
  // loop. What must not vary is the resulting order.
  const enqueued = await Promise.all(
    members.map((member, index) =>
      Promise.resolve().then(() =>
        service.enqueueTurn({
          teamThreadId: thread.id,
          userId: member.userId,
          userName: member.userName,
          instruction: `instruction ${index + 1}`,
          context: { index }
        })
      )
    )
  );

  equal(
    'the first submission is told it is next',
    enqueued[0].queuePosition,
    0
  );
  equal(
    'and each later one is told how many are ahead',
    enqueued.map((entry: { queuePosition: number }) => entry.queuePosition),
    [0, 1, 2, 3, 4]
  );

  const results: Array<{ status: string }> = await Promise.all(
    enqueued.map((entry: { completion: Promise<{ status: string }> }) => entry.completion)
  );

  equal(
    'every turn completed',
    results.map(result => result.status),
    ['COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED']
  );
  equal(
    'the agent served them in submission order',
    executor.served,
    enqueued.map((entry: { turn: { id: string } }) => entry.turn.id)
  );
  equal('all five ran against one shared session', executor.sessions, [thread.id]);

  // --- 4. Turn atomicity -----------------------------------------------------
  describe('no two turns on a thread are ever in flight together');

  equal('the executor never saw two turns at once', executor.peakInFlight, 1);

  const wellFormed = executor.trace.every((entry, index) => {
    const turnId = entry.slice(entry.indexOf(':') + 1);
    // Every even entry must be a start, every odd one the end of that same
    // start. Anything else is an overlap.
    return index % 2 === 0
      ? entry === `start:${turnId}`
      : entry === `end:${executor.trace[index - 1].slice('start:'.length)}`;
  });
  check('and the trace strictly alternates start/end', wellFormed, executor.trace.join(' '));

  equal('the thread is idle again', service.getTeamThread(thread.id).status, 'IDLE');
  equal(
    'with nobody holding it',
    service.getTeamThread(thread.id).activeTurnUserId,
    undefined
  );
  equal('and its live queue is empty', service.getQueueState(thread.id).queuedTurns.length, 0);
  equal('with no active turn', service.getQueueState(thread.id).activeTurn, null);

  const transcript = service.listMessages(thread.id);
  equal('the transcript holds every ask and every answer', transcript.length, 10);
  equal(
    'the instructions are recorded in submission order',
    transcript
      .filter((message: { role: string }) => message.role === 'user')
      .map((message: { content: string }) => message.content),
    ['instruction 1', 'instruction 2', 'instruction 3', 'instruction 4', 'instruction 5']
  );
  equal(
    'each ask is attributed to who made it',
    transcript
      .filter((message: { role: string }) => message.role === 'user')
      .map((message: { userName: string }) => message.userName),
    ['Ana', 'Ben', 'Cai', 'Dee', 'Eli']
  );
  equal(
    'and the answers follow in service order',
    transcript
      .filter((message: { role: string }) => message.role === 'assistant')
      .map((message: { content: string }) => message.content),
    members.map((member, index) => `answer[${member.userName}]: instruction ${index + 1}`)
  );
  check(
    'the agent lines belong to the thread, not a person',
    transcript
      .filter((message: { role: string }) => message.role === 'assistant')
      .every((message: { userId?: string }) => message.userId === undefined)
  );

  const history = service.listTurnHistory(thread.id);
  equal('the durable queue recorded all five', history.length, 5);
  check(
    'each with a start and a finish',
    history.every(
      (turn: { startedAt?: number; completedAt?: number; status: string }) =>
        turn.status === 'COMPLETED' &&
        typeof turn.startedAt === 'number' &&
        typeof turn.completedAt === 'number'
    )
  );
  equal(
    'and the context each member supplied',
    service.getTurn(enqueued[2].turn.id).context,
    { index: 2 }
  );

  // --- 5. Cancellation -------------------------------------------------------
  describe('a queued turn can be withdrawn; one that is running cannot');

  const cancelThread = service.createTeamThread({
    teamAgentId: agent.id,
    title: 'Cancellation',
    projectId: 'proj-1'
  });

  executor.manual = true;
  const held = service.enqueueTurn({
    teamThreadId: cancelThread.id,
    userId: 'user-ana',
    userName: 'Ana',
    instruction: 'the long one'
  });
  check('the first turn reaches the agent', await executor.waitForStart(held.turn.id));

  const waiting = service.enqueueTurn({
    teamThreadId: cancelThread.id,
    userId: 'user-ben',
    userName: 'Ben',
    instruction: 'the queued one'
  });
  const alsoWaiting = service.enqueueTurn({
    teamThreadId: cancelThread.id,
    userId: 'user-cai',
    userName: 'Cai',
    instruction: 'the one behind it'
  });

  equal('the second is told it is behind one', waiting.queuePosition, 1);
  equal('and the third behind two', alsoWaiting.queuePosition, 2);

  const busyState = service.getQueueState(cancelThread.id);
  equal('the thread reports itself busy', busyState.state, 'PROCESSING_TURN');
  equal('with the first turn active', busyState.activeTurn.id, held.turn.id);
  equal('and two waiting', busyState.queuedTurns.length, 2);
  equal(
    'the thread row agrees who is being served',
    service.getTeamThread(cancelThread.id).activeTurnUserId,
    'user-ana'
  );

  throws('the running turn refuses to be withdrawn', 'TURN_NOT_CANCELLABLE', () =>
    service.cancelTurn(cancelThread.id, held.turn.id)
  );

  const cancelled = service.cancelTurn(cancelThread.id, waiting.turn.id);
  equal('the queued turn is cancelled', cancelled.status, 'CANCELLED');
  equal(
    'and the durable row says so',
    service.getTurn(waiting.turn.id).status,
    'CANCELLED'
  );
  equal(
    'the queue closed over the gap',
    service.getQueueState(cancelThread.id).queuedTurns.map((turn: { id: string }) => turn.id),
    [alsoWaiting.turn.id]
  );

  const cancelledResult = await waiting.completion;
  equal('its caller is told it was cancelled', cancelledResult.status, 'CANCELLED');

  throws('withdrawing an unknown turn is a NOT_FOUND', 'TURN_NOT_FOUND', () =>
    service.cancelTurn(cancelThread.id, 'tturn_nope')
  );

  executor.release(held.turn.id);
  const heldResult = await held.completion;
  equal('the running turn still completes', heldResult.status, 'COMPLETED');

  check('and the queue advanced to the one behind', await executor.waitForStart(alsoWaiting.turn.id));
  executor.release(alsoWaiting.turn.id);
  await alsoWaiting.completion;
  executor.manual = false;

  check(
    'the cancelled turn was never served',
    !executor.served.includes(waiting.turn.id),
    executor.served.join(', ')
  );
  equal(
    'a withdrawn turn leaves no answer in the transcript',
    service
      .listMessages(cancelThread.id)
      .filter((message: { role: string }) => message.role === 'assistant').length,
    2
  );
  equal(
    'and the thread is idle when the queue drains',
    service.getTeamThread(cancelThread.id).status,
    'IDLE'
  );

  // --- 6. Failure still releases the lock ------------------------------------
  describe('a turn that fails releases the lock and says why');

  const failThread = service.createTeamThread({
    teamAgentId: second.id,
    title: 'Failures',
    projectId: 'proj-1'
  });

  const doomed = service.enqueueTurn({
    teamThreadId: failThread.id,
    userId: 'user-ana',
    userName: 'Ana',
    instruction: 'this will not work'
  });
  executor.failOn.add(doomed.turn.id);

  const after = service.enqueueTurn({
    teamThreadId: failThread.id,
    userId: 'user-ben',
    userName: 'Ben',
    instruction: 'this will'
  });

  const doomedResult = await doomed.completion;
  equal('the failed turn reports FAILED', doomedResult.status, 'FAILED');
  check(
    'with a reason',
    typeof doomedResult.errorMessage === 'string' && doomedResult.errorMessage.length > 0
  );
  equal('the durable row says FAILED', service.getTurn(doomed.turn.id).status, 'FAILED');
  check(
    'and the failure is in the shared transcript',
    service
      .listMessages(failThread.id)
      .some(
        (message: { role: string; content: string }) =>
          message.role === 'system' && message.content.includes('Turn failed')
      )
  );

  const afterResult = await after.completion;
  equal('the turn behind it still ran', afterResult.status, 'COMPLETED');
  equal('and the thread ended idle', service.getTeamThread(failThread.id).status, 'IDLE');

  const doomedCompletion = events.find(
    (event: CapturedEvent) =>
      event.turnId === doomed.turn.id && event.type === 'team_turn:completed'
  );
  equal(
    'the room is told the turn failed, not that it completed',
    doomedCompletion?.status,
    'FAILED'
  );
  equal(
    'and a turn that really completed says so',
    events.find(
      (event: CapturedEvent) =>
        event.turnId === after.turn.id && event.type === 'team_turn:completed'
    )?.status,
    'COMPLETED'
  );

  // --- 7. The broadcast ------------------------------------------------------
  describe('every transition reaches the room');

  const firstThreadEvents = events.filter(
    (event: CapturedEvent) =>
      enqueued.some((entry: { turn: { id: string } }) => entry.turn.id === event.turnId)
  );

  equal(
    'five queued, five started, five completed',
    ['team_turn:queued', 'team_turn:started', 'team_turn:completed'].map(
      type => firstThreadEvents.filter((event: CapturedEvent) => event.type === type).length
    ),
    [5, 5, 5]
  );
  equal(
    'the first turn was told it was next',
    firstThreadEvents.find(
      (event: CapturedEvent) =>
        event.type === 'team_turn:queued' && event.turnId === enqueued[0].turn.id
    )?.queuePosition,
    0
  );
  equal(
    'and the last that four were ahead',
    firstThreadEvents.find(
      (event: CapturedEvent) =>
        event.type === 'team_turn:queued' && event.turnId === enqueued[4].turn.id
    )?.queuePosition,
    4
  );
  check(
    'a started event reports the thread as processing',
    firstThreadEvents
      .filter((event: CapturedEvent) => event.type === 'team_turn:started')
      .every((event: CapturedEvent) => event.state === 'PROCESSING_TURN' && event.queuePosition === 0)
  );
  check(
    'every event names the team it belongs to',
    firstThreadEvents.every(
      (event: CapturedEvent) => event.teamId === 'team-alpha' && event.teamAgentId === agent.id
    )
  );

  const cancelEvents = events.filter(
    (event: CapturedEvent) => event.turnId === waiting.turn.id
  );
  equal(
    'a withdrawn turn is announced as queued then cancelled',
    cancelEvents.map((event: CapturedEvent) => event.type),
    ['team_turn:queued', 'team_turn:cancelled']
  );
  check(
    'and never as started',
    !events.some(
      (event: CapturedEvent) =>
        event.turnId === waiting.turn.id && event.type === 'team_turn:started'
    )
  );

  // --- 8. Lock ordering in isolation ----------------------------------------
  describe('the lock alone grants turns in the order they were enqueued');

  {
    const bare = new AgentTurnLock(() => undefined);
    const order: string[] = [];
    const context = { teamAgentId: 'a', teamId: 't' };

    const ids = ['t1', 't2', 't3', 't4'];
    for (const id of ids) {
      bare.enqueue(
        {
          id,
          teamThreadId: 'lane',
          userId: 'u',
          userName: 'u',
          instruction: id,
          status: 'QUEUED',
          queuedAt: Date.now()
        },
        context
      );
    }

    equal('the queue reports four waiting', bare.getQueueState('lane').queuedTurns.length, 4);

    // Acquired out of order on purpose: the queue decides, not the caller.
    const claims = [...ids].reverse().map(id =>
      bare.acquireTurn('lane', id).then((granted: boolean) => {
        if (granted) {
          order.push(id);
          bare.releaseTurn('lane', id);
        }
        return granted;
      })
    );

    const granted = await Promise.all(claims);
    equal('every turn was granted', granted, [true, true, true, true]);
    equal('in enqueue order, not acquire order', order, ids);
    equal('and the lane ends idle', bare.getTurnState('lane'), 'IDLE');

    // A turn withdrawn before anyone acquired it must never be granted.
    bare.enqueue(
      {
        id: 't5',
        teamThreadId: 'lane',
        userId: 'u',
        userName: 'u',
        instruction: 't5',
        status: 'QUEUED',
        queuedAt: Date.now()
      },
      context
    );
    equal('cancelling a queued turn succeeds', bare.cancelTurn('lane', 't5'), true);
    equal('acquiring it afterwards is refused', await bare.acquireTurn('lane', 't5'), false);
    equal('cancelling it twice does not', bare.cancelTurn('lane', 't5'), false);
    equal('and the lane is still idle', bare.getTurnState('lane'), 'IDLE');

    // Approval parks a turn without releasing it (DEC-031 § 3).
    bare.enqueue(
      {
        id: 't6',
        teamThreadId: 'lane',
        userId: 'u',
        userName: 'u',
        instruction: 't6',
        status: 'QUEUED',
        queuedAt: Date.now()
      },
      context
    );
    equal('a turn is granted', await bare.acquireTurn('lane', 't6'), true);
    equal('parking it on an approval works', bare.markAwaitingApproval('lane', 't6'), true);
    equal('and the lane says why it is stalled', bare.getTurnState('lane'), 'AWAITING_APPROVAL');
    equal('it still holds the lock', bare.getQueueState('lane').activeTurn.id, 't6');
    equal('resuming it works', bare.resumeFromApproval('lane', 't6'), true);
    equal('and it is processing again', bare.getTurnState('lane'), 'PROCESSING_TURN');
    bare.releaseTurn('lane', 't6');
    equal('releasing it ends the lane', bare.getTurnState('lane'), 'IDLE');

    // A release naming something that is not the active turn must do nothing.
    bare.enqueue(
      {
        id: 't7',
        teamThreadId: 'lane',
        userId: 'u',
        userName: 'u',
        instruction: 't7',
        status: 'QUEUED',
        queuedAt: Date.now()
      },
      context
    );
    await bare.acquireTurn('lane', 't7');
    bare.releaseTurn('lane', 'not-the-active-one');
    equal('a stray release does not free the lock', bare.getTurnState('lane'), 'PROCESSING_TURN');
    bare.releaseTurn('lane', 't7');
    equal('the real one does', bare.getTurnState('lane'), 'IDLE');
  }

  // --- 9. Prompt composition -------------------------------------------------
  describe('a shared session is told it is shared');

  {
    const brief = composeTeamAgentBrief(agent);
    check('the brief names the agent', brief.includes('Tech Lead'));
    check('and its role', brief.includes('tech-lead'));
    check('and carries its system prompt', brief.includes(agent.systemPrompt));
    check('and explains that instructions are attributed', brief.includes('prefixed with the name'));

    const formatted = formatTeamTurnInstruction({
      id: 't',
      teamThreadId: 'x',
      userId: 'u',
      userName: 'Ana',
      instruction: 'refactor the bus',
      status: 'QUEUED',
      queuedAt: 0,
      context: { ticket: 'AST-9' }
    });
    check('an instruction is attributed to its author', formatted.startsWith('[Ana] refactor the bus'));
    check('and carries the context it was sent with', formatted.includes('AST-9'));
  }

  // --- 9b. The production executor -------------------------------------------
  describe('the production executor briefs a shared session exactly once');

  {
    const { eventBus } = require('../../EventBus');
    const { EventBusTeamTurnExecutor } = require('../TeamAgentService');
    const live = new EventBusTeamTurnExecutor(eventBus);

    const sessionThread = { id: 'tthread-live', teamAgentId: agent.id, projectId: 'proj-live' };
    const sent: Array<{ type: string; content?: string; command?: string }> = [];

    // Stands in for AgentService: acknowledges what the executor asks for, and
    // answers each instruction the way a PTY-driven agent does — some output,
    // then idle.
    const onCommand = (event: { payload?: Record<string, unknown> }) => {
      if (event.payload?.threadId !== sessionThread.id) return;
      sent.push({ type: 'command', command: event.payload.command as string });
    };
    const onChat = (event: { payload?: Record<string, unknown> }) => {
      if (event.payload?.threadId !== sessionThread.id) return;
      const content = event.payload.content as string;
      sent.push({ type: 'chat', content });
      // The brief is setup, not a question; only an instruction is answered.
      if (content.startsWith('You are the shared team agent')) return;
      setTimeout(() => {
        eventBus.publish({
          id: 'x',
          timestamp: Date.now(),
          source: 'test',
          type: 'chat.message',
          payload: { threadId: sessionThread.id, role: 'agent', content: `ack: ${content}` }
        });
        eventBus.publish({
          id: 'y',
          timestamp: Date.now(),
          source: 'test',
          type: 'agent.status',
          payload: { threadId: sessionThread.id, status: 'idle' }
        });
      }, 1);
    };

    eventBus.subscribe('client.command', onCommand);
    eventBus.subscribe('client.chat_message', onChat);

    const liveTurn = (id: string, instruction: string) => ({
      id,
      teamThreadId: sessionThread.id,
      userId: 'user-ana',
      userName: 'Ana',
      instruction,
      status: 'QUEUED' as const,
      queuedAt: Date.now()
    });

    const firstAnswer = await live.run({
      agent,
      thread: sessionThread,
      turn: liveTurn('live-1', 'first question'),
      timeoutMs: 3000
    });
    check('the first turn gets an answer', firstAnswer.output.includes('first question'));
    equal('the session was started once', sent.filter(entry => entry.command === 'start').length, 1);
    equal(
      'the persona was published once',
      sent.filter(entry => entry.content?.startsWith('You are the shared team agent')).length,
      1
    );

    const secondAnswer = await live.run({
      agent,
      thread: sessionThread,
      turn: liveTurn('live-2', 'second question'),
      timeoutMs: 3000
    });
    check('the second turn gets an answer', secondAnswer.output.includes('second question'));
    equal('the session was not restarted', sent.filter(entry => entry.command === 'start').length, 1);
    equal(
      'and the persona was not repeated into a session already running under it',
      sent.filter(entry => entry.content?.startsWith('You are the shared team agent')).length,
      1
    );
    equal(
      'each instruction was attributed to its author',
      sent.filter(entry => entry.content?.startsWith('[Ana]')).length,
      2
    );

    // An unbound thread is refused before anything is published, so it must not
    // count as briefed.
    let refusal: Error | null = null;
    try {
      await live.run({
        agent,
        thread: { id: 'tthread-unbound', teamAgentId: agent.id },
        turn: liveTurn('live-3', 'nowhere to run'),
        timeoutMs: 500
      });
    } catch (err) {
      refusal = err as Error;
    }
    equal('an unbound thread is refused', (refusal as unknown as { code?: string })?.code, 'NO_PROJECT_BOUND');
    equal(
      'and nothing was published for it',
      sent.filter(entry => entry.content?.includes('nowhere to run')).length,
      0
    );

    // A session that reports itself unstartable fails the turn rather than
    // holding the lock until the timeout.
    const brokenThread = { id: 'tthread-broken', teamAgentId: agent.id, projectId: 'proj-live' };
    const onBroken = (event: { payload?: Record<string, unknown> }) => {
      if (event.payload?.threadId !== brokenThread.id) return;
      setTimeout(() => {
        eventBus.publish({
          id: 'z',
          timestamp: Date.now(),
          source: 'test',
          type: 'agent.status',
          payload: {
            threadId: brokenThread.id,
            status: 'idle',
            message: 'Error starting agent: binary not found'
          }
        });
      }, 1);
    };
    eventBus.subscribe('client.chat_message', onBroken);

    let brokenFailure: Error | null = null;
    try {
      await live.run({
        agent,
        thread: brokenThread,
        turn: liveTurn('live-4', 'will not start'),
        timeoutMs: 3000
      });
    } catch (err) {
      brokenFailure = err as Error;
    }
    check(
      'a session that cannot start fails the turn immediately',
      brokenFailure !== null && brokenFailure.message.includes('binary not found'),
      brokenFailure?.message
    );

    eventBus.unsubscribe('client.command', onCommand);
    eventBus.unsubscribe('client.chat_message', onChat);
    eventBus.unsubscribe('client.chat_message', onBroken);
  }

  // --- 10. Restart recovery --------------------------------------------------
  describe('turns a restart stopped on top of are settled');

  {
    const recoverAgent = teamAgentService.createTeamAgent({
      teamId: 'team-recover',
      name: 'Recovery',
      role: 'recovery',
      systemPrompt: 'p'
    });
    const recoverThread = teamAgentService.createTeamThread({ teamAgentId: recoverAgent.id });

    const db = dbService.getDb();
    db.prepare(
      `INSERT INTO team_turn_queue (id, team_thread_id, user_id, user_name, instruction, status, queued_at, started_at)
       VALUES ('stale-running', ?, 'u', 'U', 'i', 'PROCESSING', 1, 1)`
    ).run(recoverThread.id);
    db.prepare(
      `INSERT INTO team_turn_queue (id, team_thread_id, user_id, user_name, instruction, status, queued_at)
       VALUES ('stale-queued', ?, 'u', 'U', 'i', 'QUEUED', 2)`
    ).run(recoverThread.id);
    db.prepare("UPDATE team_threads SET status = 'PROCESSING_TURN' WHERE id = ?").run(
      recoverThread.id
    );

    equal('one turn was mid-flight', teamAgentService.recoverTurns(), 1);
    equal(
      'it is settled as failed',
      teamAgentService.getTurn('stale-running').status,
      'FAILED'
    );
    equal(
      'a turn that never started is cancelled',
      teamAgentService.getTurn('stale-queued').status,
      'CANCELLED'
    );
    equal(
      'and the thread is no longer busy forever',
      teamAgentService.getTeamThread(recoverThread.id).status,
      'IDLE'
    );
  }

  // --- 11. Cascade -----------------------------------------------------------
  describe('deleting a team agent takes its threads and their queues with it');

  {
    const doomedAgent = service.createTeamAgent({
      teamId: 'team-alpha',
      name: 'Temporary',
      role: 'temp',
      systemPrompt: 'p'
    });
    const doomedThread = service.createTeamThread({
      teamAgentId: doomedAgent.id,
      projectId: 'proj-1'
    });
    const doomedTurn = service.enqueueTurn({
      teamThreadId: doomedThread.id,
      userId: 'user-ana',
      userName: 'Ana',
      instruction: 'briefly'
    });
    await doomedTurn.completion;

    const db = dbService.getDb();
    db.exec('PRAGMA foreign_keys = ON;');
    service.deleteTeamAgent(doomedAgent.id);

    equal('the agent is gone', service.getTeamAgent(doomedAgent.id), null);
    equal('its thread with it', service.getTeamThread(doomedThread.id), null);
    equal(
      'and its queue rows',
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM team_turn_queue WHERE team_thread_id = ?')
          .get(doomedThread.id) as { count: number }
      ).count,
      0
    );
    equal(
      'and its transcript',
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM team_agent_messages WHERE team_thread_id = ?')
          .get(doomedThread.id) as { count: number }
      ).count,
      0
    );
    throws('deleting it again is a NOT_FOUND', 'AGENT_NOT_FOUND', () =>
      service.deleteTeamAgent(doomedAgent.id)
    );
  }

  // --- 12. The REST surface --------------------------------------------------
  describe('the REST surface');

  {
    const app = Fastify();
    // Stands in for authMiddleware, which is registered globally in server.ts.
    app.addHook('onRequest', async (request: { headers: Record<string, string>; user?: unknown }) => {
      if (request.headers['x-anonymous'] !== 'yes') request.user = { sub: 'user-rest' };
    });
    await app.register(teamAgentRoutes);
    await app.ready();

    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/team-agents?teamId=team-rest',
      headers: { 'x-anonymous': 'yes' }
    });
    equal('an anonymous read is 401', anonymous.statusCode, 401);

    const noTeam = await app.inject({ method: 'GET', url: '/api/v1/team-agents' });
    equal('listing without a team is 400', noTeam.statusCode, 400);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/team-agents',
      payload: {
        teamId: 'team-rest',
        name: 'REST Lead',
        role: 'lead',
        systemPrompt: 'You answer over HTTP.',
        // Ignored: the creator is the session, not the body.
        createdBy: 'user-impostor'
      }
    });
    equal('creating a team agent is 201', created.statusCode, 201);
    const restAgent = created.json().agent;
    equal('and the creator is the authenticated user', restAgent.createdBy, 'user-rest');

    const badCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/team-agents',
      payload: { teamId: 'team-rest', name: 'x' }
    });
    equal('a malformed create is 400', badCreate.statusCode, 400);
    equal('with the service’s own code', badCreate.json().code, 'INVALID_INPUT');

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/team-agents?teamId=team-rest'
    });
    equal('listing is 200', listed.statusCode, 200);
    equal('and holds the new agent', listed.json().agents.length, 1);

    const fetched = await app.inject({ method: 'GET', url: `/api/v1/team-agents/${restAgent.id}` });
    equal('reading one is 200', fetched.statusCode, 200);
    equal('with its threads', fetched.json().threads, []);

    const missing = await app.inject({ method: 'GET', url: '/api/v1/team-agents/tagent_nope' });
    equal('reading a missing one is 404', missing.statusCode, 404);
    equal('with a NOT_FOUND code', missing.json().code, 'AGENT_NOT_FOUND');

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/team-agents/${restAgent.id}`,
      payload: {
        name: 'REST Lead II',
        // Ignored: neither may be moved by a body. The agent belongs to the
        // team it was created in, and was authored by whoever created it.
        teamId: 'team-someone-else',
        createdBy: 'user-impostor'
      }
    });
    equal('patching a team agent is 200', patched.statusCode, 200);
    equal('and the change is applied', patched.json().agent.name, 'REST Lead II');
    equal('without moving it between teams', patched.json().agent.teamId, 'team-rest');
    equal('or rewriting who authored it', patched.json().agent.createdBy, 'user-rest');

    const badPatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/team-agents/${restAgent.id}`,
      payload: { name: '' }
    });
    equal('a malformed patch is 400', badPatch.statusCode, 400);

    const missingPatch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/team-agents/tagent_nope',
      payload: { name: 'x' }
    });
    equal('patching a missing agent is 404', missingPatch.statusCode, 404);

    const anonymousPatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/team-agents/${restAgent.id}`,
      payload: { name: 'x' },
      headers: { 'x-anonymous': 'yes' }
    });
    equal('and an anonymous one is 401', anonymousPatch.statusCode, 401);

    const threadCreated = await app.inject({
      method: 'POST',
      url: `/api/v1/team-agents/${restAgent.id}/threads`,
      payload: { title: 'Over HTTP' }
    });
    equal('creating a thread is 201', threadCreated.statusCode, 201);
    const restThread = threadCreated.json().thread;
    equal('and it starts idle', restThread.status, 'IDLE');

    const threadRead = await app.inject({ method: 'GET', url: `/api/v1/team-threads/${restThread.id}` });
    equal('reading a thread is 200', threadRead.statusCode, 200);
    equal('with an empty transcript', threadRead.json().messages, []);
    equal('and an idle queue', threadRead.json().queue.state, 'IDLE');
    equal('naming its agent', threadRead.json().agent.id, restAgent.id);

    const missingThread = await app.inject({ method: 'GET', url: '/api/v1/team-threads/nope' });
    equal('reading a missing thread is 404', missingThread.statusCode, 404);

    // The singleton's lock is the Core's. Occupying the lane by hand is how a
    // turn submitted over HTTP can be observed sitting in the queue rather than
    // being served the instant it arrives.
    const { agentTurnLock } = require('../AgentTurnLock');
    const blockerContext = { teamAgentId: restAgent.id, teamId: 'team-rest' };
    agentTurnLock.enqueue(
      {
        id: 'rest-blocker',
        teamThreadId: restThread.id,
        userId: 'user-blocker',
        userName: 'Blocker',
        instruction: 'holding the lane',
        status: 'QUEUED',
        queuedAt: Date.now()
      },
      blockerContext
    );
    equal('the lane is held', await agentTurnLock.acquireTurn(restThread.id, 'rest-blocker'), true);

    const turnPosted = await app.inject({
      method: 'POST',
      url: `/api/v1/team-threads/${restThread.id}/turns`,
      payload: { instruction: 'please review the schema', userName: 'Rest User' }
    });
    equal('submitting a turn is 202', turnPosted.statusCode, 202);
    const restTurn = turnPosted.json().turn;
    equal('the author is the session user', restTurn.userId, 'user-rest');
    equal('and it is told it is behind the blocker', turnPosted.json().queuePosition, 1);

    const badTurn = await app.inject({
      method: 'POST',
      url: `/api/v1/team-threads/${restThread.id}/turns`,
      payload: { instruction: '   ' }
    });
    equal('an empty instruction is 400', badTurn.statusCode, 400);

    const anonymousTurn = await app.inject({
      method: 'POST',
      url: `/api/v1/team-threads/${restThread.id}/turns`,
      payload: { instruction: 'x' },
      headers: { 'x-anonymous': 'yes' }
    });
    equal('an anonymous submission is 401', anonymousTurn.statusCode, 401);

    const notFoundCancel = await app.inject({
      method: 'DELETE',
      url: `/api/v1/team-threads/${restThread.id}/turns/tturn_nope`
    });
    equal('withdrawing an unknown turn is 404', notFoundCancel.statusCode, 404);

    const cancelledOverHttp = await app.inject({
      method: 'DELETE',
      url: `/api/v1/team-threads/${restThread.id}/turns/${restTurn.id}`
    });
    equal('withdrawing a queued turn is 200', cancelledOverHttp.statusCode, 200);
    equal('and it is cancelled', cancelledOverHttp.json().turn.status, 'CANCELLED');
    equal(
      'the queue is empty behind the blocker',
      cancelledOverHttp.json().queue.queuedTurns.length,
      0
    );

    agentTurnLock.releaseTurn(restThread.id, 'rest-blocker');

    // A thread bound to no project cannot be served: the shared agent runs on
    // this workstation, against a real checkout (DEC-032 § 1).
    const unboundTurn = await app.inject({
      method: 'POST',
      url: `/api/v1/team-threads/${restThread.id}/turns`,
      payload: { instruction: 'run something' }
    });
    equal('a turn on an unbound thread is still accepted', unboundTurn.statusCode, 202);

    // Give the turn a moment to reach the executor and be refused by it.
    for (let attempt = 0; attempt < 100; attempt++) {
      if (teamAgentService.getTurn(unboundTurn.json().turn.id)?.status === 'FAILED') break;
      await delay(10);
    }
    const unboundRow = teamAgentService.getTurn(unboundTurn.json().turn.id);
    equal('but it fails rather than running somewhere arbitrary', unboundRow.status, 'FAILED');
    check(
      'and says the thread is bound to no project',
      typeof unboundRow.errorMessage === 'string' &&
        unboundRow.errorMessage.includes('not bound to a project'),
      unboundRow.errorMessage
    );
    equal(
      'the thread is idle afterwards',
      teamAgentService.getTeamThread(restThread.id).status,
      'IDLE'
    );

    const settledCancel = await app.inject({
      method: 'DELETE',
      url: `/api/v1/team-threads/${restThread.id}/turns/${unboundTurn.json().turn.id}`
    });
    equal('withdrawing a turn that already finished is 200', settledCancel.statusCode, 200);
    equal('and reports what it settled as', settledCancel.json().turn.status, 'FAILED');

    const anonymousDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/team-agents/${restAgent.id}`,
      headers: { 'x-anonymous': 'yes' }
    });
    equal('an anonymous delete is 401', anonymousDelete.statusCode, 401);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/team-agents/${restAgent.id}`
    });
    equal('deleting a team agent is 200', deleted.statusCode, 200);
    equal('the agent is gone', teamAgentService.getTeamAgent(restAgent.id), null);
    equal(
      'and its collaborative threads went with it',
      teamAgentService.getTeamThread(restThread.id),
      null
    );

    const deletedAgain = await app.inject({
      method: 'DELETE',
      url: `/api/v1/team-agents/${restAgent.id}`
    });
    equal('deleting it twice is 404, not 500', deletedAgain.statusCode, 404);

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
