/**
 * Tests for local transcript extraction (P5.4-03, DEC-027 / DEC-028).
 *
 * Two properties matter more than recall here. Extraction must stay **local** —
 * it reads SQLite and matches text, and nothing in this file can reach a network
 * because nothing in the implementation can. And it must never reach
 * `project_decisions`: the whole point of a staging table is that an unreviewed
 * guess cannot become the next session's premise.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/memory/__tests__/DecisionExtractor.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-extractor-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-extractor-proj-'));

const { dbService } = require('../../DatabaseService');
const { projectMemoryService } = require('../../ProjectMemoryService');
const {
  decisionExtractor,
  extractCandidates,
  extractAnchors,
  decisionSignal,
  splitSentences,
  toTitle
} = require('../DecisionExtractor');

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

function cleanup(): void {
  for (const dir of [tmpDir, projectDir]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  console.log('\n[cleanup] removed temp directories');
}

const PROJECT = 'proj-extract';
const line = (text: string, over: Record<string, unknown> = {}) => ({ text, timestamp: 1, ...over });

async function main(): Promise<void> {
  // --- Sentence handling ----------------------------------------------------
  describe('splitSentences and toTitle');

  equal('sentences split on terminators', splitSentences('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
  equal('and on newlines', splitSentences('One\nTwo'), ['One', 'Two']);
  equal('blank fragments are dropped', splitSentences('One.  \n\n  Two.'), ['One.', 'Two.']);
  equal('an empty string yields nothing', splitSentences('   '), []);

  equal('a title drops its terminator', toTitle('We will use Argon2id.'), 'We will use Argon2id');
  equal('a Decision: prefix is stripped', toTitle('Decision: adopt Argon2id'), 'adopt Argon2id');
  check('a long title is truncated', toTitle('x'.repeat(200)).length <= 80);
  check('and marked as truncated', toTitle('x'.repeat(200)).endsWith('…'));

  // --- Signal detection -----------------------------------------------------
  describe('decisionSignal');

  check('an explicit Decision: marker scores highest', decisionSignal('Decision: use Argon2id') >= 0.9);
  check('"we will use" is a decision', decisionSignal('We will use Argon2id for hashing') > 0);
  check('"adopting" is a decision', decisionSignal('Adopting node:sqlite for persistence') > 0);
  check('"from now on" is a decision', decisionSignal('From now on all writes go through the service') > 0);
  check('a prohibition counts', decisionSignal('Never commit secrets to the repository') > 0);

  equal('ordinary narration is not a decision', decisionSignal('I am reading the auth service now'), 0);
  equal('a question is not a decision', decisionSignal('Should we use Argon2id or bcrypt?'), 0);
  equal('a file listing is not a decision', decisionSignal('src/auth.ts src/session.ts'), 0);
  equal('an error message is not a decision', decisionSignal('TypeError: cannot read property of undefined'), 0);
  check(
    'the bar is set to under-report rather than over-report',
    decisionSignal('This looks like it might be better') === 0,
    'a queue full of noise is a queue nobody reviews'
  );

  // --- Anchors --------------------------------------------------------------
  describe('extractAnchors');

  const anchored = extractAnchors(projectDir, 'Anchored to src/auth.ts#hashPassword for this change.');
  equal('a path#symbol anchor is captured', anchored.codeRefs, [
    { filePath: 'src/auth.ts', symbolName: 'hashPassword' }
  ]);
  equal('and the file is listed', anchored.relatedFiles, ['src/auth.ts']);

  const plain = extractAnchors(projectDir, 'Touches src/session.ts and src/auth.ts today.');
  equal('bare paths are captured', plain.relatedFiles, ['src/session.ts', 'src/auth.ts']);
  equal('a path is not duplicated', extractAnchors(projectDir, 'src/a.ts and src/a.ts').relatedFiles, ['src/a.ts']);

  const withCommit = extractAnchors(projectDir, 'See src/auth.ts at a1b2c3d4e5f6 for context.');
  equal('a commit hash attaches to the anchor', withCommit.codeRefs[0]?.commitHash, 'a1b2c3d4e5f6');
  const commitOnly = extractAnchors(projectDir, 'The commit a1b2c3d4e5f6 was fine.');
  equal('a commit with no file becomes no anchor', commitOnly.codeRefs, []);

  // Criterion 2: paths come from model output and must be checked at creation.
  // Paths carry an extension so they actually match the path pattern and reach
  // the containment check — an earlier fixture used extensionless paths, which
  // never matched at all and so proved nothing about the guard.
  const escaping = extractAnchors(projectDir, 'Read ../../secrets/keys.json and ../../../root/config.yaml now.');
  equal('an escaping path produces no anchor', escaping.codeRefs, []);
  equal('and no related file', escaping.relatedFiles, []);
  check('and is reported as rejected', escaping.rejected.length > 0, JSON.stringify(escaping.rejected));

  const mixed = extractAnchors(projectDir, 'Compare src/auth.ts with ../../secrets/keys.json here.');
  equal('a safe path beside an unsafe one still resolves', mixed.relatedFiles, ['src/auth.ts']);
  check('while the unsafe one is dropped', !JSON.stringify(mixed.codeRefs).includes('secrets'));

  equal(
    'an unsafe commit-like string is not attached',
    extractAnchors(projectDir, 'src/auth.ts at HEAD; rm -rf /').codeRefs[0]?.commitHash,
    undefined
  );

  // --- Extraction over a transcript -----------------------------------------
  describe('extractCandidates');

  const transcript = [
    line('I am opening the auth service to see how hashing works.'),
    line('Decision: use Argon2id for password hashing because it is memory-hard. Never log the derived key.'),
    line('Running the tests now.'),
    line('We will standardise on node:sqlite because it avoids a native build step. It must not add a driver dependency.'),
    line('TypeError: cannot read property of undefined')
  ];
  const found = extractCandidates(projectDir, transcript);

  equal('only the decision sentences are extracted', found.length, 2);
  check('the first is the hashing decision', found[0].title.includes('Argon2id'), found[0].title);
  check('its rationale is captured', found[0].rationale.includes('memory-hard'), found[0].rationale);
  check('a prohibition becomes a constraint', found[0].constraints.some((c: string) => /Never log/.test(c)), JSON.stringify(found[0].constraints));
  check('the second is the sqlite decision', found[1].title.includes('node:sqlite'), found[1].title);
  check('its rationale is captured from the same sentence', found[1].rationale.includes('native build step'), found[1].rationale);

  // Rationale detection is marker-based. A justification phrased without one is
  // missed, and the candidate says so rather than inventing a reason — asserted
  // so the limitation is recorded rather than discovered later.
  const unmarked = extractCandidates(projectDir, [
    line('Decision: adopt node:sqlite. It avoids a native build step.')
  ]);
  equal(
    'an unmarked justification yields no invented rationale',
    unmarked[0].rationale,
    'No rationale was stated in the session.'
  );

  check('confidence is bounded below certainty', found.every((c: any) => c.confidence > 0 && c.confidence <= 0.95));
  check(
    'no candidate is recorded as certain',
    found.every((c: any) => c.confidence < 1),
    'certainty is what a human approval confers, not a regex'
  );

  const repeated = extractCandidates(projectDir, [
    line('Decision: use Argon2id for hashing.'),
    line('Decision: use Argon2id for hashing.')
  ]);
  equal('the same decision restated is not queued twice', repeated.length, 1);

  equal('an empty transcript yields nothing', extractCandidates(projectDir, []), []);
  equal(
    'a transcript with no decisions yields nothing',
    extractCandidates(projectDir, [line('Running tests.'), line('All green.')]),
    []
  );

  const withAnchor = extractCandidates(projectDir, [
    line('Decision: hash passwords with Argon2id in src/auth.ts#hashPassword.')
  ]);
  equal('anchors reach the candidate', withAnchor[0].codeRefs, [
    { filePath: 'src/auth.ts', symbolName: 'hashPassword' }
  ]);

  const withEscape = extractCandidates(projectDir, [
    line('Decision: we will use the config at ../../secrets/keys.json from now on.')
  ]);
  equal('an escaping anchor never reaches a candidate', withEscape[0].codeRefs, []);

  // --- Staging against the database -----------------------------------------
  describe('extractForProject stages, and stages only');

  dbService
    .getDb()
    .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
    .run(PROJECT, 'Extract Fixture', projectDir);

  const insertEvent = dbService
    .getDb()
    .prepare('INSERT INTO events (id, project_id, thread_id, timestamp, source, type, payload_json) VALUES (?,?,?,?,?,?,?)');
  const chat = (id: string, content: string, threadId = 'thread-1', ts = 1000) =>
    insertEvent.run(id, PROJECT, threadId, ts, 'agent:claude', 'chat.message', JSON.stringify({ payload: { role: 'agent', content } }));

  chat('e1', 'Looking at the session service.', 'thread-1', 1000);
  chat('e2', 'Decision: use Argon2id for password hashing because it resists GPU attack.', 'thread-1', 1001);
  chat('e3', 'Decision: expire session tokens after 15 minutes because leaks are bounded.', 'thread-2', 1002);
  insertEvent.run('e4', PROJECT, 'thread-1', 1003, 'agent:claude', 'terminal.data', JSON.stringify({ payload: { data: 'Decision: this is terminal noise' } }));

  const proposals = decisionExtractor.extractForProject({ projectId: PROJECT });
  equal('both decisions are proposed', proposals.length, 2);
  check('terminal output is not mined', !JSON.stringify(proposals).includes('terminal noise'));
  equal('each carries the project', [...new Set(proposals.map((p: any) => p.projectId))], [PROJECT]);

  const threadScoped = decisionExtractor.extractForProject({ projectId: PROJECT, threadId: 'thread-2' });
  equal('a thread filter narrows the transcript', threadScoped.length, 1);
  check('to that thread only', threadScoped[0].title.includes('15 minutes'), threadScoped[0].title);

  equal(
    'an unknown project proposes nothing',
    decisionExtractor.extractForProject({ projectId: 'proj-nope' }),
    []
  );

  const decisionsBefore = projectMemoryService.listDecisions(PROJECT).length;
  const staged = proposals.map((p: any) => projectMemoryService.createCandidate(p));
  equal('staging creates candidates', staged.length, 2);
  equal('all PENDING', [...new Set(staged.map((c: any) => c.status))], ['PENDING']);
  check('each has an id', staged.every((c: any) => typeof c.id === 'string' && c.id.length > 0));
  check('and an extraction timestamp', staged.every((c: any) => typeof c.extractedAt === 'number' && c.extractedAt > 0));
  check('and no review timestamp yet', staged.every((c: any) => c.reviewedAt === undefined));

  equal(
    'and project_decisions is untouched (DEC-027)',
    projectMemoryService.listDecisions(PROJECT).length,
    decisionsBefore
  );

  describe('listCandidates');

  equal('all candidates are listed', projectMemoryService.listCandidates(PROJECT).length, 2);
  equal('PENDING filters to the same set', projectMemoryService.listCandidates(PROJECT, 'PENDING').length, 2);
  equal('APPROVED is empty', projectMemoryService.listCandidates(PROJECT, 'APPROVED'), []);
  equal('another project sees none', projectMemoryService.listCandidates('proj-other'), []);
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
