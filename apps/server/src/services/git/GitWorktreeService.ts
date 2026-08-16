/**
 * Git Worktree Sandboxing (P8-01).
 *
 * Provisions, inspects, merges and tears down the isolated checkouts a delegated
 * subagent runs in. Everything here is the native `git worktree` command through
 * `GitProvider`, which is the whole point: a sandbox is a real second checkout
 * sharing the repository's object store, so a change made in one is a change git
 * already knows how to diff, merge and throw away. Nothing is copied, and
 * nothing about the primary working tree moves.
 *
 * Three rules shape it, and they are the ones worth reading before changing
 * anything:
 *
 * **The primary working tree is never written to.** Creation and removal touch
 * only `.asterim/worktrees/<threadId>` and refs under `asterim/sandbox/`. The
 * one operation that does change the real checkout is `mergeWorktree`, which an
 * operator asks for explicitly, and it refuses outright rather than merging on
 * top of uncommitted work — and aborts back to where it started if git cannot
 * merge cleanly.
 *
 * **A sandbox is identifiable.** Both the branch and the directory are derived
 * from the thread id by `@asterim/shared`, so anything under that branch prefix
 * is Asterim's and may be deleted, and anything that is not is somebody's real
 * branch and is left alone. `removeWorktree` will not delete a branch it did not
 * name itself.
 *
 * **Nothing here is fatal.** A project that is not a repository, a repository
 * with no commits, a sandbox someone deleted by hand out from under us: each is
 * a `WorktreeError` with a code the caller can act on, because the caller is a
 * delegation that has to run either way — without a sandbox if it cannot have
 * one.
 */

import fs from 'fs';
import path from 'path';
import {
  WORKTREE_BRANCH_PREFIX,
  WORKTREE_DIR,
  WORKTREE_IGNORE_ENTRY,
  WorktreeDiff,
  WorktreeInfo,
  WorktreeMergeResult,
  isSafeWorktreeThreadId,
  isWorktreeBranch,
  worktreeBranchName
} from '@asterim/shared';
import { GitProvider } from './GitProvider';

/** How a worktree failure reads to a caller that has to answer for it. */
export type WorktreeErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_A_REPOSITORY'
  | 'NO_COMMITS'
  | 'WORKTREE_NOT_FOUND'
  | 'WORKTREE_EXISTS'
  | 'DIRTY_TARGET'
  | 'TARGET_NOT_CHECKED_OUT'
  | 'MERGE_CONFLICT'
  | 'GIT_FAILED';

export class WorktreeError extends Error {
  constructor(
    public readonly code: WorktreeErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'WorktreeError';
  }
}

/**
 * How much of a sandbox's diff is carried back before it is cut short.
 *
 * A generated lockfile or a vendored directory produces megabytes that no one
 * reads and that would go into an event payload and a SQLite row. The cut is
 * marked in the text so a reader knows there is more, and the worktree is still
 * there to look at properly.
 */
export const MAX_WORKTREE_DIFF_CHARS = 200000;

/** How many changed paths are listed before the list is cut short. */
export const MAX_WORKTREE_CHANGED_FILES = 500;

/** The commit message a merge writes for work the sandbox left uncommitted. */
export const SANDBOX_AUTOCOMMIT_MESSAGE = 'Asterim: delegated agent changes';

/**
 * Where a sandbox's base commit is recorded.
 *
 * In the repository rather than only in SQLite, and as a ref rather than a file,
 * because the base is what every diff of that sandbox is taken against and it
 * has to survive a restart, a database that was never written to, and someone
 * reading the sandbox with plain git. A ref outside `refs/heads` is invisible to
 * `git branch`, shared across worktrees, and deleted with the sandbox.
 */
export const WORKTREE_BASE_REF_PREFIX = 'refs/asterim/base/';

/**
 * Wraps a path for a shell that git is being invoked through.
 *
 * `GitProvider` builds command strings, so anything interpolated into one has to
 * be quoted, and anything that could break out of the quoting has to be refused
 * rather than escaped — a repository path containing a backtick is not a case
 * worth supporting, and guessing at the escaping rules of two shells is how a
 * quoting helper becomes a command-injection bug.
 */
