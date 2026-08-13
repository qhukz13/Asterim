/**
 * Tests for the Memory Timeline and Re-entry Briefing (P5.2-03).
 *
 * Same two layers as DecisionExplorer.test.ts: pure logic called directly, plus
 * `react-dom/server` rendering. Both components take all data as props, so no store
 * stubbing is needed here.
 *
 * The clock is injected (`now`) rather than read from `Date.now()`, so the relative
 * ages assert exact strings instead of "something plausible".
 *
 * Run:  pnpm --filter @asterim/web exec tsx src/components/memory/__tests__/MemoryTimeline.test.ts
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  AgentWorkSummary,
  ApprovalSummary,
  ArchitecturalRule,
  ProjectBriefing,
  ProjectDecision,
  ProjectIntent
} from '@asterim/shared';

type TimelineModule = typeof import('../MemoryTimelineView');
type BriefingModule = typeof import('../ReentryBriefingCard');

let timelineMod: TimelineModule;
let briefingMod: BriefingModule;

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

/** A fixed local-time clock, so day grouping does not depend on when this runs. */
const NOW = new Date(2026, 7, 14, 12, 0, 0).getTime(); // 14 Aug 2026, local noon
const at = (dayOffset: number, hour = 12) => new Date(2026, 7, 14 - dayOffset, hour, 0, 0).getTime();

function decision(over: Partial<ProjectDecision> = {}): ProjectDecision {
  return {
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
    createdAt: at(0),
    updatedAt: at(0),
    relatedFiles: [],
    ...over
  };
}

function work(over: Partial<AgentWorkSummary> = {}): AgentWorkSummary {
  return {
    sessionId: 'sess-abcdef123456',
    threadId: 'thread-1',
    agentType: 'claude',
    status: 'stopped',
    startedAt: NOW - 7_200_000,
    updatedAt: NOW - 7_200_000,
    ...over
  };
}

function approval(over: Partial<ApprovalSummary> = {}): ApprovalSummary {
  return {
    actionId: 'act-1',
    description: 'Run database migration',
    command: 'pnpm migrate',
    status: 'approved',
    createdAt: NOW - 3_600_000,
    ...over
  };
}

function briefing(over: Partial<ProjectBriefing> = {}): ProjectBriefing {
  return {
    projectId: 'p',
    activeDecisions: [],
    architecturalRules: [],
    currentIntent: null,
    recentAgentWork: [],
    recentApprovals: [],
    ...over
  };
}

function rule(over: Partial<ArchitecturalRule> = {}): ArchitecturalRule {
  return {
    id: 'rule-1',
    projectId: 'p',
    title: 'No secrets in the repo',
    statement: 'Secrets are read from the environment; never commit them.',
    severity: 'error',
    scopePattern: '**',
    createdAt: at(3),
    ...over
  };
}

function intent(over: Partial<ProjectIntent> = {}): ProjectIntent {
  return {
    id: 'intent-1',
    projectId: 'p',
    goal: 'Migrate authentication to Argon2id',
    constraints: [],
    nonGoals: [],
    status: 'ACTIVE',
    createdAt: at(5),
    updatedAt: at(5),
    ...over
  };
}

const renderTimeline = (decisions: ProjectDecision[]) =>
  renderToStaticMarkup(React.createElement(timelineMod.MemoryTimelineView, { decisions }));

const renderBriefing = (b: ProjectBriefing | null) =>
  renderToStaticMarkup(React.createElement(briefingMod.ReentryBriefingCard, { briefing: b, now: NOW }));

