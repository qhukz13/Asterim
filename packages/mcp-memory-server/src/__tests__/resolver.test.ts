/**
 * Unit tests for the project context resolver (P5.1-03).
 *
 * The repository has no test runner (docs/p5.1-01-audit-report.md § 6), so this is a
 * standalone script with its own assertion harness.
 *
 * ASTERIM_DATA_DIR points at a temp directory before the modules load — DatabaseService
 * exports a singleton constructed at import time, so `require` is used instead of
 * `import`, whose bindings would hoist above the assignment and open the real database.
 *
 * The seeded fixture reproduces the two shapes that exist in the live
 * ~/.asterim/asterim.db and that a naive resolver gets wrong: a project registered on an
 * ancestor directory of other projects, and a stored path with a trailing slash. A
 * sibling whose name is a prefix of another is added to cover substring collisions.
 *
 * Run:  pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/resolver.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-resolver-'));
process.env.ASTERIM_DATA_DIR = tmpDir;
delete process.env.ASTERIM_PROJECT_ID;

// eslint-disable-next-line @typescript-eslint/no-require-imports -- must load after ASTERIM_DATA_DIR is set; see header
const { dbService } = require('asterim/src/services/DatabaseService');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- must load after ASTERIM_DATA_DIR is set; see header
const { resolveProjectContext, parseResolveOptionsFromArgv } = require('../resolver');

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

/** Asserts the call throws and that the message satisfies every matcher. */
function throwsMatching(label: string, fn: () => unknown, matchers: RegExp[]): void {
  try {
    fn();
    check(label, false, 'expected a throw, but the call succeeded');
  } catch (err) {
    const message = (err as Error).message;
    const missing = matchers.filter(m => !m.test(message));
    check(label, missing.length === 0, missing.length ? `message missing ${missing.join(', ')} — got: ${message}` : undefined);
  }
}

function describe(name: string): void {
  console.log(`\n${name}`);
}

