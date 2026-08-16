/**
 * Tests for the Agent Profiles UI (P6-07).
 *
 * Three layers, matching the convention the MCP and skills suites established:
 *   1. Pure helpers — `filterProfiles`, `capabilitySummary`, `activeProfileFor`,
 *      the draft functions — called directly.
 *   2. `useProfileStore` against a recording `fetch`, so the exact URLs, methods
 *      and bodies are asserted. A wrong verb on the update route is the kind of
 *      mistake a build cannot catch and a mock returning data would hide.
 *   3. Real rendering through `react-dom/server`, driving the props-only views.
 *
 * What it does NOT cover: click handlers, which need an event loop and a DOM
 * the repository does not have.
 *
 * Run:  pnpm --filter @asterim/web exec tsx src/components/profiles/__tests__/ProfileSelector.test.ts
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentProfile } from '@asterim/shared';

// --- Environment stubs, installed before the store loads ---

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
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

testGlobals.fetch = async (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => {
  requests.push({
    url,
    method: init?.method || 'GET',
    headers: init?.headers || {},
    body: init?.body ? JSON.parse(init.body) : undefined
  });
  const { status, body } = nextResponse;
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
};

type StoreModule = typeof import('../../../stores/useProfileStore');
type SelectorModule = typeof import('../ProfileSelector');
type ManagerModule = typeof import('../ProfileManagerModal');

let storeMod: StoreModule;
let selector: SelectorModule;
let manager: ManagerModule;

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

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'builtin-security-auditor',
    name: 'Security Auditor',
    role: 'Security Auditor',
    description: 'Audits for injection, path traversal and broken authorization.',
    systemPrompt: 'You are a security auditor. Look for the traversal.',
    enabledSkills: [],
    autoApprovalRules: [],
    isBuiltin: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

const custom = profile({
  id: 'custom-1',
  name: 'House Reviewer',
  role: 'Frontend Reviewer',
  description: 'Our own review checklist.',
  systemPrompt: 'Check the tokens first.',
  model: 'claude-opus-5',
  temperature: 0.2,
  enabledMcpServers: ['filesystem', 'memory'],
  enabledSkills: undefined,
  autoApprovalRules: ['git status'],
  isBuiltin: false
});

const noop = () => undefined;

function renderSelector(props: Partial<Parameters<typeof selector.ProfileSelectorView>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(selector.ProfileSelectorView, {
      profiles: [],
      activeProfile: null,
      onSelect: noop,
      onManage: noop,
      ...props
    })
  );
}

function renderManager(props: Partial<Parameters<typeof manager.ProfileManagerModalView>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(manager.ProfileManagerModalView, {
      profiles: [],
      search: '',
      onSearch: noop,
      selectedId: null,
      onSelect: noop,
      onClose: noop,
      ...props
    })
  );
}

async function main(): Promise<void> {
  storeMod = await import('../../../stores/useProfileStore');
  selector = await import('../ProfileSelector');
  manager = await import('../ProfileManagerModal');
  const {
    useProfileStore,
    filterProfiles,
    capabilitySummary,
    activeProfileFor,
    activeProfileIdForThread
  } = storeMod;

  // --- Pure helpers ----------------------------------------------------------
  describe('filterProfiles');
  {
    const all = [profile(), custom];
    equal('no filter keeps everything', filterProfiles(all, '').length, 2);
    equal('whitespace alone is not a search', filterProfiles(all, '   ').length, 2);
    equal('the name matches', filterProfiles(all, 'house').length, 1);
    equal('the role matches', filterProfiles(all, 'frontend')[0].id, 'custom-1');
    equal('the description matches', filterProfiles(all, 'traversal')[0].id, 'builtin-security-auditor');
    equal('case-insensitively', filterProfiles(all, 'SECURITY').length, 1);
    equal('no match is an empty list, not everything', filterProfiles(all, 'zzz').length, 0);
  }

  describe('capabilitySummary keeps unset and empty apart');
  {
    equal('an unset list is all', capabilitySummary(undefined, 'servers'), 'All servers');
    equal('a wildcard is all', capabilitySummary(['*'], 'servers'), 'All servers');
    equal('an empty list is none, not all', capabilitySummary([], 'skills'), 'No skills');
    equal('a named list is named', capabilitySummary(['a', 'b'], 'servers'), 'a, b');
  }

  describe('activeProfileFor');
  {
    const all = [profile(), custom];
    const byThread = { 't1': 'custom-1', 't2': null, 't3': 'deleted-profile' };
    equal('a thread with a profile resolves it', activeProfileFor(all, byThread, 't1')?.id, 'custom-1');
    equal('a thread with none resolves to null', activeProfileFor(all, byThread, 't2'), null);
    equal('a stale id resolves to null rather than throwing', activeProfileFor(all, byThread, 't3'), null);
    equal('and no thread at all is null', activeProfileFor(all, byThread, null), null);
  }

  describe('list modes round-trip');
  {
    const { listModeOf, parseListInput } = manager;
    equal('unset is all', listModeOf(undefined), 'all');
    equal('a wildcard is all', listModeOf(['*']), 'all');
    equal('empty is none', listModeOf([]), 'none');
    equal('named is a list', listModeOf(['a']), 'list');

    equal('all becomes unset', parseListInput('all', 'ignored'), undefined);
    equal('none becomes empty', parseListInput('none', 'ignored'), []);
    equal('a list is split and trimmed', parseListInput('list', ' a , b '), ['a', 'b']);
    equal('empty entries are dropped', parseListInput('list', 'a,,b,'), ['a', 'b']);
  }

  describe('drafts');
  {
    const { draftFromProfile, emptyDraft, validateDraft, draftToInput } = manager;

    const draft = draftFromProfile(custom);
    equal('the name comes across', draft.name, 'House Reviewer');
    equal('the prompt comes across', draft.systemPrompt, 'Check the tokens first.');
    equal('a number becomes text for the field', draft.temperature, '0.2');
    equal('a named server list becomes a list mode', draft.mcpMode, 'list');
    equal('with its names', draft.mcpText, 'filesystem, memory');
    equal('an unset skill list becomes all', draft.skillMode, 'all');

    const auditorDraft = draftFromProfile(profile());
    equal('an empty list becomes none, not all', auditorDraft.skillMode, 'none');
    equal('and carries no text', auditorDraft.skillText, '');
    equal('an absent temperature is an empty field, not "undefined"', auditorDraft.temperature, '');

    equal('a fresh draft is empty', emptyDraft().name, '');
    equal('and unrestricted', emptyDraft().mcpMode, 'all');

    equal('a complete draft validates', validateDraft(draft), null);
    equal('a missing name is caught', validateDraft({ ...draft, name: ' ' }), 'A name is required.');
    equal('a missing role is caught', validateDraft({ ...draft, role: '' }), 'A role is required.');
    equal(
      'a missing description is caught',
      validateDraft({ ...draft, description: '' }),
      'A description is required.'
    );
    equal(
      'a missing prompt is caught',
      validateDraft({ ...draft, systemPrompt: '' }),
      'A system prompt is required.'
    );
    equal(
      'a non-numeric temperature is caught',
      validateDraft({ ...draft, temperature: 'warm' }),
      'Temperature must be a number.'
    );
    equal(
      'an out-of-range temperature is caught',
      validateDraft({ ...draft, temperature: '5' }),
      'Temperature must be between 0 and 2.'
    );
    equal('but an empty one is allowed', validateDraft({ ...draft, temperature: '' }), null);

    const input = draftToInput(draft);
    equal('the payload carries the trimmed name', input.name, 'House Reviewer');
    equal('the temperature becomes a number', input.temperature, 0.2);
    equal('the server list is parsed', input.enabledMcpServers, ['filesystem', 'memory']);
    equal('an "all" skill list is sent as unset', input.enabledSkills, undefined);
    equal('the approval rules are split', input.autoApprovalRules, ['git status']);
    equal(
      'a "none" list is sent as empty rather than omitted',
      draftToInput({ ...draft, skillMode: 'none' }).enabledSkills,
      []
    );
    equal('an empty model is omitted', draftToInput({ ...draft, model: '  ' }).model, undefined);
  }

  describe('originTone and selectorSummary');
  {
    equal('a built-in reads as built-in', selector.originTone(profile()).label, 'Built-in');
    equal('a custom one as custom', selector.originTone(custom).label, 'Custom');
    equal('and custom takes the accent', selector.originTone(custom).color, 'var(--color-state-working)');

    equal('the summary names the role', selector.selectorSummary(custom), 'Frontend Reviewer');
    check(
      'and with no profile explains what that means',
      selector.selectorSummary(null).includes('default instructions')
    );
  }

  // --- The store -------------------------------------------------------------
  describe('useProfileStore — loading');
  {
    requests.length = 0;
    nextResponse = { status: 200, body: { profiles: [profile(), custom] } };
    await useProfileStore.getState().loadProfiles();

    equal('it asks the profiles endpoint', requests[0].url, '/api/v1/profiles');
    equal('with a GET', requests[0].method, 'GET');
    equal('carrying the token', requests[0].headers.Authorization, 'Bearer test-token');
    equal('and the profiles land in state', useProfileStore.getState().profiles.length, 2);
    equal('loading is finished', useProfileStore.getState().isLoading, false);

    requests.length = 0;
    await useProfileStore.getState().loadProfiles('ws-a');
    equal('a workspace is a query parameter', requests[0].url, '/api/v1/profiles?workspaceId=ws-a');
  }

  describe('useProfileStore — creating and cloning');
  {
    requests.length = 0;
    const made = profile({ id: 'custom-2', name: 'Release Captain', isBuiltin: false });
    nextResponse = { status: 201, body: { profile: made } };
    const created = await useProfileStore.getState().createProfile({
      name: 'Release Captain',
      role: 'Release Manager',
      description: 'Cuts releases.',
      systemPrompt: 'Check the changelog.'
    });

    equal('it posts to the collection', requests[0].url, '/api/v1/profiles');
    equal('with a POST', requests[0].method, 'POST');
    equal('declaring JSON', requests[0].headers['Content-Type'], 'application/json');
    equal('and the body it was given', (requests[0].body as { role: string }).role, 'Release Manager');
    equal('the created profile comes back', created?.id, 'custom-2');
    check(
      'and joins the list',
      useProfileStore.getState().profiles.some(p => p.id === 'custom-2')
    );

    requests.length = 0;
    const clone = profile({ id: 'custom-3', name: 'Security Auditor (copy)', isBuiltin: false });
    nextResponse = { status: 201, body: { profile: clone } };
    await useProfileStore.getState().cloneProfile('builtin-security-auditor');
    equal('cloning posts to the same collection', requests[0].url, '/api/v1/profiles');
    equal(
      'naming the source rather than echoing its prompt',
      (requests[0].body as { cloneOf: string }).cloneOf,
      'builtin-security-auditor'
    );
    equal('and sends no prompt of its own', (requests[0].body as { systemPrompt?: string }).systemPrompt, undefined);
  }

  describe('useProfileStore — updating');
  {
    requests.length = 0;
    nextResponse = { status: 200, body: { profile: { ...custom, description: 'Revised.' } } };
    await useProfileStore.getState().updateProfile('custom-1', { description: 'Revised.' });

    equal('it addresses the profile', requests[0].url, '/api/v1/profiles/custom-1');
    equal('with a PUT', requests[0].method, 'PUT');
    equal(
      'the list adopts the returned copy',
      useProfileStore.getState().profiles.find(p => p.id === 'custom-1')?.description,
      'Revised.'
    );

    // An id could hold a character that must not become a path separator.
    requests.length = 0;
    nextResponse = { status: 200, body: { profile: custom } };
    await useProfileStore.getState().updateProfile('a/b', { name: 'x' });
    equal('an id is encoded', requests[0].url, '/api/v1/profiles/a%2Fb');
  }

  describe('useProfileStore — deleting releases the threads that used it');
  {
    useProfileStore.getState().setActiveProfile('thread-1', 'custom-2');
    useProfileStore.getState().setActiveProfile('thread-2', 'custom-1');
    useProfileStore.getState().setInspectedProfile('custom-2');

    requests.length = 0;
    nextResponse = { status: 200, body: { deleted: true } };
    const ok = await useProfileStore.getState().deleteProfile('custom-2');

    equal('it addresses the profile', requests[0].url, '/api/v1/profiles/custom-2');
    equal('with a DELETE', requests[0].method, 'DELETE');
    equal('and reports success', ok, true);
    check(
      'the profile leaves the list',
      !useProfileStore.getState().profiles.some(p => p.id === 'custom-2')
    );
    equal(
      'the thread that used it is released',
      useProfileStore.getState().activeByThread['thread-1'],
      null
    );
    equal(
      'a thread using another profile is untouched',
      useProfileStore.getState().activeByThread['thread-2'],
      'custom-1'
    );
    equal('and the detail pane closes', useProfileStore.getState().inspectedProfileId, null);
  }

  describe('useProfileStore — failures surface the Core’s message');
  {
    nextResponse = {
      status: 409,
      body: { error: "'Security Auditor' is a built-in profile and cannot be edited." }
    };
    const refused = await useProfileStore.getState().updateProfile('builtin-security-auditor', {
      name: 'Mine'
    });
    equal('the call reports failure', refused, null);
    equal(
      'the error is the server’s own',
      useProfileStore.getState().error,
      "'Security Auditor' is a built-in profile and cannot be edited."
    );
    equal('and saving is not left running', useProfileStore.getState().isSaving, false);

    nextResponse = { status: 500, body: {} };
    await useProfileStore.getState().loadProfiles();
    check(
      'a bodyless failure still says what was being done',
      (useProfileStore.getState().error || '').includes('Loading agent profiles')
    );
  }

  describe('useProfileStore — the active profile is per thread');
  {
    useProfileStore.getState().setActiveProfile('thread-a', 'custom-1');
    useProfileStore.getState().setActiveProfile('thread-b', null);
    equal('one thread holds its own', activeProfileIdForThread('thread-a'), 'custom-1');
    equal('another is unaffected', activeProfileIdForThread('thread-b'), undefined);
    equal('an unknown thread has none', activeProfileIdForThread('thread-z'), undefined);
    equal('and no thread at all has none', activeProfileIdForThread(null), undefined);

    useProfileStore.getState().setSearch('auditor');
    equal('the search is held', useProfileStore.getState().search, 'auditor');
    useProfileStore.getState().setInspectedProfile('custom-1');
    equal('and which profile is open', useProfileStore.getState().inspectedProfileId, 'custom-1');
  }

  // --- Rendering -------------------------------------------------------------
  describe('ProfileSelectorView renders');
  {
    const empty = renderSelector();
    check('the control is labelled', empty.includes('Agent Profile'));
    check('the default is a real option', empty.includes('Default (no profile)'));
    check('and the absence is explained', empty.includes('default instructions'));

    const listed = renderSelector({ profiles: [profile(), custom] });
    check('every profile is offered', listed.includes('Security Auditor') && listed.includes('House Reviewer'));

    const active = renderSelector({ profiles: [profile(), custom], activeProfile: custom });
    check('the active role is shown', active.includes('Frontend Reviewer'));
    check('with its origin badge', active.includes('>Custom<'));
    check('the selection is bound to the control', active.includes('value="custom-1"'));
    check('and it says when the choice takes effect', active.includes('next session'));

    const builtinActive = renderSelector({ profiles: [profile()], activeProfile: profile() });
    check('a built-in is badged as one', builtinActive.includes('>Built-in<'));

    const noThread = renderSelector({ disabled: true });
    check('with no thread the control is disabled', noThread.includes('disabled=""'));

    const failed = renderSelector({ error: 'Could not reach the Core' });
    check('a load failure is shown', failed.includes('Could not reach the Core'));
    check('as an alert', failed.includes('role="alert"'));

    const open = renderSelector({ isManagerOpen: true });
    check('opening the manager renders its dialog', open.includes('role="dialog"'));
  }

  describe('ProfileManagerModalView renders');
  {
    const empty = renderManager();
    check('it is a modal dialog', empty.includes('aria-modal="true"'));
    check('titled', empty.includes('Agent Profiles'));
    check('offering a new profile', empty.includes('New profile'));
    check('a search box', empty.includes('Search profiles'));
    check('and saying there is nothing yet', empty.includes('No profiles found'));

    const listed = renderManager({ profiles: [profile(), custom] });
    check('the catalogue names each profile', listed.includes('Security Auditor'));
    check('with its role', listed.includes('Frontend Reviewer'));
    check('its origin badge', listed.includes('>Built-in<') && listed.includes('>Custom<'));
    check('and nothing is selected yet', listed.includes('Select a profile'));

    const searched = renderManager({ profiles: [profile(), custom], search: 'house' });
    check('a search hides what does not match', !searched.includes('Audits for injection'));
    const noMatch = renderManager({ profiles: [profile()], search: 'zzz' });
    check(
      'a filter matching nothing says so rather than looking empty',
      noMatch.includes('No profile matches this filter')
    );
    check('and does not claim there are no profiles', !noMatch.includes('No profiles found'));

    const inspected = renderManager({
      profiles: [profile(), custom],
      selectedId: 'builtin-security-auditor'
    });
    check('the prompt is shown in full', inspected.includes('Look for the traversal'));
    check('the capability summary keeps empty apart from all', inspected.includes('Skills: No skills'));
    check('an unset server list reads as all', inspected.includes('MCP: All servers'));
    check('a built-in offers Clone', inspected.includes('>Clone<'));
    check('and says why it cannot be edited', inspected.includes('cannot be edited'));
    check('so it offers no Delete', !inspected.includes('>Delete<'));

    const editable = renderManager({ profiles: [profile(), custom], selectedId: 'custom-1' });
    check('a custom profile offers Edit', editable.includes('>Edit<'));
    check('and Delete', editable.includes('>Delete<'));
    check('its model is shown', editable.includes('Model: claude-opus-5'));
    check('and its named servers', editable.includes('MCP: filesystem, memory'));

    const editing = renderManager({
      profiles: [profile(), custom],
      selectedId: 'custom-1',
      draft: manager.draftFromProfile(custom)
    });
    check('the form names what is being edited', editing.includes('Editing House Reviewer'));
    check('the prompt is editable', editing.includes('Check the tokens first.'));
    check('the capability mode is a control', editing.includes('MCP servers access'));
    check('with the names alongside it', editing.includes('filesystem, memory'));
    check('and Save is offered', editing.includes('Save profile'));

    const creating = renderManager({ draft: manager.emptyDraft() });
    check('a fresh form is titled as new', creating.includes('New profile'));

    const saving = renderManager({ draft: manager.emptyDraft(), isSaving: true });
    check('saving is visible', saving.includes('Saving…'));

    const failedSave = renderManager({ error: 'A role is required.' });
    check('a validation message is shown', failedSave.includes('A role is required.'));
    check('as an alert', failedSave.includes('role="alert"'));
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
