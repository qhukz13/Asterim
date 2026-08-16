/**
 * Tests for the Multi-Agent Handoff & Role Delegation protocol (P7-01).
 *
 * The repository has no test runner (docs/p5.0-01-verification-report.md § 3), so this
 * is a standalone script with its own assertion harness, matching the profiles,
 * MCP, skills and memory suites.
 *
 * Everything runs against a real SQLite file in a temp directory. The hierarchy
 * *is* storage — a child that hangs from its parent, a depth read by walking
 * that link, a brief that survives in the row — and a mocked database would only
 * prove the test agrees with itself.
 *
 * What is faked is the agent process, and only that. `DelegationSessionRunner`
 * is substituted with one that plays a child's events onto the real EventBus, so
 * the parts worth asserting — when a child counts as finished, what the parent
 * is told, what happens when the child never answers — run against the same
 * waiting code a PTY would drive. The last section drops the fake entirely and
 * lets the default runner publish onto the bus, with the test standing in for
 * AgentService, so the production wiring is exercised too.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-delegation-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

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

// DatabaseService and EventBus export singletons constructed at import time, so
// `require` is used instead of `import`, whose bindings would hoist above the
// ASTERIM_DATA_DIR assignment.
const { dbService } = require('../../DatabaseService');
const { eventBus } = require('../../EventBus');
const { profileService } = require('../ProfileService');
const {
  AgentDelegationService,
  DelegationError,
  EventBusSessionRunner,
  agentDelegationService,
  formatChildBrief,
  formatDelegationReport,
  parseArtifacts,
  parseTaggedLine,
  readVerdict
} = require('../AgentDelegationService');
const { McpAgentBridge } = require('../../mcp/McpAgentBridge');
const { McpToolGateway } = require('../../mcp/McpToolGateway');
const {
  DELEGATE_TASK_TOOL,
  DELEGATION_CHILD_STATE_EVENT,
  DELEGATION_COMPLETED_EVENT,
  DELEGATION_PARENT_STATE_EVENT,
  DELEGATION_STARTED_EVENT,
  MAX_DELEGATION_DEPTH,
  REQUEST_REVIEW_TOOL,
  canProfileDelegate,
  isDelegationCapableRole,
  isDelegationToolName,
  parseReviewVerdict
} = require('@asterim/shared');
const Fastify = require('fastify');
const delegationRoutes = require('../../../routes/delegation').default;

const PROJECT_ID = 'delegation-project';

type AnyEvent = { type: string; payload: Record<string, any> };

/** Publishes what a running agent session would publish for one thread. */
function emitAgentMessage(threadId: string, content: string): void {
  eventBus.publish({
    id: `evt-${Math.random()}`,
    timestamp: Date.now(),
    source: 'agent',
    type: 'chat.message',
    payload: { projectId: PROJECT_ID, threadId, role: 'agent', content }
  });
}

function emitStatus(threadId: string, status: string, message = ''): void {
  eventBus.publish({
    id: `evt-${Math.random()}`,
    timestamp: Date.now(),
    source: 'agent',
    type: 'agent.status',
    payload: { projectId: PROJECT_ID, threadId, status, message }
  });
}

/**
 * A session runner that never touches a PTY.
 *
 * `reply` is what the fake child says once it has been handed its brief. A
 * runner with no `reply` is a child that never answers, which is how the
 * timeout path is reached.
 */
class FakeRunner {
  public started: Array<{ projectId: string; threadId: string; profileId?: string; agentType?: string }> = [];
  public sent: Array<{ projectId: string; threadId: string; content: string }> = [];
  public stopped: Array<{ projectId: string; threadId: string }> = [];
  public reply: ((threadId: string) => void) | null = null;
  public failOnStart = false;

  public start(params: { projectId: string; threadId: string; profileId?: string; agentType?: string }): void {
    if (this.failOnStart) throw new Error('node-pty is not available here');
    this.started.push(params);
  }

  public send(params: { projectId: string; threadId: string; content: string }): void {
    this.sent.push(params);
    // Only a child gets an answer; a send to the parent is the resume, and a
    // fake child answering that would be an infinite regress.
    const isChild = this.started.some(entry => entry.threadId === params.threadId);
    if (isChild && this.reply) this.reply(params.threadId);
  }

  public stop(params: { projectId: string; threadId: string }): void {
    this.stopped.push(params);
  }

  /** Everything this runner sent to one thread. */
  public sentTo(threadId: string): string[] {
    return this.sent.filter(entry => entry.threadId === threadId).map(entry => entry.content);
  }

  public reset(): void {
    this.started = [];
    this.sent = [];
    this.stopped = [];
    this.reply = null;
    this.failOnStart = false;
  }
}

/** Records every delegation event published while a block runs. */
function recordEvents(types: string[]): { events: AnyEvent[]; stop: () => void } {
  const events: AnyEvent[] = [];
  const handlers = types.map(type => {
    const handler = (event: AnyEvent) => events.push(event);
    eventBus.subscribe(type, handler);
    return { type, handler };
  });
  return {
    events,
    stop: () => handlers.forEach(({ type, handler }) => eventBus.unsubscribe(type, handler))
  };
}

function insertThread(id: string, name: string, parentThreadId: string | null = null): void {
  dbService
    .getDb()
    .prepare('INSERT INTO threads (id, project_id, name, parent_thread_id) VALUES (?, ?, ?, ?)')
    .run(id, PROJECT_ID, name, parentThreadId);
}

function threadRow(id: string): any {
  return dbService.getDb().prepare('SELECT * FROM threads WHERE id = ?').get(id);
}

/** Lets the event loop turn, so a delegation gets as far as parking its parent. */
function pause(ms = 10): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Which error a call threw, or null when it did not throw. */
async function codeOf(fn: () => unknown): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    const thrown = err as { code?: string; message?: string };
    return err instanceof DelegationError ? String(thrown.code) : `UNEXPECTED:${thrown.message}`;
  }
}

const runner = new FakeRunner();
const service = new AgentDelegationService(runner, profileService, eventBus);

