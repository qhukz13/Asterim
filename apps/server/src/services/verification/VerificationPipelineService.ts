/**
 * Automated Verification Pipelines (P8-02).
 *
 * Runs a project's own verification commands in one directory and reports what
 * they exited as. It exists because a delegated subagent's account of its work
 * is a claim — "types are clean, tests pass" is a sentence an agent can write
 * whether or not it is true — and the only thing that settles it is running the
 * project's typechecker, linter, tests and build and reading the exit codes.
 *
 * Four rules shape it:
 *
 * **The pipeline is the project's, not Asterim's.** Nothing here knows what a
 * verification command looks like. It is discovered: an explicit
 * `.asterim/verification.json` if the operator wrote one — which is how a Rust,
 * Go or Python project says `cargo test`, `go test ./...`, `pytest` — otherwise
 * the lifecycle scripts the project's own `package.json` declares, run through
 * whichever package manager its lockfile names.
 *
 * **It runs where the work happened.** The target directory is a delegated
 * child's worktree sandbox (P8-01) far more often than it is the project, and
 * every artefact a step produces — `dist/`, `.tsbuildinfo`, coverage output —
 * lands there rather than in the operator's working tree. Nothing in this file
 * writes to a path it was not given.
 *
 * **Nothing it runs can take the Core down.** A step that exits non-zero, a
 * binary that is not installed, a watcher that never returns, a build that
 * prints a hundred megabytes: each is a failed step with a reason on it. The
 * process is killed on its timeout, escalated from SIGTERM to SIGKILL, and its
 * output is bounded on the way in rather than trimmed after the fact.
 *
 * **Only the project's own strings reach a shell.** The one thing Asterim
 * assembles itself is `<manager> run <script>`, and the script name is refused
 * unless it is an ordinary identifier — `package.json` is a file a delegated
 * agent can write. A command from a configuration file is run as written,
 * because that is the entire point of the file, and it is trusted exactly as
 * much as the repository's own build scripts already are.
 */

import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  MAX_VERIFICATION_COMMAND_CHARS,
  MAX_VERIFICATION_OUTPUT_CHARS,
  MAX_VERIFICATION_STEPS,
  MAX_VERIFICATION_TIMEOUT_MS,
  VERIFICATION_CONFIG_FILES,
  VERIFICATION_LOCKFILES,
  VERIFICATION_SCRIPT_CANDIDATES,
  VerificationPackageManager,
  VerificationPipelineReport,
  VerificationStep,
  VerificationStepResult,
  isSafeScriptName
} from '@asterim/shared';

/** How long a step gets to die politely before it is killed outright. */
export const VERIFICATION_KILL_GRACE_MS = 5000;

/** Where discovery looks, and where a step runs. */
export interface DiscoveryOptions {
  /**
   * A second directory to read the pipeline configuration from.
   *
   * `.asterim/` is excluded from Git tracking, so a worktree sandbox — a fresh
   * checkout of tracked files — does not contain the operator's
   * `.asterim/verification.json` even though the project it was branched from
   * does. This is how the sandbox is verified with the pipeline the operator
   * actually configured, rather than falling back to whatever `package.json`
   * happens to say.
   */
  configDir?: string;
}

export interface RunPipelineOptions extends DiscoveryOptions {
  /** Run only these discovered steps, by name. Unknown names are ignored. */
  steps?: string[];
  /** Overrides the per-step timeout for every step in this pass. */
  timeoutMs?: number;
}

/** What a step's process is given on top of the environment Asterim runs in. */
function stepEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // A verification step runs with no terminal attached to it. Every one of
    // these turns something that would otherwise block forever — a test runner
    // dropping into watch mode, git asking for a password, a prompt waiting on
    // a keypress — into an immediate answer, and strips the escape codes that
    // would otherwise fill the captured output.
    CI: '1',
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    GIT_TERMINAL_PROMPT: '0'
  };
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** A timeout inside the accepted band; anything else is the default. */
function clampTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_VERIFICATION_TIMEOUT_MS;
  }
  return Math.min(Math.round(value), MAX_VERIFICATION_TIMEOUT_MS);
}

/** Keeps a stream's head, which is where a compiler puts the first error. */
function bounded(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_VERIFICATION_OUTPUT_CHARS
    ? `${trimmed.slice(0, MAX_VERIFICATION_OUTPUT_CHARS)}\n… (output truncated)`
    : trimmed;
}

