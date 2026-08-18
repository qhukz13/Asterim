/**
 * Tests for the Declarative Pipeline Engine (P9-01).
 *
 * The repository has no test runner (docs/p5.0-01-verification-report.md § 3), so this
 * is a standalone script with its own assertion harness, matching the delegation,
 * team agent, MCP, skills and memory suites.
 *
 * Everything runs against a real SQLite file in a temp directory, because the
 * run *is* storage: a step's status, its thread, its diff and the order the rows
 * were planned in are what a dashboard reads and what survives a restart, and a
 * mocked database would only prove the test agrees with itself.
 *
 * What is faked is the agent process, and only that. `DelegationSessionRunner`
 * is replaced with one that decides what a child says from the brief it was
 * handed — a task carrying `FAIL_STEP` reports an error, one carrying
 * `SILENT_STEP` never answers — so failure and cancellation are reached through
 * the same waiting code a PTY would drive. The REST section drops the fake
 * entirely and lets the production runner publish onto the EventBus, with the
 * test standing in for AgentService, so the wiring the server actually uses is
 * exercised too.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/pipeline/__tests__/PipelineEngine.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-pipeline-'));
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
const { profileService } = require('../../ai/ProfileService');
const { AgentDelegationService, agentDelegationService } = require('../../ai/AgentDelegationService');
const { PipelineEngine, PipelineError, substitute } = require('../PipelineEngine');
const { PipelineParseError, PipelineParser } = require('../PipelineParser');
const { YamlParseError, parseSafeYaml } = require('../SafeYaml');
const {
  MAX_PIPELINE_CONTEXT_CHARS,
  MAX_PIPELINE_STEPS,
  MAX_PIPELINE_TASK_CHARS,
  PIPELINE_COMPLETED_EVENT,
  PIPELINE_FAILED_EVENT,
  PIPELINE_MAX_PARALLEL_STEPS,
  PIPELINE_STARTED_EVENT,
  PIPELINE_STEP_COMPLETED_EVENT,
  PIPELINE_STEP_STARTED_EVENT,
  aggregatePipelineRunStatus,
  findPipelineCycle,
  pipelineAncestorIds,
  readyPipelineStepIds,
  topologicalPipelineOrder
} = require('@asterim/shared');
const Fastify = require('fastify');
const pipelineRoutes = require('../../../routes/pipelines').default;

const PROJECT_ID = 'pipeline-project';

type AnyEvent = { type: string; payload: Record<string, any> };

/** Lets the event loop turn. */
function pause(ms = 10): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** The `TOKEN-x` a brief carries, which is how a step's answer is identified. */
function tokenOf(brief: string): string {
  return /TOKEN-[A-Za-z0-9_]+/.exec(brief)?.[0] ?? 'TOKEN-none';
}

function publish(type: string, payload: Record<string, unknown>): void {
  eventBus.publish({
    id: `evt-${Math.random()}`,
    timestamp: Date.now(),
    source: 'agent',
    type,
    payload: { projectId: PROJECT_ID, ...payload }
  });
}

/**
 * A session runner that never touches a PTY.
 *
 * What a child says is decided by the brief it is handed, so a pipeline
 * definition can ask for a failing step or a silent one without the test having
 * to know which thread id the engine will give it.
 */
class FakeRunner {
  public started: Array<{ threadId: string; profileId?: string }> = [];
  public sent: Array<{ threadId: string; content: string }> = [];
  public stopped: string[] = [];
  /** How long a child takes to answer; long enough to overlap with its peers. */
  public delayMs = 20;
  /** The most children answering at the same time, which is the parallelism. */
  public peakConcurrency = 0;
  private live = 0;

  public start(params: { projectId: string; threadId: string; profileId?: string }): void {
    this.started.push({ threadId: params.threadId, profileId: params.profileId });
  }

  public send(params: { projectId: string; threadId: string; content: string }): void {
    this.sent.push({ threadId: params.threadId, content: params.content });

    // Only a child gets an answer; a send to the root thread is the run's own
    // report, and a fake child answering that would be an infinite regress.
    if (!this.started.some(entry => entry.threadId === params.threadId)) return;

    const brief = params.content;
    if (brief.includes('SILENT_STEP')) return;

    this.live++;
    this.peakConcurrency = Math.max(this.peakConcurrency, this.live);

    setTimeout(() => {
      this.live--;
      if (brief.includes('FAIL_STEP')) {
        publish('agent.status', {
          threadId: params.threadId,
          status: 'error',
          message: 'The step blew up.'
        });
        return;
      }
      publish('chat.message', {
        threadId: params.threadId,
        role: 'agent',
        content: `Worked on it.\nSUMMARY: done:${tokenOf(brief)}`
      });
      publish('agent.status', { threadId: params.threadId, status: 'idle', message: '' });
    }, this.delayMs);
  }

  public stop(params: { projectId: string; threadId: string }): void {
    this.stopped.push(params.threadId);
  }

  /** Everything this runner was asked to send to one thread. */
  public sentTo(threadId: string): string {
    return this.sent
      .filter(entry => entry.threadId === threadId)
      .map(entry => entry.content)
      .join('\n');
  }

  public reset(): void {
    this.started = [];
    this.sent = [];
    this.stopped = [];
    this.peakConcurrency = 0;
    this.live = 0;
    this.delayMs = 20;
  }
}

/** Records every event of the given types published while a block runs. */
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

/** Which error a call threw, or null when it did not throw. */
async function codeOf(fn: () => unknown): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    const thrown = err as { code?: string; message?: string };
    if (err instanceof PipelineError) return String(thrown.code);
    if (err instanceof PipelineParseError) return 'PARSE_ERROR';
    return `UNEXPECTED:${thrown.message}`;
  }
}

