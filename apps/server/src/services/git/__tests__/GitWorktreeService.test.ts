/**
 * Tests for Git Worktree Sandboxing (P8-01).
 *
 * Every assertion runs against real git repositories created in temp
 * directories: real commits, real `git worktree add`, real merges and real
 * conflicts. A mocked GitProvider would prove the command strings match what the
 * test expects them to be, which is the one thing not worth knowing — what has
 * to be true is that git does what this service claims it does, and that the
 * primary working tree is still intact afterwards.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/git/__tests__/GitWorktreeService.test.ts
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  GitWorktreeService,
  WorktreeError,
  parseWorktreeList,
  quoteGitArg,
  sanitizeCommitMessage,
  truncateDiff,
  MAX_WORKTREE_DIFF_CHARS,
  WORKTREE_BASE_REF_PREFIX
} = require('../GitWorktreeService');
const {
  WORKTREE_BRANCH_PREFIX,
  isSafeWorktreeThreadId,
  isWorktreeBranch,
  worktreeBranchName
} = require('@asterim/shared');

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

async function throwsCode(label: string, code: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    check(label, false, 'nothing was thrown');
  } catch (err) {
    const actual = (err as { code?: string }).code;
    check(label, err instanceof WorktreeError && actual === code, `got ${actual ?? err}`);
  }
}

// --- Temp repositories ---

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  // macOS hands out /var/… which is a symlink to /private/var; git reports the
  // resolved path back, and comparing the two would fail on paths alone.
  const resolved = fs.realpathSync(dir);
  tempDirs.push(resolved);
  return resolved;
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Worktree Test',
  GIT_AUTHOR_EMAIL: 'worktree@test.local',
  GIT_COMMITTER_NAME: 'Worktree Test',
  GIT_COMMITTER_EMAIL: 'worktree@test.local',
  GIT_CONFIG_GLOBAL: path.join(os.tmpdir(), 'asterim-worktree-no-such-gitconfig'),
  GIT_CONFIG_SYSTEM: path.join(os.tmpdir(), 'asterim-worktree-no-such-gitconfig')
};

function git(command: string, cwd: string): string {
  return execSync(command, { cwd, encoding: 'utf8', env: GIT_ENV, stdio: 'pipe' }).trim();
}

function write(dir: string, relative: string, content: string): void {
  const target = path.join(dir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function read(dir: string, relative: string): string {
  return fs.readFileSync(path.join(dir, relative), 'utf8');
}

/** A repository with one commit on a branch called `main`. */
function makeRepo(prefix = 'asterim-worktree-repo-'): string {
  const dir = makeTempDir(prefix);
  git('git init -q -b main', dir);
  git('git config user.email worktree@test.local', dir);
  git('git config user.name "Worktree Test"', dir);
  write(dir, 'README.md', '# base\n');
  write(dir, 'src/app.ts', 'export const version = 1;\n');
  git('git add -A', dir);
  git('git commit -q -m "base"', dir);
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
  console.log(`\n[cleanup] removed ${tempDirs.length} temp director${tempDirs.length === 1 ? 'y' : 'ies'}`);
}