async function main(): Promise<void> {
  timelineMod = await import('../MemoryTimelineView');
  briefingMod = await import('../ReentryBriefingCard');

  const { groupDecisionsByDay, buildLineage } = timelineMod;
  const { relativeTime, isPendingApproval } = briefingMod;

  // --- Day grouping ----------------------------------------------------------
  describe('groupDecisionsByDay');

  const spread = [
    decision({ id: 'today-a', createdAt: at(0, 9) }),
    decision({ id: 'today-b', createdAt: at(0, 17) }),
    decision({ id: 'yesterday', createdAt: at(1) }),
    decision({ id: 'lastweek', createdAt: at(7) })
  ];
  const groups = groupDecisionsByDay(spread);

  equal('decisions from the same day share one group', groups.length, 3);
  equal('groups are ordered newest day first', groups.map(g => g.key), ['2026-08-14', '2026-08-13', '2026-08-07']);
  equal('within a day, the newest decision comes first', groups[0].decisions.map(d => d.id), ['today-b', 'today-a']);
  equal('every decision is placed in exactly one group', groups.reduce((n, g) => n + g.decisions.length, 0), 4);
  check('each group carries a human label', groups.every(g => typeof g.label === 'string' && g.label.length > 0));
  equal('an empty list yields no groups', groupDecisionsByDay([]), []);

  // Fed deliberately out of order: `spread` above is already newest-first, so it
  // would pass on Map insertion order alone and prove nothing about the sort.
  equal(
    'groups are sorted, not merely kept in arrival order',
    groupDecisionsByDay([
      decision({ id: 'oldest', createdAt: at(7) }),
      decision({ id: 'newest', createdAt: at(0) }),
      decision({ id: 'middle', createdAt: at(1) })
    ]).map(g => g.key),
    ['2026-08-14', '2026-08-13', '2026-08-07']
  );

  // A decision recorded late in the local evening belongs to that local day, even
  // though its UTC date has already rolled over.
  const lateEvening = new Date(2026, 7, 14, 23, 30, 0).getTime();
  equal(
    'a late-evening decision groups under the local day',
    groupDecisionsByDay([decision({ id: 'late', createdAt: lateEvening })])[0].key,
    '2026-08-14'
  );

  equal(
    'ties on timestamp are broken deterministically by id',
    groupDecisionsByDay([
      decision({ id: 'aaa', createdAt: at(0) }),
      decision({ id: 'zzz', createdAt: at(0) })
    ])[0].decisions.map(d => d.id),
    ['zzz', 'aaa']
  );

  // --- Supersession lineage --------------------------------------------------
  describe('buildLineage');

  const old = decision({ id: 'old', title: 'Hash passwords with bcrypt', status: 'SUPERSEDED', supersededBy: 'new' });
  const replacement = decision({ id: 'new', title: 'Hash passwords with Argon2id', status: 'ACTIVE', supersededBy: 'old' });
  const lineage = buildLineage([old, replacement]);

  equal('a superseded decision points forward to its replacement', lineage.get('old')?.replacedBy?.id, 'new');
  equal('and resolves the replacement title', lineage.get('old')?.replacedBy?.title, 'Hash passwords with Argon2id');
  equal('the replacement points back at what it replaced', lineage.get('new')?.replaces?.id, 'old');
  equal('and resolves that title', lineage.get('new')?.replaces?.title, 'Hash passwords with bcrypt');
  check('the two directions are not confused', lineage.get('old')?.replaces === undefined && lineage.get('new')?.replacedBy === undefined);

  const orphan = buildLineage([decision({ id: 'a', status: 'SUPERSEDED', supersededBy: 'not-loaded' })]);
  equal('an unloaded counterpart falls back to the id', orphan.get('a')?.replacedBy?.title, 'not-loaded');
  equal('and is marked unresolved', orphan.get('a')?.replacedBy?.resolved, false);

  equal('a decision with no link has no lineage entry', buildLineage([decision()]).size, 0);

  // --- Timeline rendering ----------------------------------------------------
  describe('render — timeline');

  const timelineHtml = renderTimeline([old, replacement]);
  check('both decisions are rendered', timelineHtml.includes('Hash passwords with bcrypt') && timelineHtml.includes('Hash passwords with Argon2id'));
  check('the superseded entry says what replaced it', timelineHtml.includes('Replaced by'));
  check('the replacement says what it replaced', timelineHtml.includes('Replaces'));
  check('the superseded title is struck through', timelineHtml.includes('line-through'));
  check('statuses are shown', timelineHtml.includes('SUPERSEDED') && timelineHtml.includes('ACTIVE'));
  check('provenance is carried into the timeline', timelineHtml.includes('Agent · 75%'));

  const anchoredHtml = renderTimeline([
    decision({ relatedFiles: ['src/auth.ts'], codeRefs: [{ id: 'r', decisionId: 'dec-1', filePath: 'src/auth.ts', symbolName: 'hash', createdAt: 1 }] })
  ]);
  check('anchors are shown on a timeline entry', anchoredHtml.includes('src/auth.ts#hash'));

  const groupedHtml = renderTimeline(spread);
  check('day headings are rendered', /2026/.test(groupedHtml), 'expected a date heading containing the year');

  const emptyTimeline = renderTimeline([]);
  check('an empty timeline explains itself', emptyTimeline.includes('No history yet'));
  check('and does not render a stray rail', !emptyTimeline.includes('Replaced by'));

  // --- relativeTime ----------------------------------------------------------
  describe('relativeTime');

  equal('under a minute reads as just now', relativeTime(NOW - 30_000, NOW), 'just now');
  equal('minutes', relativeTime(NOW - 5 * 60_000, NOW), '5m ago');
  equal('just under an hour stays in minutes', relativeTime(NOW - 59 * 60_000, NOW), '59m ago');
  equal('hours', relativeTime(NOW - 3 * 3_600_000, NOW), '3h ago');
  equal('just under a day stays in hours', relativeTime(NOW - 23 * 3_600_000, NOW), '23h ago');
  equal('days', relativeTime(NOW - 5 * 86_400_000, NOW), '5d ago');
  equal('months', relativeTime(NOW - 65 * 86_400_000, NOW), '2mo ago');
  equal('a future timestamp does not read as negative', relativeTime(NOW + 60_000, NOW), 'just now');

  describe('isPendingApproval');

  check('pending is pending', isPendingApproval(approval({ status: 'pending' })));
  check('approved is not', !isPendingApproval(approval({ status: 'approved' })));
  check('denied is not', !isPendingApproval(approval({ status: 'denied' })));
  check('expired is not', !isPendingApproval(approval({ status: 'expired' })));

  // --- Briefing rendering ----------------------------------------------------
  describe('render — re-entry briefing');

  const full = renderBriefing(
    briefing({
      currentIntent: intent(),
      architecturalRules: [rule()],
      activeDecisions: [decision(), decision({ id: 'd2' })],
      recentAgentWork: [
        work({ sessionId: 'sess-running0001', agentType: 'claude', status: 'running', updatedAt: NOW - 300_000 }),
        work({ sessionId: 'sess-stopped0002', agentType: 'aider', status: 'stopped', updatedAt: NOW - 86_400_000 })
      ],
      recentApprovals: [
        approval({ actionId: 'a1', description: 'Run database migration', status: 'pending', createdAt: NOW - 600_000 }),
        approval({ actionId: 'a2', description: 'Force push to main', status: 'denied', createdAt: NOW - 172_800_000 })
      ]
    })
  );

  check('the current intent is shown', full.includes('Migrate authentication to Argon2id'));
  check('the active decision count is shown', full.includes('2 active decisions'));
  check('the rule count is shown', full.includes('1 standing rule'));
  check('the rule statement is shown', full.includes('Secrets are read from the environment'));

  check('agent types are listed', full.includes('claude') && full.includes('aider'));
  check('session status is shown', full.includes('running') && full.includes('stopped'));
  check('session ids are abbreviated', full.includes('sess-run'), 'expected the first 8 characters');
  check('agent work carries a relative age', full.includes('5m ago') && full.includes('1d ago'));

  check('approval descriptions are listed', full.includes('Run database migration') && full.includes('Force push to main'));
  check('approval outcomes are shown', full.includes('pending') && full.includes('denied'));
  check('a pending approval is called out', full.includes('1 still waiting'));
  check('approvals carry a relative age', full.includes('10m ago') && full.includes('2d ago'));

  describe('render — briefing edge cases');

  const bare = renderBriefing(briefing());
  check('no intent is stated rather than left blank', bare.includes('No intent has been set'));
  check('no agent work is stated', bare.includes('No agent has run in this project yet'));
  check('no approvals is stated', bare.includes('Nothing has needed approval yet'));
  check('an empty project claims no pending approvals', !bare.includes('still waiting'));
  equal('the counts pluralise correctly at zero', bare.includes('0 active decisions') && bare.includes('0 standing rules'), true);

  const singular = renderBriefing(briefing({ activeDecisions: [decision()], architecturalRules: [rule()] }));
  check('and in the singular at one', singular.includes('1 active decision ·') && singular.includes('1 standing rule'));

  const manyRules = renderBriefing(
    briefing({ architecturalRules: [rule({ id: 'r1' }), rule({ id: 'r2' }), rule({ id: 'r3' }), rule({ id: 'r4' }), rule({ id: 'r5' })] })
  );
  check('a long rule list is truncated with a count', manyRules.includes('and 2 more'));

  check('a null briefing renders a placeholder rather than crashing', renderBriefing(null).includes('No briefing loaded'));

  // --- Mode integration ------------------------------------------------------
  describe('the Memory view switches between explorer and timeline');

  const explorerMod = await import('../DecisionExplorer');
  const viewProps = {
    projectId: 'p',
    decisions: [old, replacement],
    rules: [rule()],
    activeIntent: intent(),
    briefing: briefing({ recentAgentWork: [work()], recentApprovals: [approval()] }),
    loading: false,
    error: null
  };

  const explorerHtml = renderToStaticMarkup(
    React.createElement(explorerMod.DecisionExplorerView, { ...viewProps, initialMode: 'explorer' as const })
  );
  const timelineModeHtml = renderToStaticMarkup(
    React.createElement(explorerMod.DecisionExplorerView, { ...viewProps, initialMode: 'timeline' as const })
  );

  check('explorer mode shows the filter bar', explorerHtml.includes('Search decisions'));
  check('explorer mode does not show the briefing', !explorerHtml.includes('Where this project stands'));
  check('timeline mode shows the re-entry briefing', timelineModeHtml.includes('Where this project stands'));
  check('timeline mode shows lineage', timelineModeHtml.includes('Replaced by'));
  check('timeline mode drops the filter bar', !timelineModeHtml.includes('Search decisions'));
  check('both modes offer the toggle', explorerHtml.includes('timeline') && timelineModeHtml.includes('explorer'));
  check('both modes keep the Record button', explorerHtml.includes('Record decision') && timelineModeHtml.includes('Record decision'));
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
    (globalThis as { process?: { exit(code: number): void } }).process?.exit(failed === 0 ? 0 : 1);
  });