export class VerificationPipelineService {
  // --- Discovery --------------------------------------------------------------

  /**
   * The steps that verify one directory, in the order they should run.
   *
   * An explicit configuration wins outright, including when it declares no steps
   * at all: an operator who wrote an empty pipeline has said this project is not
   * to be verified automatically, and guessing from `package.json` anyway would
   * override them. A configuration file that cannot be read falls through to
   * discovery rather than failing, because a typo in a JSON file is not a reason
   * to stop verifying a project.
   */
  public discoverPipeline(targetDir: string, options: DiscoveryOptions = {}): VerificationStep[] {
    const dir = path.resolve(targetDir ?? '');
    if (!isDirectory(dir)) return [];

    const configured =
      this.readConfiguredSteps(dir) ??
      (options.configDir && path.resolve(options.configDir) !== dir
        ? this.readConfiguredSteps(path.resolve(options.configDir))
        : null);
    if (configured) return configured.slice(0, MAX_VERIFICATION_STEPS);

    return this.discoverNodeScripts(dir).slice(0, MAX_VERIFICATION_STEPS);
  }

  /** The package manager a Node project is driven with, from its lockfile. */
  public detectPackageManager(targetDir: string): VerificationPackageManager {
    const dir = path.resolve(targetDir ?? '');
    for (const { file, manager } of VERIFICATION_LOCKFILES) {
      if (fileExists(path.join(dir, file))) return manager;
    }

    // No lockfile: Corepack's `packageManager` field is the next most reliable
    // statement a project makes about itself.
    const manifest = this.readPackageJson(dir);
    const declared = typeof manifest?.packageManager === 'string' ? manifest.packageManager : '';
    const named = declared.split('@')[0].trim().toLowerCase();
    if (named === 'pnpm' || named === 'yarn' || named === 'bun' || named === 'npm') return named;

    return 'npm';
  }

  /**
   * Whether a directory's dependencies are installed in it.
   *
   * A worktree sandbox is a checkout of tracked files, and `node_modules` is not
   * tracked — so `pnpm run typecheck` in a fresh sandbox fails because `tsc` is
   * not there, not because the child's work is broken. Reporting that as a
   * failed verification is the false alarm this subsystem exists to prevent, so
   * a directory with no dependencies installed has no `package.json` pipeline to
   * discover. An explicit `.asterim/verification.json` is unaffected: a project
   * that declares `cargo test` never needed `node_modules`.
   */
  public hasInstalledDependencies(targetDir: string): boolean {
    return isDirectory(path.join(path.resolve(targetDir ?? ''), 'node_modules'));
  }

  private readPackageJson(dir: string): Record<string, unknown> | null {
    const manifestPath = path.join(dir, 'package.json');
    if (!fileExists(manifestPath)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch (err) {
      console.warn(`[Verification] Could not read ${manifestPath}: ${(err as Error).message}`);
      return null;
    }
  }

  /** The lifecycle scripts a Node project declares, as steps. */
  private discoverNodeScripts(dir: string): VerificationStep[] {
    const manifest = this.readPackageJson(dir);
    if (!manifest) return [];

    const scripts = manifest.scripts;
    if (!scripts || typeof scripts !== 'object') return [];
    if (!this.hasInstalledDependencies(dir)) return [];

    const declared = scripts as Record<string, unknown>;
    const manager = this.detectPackageManager(dir);
    const steps: VerificationStep[] = [];

    for (const candidate of VERIFICATION_SCRIPT_CANDIDATES) {
      const script = candidate.scripts.find(
        name => typeof declared[name] === 'string' && (declared[name] as string).trim() !== ''
      );
      // Refused rather than escaped: the only names that reach a command line
      // are the ones that need no escaping.
      if (!script || !isSafeScriptName(script)) continue;
      steps.push({ name: candidate.name, command: `${manager} run ${script}` });
    }

    return steps;
  }

  /**
   * The pipeline an operator wrote by hand, or null when there is none here.
   *
   * Two shapes are accepted because both are the obvious one to write: a bare
   * array of steps, and an object with a `steps` key. A step may be a string,
   * which is its own name.
   */
  private readConfiguredSteps(dir: string): VerificationStep[] | null {
    for (const relative of VERIFICATION_CONFIG_FILES) {
      const configPath = path.join(dir, ...relative.split('/'));
      if (!fileExists(configPath)) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (err) {
        console.warn(
          `[Verification] Ignoring ${configPath}: it is not readable JSON (${(err as Error).message})`
        );
        return null;
      }

      const raw = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { steps?: unknown }).steps)
          ? ((parsed as { steps: unknown[] }).steps)
          : [];

      return raw.map(entry => normalizeConfiguredStep(entry)).filter((step): step is VerificationStep => !!step);
    }