async function main(): Promise<void> {
  const service = new GitWorktreeService();

  // --- Pure helpers ---------------------------------------------------------
  describe('naming and argument safety');

  equal('a uuid is a usable thread id', isSafeWorktreeThreadId('0f8f0a3e-8f2e-4c3a-9d1f-3b2a1c0d9e8f'), true);
  equal('an empty id is refused', isSafeWorktreeThreadId(''), false);
  equal('a traversing id is refused', isSafeWorktreeThreadId('../../etc/passwd'), false);
  equal('an id with a slash is refused', isSafeWorktreeThreadId('a/b'), false);
  equal('an id with a space is refused', isSafeWorktreeThreadId('a b'), false);
  equal('a dotted id is fine', isSafeWorktreeThreadId('thread.1_a-b'), true);
  equal('the branch is namespaced', worktreeBranchName('t1'), `${WORKTREE_BRANCH_PREFIX}t1`);
  equal('and is recognised as ours', isWorktreeBranch(worktreeBranchName('t1')), true);
  equal('someone else’s branch is not', isWorktreeBranch('feature/login'), false);

  equal('a plain path is quoted', quoteGitArg('/tmp/a b/c'), '"/tmp/a b/c"');
  check(
    'a path that could break out of quoting is refused',
    (() => {
      try {
        quoteGitArg('/tmp/$(rm -rf ~)');
        return false;
      } catch (err) {
        return err instanceof WorktreeError && (err as { code?: string }).code === 'INVALID_INPUT';
      }
    })(),
    'command injection must not be reachable through a path'
  );
  check(
    'a backtick path is refused',
    (() => {
      try {
        quoteGitArg('/tmp/`id`');
        return false;
      } catch {
        return true;
      }
    })()
  );
  equal(
    'a commit message keeps its words and loses its metacharacters',
    sanitizeCommitMessage('fix `eval` of $HOME "quoted"', 'fallback'),
    'fix  eval  of  HOME  quoted'
  );
  equal('an empty message falls back', sanitizeCommitMessage('   ', 'fallback'), 'fallback');
  equal('a short diff is untouched', truncateDiff('diff --git a b\n'), 'diff --git a b\n');
  check(
    'a huge diff is cut and says so',
    truncateDiff('x'.repeat(MAX_WORKTREE_DIFF_CHARS + 500)).includes('truncated'),
    'a megabyte diff must not travel whole'
  );

  describe('parseWorktreeList');

  const parsed = parseWorktreeList(
    [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/.asterim/worktrees/t1',
      'HEAD def456',
      'branch refs/heads/asterim/sandbox/t1',
      '',
      'worktree /repo/gone',
      'HEAD 000000',
      'prunable gitdir file points to non-existent location',
      ''
    ].join('\n')
  );
  equal('every checkout is read', parsed.length, 3);
  equal('the branch is shortened', parsed[1].branch, 'asterim/sandbox/t1');
  equal('a prunable entry is flagged', parsed[2].prunable, true);
  equal('and a live one is not', parsed[0].prunable, false);

  // --- Repository detection -------------------------------------------------
  describe('repository detection');

  const repo = makeRepo();
  const plain = makeTempDir('asterim-worktree-plain-');

  equal('a git repository is one', await service.isRepository(repo), true);
  equal('a plain directory is not', await service.isRepository(plain), false);
  equal('a path that does not exist is not', await service.isRepository(path.join(plain, 'nope')), false);

  await throwsCode('a sandbox cannot be provisioned outside a repository', 'NOT_A_REPOSITORY', () =>
    service.createWorktree(plain, 'thread-plain')
  );
  await throwsCode('nor named after an unsafe thread id', 'INVALID_INPUT', () =>
    service.createWorktree(repo, '../escape')
  );

  const empty = makeTempDir('asterim-worktree-empty-');
  git('git init -q -b main', empty);
  await throwsCode('nor in a repository with no commits', 'NO_COMMITS', () =>
    service.createWorktree(empty, 'thread-empty')
  );

  // --- Creation -------------------------------------------------------------
  describe('createWorktree');

  const headBefore = git('git rev-parse HEAD', repo);
  const t1 = 'thread-one';
  const info = await service.createWorktree(repo, t1);

  equal('the sandbox is named after the thread', info.threadId, t1);
  equal('it sits on the sandbox branch', info.branch, `${WORKTREE_BRANCH_PREFIX}${t1}`);
  equal('it is branched from HEAD', info.baseCommit, headBefore);
  equal('it starts ACTIVE', info.status, 'ACTIVE');
  equal(
    'it lives under .asterim/worktrees',
    path.relative(repo, info.path).split(path.sep).join('/'),
    `.asterim/worktrees/${t1}`
  );
  check('the checkout exists on disk', fs.existsSync(info.path));
  check('with the repository’s files in it', fs.existsSync(path.join(info.path, 'src/app.ts')));
  equal(
    'the sandbox has the branch checked out',
    git('git rev-parse --abbrev-ref HEAD', info.path),
    `${WORKTREE_BRANCH_PREFIX}${t1}`
  );
  equal(
    'the base commit is recorded as a ref',
    git(`git rev-parse ${WORKTREE_BASE_REF_PREFIX}${t1}`, repo),
    headBefore
  );

  describe('the primary working tree is untouched');

  equal('HEAD has not moved', git('git rev-parse HEAD', repo), headBefore);
  equal('the branch is still main', git('git rev-parse --abbrev-ref HEAD', repo), 'main');
  equal('the working tree is still clean', git('git status --porcelain', repo), '');
  equal('and the project files are unchanged', read(repo, 'src/app.ts'), 'export const version = 1;\n');

  describe('the sandbox directory is never tracked');

  const excludeFile = path.join(repo, '.git', 'info', 'exclude');
  check('an exclude entry was written', fs.readFileSync(excludeFile, 'utf8').includes('.asterim/'));
  equal(
    'so git reports nothing untracked',
    git('git status --porcelain --untracked-files=all', repo),
    ''
  );

  describe('createWorktree is idempotent');

  const again = await service.createWorktree(repo, t1);
  equal('the same path comes back', again.path, info.path);
  equal('the same branch comes back', again.branch, info.branch);
  equal(
    'and no second checkout was registered',
    (await service.listWorktrees(repo)).filter((entry: { path: string }) =>
      entry.path.includes('.asterim')
    ).length,
    1
  );

  // --- Isolation ------------------------------------------------------------
  describe('a sandbox edit is invisible to the primary tree');

  write(info.path, 'src/app.ts', 'export const version = 2;\n');
  write(info.path, 'src/added.ts', 'export const added = true;\n');

  equal('the project file is unchanged', read(repo, 'src/app.ts'), 'export const version = 1;\n');
  check('the new file exists only in the sandbox', !fs.existsSync(path.join(repo, 'src/added.ts')));
  equal('and the primary tree is still clean', git('git status --porcelain', repo), '');

  describe('two sandboxes do not collide');

  const t2 = 'thread-two';
  const second = await service.createWorktree(repo, t2);
  write(second.path, 'src/app.ts', 'export const version = 99;\n');

  equal('each has its own copy', read(info.path, 'src/app.ts'), 'export const version = 2;\n');
  equal('with its own content', read(second.path, 'src/app.ts'), 'export const version = 99;\n');
  equal('and the project still has neither', read(repo, 'src/app.ts'), 'export const version = 1;\n');

  // --- Diff -----------------------------------------------------------------
  describe('getDiff');

  const diff = await service.getDiff(info.path, info.baseCommit);
  equal('the modified file is listed', diff.changedFiles.includes('src/app.ts'), true);
  equal('the untracked file is listed too', diff.changedFiles.includes('src/added.ts'), true);
  equal('the sandbox is not clean', diff.clean, false);
  check('the diff shows the modification', diff.diff.includes('export const version = 2;'));
  check('and the addition', diff.diff.includes('export const added = true;'));
  check('nothing from the other sandbox leaks in', !diff.diff.includes('version = 99'));
  equal('the base is the commit it was branched from', diff.baseCommit, headBefore);

  const otherDiff = await service.getDiff(second.path, second.baseCommit);
  equal('the other sandbox reports only its own file', otherDiff.changedFiles, ['src/app.ts']);

  describe('a sandbox that committed its own work still diffs');

  git('git add -A', info.path);
  git('git commit -q -m "sandbox work"', info.path);
  const afterCommit = await service.getDiff(info.path, info.baseCommit);
  equal('the committed change is still reported', afterCommit.changedFiles.sort(), [
    'src/added.ts',
    'src/app.ts'
  ]);
  equal('and it is still not clean', afterCommit.clean, false);

  describe('a sandbox that changed nothing');

  const t3 = 'thread-three';
  const untouched = await service.createWorktree(repo, t3);
  const cleanDiff = await service.getDiff(untouched.path, untouched.baseCommit);
  equal('reports no files', cleanDiff.changedFiles, []);
  equal('an empty diff', cleanDiff.diff, '');
  equal('and reads as clean', cleanDiff.clean, true);

  describe('getThreadDiff');

  const byThread = await service.getThreadDiff(repo, t1);
  equal('answers for the thread', byThread.threadId, t1);
  equal('with the same files', byThread.changedFiles.sort(), ['src/added.ts', 'src/app.ts']);
  await throwsCode('and refuses a thread with no sandbox', 'WORKTREE_NOT_FOUND', () =>
    service.getThreadDiff(repo, 'thread-never-existed')
  );
  await throwsCode('a diff of a path that is not there is refused', 'WORKTREE_NOT_FOUND', () =>
    service.getDiff(path.join(repo, '.asterim/worktrees/nope'))
  );

  // --- Merge ----------------------------------------------------------------
  describe('mergeWorktree');

  const mergeResult = await service.mergeWorktree(repo, t1);
  equal('the merge happened', mergeResult.merged, true);
  equal('into the checked-out branch', mergeResult.targetBranch, 'main');
  equal('no conflicts', mergeResult.conflicts, []);
  equal('the sandbox work is now in the project', read(repo, 'src/app.ts'), 'export const version = 2;\n');
  check('including the file it added', fs.existsSync(path.join(repo, 'src/added.ts')));
  equal('the primary tree is clean after the merge', git('git status --porcelain', repo), '');
  check('and HEAD moved', git('git rev-parse HEAD', repo) !== headBefore);
  equal('the reported commit is the new HEAD', mergeResult.commit, git('git rev-parse HEAD', repo));

  describe('a sandbox with uncommitted work is merged too');

  const t4 = 'thread-four';
  const uncommitted = await service.createWorktree(repo, t4);
  write(uncommitted.path, 'docs/notes.md', 'notes from the delegated agent\n');
  const merged4 = await service.mergeWorktree(repo, t4);
  equal('it merged', merged4.merged, true);
  equal(
    'and the uncommitted file arrived',
    read(repo, 'docs/notes.md'),
    'notes from the delegated agent\n'
  );

  describe('a sandbox that changed nothing merges as a no-op');

  const noop = await service.mergeWorktree(repo, t3);
  equal('it reports merged', noop.merged, true);
  equal('with a reason', noop.reason, 'The sandbox made no changes to merge.');

  describe('merging refuses to overwrite work in the primary tree');

  const t5 = 'thread-five';
  const conflicting = await service.createWorktree(repo, t5);
  write(conflicting.path, 'src/app.ts', 'export const version = 5;\n');
  write(repo, 'src/app.ts', 'export const version = 1000;\n');

  await throwsCode('a dirty target is refused', 'DIRTY_TARGET', () =>
    service.mergeWorktree(repo, t5)
  );
  equal(
    'and the operator’s own edit is still there',
    read(repo, 'src/app.ts'),
    'export const version = 1000;\n'
  );

  git('git checkout -q -- src/app.ts', repo);

  await throwsCode('a branch that is not checked out is refused', 'TARGET_NOT_CHECKED_OUT', () =>
    service.mergeWorktree(repo, t5, 'some-other-branch')
  );

  describe('a conflicting merge is aborted, not left in the tree');

  // The project moves the same line the sandbox did, from the sandbox's base.
  write(repo, 'src/app.ts', 'export const version = 7;\n');
  git('git add -A', repo);
  git('git commit -q -m "project moves the same line"', repo);
  const beforeConflict = git('git rev-parse HEAD', repo);

  await throwsCode('the conflict is reported', 'MERGE_CONFLICT', () =>
    service.mergeWorktree(repo, t5)
  );
  equal('HEAD did not move', git('git rev-parse HEAD', repo), beforeConflict);
  equal('the working tree is clean', git('git status --porcelain', repo), '');
  equal('the project’s version of the file survived', read(repo, 'src/app.ts'), 'export const version = 7;\n');
  check(
    'and no merge is in progress',
    !fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD')),
    'a half-merged repository is the outcome this subsystem exists to prevent'
  );

  // --- Removal --------------------------------------------------------------
  describe('removeWorktree');

  const removedPath = conflicting.path;
  equal('it reports having removed something', await service.removeWorktree(repo, t5), true);
  check('the directory is gone', !fs.existsSync(removedPath));
  equal(
    'the branch is gone',
    (() => {
      try {
        git(`git rev-parse --verify refs/heads/${WORKTREE_BRANCH_PREFIX}${t5}`, repo);
        return 'still there';
      } catch {
        return 'gone';
      }
    })(),
    'gone'
  );
  equal(
    'the base ref is gone',
    (() => {
      try {
        git(`git rev-parse --verify ${WORKTREE_BASE_REF_PREFIX}${t5}`, repo);
        return 'still there';
      } catch {
        return 'gone';
      }
    })(),
    'gone'
  );
  equal(
    'git no longer lists the checkout',
    (await service.listWorktrees(repo)).some((entry: { path: string }) =>
      entry.path.includes(t5)
    ),
    false
  );
  equal('the thread has no sandbox any more', await service.getWorktree(repo, t5), null);
  equal('removing it again is not an error', await service.removeWorktree(repo, t5), false);

  describe('removal does not disturb the project');

  equal('the primary tree is still clean', git('git status --porcelain', repo), '');
  equal('still on main', git('git rev-parse --abbrev-ref HEAD', repo), 'main');
  equal('and the merged work is still there', read(repo, 'src/app.ts'), 'export const version = 7;\n');

  describe('a sandbox with uncommitted changes is still removable');

  const t6 = 'thread-six';
  const dirty = await service.createWorktree(repo, t6);
  write(dirty.path, 'src/app.ts', 'export const version = 6;\n');
  write(dirty.path, 'scratch.txt', 'unsaved\n');
  equal('force removal succeeds', await service.removeWorktree(repo, t6), true);
  check('and the directory is gone', !fs.existsSync(dirty.path));

  // --- Orphans --------------------------------------------------------------
  describe('orphan cleanup');

  const orphan = 'thread-orphan';
  const orphanInfo = await service.createWorktree(repo, orphan);
  // What a crashed Core leaves behind: the checkout deleted from disk, git's
  // registration and the branch still there.
  fs.rmSync(orphanInfo.path, { recursive: true, force: true });

  const kept = 'thread-kept';
  const keptInfo = await service.createWorktree(repo, kept);

  const pruned = await service.pruneOrphans(repo, [kept]);
  check('at least the orphan was pruned', pruned >= 1, `pruned ${pruned}`);
  equal(
    'the orphan’s branch is gone',
    (() => {
      try {
        git(`git rev-parse --verify refs/heads/${WORKTREE_BRANCH_PREFIX}${orphan}`, repo);
        return 'still there';
      } catch {
        return 'gone';
      }
    })(),
    'gone'
  );
  check('the live sandbox survived', fs.existsSync(keptInfo.path));
  equal(
    'and is still registered',
    (await service.getWorktree(repo, kept))?.threadId,
    kept
  );
  equal('pruning a directory that is not a repository is a no-op', await service.pruneOrphans(plain), 0);

  describe('a sandbox whose directory was deleted by hand');

  const ghost = 'thread-ghost';
  const ghostInfo = await service.createWorktree(repo, ghost);
  fs.rmSync(ghostInfo.path, { recursive: true, force: true });
  equal('reads as having no sandbox', await service.getWorktree(repo, ghost), null);

  const rebuilt = await service.createWorktree(repo, ghost);
  check('and can be provisioned again', fs.existsSync(rebuilt.path));
  equal('on the same branch', rebuilt.branch, `${WORKTREE_BRANCH_PREFIX}${ghost}`);

  // --- Ignoring -------------------------------------------------------------
  describe('a project that already ignores .asterim is left alone');

  const ignoring = makeRepo('asterim-worktree-ignoring-');
  write(ignoring, '.gitignore', 'node_modules\n.asterim/\n');
  git('git add -A', ignoring);
  git('git commit -q -m "ignore asterim"', ignoring);

  await service.createWorktree(ignoring, 'thread-ignored');
  const ignoringExclude = path.join(ignoring, '.git', 'info', 'exclude');
  const excludeText = fs.existsSync(ignoringExclude)
    ? fs.readFileSync(ignoringExclude, 'utf8')
    : '';
  equal('nothing was appended to the exclude file', excludeText.includes('.asterim/'), false);
  equal('and the sandbox is still untracked', git('git status --porcelain', ignoring), '');

  describe('the exclude file is written, never .gitignore');

  const gitignorePath = path.join(repo, '.gitignore');
  equal('no .gitignore was created in the project', fs.existsSync(gitignorePath), false);

  describe('a detached HEAD cannot be merged into');

  const detached = makeRepo('asterim-worktree-detached-');
  await service.createWorktree(detached, 'thread-detached');
  write(path.join(detached, '.asterim/worktrees/thread-detached'), 'README.md', '# changed\n');
  git('git checkout -q --detach HEAD', detached);
  await throwsCode('there is no branch to merge into', 'TARGET_NOT_CHECKED_OUT', () =>
    service.mergeWorktree(detached, 'thread-detached')
  );
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