export function quoteGitArg(value: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new WorktreeError('INVALID_INPUT', 'A path or ref is required.');
  }
  if (/["`$\r\n]/.test(value)) {
    throw new WorktreeError(
      'INVALID_INPUT',
      `Refusing to run a git command with an unsafe argument: ${value}`
    );
  }
  return `"${value}"`;
}

/**
 * A commit message, reduced to something that can be quoted.
 *
 * Refusing an operator's merge message over a backtick would be absurd, so the
 * characters that cannot survive the quoting are replaced rather than rejected.
 */
export function sanitizeCommitMessage(message: string | undefined, fallback: string): string {
  const cleaned = (message ?? '').replace(/["`$\\]/g, ' ').replace(/[\r\n]+/g, ' ').trim();
  return cleaned || fallback;
}

/** One entry of `git worktree list --porcelain`. */
export interface RegisteredWorktree {
  path: string;
  head?: string;
  branch?: string;
  /** True when git has recorded the checkout as gone from disk. */
  prunable: boolean;
}

/**
 * Reads `git worktree list --porcelain`.
 *
 * Records are blank-line separated; `branch` is a full ref, reduced to the short
 * name because that is what every other command here takes.
 */
export function parseWorktreeList(output: string): RegisteredWorktree[] {
  const entries: RegisteredWorktree[] = [];
  let current: RegisteredWorktree | null = null;

  for (const rawLine of (output || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      if (current) entries.push(current);
      current = null;
      continue;
    }
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: line.slice('worktree '.length).trim(), prunable: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length).trim();
    else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    } else if (line === 'prunable' || line.startsWith('prunable ')) current.prunable = true;
  }
  if (current) entries.push(current);
  return entries;
}