    return null;
  }

  // --- Execution --------------------------------------------------------------

  /**
   * Runs one step and reports what it exited as.
   *
   * Never throws and never rejects. Every way a command can go wrong — a shell
   * that cannot start it, a binary that is not installed, a process that never
   * returns — is a `VerificationStepResult` with `passed: false` and a reason,
   * because the caller is a delegation that has to report something either way.
   */
  public async runStep(
    step: VerificationStep,
    targetDir: string,
    timeoutMs?: number
  ): Promise<VerificationStepResult> {
    const startedAt = Date.now();
    const name = typeof step?.name === 'string' && step.name.trim() ? step.name.trim() : 'step';
    const command = typeof step?.command === 'string' ? step.command.trim() : '';
    const cwd = path.resolve(targetDir ?? '');

    const failure = (error: string): VerificationStepResult => ({
      name,
      command,
      passed: false,
      exitCode: null,
      durationMs: Date.now() - startedAt,
      error
    });

    if (!command) return failure('the step declares no command to run.');
    if (command.length > MAX_VERIFICATION_COMMAND_CHARS) {
      return failure(`the command is longer than ${MAX_VERIFICATION_COMMAND_CHARS} characters.`);
    }
    if (!isDirectory(cwd)) return failure(`there is no directory at ${cwd} to run it in.`);

    const limit = clampTimeout(timeoutMs ?? step?.timeoutMs);

    return new Promise<VerificationStepResult>(resolve => {
      let child: ChildProcess;
      try {
        child = spawn(command, {
          cwd,
          shell: true,
          env: stepEnvironment(),
          // Nothing is ever written to a step's stdin, and a command that reads
          // from it gets EOF rather than blocking on a terminal that is not there.
          stdio: ['ignore', 'pipe', 'pipe'],
          // Its own process group, so killing a timed-out step kills the tree it
          // spawned rather than only the shell at the top of it. Windows has no
          // process groups; `child.kill` and `taskkill`-free teardown are what
          // is available there.
          detached: process.platform !== 'win32'
        });
      } catch (err) {
        resolve(failure(`the command could not be started: ${(err as Error).message}`));
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      let spawnError: string | undefined;

      const capture = (chunk: Buffer, onto: 'out' | 'err') => {
        const text = chunk.toString('utf8');
        if (onto === 'out') {
          // Bounded as it arrives rather than at the end: a build that prints a
          // gigabyte must not be held in memory in order to be truncated.
          if (stdout.length < MAX_VERIFICATION_OUTPUT_CHARS + 1) stdout += text;
        } else if (stderr.length < MAX_VERIFICATION_OUTPUT_CHARS + 1) {
          stderr += text;
        }
      };

      child.stdout?.on('data', chunk => capture(chunk as Buffer, 'out'));
      child.stderr?.on('data', chunk => capture(chunk as Buffer, 'err'));

      const killTree = (signal: NodeJS.Signals) => {
        try {
          if (child.pid && process.platform !== 'win32') {
            process.kill(-child.pid, signal);
            return;
          }
        } catch {
          // The group is already gone, or was never created. Fall through to the
          // child itself, which is the only handle left.
        }
        try {
          child.kill(signal);
        } catch {
          /* already dead */
        }
      };

      // Armed only once the polite signal has been sent, so a step that handles
      // SIGTERM and exits on it is never killed outright — and cleared the
      // moment the process closes, so a step that dies politely leaves no timer
      // holding the event loop open.
      let hardTimer: NodeJS.Timeout | undefined;
      const softTimer = setTimeout(() => {
        timedOut = true;
        killTree('SIGTERM');
        hardTimer = setTimeout(() => killTree('SIGKILL'), VERIFICATION_KILL_GRACE_MS);
      }, limit);

      const settle = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(softTimer);
        if (hardTimer) clearTimeout(hardTimer);

        const durationMs = Date.now() - startedAt;
        const error = timedOut
          ? `it did not finish within ${Math.round(limit / 1000)}s and was killed.`
          : spawnError;

        resolve({
          name,
          command,
          passed: !timedOut && !spawnError && exitCode === 0,
          exitCode,
          durationMs,
          stdoutSummary: bounded(stdout),
          stderrSummary: bounded(stderr),
          error
        });
      };

      child.on('error', err => {
        // A shell that could not be spawned at all. `close` may or may not
        // follow, so the reason is recorded and whichever arrives first settles.
        spawnError = `the command could not be started: ${err.message}`;
        settle(null);
      });
      child.on('close', code => settle(code));
    });
  }

  /**
   * Runs a directory's whole pipeline and reports what it established.
   *
   * Sequentially, and without stopping at the first failure. Both are
   * deliberate: verification steps in the same directory contend for the same
   * build output and the same ports, and a parent told only that the typecheck
   * failed does not know whether the tests would have passed. The whole matrix
   * is what a decision is made from.
   *
   * Never throws. A directory that does not exist, a project with no pipeline
   * and a project whose every step failed are all reports.
   */
  public async runPipeline(
    targetDir: string,
    options: RunPipelineOptions = {}
  ): Promise<VerificationPipelineReport> {
    const executedAt = Date.now();
    const cwd = path.resolve(targetDir ?? '');

    const discovered = this.discoverPipeline(cwd, { configDir: options.configDir });
    const steps = selectSteps(discovered, options.steps);

    const results: VerificationStepResult[] = [];
    for (const step of steps) {
      results.push(await this.runStep(step, cwd, options.timeoutMs));
    }

    const passedSteps = results.filter(result => result.passed).length;
    const failedSteps = results.length - passedSteps;

    return {
      // Nothing having run is not a pass: an empty pipeline has established
      // nothing, and `totalSteps` is what says which kind of not-a-pass it is.
      passed: results.length > 0 && failedSteps === 0,
      totalSteps: results.length,
      passedSteps,
      failedSteps,
      durationMs: Date.now() - executedAt,
      steps: results,
      executedAt,
      cwd
    };
  }
}

