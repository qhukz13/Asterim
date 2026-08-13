/**
 * Phase 5.0 end-to-end verification (P5.0-09).
 *
 * Walks the complete Project Memory Core loop in one narrative, over HTTP, against a
 * throwaway database: project creation → decision with code refs → supersede →
 * intent → rules → agent sessions and approvals → briefing → isolation.
 *
 * Unlike the two unit suites, this exercises the REST plugin and the projects plugin
 * together and asserts the loop end to end, including EventBus emission.
 *
 * ASTERIM_DATA_DIR is set before the service modules load — DatabaseService exports a
 * singleton constructed at import time, so `require` is used instead of `import`.
 *
 * Run:  pnpm --filter asterim exec tsx src/routes/__tests__/temp_phase5_e2e_verify.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-phase5-e2e-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

const Fastify = require('fastify');
const { dbService } = require('../../services/DatabaseService');
const { eventBus } = require('../../services/EventBus');
const { projectMemoryService } = require('../../services/ProjectMemoryService');
const memoryRoutes = require('../memory').default;
const projectRoutes = require('../projects').default;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`   ✓ ${label}${detail ? `  — ${detail}` : ''}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`   ✗ ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function step(n: string, title: string): void {
  console.log(`\n[${n}] ${title}`);
}

function cleanup(): void {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

async function main(): Promise<void> {
  const app = Fastify();
  await app.register(projectRoutes);
  await app.register(memoryRoutes);
  await app.ready();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: any[] = [];
  const types = [
    'memory.decision_created',
    'memory.decision_superseded',
    'memory.intent_updated',
    'memory.rule_created'
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listener = (event: any) => events.push(event);
  for (const t of types) eventBus.subscribe(t, listener);

  projectMemoryService.initEventBusListeners();

  const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload });
  const get = (url: string) => app.inject({ method: 'GET', url });

  // --- 1. Projects ---------------------------------------------------------
  step('1', 'Create two projects over REST');

  const projA = (await post('/api/v1/projects', { name: 'Alpha', path: '/tmp/alpha' })).json().project;
  const projB = (await post('/api/v1/projects', { name: 'Beta', path: '/tmp/beta' })).json().project;
  check('project Alpha created', typeof projA.id === 'string', projA.id);
  check('project Beta created', typeof projB.id === 'string', projB.id);

  // --- 2. Decision with code refs -----------------------------------------
  step('2', 'Record a decision anchored to file, symbol and commit');

  events.length = 0;
  const decisionRes = await post(`/api/v1/projects/${projA.id}/memory/decisions`, {
    title: 'Persist agent memory in SQLite',
    summary: 'Project memory lives in the existing asterim.db, not a sidecar store.',
    rationale: 'One database means one backup, one migration path, one transaction scope.',
    constraints: ['No migration framework', 'Existing databases must keep opening'],
    provenance: 'REPOSITORY_EVIDENCE',
    confidence: 0.95,
    codeRefs: [
      {
        filePath: 'apps/server/src/services/DatabaseService.ts',
        symbolName: 'DatabaseService.init',
        commitHash: 'e69d4b5'
      }
    ],
    relatedFiles: ['apps/server/src/services/ProjectMemoryService.ts']
  });

  equal('HTTP 201 on decision creation', decisionRes.statusCode, 201);
  const decision = decisionRes.json().decision;
  equal('status is ACTIVE', decision.status, 'ACTIVE');
  equal('provenance persisted', decision.provenance, 'REPOSITORY_EVIDENCE');
  equal('confidence persisted', decision.confidence, 0.95);
  equal('constraints persisted', decision.constraints.length, 2);
  equal('two code refs stored', decision.codeRefs.length, 2);

  const anchored = decision.codeRefs.find(
    (r: { symbolName?: string }) => r.symbolName === 'DatabaseService.init'
  );
  equal('code ref carries the file path', anchored.filePath, 'apps/server/src/services/DatabaseService.ts');
  equal('code ref carries the symbol', anchored.symbolName, 'DatabaseService.init');
  equal('code ref carries the commit', anchored.commitHash, 'e69d4b5');
  equal(
    'relatedFiles covers both anchors',
    [...decision.relatedFiles].sort(),
    ['apps/server/src/services/DatabaseService.ts', 'apps/server/src/services/ProjectMemoryService.ts']
  );
  equal('memory.decision_created published', events.length, 1);
  equal('event type', events[0].type, 'memory.decision_created');
  equal('event source', events[0].source, 'system:memory');

  // Relevance lookup: the question an agent asks before touching a file.
  const relevant = projectMemoryService.findRelevantDecisions(
    projA.id,
    'apps/server/src/services/DatabaseService.ts'
  );
  equal('the decision is discoverable by file path', relevant[0].id, decision.id);

  // --- 3. Supersede ---------------------------------------------------------
  step('3', 'Supersede the decision and verify both status transitions');

  events.length = 0;
  const supersedeRes = await post(
    `/api/v1/projects/${projA.id}/memory/decisions/${decision.id}/supersede`,
    {
      title: 'Persist agent memory in SQLite with WAL',
      summary: 'Same database, now in write-ahead logging mode.',
      rationale: 'Concurrent readers during agent writes.',
      provenance: 'HUMAN_CONFIRMED',
      codeRefs: [{ filePath: 'apps/server/src/services/DatabaseService.ts', symbolName: 'init' }]
    }
  );

  equal('HTTP 201 on supersede', supersedeRes.statusCode, 201);
  const replacement = supersedeRes.json().decision;
  equal('replacement is ACTIVE', replacement.status, 'ACTIVE');
  equal('replacement links to what it replaced', replacement.supersededBy, decision.id);

  const supersededList = (await get(`/api/v1/projects/${projA.id}/memory/decisions?status=SUPERSEDED`)).json();
  equal('the original is now SUPERSEDED', supersededList.decisions[0].id, decision.id);
  equal('the original points at its replacement', supersededList.decisions[0].supersededBy, replacement.id);
  equal('memory.decision_superseded published', events.length, 1);
  equal('event names the superseded decision', events[0].payload.decisionId, decision.id);
  equal('event names the replacement', events[0].payload.supersededBy, replacement.id);

  // Status transitions beyond supersede.
  const staled = projectMemoryService.updateDecisionStatus(replacement.id, 'STALE');
  equal('ACTIVE → STALE', staled.status, 'STALE');
  const archived = projectMemoryService.archiveDecision(replacement.id);
  equal('STALE → ARCHIVED', archived.status, 'ARCHIVED');
  const restored = projectMemoryService.updateDecisionStatus(replacement.id, 'ACTIVE');
  equal('ARCHIVED → ACTIVE', restored.status, 'ACTIVE');
  check('updated_at advanced across transitions', restored.updatedAt >= replacement.updatedAt);

  // --- 4. Intent ------------------------------------------------------------
  step('4', 'Set project intent twice and confirm single-active invariant');

  events.length = 0;
  const intent1 = (
    await post(`/api/v1/projects/${projA.id}/memory/intents`, {
      goal: 'Ship Project Memory Core',
      constraints: ['No new dependencies'],
      nonGoals: ['Cloud sync']
    })
  ).json().intent;
  equal('first intent is ACTIVE', intent1.status, 'ACTIVE');

  const intent2 = (
    await post(`/api/v1/projects/${projA.id}/memory/intents`, { goal: 'Ship the REST surface' })
  ).json().intent;

  const activeIntent = (await get(`/api/v1/projects/${projA.id}/memory/intents/active`)).json().intent;
  equal('the newest intent is active', activeIntent.id, intent2.id);
  equal('the previous intent was archived', projectMemoryService.getIntent(intent1.id).status, 'ARCHIVED');
  const activeCount = dbService
    .getDb()
    .prepare("SELECT COUNT(*) AS c FROM project_intents WHERE project_id = ? AND status = 'ACTIVE'")
    .get(projA.id) as { c: number };
  equal('exactly one ACTIVE intent remains', activeCount.c, 1);
  equal('two memory.intent_updated events published', events.length, 2);
  equal('the second event names its predecessor', events[1].payload.previousIntentId, intent1.id);

  // --- 5. Rules -------------------------------------------------------------
  step('5', 'Add architectural rules and list them');

  events.length = 0;
  const rule1 = (
    await post(`/api/v1/projects/${projA.id}/memory/rules`, {
      title: 'No hardcoded colors',
      statement: 'Use the CSS custom properties in tokens.css.',
      severity: 'error',
      scopePattern: 'apps/web/src/**'
    })
  ).json().rule;
  const rule2 = (
    await post(`/api/v1/projects/${projA.id}/memory/rules`, {
      title: 'Reference the Blueprint',
      statement: 'Do not duplicate Blueprint rationale into code comments.'
    })
  ).json().rule;

  equal('explicit severity persisted', rule1.severity, 'error');
  equal('severity defaults to warning', rule2.severity, 'warning');
  equal('scope pattern defaults to the schema default', rule2.scopePattern, '*');

  const rules = (await get(`/api/v1/projects/${projA.id}/memory/rules`)).json().rules;
  equal('both rules listed', rules.length, 2);
  equal('rules are newest first', rules[0].id, rule2.id);
  equal('two memory.rule_created events published', events.length, 2);

  // --- 6. Agent sessions and approvals -------------------------------------
  step('6', 'Seed agent sessions and approval gates as the runtime writes them');

  const now = 1_700_000_000_000;
  const insertSession = dbService
    .getDb()
    .prepare(
      'INSERT INTO sessions (id, project_id, thread_id, agent_type, status, pid, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
  const insertApproval = dbService
    .getDb()
    .prepare(
      'INSERT INTO approvals (id, project_id, action_id, description, command, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );

  for (let i = 0; i < 3; i++) {
    insertSession.run(`s-${i}`, projA.id, `t-${i}`, 'claude', i === 2 ? 'running' : 'exited', 100 + i, now + i * 1000, now + i * 1000 + 10);
    insertApproval.run(`ar-${i}`, projA.id, `act-${i}`, `Run migration ${i}`, `pnpm migrate ${i}`, i === 2 ? 'pending' : 'approved', now + i * 1000);
  }
  insertSession.run('s-b', projB.id, 't-b', 'aider', 'exited', 200, now, now);
  insertApproval.run('ar-b', projB.id, 'act-b', 'Beta approval', 'echo beta', 'denied', now);

  check('sessions seeded for both projects', true, '3 for Alpha, 1 for Beta');

  // --- 7. Briefing ----------------------------------------------------------
  step('7', 'Generate the project briefing');

  const briefingRes = await get(`/api/v1/projects/${projA.id}/memory/briefing`);
  equal('HTTP 200 on briefing', briefingRes.statusCode, 200);
  const briefing = briefingRes.json().briefing;

  equal('briefing carries the projectId', briefing.projectId, projA.id);
  equal('briefing lists only ACTIVE decisions', briefing.activeDecisions.length, 1);
  equal('the ACTIVE decision is the replacement', briefing.activeDecisions[0].id, replacement.id);
  equal('briefing decisions keep their code refs', briefing.activeDecisions[0].codeRefs.length, 1);
  equal('briefing lists both rules', briefing.architecturalRules.length, 2);
  equal('briefing carries the current intent', briefing.currentIntent.id, intent2.id);
  equal('briefing lists recent agent work', briefing.recentAgentWork.length, 3);
  equal('agent work is newest first', briefing.recentAgentWork[0].sessionId, 's-2');
  equal('agent work carries the live status', briefing.recentAgentWork[0].status, 'running');
  equal('agent work carries the agent type', briefing.recentAgentWork[0].agentType, 'claude');
  equal('briefing lists recent approvals', briefing.recentApprovals.length, 3);
  equal('approvals are newest first', briefing.recentApprovals[0].actionId, 'act-2');
  equal('approvals carry the command', briefing.recentApprovals[0].command, 'pnpm migrate 2');
  equal('approvals carry the outcome', briefing.recentApprovals[0].status, 'pending');

  const rerun = (await get(`/api/v1/projects/${projA.id}/memory/briefing`)).json();
  equal(
    'the briefing is deterministic across calls',
    JSON.stringify(rerun.briefing),
    JSON.stringify(briefing)
  );

  // --- 8. Project boundary isolation ---------------------------------------
  step('8', 'Confirm strict project boundary isolation');

  const bBriefing = (await get(`/api/v1/projects/${projB.id}/memory/briefing`)).json().briefing;
  equal('Beta has no decisions', bBriefing.activeDecisions, []);
  equal('Beta has no rules', bBriefing.architecturalRules, []);
  equal('Beta has no intent', bBriefing.currentIntent, null);
  equal('Beta sees only its own session', bBriefing.recentAgentWork.length, 1);
  equal('Beta session is the Beta one', bBriefing.recentAgentWork[0].sessionId, 's-b');
  equal('Beta sees only its own approval', bBriefing.recentApprovals.length, 1);
  equal('Beta approval is the Beta one', bBriefing.recentApprovals[0].actionId, 'act-b');

  check(
    'no Alpha row appears anywhere in the Beta briefing',
    !JSON.stringify(bBriefing).includes(projA.id) &&
      !JSON.stringify(bBriefing).includes(replacement.id)
  );

  const crossSupersede = await post(
    `/api/v1/projects/${projB.id}/memory/decisions/${replacement.id}/supersede`,
    { title: 't', summary: 's', rationale: 'r' }
  );
  equal('superseding across the boundary is refused', crossSupersede.statusCode, 400);

  // --- 9. Cascade -----------------------------------------------------------
  step('9', 'Delete a project and confirm memory is removed with it');

  await app.inject({ method: 'DELETE', url: `/api/v1/projects/${projA.id}` });
  const afterDelete = (await get(`/api/v1/projects/${projA.id}/memory/briefing`)).json().briefing;
  equal('decisions cascade away', afterDelete.activeDecisions, []);
  equal('rules cascade away', afterDelete.architecturalRules, []);
  equal('intent cascades away', afterDelete.currentIntent, null);
  const orphanRefs = dbService
    .getDb()
    .prepare('SELECT COUNT(*) AS c FROM decision_code_refs')
    .get() as { c: number };
  equal('code refs cascade away through their decision', orphanRefs.c, 0);
  equal(
    'session history survives deletion (sessions has no FK by design)',
    afterDelete.recentAgentWork.length,
    3
  );

  for (const t of types) eventBus.unsubscribe(t, listener);
  await app.close();
}

console.log('Phase 5.0 — Project Memory Core: end-to-end verification');

main()
  .catch(err => {
    failed++;
    console.error('\nUNCAUGHT ERROR:', err);
  })
  .finally(() => {
    cleanup();
    console.log(`\n${passed}/${passed + failed} end-to-end checks passed`);
    if (failures.length > 0) {
      console.log('Failed checks:');
      for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed === 0 ? 0 : 1);
  });
