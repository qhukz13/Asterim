/**
 * Tests for the Worktree Fleet Orchestrator, step retries and triggers (P9-02).
 *
 * The repository has no test runner (docs/p5.0-01-verification-report.md § 3), so this
 * is a standalone script with its own assertion harness, matching the delegation,
 * pipeline, team agent, MCP, skills and memory suites.
 *
 * Everything here runs against a real git repository in a temp directory: real
 * `git worktree add`, real commits on real branches, real merges and real
 * conflicts. A mocked GitProvider would prove that the command strings are the
 * ones this file expects, which is the one thing not worth knowing — what has to
 * be true is that git does what the fleet claims, that a downstream step's
 * checkout really does contain its predecessor's file, and that the operator's
 * working tree is exactly as it was afterwards.
 *
 * What is faked is the agent process, and only that. `DelegationSessionRunner` is
 * replaced with one that reads the brief it is handed and acts on the directives
 * in it — `!WRITE(file|text)` writes into whatever checkout the delegation put
 * the child in, `!READ(file)` reports what is there, `!FLAKY(n)` fails the first
 * n attempts — so chaining, retries and fail-closed conflicts are all reached
 * through the same code a PTY would drive.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/pipeline/__tests__/WorktreeFleet.test.ts
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-fleet-')));
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

// DatabaseService and EventBus export singletons constructed at import time, so
// `require` is used instead of `import`, whose bindings would hoist above the
// ASTERIM_DATA_DIR assignment.
const { dbService } = require('../../DatabaseService');
const { eventBus } = require('../../EventBus');
const { profileService } = require('../../ai/ProfileService');
const { AgentDelegationService } = require('../../ai/AgentDelegationService');
const { PipelineEngine, PipelineError } = require('../PipelineEngine');
const { PipelineParser, PipelineParseError } = require('../PipelineParser');
const {
  WorktreeFleetService,
  WorktreeFleetError,
  worktreeFleetService
} = require('../WorktreeFleetService');
const {
  PipelineTriggerService,
  parseScheduleInterval,
  pipelineTriggerService
} = require('../PipelineTriggerService');
const {
  MAX_PIPELINE_RETRY_DELAY_MS,
  MAX_PIPELINE_STEP_RETRIES,
  MIN_PIPELINE_SCHEDULE_MS,
  PIPELINE_BRANCH_PREFIX,
  PIPELINE_COMPLETED_EVENT,
  PIPELINE_FAILED_EVENT,
  PIPELINE_GIT_COMMIT_EVENT,
  PIPELINE_TRIGGERED_EVENT,
  isPipelineBranch,
  isSafePipelineRefComponent,
  pipelineStepBranchName,
  pipelineSynthesisBranchName
} = require('@asterim/shared');
const Fastify = require('fastify');
const pipelineRoutes = require('../../../routes/pipelines').default;

type AnyEvent = { type: string; payload: Record<string, any> };

// --- Temp repositories ---

const tempDirs: string[] = [tmpDir];

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Fleet Test',
  GIT_AUTHOR_EMAIL: 'fleet@test.local',
  GIT_COMMITTER_NAME: 'Fleet Test',
  GIT_COMMITTER_EMAIL: 'fleet@test.local'
};

function git(command: string, cwd: string): string {
  return execSync(command, { cwd, encoding: 'utf8', env: GIT_ENV, stdio: 'pipe' }).trim();
}

/** A repository with one commit on `main`, and an identity every worktree shares. */
function makeRepo(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  git('git init -q -b main', dir);
  git('git config user.email fleet@test.local', dir);
  git('git config user.name "Fleet Test"', dir);
  git('git config commit.gpgsign false', dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# base\n');
  git('git add -A', dir);
  git('git commit -q -m base', dir);
  return dir;
}

function cleanup(): void {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  console.log(`\n[cleanup] removed ${tempDirs.length} temp directories`);
}

function pause(ms = 10): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Waits until `condition` holds, or gives up. */
async function waitFor(condition: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await pause(20);
  }
  return condition();
}

function publish(projectId: string, type: string, payload: Record<string, unknown>): void {
  eventBus.publish({
    id: `evt-${Math.random()}`,
    timestamp: Date.now(),
    source: 'agent',
    type,
    payload: { projectId, ...payload }
  });
}

function tokenOf(brief: string): string {
  return /TOKEN-[A-Za-z0-9_]+/.exec(brief)?.[0] ?? 'TOKEN-none';
}

/**
 * A session runner that never touches a PTY but does touch the checkout.
 *
 * The point of the fleet is *where* a child's edits land, so a fake that only
 * talked would prove nothing about it: this one looks up the worktree the
 * delegation recorded on the child's thread row and writes there, exactly as an
 * agent process running in that directory would.
 */
class FakeRunner {
  public started: Array<{ threadId: string }> = [];
  public sent: Array<{ threadId: string; content: string }> = [];
  public stopped: string[] = [];
  public delayMs = 5;
  /** Token → how many times a brief carrying it has been answered. */
  public attemptsByToken = new Map<string, number>();

  public start(params: { projectId: string; threadId: string }): void {
    this.started.push({ threadId: params.threadId });
  }