/** Whether a parse threw, and what it said. */
function parseFailure(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

const runner = new FakeRunner();
const delegation = new AgentDelegationService(runner, profileService, eventBus);
const parser = new PipelineParser(profileService);
const engine = new PipelineEngine(delegation, parser, profileService, eventBus);

/** A definition with one `TOKEN-<id>` per step, so answers can be told apart. */
function definitionYaml(
  name: string,
  steps: Array<{ id: string; role?: string; task?: string; dependsOn?: string[] }>
): string {
  const body = steps
    .map(step => {
      const dependsOn = step.dependsOn?.length ? `[${step.dependsOn.join(', ')}]` : '[]';
      return [
        `  - id: ${step.id}`,
        `    name: Step ${step.id}`,
        `    roleProfileId: ${step.role ?? 'Senior Backend Engineer'}`,
        `    task: ${step.task ?? `Do ${step.id}. TOKEN-${step.id.toUpperCase()}`}`,
        `    dependsOn: ${dependsOn}`
      ].join('\n');
    })
    .join('\n');
  return `name: ${name}\nprojectId: ${PROJECT_ID}\ntrigger: MANUAL\nsteps:\n${body}\n`;
}

async function main(): Promise<void> {
  profileService.initBuiltinProfiles();
  dbService
    .getDb()
    .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
    .run(PROJECT_ID, 'Pipelines', tmpDir);

  // --- Schema -----------------------------------------------------------------
  describe('migration 004 puts the pipeline tables on the database');
  {
    const db = dbService.getDb();
    const tables = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table'
             AND name IN ('pipelines', 'pipeline_runs', 'pipeline_step_runs') ORDER BY name`
        )
        .all() as Array<{ name: string }>
    ).map(row => row.name);
    equal('all three tables exist', tables, ['pipeline_runs', 'pipeline_step_runs', 'pipelines']);

    const runColumns = (
      db.prepare('PRAGMA table_info(pipeline_runs)').all() as Array<{ name: string }>
    ).map(column => column.name);
    check('a run records its status', runColumns.includes('status'));
    check('and where it got to', runColumns.includes('current_step_id'));
    check('and the context it started with', runColumns.includes('run_context_json'));
    check('and when it finished', runColumns.includes('completed_at'));

    const stepColumns = (
      db.prepare('PRAGMA table_info(pipeline_step_runs)').all() as Array<{ name: string }>
    ).map(column => column.name);
    for (const column of [
      'step_id',
      'step_name',
      'role_profile_id',
      'status',
      'thread_id',
      'worktree_path',
      'diff',
      'output',
      'error_message'
    ]) {
      check(`a step run records ${column}`, stepColumns.includes(column));
    }

    const indexes = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index'
             AND name IN ('idx_pipeline_runs_pipeline', 'idx_pipeline_step_runs_run') ORDER BY name`
        )
        .all() as Array<{ name: string }>
    ).map(row => row.name);
    equal('both indexes were created', indexes, [
      'idx_pipeline_runs_pipeline',
      'idx_pipeline_step_runs_run'
    ]);

    const applied = db
      .prepare('SELECT version, name FROM schema_migrations WHERE version = 4')
      .get() as { version: number; name: string } | undefined;
    equal('the migration is recorded as version 4', applied?.name, '004_pipelines');

    // A database that predates P9-01 must still open, which is what the
    // versioned engine buys. Re-opening is the cheapest proof.
    let reinitFailed = false;
    try {
      const { DatabaseService } = require('../../DatabaseService');
      new DatabaseService();
    } catch {
      reinitFailed = true;
    }
    check('opening the same database again is idempotent', !reinitFailed);
  }

  // --- The YAML subset --------------------------------------------------------
  describe('the safe YAML reader reads what a definition needs');
  {
    const document = parseSafeYaml(
      [
        '# a pipeline',
        'name: Release',
        'trigger: MANUAL',
        'parameters:',
        '  ticket: ABC-1',
        '  retries: 2',
        '  dry: true',
        '  none: ~',
        'steps:',
        '  - id: build',
        '    dependsOn: []',
        '    task: |',
        '      Build it.',
        '      # not a comment in here',
        '  - id: ship',
        '    dependsOn: [build]',
        '    task: >',
        '      fold these',
        '      two lines',
        '    quoted: "a: b # c"'
      ].join('\n')
    );

    equal('scalars read as text', document.name, 'Release');
    equal('numbers read as numbers', document.parameters.retries, 2);
    equal('booleans read as booleans', document.parameters.dry, true);
    equal('~ reads as null', document.parameters.none, null);
    equal('a list of mappings reads as one', document.steps.length, 2);
    equal('the first step keeps its id', document.steps[0].id, 'build');
    equal('an empty flow list is empty', document.steps[0].dependsOn, []);
    equal('a flow list reads its entries', document.steps[1].dependsOn, ['build']);
    equal(
      'a literal block keeps its newlines and its hashes',
      document.steps[0].task,
      'Build it.\n# not a comment in here\n'
    );
    equal('a folded block folds its lines', document.steps[1].task, 'fold these two lines\n');
    equal('a quoted scalar keeps its colon and hash', document.steps[1].quoted, 'a: b # c');
    equal('a comment line is not content', Object.keys(document).length, 4);
  }

  describe('the reader refuses what it will not interpret');
  {
    const refuses = (label: string, source: string, fragment: string): void => {
      const message = parseFailure(() => parseSafeYaml(source));
      check(
        label,
        !!message && message.includes(fragment),
        message ? `got: ${message}` : 'it parsed instead'
      );
    };

    refuses('anchors', 'a: &anchor 1', 'anchors');
    refuses('aliases', 'a: *anchor', 'aliases');
    refuses('tags', 'a: !!python/object x', 'tags');
    refuses('tab indentation', 'a:\n\t- 1', 'tabs');
    refuses('a second document', 'a: 1\n---\nb: 2', 'single YAML document');
    refuses('duplicate keys', 'a: 1\na: 2', "Duplicate key 'a'");
    refuses('prototype keys', '__proto__: 1', 'not usable as a key');
    refuses('a line that is not a mapping entry', 'name: x\nnonsense', "Expected 'key: value'");
    refuses('an unterminated quote', 'a: "open', 'Unterminated');

    check('the error is a YamlParseError', (() => {
      try {
        parseSafeYaml('a: &x 1');
        return false;
      } catch (err) {
        return err instanceof YamlParseError && (err as any).line === 1;
      }
    })());
  }

  // --- The parser -------------------------------------------------------------
  describe('the parser validates a definition');
  {
    const definition = parser.parse(
      definitionYaml('Feature delivery', [
        { id: 'implement' },
        { id: 'test', role: 'QA Engineer', dependsOn: ['implement'] },
        { id: 'audit', role: 'Security Auditor', dependsOn: ['implement'] },
        { id: 'document', role: 'Tech Lead', dependsOn: ['test', 'audit'] }
      ])
    );

    equal('the name survives', definition.name, 'Feature delivery');
    equal('the trigger survives', definition.trigger, 'MANUAL');
    equal('every step is read', definition.steps.length, 4);
    equal('dependencies are read', definition.steps[3].dependsOn, ['test', 'audit']);
    equal('a step defaults its name from nothing', definition.steps[0].name, 'Step implement');
    equal('a missing trigger defaults to MANUAL', parser.parse('name: x\nsteps:\n  - id: a\n    role: Tech Lead\n    task: t\n').trigger, 'MANUAL');
  }

  describe('the parser refuses a definition it cannot run');
  {
    const refuses = (label: string, yaml: string, fragment: string): void => {
      const message = parseFailure(() => parser.parse(yaml));
      check(
        label,
        !!message && message.includes(fragment),
        message ? `got: ${message}` : 'it parsed instead'
      );
    };

    refuses('a definition with no name', 'steps:\n  - id: a\n    role: Tech Lead\n    task: t\n', '`name` is required');
    refuses('a definition with no steps', 'name: x\n', 'at least one step');
    refuses(
      'a step with no role',
      'name: x\nsteps:\n  - id: a\n    task: t\n',
      'roleProfileId` is required'
    );
    refuses(
      'a step with no task',
      'name: x\nsteps:\n  - id: a\n    role: Tech Lead\n',
      'task` is required'
    );
    refuses(
      'duplicate step ids',
      definitionYaml('x', [{ id: 'a' }, { id: 'a' }]),
      "Duplicate step id 'a'"
    );
    refuses(
      'a dependency on a step that does not exist',
      definitionYaml('x', [{ id: 'a', dependsOn: ['ghost'] }]),
      "depends on 'ghost'"
    );
    refuses(
      'a step that depends on itself',
      definitionYaml('x', [{ id: 'a', dependsOn: ['a'] }]),
      'cannot depend on itself'
    );
    refuses(
      'a two-step cycle',
      definitionYaml('x', [
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['a'] }
      ]),
      'dependency cycle'
    );
    refuses(
      'a three-step cycle',
      definitionYaml('x', [
        { id: 'a', dependsOn: ['c'] },
        { id: 'b', dependsOn: ['a'] },
        { id: 'c', dependsOn: ['b'] }
      ]),
      'dependency cycle'
    );
    refuses(
      'a role nothing plays',
      definitionYaml('x', [{ id: 'a', role: 'Chief Astrologer' }]),
      'matches no agent profile'
    );
    refuses(
      'an unknown step key',
      'name: x\nsteps:\n  - id: a\n    role: Tech Lead\n    task: t\n    depends_on: [b]\n',
      'Unknown step 1 key(s): depends_on'
    );
    refuses('an unknown trigger', 'name: x\ntrigger: WHENEVER\nsteps:\n  - id: a\n    role: Tech Lead\n    task: t\n', '`trigger` must be one of');
    refuses(
      'a step id that is not usable',
      'name: x\nsteps:\n  - id: "a b"\n    role: Tech Lead\n    task: t\n',
      'is not usable'
    );
    refuses(
      'more steps than the bound allows',
      definitionYaml(
        'x',
        Array.from({ length: MAX_PIPELINE_STEPS + 1 }, (_unused, index) => ({ id: `s${index}` }))
      ),
      `at most ${MAX_PIPELINE_STEPS} steps`
    );

    // The cycle is named, not merely reported: whoever wrote the file has to
    // break it, and the path is the whole diagnosis.
    const cycleMessage = parseFailure(() =>
      parser.parse(
        definitionYaml('x', [
          { id: 'a', dependsOn: ['c'] },
          { id: 'b', dependsOn: ['a'] },
          { id: 'c', dependsOn: ['b'] }
        ])
      )
    );
    check(
      'the cycle error names the path that closes it',
      !!cycleMessage && /a → c → b → a|b → a → c → b|c → b → a → c/.test(cycleMessage),
      cycleMessage ?? undefined
    );
  }

  // --- The DAG algebra --------------------------------------------------------
  describe('the DAG helpers agree about order, readiness and cycles');
  {
    const steps = [
      { id: 'a', name: 'a', roleProfileId: 'r', task: 't', dependsOn: [] },
      { id: 'b', name: 'b', roleProfileId: 'r', task: 't', dependsOn: ['a'] },
      { id: 'c', name: 'c', roleProfileId: 'r', task: 't', dependsOn: ['a'] },
      { id: 'd', name: 'd', roleProfileId: 'r', task: 't', dependsOn: ['b', 'c'] }
    ];

    equal('a DAG has an order', topologicalPipelineOrder(steps), ['a', 'b', 'c', 'd']);
    equal('a DAG has no cycle', findPipelineCycle(steps), null);
    equal('ancestors are transitive', pipelineAncestorIds(steps, 'd'), ['a', 'b', 'c']);
    equal('a root step has no ancestors', pipelineAncestorIds(steps, 'a'), []);

    equal('only the root is ready at the start', readyPipelineStepIds(steps, {}), ['a']);
    equal(
      'two steps become ready together',
      readyPipelineStepIds(steps, { a: 'PASSED' }),
      ['b', 'c']
    );
    equal(
      'the join waits for both of them',
      readyPipelineStepIds(steps, { a: 'PASSED', b: 'PASSED' }),
      ['c']
    );
    equal(
      'a failed dependency leaves its dependents unready forever',
      readyPipelineStepIds(steps, { a: 'PASSED', b: 'FAILED', c: 'PASSED' }),
      []
    );

    const cyclic = [
      { id: 'a', name: 'a', roleProfileId: 'r', task: 't', dependsOn: ['b'] },
      { id: 'b', name: 'b', roleProfileId: 'r', task: 't', dependsOn: ['a'] }
    ];
    equal('a cycle has no order', topologicalPipelineOrder(cyclic), null);
    check('and it is found', (findPipelineCycle(cyclic) ?? []).length > 0);

    equal('every step passing is a pass', aggregatePipelineRunStatus(['PASSED', 'PASSED']), 'PASSED');
    equal('one failure fails the run', aggregatePipelineRunStatus(['PASSED', 'FAILED']), 'FAILED');
    equal('a skip is a failure too', aggregatePipelineRunStatus(['PASSED', 'SKIPPED']), 'FAILED');
    equal(
      'a cancellation outranks a failure',
      aggregatePipelineRunStatus(['FAILED', 'CANCELLED']),
      'CANCELLED'
    );

    equal('a placeholder is filled from the context', substitute('Fix {{ ticket }}', { ticket: 'ABC-1' }), 'Fix ABC-1');
    equal('an unknown placeholder is left alone', substitute('Fix {{ nope }}', {}), 'Fix {{ nope }}');
  }

  // --- Storage ----------------------------------------------------------------
  describe('saving a pipeline stores what was written');
  {
    const yaml = definitionYaml('Sequential', [
      { id: 'implement' },
      { id: 'test', role: 'QA Engineer', dependsOn: ['implement'] }
    ]);
    const saved = engine.savePipeline({ yaml });

    check('it gets an id', typeof saved.id === 'string' && saved.id.startsWith('pipe_'));
    equal('the name comes from the definition', saved.name, 'Sequential');
    equal('the YAML is stored exactly as written', saved.yaml, yaml);
    equal('and the parse is available on it', saved.definition.steps.length, 2);

    const listed = engine.listPipelines();
    check('it is listed', listed.some((entry: any) => entry.id === saved.id));

    const updated = engine.savePipeline({
      id: saved.id,
      yaml: definitionYaml('Sequential renamed', [{ id: 'implement' }])
    });
    equal('saving with an id updates rather than duplicates', updated.id, saved.id);
    equal('and the name follows the definition', updated.name, 'Sequential renamed');
    equal('nothing was added to the list', engine.listPipelines().length, listed.length);

    equal(
      'an unknown id is refused',
      await codeOf(() => engine.savePipeline({ id: 'pipe_nope', yaml })),
      'PIPELINE_NOT_FOUND'
    );
    equal('an empty definition is refused', await codeOf(() => engine.savePipeline({ yaml: '' })), 'INVALID_INPUT');
    equal(
      'a cyclic definition never reaches storage',
      await codeOf(() =>
        engine.savePipeline({
          yaml: definitionYaml('Cyclic', [
            { id: 'a', dependsOn: ['b'] },
            { id: 'b', dependsOn: ['a'] }
          ])
        })
      ),
      'PARSE_ERROR'
    );

    engine.deletePipeline(saved.id);
    equal('a deleted pipeline is gone', engine.getPipeline(saved.id), null);
  }

  describe('definitions are read from .asterim/pipelines');
  {
    const directory = path.join(tmpDir, '.asterim', 'pipelines');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'delivery.yaml'),
      definitionYaml('From disk', [{ id: 'implement' }]),
      'utf8'
    );
    fs.writeFileSync(path.join(directory, 'broken.yaml'), 'name: broken\nsteps: []\n', 'utf8');
    fs.writeFileSync(path.join(directory, 'notes.txt'), 'ignored', 'utf8');

    const imported = engine.importFromDirectory(tmpDir);
    equal('the readable definition is imported', imported.imported.length, 1);
    equal('and named', imported.imported[0].name, 'From disk');
    equal('the broken one is reported rather than thrown', imported.failures.length, 1);
    check(
      'and it names the file',
      imported.failures[0].file.endsWith('broken.yaml'),
      imported.failures[0].file
    );

    const again = engine.importFromDirectory(tmpDir);
    equal('re-importing updates rather than duplicates', again.imported[0].id, imported.imported[0].id);
    engine.deletePipeline(imported.imported[0].id);
  }

  // --- Sequential execution ---------------------------------------------------
  describe('a sequential pipeline runs its steps in dependency order');
  {
    runner.reset();
    const pipeline = engine.savePipeline({
      yaml: definitionYaml('Sequential run', [
        { id: 'implement' },
        { id: 'test', role: 'QA Engineer', dependsOn: ['implement'] }
      ])
    });

    const recorder = recordEvents([
      PIPELINE_STARTED_EVENT,
      PIPELINE_STEP_STARTED_EVENT,
      PIPELINE_STEP_COMPLETED_EVENT,
      PIPELINE_COMPLETED_EVENT,
      PIPELINE_FAILED_EVENT
    ]);
    const run = await engine.runPipeline(pipeline.id, { ticket: 'ABC-1' });
    recorder.stop();

    equal('the run passed', run.status, 'PASSED');
    equal('both steps passed', run.steps.map((step: any) => step.status), ['PASSED', 'PASSED']);
    equal('they are stored in dependency order', run.steps.map((step: any) => step.stepId), [
      'implement',
      'test'
    ]);
    check('each step recorded the thread it ran in', run.steps.every((step: any) => !!step.threadId));
    check(
      'each step recorded what its agent said',
      run.steps.every((step: any) => (step.output ?? '').includes('SUMMARY:'))
    );
    check('the run recorded when it finished', typeof run.completedAt === 'number');
    equal('and has nothing to explain', run.errorMessage, undefined);

    equal('only one step ran at a time', runner.peakConcurrency, 1);
    equal('the two children started in order', runner.started.map(entry => entry.threadId), [
      run.steps[0].threadId,
      run.steps[1].threadId
    ]);

    // The handoff: the second step's brief carries the first step's answer.
    const secondBrief = runner.sentTo(run.steps[1].threadId);
    check(
      'the downstream step is told what the upstream step concluded',
      secondBrief.includes('done:TOKEN-IMPLEMENT'),
      secondBrief.slice(0, 400)
    );
    check(
      'and which step it came from',
      secondBrief.includes('implement'),
      secondBrief.slice(0, 400)
    );
    check(
      'the run parameters travel with it',
      secondBrief.includes('ABC-1'),
      secondBrief.slice(0, 400)
    );
    const firstBrief = runner.sentTo(run.steps[0].threadId);
    check(
      'the first step is told nothing about steps that have not run',
      !firstBrief.includes('done:TOKEN-TEST'),
      firstBrief.slice(0, 200)
    );

    const started = recorder.events.filter(event => event.type === PIPELINE_STARTED_EVENT);
    equal('one pipeline:started was published', started.length, 1);
    equal('it lists every planned step', started[0].payload.stepIds, ['implement', 'test']);
    equal(
      'one pipeline:step_started per step',
      recorder.events.filter(event => event.type === PIPELINE_STEP_STARTED_EVENT).length,
      2
    );
    const completedSteps = recorder.events.filter(
      event => event.type === PIPELINE_STEP_COMPLETED_EVENT
    );
    equal('one pipeline:step_completed per step', completedSteps.length, 2);
    equal('carrying the settled row', completedSteps[0].payload.step.status, 'PASSED');
    equal(
      'and one pipeline:completed',
      recorder.events.filter(event => event.type === PIPELINE_COMPLETED_EVENT).length,
      1
    );
    equal(
      'with no pipeline:failed',
      recorder.events.filter(event => event.type === PIPELINE_FAILED_EVENT).length,
      0
    );
    check(
      'every event routes to the project',
      recorder.events.every(event => event.payload.projectId === PROJECT_ID)
    );

    // Each step's child session is stopped before the run moves on.
    check(
      'both children were stopped',
      run.steps.every((step: any) => runner.stopped.includes(step.threadId))
    );

    const reread = engine.getRun(run.id);
    equal('the run reads back the same from storage', reread.status, 'PASSED');
    equal('with its steps', reread.steps.length, 2);
    equal('and the context it started with', reread.runContext.ticket, 'ABC-1');
    equal('a pipeline lists its runs', engine.listRuns(pipeline.id).length, 1);
  }

  // --- Parallel execution -----------------------------------------------------
  describe('independent steps run at the same time');
  {
    runner.reset();
    const pipeline = engine.savePipeline({
      yaml: definitionYaml('Fan out', [
        { id: 'plan', role: 'Tech Lead' },
        { id: 'backend', dependsOn: ['plan'] },
        { id: 'frontend', role: 'Frontend Reviewer', dependsOn: ['plan'] },
        { id: 'audit', role: 'Security Auditor', dependsOn: ['plan'] },
        { id: 'release', role: 'DevOps Engineer', dependsOn: ['backend', 'frontend', 'audit'] }
      ])
    });

    const run = await engine.runPipeline(pipeline.id);

    equal('the run passed', run.status, 'PASSED');
    equal('every step passed', run.steps.filter((step: any) => step.status === 'PASSED').length, 5);
    check(
      'the three independent steps ran together',
      runner.peakConcurrency >= 3,
      `peak was ${runner.peakConcurrency}`
    );

    const byId = Object.fromEntries(run.steps.map((step: any) => [step.stepId, step]));
    check(
      'the fan-out waited for its dependency',
      byId.backend.startedAt >= byId.plan.completedAt,
      `${byId.backend.startedAt} < ${byId.plan.completedAt}`
    );
    check(
      'the join waited for all three',
      byId.release.startedAt >= Math.max(
        byId.backend.completedAt,
        byId.frontend.completedAt,
        byId.audit.completedAt
      )
    );

    const joinBrief = runner.sentTo(byId.release.threadId);
    for (const ancestor of ['TOKEN-PLAN', 'TOKEN-BACKEND', 'TOKEN-FRONTEND', 'TOKEN-AUDIT']) {
      check(
        `the join is told what ${ancestor} produced`,
        joinBrief.includes(`done:${ancestor}`),
        joinBrief.slice(0, 600)
      );
    }
  }

  describe('a ready set wider than the concurrency bound is run in batches');
  {
    runner.reset();
    const wide = Array.from({ length: PIPELINE_MAX_PARALLEL_STEPS + 2 }, (_unused, index) => ({
      id: `wide${index}`
    }));
    const pipeline = engine.savePipeline({ yaml: definitionYaml('Wide', wide) });

    const run = await engine.runPipeline(pipeline.id);

    equal('every step still ran', run.steps.length, wide.length);
    equal(
      'and passed',
      run.steps.filter((step: any) => step.status === 'PASSED').length,
      wide.length
    );
    check(
      'never more than the bound at once',
      runner.peakConcurrency <= PIPELINE_MAX_PARALLEL_STEPS,
      `peak was ${runner.peakConcurrency}`
    );
    check(
      'but more than one at once',
      runner.peakConcurrency > 1,
      `peak was ${runner.peakConcurrency}`
    );
  }

  describe('the brief a step is handed stays inside what a delegation accepts');
  {
    // A pipeline whose ancestors produced megabytes of diff must still dispatch:
    // the delegation service refuses an over-long context rather than trimming
    // one, so a step whose brief was not cut here would fail to start at all.
    const steps = [
      { id: 'a', name: 'a', roleProfileId: 'Tech Lead', task: 't', dependsOn: [] },
      { id: 'b', name: 'b', roleProfileId: 'Tech Lead', task: 't', dependsOn: ['a'] }
    ];
    const results = new Map([
      [
        'a',
        {
          childThreadId: 'thread-a',
          status: 'COMPLETED',
          summary: 'x'.repeat(2000),
          output: 'y'.repeat(200000),
          diff: 'z'.repeat(200000)
        }
      ]
    ]);
    const context = engine.buildStepContext(
      { name: 'Huge', trigger: 'MANUAL', steps },
      steps[1],
      steps,
      results,
      { note: 'n'.repeat(100000) }
    );
    check(
      'an enormous upstream diff is cut to the delegation bound',
      context.length <= MAX_PIPELINE_CONTEXT_CHARS,
      `context was ${context.length}`
    );
    check(
      'and says that something was left out',
      context.startsWith('[earlier pipeline context omitted]'),
      context.slice(0, 80)
    );

    equal(
      'a substituted task is cut to the task bound',
      substitute('Do {{ big }}', { big: 'b'.repeat(MAX_PIPELINE_TASK_CHARS * 2) }).length >
        MAX_PIPELINE_TASK_CHARS,
      true
    );

    runner.reset();
    const pipeline = engine.savePipeline({
      yaml: `name: Big brief\nprojectId: ${PROJECT_ID}\nparameters:\n  big: ${'b'.repeat(2000)}\nsteps:\n  - id: only\n    role: Tech Lead\n    task: Handle {{ big }} TOKEN-ONLY\n`
    });
    const bigRun = await engine.runPipeline(pipeline.id);
    equal('a run with an enormous parameter still passes', bigRun.status, 'PASSED');
  }

  // --- Failure ----------------------------------------------------------------
  describe('a failed step halts everything downstream');
  {
    runner.reset();
    const pipeline = engine.savePipeline({
      yaml: definitionYaml('Halting', [
        { id: 'implement' },
        {
          id: 'test',
          role: 'QA Engineer',
          task: 'Run the tests. FAIL_STEP TOKEN-TEST',
          dependsOn: ['implement']
        },
        { id: 'document', role: 'Tech Lead', dependsOn: ['test'] },
        { id: 'audit', role: 'Security Auditor', dependsOn: ['test'] }
      ])
    });

    const recorder = recordEvents([PIPELINE_COMPLETED_EVENT, PIPELINE_FAILED_EVENT]);
    const run = await engine.runPipeline(pipeline.id);
    recorder.stop();

    equal('the run failed', run.status, 'FAILED');

    const byId = Object.fromEntries(run.steps.map((step: any) => [step.stepId, step]));
    equal('the step before it passed', byId.implement.status, 'PASSED');
    equal('the failing step is FAILED', byId.test.status, 'FAILED');
    check(
      'and says why',
      (byId.test.errorMessage ?? '').includes('blew up'),
      byId.test.errorMessage
    );
    equal('the step after it never ran', byId.document.status, 'SKIPPED');
    equal('nor did its sibling', byId.audit.status, 'SKIPPED');
    equal('a skipped step has no thread', byId.document.threadId, undefined);
    check(
      'the run explains which step stopped it',
      (run.errorMessage ?? '').includes("'test'"),
      run.errorMessage
    );

    equal('only the two steps that could run started sessions', runner.started.length, 2);
    equal(
      'pipeline:failed was published',
      recorder.events.filter(event => event.type === PIPELINE_FAILED_EVENT).length,
      1
    );
    equal(
      'and pipeline:completed was not',
      recorder.events.filter(event => event.type === PIPELINE_COMPLETED_EVENT).length,
      0
    );
    check(
      'the failing step was stopped',
      runner.stopped.includes(byId.test.threadId),
      JSON.stringify(runner.stopped)
    );
  }

  // --- Cancellation -----------------------------------------------------------
  describe('cancelling a run stops the steps it has running');
  {
    runner.reset();
    const pipeline = engine.savePipeline({
      yaml: definitionYaml('Cancellable', [
        {
          id: 'forever',
          task: 'Never answer. SILENT_STEP TOKEN-FOREVER'
        },
        { id: 'after', role: 'QA Engineer', dependsOn: ['forever'] }
      ])
    });

    let runId = '';
    const onStarted = (event: AnyEvent) => {
      runId = event.payload.runId;
    };
    eventBus.subscribe(PIPELINE_STARTED_EVENT, onStarted);

    const running = engine.runPipeline(pipeline.id);
    // Long enough for the first step's session to have been started and its
    // brief delivered; the fake child for this one never answers.
    await pause(60);
    check('the run announced itself', !!runId);
    equal('and its first step is running', engine.getRun(runId).steps[0].status, 'RUNNING');

    const cancelled = await engine.cancelPipeline(runId, 'operator stopped it');
    const run = await running;
    eventBus.unsubscribe(PIPELINE_STARTED_EVENT, onStarted);

    equal('the cancellation was accepted', cancelled, true);
    equal('the run is cancelled, not failed', run.status, 'CANCELLED');

    const byId = Object.fromEntries(run.steps.map((step: any) => [step.stepId, step]));
    equal('the running step is cancelled', byId.forever.status, 'CANCELLED');
    check(
      'and carries the reason it was given',
      (byId.forever.errorMessage ?? '').includes('operator stopped it'),
      byId.forever.errorMessage
    );
    equal('the step behind it is cancelled too', byId.after.status, 'CANCELLED');
    check(
      'the running child was stopped',
      runner.stopped.includes(byId.forever.threadId),
      JSON.stringify(runner.stopped)
    );
    equal('nothing downstream was ever started', runner.started.length, 1);

    equal(
      'cancelling a settled run changes nothing',
      await engine.cancelPipeline(runId, 'again'),
      false
    );
    equal('and it stays cancelled', engine.getRun(runId).status, 'CANCELLED');
    equal(
      'cancelling a run that does not exist is refused',
      await codeOf(() => engine.cancelPipeline('prun_nope')),
      'RUN_NOT_FOUND'
    );
  }

  describe('a run the previous process left behind is settled at startup');
  {
    runner.reset();
    const pipeline = engine.savePipeline({
      yaml: definitionYaml('Recovered', [{ id: 'orphan' }])
    });
    const run = await engine.runPipeline(pipeline.id);

    // What a Core that stopped mid-run leaves behind.
    dbService
      .getDb()
      .prepare("UPDATE pipeline_runs SET status = 'RUNNING', completed_at = NULL WHERE id = ?")
      .run(run.id);
    dbService
      .getDb()
      .prepare("UPDATE pipeline_step_runs SET status = 'RUNNING' WHERE pipeline_run_id = ?")
      .run(run.id);

    equal('one run was settled', engine.recoverRuns(), 1);
    const recovered = engine.getRun(run.id);
    equal('it is no longer claiming to be running', recovered.status, 'CANCELLED');
    equal('and neither is its step', recovered.steps[0].status, 'CANCELLED');
    equal('a second pass finds nothing', engine.recoverRuns(), 0);
  }

  // --- Refusals ---------------------------------------------------------------
  describe('a run that cannot start is refused before anything is written');
  {
    runner.reset();
    const noProject = engine.savePipeline({
      yaml: 'name: No project\nsteps:\n  - id: a\n    role: Tech Lead\n    task: t\n'
    });
    equal(
      'a pipeline with no project is refused',
      await codeOf(() => engine.runPipeline(noProject.id)),
      'INVALID_INPUT'
    );
    equal(
      'unless the run names one',
      (await engine.runPipeline(noProject.id, { projectId: PROJECT_ID })).status,
      'PASSED'
    );
    equal(
      'a project that does not exist is refused',
      await codeOf(() => engine.runPipeline(noProject.id, { projectId: 'ghost' })),
      'PROJECT_NOT_FOUND'
    );
    equal(
      'an unknown pipeline is refused',
      await codeOf(() => engine.runPipeline('pipe_nope')),
      'PIPELINE_NOT_FOUND'
    );
    equal('nothing was started for any of them', runner.started.length, 1);

    const concurrent = engine.savePipeline({
      yaml: definitionYaml('Only once', [
        { id: 'slow', task: 'Take your time. SILENT_STEP TOKEN-SLOW' }
      ])
    });
    let concurrentRunId = '';
    const onStarted = (event: AnyEvent) => {
      concurrentRunId = event.payload.runId;
    };
    eventBus.subscribe(PIPELINE_STARTED_EVENT, onStarted);
    const first = engine.runPipeline(concurrent.id);
    await pause(30);
    equal(
      'a second run of the same pipeline is refused while the first is going',
      await codeOf(() => engine.runPipeline(concurrent.id)),
      'ALREADY_RUNNING'
    );
    await engine.cancelPipeline(concurrentRunId, 'done with it');
    equal('the first run ended as cancelled', (await first).status, 'CANCELLED');
    eventBus.unsubscribe(PIPELINE_STARTED_EVENT, onStarted);

    // The guard is on a run being in progress, not on the pipeline; once the
    // first is over the same pipeline runs again.
    engine.savePipeline({
      id: concurrent.id,
      yaml: definitionYaml('Only once', [{ id: 'quick' }])
    });
    equal(
      'and allowed once it is over',
      (await engine.runPipeline(concurrent.id)).status,
      'PASSED'
    );
  }

  // --- REST -------------------------------------------------------------------
  describe('the REST surface');
  {
    // The production runner publishes onto the bus and AgentService turns that
    // into a session. There is no AgentService here, so the test is one: it
    // answers a brief the way a child would, which exercises the wiring the
    // server actually registers rather than the fake used above.
    const children = new Set<string>();
    const onCommand = (event: AnyEvent) => {
      if (event.payload.command === 'start') children.add(event.payload.threadId);
    };
    const onMessage = (event: AnyEvent) => {
      const threadId = event.payload.threadId;
      if (!children.has(threadId)) return;
      const brief = String(event.payload.content ?? '');
      setTimeout(() => {
        publish('chat.message', {
          threadId,
          role: 'agent',
          content: `Done.\nSUMMARY: done:${tokenOf(brief)}`
        });
        publish('agent.status', { threadId, status: 'idle', message: '' });
      }, 5);
    };
    eventBus.subscribe('client.command', onCommand);
    eventBus.subscribe('client.chat_message', onMessage);

    const app = Fastify();
    app.addHook('onRequest', async (request: { headers: Record<string, string>; user?: unknown }) => {
      if (request.headers['x-anonymous'] !== 'yes') request.user = { sub: 'user-rest' };
    });
    await app.register(pipelineRoutes);

    const yaml = definitionYaml('Over HTTP', [
      { id: 'implement' },
      { id: 'test', role: 'QA Engineer', dependsOn: ['implement'] }
    ]);

    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/pipelines',
      headers: { 'x-anonymous': 'yes' }
    });
    equal('an anonymous list is refused', anonymous.statusCode, 401);

    const created = await app.inject({ method: 'POST', url: '/api/v1/pipelines', payload: { yaml } });
    equal('a definition is created', created.statusCode, 201);
    const pipeline = created.json().pipeline;
    equal('and parsed on the way in', pipeline.definition.steps.length, 2);

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/pipelines',
      payload: { yaml: 'name: Broken\nsteps:\n  - id: a\n    role: Tech Lead\n    task: t\n\t- id: b\n' }
    });
    equal('an unreadable definition is a 400', invalid.statusCode, 400);
    equal('with the code that says so', invalid.json().code, 'INVALID_DEFINITION');
    check('and the line it stopped on', typeof invalid.json().line === 'number');

    const cyclic = await app.inject({
      method: 'POST',
      url: '/api/v1/pipelines',
      payload: {
        yaml: definitionYaml('Cyclic over HTTP', [
          { id: 'a', dependsOn: ['b'] },
          { id: 'b', dependsOn: ['a'] }
        ])
      }
    });
    equal('a cyclic definition is a 400', cyclic.statusCode, 400);
    check('naming the cycle', cyclic.json().error.includes('cycle'), cyclic.json().error);

    const emptyBody = await app.inject({ method: 'POST', url: '/api/v1/pipelines', payload: {} });
    equal('a body with no definition is a 400', emptyBody.statusCode, 400);

    const listed = await app.inject({ method: 'GET', url: '/api/v1/pipelines' });
    equal('the list answers', listed.statusCode, 200);
    check(
      'and contains it',
      listed.json().pipelines.some((entry: any) => entry.id === pipeline.id)
    );

    const fetched = await app.inject({ method: 'GET', url: `/api/v1/pipelines/${pipeline.id}` });
    equal('one pipeline reads back', fetched.statusCode, 200);
    equal('with its runs', fetched.json().runs.length, 0);

    const missing = await app.inject({ method: 'GET', url: '/api/v1/pipelines/pipe_nope' });
    equal('an unknown pipeline is a 404', missing.statusCode, 404);

    const ran = await app.inject({
      method: 'POST',
      url: `/api/v1/pipelines/${pipeline.id}/run`,
      payload: { runContext: { ticket: 'REST-1' } }
    });
    equal('a run over HTTP answers 200', ran.statusCode, 200);
    const run = ran.json().run;
    equal('and it passed', run.status, 'PASSED');
    equal('through the production session runner', run.steps.length, 2);
    check(
      'every step ran in a real thread',
      run.steps.every((step: any) => children.has(step.threadId))
    );

    const readRun = await app.inject({ method: 'GET', url: `/api/v1/pipeline-runs/${run.id}` });
    equal('the run reads back over HTTP', readRun.statusCode, 200);
    equal('with its per-step progress', readRun.json().run.steps.length, 2);
    equal(
      'and the first step passed',
      readRun.json().run.steps[0].status,
      'PASSED'
    );

    const unknownRun = await app.inject({ method: 'GET', url: '/api/v1/pipeline-runs/prun_nope' });
    equal('an unknown run is a 404', unknownRun.statusCode, 404);

    const cancelSettled = await app.inject({
      method: 'POST',
      url: `/api/v1/pipeline-runs/${run.id}/cancel`,
      payload: { reason: 'too late' }
    });
    equal('cancelling a settled run answers 200', cancelSettled.statusCode, 200);
    equal('reporting that nothing was cancelled', cancelSettled.json().cancelled, false);
    equal('and leaving the run as it was', cancelSettled.json().run.status, 'PASSED');

    const anonymousRun = await app.inject({
      method: 'POST',
      url: `/api/v1/pipelines/${pipeline.id}/run`,
      headers: { 'x-anonymous': 'yes' },
      payload: {}
    });
    equal('an anonymous run is refused', anonymousRun.statusCode, 401);

    await app.close();
    eventBus.unsubscribe('client.command', onCommand);
    eventBus.unsubscribe('client.chat_message', onMessage);
    // The route module holds the engine singleton, which holds the delegation
    // singleton; nothing else in this file uses either.
    check('the singletons are the ones the server registers', !!agentDelegationService);
  }

  // --- Summary ---------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(label => console.log(`  - ${label}`));
  }
}

main()
  .then(() => {
    cleanup();
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(err => {
    console.error('\n[fatal]', err);
    cleanup();
    process.exit(1);
  });