/** The `NUL`-free lines of a porcelain listing, with blanks dropped. */
function lines(output: string): string[] {
  return (output || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

export class GitWorktreeService {
  constructor(private readonly provider: GitProvider = new GitProvider()) {}

  // --- Repository facts -----------------------------------------------------

  /**
   * Whether this path is inside a git repository at all.
   *
   * `git rev-parse` rather than looking for a `.git` directory: in a worktree
   * `.git` is a file, and a delegation launched from inside one sandbox must
   * still be able to provision another.
   */
  public async isRepository(repoPath: string): Promise<boolean> {
    if (!repoPath || !fs.existsSync(repoPath)) return false;
    try {
      const answer = await this.provider.exec('git rev-parse --is-inside-work-tree', repoPath);
      return answer.trim() === 'true';
    } catch {
      return false;
    }
  }

  /** The commit a sandbox would be branched from: the repository's HEAD. */
  public async resolveBaseCommit(repoPath: string, baseCommit?: string): Promise<string> {
    const ref = baseCommit?.trim() || 'HEAD';
    try {
      return await this.provider.exec(
        `git rev-parse --verify ${quoteGitArg(`${ref}^{commit}`)}`,
        repoPath
      );
    } catch (err) {
      if (err instanceof WorktreeError) throw err;
      throw new WorktreeError(
        ref === 'HEAD' ? 'NO_COMMITS' : 'INVALID_INPUT',
        ref === 'HEAD'
          ? 'The repository has no commits yet, so there is nothing to branch a sandbox from.'
          : `No commit matches '${ref}': ${(err as Error).message}`
      );
    }
  }

  /** The branch checked out in this working tree, or null on a detached HEAD. */
  public async getCurrentBranch(repoPath: string): Promise<string | null> {
    try {
      const branch = await this.provider.exec('git symbolic-ref --short HEAD', repoPath);
      return branch.trim() || null;
    } catch {
      return null;
    }
  }

  /** Where a thread's sandbox lives, whether or not it has been provisioned. */
  public worktreePathFor(repoPath: string, threadId: string): string {
    this.requireThreadId(threadId);
    return path.join(repoPath, ...WORKTREE_DIR.split('/'), threadId);
  }

  /** Every checkout git has registered for this repository. */
  public async listWorktrees(repoPath: string): Promise<RegisteredWorktree[]> {
    try {
      return parseWorktreeList(await this.provider.exec('git worktree list --porcelain', repoPath));
    } catch {
      return [];
    }
  }

  // --- Provisioning ---------------------------------------------------------

  /**
   * Provisions a sandbox for one thread, or hands back the one it already has.
   *
   * Idempotent because the caller is a delegation lifecycle: a retry, a restart
   * or a second `createWorktree` for the same thread must not fail and must not
   * produce a second checkout. A directory git has forgotten about — someone
   * deleted `.git/worktrees` by hand, or the checkout was copied — is pruned and
   * rebuilt rather than reported as a conflict nobody can resolve.
   */
  public async createWorktree(
    repoPath: string,
    threadId: string,
    baseCommit?: string
  ): Promise<WorktreeInfo> {
    this.requireThreadId(threadId);
    if (!(await this.isRepository(repoPath))) {
      throw new WorktreeError(
        'NOT_A_REPOSITORY',
        `${repoPath} is not a git repository, so a sandbox cannot be provisioned in it.`
      );
    }

    const branch = worktreeBranchName(threadId);
    const worktreePath = this.worktreePathFor(repoPath, threadId);

    // Kept out of tracking before the directory exists, so the primary tree
    // never shows a sandbox as untracked even for the moment in between.
    await this.ensureIgnored(repoPath);

    const existing = await this.getWorktree(repoPath, threadId);
    if (existing) return existing;

    // Registered but gone from disk, or on disk but unregistered: neither is a
    // usable sandbox, and both are cleared the same way.
    if (fs.existsSync(worktreePath)) {
      await this.removeWorktree(repoPath, threadId);
    } else {
      await this.tryExec('git worktree prune', repoPath);
    }

    const resolvedBase = await this.resolveBaseCommit(repoPath, baseCommit);
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    // A branch left over from a sandbox that was removed without its branch
    // being deleted is reused rather than fought with; it is ours by name.
    const branchExists = await this.branchExists(repoPath, branch);
    const addCommand = branchExists
      ? `git worktree add ${quoteGitArg(worktreePath)} ${quoteGitArg(branch)}`
      : `git worktree add ${quoteGitArg(worktreePath)} -b ${quoteGitArg(branch)} ${quoteGitArg(resolvedBase)}`;

    try {
      await this.provider.exec(addCommand, repoPath);
    } catch (err) {
      throw new WorktreeError(
        'GIT_FAILED',
        `Could not provision a sandbox for thread ${threadId}: ${(err as Error).message}`
      );
    }

    // A branch that outlived its sandbox keeps the base it was forked at, so a
    // reused branch still diffs against where its work actually began.
    const effectiveBase = branchExists
      ? await this.resolveBaseFor(repoPath, threadId)
      : resolvedBase;
    await this.writeBaseRef(repoPath, threadId, effectiveBase);

    return {
      threadId,
      path: worktreePath,
      branch,
      baseCommit: effectiveBase,
      createdAt: Date.now(),
      status: 'ACTIVE'
    };
  }

  /**
   * The sandbox a thread has right now, or null.
   *
   * Both halves have to agree: git has it registered *and* the directory is
   * there. A registration whose directory is gone is not something a session can
   * be pointed at, so it reads as absent and `createWorktree` rebuilds it.
   */
  public async getWorktree(repoPath: string, threadId: string): Promise<WorktreeInfo | null> {
    this.requireThreadId(threadId);
    const worktreePath = this.worktreePathFor(repoPath, threadId);
    if (!fs.existsSync(worktreePath)) return null;

    const registered = (await this.listWorktrees(repoPath)).find(
      entry => path.resolve(entry.path) === path.resolve(worktreePath)
    );
    if (!registered || registered.prunable) return null;

    return {
      threadId,
      path: worktreePath,
      branch: registered.branch ?? worktreeBranchName(threadId),
      baseCommit: await this.resolveBaseFor(repoPath, threadId),
      createdAt: this.createdAtOf(worktreePath),
      status: 'ACTIVE'
    };
  }

  /**
   * Makes sure `.asterim/` is ignored, without editing a tracked file.
   *
   * `.git/info/exclude` rather than `.gitignore`: the sandbox directory is this
   * workstation's business, and writing it into a tracked file would put an
   * Asterim implementation detail in the user's next commit and in everyone
   * else's checkout. If the project already ignores it, nothing is written.
   */
  public async ensureIgnored(repoPath: string): Promise<void> {
    try {
      const gitignore = path.join(repoPath, '.gitignore');
      if (fs.existsSync(gitignore)) {
        const declared = fs
          .readFileSync(gitignore, 'utf8')
          .split('\n')
          .map(line => line.trim().replace(/\/$/, ''));
        if (declared.includes('.asterim') || declared.includes('/.asterim')) return;
      }

      const commonDir = await this.resolveGitCommonDir(repoPath);
      if (!commonDir) return;
      const excludeFile = path.join(commonDir, 'info', 'exclude');

      const current = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
      if (current.split('\n').some(line => line.trim().replace(/\/$/, '') === '.asterim')) return;

      fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
      const separator = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
      fs.appendFileSync(
        excludeFile,
        `${separator}# Asterim delegated agent sandboxes (P8-01)\n${WORKTREE_IGNORE_ENTRY}\n`
      );
    } catch (err) {
      // A repository whose exclude file cannot be written is still one a sandbox
      // can run in; the cost is a directory showing up as untracked.
      console.warn(`[Worktree] Could not ignore .asterim in ${repoPath}: ${(err as Error).message}`);
    }
  }

  // --- Inspection -----------------------------------------------------------

  /**
   * What a sandbox has changed, against the commit it was branched from.
   *
   * One diff covers all four states the work can be in — committed on the
   * sandbox branch, staged, unstaged, and files the agent created and never
   * added — because a parent reviewing a delegation cares about what is
   * different, not about how far through git's staging the agent happened to
   * get. Untracked files are folded in with `add --intent-to-add`, which records
   * the path in the sandbox's own index and nothing else; the primary tree's
   * index is a different file and is not touched.
   */
  public async getDiff(worktreePath: string, baseCommit?: string): Promise<WorktreeDiff> {
    if (!worktreePath || !fs.existsSync(worktreePath)) {
      throw new WorktreeError('WORKTREE_NOT_FOUND', `No worktree at ${worktreePath}.`);
    }

    // The directory is named after the thread, so a diff asked for by path alone
    // still finds the base its sandbox was provisioned at.
    const base = baseCommit?.trim() || (await this.resolveBaseFor(worktreePath, path.basename(worktreePath)));

    // Best-effort: a sandbox with nothing untracked does not need it, and a
    // failure here costs the new files in the diff rather than the diff.
    await this.tryExec('git add --all --intent-to-add', worktreePath);

    const ref = quoteGitArg(base);
    const rawDiff = await this.tryExec(`git diff ${ref}`, worktreePath);
    const rawNames = await this.tryExec(`git diff --name-only ${ref}`, worktreePath);

    const changedFiles = lines(rawNames ?? '').slice(0, MAX_WORKTREE_CHANGED_FILES);
    const diff = truncateDiff(rawDiff ?? '');

    return {
      worktreePath,
      baseCommit: base,
      diff,
      changedFiles,
      clean: changedFiles.length === 0 && diff.trim() === ''
    };
  }

  /** The same, addressed by thread rather than by path. */
  public async getThreadDiff(
    repoPath: string,
    threadId: string,
    baseCommit?: string
  ): Promise<WorktreeDiff> {
    const info = await this.getWorktree(repoPath, threadId);
    if (!info) {
      throw new WorktreeError('WORKTREE_NOT_FOUND', `Thread ${threadId} has no active sandbox.`);
    }
    const diff = await this.getDiff(info.path, baseCommit ?? info.baseCommit);
    return { ...diff, threadId };
  }

  // --- Merging --------------------------------------------------------------

  /**
   * Merges a sandbox branch back into a real one.
   *
   * The only operation here that changes the primary working tree, and the
   * reason it is bounded on every side:
   *
   *   - it refuses if the primary tree has uncommitted work, because a merge on
   *     top of it is how an operator loses changes they never told anyone about;
   *   - it refuses a target that is not the checked-out branch, rather than
   *     checking one out underneath whoever is using the repository;
   *   - a conflict is aborted, not left in the tree, so a merge that does not
   *     succeed leaves the repository exactly where it was.
   *
   * Whatever the sandbox left uncommitted is committed onto the sandbox branch
   * first — a merge can only carry commits. That is an agent's work being
   * committed, which Asterim does not do on its own initiative (`blueprint/
   * GIT.md`); it happens here because an operator asked for this merge, and it
   * happens on the ephemeral branch rather than on theirs.
   */
  public async mergeWorktree(
    repoPath: string,
    threadId: string,
    targetBranch?: string,
    message?: string
  ): Promise<WorktreeMergeResult> {
    this.requireThreadId(threadId);
    const info = await this.getWorktree(repoPath, threadId);
    if (!info) {
      throw new WorktreeError('WORKTREE_NOT_FOUND', `Thread ${threadId} has no active sandbox.`);
    }

    const current = await this.getCurrentBranch(repoPath);
    const target = targetBranch?.trim() || current;
    if (!target) {
      throw new WorktreeError(
        'TARGET_NOT_CHECKED_OUT',
        'The repository has a detached HEAD, so there is no branch to merge into.'
      );
    }
    if (target !== current) {
      throw new WorktreeError(
        'TARGET_NOT_CHECKED_OUT',
        `Refusing to merge into '${target}' while '${current ?? 'a detached HEAD'}' is checked out. Check the target branch out first.`
      );
    }

    const dirty = await this.tryExec('git status --porcelain', repoPath);
    if (dirty && lines(dirty).length > 0) {
      throw new WorktreeError(
        'DIRTY_TARGET',
        `Refusing to merge into '${target}': the working tree has uncommitted changes. Commit or stash them first.`
      );
    }

    await this.commitSandbox(info.path, message);

    const base: WorktreeMergeResult = {
      threadId,
      branch: info.branch,
      targetBranch: target,
      merged: false,
      conflicts: []
    };

    // Nothing to carry: the sandbox never diverged from the branch it is being
    // merged into. Reported as merged, because the target already contains
    // everything the sandbox has.
    const ahead = await this.tryExec(
      `git rev-list --count ${quoteGitArg(`${target}..${info.branch}`)}`,
      repoPath
    );
    if (ahead !== null && Number(ahead.trim()) === 0) {
      return {
        ...base,
        merged: true,
        commit: await this.tryHead(repoPath),
        reason: 'The sandbox made no changes to merge.'
      };
    }

    try {
      await this.provider.exec(
        `git merge --no-ff ${quoteGitArg(info.branch)} -m ${quoteGitArg(
          sanitizeCommitMessage(message, `Asterim: merge delegated work from ${info.branch}`)
        )}`,
        repoPath
      );
    } catch (err) {
      const conflicts = lines((await this.tryExec('git diff --name-only --diff-filter=U', repoPath)) ?? '');
      // Back to exactly where the repository was. A half-merged primary tree is
      // the one outcome this whole subsystem exists to prevent.
      await this.tryExec('git merge --abort', repoPath);
      throw new WorktreeError(
        'MERGE_CONFLICT',
        conflicts.length > 0
          ? `Merging ${info.branch} into ${target} conflicts in: ${conflicts.join(', ')}. The merge was aborted and the working tree is unchanged.`
          : `Merging ${info.branch} into ${target} failed and was aborted: ${(err as Error).message}`
      );
    }

    return { ...base, merged: true, commit: await this.tryHead(repoPath) };
  }

  /**
   * Commits whatever the sandbox left lying around, onto its own branch.
   *
   * Silent when there is nothing to commit, which is the common case for a
   * subagent that committed its own work.
   */
  private async commitSandbox(worktreePath: string, message?: string): Promise<void> {
    const dirty = await this.tryExec('git status --porcelain', worktreePath);
    if (!dirty || lines(dirty).length === 0) return;

    await this.tryExec('git add --all', worktreePath);
    await this.tryExec(
      `git commit --no-verify -m ${quoteGitArg(
        sanitizeCommitMessage(message, SANDBOX_AUTOCOMMIT_MESSAGE)
      )}`,
      worktreePath
    );
  }

  // --- Teardown -------------------------------------------------------------

  /**
   * Discards a sandbox: the checkout, its branch, and git's record of both.
   *
   * `--force` because the point of discarding is that the uncommitted work in
   * there is being thrown away deliberately, and a sandbox that refuses to go
   * until someone tidies it is a directory that accumulates forever. The branch
   * is deleted only if it is one of ours by name, so a sandbox that was somehow
   * pointed at a real branch cannot take it with it.
   *
   * Returns whether anything was actually removed. Removing a sandbox that is
   * already gone is not an error — it is the state that was asked for.
   */
  public async removeWorktree(repoPath: string, threadId: string): Promise<boolean> {
    this.requireThreadId(threadId);
    const worktreePath = this.worktreePathFor(repoPath, threadId);
    const branch = worktreeBranchName(threadId);
    let removed = false;

    if (fs.existsSync(worktreePath)) {
      const viaGit = await this.tryExec(
        `git worktree remove --force ${quoteGitArg(worktreePath)}`,
        repoPath
      );
      // A directory git has no record of is removed directly; `git worktree
      // remove` refuses it, and leaving it behind would block the next sandbox
      // for the same thread.
      if (viaGit === null && fs.existsSync(worktreePath)) {
        try {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        } catch (err) {
          console.warn(
            `[Worktree] Could not delete ${worktreePath}: ${(err as Error).message}`
          );
        }
      }
      removed = !fs.existsSync(worktreePath);
    }

    await this.tryExec('git worktree prune', repoPath);

    if (isWorktreeBranch(branch) && (await this.branchExists(repoPath, branch))) {
      const deleted = await this.tryExec(`git branch -D ${quoteGitArg(branch)}`, repoPath);
      removed = removed || deleted !== null;
    }

    // The base ref goes with it: a sandbox that has been discarded has no diff
    // to take, and a ref left behind would be adopted by the next sandbox for
    // the same thread id.
    await this.tryExec(
      `git update-ref -d ${quoteGitArg(`${WORKTREE_BASE_REF_PREFIX}${threadId}`)}`,
      repoPath
    );

    return removed;
  }

  /**
   * Clears sandboxes nothing is using any more.
   *
   * Two kinds of leftovers, both of which a crashed Core produces: a checkout
   * git still has registered whose directory is gone, and a sandbox branch with
   * no checkout on it. Only ever inside `.asterim/worktrees` and only ever under
   * the sandbox branch prefix — a user's own worktrees and branches are not this
   * function's business.
   *
   * `keepThreadIds` is what the caller still considers live.
   */
  public async pruneOrphans(repoPath: string, keepThreadIds: readonly string[] = []): Promise<number> {
    if (!(await this.isRepository(repoPath))) return 0;
    const keep = new Set(keepThreadIds);
    const sandboxRoot = path.resolve(repoPath, ...WORKTREE_DIR.split('/'));
    let pruned = 0;

    await this.tryExec('git worktree prune', repoPath);

    for (const entry of await this.listWorktrees(repoPath)) {
      const resolved = path.resolve(entry.path);
      if (!isInside(sandboxRoot, resolved)) continue;
      const threadId = path.basename(resolved);
      if (keep.has(threadId)) continue;
      if (fs.existsSync(resolved)) continue;
      if (await this.removeWorktree(repoPath, threadId)) pruned++;
    }

    const branches = lines(
      (await this.tryExec(
        `git for-each-ref --format="%(refname:short)" refs/heads/${WORKTREE_BRANCH_PREFIX}`,
        repoPath
      )) ?? ''
    );
    const live = new Set(
      (await this.listWorktrees(repoPath))
        .map(entry => entry.branch)
        .filter((branch): branch is string => !!branch)
    );
    for (const branch of branches) {
      const threadId = branch.slice(WORKTREE_BRANCH_PREFIX.length);
      if (!threadId || keep.has(threadId) || live.has(branch)) continue;
      if (!isSafeWorktreeThreadId(threadId)) continue;
      if ((await this.tryExec(`git branch -D ${quoteGitArg(branch)}`, repoPath)) !== null) pruned++;
    }

    return pruned;
  }

  // --- Internals ------------------------------------------------------------

  private requireThreadId(threadId: string): void {
    if (!isSafeWorktreeThreadId(threadId)) {
      throw new WorktreeError(
        'INVALID_INPUT',
        `'${threadId}' is not a thread id a sandbox can be named after.`
      );
    }
  }

  /**
   * When a sandbox was provisioned, from the directory itself.
   *
   * `birthtime` is not available on every filesystem and reads as the epoch when
   * it is not; `mtime` is the fallback, and `now` is what is left when the stat
   * fails entirely — none of which is worth failing a lookup over.
   */
  private createdAtOf(worktreePath: string): number {
    try {
      const stat = fs.statSync(worktreePath);
      const birth = stat.birthtimeMs;
      return birth && birth > 0 ? Math.round(birth) : Math.round(stat.mtimeMs);
    } catch {
      return Date.now();
    }
  }

  private async branchExists(repoPath: string, branch: string): Promise<boolean> {
    const answer = await this.tryExec(
      `git rev-parse --verify --quiet ${quoteGitArg(`refs/heads/${branch}`)}`,
      repoPath
    );
    return !!answer && answer.trim().length > 0;
  }

  /**
   * The commit a sandbox's changes are measured against.
   *
   * Read back from the ref written when the sandbox was provisioned, not
   * inferred: a subagent that committed its own work would diff as having
   * changed nothing against its own HEAD, and guessing the fork point from the
   * branch graph goes wrong the moment the parent branch moves. Falls back to
   * the checkout's HEAD, which is right for a sandbox that has committed
   * nothing and is the best available answer for a path that is not one of ours.
   */
  private async resolveBaseFor(cwd: string, threadId?: string): Promise<string> {
    if (threadId && isSafeWorktreeThreadId(threadId)) {
      const recorded = await this.tryExec(
        `git rev-parse --verify --quiet ${quoteGitArg(`${WORKTREE_BASE_REF_PREFIX}${threadId}`)}`,
        cwd
      );
      if (recorded?.trim()) return recorded.trim();
    }
    return (await this.tryHead(cwd)) ?? 'HEAD';
  }

  /** Records what a sandbox was branched from, for every later diff. */
  private async writeBaseRef(repoPath: string, threadId: string, commit: string): Promise<void> {
    await this.tryExec(
      `git update-ref ${quoteGitArg(`${WORKTREE_BASE_REF_PREFIX}${threadId}`)} ${quoteGitArg(commit)}`,
      repoPath
    );
  }

  private async tryHead(cwd: string): Promise<string | undefined> {
    const head = await this.tryExec('git rev-parse HEAD', cwd);
    return head?.trim() || undefined;
  }

  /** The shared `.git` directory, absolute. */
  private async resolveGitCommonDir(repoPath: string): Promise<string | null> {
    const common = await this.tryExec('git rev-parse --git-common-dir', repoPath);
    if (!common) return null;
    const value = common.trim();
    if (!value) return null;
    return path.isAbsolute(value) ? value : path.resolve(repoPath, value);
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

/** Whether `candidate` is `parent` itself or below it. */
function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** A diff, cut to something that can go in an event payload and a row. */
export function truncateDiff(diff: string): string {
  if (!diff || diff.length <= MAX_WORKTREE_DIFF_CHARS) return diff ?? '';
  return `${diff.slice(0, MAX_WORKTREE_DIFF_CHARS)}\n… (diff truncated; open the worktree to see the rest)`;
}

export const gitWorktreeService = new GitWorktreeService();
