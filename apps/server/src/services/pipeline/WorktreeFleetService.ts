/**
 * The Worktree Fleet Orchestrator (P9-02).
 *
 * A pipeline run is several agents editing one repository at the same time. P8-01
 * gave a single delegated agent a sandbox of its own; a fleet is what that has to
 * become when the agents form a graph, and the whole of this file is the three
 * things a graph needs that a single sandbox did not.
 *
 * **A step's checkout is named after the run, not after the thread.** The branch
 * is `asterim/pipeline/<runId>/step-<stepId>` and the directory is
 * `.asterim/worktrees/pipeline/<runId>/<stepId>`. A delegation sandbox is named
 * after the thread that owns it and dies with it; a fleet branch has to be
 * addressable *after* its step is over, because that is when a downstream step
 * chains from it, a conflict analysis merges it and a synthesis consolidates it.
 * A retry gets a fresh checkout on the same name, which is what makes an attempt
 * repeatable rather than cumulative.
 *
 * **Chaining is the schedule made physical.** A step whose `dependsOn` names an
 * ancestor is branched from that ancestor's settled tip rather than from the
 * repository's HEAD, so the code a test step reads is the code the implementation
 * step actually wrote. Where a step has several ancestors, the first is the base
 * and the rest are merged in; if that merge conflicts the step is not started at
 * all — a step run on half its input produces a confident answer to a question
 * nobody asked, which is the same reason P9-01 skips rather than runs the steps
 * behind a failure.
 *
 * **Conflicts are discovered by asking git, not by guessing.** Two parallel steps
 * that touched different files cannot conflict, so the cheap check — the
 * intersection of their changed paths — runs first and settles most pairs for the
 * price of two `git diff --name-only`. Only an overlapping pair is merged for
 * real, in a throwaway probe checkout that is reset between pairs and removed in
 * a `finally`. Nothing here ever merges into, writes to, or checks anything out
 * in the operator's working tree: every command runs in `.asterim/worktrees/`,
 * and the one branch this file leaves behind on purpose is the synthesis branch,
 * which is the deliverable.
 */

import fs from 'fs';
import path from 'path';
import {
  PIPELINE_BRANCH_PREFIX,
  PIPELINE_WORKTREE_DIR,
  PipelineBranchConflict,
  PipelineConflictAnalysis,
  PipelineStepWorktree,
  PipelineSynthesisResult,
  isPipelineBranch,
  isSafePipelineRefComponent,
  pipelineStepBranchName,
  pipelineSynthesisBranchName
} from '@asterim/shared';
import { GitProvider } from '../git/GitProvider';
import {
  GitWorktreeService,
  gitWorktreeService,
  quoteGitArg,
  sanitizeCommitMessage
} from '../git/GitWorktreeService';

/** How a fleet failure reads to a caller that has to answer for it. */
export type WorktreeFleetErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_A_REPOSITORY'
  | 'NO_COMMITS'
  | 'CHAIN_CONFLICT'
  | 'NOTHING_TO_SYNTHESIZE'
  | 'SYNTHESIS_CONFLICT'
  | 'GIT_FAILED';

export class WorktreeFleetError extends Error {
  constructor(
    public readonly code: WorktreeFleetErrorCode,
    message: string,
    /** The paths git could not reconcile, for the two conflict codes. */
    public readonly files: string[] = []
  ) {
    super(message);
    this.name = 'WorktreeFleetError';
  }
}

/** The commit message a step's leftover work is settled onto its branch with. */
export const FLEET_STEP_COMMIT_MESSAGE = 'Asterim: pipeline step changes';

/** How many changed paths one comparison reports before it is cut short. */
export const MAX_FLEET_CHANGED_FILES = 500;

/** The directory the conflict probe is checked out in, inside the run's fleet. */
const PROBE_DIRECTORY = '__probe';

/** The directory the synthesis branch is assembled in, inside the run's fleet. */
const SYNTHESIS_DIRECTORY = '__pr';

