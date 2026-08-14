/**
 * Tests for the Git drift detector (P5.4-02).
 *
 * Runs against a real git repository created in a temp directory — real commits,
 * real working-tree edits, real `git status`. A mocked GitProvider would test the
 * parsing and nothing about whether the questions asked of git are the right ones.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/git/__tests__/GitDriftDetector.test.ts
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { GitDriftDetector, resolveInsideProject, symbolAppears, isSafeCommitHash } = require('../GitDriftDetector');

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
  check(label, ok, ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function describe(name: string): void {
  console.log(`\n${name}`);
}

const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-drift-repo-'));
const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-drift-plain-'));

function cleanup(): void {
  for (const dir of [repoDir, plainDir]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  console.log('\n[cleanup] removed temp repositories');
}

function git(command: string, cwd = repoDir): string {
  return execSync(command, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Drift Test',
      GIT_AUTHOR_EMAIL: 'drift@test.local',
      GIT_COMMITTER_NAME: 'Drift Test',
      GIT_COMMITTER_EMAIL: 'drift@test.local'
    }
  }).trim();
}

function write(relative: string, content: string, cwd = repoDir): void {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

const ref = (over: Record<string, unknown> = {}) => ({
  id: 'ref-1',
  decisionId: 'dec-1',
  filePath: 'src/auth.ts',
  createdAt: 1,
  ...over
});

const decision = (over: Record<string, unknown> = {}) => ({
  id: 'dec-1',
  projectId: 'p',
  title: 'T',
  summary: 's',
  rationale: 'r',
  constraints: [],
  status: 'ACTIVE',
  supersededBy: null,
  provenance: 'HUMAN_CONFIRMED',
  confidence: 1,
  createdAt: 1,
  updatedAt: 1,
  relatedFiles: [],
  codeRefs: [],
  ...over
});

async function main(): Promise<void> {
  const detector = new GitDriftDetector();

  // --- Pure helpers ---------------------------------------------------------
  describe('resolveInsideProject');

  check('a normal relative path resolves', resolveInsideProject('/proj', 'src/a.ts') === path.resolve('/proj/src/a.ts'));
  equal('an escaping path is refused', resolveInsideProject('/proj', '../../etc/passwd'), null);
  equal('an absolute path outside is refused', resolveInsideProject('/proj', '/etc/passwd'), null);
  equal('the project root itself is not a file anchor', resolveInsideProject('/proj', '.'), null);
  check(
    'a sibling whose name extends the project is refused',
    resolveInsideProject('/proj', '../proj-old/a.ts') === null,
    'prefix matching would accept this'
  );
  check('a nested path resolves', resolveInsideProject('/proj', 'a/b/c.ts') === path.resolve('/proj/a/b/c.ts'));

  describe('symbolAppears');

  check('an exact identifier is found', symbolAppears('export function hashPassword() {}', 'hashPassword'));
  check('a call site counts', symbolAppears('const x = hashPassword(input);', 'hashPassword'));
  check('a longer identifier does not match', !symbolAppears('function hashPasswordLegacy() {}', 'hashPassword'));
  check('a prefixed identifier does not match', !symbolAppears('function myHashPassword() {}', 'hashPassword'));
  check('an absent symbol is absent', !symbolAppears('export function verify() {}', 'hashPassword'));
  check('an empty symbol is treated as present', symbolAppears('anything', ''));
  check('regex metacharacters in a symbol are literal', !symbolAppears('function ab() {}', 'a.b'));
  check('and match when actually present', symbolAppears('const a.b = 1;', 'a.b'));

  describe('isSafeCommitHash');

  check('a short hash is accepted', isSafeCommitHash('a1b2c3d'));
  check('a full hash is accepted', isSafeCommitHash('a'.repeat(40)));
  check('an injection attempt is refused', !isSafeCommitHash('HEAD; rm -rf /'));
  check('a branch name is refused', !isSafeCommitHash('main'));
  check('too short is refused', !isSafeCommitHash('a1b'));
  check('undefined is refused', !isSafeCommitHash(undefined));

  // --- A real repository ----------------------------------------------------
  describe('a clean anchor in a real repository');

  git('git init -q');
  git('git config user.email drift@test.local');
  git('git config user.name "Drift Test"');
  write('src/auth.ts', 'export function hashPassword(x: string) {\n  return x;\n}\n');
  write('src/session.ts', 'export const SESSION_TTL = 900;\n');
  git('git add -A');
  git('git commit -q -m "initial"');
  const firstCommit = git('git rev-parse HEAD');

  const snapshot = await detector.snapshot(repoDir);
  check('the snapshot recognises a repository', snapshot.isRepository);
  equal('with nothing changed', snapshot.changedPaths.size, 0);
  equal('and a HEAD', snapshot.head, firstCommit);

  equal('a clean file anchor reports no drift', await detector.detectRefDrift(repoDir, ref()), null);
  equal(
    'a clean file+symbol anchor reports no drift',
    await detector.detectRefDrift(repoDir, ref({ symbolName: 'hashPassword' })),
    null
  );
  equal(
    'a symbol-only anchor is not judged',
    await detector.detectRefDrift(repoDir, ref({ filePath: undefined, symbolName: 'hashPassword' })),
    null
  );

  const clean = await detector.detectDecisionDrift(repoDir, decision({ codeRefs: [ref({ symbolName: 'hashPassword' })] }));
  equal('a clean decision is not drifted', clean.drifted, false);
  equal('with no refs listed', clean.refs, []);
  equal('and no worst drift', clean.worst, null);

  // --- FILE_MODIFIED --------------------------------------------------------
  describe('FILE_MODIFIED — uncommitted changes');

  write('src/auth.ts', 'export function hashPassword(x: string) {\n  return x + "!";\n}\n');
  // Pins the parse against GitProvider.exec's trim, which strips the leading
  // space of the first porcelain line and shifts a column-based slice by one.
  const trimmedSnapshot = await detector.snapshot(repoDir);
  check(
    'the porcelain path survives the provider trimming its output',
    trimmedSnapshot.changedPaths.has('src/auth.ts'),
    `parsed: ${JSON.stringify([...trimmedSnapshot.changedPaths])}`
  );

  const modified = await detector.detectRefDrift(repoDir, ref());
  equal('an edited file drifts', modified?.type, 'FILE_MODIFIED');
  check('and says which file', modified?.detail.includes('src/auth.ts'), modified?.detail);
  equal('the ref id is carried', modified?.refId, 'ref-1');

  equal(
    'an untouched file beside it stays clean',
    await detector.detectRefDrift(repoDir, ref({ filePath: 'src/session.ts' })),
    null
  );

  git('git add -A');
  git('git commit -q -m "edit auth"');
  equal('committing clears the uncommitted-change drift', await detector.detectRefDrift(repoDir, ref()), null);

  // --- FILE_MODIFIED since the anchored commit ------------------------------
  describe('FILE_MODIFIED — changed since the anchored commit');

  const sinceAnchor = await detector.detectRefDrift(repoDir, ref({ commitHash: firstCommit }));
  equal('a file changed since its anchor commit drifts', sinceAnchor?.type, 'FILE_MODIFIED');
  check('and names the commit it was anchored at', sinceAnchor?.detail.includes(firstCommit.slice(0, 7)), sinceAnchor?.detail);

  // This is the case that separates "did this file change" from "did anything change".
  write('src/unrelated.ts', 'export const x = 1;\n');
  git('git add -A');
  git('git commit -q -m "unrelated file"');
  equal(
    'an unrelated commit does not drift an untouched anchor',
    await detector.detectRefDrift(repoDir, ref({ filePath: 'src/session.ts', commitHash: firstCommit })),
    null
  );

  equal(
    'an anchor at the current HEAD does not drift',
    await detector.detectRefDrift(repoDir, ref({ filePath: 'src/session.ts', commitHash: git('git rev-parse HEAD') })),
    null
  );
  equal(
    'an unknown commit is not treated as evidence of drift',
    await detector.detectRefDrift(repoDir, ref({ filePath: 'src/session.ts', commitHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' })),
    null
  );
  equal(
    'a malformed commit hash is ignored rather than executed',
    await detector.detectRefDrift(repoDir, ref({ filePath: 'src/session.ts', commitHash: 'HEAD; touch /tmp/pwned' })),
    null
  );
  check('and nothing was executed', !fs.existsSync('/tmp/pwned'));

  // --- SYMBOL_NOT_FOUND -----------------------------------------------------
  describe('SYMBOL_NOT_FOUND');

  const missingSymbol = await detector.detectRefDrift(repoDir, ref({ symbolName: 'verifyPassword' }));
  equal('a symbol that is not in the file drifts', missingSymbol?.type, 'SYMBOL_NOT_FOUND');
  check('and names the symbol', missingSymbol?.detail.includes('verifyPassword'), missingSymbol?.detail);
  check('and the file it looked in', missingSymbol?.detail.includes('src/auth.ts'));

  write('src/auth.ts', 'export function hashPasswordV2(x: string) {\n  return x;\n}\n');
  const renamedSymbol = await detector.detectRefDrift(repoDir, ref({ symbolName: 'hashPassword' }));
  equal(
    'a renamed symbol drifts as missing, not merely modified',
    renamedSymbol?.type,
    'SYMBOL_NOT_FOUND'
  );

  // --- FILE_DELETED ---------------------------------------------------------
  describe('FILE_DELETED');

  fs.rmSync(path.join(repoDir, 'src/auth.ts'));
  const deleted = await detector.detectRefDrift(repoDir, ref({ symbolName: 'hashPassword' }));
  equal('a deleted file drifts', deleted?.type, 'FILE_DELETED');
  check('and says so plainly', deleted?.detail.includes('no longer exists'), deleted?.detail);

  const escaping = await detector.detectRefDrift(repoDir, ref({ filePath: '../../../etc/passwd' }));
  equal('an anchor escaping the project is refused, not followed', escaping?.type, 'FILE_DELETED');
  check('and says why', escaping?.detail.includes('outside the project'), escaping?.detail);

  // --- Aggregation ----------------------------------------------------------
  describe('detectDecisionDrift aggregates by severity');

  const many = await detector.detectDecisionDrift(
    repoDir,
    decision({
      codeRefs: [
        ref({ id: 'r-missing', filePath: 'src/session.ts', symbolName: 'NOT_THERE' }),
        ref({ id: 'r-deleted', filePath: 'src/auth.ts' })
      ]
    })
  );
  equal('a decision with two drifted anchors is drifted', many.drifted, true);
  equal('both are reported', many.refs.length, 2);
  equal('the worst is the deletion', many.worst, 'FILE_DELETED');
  equal('and each carries its own ref id', many.refs.map((r: any) => r.refId).sort(), ['r-deleted', 'r-missing']);

  write('src/session.ts', 'export const SESSION_TTL = 900;\nexport const OTHER = 1;\n');
  const modifiedOnly = await detector.detectDecisionDrift(
    repoDir,
    decision({ codeRefs: [ref({ id: 'r1', filePath: 'src/session.ts' })] })
  );
  equal('a decision with only a modified file reports that as worst', modifiedOnly.worst, 'FILE_MODIFIED');

  describe('detectAll shares one snapshot');

  const all = await detector.detectAll(repoDir, [
    decision({ id: 'd-clean', codeRefs: [] }),
    decision({ id: 'd-dirty', codeRefs: [ref({ id: 'r', filePath: 'src/auth.ts' })] })
  ]);
  equal('every decision is keyed', Object.keys(all).sort(), ['d-clean', 'd-dirty']);
  equal('a decision with no anchors is clean', all['d-clean'].drifted, false);
  equal('and one with a deleted anchor is not', all['d-dirty'].worst, 'FILE_DELETED');

  // --- Outside a repository -------------------------------------------------
  describe('a project that is not a git repository');

  write('src/a.ts', 'export const a = 1;\n', plainDir);
  const plainSnapshot = await detector.snapshot(plainDir);
  equal('the snapshot reports no repository', plainSnapshot.isRepository, false);
  equal('an existing file is still clean', await detector.detectRefDrift(plainDir, ref({ filePath: 'src/a.ts' })), null);
  equal(
    'a missing file is still reported deleted',
    (await detector.detectRefDrift(plainDir, ref({ filePath: 'src/gone.ts' })))?.type,
    'FILE_DELETED'
  );
  equal(
    'and a missing symbol is still reported',
    (await detector.detectRefDrift(plainDir, ref({ filePath: 'src/a.ts', symbolName: 'nope' })))?.type,
    'SYMBOL_NOT_FOUND'
  );

  describe('a project path that does not exist');

  const gone = await detector.snapshot(path.join(os.tmpdir(), 'asterim-does-not-exist-at-all'));
  equal('no repository', gone.isRepository, false);
  equal('and no head', gone.head, null);
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
