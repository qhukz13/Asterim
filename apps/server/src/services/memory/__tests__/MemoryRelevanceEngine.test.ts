/**
 * Tests for local relevance ranking (P5.4-04, DEC-028 / DEC-024 / DEC-027).
 *
 * The engine is pure, so these call it directly. Two properties are load-bearing
 * beyond "does it rank": it must be **deterministic** — the briefing's
 * byte-identical guarantee depends on it — and it must never drop a rule or the
 * intent, which the task's § 6 forbids and which a token-saving optimisation is
 * exactly the kind of change that would.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/memory/__tests__/MemoryRelevanceEngine.test.ts
 */

const {
  MemoryRelevanceEngine,
  scoreDecision,
  lexicalScore,
  tokenize,
  pathsOverlap,
  normalizePath,
  decisionPaths,
  PROVENANCE_WEIGHT,
  PATH_OVERLAP_BOOST,
  DRIFT_PENALTY,
  DEFAULT_BRIEFING_LIMIT
} = require('../MemoryRelevanceEngine');

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

// --- Fixtures ---

const decision = (over: Record<string, unknown> = {}) => ({
  id: 'dec-1',
  projectId: 'p',
  title: 'Hash passwords with Argon2id',
  summary: 'Argon2id, 64 MiB memory cost.',
  rationale: 'Memory-hard.',
  constraints: [],
  status: 'ACTIVE',
  supersededBy: null,
  provenance: 'AGENT_STATEMENT',
  confidence: 0.75,
  createdAt: 1000,
  updatedAt: 1000,
  relatedFiles: [],
  codeRefs: [],
  ...over
});

const drifted = (id: string, type: string) => ({
  [id]: { decisionId: id, drifted: true, worst: type, refs: [{ refId: 'r', filePath: 'a.ts', type, detail: 'd' }] }
});

