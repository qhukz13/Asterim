/**
 * Tests for the Skills Explorer UI (P6-06).
 *
 * Three layers, matching the convention the MCP and memory suites established:
 *   1. Pure helpers — `filterSkills`, `scopeTone`, `parameterPreview`,
 *      `parameterRows` — called directly.
 *   2. `useSkillsStore` against a recording `fetch`, so the exact URLs and
 *      query parameters are asserted. A wrong endpoint is the kind of mistake a
 *      build cannot catch and a mock returning data would hide.
 *   3. Real rendering through `react-dom/server`, driving the props-only views.
 *
 * What it does NOT cover: click handlers, which need an event loop and a DOM
 * the repository does not have.
 *
 * Run:  pnpm --filter @asterim/web exec tsx src/components/skills/__tests__/SkillsExplorer.test.ts
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SkillDefinition } from '@asterim/shared';

// --- Environment stubs, installed before the store loads ---

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

const requests: RecordedRequest[] = [];
let nextResponse: { status: number; body: unknown } = { status: 200, body: {} };

interface TestGlobals {
  localStorage?: unknown;
  fetch?: unknown;
  process?: { exit(code: number): void };
}
const testGlobals = globalThis as TestGlobals;

const memoryStorage = new Map<string, string>();
testGlobals.localStorage = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => memoryStorage.set(key, value),
  removeItem: (key: string) => memoryStorage.delete(key)
};
localStorage.setItem('asterim_token', 'test-token');

testGlobals.fetch = async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
  requests.push({ url, method: init?.method || 'GET', headers: init?.headers || {} });
  const { status, body } = nextResponse;
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
};

type StoreModule = typeof import('../../../stores/useSkillsStore');
type ExplorerModule = typeof import('../SkillsExplorer');
type ModalModule = typeof import('../SkillDetailModal');

let storeMod: StoreModule;
let explorer: ExplorerModule;
let modal: ModalModule;

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

// --- Fixtures ---

function skill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: 'workspace:review-diff',
    name: 'review-diff',
    description: 'Reviews a git diff against the repository conventions.',
    scope: 'workspace',
    path: '/home/dev/project/.agents/skills/review-diff',
    instructions: '# Review a diff\n\nRead it, then say what disagrees.',
    parametersSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file to review.' },
        depth: { type: 'string', enum: ['quick', 'thorough'] }
      },
      required: ['path']
    },
    scripts: ['scripts/collect.sh'],
    ...overrides
  };
}

const globalSkill = skill({
  id: 'global:scratchpad',
  name: 'scratchpad',
  description: 'A workstation-wide scratchpad procedure.',
  scope: 'global',
  path: '/home/dev/.asterim/skills/scratchpad',
  parametersSchema: undefined,
  scripts: undefined,
  instructions: 'Write it down.'
});

const noop = () => undefined;

function renderExplorer(props: Partial<Parameters<typeof explorer.SkillsExplorerView>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(explorer.SkillsExplorerView, {
      skills: [],
      isLoading: false,
      error: null,
      search: '',
      onSearch: noop,
      scopeFilter: 'all' as const,
      onScopeFilter: noop,
      ...props
    })
  );
}

async function main(): Promise<void> {
  storeMod = await import('../../../stores/useSkillsStore');
  explorer = await import('../SkillsExplorer');
  modal = await import('../SkillDetailModal');
  const { useSkillsStore, filterSkills, parameterNames, requiredParameters } = storeMod;

  // --- Pure helpers ----------------------------------------------------------
  describe('filterSkills');
  {
    const all = [skill(), globalSkill];

    equal('no filter keeps everything', filterSkills(all, '', 'all').length, 2);
    equal('the workspace scope keeps its own', filterSkills(all, '', 'workspace').length, 1);
    equal('and names it', filterSkills(all, '', 'workspace')[0].name, 'review-diff');
    equal('the global scope keeps the other', filterSkills(all, '', 'global')[0].name, 'scratchpad');

    equal('search matches the name', filterSkills(all, 'review', 'all').length, 1);
    equal('and the description', filterSkills(all, 'scratchpad procedure', 'all').length, 1);
    equal('and the path', filterSkills(all, '.asterim/skills', 'all').length, 1);
    equal('case-insensitively', filterSkills(all, 'REVIEW', 'all').length, 1);
    equal('whitespace alone is not a search', filterSkills(all, '   ', 'all').length, 2);
    equal('no match is an empty list, not everything', filterSkills(all, 'zzz', 'all').length, 0);
    equal(
      'search and scope compose',
      filterSkills(all, 'review', 'global').length,
      0
    );
  }

  describe('parameterNames and requiredParameters');
  {
    equal('every declared parameter is named', parameterNames(skill()), ['path', 'depth']);
    equal('the required ones are picked out', requiredParameters(skill()), ['path']);
    equal('a skill with no schema declares none', parameterNames(globalSkill), []);
    equal('and requires none', requiredParameters(globalSkill), []);
    equal(
      'a malformed schema is not a crash',
      parameterNames(skill({ parametersSchema: { properties: 'nope' } as never })),
      []
    );
  }

  describe('scopeTone and parameterPreview');
  {
    equal('workspace is the emerald accent', explorer.scopeTone('workspace').color, 'var(--color-state-working)');
    equal('and reads as Workspace', explorer.scopeTone('workspace').label, 'Workspace');
    equal('global is neutral', explorer.scopeTone('global').label, 'Global');

    equal('required parameters are starred', explorer.parameterPreview(skill()), 'path*, depth');
    equal('and none says so plainly', explorer.parameterPreview(globalSkill), 'No parameters');
  }

  describe('parameterRows');
  {
    const rows = modal.parameterRows(skill());
    equal('one row per parameter', rows.length, 2);
    equal('carrying the name', rows[0].name, 'path');
    equal('the type', rows[0].type, 'string');
    equal('whether it is required', rows[0].required, true);
    equal('and the description', rows[0].description, 'The file to review.');
    equal('an optional one says so', rows[1].required, false);
    check('an enum is spelled out', rows[1].description.includes('"quick"'));

    equal('a typeless property is any', modal.parameterRows(skill({
      parametersSchema: { type: 'object', properties: { x: {} } }
    }))[0].type, 'any');
    equal('a union type is joined', modal.parameterRows(skill({
      parametersSchema: { type: 'object', properties: { x: { type: ['string', 'null'] } } }
    }))[0].type, 'string | null');
    equal('no schema means no rows', modal.parameterRows(globalSkill).length, 0);

    check('the raw schema is pretty-printed', modal.describeSchema(skill()).includes('"required"'));
    equal('and its absence is stated', modal.describeSchema(globalSkill), 'This skill declares no parameters.');
  }

  // --- The store -------------------------------------------------------------
  describe('useSkillsStore — loading');
  {
    requests.length = 0;
    nextResponse = { status: 200, body: { skills: [skill(), globalSkill] } };
    await useSkillsStore.getState().loadSkills();

    equal('it asks the skills endpoint', requests[0].url, '/api/v1/skills');
    equal('with a GET', requests[0].method, 'GET');
    equal('carrying the token', requests[0].headers.Authorization, 'Bearer test-token');
    equal('and the skills land in state', useSkillsStore.getState().skills.length, 2);
    equal('loading is finished', useSkillsStore.getState().isLoading, false);

    requests.length = 0;
    await useSkillsStore.getState().loadSkills('/home/dev/project');
    equal(
      'a workspace is a query parameter',
      requests[0].url,
      '/api/v1/skills?workspacePath=%2Fhome%2Fdev%2Fproject'
    );
  }

  describe('useSkillsStore — one skill');
  {
    requests.length = 0;
    const fuller = skill({ instructions: '# The full body' });
    nextResponse = { status: 200, body: { skill: fuller } };
    const loaded = await useSkillsStore.getState().loadSkill('review-diff', '/home/dev/project');

    equal(
      'it asks for the skill by name, with the workspace',
      requests[0].url,
      '/api/v1/skills/review-diff?workspacePath=%2Fhome%2Fdev%2Fproject'
    );
    equal('and returns it', loaded?.instructions, '# The full body');
    equal(
      'the fuller copy replaces the one in the list',
      useSkillsStore.getState().skills.find(s => s.id === fuller.id)?.instructions,
      '# The full body'
    );

    // An id contains a colon, which must not become a path separator.
    requests.length = 0;
    await useSkillsStore.getState().loadSkill('global:scratchpad');
    equal('an id is encoded', requests[0].url, '/api/v1/skills/global%3Ascratchpad');
  }

  describe('useSkillsStore — failures surface the Core’s message');
  {
    nextResponse = {
      status: 400,
      body: { error: 'workspacePath must be the path of a project registered with this workstation.' }
    };
    await useSkillsStore.getState().loadSkills('/etc');
    equal(
      'the error is the server’s own',
      useSkillsStore.getState().error,
      'workspacePath must be the path of a project registered with this workstation.'
    );
    equal('and loading is not left running', useSkillsStore.getState().isLoading, false);
  }

  describe('useSkillsStore — filters are state');
  {
    useSkillsStore.getState().setSearch('review');
    equal('the search is held', useSkillsStore.getState().search, 'review');
    useSkillsStore.getState().setScopeFilter('global');
    equal('and the scope filter', useSkillsStore.getState().scopeFilter, 'global');
    useSkillsStore.getState().setActiveSkill('workspace:review-diff');
    equal('and which skill is open', useSkillsStore.getState().activeSkillId, 'workspace:review-diff');
    useSkillsStore.getState().setActiveSkill(null);
    equal('which closes again', useSkillsStore.getState().activeSkillId, null);
  }

  // --- Rendering -------------------------------------------------------------
  describe('SkillsExplorerView renders');
  {
    const empty = renderExplorer();
    check('the empty state explains what a skill is', empty.includes('No skills found'));
    check('and where to put one', empty.includes('.agents/skills'));
    check('the search box is always offered', empty.includes('Search skills'));
    check('and so is the scope filter', empty.includes('Workspace') && empty.includes('Global'));

    const html = renderExplorer({ skills: [skill(), globalSkill] });
    check('the skill name', html.includes('review-diff'));
    check('its description', html.includes('Reviews a git diff'));
    check('its scope badge', html.includes('>Workspace<'));
    check('a global skill’s badge too', html.includes('>Global<'));
    check('the parameter preview', html.includes('path*, depth'));
    check('the script count', html.includes('1 scripts'));
    check('and the path on disk', html.includes('/home/dev/project/.agents/skills/review-diff'));
    check('the count reflects the filter', html.includes('2 of 2'));

    const searched = renderExplorer({ skills: [skill(), globalSkill], search: 'scratch' });
    check('a search hides what does not match', !searched.includes('Reviews a git diff'));
    check('and keeps what does', searched.includes('scratchpad'));
    check('the count follows it', searched.includes('1 of 2'));

    const scoped = renderExplorer({ skills: [skill(), globalSkill], scopeFilter: 'global' });
    check('the scope filter hides the other scope', !scoped.includes('review-diff'));
    check('and marks itself as pressed', scoped.includes('aria-pressed="true"'));

    const noMatch = renderExplorer({ skills: [skill()], search: 'zzz' });
    check(
      'a filter matching nothing says so rather than looking empty',
      noMatch.includes('No skill matches this filter')
    );
    check('and does not claim there are no skills', !noMatch.includes('No skills found'));

    const failed = renderExplorer({ error: 'Could not reach the Core' });
    check('a load failure is shown', failed.includes('Could not reach the Core'));

    const loading = renderExplorer({ isLoading: true });
    check('and so is loading', loading.includes('Loading skills'));

    const open = renderExplorer({ skills: [skill()], openSkillId: 'workspace:review-diff' });
    check('opening a skill renders its modal', open.includes('role="dialog"'));
  }

  describe('SkillDetailModal renders');
  {
    const html = renderToStaticMarkup(
      React.createElement(modal.SkillDetailModal, { skill: skill(), onClose: noop })
    );
    check('the skill name', html.includes('review-diff'));
    check('the name an agent calls it by', html.includes('skill__review-diff'));
    check('the scope badge', html.includes('>Workspace<'));
    check('the path on disk', html.includes('/home/dev/project/.agents/skills/review-diff'));
    check('the parameter table names each parameter', html.includes('>path</td>'));
    check('marks the required one', html.includes('>Required<'));
    check('and the optional one', html.includes('>Optional<'));
    check('the instructions are rendered as markdown', html.includes('<h1>Review a diff</h1>'));
    check('not as raw markdown', !html.includes('# Review a diff'));
    check('the files it ships with are listed', html.includes('scripts/collect.sh'));
    check('and the raw schema is available', html.includes('&quot;required&quot;'));

    const bare = renderToStaticMarkup(
      React.createElement(modal.SkillDetailModal, { skill: globalSkill, onClose: noop })
    );
    check('a skill with no parameters says so', bare.includes('This skill declares no parameters'));
    check('and is marked global', bare.includes('>Global<'));

    const bodyless = renderToStaticMarkup(
      React.createElement(modal.SkillDetailModal, {
        skill: globalSkill ? { ...globalSkill, instructions: '   ' } : globalSkill,
        onClose: noop
      })
    );
    check('an empty body says so plainly', bodyless.includes('has no body below its frontmatter'));
  }
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
    testGlobals.process?.exit(failed === 0 ? 0 : 1);
  });