  public send(params: { projectId: string; threadId: string; content: string }): void {
    this.sent.push({ threadId: params.threadId, content: params.content });
    if (!this.started.some(entry => entry.threadId === params.threadId)) return;

    const brief = params.content;
    const token = tokenOf(brief);
    const attempt = (this.attemptsByToken.get(token) ?? 0) + 1;
    this.attemptsByToken.set(token, attempt);

    const row = dbService
      .getDb()
      .prepare('SELECT worktree_path FROM threads WHERE id = ?')
      .get(params.threadId) as { worktree_path?: string } | undefined;
    const cwd = row?.worktree_path ?? '';

    const notes: string[] = [];
    // Only the step's own brief carries directives; an ancestor's context is
    // its summary and its diff, neither of which is executable here.
    const own = brief.split('## Completed step:')[0];

    for (const match of own.matchAll(/!WRITE\(([^|)]+)\|([^)]*)\)/g)) {
      if (!cwd) continue;
      fs.writeFileSync(path.join(cwd, match[1]), `${match[2]}\n`);
      notes.push(`wrote:${match[1]}`);
    }
    for (const match of own.matchAll(/!READ\(([^)]+)\)/g)) {
      const target = cwd ? path.join(cwd, match[1]) : '';
      notes.push(
        `read:${target && fs.existsSync(target) ? fs.readFileSync(target, 'utf8').trim() : 'MISSING'}`
      );
    }

    const flaky = /!FLAKY\((\d+)\)/.exec(own);
    const failing = flaky ? attempt <= Number(flaky[1]) : own.includes('FAIL_STEP');

    setTimeout(() => {
      if (failing) {
        publish(params.projectId, 'agent.status', {
          threadId: params.threadId,
          status: 'error',
          message: `The step blew up on attempt ${attempt}.`
        });
        return;
      }
      publish(params.projectId, 'chat.message', {
        threadId: params.threadId,
        role: 'agent',
        content: `Worked on it.\nSUMMARY: done:${token} attempt:${attempt} ${notes.join(' ')}`
      });
      publish(params.projectId, 'agent.status', {
        threadId: params.threadId,
        status: 'idle',
        message: ''
      });
    }, this.delayMs);
  }

  public stop(params: { projectId: string; threadId: string }): void {
    this.stopped.push(params.threadId);
  }

  public reset(): void {
    this.started = [];
    this.sent = [];
    this.stopped = [];
    this.attemptsByToken.clear();
  }
}

const runner = new FakeRunner();
const delegation = new AgentDelegationService(runner, profileService, eventBus);
const parser = new PipelineParser(profileService);
const fleet = new WorktreeFleetService();
const engine = new PipelineEngine(delegation, parser, profileService, eventBus, fleet);

/** Every branch under the fleet prefix, in a repository. */
function fleetBranches(repo: string): string[] {
  return git(
    `git for-each-ref --format="%(refname:short)" "refs/heads/${PIPELINE_BRANCH_PREFIX}"`,
    repo
  )
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

/** Every checkout git has registered, other than the primary one. */
function registeredWorktrees(repo: string): string[] {
  return git('git worktree list --porcelain', repo)
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim())
    .filter(entry => path.resolve(entry) !== path.resolve(repo));
}