/** The non-empty, trimmed lines of a porcelain listing. */
function lines(output: string | null): string[] {
  return (output || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

export class WorktreeFleetService {
  constructor(
    private readonly provider: GitProvider = new GitProvider(),
    private readonly worktrees: GitWorktreeService = gitWorktreeService
  ) {}

  // --- Naming ---------------------------------------------------------------

  /** Where a run's checkouts live, whether or not any have been provisioned. */
  public fleetRoot(repoPath: string, runId: string): string {
    this.requireComponent(runId, 'run id');
    return path.join(repoPath, ...PIPELINE_WORKTREE_DIR.split('/'), runId);
  }

  /** Where one step of one run is checked out. */
  public stepPath(repoPath: string, runId: string, stepId: string): string {
    this.requireComponent(stepId, 'step id');
    return path.join(this.fleetRoot(repoPath, runId), stepId);
  }

  /** The branch one step of one run works on. */
  public stepBranch(runId: string, stepId: string): string {
    this.requireComponent(runId, 'run id');
    this.requireComponent(stepId, 'step id');
    return pipelineStepBranchName(runId, stepId);
  }

  // --- Provisioning ---------------------------------------------------------

  /**
   * The commit a run's root steps branch from.
   *
   * Resolved once per run and recorded on its row, so every step of the run —
   * and the synthesis afterwards — is measured against the same commit even if
   * the operator's HEAD moves while the pipeline is running.
   */
  public async resolveRunBase(repoPath: string, baseCommit?: string): Promise<string> {
    if (!(await this.worktrees.isRepository(repoPath))) {
      throw new WorktreeFleetError(
        'NOT_A_REPOSITORY',
        `${repoPath} is not a git repository, so a pipeline fleet cannot be provisioned in it.`
      );
    }
    try {
      return await this.worktrees.resolveBaseCommit(repoPath, baseCommit);
    } catch (err) {
      const code = (err as { code?: string }).code === 'NO_COMMITS' ? 'NO_COMMITS' : 'GIT_FAILED';
      throw new WorktreeFleetError(code, (err as Error).message);
    }
  }

  /**
   * Provisions one step's checkout, chained from its ancestors.
   *
   * Always a fresh checkout on a fresh branch: an attempt has to start from its
   * declared input rather than from whatever a previous attempt left in the
   * directory, and a retry that inherited a failed attempt's half-written files
   * would be a different piece of work from the one that was asked for.
   *
   * `chainFrom` is the step's ancestors in dependency order. The first of them
   * that has a branch is the base; every other is merged in. A merge that
   * conflicts is refused rather than resolved — see `CHAIN_CONFLICT`.
   */
  public async provisionStep(params: {
    repoPath: string;
    runId: string;
    stepId: string;
    /** The run's base, for a step with no ancestors. */
    baseCommit?: string;
    /** Ancestor step ids, in dependency order. */
    chainFrom?: readonly string[];
  }): Promise<PipelineStepWorktree> {
    const { repoPath, runId, stepId } = params;
    const branch = this.stepBranch(runId, stepId);
    const worktreePath = this.stepPath(repoPath, runId, stepId);

    if (!(await this.worktrees.isRepository(repoPath))) {
      throw new WorktreeFleetError(
        'NOT_A_REPOSITORY',
        `${repoPath} is not a git repository, so step '${stepId}' cannot be sandboxed.`
      );
    }

    // Before the directory exists, so the primary tree never shows the fleet as
    // untracked even for the moment in between.
    await this.worktrees.ensureIgnored(repoPath);

    // Which ancestors actually have work to chain from, in the order given.
    const ancestors: Array<{ stepId: string; branch: string; tip: string }> = [];
    for (const ancestorId of params.chainFrom ?? []) {
      const ancestorBranch = this.stepBranch(runId, ancestorId);
      const tip = await this.tipOf(repoPath, ancestorBranch);
      if (tip) ancestors.push({ stepId: ancestorId, branch: ancestorBranch, tip });
    }

    const base = ancestors[0]?.tip ?? (await this.resolveRunBase(repoPath, params.baseCommit));

    await this.removeStep(repoPath, runId, stepId);
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    try {
      await this.provider.exec(
        `git worktree add ${quoteGitArg(worktreePath)} -b ${quoteGitArg(branch)} ${quoteGitArg(base)}`,
        repoPath
      );
    } catch (err) {
      throw new WorktreeFleetError(
        'GIT_FAILED',
        `Could not provision a checkout for step '${stepId}': ${(err as Error).message}`
      );
    }

    // Every ancestor after the first: the step is downstream of a fan-out, and
    // its input is all of them rather than whichever one happened to be listed
    // first.
    for (const ancestor of ancestors.slice(1)) {
      try {
        await this.provider.exec(
          `git merge --no-ff ${quoteGitArg(ancestor.tip)} -m ${quoteGitArg(
            `Asterim: chain step ${stepId} onto ${ancestor.stepId}`
          )}`,
          worktreePath
        );
      } catch (err) {
        const conflicted = lines(
          await this.tryExec('git diff --name-only --diff-filter=U', worktreePath)
        );
        await this.tryExec('git merge --abort', worktreePath);
        // The half-chained checkout is not input any step should run on.
        await this.removeStep(repoPath, runId, stepId);
        throw new WorktreeFleetError(
          'CHAIN_CONFLICT',
          `Step '${stepId}' cannot be started: its ancestors '${ancestors[0].stepId}' and '${ancestor.stepId}' changed the same work` +
            (conflicted.length > 0
              ? ` in: ${conflicted.join(', ')}.`
              : `: ${(err as Error).message}`),
          conflicted
        );
      }
    }

    return {
      runId,
      stepId,
      path: worktreePath,
      branch,
      baseCommit: base,
      chainedFrom: ancestors.map(ancestor => ancestor.stepId),
      createdAt: Date.now()
    };
  }

  /**
   * Commits whatever a step left in its checkout, onto its own branch.
   *
   * A step's successor is branched from a *commit*, so work an agent left
   * uncommitted would simply not be there for the next step to read. This is an
   * agent's work being committed, which Asterim does not do on its own
   * initiative (`blueprint/GIT.md`) — it happens on the run's own ephemeral
   * branch, never on the operator's, and nothing reaches a real branch until
   * somebody asks for a synthesis or a merge.
   *
   * Answers with the branch tip either way, so a step that committed its own
   * work and a step that committed nothing both give the successor something to
   * chain from.
   */
  public async settleStep(
    worktree: Pick<PipelineStepWorktree, 'path' | 'stepId'>,
    message?: string
  ): Promise<{ commitSha: string; committed: boolean }> {
    if (!fs.existsSync(worktree.path)) {
      throw new WorktreeFleetError(
        'GIT_FAILED',
        `Step '${worktree.stepId}' has no checkout at ${worktree.path} to settle.`
      );
    }

    const dirty = lines(await this.tryExec('git status --porcelain', worktree.path));
    let committed = false;

    if (dirty.length > 0) {
      try {
        await this.provider.exec('git add --all', worktree.path);
        await this.provider.exec(
          `git commit --no-verify -m ${quoteGitArg(
            sanitizeCommitMessage(message, `${FLEET_STEP_COMMIT_MESSAGE} (${worktree.stepId})`)
          )}`,
          worktree.path
        );
        committed = true;
      } catch (err) {
        // Fail-closed: work that could not be committed cannot be chained from,
        // and a successor branched from the previous commit would silently be
        // handed the wrong input.
        throw new WorktreeFleetError(
          'GIT_FAILED',
          `Could not settle step '${worktree.stepId}': ${(err as Error).message}`
        );
      }
    }

    const head = (await this.tryExec('git rev-parse HEAD', worktree.path))?.trim();
    if (!head) {
      throw new WorktreeFleetError(
        'GIT_FAILED',
        `Step '${worktree.stepId}' has no commit to chain from.`
      );
    }
    return { commitSha: head, committed };
  }

  /** What a step's branch points at, or null when it has none. */
  public async stepTip(repoPath: string, runId: string, stepId: string): Promise<string | null> {
    return this.tipOf(repoPath, this.stepBranch(runId, stepId));
  }

  /** What a step changed against the run's base, by path. */
  public async changedFiles(
    repoPath: string,
    runId: string,
    stepId: string,
    baseCommit: string
  ): Promise<string[]> {
    const branch = this.stepBranch(runId, stepId);
    if (!(await this.tipOf(repoPath, branch))) return [];
    const output = await this.tryExec(
      // Three dots: what the branch changed since it diverged, rather than
      // everything the base has gained since — a chained step is measured by
      // its own edits, not by its ancestors'.
      `git diff --name-only ${quoteGitArg(`${baseCommit}...${branch}`)}`,
      repoPath
    );
    return lines(output).slice(0, MAX_FLEET_CHANGED_FILES);
  }

  // --- Conflict detection ---------------------------------------------------

  /**
   * Whether a run's step branches can be combined, and where they cannot.
   *
   * Pairwise, and in two passes. A pair where one branch is an ancestor of the
   * other cannot conflict — that is a chain, and its merge is a fast-forward —
   * so it is skipped outright. A pair that changed no path in common cannot
   * conflict either, which settles almost every fan-out for the price of two
   * `git diff --name-only`. Only what survives both is merged for real, in a
   * probe checkout that is thrown away afterwards.
   *
   * Nothing is changed by asking: the probe is a separate checkout, every merge
   * in it is aborted, and the operator's working tree is never touched.
   */
  public async analyzeConflicts(
    repoPath: string,
    runId: string,
    stepIds: readonly string[],
    baseCommit?: string
  ): Promise<PipelineConflictAnalysis> {
    const present: Array<{ stepId: string; branch: string; tip: string }> = [];
    const missingStepIds: string[] = [];

    for (const stepId of stepIds) {
      const branch = this.stepBranch(runId, stepId);
      const tip = await this.tipOf(repoPath, branch);
      if (tip) present.push({ stepId, branch, tip });
      else missingStepIds.push(stepId);
    }

    const analysis: PipelineConflictAnalysis = {
      hasConflicts: false,
      conflictedFiles: [],
      branches: present.map(entry => entry.branch),
      conflicts: [],
      missingStepIds
    };
    if (present.length < 2) return analysis;

    const base = baseCommit?.trim() || (await this.resolveRunBase(repoPath));
    const changed = new Map<string, Set<string>>();
    for (const entry of present) {
      changed.set(entry.stepId, new Set(await this.changedFiles(repoPath, runId, entry.stepId, base)));
    }

    const suspects: Array<{
      left: { stepId: string; branch: string; tip: string };
      right: { stepId: string; branch: string; tip: string };
      overlap: string[];
    }> = [];

    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const left = present[i];
        const right = present[j];
        if (await this.isAncestor(repoPath, left.tip, right.tip)) continue;
        if (await this.isAncestor(repoPath, right.tip, left.tip)) continue;

        const overlap = [...(changed.get(left.stepId) ?? [])]
          .filter(file => changed.get(right.stepId)?.has(file))
          .sort();
        if (overlap.length === 0) continue;
        suspects.push({ left, right, overlap });
      }
    }
    if (suspects.length === 0) return analysis;

    const probePath = path.join(this.fleetRoot(repoPath, runId), PROBE_DIRECTORY);
    const conflicts: PipelineBranchConflict[] = [];
    try {
      await this.openProbe(repoPath, probePath, base);
      for (const suspect of suspects) {
        const files = await this.mergeProbe(probePath, suspect.left.tip, suspect.right.tip);
        if (files.length === 0) continue;
        conflicts.push({
          stepIds: [suspect.left.stepId, suspect.right.stepId],
          branches: [suspect.left.branch, suspect.right.branch],
          files
        });
      }
    } finally {
      await this.removeProbe(repoPath, probePath);
    }

    const conflictedFiles = [...new Set(conflicts.flatMap(entry => entry.files))].sort();
    return { ...analysis, hasConflicts: conflicts.length > 0, conflictedFiles, conflicts };
  }

  // --- Synthesis ------------------------------------------------------------

  /**
   * Consolidates a run's step branches into one branch an operator can merge.
   *
   * `asterim/pipeline/<runId>/pr`, built in a throwaway checkout on the run's own
   * base commit — not on the operator's HEAD, and never in the operator's
   * working tree. The step branches are merged in dependency order, so a chained
   * step's merge carries its ancestors and a fan-out's merges carry each other's
   * edits; a conflict aborts the whole synthesis and leaves no branch behind,
   * because half a consolidation is worse than none.
   *
   * The tip is an empty commit summarizing the run. It exists so that the branch
   * has one place that says what it is: a person looking at it in six months
   * gets the run's id, its steps and their roles from `git log -1`, rather than
   * from a merge commit that happens to be last.
   */
  public async synthesize(params: {
    repoPath: string;
    runId: string;
    baseCommit: string;
    /** Steps to consolidate, in dependency order. */
    steps: ReadonlyArray<{ stepId: string; stepName?: string; roleProfileId?: string }>;
    /** The pipeline's name, for the summary commit. */
    pipelineName?: string;
    message?: string;
  }): Promise<PipelineSynthesisResult> {
    const { repoPath, runId, baseCommit } = params;
    const branchName = pipelineSynthesisBranchName(runId);
    this.requireComponent(runId, 'run id');

    if (!(await this.worktrees.isRepository(repoPath))) {
      throw new WorktreeFleetError(
        'NOT_A_REPOSITORY',
        `${repoPath} is not a git repository, so there is nothing to synthesize into.`
      );
    }

    const mergeable: Array<{ stepId: string; branch: string; tip: string }> = [];
    const skippedStepIds: string[] = [];
    for (const step of params.steps) {
      const branch = this.stepBranch(runId, step.stepId);
      const tip = await this.tipOf(repoPath, branch);
      // A branch that never moved off the base contributed nothing; merging it
      // would add a merge commit that carries no change.
      const ahead = tip
        ? Number(
            (
              await this.tryExec(
                `git rev-list --count ${quoteGitArg(`${baseCommit}..${tip}`)}`,
                repoPath
              )
            )?.trim() || '0'
          )
        : 0;
      if (tip && ahead > 0) mergeable.push({ stepId: step.stepId, branch, tip });
      else skippedStepIds.push(step.stepId);
    }

    if (mergeable.length === 0) {
      throw new WorktreeFleetError(
        'NOTHING_TO_SYNTHESIZE',
        `Run ${runId} has no step branch with changes to consolidate.`
      );
    }

    const worktreePath = path.join(this.fleetRoot(repoPath, runId), SYNTHESIS_DIRECTORY);
    await this.discardSynthesis(repoPath, runId);
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    await this.worktrees.ensureIgnored(repoPath);

    try {
      await this.provider.exec(
        `git worktree add ${quoteGitArg(worktreePath)} -b ${quoteGitArg(branchName)} ${quoteGitArg(baseCommit)}`,
        repoPath
      );
    } catch (err) {
      throw new WorktreeFleetError(
        'GIT_FAILED',
        `Could not start the synthesis branch for run ${runId}: ${(err as Error).message}`
      );
    }

    try {
      for (const entry of mergeable) {
        try {
          await this.provider.exec(
            `git merge --no-ff ${quoteGitArg(entry.tip)} -m ${quoteGitArg(
              `Asterim: step ${entry.stepId} of run ${runId}`
            )}`,
            worktreePath
          );
        } catch (err) {
          const conflicted = lines(
            await this.tryExec('git diff --name-only --diff-filter=U', worktreePath)
          );
          await this.tryExec('git merge --abort', worktreePath);
          throw new WorktreeFleetError(
            'SYNTHESIS_CONFLICT',
            conflicted.length > 0
              ? `Step '${entry.stepId}' conflicts with the steps already consolidated, in: ${conflicted.join(', ')}. Nothing was merged.`
              : `Step '${entry.stepId}' could not be consolidated: ${(err as Error).message}`,
            conflicted
          );
        }
      }

      const summary = this.summaryMessage(params, mergeable.map(entry => entry.stepId));
      await this.provider.exec(
        `git commit --allow-empty --no-verify -m ${quoteGitArg(sanitizeCommitMessage(params.message ?? summary, summary))}`,
        worktreePath
      );
      const commitSha = (await this.tryExec('git rev-parse HEAD', worktreePath))?.trim() ?? '';

      return {
        branchName,
        commitSha,
        mergedStepIds: mergeable.map(entry => entry.stepId),
        skippedStepIds,
        baseCommit
      };
    } catch (err) {
      // A synthesis that did not finish leaves no branch: an operator must never
      // find `…/pr` carrying some of a run's steps and be unable to tell which.
      await this.discardSynthesis(repoPath, runId);
      throw err;
    } finally {
      // The branch is the deliverable; the checkout it was assembled in is not.
      if (fs.existsSync(worktreePath)) {
        await this.tryExec(`git worktree remove --force ${quoteGitArg(worktreePath)}`, repoPath);
        if (fs.existsSync(worktreePath)) fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      await this.tryExec('git worktree prune', repoPath);
    }
  }

  // --- Teardown -------------------------------------------------------------

  /**
   * Discards one step's checkout and its branch.
   *
   * Only ever a branch under `asterim/pipeline/`, so a fleet that was somehow
   * pointed at a real branch cannot take it with it.
   */
  public async removeStep(repoPath: string, runId: string, stepId: string): Promise<boolean> {
    const worktreePath = this.stepPath(repoPath, runId, stepId);
    const branch = this.stepBranch(runId, stepId);
    let removed = false;

    if (fs.existsSync(worktreePath)) {
      const viaGit = await this.tryExec(
        `git worktree remove --force ${quoteGitArg(worktreePath)}`,
        repoPath
      );
      if (viaGit === null && fs.existsSync(worktreePath)) {
        try {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        } catch (err) {
          console.warn(`[Fleet] Could not delete ${worktreePath}: ${(err as Error).message}`);
        }
      }
      removed = !fs.existsSync(worktreePath);
    }

    await this.tryExec('git worktree prune', repoPath);

    if (isPipelineBranch(branch) && (await this.tipOf(repoPath, branch))) {
      const deleted = await this.tryExec(`git branch -D ${quoteGitArg(branch)}`, repoPath);
      removed = removed || deleted !== null;
    }
    return removed;
  }

  /**
   * Discards everything a run's fleet left behind: checkouts and branches.
   *
   * Not called when a run ends — a step's checkout is the evidence a person
   * reviews, exactly as a delegation's sandbox is (P8-01) — but exposed so an
   * operator, a test and a future retention policy have one way to do it.
   */
  public async teardownRun(repoPath: string, runId: string): Promise<number> {
    this.requireComponent(runId, 'run id');
    if (!(await this.worktrees.isRepository(repoPath))) return 0;
    let removed = 0;

    const root = this.fleetRoot(repoPath, runId);
    if (fs.existsSync(root)) {
      for (const entry of fs.readdirSync(root)) {
        const target = path.join(root, entry);
        if (
          (await this.tryExec(`git worktree remove --force ${quoteGitArg(target)}`, repoPath)) !== null
        ) {
          removed++;
        }
      }
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        /* best effort: a checkout git still holds is pruned below */
      }
    }
    await this.tryExec('git worktree prune', repoPath);

    for (const branch of lines(
      await this.tryExec(
        `git for-each-ref --format="%(refname:short)" ${quoteGitArg(`refs/heads/${PIPELINE_BRANCH_PREFIX}${runId}/`)}`,
        repoPath
      )
    )) {
      if (!isPipelineBranch(branch)) continue;
      if ((await this.tryExec(`git branch -D ${quoteGitArg(branch)}`, repoPath)) !== null) removed++;
    }
    return removed;
  }

  /** Removes a run's synthesis branch and the checkout it is assembled in. */
  public async discardSynthesis(repoPath: string, runId: string): Promise<void> {
    const worktreePath = path.join(this.fleetRoot(repoPath, runId), SYNTHESIS_DIRECTORY);
    if (fs.existsSync(worktreePath)) {
      await this.tryExec(`git worktree remove --force ${quoteGitArg(worktreePath)}`, repoPath);
      if (fs.existsSync(worktreePath)) {
        try {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    }
    await this.tryExec('git worktree prune', repoPath);

    const branch = pipelineSynthesisBranchName(runId);
    if (isPipelineBranch(branch) && (await this.tipOf(repoPath, branch))) {
      await this.tryExec(`git branch -D ${quoteGitArg(branch)}`, repoPath);
    }
  }

  // --- Internals ------------------------------------------------------------

  private requireComponent(value: string, what: string): void {
    if (!isSafePipelineRefComponent(value)) {
      throw new WorktreeFleetError(
        'INVALID_INPUT',
        `'${value}' is not a ${what} a fleet branch and directory can be named after.`
      );
    }
  }

  /** What a branch points at, or null when it does not exist. */
  private async tipOf(repoPath: string, branch: string): Promise<string | null> {
    const answer = await this.tryExec(
      `git rev-parse --verify --quiet ${quoteGitArg(`refs/heads/${branch}`)}`,
      repoPath
    );
    return answer?.trim() || null;
  }

  /** Whether `candidate` is already contained in `descendant`. */
  private async isAncestor(
    repoPath: string,
    candidate: string,
    descendant: string
  ): Promise<boolean> {
    return (
      (await this.tryExec(
        `git merge-base --is-ancestor ${quoteGitArg(candidate)} ${quoteGitArg(descendant)}`,
        repoPath
      )) !== null
    );
  }

  /**
   * A detached checkout the conflict analysis merges in.
   *
   * A real second checkout rather than `git merge-tree`: the porcelain of
   * `merge-tree` changed shape in git 2.38 and the older form reports conflicts
   * as text markers inside a patch rather than as a list of paths, so reading it
   * would mean parsing two formats and guessing which one this workstation's git
   * speaks. A probe merge answers with `--diff-filter=U` on every version.
   */
  private async openProbe(repoPath: string, probePath: string, base: string): Promise<void> {
    if (fs.existsSync(probePath)) await this.removeProbe(repoPath, probePath);
    fs.mkdirSync(path.dirname(probePath), { recursive: true });
    try {
      await this.provider.exec(
        `git worktree add --detach ${quoteGitArg(probePath)} ${quoteGitArg(base)}`,
        repoPath
      );
    } catch (err) {
      throw new WorktreeFleetError(
        'GIT_FAILED',
        `Could not open a checkout to test merges in: ${(err as Error).message}`
      );
    }
  }

  /** The paths two commits cannot be merged on, or none. Leaves no state behind. */
  private async mergeProbe(probePath: string, left: string, right: string): Promise<string[]> {
    await this.provider.exec(`git checkout --force --detach ${quoteGitArg(left)}`, probePath);
    await this.tryExec('git reset --hard', probePath);
    await this.tryExec('git clean -fdq', probePath);

    let conflicted: string[] = [];
    try {
      await this.provider.exec(
        `git merge --no-commit --no-ff ${quoteGitArg(right)}`,
        probePath
      );
    } catch {
      conflicted = lines(await this.tryExec('git diff --name-only --diff-filter=U', probePath));
      // A merge that failed for a reason other than a conflict is still a pair
      // that cannot be combined; naming no file is the honest answer for it.
    }

    await this.tryExec('git merge --abort', probePath);
    await this.tryExec('git reset --hard', probePath);
    await this.tryExec('git clean -fdq', probePath);
    return conflicted;
  }

  private async removeProbe(repoPath: string, probePath: string): Promise<void> {
    if (fs.existsSync(probePath)) {
      await this.tryExec(`git worktree remove --force ${quoteGitArg(probePath)}`, repoPath);
      if (fs.existsSync(probePath)) {
        try {
          fs.rmSync(probePath, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    }
    await this.tryExec('git worktree prune', repoPath);
  }

  /** What the synthesis branch's tip commit says about the run it carries. */
  private summaryMessage(
    params: {
      runId: string;
      pipelineName?: string;
      steps: ReadonlyArray<{ stepId: string; stepName?: string; roleProfileId?: string }>;
    },
    mergedStepIds: readonly string[]
  ): string {
    const merged = new Set(mergedStepIds);
    const carried = params.steps
      .filter(step => merged.has(step.stepId))
      .map(step =>
        `${step.stepId}${step.roleProfileId ? ` (${step.roleProfileId})` : ''}`
      );
    return [
      `Asterim pipeline${params.pipelineName ? `: ${params.pipelineName}` : ''} — run ${params.runId}`,
      `Steps: ${carried.join('; ')}`
    ].join(' | ');
  }

  /** Runs a git command, answering `null` instead of throwing. */
  private async tryExec(command: string, cwd: string): Promise<string | null> {
    try {
      return await this.provider.exec(command, cwd);
    } catch {
      return null;
    }
  }
}

export const worktreeFleetService = new WorktreeFleetService();
