/**
 * Tests for the Decision Explorer (P5.2-02).
 *
 * The repository has no DOM test environment, so this runs in two layers:
 *   1. Pure logic — `filterDecisions`, `anchorLabels`, `provenanceLabel`, `parseList`
 *      — called directly.
 *   2. Real rendering via `react-dom/server`, with store state set through
 *      `useMemoryStore.setState`. That covers what the pure functions cannot: that a
 *      card actually shows its constraints, that the two provenance badges render
 *      differently, and that the empty state distinguishes "nothing recorded" from
 *      "nothing matched".
 *
 * What it does NOT cover: click handlers, the collapsed-rationale toggle, and modal
 * submission, all of which need an event loop and a DOM. `useEffect` does not run
 * under renderToStaticMarkup either, so the project-change fetch is verified by
 * calling the store directly rather than through the component.
 *
 * Run:  pnpm --filter @asterim/web exec tsx src/components/memory/__tests__/DecisionExplorer.test.ts
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ArchitecturalRule, ProjectDecision, ProjectIntent } from '@asterim/shared';

// --- Environment stubs, installed before the store loads ---

(globalThis as any).localStorage = {
  store: new Map<string, string>(),
  getItem(key: string) {
    return this.store.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    this.store.set(key, value);
  },
  removeItem(key: string) {
    this.store.delete(key);
  }
};

const fetchCalls: string[] = [];
(globalThis as any).fetch = async (url: string) => {
  fetchCalls.push(url);
  const body = url.includes('/briefing')
    ? { briefing: { projectId: 'p', activeDecisions: [], architecturalRules: [], currentIntent: null, recentAgentWork: [], recentApprovals: [] } }
    : url.includes('/decisions')
      ? { decisions: [] }
      : { rules: [] };
  return { ok: true, status: 200, json: async () => body } as Response;
};

type ExplorerModule = typeof import('../DecisionExplorer');
type ModalModule = typeof import('../RecordDecisionModal');
type StoreModule = typeof import('../../../stores/useMemoryStore');

let explorer: ExplorerModule;
let modal: ModalModule;
let storeMod: StoreModule;

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

function decision(over: Partial<ProjectDecision> = {}): ProjectDecision {
  return {
    id: 'dec-1',
    projectId: 'p',
    title: 'Hash passwords with Argon2id',
    summary: 'Argon2id, 64 MiB memory cost.',
    rationale: 'Memory-hard; resists GPU attack.',
    constraints: [],
    status: 'ACTIVE',
    supersededBy: null,
    provenance: 'AGENT_STATEMENT',
    confidence: 0.75,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    relatedFiles: [],
    ...over
  };
}

function rule(over: Partial<ArchitecturalRule> = {}): ArchitecturalRule {
  return {
    id: 'rule-1',
    projectId: 'p',
    title: 'No secrets in the repo',
    statement: 'Read secrets from the environment.',
    severity: 'error',
    scopePattern: '**',
    createdAt: 1_700_000_000_000,
    ...over
  };
}

function intent(over: Partial<ProjectIntent> = {}): ProjectIntent {
  return {
    id: 'intent-1',
    projectId: 'p',
    goal: 'Migrate authentication to Argon2id',
    constraints: ['No downtime'],
    nonGoals: ['Changing the session format'],
    status: 'ACTIVE',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over
  };
}

/** Renders the explorer against the given store state and returns its markup. */
function render(state: {
  decisions?: ProjectDecision[];
  rules?: ArchitecturalRule[];
  activeIntent?: ProjectIntent | null;
  drift?: Record<string, any>;
  loading?: boolean;
  error?: string | null;
}): string {
  return renderToStaticMarkup(
    React.createElement(explorer.DecisionExplorerView, {
      projectId: 'p',
      decisions: state.decisions ?? [],
      rules: state.rules ?? [],
      activeIntent: state.activeIntent ?? null,
      briefing: null,
      drift: state.drift ?? {},
      loading: state.loading ?? false,
      error: state.error ?? null
    })
  );
}