async function main(): Promise<void> {
  profileService.initBuiltinProfiles();

  // --- Naming and validation --------------------------------------------------
  describe('a fleet branch is derived from the run and the step, and is identifiable');
  {
    equal(
      'a step branch names its run and step',
      pipelineStepBranchName('prun_abc', 'implement'),
      'asterim/pipeline/prun_abc/step-implement'
    );
    equal(
      'a synthesis branch names its run',
      pipelineSynthesisBranchName('prun_abc'),
      'asterim/pipeline/prun_abc/pr'
    );
    check('a fleet branch is recognized as ours', isPipelineBranch('asterim/pipeline/x/step-a'));
    check(
      'a delegation sandbox branch is not',
      !isPipelineBranch('asterim/sandbox/thread-1'),
      'sandbox branches must never be deleted by fleet teardown'
    );
    check("and neither is somebody's real branch", !isPipelineBranch('main'));

    check('a plain id may name a branch', isSafePipelineRefComponent('prun_abc-1.2'));
    check('a traversal may not', !isSafePipelineRefComponent('../../etc'));
    check('nor may a space', !isSafePipelineRefComponent('two words'));
    check('nor may an empty string', !isSafePipelineRefComponent(''));

    const repo = makeRepo('asterim-fleet-naming-');
    let code: string | null = null;
    try {
      await fleet.provisionStep({ repoPath: repo, runId: '../escape', stepId: 'a' });
    } catch (err) {
      code = (err as { code?: string }).code ?? null;
    }
    equal('an unsafe run id is refused before git is touched', code, 'INVALID_INPUT');
    equal('and nothing was provisioned', registeredWorktrees(repo).length, 0);
  }

  // --- Provisioning and chaining ----------------------------------------------
  describe('the fleet provisions one checkout per step and chains them');
  {
    const repo = makeRepo('asterim-fleet-chain-');
    const runId = 'prun_chain';
    const base = await fleet.resolveRunBase(repo);

    const first = await fleet.provisionStep({ repoPath: repo, runId, stepId: 'implement', baseCommit: base });
    equal('the branch is deterministic', first.branch, `asterim/pipeline/${runId}/step-implement`);
    check(
      'the checkout is inside .asterim/worktrees/pipeline',
      first.path.includes(path.join('.asterim', 'worktrees', 'pipeline', runId)),
      first.path
    );
    check('and it exists on disk', fs.existsSync(first.path));
    equal('a root step chains from nothing', first.chainedFrom, []);
    equal('and is branched from the run base', first.baseCommit, base);
    equal(
      'git has it registered on its own branch',
      git('git rev-parse --abbrev-ref HEAD', first.path),
      first.branch
    );

    fs.writeFileSync(path.join(first.path, 'app.ts'), 'export const version = 2;\n');
    const settled = await fleet.settleStep(first, 'implement did this');
    check('settling commits what the step left behind', settled.committed);
    check('and answers with the branch tip', /^[0-9a-f]{40}$/.test(settled.commitSha));
    equal(
      'which is what the branch points at',
      git(`git rev-parse ${first.branch}`, repo),
      settled.commitSha
    );

    // The whole point of chaining: the second step sees the first one's file.
    const second = await fleet.provisionStep({
      repoPath: repo,
      runId,
      stepId: 'test',
      baseCommit: base,
      chainFrom: ['implement']
    });
    equal('the dependent step records what it chained from', second.chainedFrom, ['implement']);
    equal('and is branched from its predecessor tip', second.baseCommit, settled.commitSha);
    check(
      "the predecessor's file is in the dependent step's checkout",
      fs.existsSync(path.join(second.path, 'app.ts')),
      second.path
    );
    equal(
      'with its contents',
      fs.readFileSync(path.join(second.path, 'app.ts'), 'utf8'),
      'export const version = 2;\n'
    );

    // A step that changed nothing still gives its successor a commit to chain
    // from, so a graph does not break on a step with no output.
    const quiet = await fleet.settleStep(second);
    equal('a step that changed nothing commits nothing', quiet.committed, false);
    check('but still has a tip', quiet.commitSha === settled.commitSha, quiet.commitSha);

    // Nothing of any of this reached the operator's checkout.
    equal('the primary working tree is clean', git('git status --porcelain', repo), '');
    check(
      'and has none of the sandboxed files',
      !fs.existsSync(path.join(repo, 'app.ts'))
    );
    equal('the primary branch is untouched', git('git rev-parse main', repo), base);

    // A retry is a fresh checkout on the same name, not the last attempt's.
    fs.writeFileSync(path.join(first.path, 'scratch.txt'), 'from a failed attempt\n');
    const reprovisioned = await fleet.provisionStep({
      repoPath: repo,
      runId,
      stepId: 'implement',
      baseCommit: base
    });
    check(
      "a re-provisioned step does not inherit the previous attempt's files",
      !fs.existsSync(path.join(reprovisioned.path, 'scratch.txt'))
    );
    equal('and starts from the base again', reprovisioned.baseCommit, base);

    const removed = await fleet.teardownRun(repo, runId);
    check('teardown removes the run fleet', removed > 0, String(removed));
    equal('no fleet branch survives it', fleetBranches(repo), []);
    equal('and no checkout does either', registeredWorktrees(repo), []);
  }

  describe('a step joining a fan-out is chained onto every ancestor');
  {
    const repo = makeRepo('asterim-fleet-join-');
    const runId = 'prun_join';
    const base = await fleet.resolveRunBase(repo);

    const backend = await fleet.provisionStep({ repoPath: repo, runId, stepId: 'backend', baseCommit: base });
    fs.writeFileSync(path.join(backend.path, 'server.ts'), 'server\n');
    await fleet.settleStep(backend);

    const frontend = await fleet.provisionStep({ repoPath: repo, runId, stepId: 'frontend', baseCommit: base });
    fs.writeFileSync(path.join(frontend.path, 'client.ts'), 'client\n');
    await fleet.settleStep(frontend);

    const join = await fleet.provisionStep({
      repoPath: repo,
      runId,
      stepId: 'release',
      baseCommit: base,
      chainFrom: ['backend', 'frontend']
    });
    equal('the join chained from both', join.chainedFrom, ['backend', 'frontend']);
    check('it has the backend work', fs.existsSync(path.join(join.path, 'server.ts')));
    check('and the frontend work', fs.existsSync(path.join(join.path, 'client.ts')));

    // A join whose ancestors disagree is refused rather than resolved.
    const left = await fleet.provisionStep({ repoPath: repo, runId, stepId: 'left', baseCommit: base });
    fs.writeFileSync(path.join(left.path, 'shared.ts'), 'left wins\n');
    await fleet.settleStep(left);
    const right = await fleet.provisionStep({ repoPath: repo, runId, stepId: 'right', baseCommit: base });
    fs.writeFileSync(path.join(right.path, 'shared.ts'), 'right wins\n');
    await fleet.settleStep(right);

    let thrown: any = null;
    try {
      await fleet.provisionStep({
        repoPath: repo,
        runId,
        stepId: 'merge',
        baseCommit: base,
        chainFrom: ['left', 'right']
      });
    } catch (err) {
      thrown = err;
    }
    check('a conflicting chain is refused', thrown instanceof WorktreeFleetError, String(thrown));
    equal('with the code that says why', thrown?.code, 'CHAIN_CONFLICT');
    check('naming the file', (thrown?.files ?? []).includes('shared.ts'), JSON.stringify(thrown?.files));
    check(
      'and the half-chained checkout is gone',
      !fs.existsSync(fleet.stepPath(repo, runId, 'merge'))
    );
    equal('as is its branch', fleetBranches(repo).includes(`asterim/pipeline/${runId}/step-merge`), false);
    equal('the primary working tree is still clean', git('git status --porcelain', repo), '');

    await fleet.teardownRun(repo, runId);
  }

  // --- Conflict detection -----------------------------------------------------
  describe('conflicts between parallel branches are found before anything is merged');
  {
    const repo = makeRepo('asterim-fleet-conflict-');
    const runId = 'prun_conflict';
    fs.writeFileSync(path.join(repo, 'shared.ts'), 'const value = 0;\n');
    git('git add -A', repo);
    git('git commit -q -m shared', repo);
    const base = await fleet.resolveRunBase(repo);

    const write = async (stepId: string, file: string, content: string): Promise<void> => {
      const step = await fleet.provisionStep({ repoPath: repo, runId, stepId, baseCommit: base });
      fs.writeFileSync(path.join(step.path, file), content);
      await fleet.settleStep(step);
    };

    // Two steps rewriting the same line, and one that touched something else.
    await write('alpha', 'shared.ts', 'const value = 1;\n');
    await write('beta', 'shared.ts', 'const value = 2;\n');
    await write('gamma', 'docs.md', '# notes\n');

    const clean = await fleet.analyzeConflicts(repo, runId, ['alpha', 'gamma'], base);
    equal('two steps that touched different files do not conflict', clean.hasConflicts, false);
    equal('and nothing is reported', clean.conflictedFiles, []);
    equal('both branches were analyzed', clean.branches.length, 2);

    const clash = await fleet.analyzeConflicts(repo, runId, ['alpha', 'beta', 'gamma'], base);
    equal('two steps rewriting the same line do conflict', clash.hasConflicts, true);
    equal('the conflicted path is named', clash.conflictedFiles, ['shared.ts']);
    equal('one pair conflicts', clash.conflicts.length, 1);
    equal('and it names the steps', clash.conflicts[0].stepIds.sort(), ['alpha', 'beta']);

    const missing = await fleet.analyzeConflicts(repo, runId, ['alpha', 'ghost'], base);
    equal('a step with no branch is reported rather than assumed', missing.missingStepIds, ['ghost']);
    equal('and nothing conflicts with it', missing.hasConflicts, false);

    // A chained pair is a fast-forward, not a conflict, however much they
    // overlap: `delta` was branched from `alpha` and rewrote the same line.
    const delta = await fleet.provisionStep({
      repoPath: repo,
      runId,
      stepId: 'delta',
      baseCommit: base,
      chainFrom: ['alpha']
    });
    fs.writeFileSync(path.join(delta.path, 'shared.ts'), 'const value = 11;\n');
    await fleet.settleStep(delta);
    const chained = await fleet.analyzeConflicts(repo, runId, ['alpha', 'delta'], base);
    equal('a chained pair never conflicts with its own ancestor', chained.hasConflicts, false);

    // Asking cost the repository nothing.
    equal('the probe checkout was removed', registeredWorktrees(repo).length, 4);
    check(
      'and its directory is gone',
      !fs.existsSync(path.join(fleet.fleetRoot(repo, runId), '__probe'))
    );
    equal('the primary working tree is clean', git('git status --porcelain', repo), '');
    equal(
      'and still on the base commit',
      git('git rev-parse HEAD', repo),
      base
    );

    // --- Synthesis ------------------------------------------------------------
    describe('a passing run synthesizes one branch an operator can merge');
    {
      const result = await fleet.synthesize({
        repoPath: repo,
        runId,
        baseCommit: base,
        steps: [
          { stepId: 'alpha', roleProfileId: 'Senior Backend Engineer' },
          { stepId: 'gamma', roleProfileId: 'Tech Lead' }
        ],
        pipelineName: 'Feature delivery'
      });

      equal('the branch is named after the run', result.branchName, `asterim/pipeline/${runId}/pr`);
      equal('and carries both steps', result.mergedStepIds, ['alpha', 'gamma']);
      check('with a commit at its tip', /^[0-9a-f]{40}$/.test(result.commitSha));
      equal(
        'which is what the branch points at',
        git(`git rev-parse ${result.branchName}`, repo),
        result.commitSha
      );

      const message = git(`git log -1 --format=%s ${result.branchName}`, repo);
      check('the tip commit summarizes the run', message.includes(runId), message);
      check('and names the steps it carries', message.includes('alpha') && message.includes('gamma'), message);

      equal(
        "the branch has the first step's change",
        git(`git show ${result.branchName}:shared.ts`, repo),
        'const value = 1;'
      );
      equal(
        "and the other step's file",
        git(`git show ${result.branchName}:docs.md`, repo),
        '# notes'
      );
      check(
        'the synthesis checkout was removed',
        !fs.existsSync(path.join(fleet.fleetRoot(repo, runId), '__pr'))
      );
      equal('the operator’s branch is untouched', git('git rev-parse main', repo), base);
      equal('and their working tree is clean', git('git status --porcelain', repo), '');

      let conflict: any = null;
      try {
        await fleet.synthesize({
          repoPath: repo,
          runId,
          baseCommit: base,
          steps: [{ stepId: 'alpha' }, { stepId: 'beta' }]
        });
      } catch (err) {
        conflict = err;
      }
      equal('consolidating two conflicting steps is refused', conflict?.code, 'SYNTHESIS_CONFLICT');
      check('naming the file', (conflict?.files ?? []).includes('shared.ts'), JSON.stringify(conflict?.files));
      check(
        'and no half-consolidated branch is left behind',
        !fleetBranches(repo).includes(`asterim/pipeline/${runId}/pr`),
        JSON.stringify(fleetBranches(repo))
      );

      let empty: any = null;
      try {
        await fleet.synthesize({ repoPath: repo, runId, baseCommit: base, steps: [{ stepId: 'ghost' }] });
      } catch (err) {
        empty = err;
      }
      equal('a run with nothing to consolidate says so', empty?.code, 'NOTHING_TO_SYNTHESIZE');
    }

    await fleet.teardownRun(repo, runId);
    equal('teardown leaves no fleet branch', fleetBranches(repo), []);
    equal('and no registered checkout', registeredWorktrees(repo), []);
  }

  // --- The parser -------------------------------------------------------------
  describe('the parser reads and bounds retries');
  {
    const yaml = (extra: string): string =>
      `name: Retrying\nprojectId: p\nsteps:\n  - id: a\n    role: Tech Lead\n    task: t\n${extra}`;

    const definition = parser.parse(yaml('    retries: 2\n    retryDelayMs: 250\n'));
    equal('retries are read', definition.steps[0].retries, 2);
    equal('and so is the delay', definition.steps[0].retryDelayMs, 250);
    equal(
      'a step that says nothing about retries leaves them unset',
      parser.parse(yaml('')).steps[0].retries,
      undefined
    );
    equal('an explicit zero survives', parser.parse(yaml('    retries: 0\n')).steps[0].retries, 0);

    const refuses = (label: string, extra: string, fragment: string): void => {
      try {
        parser.parse(yaml(extra));
        check(label, false, 'it parsed instead');
      } catch (err) {
        const message = (err as Error).message;
        check(
          label,
          err instanceof PipelineParseError && message.includes(fragment),
          `got: ${message}`
        );
      }
    };

    refuses(
      'more retries than the bound allows',
      `    retries: ${MAX_PIPELINE_STEP_RETRIES + 1}\n`,
      `between 0 and ${MAX_PIPELINE_STEP_RETRIES}`
    );
    refuses('a negative retry count', '    retries: -1\n', 'between 0 and');
    refuses('a fractional retry count', '    retries: 1.5\n', 'whole number');
    refuses('retries that are not a number', '    retries: many\n', 'whole number');
    refuses(
      'a delay longer than the bound',
      `    retryDelayMs: ${MAX_PIPELINE_RETRY_DELAY_MS + 1}\n`,
      `between 0 and ${MAX_PIPELINE_RETRY_DELAY_MS}`
    );
  }

  // --- End to end through the engine ------------------------------------------
  const repo = makeRepo('asterim-fleet-engine-');
  const PROJECT_ID = 'fleet-project';
  dbService
    .getDb()
    .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
    .run(PROJECT_ID, 'Fleet', repo);

  const definitionYaml = (
    name: string,
    steps: Array<{
      id: string;
      role?: string;
      task?: string;
      dependsOn?: string[];
      retries?: number;
      retryDelayMs?: number;
    }>,
    header = ''
  ): string => {
    const body = steps
      .map(step =>
        [
          `  - id: ${step.id}`,
          `    name: Step ${step.id}`,
          `    roleProfileId: ${step.role ?? 'Senior Backend Engineer'}`,
          `    task: ${step.task ?? `Do ${step.id}. TOKEN-${step.id.toUpperCase()}`}`,
          `    dependsOn: [${(step.dependsOn ?? []).join(', ')}]`,
          step.retries === undefined ? '' : `    retries: ${step.retries}`,
          step.retryDelayMs === undefined ? '' : `    retryDelayMs: ${step.retryDelayMs}`
        ]
          .filter(Boolean)
          .join('\n')
      )
      .join('\n');
    return `name: ${name}\nprojectId: ${PROJECT_ID}\ntrigger: MANUAL\n${header}steps:\n${body}\n`;
  };

  describe('a run gives every step a fleet checkout and chains them through the engine');
  {
    runner.reset();
    const pipeline = engine.savePipeline({
      yaml: definitionYaml('Chained delivery', [
        { id: 'implement', task: 'Write it. !WRITE(app.txt|from-implement) TOKEN-IMPLEMENT' },
        {
          id: 'test',
          role: 'QA Engineer',
          dependsOn: ['implement'],
          task: 'Check it. !READ(app.txt) !WRITE(test.txt|from-test) TOKEN-TEST'
        }
      ])
    });

    const run = await engine.runPipeline(pipeline.id);
    equal('the run passed', run.status, 'PASSED');
    check('the run recorded the commit its fleet started from', !!run.baseCommit, run.baseCommit);

    const byId = Object.fromEntries(run.steps.map((step: any) => [step.stepId, step]));
    equal(
      'the first step ran on its own fleet branch',
      byId.implement.worktreeBranch,
      `asterim/pipeline/${run.id}/step-implement`
    );
    equal(
      'and so did the second',
      byId.test.worktreeBranch,
      `asterim/pipeline/${run.id}/step-test`
    );
    check('each step settled at a commit', /^[0-9a-f]{40}$/.test(byId.implement.commitSha ?? ''));
    equal('a step that passed first time took one attempt', byId.implement.attempts, 1);
    check(
      'the step ran in the fleet checkout rather than a sandbox of its own',
      (byId.implement.worktreePath ?? '').includes(path.join('worktrees', 'pipeline', run.id)),
      byId.implement.worktreePath
    );

    // The handoff, physically: the second step read the first step's file out of
    // its own checkout.
    check(
      "the downstream step read its predecessor's file",
      (byId.test.output ?? '').includes('read:from-implement'),
      byId.test.output
    );

    equal(
      "the first step's branch carries its file",
      git(`git show ${byId.implement.worktreeBranch}:app.txt`, repo),
      'from-implement'
    );
    equal(
      "the second step's branch carries both",
      git(`git show ${byId.test.worktreeBranch}:app.txt`, repo),
      'from-implement'
    );

    equal('the operator’s working tree is untouched', git('git status --porcelain', repo), '');
    check('and has none of the files', !fs.existsSync(path.join(repo, 'app.txt')));

    // Conflicts and synthesis, over the same run.
    const analysis = await engine.analyzeRunConflicts(run.id);
    equal('a chained run has no conflicts', analysis.hasConflicts, false);

    const synthesis = await engine.synthesizeRun(run.id);
    equal('synthesis names the run branch', synthesis.branchName, `asterim/pipeline/${run.id}/pr`);
    equal('and consolidates both steps', synthesis.mergedStepIds, ['implement', 'test']);
    equal(
      'the consolidated branch has the first step’s file',
      git(`git show ${synthesis.branchName}:app.txt`, repo),
      'from-implement'
    );
    equal(
      'and the second step’s',
      git(`git show ${synthesis.branchName}:test.txt`, repo),
      'from-test'
    );
    equal(
      'the run records the branch it synthesized',
      engine.getRun(run.id).synthesisBranch,
      synthesis.branchName
    );
    equal('the operator’s branch is still where it was', git('git status --porcelain', repo), '');

    await fleet.teardownRun(repo, run.id);
    await fleet.discardSynthesis(repo, run.id);
  }

  describe('a step that fails is retried up to what its definition allows');
  {
    runner.reset();
    const pipeline = engine.savePipeline({
      yaml: definitionYaml('Flaky delivery', [
        {
          id: 'flaky',
          retries: 2,
          retryDelayMs: 10,
          task: 'Try it. !FLAKY(2) !WRITE(done.txt|eventually) TOKEN-FLAKY'
        },
        { id: 'after', role: 'QA Engineer', dependsOn: ['flaky'], task: 'Then this. !READ(done.txt) TOKEN-AFTER' }
      ])
    });

    const run = await engine.runPipeline(pipeline.id);
    equal('the run passed on the third attempt', run.status, 'PASSED');

    const byId = Object.fromEntries(run.steps.map((step: any) => [step.stepId, step]));
    equal('the flaky step passed', byId.flaky.status, 'PASSED');
    equal('after three attempts', byId.flaky.attempts, 3);
    check(
      'each attempt was a session of its own',
      runner.started.length === 4,
      `${runner.started.length} sessions started`
    );
    check(
      "the successor still saw the attempt that worked",
      (byId.after.output ?? '').includes('read:eventually'),
      byId.after.output
    );

    // The same step with no retries fails the run, which is what makes the
    // retry the thing that saved it rather than the flakiness being imaginary.
    runner.reset();
    const strict = engine.savePipeline({
      yaml: definitionYaml('Strict delivery', [
        { id: 'flaky2', task: 'Try it. !FLAKY(2) TOKEN-FLAKY2' },
        { id: 'after2', role: 'QA Engineer', dependsOn: ['flaky2'] }
      ])
    });
    const strictRun = await engine.runPipeline(strict.id);
    equal('with no retries the run fails', strictRun.status, 'FAILED');
    const strictById = Object.fromEntries(strictRun.steps.map((step: any) => [step.stepId, step]));
    equal('the step failed', strictById.flaky2.status, 'FAILED');
    equal('after one attempt', strictById.flaky2.attempts, 1);
    equal('and everything behind it was skipped', strictById.after2.status, 'SKIPPED');

    // A step that fails every attempt fails closed once its retries run out.
    runner.reset();
    const doomed = engine.savePipeline({
      yaml: definitionYaml('Doomed delivery', [
        { id: 'doomed', retries: 1, retryDelayMs: 5, task: 'Never works. FAIL_STEP TOKEN-DOOMED' }
      ])
    });
    const doomedRun = await engine.runPipeline(doomed.id);
    equal('exhausted retries fail the run', doomedRun.status, 'FAILED');
    equal('after every allowed attempt', doomedRun.steps[0].attempts, 2);
    check(
      'and the row says how many it took',
      (doomedRun.steps[0].errorMessage ?? '').includes('after 2 attempts'),
      doomedRun.steps[0].errorMessage
    );

    await fleet.teardownRun(repo, run.id);
    await fleet.teardownRun(repo, strictRun.id);
    await fleet.teardownRun(repo, doomedRun.id);
  }

  describe('a join whose parallel ancestors conflict stops the pipeline cleanly');
  {
    runner.reset();
    const pipeline = engine.savePipeline({
      yaml: definitionYaml('Diverging delivery', [
        { id: 'left', task: 'Left. !WRITE(both.txt|left-version) TOKEN-LEFT' },
        {
          id: 'right',
          role: 'Frontend Reviewer',
          task: 'Right. !WRITE(both.txt|right-version) TOKEN-RIGHT'
        },
        { id: 'join', role: 'Tech Lead', dependsOn: ['left', 'right'], task: 'Join. TOKEN-JOIN' }
      ])
    });

    const run = await engine.runPipeline(pipeline.id);
    const byId = Object.fromEntries(run.steps.map((step: any) => [step.stepId, step]));

    equal('the two parallel steps passed', [byId.left.status, byId.right.status], ['PASSED', 'PASSED']);
    equal('the join failed rather than running on half its input', byId.join.status, 'FAILED');
    check(
      'and says which ancestors disagree',
      (byId.join.errorMessage ?? '').includes('both.txt'),
      byId.join.errorMessage
    );
    equal('so the run failed', run.status, 'FAILED');
    check(
      'no agent was ever started for the join',
      runner.started.length === 2,
      `${runner.started.length} sessions started`
    );

    // The conflict the join hit is the one the analysis reports.
    const analysis = await engine.analyzeRunConflicts(run.id);
    equal('the run reports its conflict', analysis.hasConflicts, true);
    equal('naming the file', analysis.conflictedFiles, ['both.txt']);
    equal('and the pair', analysis.conflicts[0].stepIds.sort(), ['left', 'right']);

    equal('the operator’s working tree is still clean', git('git status --porcelain', repo), '');
    await fleet.teardownRun(repo, run.id);
  }

  // --- REST -------------------------------------------------------------------
  describe('the conflicts and synthesis routes');
  {
    runner.reset();
    const pipeline = engine.savePipeline({
      yaml: definitionYaml('Over HTTP', [
        { id: 'api', task: 'API. !WRITE(api.txt|api-work) TOKEN-API' },
        { id: 'docs', role: 'Tech Lead', task: 'Docs. !WRITE(docs.txt|docs-work) TOKEN-DOCS' }
      ])
    });
    const run = await engine.runPipeline(pipeline.id);
    equal('the run passed', run.status, 'PASSED');

    const app = Fastify();
    app.addHook(
      'onRequest',
      async (request: { headers: Record<string, string>; user?: unknown }) => {
        if (request.headers['x-anonymous'] === 'yes') return;
        request.user = { sub: request.headers['x-user'] ?? 'user-rest' };
      }
    );
    await app.register(pipelineRoutes);

    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/v1/pipeline-runs/${run.id}/conflicts`,
      headers: { 'x-anonymous': 'yes' }
    });
    equal('an anonymous conflict check is refused', anonymous.statusCode, 401);

    const conflicts = await app.inject({
      method: 'GET',
      url: `/api/v1/pipeline-runs/${run.id}/conflicts`
    });
    equal('the conflict check answers', conflicts.statusCode, 200);
    equal('with no conflicts for two disjoint steps', conflicts.json().analysis.hasConflicts, false);
    equal('having analyzed both branches', conflicts.json().analysis.branches.length, 2);

    const unknown = await app.inject({ method: 'GET', url: '/api/v1/pipeline-runs/prun_nope/conflicts' });
    equal('an unknown run is a 404', unknown.statusCode, 404);

    const anonymousSynthesis = await app.inject({
      method: 'POST',
      url: `/api/v1/pipeline-runs/${run.id}/synthesize`,
      headers: { 'x-anonymous': 'yes' },
      payload: {}
    });
    equal('an anonymous synthesis is refused', anonymousSynthesis.statusCode, 401);

    const synthesized = await app.inject({
      method: 'POST',
      url: `/api/v1/pipeline-runs/${run.id}/synthesize`,
      payload: { message: 'Consolidated by the test' }
    });
    equal('synthesis answers 200', synthesized.statusCode, 200);
    const synthesis = synthesized.json().synthesis;
    equal('with the run branch', synthesis.branchName, `asterim/pipeline/${run.id}/pr`);
    equal('carrying both steps', synthesis.mergedStepIds, ['api', 'docs']);
    equal(
      'the branch holds both files',
      [
        git(`git show ${synthesis.branchName}:api.txt`, repo),
        git(`git show ${synthesis.branchName}:docs.txt`, repo)
      ],
      ['api-work', 'docs-work']
    );
    equal(
      'the message the caller gave is the commit subject',
      git(`git log -1 --format=%s ${synthesis.branchName}`, repo),
      'Consolidated by the test'
    );
    equal('and the run reads it back', synthesized.json().run.synthesisBranch, synthesis.branchName);

    const onlyOne = await app.inject({
      method: 'POST',
      url: `/api/v1/pipeline-runs/${run.id}/synthesize`,
      payload: { stepIds: ['api'] }
    });
    equal('a caller may consolidate a subset', onlyOne.statusCode, 200);
    equal('taking only what it asked for', onlyOne.json().synthesis.mergedStepIds, ['api']);

    const unknownSynthesis = await app.inject({
      method: 'POST',
      url: '/api/v1/pipeline-runs/prun_nope/synthesize',
      payload: {}
    });
    equal('synthesizing an unknown run is a 404', unknownSynthesis.statusCode, 404);

    // --- RBAC ---------------------------------------------------------------
    //
    // Both routes are authorized against the workspace that owns the pipeline,
    // and the two of them deliberately want different permissions: reading
    // whether branches conflict is a read, and creating a branch is a write.
    const db = dbService.getDb();
    const now = Date.now();
    for (const [id, email] of [
      ['user-owner', 'owner@test.local'],
      ['user-viewer', 'viewer@test.local']
    ]) {
      db.prepare(
        'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(id, email, 'x', now, now);
    }
    db.prepare(
      'INSERT INTO accounts (id, owner_user_id, account_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run('acct-fleet', 'user-owner', 'Fleet', now, now);
    db.prepare(
      'INSERT INTO workspaces (id, account_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('ws-fleet', 'acct-fleet', 'Fleet workspace', 'fleet', now, now);
    db.prepare(
      'INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run('wsm-owner', 'ws-fleet', 'user-owner', 'owner', Date.now());
    db.prepare(
      'INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run('wsm-viewer', 'ws-fleet', 'user-viewer', 'viewer', Date.now());

    runner.reset();
    const owned = engine.savePipeline({
      workspaceId: 'ws-fleet',
      yaml: definitionYaml('Owned by a workspace', [
        { id: 'scoped', task: 'Scoped. !WRITE(scoped.txt|scoped-work) TOKEN-SCOPED' }
      ])
    });
    const ownedRun = await engine.runPipeline(owned.id);
    equal('the workspace pipeline ran', ownedRun.status, 'PASSED');

    const viewerRead = await app.inject({
      method: 'GET',
      url: `/api/v1/pipeline-runs/${ownedRun.id}/conflicts`,
      headers: { 'x-user': 'user-viewer' }
    });
    equal('a viewer may check for conflicts', viewerRead.statusCode, 200);

    const viewerWrite = await app.inject({
      method: 'POST',
      url: `/api/v1/pipeline-runs/${ownedRun.id}/synthesize`,
      headers: { 'x-user': 'user-viewer' },
      payload: {}
    });
    equal('but may not consolidate', viewerWrite.statusCode, 403);

    const strangerRead = await app.inject({
      method: 'GET',
      url: `/api/v1/pipeline-runs/${ownedRun.id}/conflicts`,
      headers: { 'x-user': 'user-stranger' }
    });
    equal('someone outside the workspace may not even read', strangerRead.statusCode, 403);

    const ownerWrite = await app.inject({
      method: 'POST',
      url: `/api/v1/pipeline-runs/${ownedRun.id}/synthesize`,
      headers: { 'x-user': 'user-owner' },
      payload: {}
    });
    equal('an owner may consolidate', ownerWrite.statusCode, 200);
    equal(
      'and gets the branch',
      ownerWrite.json().synthesis.branchName,
      `asterim/pipeline/${ownedRun.id}/pr`
    );

    db.prepare('DELETE FROM workspace_memberships WHERE workspace_id = ?').run('ws-fleet');

    await app.close();
    await fleet.teardownRun(repo, run.id);
    await fleet.discardSynthesis(repo, run.id);
    await fleet.teardownRun(repo, ownedRun.id);
    await fleet.discardSynthesis(repo, ownedRun.id);
  }

  describe('a run that never had a fleet says so rather than pretending');
  {
    // A project that is not a git repository is a pipeline that still runs, with
    // each step sandboxed by its own delegation — but there is nothing to
    // consolidate afterwards, and the refusal has to say which of those it is.
    const plainDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-fleet-plain-')));
    tempDirs.push(plainDir);
    dbService
      .getDb()
      .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
      .run('plain-project', 'Plain', plainDir);

    runner.reset();
    const pipeline = engine.savePipeline({
      yaml: `name: No repository\nprojectId: plain-project\nsteps:\n  - id: only\n    role: Tech Lead\n    task: Do it. TOKEN-ONLY\n`
    });
    const run = await engine.runPipeline(pipeline.id);
    equal('a project with no repository still runs its pipeline', run.status, 'PASSED');
    equal('but records no fleet base', run.baseCommit, undefined);
    equal('and the step has no fleet branch', run.steps[0].worktreeBranch, undefined);

    let code: string | null = null;
    try {
      await engine.analyzeRunConflicts(run.id);
    } catch (err) {
      code = (err as { code?: string }).code ?? null;
    }
    equal('analyzing its conflicts is refused', code, 'NO_FLEET');

    code = null;
    try {
      await engine.synthesizeRun(run.id);
    } catch (err) {
      code = (err as { code?: string }).code ?? null;
    }
    equal('and so is consolidating it', code, 'NO_FLEET');
    check('the refusal is a PipelineError', code === 'NO_FLEET');
  }

  // --- Triggers ---------------------------------------------------------------
  describe('schedule intervals are read from a definition’s parameters');
  {
    equal('a plain number is milliseconds', parseScheduleInterval({ intervalMs: '90000' }), 90000);
    equal('a duration is understood', parseScheduleInterval({ schedule: '30m' }), 1800000);
    equal('as are hours', parseScheduleInterval({ every: '2h' }), 7200000);
    equal(
      'anything faster than the floor is run at the floor',
      parseScheduleInterval({ schedule: '1s' }),
      MIN_PIPELINE_SCHEDULE_MS
    );
    equal('a definition that says nothing has no schedule', parseScheduleInterval(undefined), null);
    equal('and nor does nonsense', parseScheduleInterval({ schedule: 'whenever' }), null);
  }

  describe('a commit and a file change start the pipelines that watch for them');
  {
    runner.reset();
    const triggers = new PipelineTriggerService(engine, eventBus, {
      // The production quiet period is three seconds; the behaviour under test
      // is the debounce itself, not how long it lasts.
      fileChangeDebounceMs: 30,
      scheduleTickMs: 1000
    });

    const onCommit = engine.savePipeline({
      yaml: definitionYaml('On commit', [{ id: 'oncommit', task: 'React. TOKEN-ONCOMMIT' }]).replace(
        'trigger: MANUAL',
        'trigger: GIT_COMMIT'
      )
    });
    const onChange = engine.savePipeline({
      yaml: definitionYaml('On change', [{ id: 'onchange', task: 'React. TOKEN-ONCHANGE' }]).replace(
        'trigger: MANUAL',
        'trigger: FILE_CHANGE'
      )
    });
    const manual = engine.savePipeline({
      yaml: definitionYaml('Manual only', [{ id: 'never', task: 'Never. TOKEN-NEVER' }])
    });

    const triggered: AnyEvent[] = [];
    const onTriggered = (event: AnyEvent) => triggered.push(event);
    eventBus.subscribe(PIPELINE_TRIGGERED_EVENT, onTriggered);
    triggers.start();

    publish(PROJECT_ID, PIPELINE_GIT_COMMIT_EVENT, { commitSha: 'deadbeef' });
    check(
      'a commit started the pipeline watching for one',
      await waitFor(() => engine.listRuns(onCommit.id).length > 0),
      'no run appeared'
    );
    await waitFor(() => engine.listRuns(onCommit.id)[0].status !== 'RUNNING');
    const commitRun = engine.listRuns(onCommit.id)[0];
    equal('and it ran to completion', commitRun.status, 'PASSED');
    equal('the run knows what started it', commitRun.runContext.triggeredBy, 'GIT_COMMIT');
    equal('and which commit', commitRun.runContext.commitSha, 'deadbeef');
    equal('a MANUAL pipeline was not started by it', engine.listRuns(manual.id).length, 0);
    equal(
      'the trigger was announced on the bus',
      triggered.filter(event => event.payload.trigger === 'GIT_COMMIT').length,
      1
    );

    // A burst of file changes is one run, not one per event.
    for (const file of ['src/a.ts', 'src/b.ts', 'src/a.ts']) {
      publish(PROJECT_ID, 'file.changed', { filePath: file, changeType: 'modified' });
    }
    check(
      'a burst of file changes started one run',
      await waitFor(() => engine.listRuns(onChange.id).length > 0),
      'no run appeared'
    );
    await waitFor(() => engine.listRuns(onChange.id)[0].status !== 'RUNNING');
    equal('exactly one', engine.listRuns(onChange.id).length, 1);
    const changeRun = engine.listRuns(onChange.id)[0];
    equal('which passed', changeRun.status, 'PASSED');
    check(
      'and was told which files moved',
      String(changeRun.runContext.changedFiles ?? '').includes('src/a.ts'),
      String(changeRun.runContext.changedFiles)
    );
    equal(
      'a commit pipeline was not started by a file change',
      engine.listRuns(onCommit.id).length,
      1
    );

    // A commit in a project no pipeline watches starts nothing.
    const before = engine.listRuns(onCommit.id).length;
    publish('plain-project', PIPELINE_GIT_COMMIT_EVENT, { commitSha: 'cafe' });
    await pause(120);
    equal('a commit in another project starts nothing', engine.listRuns(onCommit.id).length, before);

    // The schedule listener, driven directly rather than by waiting a minute.
    const scheduled = engine.savePipeline({
      yaml: definitionYaml(
        'On a schedule',
        [{ id: 'onschedule', task: 'Tick. TOKEN-ONSCHEDULE' }],
        'parameters:\n  schedule: 1m\n'
      ).replace('trigger: MANUAL', 'trigger: SCHEDULE')
    });
    equal('the first tick only starts the clock', await triggers.onScheduleTick(1_000_000), 0);
    equal('nothing has run yet', engine.listRuns(scheduled.id).length, 0);
    equal(
      'a tick after the interval starts a run',
      await triggers.onScheduleTick(1_000_000 + MIN_PIPELINE_SCHEDULE_MS + 1),
      1
    );
    check(
      'which reaches storage',
      await waitFor(() => engine.listRuns(scheduled.id).length === 1),
      'no scheduled run appeared'
    );
    await waitFor(() => engine.listRuns(scheduled.id)[0].status !== 'RUNNING');
    equal('and passes', engine.listRuns(scheduled.id)[0].status, 'PASSED');
    equal(
      'a tick before the next interval starts nothing',
      await triggers.onScheduleTick(1_000_000 + MIN_PIPELINE_SCHEDULE_MS + 2),
      0
    );

    triggers.stop();
    const quiet = engine.listRuns(onCommit.id).length;
    publish(PROJECT_ID, PIPELINE_GIT_COMMIT_EVENT, { commitSha: 'after-stop' });
    await pause(120);
    equal('a stopped listener starts nothing', engine.listRuns(onCommit.id).length, quiet);
    eventBus.unsubscribe(PIPELINE_TRIGGERED_EVENT, onTriggered);

    for (const id of [onCommit.id, onChange.id, scheduled.id]) {
      for (const run of engine.listRuns(id)) await fleet.teardownRun(repo, run.id);
    }
    check('the shipped trigger singleton exists', !!pipelineTriggerService);
    check('as does the fleet singleton the engine defaults to', !!worktreeFleetService);
  }

  // --- Nothing left behind ----------------------------------------------------
  describe('the fleet leaves no orphaned checkout or branch behind it');
  {
    equal('no fleet branch survives the suite', fleetBranches(repo), []);
    equal('no checkout is still registered', registeredWorktrees(repo), []);
    equal('the operator’s working tree is clean', git('git status --porcelain', repo), '');
    check(
      'and the pipeline fleet directory is empty',
      !fs.existsSync(path.join(repo, '.asterim', 'worktrees', 'pipeline')) ||
        fs.readdirSync(path.join(repo, '.asterim', 'worktrees', 'pipeline')).length === 0,
      fs.existsSync(path.join(repo, '.asterim', 'worktrees', 'pipeline'))
        ? fs.readdirSync(path.join(repo, '.asterim', 'worktrees', 'pipeline')).join(', ')
        : 'absent'
    );
    check('the engine still refuses an unknown run', !!PipelineError);
    check('and both pipeline events are still exported', !!PIPELINE_COMPLETED_EVENT && !!PIPELINE_FAILED_EVENT);
  }

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