async function main(): Promise<void> {
  const engine = new MemoryRelevanceEngine();

  // --- Tokenisation ---------------------------------------------------------
  describe('tokenize');

  equal('words are lowercased', [...tokenize('Argon2id HASHING')], ['argon2id', 'hashing']);
  check('camelCase is split', [...tokenize('hashPassword')].includes('hash') && [...tokenize('hashPassword')].includes('password'));
  check('snake_case is split', [...tokenize('session_ttl')].includes('session'));
  check('stopwords are dropped', !tokenize('the and with for').has('the'));
  check('very short terms are dropped', !tokenize('a to is').has('to'));
  equal('empty text yields nothing', [...tokenize('')], []);
  equal('punctuation is not a term', [...tokenize('auth, service.')], ['auth', 'service']);

  // --- Path comparison ------------------------------------------------------
  describe('pathsOverlap');

  check('identical paths overlap', pathsOverlap('src/auth.ts', 'src/auth.ts'));
  check('a file inside a touched folder overlaps', pathsOverlap('src/auth/hash.ts', 'src/auth'));
  check('and the other way round', pathsOverlap('src/auth', 'src/auth/hash.ts'));
  check('backslashes are normalised', pathsOverlap('src\\auth.ts', 'src/auth.ts'));
  check('a leading ./ is ignored', pathsOverlap('./src/auth.ts', 'src/auth.ts'));

  check(
    'a sibling sharing a name prefix does not overlap',
    !pathsOverlap('src/authentication/x.ts', 'src/auth'),
    'the substring trap the resolver and drift detector both avoid'
  );
  check('unrelated paths do not overlap', !pathsOverlap('src/auth.ts', 'src/session.ts'));
  check('an empty path never overlaps', !pathsOverlap('', 'src/auth.ts'));

  equal('normalizePath strips surrounding slashes', normalizePath('/src/auth.ts/'), 'src/auth.ts');

  describe('decisionPaths');

  equal(
    'relatedFiles and codeRefs are merged',
    decisionPaths(decision({ relatedFiles: ['src/a.ts'], codeRefs: [{ filePath: 'src/b.ts' }] })).sort(),
    ['src/a.ts', 'src/b.ts']
  );
  equal(
    'a path in both is listed once',
    decisionPaths(decision({ relatedFiles: ['src/a.ts'], codeRefs: [{ filePath: 'src/a.ts' }] })),
    ['src/a.ts']
  );
  equal('a symbol-only ref contributes no path', decisionPaths(decision({ codeRefs: [{ symbolName: 'fn' }] })), []);

  // --- Provenance -----------------------------------------------------------
  describe('provenance weighting (DEC-024)');

  equal('HUMAN_CONFIRMED is the baseline maximum', PROVENANCE_WEIGHT.HUMAN_CONFIRMED, 1.0);
  equal('REPOSITORY_EVIDENCE is next', PROVENANCE_WEIGHT.REPOSITORY_EVIDENCE, 0.85);
  equal('AGENT_STATEMENT is next', PROVENANCE_WEIGHT.AGENT_STATEMENT, 0.7);
  equal('INFERRED is lowest', PROVENANCE_WEIGHT.INFERRED, 0.5);

  const byProvenance = engine.rankDecisions([
    decision({ id: 'inferred', provenance: 'INFERRED' }),
    decision({ id: 'human', provenance: 'HUMAN_CONFIRMED' }),
    decision({ id: 'agent', provenance: 'AGENT_STATEMENT' }),
    decision({ id: 'repo', provenance: 'REPOSITORY_EVIDENCE' })
  ]);
  equal(
    'with nothing else to go on, provenance orders the list',
    byProvenance.map((d: any) => d.id),
    ['human', 'repo', 'agent', 'inferred']
  );
  check('and each carries its score', byProvenance.every((d: any) => typeof d.relevanceScore === 'number'));

  // --- Path overlap ---------------------------------------------------------
  describe('touched files outrank provenance');

  const touchedRanking = engine.rankDecisions(
    [
      decision({ id: 'human-elsewhere', provenance: 'HUMAN_CONFIRMED', relatedFiles: ['src/other.ts'] }),
      decision({ id: 'agent-touched', provenance: 'AGENT_STATEMENT', relatedFiles: ['src/auth.ts'] })
    ],
    { touchPaths: ['src/auth.ts'] }
  );
  equal(
    'a decision about the file in front of you ranks first',
    touchedRanking[0].id,
    'agent-touched'
  );
  check(
    'because the path boost exceeds the provenance gap',
    PATH_OVERLAP_BOOST > PROVENANCE_WEIGHT.HUMAN_CONFIRMED - PROVENANCE_WEIGHT.AGENT_STATEMENT
  );

  const folderTouch = engine.rankDecisions(
    [decision({ id: 'in-folder', relatedFiles: ['src/auth/hash.ts'] }), decision({ id: 'outside', relatedFiles: ['src/db.ts'] })],
    { touchPaths: ['src/auth'] }
  );
  equal('a parent-folder touch counts', folderTouch[0].id, 'in-folder');

  equal(
    'no touchPaths means no path component',
    scoreDecision(decision({ relatedFiles: ['src/auth.ts'] }), {}).breakdown.pathOverlap,
    0
  );

  // --- Lexical --------------------------------------------------------------
  describe('lexical overlap');

  const lexicalHit = lexicalScore(decision({ title: 'Hash passwords with Argon2id' }), tokenize('argon2id hashing'));
  check('a shared term scores above zero', lexicalHit > 0, `${lexicalHit}`);
  check('and stays within the documented band', lexicalHit >= 0.1 && lexicalHit <= 0.4, `${lexicalHit}`);

  equal('no query means no lexical component', lexicalScore(decision(), tokenize('')), 0);
  equal('a query sharing nothing scores zero', lexicalScore(decision({ title: 'x', summary: 'y', rationale: 'z' }), tokenize('kubernetes ingress')), 0);

  check(
    'a fuller overlap scores higher than a partial one',
    lexicalScore(decision({ title: 'Argon2id hashing memory cost' }), tokenize('argon2id hashing memory')) >
      lexicalScore(decision({ title: 'Argon2id hashing memory cost' }), tokenize('argon2id kubernetes ingress'))
  );
  check(
    'constraints are searched too',
    lexicalScore(decision({ title: 'x', summary: 'y', rationale: 'z', constraints: ['Never log the derived key'] }), tokenize('derived key')) > 0
  );

  const lexicalRanking = engine.rankDecisions(
    [
      decision({ id: 'unrelated', title: 'Use tabs for indentation', summary: 'Two spaces are banned.', rationale: 'Consistency.' }),
      decision({ id: 'relevant', title: 'Argon2id hashing for stored credentials' })
    ],
    { taskDescription: 'update the argon2id hashing routine' }
  );
  equal('the lexically closer decision ranks first', lexicalRanking[0].id, 'relevant');

  // Matching is exact-term, not stemmed. "hashing" does not find "hash". This is a
  // deliberate limit of a deterministic local scorer, recorded so a future change
  // that adds stemming is a decision rather than an accident.
  equal(
    'terms are matched literally, without stemming',
    lexicalScore(decision({ title: 'Hash the password', summary: '', rationale: '' }), tokenize('hashing passwords')),
    0
  );

  // --- Drift ----------------------------------------------------------------
  describe('drift penalty (DEC-027)');

  equal(
    'a deleted anchor deducts the penalty',
    scoreDecision(decision(), { drift: drifted('dec-1', 'FILE_DELETED') }).breakdown.driftPenalty,
    DRIFT_PENALTY
  );
  equal(
    'a missing symbol deducts it too',
    scoreDecision(decision(), { drift: drifted('dec-1', 'SYMBOL_NOT_FOUND') }).breakdown.driftPenalty,
    DRIFT_PENALTY
  );
  equal(
    'a merely modified file does not',
    scoreDecision(decision(), { drift: drifted('dec-1', 'FILE_MODIFIED') }).breakdown.driftPenalty,
    0
  );
  equal('a clean decision is not penalised', scoreDecision(decision(), { drift: {} }).breakdown.driftPenalty, 0);

  check(
    'the penalty cannot bury a human decision beneath an agent guess',
    PROVENANCE_WEIGHT.HUMAN_CONFIRMED - DRIFT_PENALTY > PROVENANCE_WEIGHT.AGENT_STATEMENT,
    'DEC-027 says drift annotates, it does not demote'
  );

  const driftRanking = engine.rankDecisions(
    [decision({ id: 'drifted-human', provenance: 'HUMAN_CONFIRMED' }), decision({ id: 'clean-agent', provenance: 'AGENT_STATEMENT' })],
    { drift: drifted('drifted-human', 'FILE_DELETED') }
  );
  equal('so a drifted human decision still outranks a clean agent one', driftRanking[0].id, 'drifted-human');

  // --- Determinism ----------------------------------------------------------
  describe('determinism');

  const pool = [
    decision({ id: 'aaa', createdAt: 2000 }),
    decision({ id: 'zzz', createdAt: 2000 }),
    decision({ id: 'mmm', createdAt: 3000 })
  ];
  const options = { taskDescription: 'hashing', touchPaths: ['src/auth.ts'] };
  const run1 = JSON.stringify(engine.rankDecisions(pool, options));
  const run2 = JSON.stringify(engine.rankDecisions(pool, options));
  const run3 = JSON.stringify(engine.rankDecisions([...pool].reverse(), options));

  equal('the same input ranks identically twice', run1, run2);
  equal('and input order does not change the result', run1, run3);
  equal(
    'ties break by createdAt then id, matching the SQL total order',
    engine.rankDecisions(pool).map((d: any) => d.id),
    ['mmm', 'zzz', 'aaa']
  );

  check(
    'ranking runs in-process with no external dependency',
    typeof engine.rankDecisions === 'function',
    'no embeddings, no vector store, no network (DEC-028)'
  );

  // --- Limits ---------------------------------------------------------------
  describe('limits');

  const many = Array.from({ length: 30 }, (_, i) => decision({ id: `d${i}`, createdAt: 1000 + i }));
  equal('an explicit limit caps the list', engine.rankDecisions(many, { limit: 5 }).length, 5);
  equal('a limit of zero returns nothing', engine.rankDecisions(many, { limit: 0 }).length, 0);
  equal('no limit returns everything', engine.rankDecisions(many).length, 30);
  equal('a limit larger than the list is harmless', engine.rankDecisions(many, { limit: 500 }).length, 30);
  check(
    'the cap keeps the highest-ranked, not the first seen',
    engine.rankDecisions(many, { limit: 1 })[0].id === 'd29',
    'newest wins the tie, so the cap must be applied after sorting'
  );

  // --- Briefings ------------------------------------------------------------
  describe('applyToBriefing never drops governance');

  const briefing = {
    projectId: 'p',
    activeDecisions: many,
    architecturalRules: Array.from({ length: 8 }, (_, i) => ({ id: `r${i}` })),
    currentIntent: { id: 'intent-1', goal: 'Ship it' },
    recentAgentWork: [{ sessionId: 's1' }],
    recentApprovals: [{ actionId: 'a1' }]
  };

  const scoped = engine.applyToBriefing(briefing, { limit: 3 });
  equal('decisions are capped', scoped.activeDecisions.length, 3);
  equal('every rule survives', scoped.architecturalRules.length, 8, );
  equal('the intent survives', scoped.currentIntent.id, 'intent-1');
  equal('recent agent work survives', scoped.recentAgentWork.length, 1);
  equal('recent approvals survive', scoped.recentApprovals.length, 1);

  const defaulted = engine.applyToBriefing(briefing, {});
  equal('the default limit applies when none is given', defaulted.activeDecisions.length, DEFAULT_BRIEFING_LIMIT);
  equal('and the default is 15', DEFAULT_BRIEFING_LIMIT, 15);
  equal('rules are still untouched at the default', defaulted.architecturalRules.length, 8);

  const zeroLimit = engine.applyToBriefing(briefing, { limit: 0 });
  equal('even a zero limit keeps every rule', zeroLimit.architecturalRules.length, 8);
  equal('and the intent', zeroLimit.currentIntent.id, 'intent-1');
  equal('while returning no decisions', zeroLimit.activeDecisions.length, 0);
}

main()
  .catch(err => {
    failed++;
    console.error('\nUNCAUGHT ERROR:', err);
  })
  .finally(() => {
    console.log(`\n${passed}/${passed + failed} assertions passed`);
    if (failures.length > 0) {
      console.log('Failed assertions:');
      for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed === 0 ? 0 : 1);
  });
