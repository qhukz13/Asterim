/**
 * Git Worktree Sandboxing contract (Phase 8, P8-01).
 *
 * A sandbox is one delegated thread's own copy of the working tree. Git already
 * has the primitive — `git worktree` gives a second checkout that shares the
 * repository's object store and refs — and this is the naming and the metadata
 * Asterim wraps around it so a subagent can edit files without the parent
 * watching its own working copy change underneath it.
 *
 * Two names are load-bearing and are defined here rather than in the service, so
 * the server, the dashboard and anyone reading a `git worktree list` agree on
 * what belongs to Asterim:
 *
 *   - the branch, `asterim/sandbox/<threadId>`, which is what makes a stray
 *     sandbox branch identifiable as ours and safe to delete;
 *   - the directory, `<projectRoot>/.asterim/worktrees/<threadId>`, which is
 *     inside the project on purpose — an agent's tooling, its relative paths and
 *     its `.gitignore` all behave the way they do in the real checkout — and is
 *     kept out of Git tracking for exactly the same reason.
 *
 * `status` is three-valued because a sandbox that has been merged is not the
 * same thing as one that has been thrown away, and an operator looking at a
 * finished delegation is owed the difference.
 */

/** Where a sandbox is in its life. */
export type WorktreeStatus = 'ACTIVE' | 'MERGED' | 'PRUNED';

/** The branch every sandbox is created on, under one identifiable namespace. */
export const WORKTREE_BRANCH_PREFIX = 'asterim/sandbox/';

/** The project-relative directory every sandbox is provisioned under. */
export const WORKTREE_DIR = '.asterim/worktrees';

/** The entry written into `.git/info/exclude` so sandboxes are never tracked. */
export const WORKTREE_IGNORE_ENTRY = '.asterim/';

/**
 * Which thread ids may name a sandbox.
 *
 * Both the branch and the directory are built from a thread id, and the branch
 * ends up on a `git` command line. Thread ids are UUIDs everywhere they are
 * generated, so this refuses everything that is not one shape of identifier
 * rather than trying to escape the rest.
 */
const SAFE_THREAD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Whether a thread id may be used to name a sandbox branch and directory. */
export function isSafeWorktreeThreadId(threadId: string): boolean {
  if (typeof threadId !== 'string') return false;
  // `..` would escape the worktrees directory, and git refuses it in a ref name
  // anyway; refusing it here means the two agree.
  if (threadId.includes('..')) return false;
  return SAFE_THREAD_ID.test(threadId);
}

/** The sandbox branch belonging to one thread. */
export function worktreeBranchName(threadId: string): string {
  return `${WORKTREE_BRANCH_PREFIX}${threadId}`;
}

/** Whether a branch is one Asterim provisioned, and may therefore delete. */
export function isWorktreeBranch(branch: string | null | undefined): boolean {
  return !!branch && branch.startsWith(WORKTREE_BRANCH_PREFIX);
}

/** One provisioned sandbox, as storage and the REST surface describe it. */
export interface WorktreeInfo {
  /** The thread whose session runs in it. */
  threadId: string;
  /** Absolute path to the checkout. */
  path: string;
  /** The ephemeral branch it sits on. */
  branch: string;
  /** The commit it was branched from, which every diff is taken against. */
  baseCommit: string;
  createdAt: number;
  status: WorktreeStatus;
}

/** What a sandbox has changed, against the commit it was branched from. */
export interface WorktreeDiff {
  threadId?: string;
  worktreePath: string;
  baseCommit: string;
  /** Unified diff of everything: committed, staged, unstaged and untracked. */
  diff: string;
  /** Repository-relative paths, in the order git reports them. */
  changedFiles: string[];
  /** True when the sandbox has changed nothing at all. */
  clean: boolean;
}

/** What merging a sandbox back into a real branch did. */
export interface WorktreeMergeResult {
  threadId: string;
  branch: string;
  targetBranch: string;
  merged: boolean;
  /** The commit the target branch ends up at, when the merge happened. */
  commit?: string;
  /** Paths git could not merge, when it could not. Empty otherwise. */
  conflicts: string[];
  /** Why the merge did not happen, when it did not. */
  reason?: string;
}