function cleanup(): void {
  try {
    dbService.getDb().close();
  } catch {
    /* ignore if already closed */
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

// --- Fixture ---

const ANCESTOR_ID = 'proj-ancestor';
const CORE_ID = 'proj-core';
const LEGACY_ID = 'proj-legacy';

const ANCESTOR_PATH = '/workspace/projects/';
const CORE_PATH = '/workspace/projects/asterim-core';
const LEGACY_PATH = '/workspace/projects/asterim-core-legacy';

try {
  const insert = dbService.getDb().prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)');
  insert.run(ANCESTOR_ID, 'All Projects', ANCESTOR_PATH);
  insert.run(CORE_ID, 'Asterim Core', CORE_PATH);
  insert.run(LEGACY_ID, 'Asterim Core Legacy', LEGACY_PATH);

  // --- CWD auto-detection ---------------------------------------------------
  describe('CWD auto-detection');

  equal(
    'an exact project root resolves to that project',
    resolveProjectContext({ cwd: CORE_PATH }).id,
    CORE_ID
  );
  equal(
    'a nested subfolder resolves to the innermost project, not the ancestor',
    resolveProjectContext({ cwd: '/workspace/projects/asterim-core/apps/server/src' }).id,
    CORE_ID
  );
  equal(
    'a deeply nested subfolder still resolves to the innermost project',
    resolveProjectContext({ cwd: '/workspace/projects/asterim-core/a/b/c/d/e' }).id,
    CORE_ID
  );
  equal(
    'the sibling whose name extends another resolves to itself',
    resolveProjectContext({ cwd: LEGACY_PATH }).id,
    LEGACY_ID
  );
  equal(
    'a subfolder of that sibling resolves to the sibling',
    resolveProjectContext({ cwd: '/workspace/projects/asterim-core-legacy/src' }).id,
    LEGACY_ID
  );
  equal(
    'a directory under the ancestor but inside no specific project resolves to the ancestor',
    resolveProjectContext({ cwd: '/workspace/projects/unregistered-thing' }).id,
    ANCESTOR_ID
  );
  equal(
    'the ancestor root itself resolves despite its stored trailing slash',
    resolveProjectContext({ cwd: '/workspace/projects' }).id,
    ANCESTOR_ID
  );
  equal(
    'a trailing slash on the input is normalized away',
    resolveProjectContext({ cwd: '/workspace/projects/asterim-core/' }).id,
    CORE_ID
  );
  equal(
    'relative segments in the input are resolved',
    resolveProjectContext({ cwd: '/workspace/projects/asterim-core/apps/../lib' }).id,
    CORE_ID
  );
  check(
    'resolution does not require the directory to exist on disk',
    !fs.existsSync(CORE_PATH) && resolveProjectContext({ cwd: CORE_PATH }).id === CORE_ID,
    'the fixture paths are intentionally fictional'
  );

  const resolved = resolveProjectContext({ cwd: CORE_PATH });
  equal('the resolved project carries its name', resolved.name, 'Asterim Core');
  equal('the resolved path is normalized', resolveProjectContext({ cwd: '/workspace/projects' }).path, path.resolve('/workspace/projects'));
  equal(
    'the resolved object exposes exactly id, name and path',
    Object.keys(resolved).sort(),
    ['id', 'name', 'path']
  );

  // --- Segment safety -------------------------------------------------------
  describe('segment-safe containment');

  // A raw startsWith() would match this against CORE_PATH.
  equal(
    'a sibling sharing a name prefix is not swallowed by the shorter project',
    resolveProjectContext({ cwd: '/workspace/projects/asterim-core-legacy/deep/path' }).id,
    LEGACY_ID
  );
  equal(
    'an unregistered sibling sharing a prefix falls back to the ancestor, not the shorter sibling',
    resolveProjectContext({ cwd: '/workspace/projects/asterim-core-unregistered/src' }).id,
    ANCESTOR_ID
  );
  throwsMatching(
    'a path outside every project does not match by prefix',
    () => resolveProjectContext({ cwd: '/workspace/projects-elsewhere/thing' }),
    [/Could not determine the Asterim project/]
  );

  // --- Explicit project id --------------------------------------------------
  describe('explicit --project <id>');

  equal(
    'an explicit id resolves',
    resolveProjectContext({ explicitProjectId: LEGACY_ID }).id,
    LEGACY_ID
  );
  equal(
    'an explicit id outranks the working directory',
    resolveProjectContext({ explicitProjectId: ANCESTOR_ID, cwd: CORE_PATH }).id,
    ANCESTOR_ID
  );
  throwsMatching(
    'an unknown explicit id throws and lists the registered projects',
    () => resolveProjectContext({ explicitProjectId: 'no-such-project' }),
    [/--project 'no-such-project'/, /Registered projects:/, /Asterim Core/, /proj-core/]
  );

  // --- Explicit project path ------------------------------------------------
  describe('explicit --project-path <path>');

  equal(
    'an explicit path resolves',
    resolveProjectContext({ explicitProjectPath: CORE_PATH }).id,
    CORE_ID
  );
  equal(
    'an explicit path pointing into a project resolves to that project',
    resolveProjectContext({ explicitProjectPath: '/workspace/projects/asterim-core/apps' }).id,
    CORE_ID
  );
  equal(
    'an explicit path outranks the working directory',
    resolveProjectContext({ explicitProjectPath: LEGACY_PATH, cwd: CORE_PATH }).id,
    LEGACY_ID
  );
  equal(
    'an explicit id outranks an explicit path',
    resolveProjectContext({ explicitProjectId: CORE_ID, explicitProjectPath: LEGACY_PATH }).id,
    CORE_ID
  );
  throwsMatching(
    'an unmatched explicit path throws and lists the registered projects',
    () => resolveProjectContext({ explicitProjectPath: '/somewhere/else' }),
    [/--project-path/, /somewhere/, /else/, /Registered projects:/]
  );

  // --- Environment variable -------------------------------------------------
  describe('ASTERIM_PROJECT_ID');

  process.env.ASTERIM_PROJECT_ID = LEGACY_ID;
  equal('the environment variable resolves', resolveProjectContext().id, LEGACY_ID);
  equal(
    'the environment variable outranks the working directory',
    resolveProjectContext({ cwd: CORE_PATH }).id,
    LEGACY_ID
  );
  equal(
    'an explicit id outranks the environment variable',
    resolveProjectContext({ explicitProjectId: CORE_ID }).id,
    CORE_ID
  );
  equal(
    'an explicit path outranks the environment variable',
    resolveProjectContext({ explicitProjectPath: ANCESTOR_PATH }).id,
    ANCESTOR_ID
  );

  process.env.ASTERIM_PROJECT_ID = 'bogus-id';
  throwsMatching(
    'an invalid environment variable throws and names the variable',
    () => resolveProjectContext({ cwd: CORE_PATH }),
    [/ASTERIM_PROJECT_ID='bogus-id'/, /Registered projects:/]
  );
  delete process.env.ASTERIM_PROJECT_ID;

  equal(
    'clearing the variable restores CWD detection',
    resolveProjectContext({ cwd: CORE_PATH }).id,
    CORE_ID
  );

  // --- Failure messaging ----------------------------------------------------
  describe('failure messaging');

  throwsMatching(
    'an unmatched CWD throws with remediation and the project list',
    () => resolveProjectContext({ cwd: '/tmp/definitely-not-a-project' }),
    [
      /Could not determine the Asterim project for/,
      /definitely-not-a-project/,
      /--project <id>/,
      /--project-path <path>/,
      /ASTERIM_PROJECT_ID/,
      /Registered projects:/,
      /All Projects/,
      /Asterim Core Legacy/
    ]
  );

  // --- argv parsing ---------------------------------------------------------
  describe('argv parsing');

  equal(
    '--project <value> is parsed',
    parseResolveOptionsFromArgv(['--project', 'abc']),
    { explicitProjectId: 'abc' }
  );
  equal(
    '--project=<value> is parsed',
    parseResolveOptionsFromArgv(['--project=abc']),
    { explicitProjectId: 'abc' }
  );
  equal(
    '--project-path <value> is parsed',
    parseResolveOptionsFromArgv(['--project-path', '/w/p']),
    { explicitProjectPath: '/w/p' }
  );
  equal(
    '--project-path=<value> is parsed',
    parseResolveOptionsFromArgv(['--project-path=/w/p']),
    { explicitProjectPath: '/w/p' }
  );
  equal(
    'both flags together are parsed',
    parseResolveOptionsFromArgv(['--project', 'abc', '--project-path', '/w/p']),
    { explicitProjectId: 'abc', explicitProjectPath: '/w/p' }
  );
  equal('unknown flags are ignored', parseResolveOptionsFromArgv(['--verbose', '-x']), {});
  equal('an empty argv yields no options', parseResolveOptionsFromArgv([]), {});
  check(
    '--project-path is not mistaken for --project',
    parseResolveOptionsFromArgv(['--project-path', '/w/p']).explicitProjectId === undefined,
    'prefix collision between the two flags'
  );

  equal(
    'parsed argv feeds resolveProjectContext',
    resolveProjectContext(parseResolveOptionsFromArgv(['--project', CORE_ID])).id,
    CORE_ID
  );

  // --- Empty database -------------------------------------------------------
  describe('no registered projects');

  dbService.getDb().prepare('DELETE FROM projects').run();
  throwsMatching(
    'an empty database produces a distinct, actionable message',
    () => resolveProjectContext({ cwd: CORE_PATH }),
    [/No projects are registered in Asterim yet/]
  );
  throwsMatching(
    'an explicit id against an empty database also explains',
    () => resolveProjectContext({ explicitProjectId: CORE_ID }),
    [/No projects are registered in Asterim yet/]
  );
} catch (err) {
  failed++;
  console.error('\nUNCAUGHT ERROR:', err);
} finally {
  cleanup();
}

console.log(`\n${passed}/${passed + failed} assertions passed`);
if (failures.length > 0) {
  console.log('Failed assertions:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