async function main(): Promise<void> {
  explorer = await import('../DecisionExplorer');
  modal = await import('../RecordDecisionModal');
  storeMod = await import('../../../stores/useMemoryStore');

  const { filterDecisions, anchorLabels, provenanceLabel, STATUS_FILTERS } = explorer;
  const { parseList } = modal;

  // --- Filtering -------------------------------------------------------------
  describe('filterDecisions — status');

  const active = decision({ id: 'a', status: 'ACTIVE' });
  const superseded = decision({ id: 's', status: 'SUPERSEDED' });
  const archived = decision({ id: 'x', status: 'ARCHIVED' });
  const stale = decision({ id: 'l', status: 'STALE' });
  const all = [active, superseded, archived, stale];

  equal('no filter returns everything', filterDecisions(all, {}).length, 4);
  equal("'all' returns everything", filterDecisions(all, { status: 'all' }).length, 4);
  equal('ACTIVE returns only active', filterDecisions(all, { status: 'ACTIVE' }).map(d => d.id), ['a']);
  equal('SUPERSEDED returns only superseded', filterDecisions(all, { status: 'SUPERSEDED' }).map(d => d.id), ['s']);
  equal('ARCHIVED returns only archived', filterDecisions(all, { status: 'ARCHIVED' }).map(d => d.id), ['x']);
  equal('STALE returns only stale', filterDecisions(all, { status: 'STALE' }).map(d => d.id), ['l']);
  equal('every offered pill is a real filter', STATUS_FILTERS.length, 5);

  describe('filterDecisions — text search');

  const searchable = [
    decision({ id: 'title', title: 'Adopt Argon2id', summary: 'x', rationale: 'y', constraints: [] }),
    decision({ id: 'summary', title: 'x', summary: 'We chose Argon2id here', rationale: 'y', constraints: [] }),
    decision({ id: 'rationale', title: 'x', summary: 'y', rationale: 'Argon2id is memory-hard', constraints: [] }),
    decision({ id: 'constraint', title: 'x', summary: 'y', rationale: 'z', constraints: ['Never log the Argon2id key'] }),
    decision({ id: 'none', title: 'x', summary: 'y', rationale: 'z', constraints: [] })
  ];

  equal('it matches the title', filterDecisions(searchable, { query: 'Adopt' }).map(d => d.id), ['title']);
  equal('it matches the summary', filterDecisions(searchable, { query: 'chose' }).map(d => d.id), ['summary']);
  equal('it matches the rationale', filterDecisions(searchable, { query: 'memory-hard' }).map(d => d.id), ['rationale']);
  equal('it matches a constraint', filterDecisions(searchable, { query: 'Never log' }).map(d => d.id), ['constraint']);
  equal(
    'it matches across all four fields at once',
    filterDecisions(searchable, { query: 'argon2id' }).map(d => d.id),
    ['title', 'summary', 'rationale', 'constraint']
  );
  equal('search is case-insensitive', filterDecisions(searchable, { query: 'ARGON2ID' }).length, 4);
  equal('surrounding whitespace is ignored', filterDecisions(searchable, { query: '   Adopt  ' }).map(d => d.id), ['title']);
  equal('an empty query filters nothing', filterDecisions(searchable, { query: '   ' }).length, 5);
  equal('a query matching nothing returns nothing', filterDecisions(searchable, { query: 'bcrypt' }), []);

  describe('filterDecisions — file path');

  const anchored = [
    decision({ id: 'related', relatedFiles: ['src/auth.ts'] }),
    decision({ id: 'coderef', relatedFiles: [], codeRefs: [{ id: 'r', decisionId: 'coderef', filePath: 'src/session.ts', createdAt: 1 }] }),
    decision({ id: 'symbolonly', relatedFiles: [], codeRefs: [{ id: 'r2', decisionId: 'symbolonly', symbolName: 'hashPassword', createdAt: 1 }] }),
    decision({ id: 'bare', relatedFiles: [] })
  ];

  equal('it matches relatedFiles', filterDecisions(anchored, { filePath: 'src/auth.ts' }).map(d => d.id), ['related']);
  equal('it matches code-ref paths', filterDecisions(anchored, { filePath: 'session' }).map(d => d.id), ['coderef']);
  equal('a partial path matches', filterDecisions(anchored, { filePath: 'src/' }).map(d => d.id), ['related', 'coderef']);
  equal('path matching is case-insensitive', filterDecisions(anchored, { filePath: 'SRC/AUTH' }).map(d => d.id), ['related']);
  equal('a decision with no anchors never matches a path filter', filterDecisions(anchored, { filePath: 'src' }).some(d => d.id === 'bare'), false);
  equal('a symbol-only ref is not matched by path', filterDecisions(anchored, { filePath: 'hashPassword' }), []);

  describe('filterDecisions — combined');

  const combined = [
    decision({ id: 'match', status: 'ACTIVE', title: 'Argon2id', relatedFiles: ['src/auth.ts'] }),
    decision({ id: 'wrongstatus', status: 'ARCHIVED', title: 'Argon2id', relatedFiles: ['src/auth.ts'] }),
    decision({ id: 'wrongfile', status: 'ACTIVE', title: 'Argon2id', relatedFiles: ['src/other.ts'] }),
    decision({ id: 'wrongtext', status: 'ACTIVE', title: 'bcrypt', summary: '', rationale: '', relatedFiles: ['src/auth.ts'] })
  ];
  equal(
    'all three filters must hold at once',
    filterDecisions(combined, { status: 'ACTIVE', query: 'argon2id', filePath: 'auth' }).map(d => d.id),
    ['match']
  );

  // --- Anchors and provenance ------------------------------------------------
  describe('anchorLabels');

  equal(
    'a file with a symbol renders as path#symbol',
    anchorLabels(decision({ codeRefs: [{ id: 'r', decisionId: 'd', filePath: 'src/a.ts', symbolName: 'fn', createdAt: 1 }] })),
    ['src/a.ts#fn']
  );
  equal(
    'a file-only ref renders as the path',
    anchorLabels(decision({ codeRefs: [{ id: 'r', decisionId: 'd', filePath: 'src/a.ts', createdAt: 1 }] })),
    ['src/a.ts']
  );
  equal(
    'a symbol-only ref renders as the symbol',
    anchorLabels(decision({ codeRefs: [{ id: 'r', decisionId: 'd', symbolName: 'fn', createdAt: 1 }] })),
    ['fn']
  );
  equal(
    'a relatedFile already covered by a code ref is not repeated',
    anchorLabels(
      decision({
        relatedFiles: ['src/a.ts'],
        codeRefs: [{ id: 'r', decisionId: 'd', filePath: 'src/a.ts', symbolName: 'fn', createdAt: 1 }]
      })
    ),
    ['src/a.ts#fn']
  );
  equal(
    'a relatedFile with no code ref is still shown',
    anchorLabels(decision({ relatedFiles: ['src/b.ts'], codeRefs: [] })),
    ['src/b.ts']
  );
  equal('a decision with no anchors yields none', anchorLabels(decision()), []);

  describe('provenanceLabel');

  equal('an agent statement is labelled Agent with its confidence', provenanceLabel(decision()).text, 'Agent · 75%');
  equal('and is not marked as human', provenanceLabel(decision()).isHuman, false);
  equal(
    'a human-confirmed decision is labelled Human',
    provenanceLabel(decision({ provenance: 'HUMAN_CONFIRMED', confidence: 1 })).text,
    'Human · 100%'
  );
  equal(
    'and is marked as human',
    provenanceLabel(decision({ provenance: 'HUMAN_CONFIRMED', confidence: 1 })).isHuman,
    true
  );
  equal('repository evidence is labelled distinctly', provenanceLabel(decision({ provenance: 'REPOSITORY_EVIDENCE', confidence: 0.9 })).text, 'Repository · 90%');
  equal('inference is labelled distinctly', provenanceLabel(decision({ provenance: 'INFERRED', confidence: 0.3 })).text, 'Inferred · 30%');
  equal('confidence is rounded to whole percent', provenanceLabel(decision({ confidence: 0.756 })).text, 'Agent · 76%');

  describe('parseList');

  equal('newline separated', parseList('a\nb\nc'), ['a', 'b', 'c']);
  equal('comma separated', parseList('a, b, c'), ['a', 'b', 'c']);
  equal('mixed separators', parseList('a, b\nc'), ['a', 'b', 'c']);
  equal('blank entries are dropped', parseList('a\n\n , \nb'), ['a', 'b']);
  equal('an empty string yields nothing', parseList('   '), []);

  // --- Rendering -------------------------------------------------------------
  describe('render — decision card');

  const cardHtml = render({
    decisions: [
      decision({
        constraints: ['Never log the derived key'],
        relatedFiles: ['src/auth.ts'],
        codeRefs: [{ id: 'r', decisionId: 'dec-1', filePath: 'src/auth.ts', symbolName: 'hashPassword', createdAt: 1 }]
      })
    ]
  });

  check('the title is rendered', cardHtml.includes('Hash passwords with Argon2id'), cardHtml.slice(0, 200));
  check('the summary is rendered', cardHtml.includes('Argon2id, 64 MiB memory cost.'));
  check('the status badge is rendered', cardHtml.includes('ACTIVE'));
  check('constraints are rendered', cardHtml.includes('Never log the derived key'));
  check('the code anchor is rendered as path#symbol', cardHtml.includes('src/auth.ts#hashPassword'));
  check('the rationale is collapsed by default', !cardHtml.includes('resists GPU attack'), 'rationale should be hidden until expanded');
  check('a control exists to reveal it', cardHtml.includes('Why this was decided'));

  describe('render — provenance is visibly distinguished (DEC-024)');

  const agentHtml = render({ decisions: [decision({ provenance: 'AGENT_STATEMENT', confidence: 0.75 })] });
  const humanHtml = render({ decisions: [decision({ provenance: 'HUMAN_CONFIRMED', confidence: 1 })] });

  check('an agent decision shows Agent · 75%', agentHtml.includes('Agent · 75%'));
  check('a human decision shows Human · 100%', humanHtml.includes('Human · 100%'));
  check('the two render differently', agentHtml !== humanHtml);
  // Scoped to the badge: the page also has an accent-coloured "Record decision"
  // button, so asserting on the whole document would pass for the wrong reason.
  const badgeOf = (html: string, label: string): string => {
    const end = html.indexOf(label);
    if (end < 0) return '';
    const start = html.lastIndexOf('<span', end);
    return html.slice(start, end);
  };
  const agentBadge = badgeOf(agentHtml, 'Agent · 75%');
  const humanBadge = badgeOf(humanHtml, 'Human · 100%');
  check('both badges were located in the markup', agentBadge.length > 0 && humanBadge.length > 0);
  check(
    'the human badge carries the accent colour and the agent badge does not',
    humanBadge.includes('--color-accent-primary') && !agentBadge.includes('--color-accent-primary'),
    'the accent is what marks a decision as human-backed'
  );
  check('the confidence meter reflects 75%', agentHtml.includes('width:75%'), 'meter width');
  check('the confidence meter reflects 100%', humanHtml.includes('width:100%'), 'meter width');

  describe('availableActions — which lifecycle controls apply');

  const actionsMod = await import('../DecisionActions');
  const { availableActions, actionNeedsConfirmation, ACTION_LABELS } = actionsMod;

  equal(
    'an ACTIVE decision offers supersede, stale and archive',
    availableActions(decision({ status: 'ACTIVE' })),
    ['supersede', 'stale', 'archive']
  );
  equal(
    'a STALE decision offers reactivate, supersede and archive',
    availableActions(decision({ status: 'STALE' })),
    ['reactivate', 'supersede', 'archive']
  );
  equal('a SUPERSEDED decision offers nothing', availableActions(decision({ status: 'SUPERSEDED' })), []);
  equal('an ARCHIVED decision offers nothing', availableActions(decision({ status: 'ARCHIVED' })), []);
  check(
    'only ACTIVE offers "mark stale", and only STALE offers "reactivate"',
    availableActions(decision({ status: 'ACTIVE' })).includes('stale') &&
      !availableActions(decision({ status: 'ACTIVE' })).includes('reactivate') &&
      availableActions(decision({ status: 'STALE' })).includes('reactivate') &&
      !availableActions(decision({ status: 'STALE' })).includes('stale')
  );

  check('archiving asks first', actionNeedsConfirmation('archive'));
  check('superseding asks first', actionNeedsConfirmation('supersede'));
  check('marking stale applies directly', !actionNeedsConfirmation('stale'));
  check('reactivating applies directly', !actionNeedsConfirmation('reactivate'));
  equal('every action has a label', Object.keys(ACTION_LABELS).sort(), ['archive', 'reactivate', 'stale', 'supersede']);

  describe('render — lifecycle controls on cards');

  const activeCard = render({ decisions: [decision({ status: 'ACTIVE' })] });
  check('an ACTIVE card offers Supersede', activeCard.includes('Supersede'));
  check('an ACTIVE card offers Mark stale', activeCard.includes('Mark stale'));
  check('an ACTIVE card offers Archive', activeCard.includes('Archive'));
  check('and does not offer Reactivate', !activeCard.includes('Reactivate'));

  const staleCard = render({ decisions: [decision({ status: 'STALE' })] });
  check('a STALE card offers Reactivate', staleCard.includes('Reactivate'));
  check('and does not offer Mark stale', !staleCard.includes('Mark stale'));

  const archivedCard = render({ decisions: [decision({ status: 'ARCHIVED' })] });
  check('an ARCHIVED card offers no mutations', !archivedCard.includes('Supersede') && !archivedCard.includes('Archive'));
  check('but still renders the decision', archivedCard.includes('Hash passwords with Argon2id'));

  const supersededCard = render({ decisions: [decision({ status: 'SUPERSEDED', supersededBy: 'dec-9' })] });
  check('a SUPERSEDED card offers no mutations', !supersededCard.includes('Mark stale'));
  check('but keeps its lineage', supersededCard.includes('dec-9'));

  // Without a project there is nothing to act on, and the controls must not
  // render a button that would call the store with a null id.
  const noProjectCard = renderToStaticMarkup(
    React.createElement(explorer.DecisionExplorerView, {
      projectId: null,
      decisions: [decision({ status: 'ACTIVE' })],
      rules: [],
      activeIntent: null,
      briefing: null,
      loading: false,
      error: null
    })
  );
  check('no project means no lifecycle controls', !noProjectCard.includes('Mark stale'));

  describe('render — superseded relationship');

  const supersededHtml = render({
    decisions: [decision({ status: 'SUPERSEDED', supersededBy: 'dec-99' })]
  });
  check('the superseding decision is named', supersededHtml.includes('dec-99'));
  check('and labelled as superseded by', supersededHtml.includes('Superseded by'));

  const supersedesHtml = render({ decisions: [decision({ status: 'ACTIVE', supersededBy: 'dec-old' })] });
  check(
    'an ACTIVE decision carrying the same field reads as "Supersedes"',
    supersedesHtml.includes('Supersedes') && !supersedesHtml.includes('Superseded by'),
    'the field is bidirectional — see IMPLEMENTATION_DRIFT.md § 4'
  );

  describe('supersededBy resolves to a title');

  const oldDecision = decision({ id: 'old', title: 'Hash passwords with bcrypt', status: 'SUPERSEDED', supersededBy: 'new' });
  const newDecision = decision({ id: 'new', title: 'Hash passwords with Argon2id', status: 'ACTIVE', supersededBy: 'old' });
  const pairHtml = render({ decisions: [oldDecision, newDecision] });

  check('the superseded card names its replacement', pairHtml.includes('Superseded by'));
  check('and by title, not id', pairHtml.includes('Superseded by</span> <span title="new">Hash passwords with Argon2id') || pairHtml.includes('Hash passwords with Argon2id</span>'));
  check('the replacement names what it replaced', pairHtml.includes('Supersedes'));
  check('the raw id is kept as a tooltip', pairHtml.includes('title="new"') && pairHtml.includes('title="old"'));

  // The counterpart is not loaded: the id is all there is, and it should look
  // like an identifier rather than pretend to be a title.
  const orphanHtml = render({ decisions: [decision({ id: 'a', status: 'SUPERSEDED', supersededBy: 'not-loaded' })] });
  check('an unresolved link still shows the id', orphanHtml.includes('not-loaded'));
  check('and sets it in mono so it reads as an identifier', orphanHtml.includes('font-family:var(--font-family-mono)'));

  // A filtered-out counterpart must still resolve. Filtering to ACTIVE hides the
  // superseded decision entirely, so the surviving card can only name it if
  // lineage was built from the full list rather than the visible one.
  const filteredHtml = renderToStaticMarkup(
    React.createElement(explorer.DecisionExplorerView, {
      projectId: 'p',
      decisions: [oldDecision, newDecision],
      rules: [],
      activeIntent: null,
      briefing: null,
      loading: false,
      error: null,
      initialStatusFilter: 'ACTIVE' as const
    })
  );
  check(
    'the filter really hid the counterpart',
    !filteredHtml.includes('bcrypt at cost factor') && filteredHtml.includes('Showing 1 of 2'),
    'the fixture must actually be filtered for the next assertion to mean anything'
  );
  check(
    'lineage still resolves the hidden counterpart by title',
    filteredHtml.includes('Hash passwords with bcrypt'),
    'lineage must be built from the full list, not the visible one'
  );

  describe('drift badges');

  const driftFor = (worst: string, refs: any[]) => ({
    'dec-1': { decisionId: 'dec-1', drifted: true, worst, refs }
  });

  const deletedHtml = render({
    decisions: [decision()],
    drift: driftFor('FILE_DELETED', [
      { refId: 'r1', filePath: 'src/auth.ts', type: 'FILE_DELETED', detail: 'src/auth.ts no longer exists' }
    ])
  });
  check('a deleted anchor shows a caution badge', deletedHtml.includes('File missing'));
  check('the detail is available as a tooltip', deletedHtml.includes('src/auth.ts no longer exists'));
  check('and it is amber, not the error red', deletedHtml.includes('--color-state-paused'));
  check(
    'the decision still reads as ACTIVE (DEC-027)',
    deletedHtml.includes('ACTIVE'),
    'drift flags the code, it does not demote the decision'
  );

  const modifiedHtml = render({
    decisions: [decision()],
    drift: driftFor('FILE_MODIFIED', [
      { refId: 'r1', filePath: 'src/auth.ts', type: 'FILE_MODIFIED', detail: 'src/auth.ts has uncommitted changes' }
    ])
  });
  check('a modified anchor is labelled differently', modifiedHtml.includes('Code anchor modified'));
  check('and not as missing', !modifiedHtml.includes('File missing'));

  const symbolHtml = render({
    decisions: [decision()],
    drift: driftFor('SYMBOL_NOT_FOUND', [
      { refId: 'r1', filePath: 'src/auth.ts', symbolName: 'hashPassword', type: 'SYMBOL_NOT_FOUND', detail: 'hashPassword is no longer in src/auth.ts' }
    ])
  });
  check('a missing symbol is labelled distinctly', symbolHtml.includes('Symbol not found'));
  check('naming the symbol in the tooltip', symbolHtml.includes('hashPassword is no longer'));

  const multiHtml = render({
    decisions: [decision()],
    drift: driftFor('FILE_DELETED', [
      { refId: 'r1', filePath: 'a.ts', type: 'FILE_DELETED', detail: 'a.ts no longer exists' },
      { refId: 'r2', filePath: 'b.ts', type: 'FILE_MODIFIED', detail: 'b.ts has uncommitted changes' }
    ])
  });
  check('several drifted anchors are counted', multiHtml.includes('2 anchors'));
  check('and the worst is the one named', multiHtml.includes('File missing'));

  const cleanHtml = render({ decisions: [decision()], drift: {} });
  check('a clean decision shows no badge', !cleanHtml.includes('File missing') && !cleanHtml.includes('Code anchor modified'));

  const notDriftedHtml = render({
    decisions: [decision()],
    drift: { 'dec-1': { decisionId: 'dec-1', drifted: false, worst: null, refs: [] } }
  });
  check('an explicitly clean entry shows no badge', !notDriftedHtml.includes('Symbol not found'));

  // Drift arrives over HTTP, so the two fields can disagree in a way the detector
  // never produces. `drifted` is the authority; without asserting that, a badge
  // keyed only on `worst` would pass every other test here.
  const inconsistentHtml = render({
    decisions: [decision()],
    drift: {
      'dec-1': {
        decisionId: 'dec-1',
        drifted: false,
        worst: 'FILE_DELETED',
        refs: [{ refId: 'r', filePath: 'a.ts', type: 'FILE_DELETED', detail: 'gone' }]
      }
    }
  });
  check(
    'a payload claiming not-drifted shows no badge, whatever else it carries',
    !inconsistentHtml.includes('File missing'),
    'drifted is the authority, not worst'
  );

  const otherDecisionHtml = render({
    decisions: [decision({ id: 'dec-other' })],
    drift: driftFor('FILE_DELETED', [{ refId: 'r', filePath: 'x', type: 'FILE_DELETED', detail: 'gone' }])
  });
  check("another decision's drift is not shown on this card", !otherDecisionHtml.includes('File missing'));

  describe('curation controls');

  const curatable = render({ decisions: [], rules: [rule()], activeIntent: intent() });
  check('the intent panel offers Update intent', curatable.includes('Update intent'));
  check('the rules panel offers Add rule', curatable.includes('Add rule'));

  const noIntentHtml = render({ decisions: [], rules: [], activeIntent: null });
  check('with no intent the panel offers Set intent', noIntentHtml.includes('Set intent'));
  check('and explains what an intent is for', noIntentHtml.includes('No intent set'));
  check('with no rules the panel still offers Add rule', noIntentHtml.includes('Add rule'));
  check('and says why rules matter', noIntentHtml.includes('No standing rules yet'));

  const readOnlyPanels = renderToStaticMarkup(
    React.createElement(explorer.DecisionExplorerView, {
      projectId: null,
      decisions: [],
      rules: [rule()],
      activeIntent: intent(),
      briefing: null,
      loading: false,
      error: null
    })
  );
  check('without a project the intent panel is read-only', !readOnlyPanels.includes('Update intent'));
  check('and no rule can be added', !readOnlyPanels.includes('Add rule'));

  const severityHtml = render({
    decisions: [],
    rules: [rule({ id: 'r1', severity: 'error' }), rule({ id: 'r2', severity: 'info' })]
  });
  check('rule severity is shown', severityHtml.includes('error') && severityHtml.includes('info'));

  describe('render — intent and rules');

  const contextHtml = render({ decisions: [decision()], rules: [rule()], activeIntent: intent() });
  check('the current intent goal is shown', contextHtml.includes('Migrate authentication to Argon2id'));
  check('its constraints are shown', contextHtml.includes('No downtime'));
  check('its non-goals are shown', contextHtml.includes('Changing the session format'));
  check('standing rules are listed', contextHtml.includes('No secrets in the repo'));
  check('with their statement', contextHtml.includes('Read secrets from the environment.'));

  describe('render — empty and error states');

  const noneHtml = render({ decisions: [] });
  check('an empty project explains what the view is for', noneHtml.includes('Nothing has been decided here yet'));
  check('and does not claim a filter hid something', !noneHtml.includes('No decisions match'));

  const errorHtml = render({ decisions: [], error: 'Loading decisions failed (HTTP 500)' });
  check('an error is surfaced verbatim', errorHtml.includes('Loading decisions failed (HTTP 500)'));

  const loadingHtml = render({ decisions: [], loading: true });
  check('a first load shows a loading state', loadingHtml.includes('Loading project memory'));

  const noProjectHtml = renderToStaticMarkup(
    React.createElement(explorer.DecisionExplorerView, {
      projectId: null,
      decisions: [],
      rules: [],
      activeIntent: null,
      briefing: null,
      loading: false,
      error: null
    })
  );
  check('with no project selected it says so', noProjectHtml.includes('Select a project'));

  describe('render — counts');

  const countHtml = render({ decisions: [decision({ id: 'a' }), decision({ id: 'b' })], rules: [rule()] });
  check('the header counts decisions and rules', countHtml.includes('2 decisions') && countHtml.includes('1 rule'));
  const singularHtml = render({ decisions: [decision()], rules: [] });
  check('and uses the singular for one', singularHtml.includes('1 decision ·'), 'pluralisation');

  // --- Project scoping -------------------------------------------------------
  describe('project change resets and reloads');

  storeMod.useMemoryStore.setState({ projectId: 'old-project', decisions: [decision()], rules: [rule()] });
  equal('state starts populated from the previous project', storeMod.useMemoryStore.getState().decisions.length, 1);

  fetchCalls.length = 0;
  storeMod.useMemoryStore.getState().reset();
  equal('reset clears the previous project decisions', storeMod.useMemoryStore.getState().decisions, []);
  equal('reset clears the previous project rules', storeMod.useMemoryStore.getState().rules, []);
  equal('reset clears the project id', storeMod.useMemoryStore.getState().projectId, null);

  await storeMod.useMemoryStore.getState().fetchBriefing('new-project');
  await storeMod.useMemoryStore.getState().fetchDecisions('new-project');
  equal('the new project is loaded with two requests', fetchCalls.length, 2);
  check('the briefing is fetched for the new project', fetchCalls[0].includes('/projects/new-project/memory/briefing'), fetchCalls[0]);
  check('the decisions are fetched for the new project', fetchCalls[1].includes('/projects/new-project/memory/decisions'), fetchCalls[1]);
  equal('and the store now describes the new project', storeMod.useMemoryStore.getState().projectId, 'new-project');
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