/**
 * The steps a caller asked for, out of the ones the project has.
 *
 * By name, in the order the caller named them, and silently dropping names the
 * project does not define — a request for `test` in a project with no test
 * script has been answered honestly by a report that ran nothing, and inventing
 * a failed step for it would report a project as broken for not having tests.
 */
export function selectSteps(
  discovered: readonly VerificationStep[],
  wanted?: readonly string[]
): VerificationStep[] {
  if (!Array.isArray(wanted) || wanted.length === 0) return [...discovered];

  const byName = new Map(discovered.map(step => [step.name.toLowerCase(), step]));
  const chosen: VerificationStep[] = [];
  for (const name of wanted) {
    if (typeof name !== 'string') continue;
    const step = byName.get(name.trim().toLowerCase());
    if (step && !chosen.includes(step)) chosen.push(step);
  }
  return chosen;
}

/** One entry of a configuration file, as a step, or null when it is not one. */
function normalizeConfiguredStep(entry: unknown): VerificationStep | null {
  if (typeof entry === 'string') {
    const command = entry.trim();
    if (!command) return null;
    return { name: deriveStepName(command), command };
  }

  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  const command = typeof record.command === 'string' ? record.command.trim() : '';
  if (!command) return null;

  const declared = typeof record.name === 'string' ? record.name.trim() : '';
  const timeoutMs =
    typeof record.timeoutMs === 'number' && Number.isFinite(record.timeoutMs) && record.timeoutMs > 0
      ? Math.min(Math.round(record.timeoutMs), MAX_VERIFICATION_TIMEOUT_MS)
      : undefined;

  const step: VerificationStep = { name: declared || deriveStepName(command), command };
  if (timeoutMs) step.timeoutMs = timeoutMs;
  return step;
}

/** A name for a step that did not bring one: the command's own verb. */
function deriveStepName(command: string): string {
  const words = command.split(/\s+/).filter(Boolean);
  // `pnpm run typecheck` is a typecheck, not a pnpm; the last word of a runner
  // invocation is what it is actually doing.
  const last = words[words.length - 1] ?? 'step';
  return (words.length > 1 && /^(run|exec)$/i.test(words[words.length - 2] ?? '') ? last : words[0]) || 'step';
}

export const verificationPipelineService = new VerificationPipelineService();