async function main(): Promise<void> {
  profileService.initBuiltinProfiles();
  dbService
    .getDb()
    .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
    .run(PROJECT_ID, 'Delegation', tmpDir);

  // --- Schema -----------------------------------------------------------------
  describe('the threads table carries the hierarchy');
  {
    const columns = (
      dbService.getDb().prepare('PRAGMA table_info(threads)').all() as Array<{ name: string }>
    ).map(column => column.name);
    check('parent_thread_id is there', columns.includes('parent_thread_id'));
    check('and the brief travels with the row', columns.includes('delegation_context_json'));
    check('the P6-07 profile column survived', columns.includes('profile_id'));

    const indexes = (
      dbService
        .getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_threads_parent'")
        .all() as Array<{ name: string }>
    ).map(row => row.name);
    equal('children are indexed by their parent', indexes, ['idx_threads_parent']);

    // A database that predates P7-01 must still open, which is what the
    // ALTER-in-a-try pattern buys. Re-running init is the cheapest proof.
    let reinitFailed = false;
    try {
      const { DatabaseService } = require('../../DatabaseService');
      new DatabaseService();
    } catch {
      reinitFailed = true;
    }
    check('opening the same database again is idempotent', !reinitFailed);
  }

  // --- Depth ------------------------------------------------------------------
  describe('getDelegationDepth');
  {
    insertThread('root', 'Root');
    insertThread('d1', 'Child', 'root');
    insertThread('d2', 'Grandchild', 'd1');
    insertThread('d3', 'Great-grandchild', 'd2');

    equal('a root thread is depth 0', service.getDelegationDepth('root'), 0);
    equal('its child is 1', service.getDelegationDepth('d1'), 1);
    equal('and so on down', service.getDelegationDepth('d3'), 3);
    equal('an unknown thread is 0', service.getDelegationDepth('nope'), 0);

    // A hand-edited row must not be able to hang the walk.
    insertThread('cycle-a', 'A');
    dbService.getDb().prepare('UPDATE threads SET parent_thread_id = ? WHERE id = ?').run('cycle-a', 'cycle-a');
    check('a self-referencing row terminates', service.getDelegationDepth('cycle-a') > MAX_DELEGATION_DEPTH);
  }

  describe('the depth bound is enforced');
  {
    runner.reset();
    runner.reply = threadId => {
      emitAgentMessage(threadId, 'Done.\nSUMMARY: nothing to do.');
      emitStatus(threadId, 'idle');
    };

    equal(
      `a delegation that would reach depth ${MAX_DELEGATION_DEPTH + 1} is refused`,
      await codeOf(() =>
        service.delegateTask({
          parentThreadId: 'd3',
          targetRole: 'QA Engineer',
          taskDescription: 'Write one more layer of tests.'
        })
      ),
      'DEPTH_EXCEEDED'
    );
    equal('and no child was created for it', service.listChildren('d3').length, 0);
    equal('nothing was started', runner.started.length, 0);

    const allowed = await service.delegateTask({
      parentThreadId: 'd2',
      targetRole: 'QA Engineer',
      taskDescription: 'Write the regression test.'
    });
    equal(`the last allowed level still goes through`, allowed.depth, MAX_DELEGATION_DEPTH);
    equal('and it ran', allowed.status, 'COMPLETED');
    equal(
      'a delegation from that child is then refused',
      await codeOf(() =>
        service.delegateTask({
          parentThreadId: allowed.childThreadId,
          targetRole: 'QA Engineer',
          taskDescription: 'One more.'
        })
      ),
      'DEPTH_EXCEEDED'
    );
  }

  // --- The lifecycle ----------------------------------------------------------
  describe('delegateTask — parent delegates, child runs, parent is resumed');
  /** The child of the first delegation, asserted on again by `listChildren`. */
  const firstChild: string[] = [];
  {
    runner.reset();
    insertThread('lead', 'Lead session');
    runner.reply = threadId => {
      emitAgentMessage(threadId, 'Looking at the service.\n');
      emitAgentMessage(
        threadId,
        'Done.\nSUMMARY: Added the route and its guard.\nARTIFACTS: src/routes/x.ts, src/services/X.ts\n'
      );
      emitStatus(threadId, 'idle');
    };

    const recorder = recordEvents([
      DELEGATION_STARTED_EVENT,
      DELEGATION_CHILD_STATE_EVENT,
      DELEGATION_PARENT_STATE_EVENT,
      DELEGATION_COMPLETED_EVENT
    ]);

    const result = await service.delegateTask({
      parentThreadId: 'lead',
      targetRole: 'Senior Backend Engineer',
      taskDescription: 'Add the delegation route.',
      inputContext: 'The service already exists.'
    });
    recorder.stop();
    firstChild.push(result.childThreadId);

    equal('it completes', result.status, 'COMPLETED');
    check('a child thread id comes back', typeof result.childThreadId === 'string' && result.childThreadId.length > 0);
    equal('the summary is the child’s own', result.summary, 'Added the route and its guard.');
    equal('the artifacts it named are carried', result.artifacts, ['src/routes/x.ts', 'src/services/X.ts']);
    equal('the role is recorded', result.role, 'Senior Backend Engineer');
    equal('with the depth it ran at', result.depth, 1);
    check('the transcript survives', result.output.includes('Looking at the service.'));
    check('and it is timed', (result.finishedAt ?? 0) >= (result.startedAt ?? 0));

    // Storage
    const row = threadRow(result.childThreadId);
    equal('the child hangs from its parent', row.parent_thread_id, 'lead');
    equal('in the same project', row.project_id, PROJECT_ID);
    equal('under the role’s profile', row.profile_id, 'builtin-senior-backend-engineer');
    const context = JSON.parse(row.delegation_context_json);
    equal('the brief is stored with it', context.taskDescription, 'Add the delegation route.');
    equal('with the context it was given', context.inputContext, 'The service already exists.');
    equal('its depth', context.depth, 1);
    equal('and the outcome, once known', context.status, 'COMPLETED');
    check('the child thread is named for what it did', row.name.includes('Senior Backend Engineer'));

    // The session mechanics
    equal('exactly one child session was started', runner.started.length, 1);
    equal('for the child thread', runner.started[0].threadId, result.childThreadId);
    equal('under the resolved profile', runner.started[0].profileId, 'builtin-senior-backend-engineer');
    const brief = runner.sentTo(result.childThreadId)[0];
    check('the child was handed the task', brief.includes('Add the delegation route.'));
    check('and the context', brief.includes('The service already exists.'));
    check('and told how to report', brief.includes('SUMMARY:'));
    equal('the child session is stopped afterwards', runner.stopped.length, 1);
    equal('and it is the child that stopped', runner.stopped[0].threadId, result.childThreadId);

    // The resume
    const toParent = runner.sentTo('lead');
    equal('the parent is written to exactly once', toParent.length, 1);
    check('with the outcome', toParent[0].includes('COMPLETED'));
    check('and the summary', toParent[0].includes('Added the route and its guard.'));
    check('naming the child thread', toParent[0].includes(result.childThreadId));
    equal('and the parent is no longer parked', service.getParentState('lead'), 'ACTIVE');

    // The events
    const types = recorder.events.map(event => event.type);
    check('the delegation was announced', types.includes(DELEGATION_STARTED_EVENT));
    check('the parent’s state moved', types.includes(DELEGATION_PARENT_STATE_EVENT));
    check('the child’s state moved', types.includes(DELEGATION_CHILD_STATE_EVENT));
    check('and the outcome was published', types.includes(DELEGATION_COMPLETED_EVENT));

    const started = recorder.events.find(event => event.type === DELEGATION_STARTED_EVENT)!;
    equal('the started event routes to the parent’s room', started.payload.threadId, 'lead');
    equal('and names the child', started.payload.childThreadId, result.childThreadId);
    equal('with the project', started.payload.projectId, PROJECT_ID);

    const parentStates = recorder.events
      .filter(event => event.type === DELEGATION_PARENT_STATE_EVENT)
      .map(event => event.payload.state);
    equal('the parent waits and is then released', parentStates, ['WAITING_FOR_CHILD', 'ACTIVE']);

    const childStates = recorder.events
      .filter(event => event.type === DELEGATION_CHILD_STATE_EVENT)
      .map(event => event.payload.state);
    equal('the child runs through its own states', childStates, ['STARTING', 'ACTIVE', 'COMPLETED']);

    const completed = recorder.events.find(event => event.type === DELEGATION_COMPLETED_EVENT)!;
    equal('the completion carries the whole result', completed.payload.result.childThreadId, result.childThreadId);
  }

  describe('listChildren');
  {
    const children = service.listChildren('lead');
    equal('the parent knows what it delegated', children.length, 1);
    equal('and which thread it was', children[0].threadId, firstChild[0]);
    equal('with the role', children[0].role, 'Senior Backend Engineer');
    equal('the outcome', children[0].status, 'COMPLETED');
    equal('and the task it was given', children[0].taskDescription, 'Add the delegation route.');
    equal('a thread that delegated nothing has no children', service.listChildren('d3').length, 0);
    equal('and neither does one that does not exist', service.listChildren('nope').length, 0);
  }

  // --- Failure paths ----------------------------------------------------------
  describe('a child that crashes still releases the parent');
  {
    runner.reset();
    insertThread('lead-2', 'Lead session 2');
    runner.reply = threadId => {
      emitAgentMessage(threadId, 'Starting.');
      emitStatus(threadId, 'error', 'Agent crashed repeatedly and cannot be restarted.');
    };

    const result = await service.delegateTask({
      parentThreadId: 'lead-2',
      targetRole: 'DevOps Engineer',
      taskDescription: 'Fix the pipeline.'
    });

    equal('the delegation reports FAILED', result.status, 'FAILED');
    check('the summary explains why', result.summary.includes('crashed'));
    equal('the parent is released', service.getParentState('lead-2'), 'ACTIVE');
    const toParent = runner.sentTo('lead-2');
    equal('and told once', toParent.length, 1);
    check('that it failed', toParent[0].includes('FAILED'));
    check('and what to do about it', toParent[0].includes('did not complete'));
    equal('the failure is recorded on the child row', JSON.parse(threadRow(result.childThreadId).delegation_context_json).status, 'FAILED');
    equal('the child session is stopped anyway', runner.stopped.length, 1);
  }

  describe('a child that never answers times out');
  {
    runner.reset();
    insertThread('lead-3', 'Lead session 3');
    runner.reply = null; // the child says nothing at all

    const startedAt = Date.now();
    const result = await service.delegateTask({
      parentThreadId: 'lead-3',
      targetRole: 'QA Engineer',
      taskDescription: 'Run the suite.',
      timeoutMs: 150
    });

    equal('the status says so', result.status, 'TIMEOUT');
    check('rather than being folded into a failure', result.status !== 'FAILED');
    check('it waited roughly the timeout', Date.now() - startedAt >= 140);
    check('the summary names the timeout', /did not finish within/.test(result.summary));
    equal('the parent is released', service.getParentState('lead-3'), 'ACTIVE');
    check('and told', runner.sentTo('lead-3')[0].includes('TIMEOUT'));
  }

  describe('a session that cannot start at all');
  {
    runner.reset();
    insertThread('lead-4', 'Lead session 4');
    runner.failOnStart = true;

    const result = await service.delegateTask({
      parentThreadId: 'lead-4',
      targetRole: 'QA Engineer',
      taskDescription: 'Run the suite.',
      timeoutMs: 5000
    });

    equal('is a failure, not a hang', result.status, 'FAILED');
    check('with the reason', result.summary.includes('could not be started'));
    equal('and the parent is still released', service.getParentState('lead-4'), 'ACTIVE');
    equal('and told', runner.sentTo('lead-4').length, 1);
  }

  describe('a session that reports it could not launch');
  {
    runner.reset();
    insertThread('lead-5', 'Lead session 5');
    // AgentService's failure path publishes an idle status with the reason in
    // the message; without special handling that reads as a quiet child.
    runner.reply = threadId => emitStatus(threadId, 'idle', 'Error starting agent: spawn ENOENT. Is the agent installed?');

    const result = await service.delegateTask({
      parentThreadId: 'lead-5',
      targetRole: 'QA Engineer',
      taskDescription: 'Run the suite.',
      timeoutMs: 5000
    });

    equal('is recognised as a failure rather than waiting out the timeout', result.status, 'FAILED');
    check('and repeats what the Core said', result.summary.includes('Is the agent installed?'));
  }

  describe('the startup idle a session reports before it has done anything');
  {
    runner.reset();
    insertThread('lead-6', 'Lead session 6');
    runner.reply = threadId => {
      emitStatus(threadId, 'idle', 'Agent ready');
      emitStatus(threadId, 'working', '');
      setTimeout(() => {
        emitAgentMessage(threadId, 'SUMMARY: took a moment.');
        emitStatus(threadId, 'idle');
      }, 30);
    };

    const result = await service.delegateTask({
      parentThreadId: 'lead-6',
      targetRole: 'QA Engineer',
      taskDescription: 'Run the suite.',
      timeoutMs: 3000
    });

    equal('does not end the delegation early', result.status, 'COMPLETED');
    equal('and the real answer is the one returned', result.summary, 'took a moment.');
  }

  describe('events for other threads are ignored');
  {
    runner.reset();
    insertThread('lead-7', 'Lead session 7');
    runner.reply = threadId => {
      // Another thread's session, talking at the same time.
      emitAgentMessage('lead', 'Unrelated chatter from a sibling thread.');
      emitStatus('lead', 'idle');
      emitAgentMessage(threadId, 'SUMMARY: mine.');
      emitStatus(threadId, 'idle');
    };

    const result = await service.delegateTask({
      parentThreadId: 'lead-7',
      targetRole: 'QA Engineer',
      taskDescription: 'Run the suite.',
      timeoutMs: 3000
    });

    equal('the child’s own output is what is collected', result.summary, 'mine.');
    check('and the sibling’s is not', !result.output.includes('Unrelated chatter'));
  }

  describe('one delegation at a time per parent');
  {
    runner.reset();
    insertThread('lead-8', 'Lead session 8');
    let release: (() => void) | null = null;
    runner.reply = threadId => {
      release = () => {
        emitAgentMessage(threadId, 'SUMMARY: done.');
        emitStatus(threadId, 'idle');
      };
    };

    const pending = service.delegateTask({
      parentThreadId: 'lead-8',
      targetRole: 'QA Engineer',
      taskDescription: 'First.',
      timeoutMs: 3000
    });

    equal('the parent reads as waiting', service.getParentState('lead-8'), 'WAITING_FOR_CHILD');
    check('and knows which child', typeof service.getPendingChild('lead-8') === 'string');
    equal(
      'a second delegation from the same parent is refused',
      await codeOf(() =>
        service.delegateTask({
          parentThreadId: 'lead-8',
          targetRole: 'QA Engineer',
          taskDescription: 'Second.'
        })
      ),
      'ALREADY_DELEGATING'
    );

    release!();
    const result = await pending;
    equal('the first one still completes', result.status, 'COMPLETED');
    equal('and the parent is free again', service.getParentState('lead-8'), 'ACTIVE');
    equal('with nothing pending', service.getPendingChild('lead-8'), undefined);
  }

  // --- Cancellation (P7-03) ---------------------------------------------------
  describe('cancelDelegation — stopping a child from the parent');
  {
    runner.reset();
    insertThread('lead-cancel', 'Lead awaiting a cancellation');
    runner.reply = null; // a child that will never answer on its own

    const recorder = recordEvents([
      DELEGATION_CHILD_STATE_EVENT,
      DELEGATION_PARENT_STATE_EVENT,
      DELEGATION_COMPLETED_EVENT
    ]);

    // A ten-minute timeout, so anything that returns here returned because it
    // was cancelled and not because it was waited out.
    const pending = service.delegateTask({
      parentThreadId: 'lead-cancel',
      targetRole: 'QA Engineer',
      taskDescription: 'Run a suite that never finishes.',
      timeoutMs: 600000
    });
    await pause();

    equal('the parent is parked to begin with', service.getParentState('lead-cancel'), 'WAITING_FOR_CHILD');
    const childThreadId = service.getPendingChild('lead-cancel');
    check('behind a child', typeof childThreadId === 'string');

    const startedAt = Date.now();
    const cancelled = await service.cancelDelegation('lead-cancel', 'The child was looping on the same tool.');
    const settled = await pending;
    recorder.stop();

    check('it answers immediately rather than at the timeout', Date.now() - startedAt < 5000);
    equal('a cancelled delegation is FAILED', cancelled.status, 'FAILED');
    equal('the summary is the reason it was given', cancelled.summary, 'The child was looping on the same tool.');
    equal('it names the child that was stopped', cancelled.childThreadId, childThreadId);
    equal('and the delegation itself settles as the same thing', settled.status, 'FAILED');
    equal('for the same child', settled.childThreadId, cancelled.childThreadId);
    equal('with the same summary', settled.summary, cancelled.summary);

    // The child process
    equal('the child session is stopped', runner.stopped.length, 1);
    equal('and it is the child that stopped', runner.stopped[0].threadId, childThreadId);

    // The parent
    equal('the parent is released', service.getParentState('lead-cancel'), 'ACTIVE');
    equal('with nothing pending', service.getPendingChild('lead-cancel'), undefined);
    const toParent = runner.sentTo('lead-cancel');
    equal('and told once', toParent.length, 1);
    check('that the delegation failed', toParent[0].includes('FAILED'));
    check('and why', toParent[0].includes('The child was looping on the same tool.'));

    // Storage
    const stored = JSON.parse(threadRow(childThreadId!).delegation_context_json);
    equal('the child row records the failure', stored.status, 'FAILED');
    equal('with the cancellation reason as its summary', stored.summary, 'The child was looping on the same tool.');
    check('and a finish time', typeof stored.finishedAt === 'number');
    equal('its brief is left intact', stored.taskDescription, 'Run a suite that never finishes.');

    // The events a connected dashboard needs to clear its banner
    const parentStates = recorder.events
      .filter(event => event.type === DELEGATION_PARENT_STATE_EVENT)
      .map(event => event.payload.state);
    equal('the parent waits and is then released', parentStates, ['WAITING_FOR_CHILD', 'ACTIVE']);
    equal(
      'the child ends in a terminal state',
      recorder.events
        .filter(event => event.type === DELEGATION_CHILD_STATE_EVENT)
        .map(event => event.payload.state),
      ['STARTING', 'ACTIVE', 'FAILED']
    );
    const completed = recorder.events.filter(event => event.type === DELEGATION_COMPLETED_EVENT);
    equal('the outcome is published exactly once', completed.length, 1);
    equal('carrying the cancellation', completed[0].payload.result.summary, cancelled.summary);
    equal('and routed to the parent’s room', completed[0].payload.threadId, 'lead-cancel');
  }

  describe('cancelDelegation — stopping a child from the child');
  {
    runner.reset();
    insertThread('lead-cancel-2', 'Lead whose child is stopped directly');
    runner.reply = null;

    const pending = service.delegateTask({
      parentThreadId: 'lead-cancel-2',
      targetRole: 'QA Engineer',
      taskDescription: 'Another one that never finishes.',
      timeoutMs: 600000
    });
    await pause();

    const childThreadId = service.getPendingChild('lead-cancel-2')!;
    const cancelled = await service.cancelDelegation(childThreadId);
    await pending;

    equal('the child’s own id reaches the same delegation', cancelled.childThreadId, childThreadId);
    equal('and it is cancelled', cancelled.status, 'FAILED');
    equal('with the default reason when none was given', cancelled.summary, 'Delegation cancelled by operator');
    equal('the parent behind it is released too', service.getParentState('lead-cancel-2'), 'ACTIVE');
    equal('and its session is stopped', runner.stopped[0]?.threadId, childThreadId);
  }

  describe('cancelDelegation — a cancelled review has not passed');
  {
    runner.reset();
    insertThread('impl-cancel', 'Implementer awaiting a review');
    runner.reply = null;

    const pending = service.requestReview({
      parentThreadId: 'impl-cancel',
      diff: 'diff --git a b',
      timeoutMs: 600000
    });
    await pause();

    const cancelled = await service.cancelDelegation('impl-cancel', 'Reviewing the wrong branch.');
    await pending;

    equal('the review is FAILED', cancelled.status, 'FAILED');
    equal('and the verdict is NEEDS_FIX', cancelled.verdict, 'NEEDS_FIX');
    equal(
      'which is what is stored',
      JSON.parse(threadRow(cancelled.childThreadId).delegation_context_json).verdict,
      'NEEDS_FIX'
    );
    check('the parent is told the verdict', runner.sentTo('impl-cancel')[0].includes('VERDICT: NEEDS_FIX'));
  }

  describe('cancelDelegation — two operators clicking at once');
  {
    runner.reset();
    insertThread('lead-cancel-3', 'Lead cancelled twice');
    runner.reply = null;

    const recorder = recordEvents([DELEGATION_COMPLETED_EVENT]);
    const pending = service.delegateTask({
      parentThreadId: 'lead-cancel-3',
      targetRole: 'QA Engineer',
      taskDescription: 'Cancelled from two places.',
      timeoutMs: 600000
    });
    await pause();

    const childThreadId = service.getPendingChild('lead-cancel-3')!;
    const [first, second] = await Promise.all([
      service.cancelDelegation('lead-cancel-3', 'First reason.'),
      service.cancelDelegation(childThreadId, 'Second reason.')
    ]);
    await pending;
    recorder.stop();

    equal('both callers get the same outcome', first.childThreadId, second.childThreadId);
    equal('with the same status', [first.status, second.status], ['FAILED', 'FAILED']);
    equal('the first reason is the one recorded', first.summary, 'First reason.');
    equal('for both of them', second.summary, 'First reason.');
    equal('the child is stopped once, not twice', runner.stopped.length, 1);
    equal('the parent is resumed once', runner.sentTo('lead-cancel-3').length, 1);
    equal('and the outcome is published once', recorder.events.length, 1);

    // A third one, long after the fact.
    const late = await service.cancelDelegation(childThreadId, 'Too late.');
    equal('a cancellation that arrives after the fact does not throw', late.status, 'FAILED');
    equal('it answers with what the child settled as', late.summary, 'First reason.');
    equal('and nothing is stopped a second time', runner.stopped.length, 1);
  }

  describe('cancelDelegation — a cancellation that beats the watch');
  {
    runner.reset();
    insertThread('lead-cancel-4', 'Lead cancelled before its child started');
    runner.reply = null;

    // The one moment the abort has not been armed yet is while the child's
    // STARTING event is still being published, because the EventBus delivers
    // synchronously. A subscriber cancelling from there is the narrowest race
    // this has, and a parent left parked until the timeout is what losing it
    // would cost.
    let raced: Promise<{ childThreadId: string }> | null = null;
    const early = (event: AnyEvent) => {
      if (
        event.payload?.state === 'STARTING' &&
        event.payload?.parentThreadId === 'lead-cancel-4' &&
        !raced
      ) {
        raced = service.cancelDelegation('lead-cancel-4', 'Stopped before it started.');
      }
    };
    eventBus.subscribe(DELEGATION_CHILD_STATE_EVENT, early);

    const result = await service.delegateTask({
      parentThreadId: 'lead-cancel-4',
      targetRole: 'QA Engineer',
      taskDescription: 'Should never run.',
      timeoutMs: 600000
    });
    eventBus.unsubscribe(DELEGATION_CHILD_STATE_EVENT, early);

    equal('the delegation does not wait out its timeout', result.status, 'FAILED');
    equal('the reason is the operator’s', result.summary, 'Stopped before it started.');
    equal('no agent session was ever started for it', runner.started.length, 0);
    equal('so there is no subprocess to leave behind', runner.sentTo(result.childThreadId).length, 0);
    equal('and the caller that cancelled gets the same result', (await raced!).childThreadId, result.childThreadId);
    equal('the parent is released regardless', service.getParentState('lead-cancel-4'), 'ACTIVE');
  }

  describe('cancelDelegation — what it refuses');
  {
    equal(
      'a thread that is neither waiting nor delegated',
      await codeOf(() => service.cancelDelegation('lead-3')),
      'NOT_DELEGATING'
    );
    equal(
      'a thread that does not exist',
      await codeOf(() => service.cancelDelegation('ghost')),
      'THREAD_NOT_FOUND'
    );
    equal('and no thread at all', await codeOf(() => service.cancelDelegation('')), 'INVALID_INPUT');
  }

  // --- Validation --------------------------------------------------------------
  describe('delegateTask — what it refuses');
  {
    runner.reset();
    runner.reply = threadId => {
      emitAgentMessage(threadId, 'SUMMARY: ok.');
      emitStatus(threadId, 'idle');
    };

    equal(
      'an unknown parent thread',
      await codeOf(() =>
        service.delegateTask({ parentThreadId: 'ghost', targetRole: 'QA Engineer', taskDescription: 'x' })
      ),
      'THREAD_NOT_FOUND'
    );
    equal(
      'a missing task',
      await codeOf(() => service.delegateTask({ parentThreadId: 'lead', targetRole: 'QA Engineer', taskDescription: '' })),
      'INVALID_INPUT'
    );
    equal(
      'a missing role',
      await codeOf(() => service.delegateTask({ parentThreadId: 'lead', taskDescription: 'x' })),
      'INVALID_INPUT'
    );
    equal(
      'a role nothing plays',
      await codeOf(() =>
        service.delegateTask({ parentThreadId: 'lead', targetRole: 'Chief Vibes Officer', taskDescription: 'x' })
      ),
      'PROFILE_NOT_FOUND'
    );
    equal(
      'a profile id that does not exist',
      await codeOf(() =>
        service.delegateTask({ parentThreadId: 'lead', profileId: 'nope', taskDescription: 'x' })
      ),
      'PROFILE_NOT_FOUND'
    );
    equal(
      'a negative timeout',
      await codeOf(() =>
        service.delegateTask({
          parentThreadId: 'lead',
          targetRole: 'QA Engineer',
          taskDescription: 'x',
          timeoutMs: -5
        })
      ),
      'INVALID_INPUT'
    );
    equal('and none of them started anything', runner.started.length, 0);
  }

  describe('role resolution');
  {
    runner.reset();
    runner.reply = threadId => {
      emitAgentMessage(threadId, 'SUMMARY: ok.');
      emitStatus(threadId, 'idle');
    };
    insertThread('lead-9', 'Lead session 9');

    const exact = await service.delegateTask({
      parentThreadId: 'lead-9',
      targetRole: 'security auditor',
      taskDescription: 'Audit the route.'
    });
    equal('a role matches case-insensitively', exact.profileId, 'builtin-security-auditor');

    const byId = await service.delegateTask({
      parentThreadId: 'lead-9',
      profileId: 'builtin-qa-engineer',
      taskDescription: 'Test it.'
    });
    equal('an explicit profile id wins', byId.profileId, 'builtin-qa-engineer');
    equal('and both children are recorded', service.listChildren('lead-9').length, 2);
  }

  // --- Review ------------------------------------------------------------------
  describe('requestReview');
  {
    runner.reset();
    insertThread('impl', 'Implementer session');
    runner.reply = threadId => {
      emitAgentMessage(
        threadId,
        'Read the diff.\nNo traversal found.\nSUMMARY: The guard is correct.\nVERDICT: PASS\n'
      );
      emitStatus(threadId, 'idle');
    };

    const review = await service.requestReview({
      parentThreadId: 'impl',
      diff: '--- a/x.ts\n+++ b/x.ts\n+const safe = true;',
      criteria: ['path traversal', 'authorization']
    });

    equal('a review completes', review.status, 'COMPLETED');
    equal('with a verdict', review.verdict, 'PASS');
    equal('it goes to the reviewer role by default', review.role, 'Security Auditor');
    const brief = runner.sentTo(review.childThreadId)[0];
    check('the diff is in the brief', brief.includes('const safe = true;'));
    check('and the criteria are listed', brief.includes('- path traversal'));
    check('the reviewer is asked for a verdict', brief.includes('VERDICT: PASS or NEEDS_FIX'));
    check('the parent is told the verdict', runner.sentTo('impl')[0].includes('VERDICT: PASS'));
    equal('and it is stored', JSON.parse(threadRow(review.childThreadId).delegation_context_json).verdict, 'PASS');

    runner.reset();
    runner.reply = threadId => {
      emitAgentMessage(threadId, 'SUMMARY: the path is built from request input.\nVERDICT: NEEDS_FIX\n');
      emitStatus(threadId, 'idle');
    };
    const rejected = await service.requestReview({ parentThreadId: 'impl', diff: 'whatever' });
    equal('a reviewer can refuse a change', rejected.verdict, 'NEEDS_FIX');

    runner.reset();
    runner.reply = null;
    const inconclusive = await service.requestReview({
      parentThreadId: 'impl',
      diff: 'whatever',
      timeoutMs: 120
    });
    equal('a review that never finished is not a pass', inconclusive.verdict, 'NEEDS_FIX');
    equal('and says it timed out', inconclusive.status, 'TIMEOUT');

    equal(
      'a review with nothing to review is refused',
      await codeOf(() => service.requestReview({ parentThreadId: 'impl', diff: '' })),
      'INVALID_INPUT'
    );
  }

  // --- The meta-tools ----------------------------------------------------------
  describe('who is offered the meta-tools');
  {
    equal('a lead delegates', canProfileDelegate({ role: 'Tech Lead' }), true);
    equal('so does an architect', canProfileDelegate({ role: 'Lead Architect' }), true);
    equal('an implementer does not', canProfileDelegate({ role: 'Senior Backend Engineer' }), false);
    equal('nor does a reviewer', canProfileDelegate({ role: 'Security Auditor' }), false);
    // Delegation is something a role does, so a session with no role is not
    // handed it — and a catalogue that was correct before P7-01 stays correct.
    equal('and a session with no persona does not', canProfileDelegate(null), false);
    equal('a role is matched loosely', isDelegationCapableRole('Lead Architect (Platform)'), true);
    equal('but not by accident', isDelegationCapableRole('QA Engineer'), false);
    equal('an empty role is nobody', isDelegationCapableRole(''), false);

    const bridge = new McpAgentBridge();
    const forLead = bridge.getDelegationTools({ role: 'Tech Lead', name: 'Tech Lead' });
    equal('the lead is given both tools', forLead.map((tool: { name: string }) => tool.name), [
      DELEGATE_TASK_TOOL,
      REQUEST_REVIEW_TOOL
    ]);
    equal('marked as delegation rather than MCP', forLead[0].kind, 'delegation');
    check('with a schema an agent can fill in', JSON.stringify(forLead[0].inputSchema).includes('role'));
    equal('an auditor is given none', bridge.getDelegationTools({ role: 'Security Auditor' }).length, 0);
    equal('and neither is an unprofiled session', bridge.getDelegationTools(null).length, 0);

    equal('the tool names are recognised', isDelegationToolName(DELEGATE_TASK_TOOL), true);
    equal('and other names are not', isDelegationToolName('mcp__fs__read'), false);
  }

  describe('executeDelegationTool');
  {
    runner.reset();
    insertThread('lead-tools', 'Lead with tools');
    runner.reply = threadId => {
      emitAgentMessage(threadId, 'SUMMARY: shipped it.\nARTIFACTS: none\n');
      emitStatus(threadId, 'idle');
    };

    const ok = await service.executeDelegationTool(
      DELEGATE_TASK_TOOL,
      { role: 'Senior Backend Engineer', task: 'Add the endpoint.', context: 'Use the existing service.' },
      { threadId: 'lead-tools' }
    );
    equal('a delegation through the tool is not an error', ok.isError, false);
    check('and the answer names the outcome', ok.text.includes('COMPLETED'));
    check('with the summary', ok.text.includes('shipped it.'));
    equal('"none" is not an artifact', service.listChildren('lead-tools').length, 1);
    // The adapter writes this text into the parent's session as the tool
    // result. Sending it again as a message would have the agent read the same
    // answer twice and take the second for new work.
    equal('the parent is not written to twice', runner.sentTo('lead-tools').length, 0);
    equal('but it is still released', service.getParentState('lead-tools'), 'ACTIVE');

    const review = await service.executeDelegationTool(
      REQUEST_REVIEW_TOOL,
      { diff: 'diff --git a b', criteria: ['injection'] },
      { threadId: 'lead-tools' }
    );
    equal('a review through the tool works too', review.isError, false);
    check('and carries a verdict', /VERDICT: (PASS|NEEDS_FIX)/.test(review.text));

    const refused = await service.executeDelegationTool(
      DELEGATE_TASK_TOOL,
      { role: 'Nobody At All', task: 'x' },
      { threadId: 'lead-tools' }
    );
    equal('an unresolvable role comes back as an error, not an exception', refused.isError, true);
    check('naming what is available', refused.text.includes('Available roles'));

    const noThread = await service.executeDelegationTool(DELEGATE_TASK_TOOL, {}, { threadId: '' });
    equal('a call from nowhere is refused', noThread.isError, true);

    const notMine = await service.executeDelegationTool('mcp__fs__read', {}, { threadId: 'lead-tools' });
    equal('and so is a tool that is not ours', notMine.isError, true);
  }

  describe('the bridge routes delegation calls');
  {
    const bridge = new McpAgentBridge();
    const orphan = await bridge.executeTool(DELEGATE_TASK_TOOL, { role: 'QA Engineer', task: 'x' }, undefined, undefined, {});
    equal('a delegation with no thread behind it is an error', orphan.isError, true);
    check('that says why', orphan.text.includes('inside a thread'));
    equal('and it is answered, not thrown', orphan.name, DELEGATE_TASK_TOOL);
  }

  describe('the gateway hands the calling thread down to the bridge');
  {
    // Which thread is delegating is the Core's knowledge. If the gateway ever
    // stopped passing it, an agent could only delegate by naming a thread in its
    // own arguments — which is precisely what must not be possible.
    let seen: any = null;
    const stubBridge = {
      async executeTool(name: string, args: any, workspaceId?: string, workspacePath?: string, context?: any) {
        seen = context;
        return { name, isError: false, text: 'ok' };
      }
    };
    const stubApprovals = {
      evaluateToolSecurity: () => ({
        riskLevel: 'low',
        isPathTraversal: false,
        warnings: [],
        requiresExplicitHumanApproval: false
      })
    };
    const gateway = new McpToolGateway(stubBridge, stubApprovals);
    await gateway.executeForAgent(
      { projectId: PROJECT_ID, threadId: 'lead', workspacePath: tmpDir },
      DELEGATE_TASK_TOOL,
      { role: 'QA Engineer', task: 'x' }
    );
    equal('the thread comes from the session, not the arguments', seen?.threadId, 'lead');
    equal('and so does the project', seen?.projectId, PROJECT_ID);
  }

  // --- Pure helpers -------------------------------------------------------------
  describe('reading a child’s report');
  {
    equal('a tagged line is read', parseTaggedLine('SUMMARY: did the thing', 'SUMMARY'), 'did the thing');
    equal(
      'the last one wins, because agents restate themselves',
      parseTaggedLine('SUMMARY: first\nmore\nSUMMARY: final', 'SUMMARY'),
      'final'
    );
    equal('an absent tag is undefined', parseTaggedLine('nothing here', 'SUMMARY'), undefined);
    equal('artifacts are split', parseArtifacts('ARTIFACTS: a.ts, b.ts'), ['a.ts', 'b.ts']);
    equal('"none" means none', parseArtifacts('ARTIFACTS: none'), []);
    equal('and so does an absent line', parseArtifacts('nothing'), []);

    equal('a declared verdict is taken', readVerdict('blah\nVERDICT: PASS'), 'PASS');
    equal('a declared refusal too', readVerdict('VERDICT: NEEDS_FIX'), 'NEEDS_FIX');
    equal('an undeclared review is read from its body', readVerdict('This looks fine, LGTM.'), 'PASS');
    equal('anything ambiguous is not a pass', parseReviewVerdict('I could not tell.'), 'NEEDS_FIX');
    equal('and neither is silence', parseReviewVerdict(''), 'NEEDS_FIX');
    equal('a mixed answer errs toward NEEDS_FIX', parseReviewVerdict('Mostly pass, but needs fix in one place.'), 'NEEDS_FIX');
  }

  describe('the brief and the report');
  {
    const brief = formatChildBrief(
      { role: 'QA Engineer' },
      {
        parentThreadId: 'lead',
        depth: 2,
        kind: 'TASK',
        taskDescription: 'Write the test.',
        requestedAt: Date.now()
      }
    );
    check('the child is told its role', brief.includes('QA Engineer'));
    check('and how deep it is', brief.includes(`depth 2 of ${MAX_DELEGATION_DEPTH}`));
    check('and told not to delegate by reflex', brief.includes('Do the work yourself'));

    const report = formatDelegationReport({
      childThreadId: 'child-1',
      status: 'COMPLETED',
      summary: 'Everything passed.',
      output: 'long transcript',
      role: 'QA Engineer',
      artifacts: ['a.ts']
    });
    check('the parent is told who answered', report.includes('QA Engineer'));
    check('what happened', report.includes('COMPLETED'));
    check('the summary', report.includes('Everything passed.'));
    check('and the artifacts', report.includes('a.ts'));
    check('the raw transcript is not dumped into the parent', !report.includes('long transcript'));
  }

  // --- REST ---------------------------------------------------------------------
  describe('the REST surface');
  {
    const app = Fastify();
    // Stands in for authMiddleware, which is registered globally in index.ts.
    app.addHook('onRequest', async (request: { headers: Record<string, string>; user?: unknown }) => {
      if (request.headers['x-anonymous'] !== 'yes') request.user = { id: 'test-user' };
    });
    await app.register(delegationRoutes);
    await app.ready();

    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/threads/lead/children',
      headers: { 'x-anonymous': 'yes' }
    });
    equal('an anonymous read is 401', anonymous.statusCode, 401);

    const children = await app.inject({ method: 'GET', url: '/api/v1/threads/lead/children' });
    equal('listing children is 200', children.statusCode, 200);
    equal('and they are there', children.json().children.length >= 1, true);
    equal('with the thread’s own depth', children.json().depth, 0);
    equal('and its state', children.json().parentState, 'ACTIVE');

    const anonymousWrite = await app.inject({
      method: 'POST',
      url: '/api/v1/threads/lead/delegate',
      payload: { role: 'QA Engineer', task: 'x' },
      headers: { 'x-anonymous': 'yes' }
    });
    equal('an anonymous delegation is 401', anonymousWrite.statusCode, 401);

    const noBody = await app.inject({ method: 'POST', url: '/api/v1/threads/lead/delegate' });
    equal('an empty body is 400', noBody.statusCode, 400);

    const noTask = await app.inject({
      method: 'POST',
      url: '/api/v1/threads/lead/delegate',
      payload: { role: 'QA Engineer' }
    });
    equal('a delegation with no task is 400', noTask.statusCode, 400);

    const ghost = await app.inject({
      method: 'POST',
      url: '/api/v1/threads/ghost/delegate',
      payload: { role: 'QA Engineer', task: 'x' }
    });
    equal('an unknown thread is 404', ghost.statusCode, 404);
    equal('with a code a client can branch on', ghost.json().code, 'THREAD_NOT_FOUND');

    const unknownRole = await app.inject({
      method: 'POST',
      url: '/api/v1/threads/lead/delegate',
      payload: { role: 'Chief Vibes Officer', task: 'x' }
    });
    equal('an unknown role is 404', unknownRole.statusCode, 404);

    const tooDeep = await app.inject({
      method: 'POST',
      url: '/api/v1/threads/d3/delegate',
      payload: { role: 'QA Engineer', task: 'x' }
    });
    equal('a delegation past the depth bound is 409', tooDeep.statusCode, 409);
    equal('and says which rule it broke', tooDeep.json().code, 'DEPTH_EXCEEDED');

    // The happy path over HTTP, against the *default* runner: nothing here is
    // faked but the agent itself, so the client events the runner publishes are
    // the ones AgentService would receive in production. The test plays the part
    // AgentService plays.
    const spawned: string[] = [];
    const onCommand = (event: AnyEvent) => {
      if (event.payload?.command === 'start') spawned.push(event.payload.threadId);
    };
    const onChat = (event: AnyEvent) => {
      const threadId = event.payload?.threadId;
      if (!spawned.includes(threadId)) return;
      setTimeout(() => {
        emitAgentMessage(threadId, 'SUMMARY: reviewed over HTTP.\nARTIFACTS: none');
        emitStatus(threadId, 'idle');
      }, 5);
    };
    eventBus.subscribe('client.command', onCommand);
    eventBus.subscribe('client.chat_message', onChat);

    insertThread('rest-parent', 'REST parent');
    const delegated = await app.inject({
      method: 'POST',
      url: '/api/v1/threads/rest-parent/delegate',
      payload: { role: 'QA Engineer', task: 'Run the suite over HTTP.', timeoutMs: 4000 }
    });

    eventBus.unsubscribe('client.command', onCommand);
    eventBus.unsubscribe('client.chat_message', onChat);

    equal('a delegation over HTTP is 200', delegated.statusCode, 200);
    equal('and it ran to completion', delegated.json().result.status, 'COMPLETED');
    equal('through the default runner', spawned.length, 1);
    equal('with the summary the child wrote', delegated.json().result.summary, 'reviewed over HTTP.');
    equal(
      'and the parent thread now has a child',
      agentDelegationService.listChildren('rest-parent').length,
      1
    );

    // --- Cancellation over HTTP (P7-03) ---
    const anonymousCancel = await app.inject({
      method: 'POST',
      url: '/api/v1/threads/lead/delegate/cancel',
      headers: { 'x-anonymous': 'yes' }
    });
    equal('an anonymous cancellation is 401', anonymousCancel.statusCode, 401);

    const ghostCancel = await app.inject({ method: 'POST', url: '/api/v1/threads/ghost/delegate/cancel' });
    equal('cancelling an unknown thread is 404', ghostCancel.statusCode, 404);

    const idleCancel = await app.inject({ method: 'POST', url: '/api/v1/threads/lead/delegate/cancel' });
    equal('cancelling a thread that is not delegating is 409', idleCancel.statusCode, 409);
    equal('with a code a client can branch on', idleCancel.json().code, 'NOT_DELEGATING');

    // A child nothing ever answers for, cancelled while its delegation request
    // is still open. Only `start` is observed here — replying would finish it.
    const idle: string[] = [];
    const onStart = (event: AnyEvent) => {
      if (event.payload?.command === 'start') idle.push(event.payload.threadId);
    };
    eventBus.subscribe('client.command', onStart);

    insertThread('rest-cancel', 'REST cancel parent');
    const inFlight = app.inject({
      method: 'POST',
      url: '/api/v1/threads/rest-cancel/delegate',
      payload: { role: 'QA Engineer', task: 'Never finishes.', timeoutMs: 600000 }
    });
    await pause(30);

    equal('the delegation parked its parent', agentDelegationService.getParentState('rest-cancel'), 'WAITING_FOR_CHILD');

    const cancelledOverHttp = await app.inject({
      method: 'POST',
      url: '/api/v1/threads/rest-cancel/delegate/cancel',
      payload: { reason: 'Stopped from the dashboard.' }
    });
    const delegationResponse = await inFlight;
    eventBus.unsubscribe('client.command', onStart);

    equal('cancelling over HTTP is 200', cancelledOverHttp.statusCode, 200);
    equal('and says it worked', cancelledOverHttp.json().success, true);
    equal('the outcome is a failure', cancelledOverHttp.json().result.status, 'FAILED');
    equal('naming the reason given', cancelledOverHttp.json().result.summary, 'Stopped from the dashboard.');
    equal('the open delegation returns the same outcome', delegationResponse.json().result.status, 'FAILED');
    equal(
      'for the same child',
      delegationResponse.json().result.childThreadId,
      cancelledOverHttp.json().result.childThreadId
    );
    equal('the parent is released', agentDelegationService.getParentState('rest-cancel'), 'ACTIVE');
    equal('and the child that ran is the one that was started', idle, [
      cancelledOverHttp.json().result.childThreadId
    ]);

    const settledChildId = cancelledOverHttp.json().result.childThreadId;
    const alias = await app.inject({
      method: 'POST',
      url: `/api/v1/threads/${settledChildId}/delegation/cancel`
    });
    equal('the /delegation/cancel alias answers too', alias.statusCode, 200);
    equal('idempotently, with what the child settled as', alias.json().result.status, 'FAILED');
    equal('and the reason it settled with', alias.json().result.summary, 'Stopped from the dashboard.');

    const noReason = await app.inject({
      method: 'POST',
      url: `/api/v1/threads/${settledChildId}/delegate/cancel`
    });
    equal('a cancellation with no body is accepted', noReason.statusCode, 200);

    await app.close();
  }

  // --- Startup recovery (P7-02) ----------------------------------------------
  describe('recoverDelegations settles children the Core stopped on top of');
  {
    const db = dbService.getDb();

    // Three shapes a restart can leave behind: a child mid-flight with a brief,
    // one whose row never got a readable brief at all, and one that finished
    // properly before the process went away.
    insertThread('rec-parent', 'Parent');
    insertThread('rec-running', 'Interrupted child', 'rec-parent');
    insertThread('rec-blank', 'Child with no brief', 'rec-parent');
    insertThread('rec-review', 'Interrupted review', 'rec-parent');
    insertThread('rec-done', 'Finished child', 'rec-parent');
    insertThread('rec-root', 'An ordinary root thread');

    db.prepare('UPDATE threads SET delegation_context_json = ? WHERE id = ?').run(
      JSON.stringify({
        parentThreadId: 'rec-parent',
        depth: 1,
        kind: 'TASK',
        taskDescription: 'Harden the upload route.',
        role: 'Security Auditor',
        requestedAt: 111
      }),
      'rec-running'
    );
    db.prepare('UPDATE threads SET delegation_context_json = ? WHERE id = ?').run(
      JSON.stringify({
        parentThreadId: 'rec-parent',
        depth: 1,
        kind: 'REVIEW',
        taskDescription: 'Review the diff.',
        requestedAt: 112
      }),
      'rec-review'
    );
    db.prepare('UPDATE threads SET delegation_context_json = ? WHERE id = ?').run(
      JSON.stringify({
        parentThreadId: 'rec-parent',
        depth: 1,
        kind: 'TASK',
        taskDescription: 'Already done.',
        requestedAt: 113,
        status: 'COMPLETED',
        summary: 'It was finished before the restart.',
        finishedAt: 114
      }),
      'rec-done'
    );

    const beforeRoot = threadRow('rec-root').delegation_context_json;
    const childEvents: AnyEvent[] = [];
    const childHandler = (event: AnyEvent) => childEvents.push(event);
    eventBus.subscribe(DELEGATION_CHILD_STATE_EVENT, childHandler);

    const recovered = service.recoverDelegations();

    eventBus.unsubscribe(DELEGATION_CHILD_STATE_EVENT, childHandler);

    // Earlier sections leave their own children behind, so the count is a lower
    // bound; which rows were settled is asserted individually below.
    check(
      'every dangling child is settled, including the three set up here',
      recovered >= 3,
      `recovered ${recovered}`
    );

    const running = JSON.parse(threadRow('rec-running').delegation_context_json);
    equal('an interrupted child is recorded FAILED', running.status, 'FAILED');
    check('with a reason that says what happened', /restart/i.test(running.summary));
    check('and a finish time', typeof running.finishedAt === 'number');
    equal('its brief is left intact', running.taskDescription, 'Harden the upload route.');
    equal('as is the role it ran under', running.role, 'Security Auditor');
    equal('and when it was requested', running.requestedAt, 111);

    const blank = JSON.parse(threadRow('rec-blank').delegation_context_json);
    equal('a child with no readable brief still stops reading as running', blank.status, 'FAILED');
    equal('its parent is taken from the row', blank.parentThreadId, 'rec-parent');
    equal('and no task description is invented', blank.taskDescription, '');

    const review = JSON.parse(threadRow('rec-review').delegation_context_json);
    equal('an interrupted review cannot have passed', review.verdict, 'NEEDS_FIX');

    const done = JSON.parse(threadRow('rec-done').delegation_context_json);
    equal('a child that already finished is untouched', done.status, 'COMPLETED');
    equal('keeping its own summary', done.summary, 'It was finished before the restart.');
    equal('and its own finish time', done.finishedAt, 114);

    equal('a thread with no parent is not a delegation', threadRow('rec-root').delegation_context_json, beforeRoot);

    equal(
      'each settled child is announced',
      childEvents
        .filter(event => String(event.payload.threadId).startsWith('rec-'))
        .map(event => `${event.payload.threadId}:${event.payload.state}`)
        .sort(),
      ['rec-blank:FAILED', 'rec-review:FAILED', 'rec-running:FAILED']
    );
    equal(
      'naming the parent that was waiting on it',
      childEvents.find(event => event.payload.threadId === 'rec-running')?.payload.parentThreadId,
      'rec-parent'
    );

    equal('nothing is left to settle on a second pass', service.recoverDelegations(), 0);

    equal(
      'and the children read as failed to the REST surface',
      service
        .listChildren('rec-parent')
        .map((child: { threadId: string; status: string }) => `${child.threadId}:${child.status}`)
        .sort(),
      ['rec-blank:FAILED', 'rec-done:COMPLETED', 'rec-review:FAILED', 'rec-running:FAILED']
    );
    equal(
      'no parent is left parked after a restart',
      service.getParentState('rec-parent'),
      'ACTIVE'
    );
  }

  describe('the production runner speaks the client protocol');
  {
    const published: AnyEvent[] = [];
    const handler = (event: AnyEvent) => published.push(event);
    eventBus.subscribe('client.command', handler);
    eventBus.subscribe('client.chat_message', handler);

    const production = new EventBusSessionRunner(eventBus);
    production.start({ projectId: PROJECT_ID, threadId: 't-1', profileId: 'p-1', agentType: 'claude' });
    production.send({ projectId: PROJECT_ID, threadId: 't-1', content: 'go' });
    production.stop({ projectId: PROJECT_ID, threadId: 't-1' });

    eventBus.unsubscribe('client.command', handler);
    eventBus.unsubscribe('client.chat_message', handler);

    equal('three events, in order', published.map(event => event.type), [
      'client.command',
      'client.chat_message',
      'client.command'
    ]);
    equal('start carries the profile', published[0].payload.profileId, 'p-1');
    equal('and the parent’s adapter', published[0].payload.agentType, 'claude');
    equal('both commands carry the project AgentService requires', [
      published[0].payload.projectId,
      published[2].payload.projectId
    ], [PROJECT_ID, PROJECT_ID]);
    equal('and the brief goes as a chat message, not raw stdin', published[1].payload.content, 'go');
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
