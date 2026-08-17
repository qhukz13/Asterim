/**
 * Tests for the Environment Secrets & Workstation Security UI (P9-03).
 *
 * Three layers, matching the convention the profiles and delegation suites
 * established:
 *   1. Pure helpers — `validateSecretKey`, `describeSecretError`,
 *      `vaultHealthOf`, `formatSecretDate` — called directly. The key rules are
 *      the same constants the Core enforces, so a disagreement between the two
 *      sides would be a bug this layer catches without a server.
 *   2. `useSecretStore` against a recording `fetch`, so the exact URLs, methods
 *      and bodies are asserted. A masked value silently kept in state, or a
 *      DELETE that did not encode its key, is the kind of mistake a build cannot
 *      catch and a mock returning data would hide.
 *   3. Real rendering through `react-dom/server`, driving the props-only views.
 *      The assertion that matters most lives here: a credential passed through
 *      the store never appears in the markup.
 *
 * What it does NOT cover: click handlers, which need an event loop and a DOM
 * the repository does not have. The connected components are thin wrappers over
 * the views and the store, both of which are covered directly.
 *
 * Run:  pnpm --filter @asterim/web exec tsx src/components/environment/__tests__/EnvironmentSecretsUI.test.ts
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EnvironmentSecretSummary, VaultStatusResponse } from '@asterim/shared';

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

type StoreModule = typeof import('../../../stores/useSecretStore');
type PanelModule = typeof import('../EnvironmentSecretsPanel');
type CardModule = typeof import('../../security/SecurityStatusCard');

let storeMod: StoreModule;
let panel: PanelModule;
let card: CardModule;

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

const MASK = '••••••••';
/** Stands in for a real credential. Nothing rendered may ever contain it. */
const PLAINTEXT = 'ghp_liveTokenThatMustNeverBeRendered_9f3aa1c4';

function secret(overrides: Partial<EnvironmentSecretSummary> = {}): EnvironmentSecretSummary {
  return {
    key: 'DEPLOY_TOKEN',
    maskedValue: MASK,
    isSet: true,
    createdAt: Date.UTC(2026, 7, 17, 12, 0, 0),
    ...overrides
  };
}

function vaultStatus(overrides: Partial<VaultStatusResponse['vault']> = {}, healthy = true): VaultStatusResponse {
  return {
    vault: {
      ready: true,
      algorithm: 'AES-256-GCM',
      keyDerivation: 'PBKDF2-HMAC-SHA512',
      iterations: 100_000,
      ivBytes: 12,
      authTagBytes: 16,
      envelopeVersion: 'v1',
      saltPresent: true,
      managedKeys: ['ai_api_key', 'vapid_keys', 'jwt_secret'],
      encryptedKeys: 3,
      plaintextKeys: 0,
      unreadableKeys: 0,
      migrationComplete: true,
      redactedValues: 2,
      environmentSecrets: {
        total: 4,
        encrypted: 4,
        plaintext: 0,
        unreadable: 0,
        environments: 2,
        migrationComplete: true
      },
      ...overrides
    },
    healthy
  };
}

const noop = () => undefined;

function renderPanel(props: Partial<Parameters<typeof panel.EnvironmentSecretsPanelView>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(panel.EnvironmentSecretsPanelView, {
      environmentName: 'Client Sandbox',
      secrets: [],
      isLoading: false,
      isSaving: false,
      error: null,
      notice: null,
      keyDraft: '',
      hasValue: false,
      revealValue: false,
      keyWarning: null,
      pendingDelete: null,
      onKeyChange: noop,
      onValueInput: noop,
      onToggleReveal: noop,
      onSubmit: noop,
      onRequestDelete: noop,
      onCancelDelete: noop,
      onConfirmDelete: noop,
      ...props
    })
  );
}

function renderCard(props: Partial<Parameters<typeof card.SecurityStatusCardView>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(card.SecurityStatusCardView, {
      status: null,
      isLoading: false,
      error: null,
      onRefresh: noop,
      ...props
    })
  );
}

async function main(): Promise<void> {
  storeMod = await import('../../../stores/useSecretStore');
  panel = await import('../EnvironmentSecretsPanel');
  card = await import('../../security/SecurityStatusCard');

  const {
    useSecretStore,
    secretsFor,
    validateSecretKey,
    isMaskPlaceholder,
    describeSecretError
  } = storeMod;

  // --- Pure helpers ----------------------------------------------------------
  describe('validateSecretKey enforces the POSIX rules the Core enforces');
  {
    equal('a plain name passes', validateSecretKey('DEPLOY_TOKEN'), null);
    equal('an underscore may lead', validateSecretKey('_private'), null);
    equal('digits are allowed after the first character', validateSecretKey('S3_BUCKET_2'), null);
    equal('lower case is a variable name too', validateSecretKey('deploy_token'), null);
    equal('surrounding whitespace is trimmed, not rejected', validateSecretKey('  TOKEN  '), null);
    equal('128 characters is the limit', validateSecretKey('A'.repeat(128)), null);

    check('an empty key is refused', validateSecretKey('   ') === 'A key is required.');
    check(
      'a leading digit is named as the problem',
      (validateSecretKey('1TOKEN') || '').includes('start with a letter or underscore')
    );
    check(
      'a hyphen is named as the problem',
      (validateSecretKey('DEPLOY-TOKEN') || '').includes('letters, digits and underscores')
    );
    check('a space inside is refused', validateSecretKey('DEPLOY TOKEN') !== null);
    check('an interpolation attempt is refused', validateSecretKey('$(whoami)') !== null);
    check('129 characters is too long', validateSecretKey('A'.repeat(129)) !== null);
  }

  describe('validateSecretKey refuses the names that decide what the process is');
  {
    for (const name of ['PATH', 'LD_PRELOAD', 'LD_AUDIT', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'NODE_OPTIONS', 'BASH_ENV', 'ENV', 'IFS', 'SHELL']) {
      check(`${name} is refused`, validateSecretKey(name) !== null);
    }
    check(
      'the refusal says why rather than saying "invalid"',
      (validateSecretKey('PATH') || '').includes('what the agent process is')
    );
    check('and case does not evade it', validateSecretKey('ld_preload') !== null);
    check('nor does surrounding whitespace', validateSecretKey(' PATH ') !== null);
    check('a key merely containing a protected name is fine', validateSecretKey('MY_PATH_PREFIX') === null);
  }

  describe('isMaskPlaceholder keeps the mask out of the value field');
  {
    check('the exact mask is recognised', isMaskPlaceholder(MASK));
    check('any run of bullets is recognised', isMaskPlaceholder('••••'));
    check('so is a run of asterisks', isMaskPlaceholder('****'));
    check('an empty value is not a mask', !isMaskPlaceholder(''));
    check('and a real credential is not', !isMaskPlaceholder(PLAINTEXT));
  }

  describe('describeSecretError branches on the code, not the message');
  {
    check(
      'a protected key keeps the Core’s own wording',
      describeSecretError('PROTECTED_SECRET_KEY_ERROR', "'PATH' is refused") === "'PATH' is refused"
    );
    check(
      'and has a fallback when the body carried none',
      describeSecretError('PROTECTED_SECRET_KEY_ERROR', undefined).includes('reserved')
    );
    check(
      'an invalid key explains the rule',
      describeSecretError('INVALID_SECRET_KEY_ERROR', undefined).includes('POSIX')
    );
    check(
      'a missing environment says so',
      describeSecretError('ENVIRONMENT_NOT_FOUND_ERROR', undefined).includes('no longer exists')
    );
    check('401 asks the operator to sign in', describeSecretError(undefined, undefined, 401).includes('Sign in'));
    check(
      '403 is about permission, not authentication',
      describeSecretError(undefined, undefined, 403).includes('permission')
    );
    check(
      'an unknown failure still says something',
      describeSecretError(undefined, undefined, 500) === 'The request failed.'
    );
  }

  describe('secretsFor is stable for an environment with nothing stored');
  {
    const byEnv = { 'env-a': [secret()] };
    equal('a known environment resolves its list', secretsFor(byEnv, 'env-a').length, 1);
    equal('an unknown one is empty', secretsFor(byEnv, 'env-z').length, 0);
    equal('and no environment at all is empty', secretsFor(byEnv, null).length, 0);
    check(
      'the empty list is one shared reference, so a selector does not re-render forever',
      secretsFor(byEnv, 'env-z') === secretsFor(byEnv, null)
    );
  }

  describe('formatSecretDate');
  {
    equal('a timestamp becomes a date', panel.formatSecretDate(Date.UTC(2026, 7, 17)), '2026-08-17');
    equal('a missing timestamp is not "1970-01-01"', panel.formatSecretDate(0), 'unknown');
    equal('nor is a broken one NaN', panel.formatSecretDate(Number.NaN), 'unknown');
  }

  describe('vaultHealthOf');
  {
    const { vaultHealthOf } = card;
    equal('a clean vault is healthy', vaultHealthOf(vaultStatus()).health, 'healthy');
    check('and says so', vaultHealthOf(vaultStatus()).label.includes('healthy'));

    equal(
      'a vault that cannot derive its key is unavailable, not merely degraded',
      vaultHealthOf(vaultStatus({ ready: false }, false)).health,
      'unavailable'
    );
    equal(
      'an unreadable system envelope is degraded',
      vaultHealthOf(vaultStatus({ unreadableKeys: 1 }, false)).health,
      'degraded'
    );
    check(
      'and the count is in the message',
      vaultHealthOf(vaultStatus({ unreadableKeys: 2 }, false)).detail.includes('2 stored credentials')
    );
    equal(
      'an unreadable *environment* secret is degraded too — the endpoint counts both stores',
      vaultHealthOf(
        vaultStatus(
          {
            environmentSecrets: {
              total: 4,
              encrypted: 3,
              plaintext: 0,
              unreadable: 1,
              environments: 2,
              migrationComplete: true
            }
          },
          false
        )
      ).health,
      'degraded'
    );
    equal(
      'plaintext on disk is degraded',
      vaultHealthOf(vaultStatus({ plaintextKeys: 1, migrationComplete: false }, false)).health,
      'degraded'
    );
    check(
      'unreadable outranks plaintext, because it is the one an operator cannot fix by restarting',
      vaultHealthOf(vaultStatus({ plaintextKeys: 1, unreadableKeys: 1 }, false)).label.includes('Unreadable')
    );
    equal(
      'the Core’s own unhealthy verdict is honoured even when the counts look clean',
      vaultHealthOf(vaultStatus({}, false)).health,
      'degraded'
    );
    equal('no status at all is unknown, not healthy', vaultHealthOf(null).health, 'unknown');
  }

  // --- The store -------------------------------------------------------------
  describe('useSecretStore — listing');
  {
    requests.length = 0;
    nextResponse = { status: 200, body: { secrets: [secret(), secret({ key: 'API_BASE_URL' })], mask: MASK } };
    await useSecretStore.getState().fetchSecrets('env-a');

    equal('it asks the environment’s secrets', requests[0].url, '/api/v1/environments/env-a/secrets');
    equal('with a GET', requests[0].method, 'GET');
    equal('carrying the token', requests[0].headers.Authorization, 'Bearer test-token');
    equal('the summaries land under that environment', secretsFor(useSecretStore.getState().secretsByEnvironment, 'env-a').length, 2);
    equal('loading is finished', useSecretStore.getState().isLoading, false);
    equal('and nothing failed', useSecretStore.getState().error, null);

    const stored = secretsFor(useSecretStore.getState().secretsByEnvironment, 'env-a')[0];
    equal('what is held is the mask', stored.maskedValue, MASK);
    check('and there is no value field at all', !('value' in (stored as unknown as Record<string, unknown>)));

    requests.length = 0;
    nextResponse = { status: 200, body: { secrets: [] } };
    await useSecretStore.getState().fetchSecrets('env/b');
    equal('an id is encoded', requests[0].url, '/api/v1/environments/env%2Fb/secrets');
    equal('and one environment does not clear another', secretsFor(useSecretStore.getState().secretsByEnvironment, 'env-a').length, 2);

    requests.length = 0;
    await useSecretStore.getState().fetchSecrets('');
    equal('no environment means no request', requests.length, 0);
  }

  describe('useSecretStore — listing failures');
  {
    nextResponse = { status: 403, body: { error: "Forbidden: 'workspace:read' is required" } };
    await useSecretStore.getState().fetchSecrets('env-a');
    check(
      'the Core’s refusal is surfaced',
      (useSecretStore.getState().error || '').includes('workspace:read')
    );
    equal(
      'and the previously loaded list is left alone rather than blanked',
      secretsFor(useSecretStore.getState().secretsByEnvironment, 'env-a').length,
      2
    );

    nextResponse = { status: 401, body: {} };
    await useSecretStore.getState().fetchSecrets('env-a');
    check('a bodyless 401 still says what to do', (useSecretStore.getState().error || '').includes('Sign in'));
  }

  describe('useSecretStore — storing a secret');
  {
    requests.length = 0;
    nextResponse = { status: 201, body: { success: true, secret: secret({ key: 'NEW_TOKEN' }) } };
    const result = await useSecretStore.getState().setSecret('env-a', 'NEW_TOKEN', PLAINTEXT);

    equal('it posts to the collection', requests[0].url, '/api/v1/environments/env-a/secrets');
    equal('with a POST', requests[0].method, 'POST');
    equal('declaring JSON', requests[0].headers['Content-Type'], 'application/json');
    equal('the key travels', (requests[0].body as { key: string }).key, 'NEW_TOKEN');
    equal('and so does the value, exactly once', (requests[0].body as { value: string }).value, PLAINTEXT);
    equal('the call reports success', result.ok, true);
    check(
      'the returned summary joins the list',
      secretsFor(useSecretStore.getState().secretsByEnvironment, 'env-a').some(s => s.key === 'NEW_TOKEN')
    );

    const serialised = JSON.stringify(useSecretStore.getState());
    check('and the plaintext is nowhere in the store', !serialised.includes(PLAINTEXT));
    equal('saving is finished', useSecretStore.getState().isSaving, false);
  }

  describe('useSecretStore — rotating replaces in place');
  {
    const before = secretsFor(useSecretStore.getState().secretsByEnvironment, 'env-a').length;
    requests.length = 0;
    nextResponse = {
      status: 201,
      body: { success: true, secret: secret({ key: 'NEW_TOKEN', createdAt: Date.UTC(2026, 0, 1) }) }
    };
    await useSecretStore.getState().setSecret('env-a', 'NEW_TOKEN', 'a-second-credential-value');

    const after = secretsFor(useSecretStore.getState().secretsByEnvironment, 'env-a');
    equal('the list does not grow', after.length, before);
    equal(
      'and the row carries what the Core returned',
      after.find(s => s.key === 'NEW_TOKEN')?.createdAt,
      Date.UTC(2026, 0, 1)
    );
  }

  describe('useSecretStore — a key the Core would refuse never leaves the browser');
  {
    requests.length = 0;
    const refused = await useSecretStore.getState().setSecret('env-a', 'PATH', PLAINTEXT);
    equal('no request is made', requests.length, 0);
    equal('the call reports failure', refused.ok, false);
    check('with the reason', (refused.error || '').includes('what the agent process is'));
    check('which is also on the store for the panel to render', (useSecretStore.getState().error || '').length > 0);

    requests.length = 0;
    const malformed = await useSecretStore.getState().setSecret('env-a', 'BAD-KEY', PLAINTEXT);
    equal('a malformed key is stopped too', requests.length, 0);
    equal('and reports failure', malformed.ok, false);

    requests.length = 0;
    const masked = await useSecretStore.getState().setSecret('env-a', 'NEW_TOKEN', MASK);
    equal('re-submitting the mask is stopped before it can overwrite the credential', requests.length, 0);
    equal('and reports failure', masked.ok, false);
    check('saying what the mask is', (masked.error || '').includes('not a credential'));
  }

  describe('useSecretStore — the Core’s own rejections');
  {
    requests.length = 0;
    nextResponse = {
      status: 400,
      body: { error: "'LD_PRELOAD' cannot be stored as an environment secret", code: 'PROTECTED_SECRET_KEY_ERROR' }
    };
    // A key this build considers acceptable but the Core does not — an older
    // dashboard against a newer Core is exactly this case.
    const rejected = await useSecretStore.getState().setSecret('env-a', 'SOME_KEY', PLAINTEXT);
    equal('the request was made', requests.length, 1);
    equal('the call reports failure', rejected.ok, false);
    equal('the code is passed through for the caller to branch on', rejected.code, 'PROTECTED_SECRET_KEY_ERROR');
    check('and the message is the Core’s', (rejected.error || '').includes('LD_PRELOAD'));
    check(
      'nothing was added to the list on a rejection',
      !secretsFor(useSecretStore.getState().secretsByEnvironment, 'env-a').some(s => s.key === 'SOME_KEY')
    );

    nextResponse = { status: 400, body: { error: 'bad key', code: 'INVALID_SECRET_KEY_ERROR' } };
    const invalid = await useSecretStore.getState().setSecret('env-a', 'ANOTHER_KEY', PLAINTEXT);
    equal('an invalid-key rejection is carried too', invalid.code, 'INVALID_SECRET_KEY_ERROR');

    nextResponse = { status: 404, body: { error: 'Environment not found', code: 'ENVIRONMENT_NOT_FOUND_ERROR' } };
    const missing = await useSecretStore.getState().setSecret('env-a', 'THIRD_KEY', PLAINTEXT);
    equal('so is a missing environment', missing.code, 'ENVIRONMENT_NOT_FOUND_ERROR');
    equal('and saving is not left running', useSecretStore.getState().isSaving, false);

    check(
      'no failed submission left the credential in the store',
      !JSON.stringify(useSecretStore.getState()).includes(PLAINTEXT)
    );
  }

  describe('useSecretStore — deleting');
  {
    requests.length = 0;
    nextResponse = { status: 200, body: { success: true } };
    const deleted = await useSecretStore.getState().deleteSecret('env-a', 'NEW_TOKEN');

    equal('it addresses the secret', requests[0].url, '/api/v1/environments/env-a/secrets/NEW_TOKEN');
    equal('with a DELETE', requests[0].method, 'DELETE');
    equal('carrying the token', requests[0].headers.Authorization, 'Bearer test-token');
    equal('and reports success', deleted.ok, true);
    check(
      'the secret leaves the list',
      !secretsFor(useSecretStore.getState().secretsByEnvironment, 'env-a').some(s => s.key === 'NEW_TOKEN')
    );
    check(
      'while the others stay',
      secretsFor(useSecretStore.getState().secretsByEnvironment, 'env-a').some(s => s.key === 'DEPLOY_TOKEN')
    );

    requests.length = 0;
    nextResponse = { status: 200, body: { success: true } };
    await useSecretStore.getState().deleteSecret('env-a', 'A KEY/WITH SLASH');
    equal(
      'a key is encoded rather than becoming a path',
      requests[0].url,
      '/api/v1/environments/env-a/secrets/A%20KEY%2FWITH%20SLASH'
    );

    requests.length = 0;
    nextResponse = { status: 404, body: { error: 'Secret not found' } };
    const gone = await useSecretStore.getState().deleteSecret('env-a', 'DEPLOY_TOKEN');
    equal('a 404 reports failure', gone.ok, false);
    check(
      'and the row is left alone rather than optimistically removed',
      secretsFor(useSecretStore.getState().secretsByEnvironment, 'env-a').some(s => s.key === 'DEPLOY_TOKEN')
    );
  }

  describe('useSecretStore — vault status');
  {
    requests.length = 0;
    nextResponse = { status: 200, body: vaultStatus() };
    await useSecretStore.getState().fetchVaultStatus();

    equal('it asks the security endpoint', requests[0].url, '/api/v1/security/vault-status');
    equal('with a GET', requests[0].method, 'GET');
    equal('the cipher is parsed', useSecretStore.getState().vaultStatus?.vault.algorithm, 'AES-256-GCM');
    equal('so is the derivation', useSecretStore.getState().vaultStatus?.vault.keyDerivation, 'PBKDF2-HMAC-SHA512');
    equal('the health flag comes through', useSecretStore.getState().vaultStatus?.healthy, true);
    equal(
      'and the environment tally the P9-02 endpoint folds in',
      useSecretStore.getState().vaultStatus?.vault.environmentSecrets.encrypted,
      4
    );
    equal('loading is finished', useSecretStore.getState().isVaultLoading, false);

    nextResponse = { status: 500, body: { error: 'Failed to read vault status' } };
    await useSecretStore.getState().fetchVaultStatus();
    check('a failure is reported', (useSecretStore.getState().vaultError || '').includes('Failed to read'));
    check(
      'on its own field, so the secrets panel is not blanked by it',
      useSecretStore.getState().vaultStatus !== null
    );

    useSecretStore.getState().clearError();
    equal('and both can be cleared', useSecretStore.getState().vaultError, null);
  }

  // --- Rendering -------------------------------------------------------------
  describe('EnvironmentSecretsPanelView renders the list');
  {
    const empty = renderPanel();
    check('the environment is named', empty.includes('Client Sandbox'));
    check('an empty environment says so', empty.includes('No secrets configured'));
    check('and explains what a secret is for', empty.includes('environment variable'));

    const loading = renderPanel({ isLoading: true });
    check('loading is visible', loading.includes('Loading secrets'));

    const listed = renderPanel({
      secrets: [secret(), secret({ key: 'API_BASE_URL', createdAt: Date.UTC(2026, 0, 3) })]
    });
    check('each key is named', listed.includes('DEPLOY_TOKEN') && listed.includes('API_BASE_URL'));
    check('the value is a mask', listed.includes(MASK));
    check('presence is stated', listed.includes('Encrypted'));
    check('with the date it was added', listed.includes('2026-08-17') && listed.includes('2026-01-03'));
    check('and it no longer claims there are none', !listed.includes('No secrets configured'));
    check('the key is monospaced', listed.includes('var(--font-family-mono)'));

    const notSet = renderPanel({ secrets: [secret({ isSet: false })] });
    check('an unset secret is not badged as encrypted', notSet.includes('Not set'));
  }

  describe('EnvironmentSecretsPanelView renders the form');
  {
    const form = renderPanel();
    check('the form is titled', form.includes('Add or rotate a secret'));
    check('the key field is labelled', form.includes('Secret key'));
    check('the value field is labelled', form.includes('Secret value'));
    check('the key field is bound to its label', form.includes('for="secret-key-input"'));
    check('the value field is bound to its own', form.includes('for="secret-value-input"'));
    check('the value is a password field by default', form.includes('type="password"'));
    check('with a reveal toggle', form.includes('>Show<'));
    check('rotation is explained rather than being a second form', form.includes('rotates it in place'));
    check('and the clearing behaviour is stated', form.includes('cleared from this form'));
    check('an empty form cannot be submitted', form.includes('disabled=""'));

    const revealed = renderPanel({ revealValue: true, hasValue: true });
    check('revealing switches the field to text', revealed.includes('type="text"'));
    check('and offers to hide again', revealed.includes('>Hide<'));

    const ready = renderPanel({ keyDraft: 'DEPLOY_TOKEN', hasValue: true });
    check('a complete draft enables the button', !ready.includes('disabled=""'));

    const warned = renderPanel({
      keyDraft: 'PATH',
      hasValue: true,
      keyWarning: validateSecretKey('PATH')
    });
    check('a protected key is warned about', warned.includes('what the agent process is'));
    check('as an alert', warned.includes('role="alert"'));
    check('the field is marked invalid for assistive technology', warned.includes('aria-invalid="true"'));
    check('and submission is blocked', warned.includes('disabled=""'));

    const saving = renderPanel({ keyDraft: 'A_KEY', hasValue: true, isSaving: true });
    check('storing is visible', saving.includes('Storing…'));
  }

  describe('EnvironmentSecretsPanelView never renders a credential');
  {
    // The value field is uncontrolled, so the view has no prop that could carry
    // a credential: a plaintext exists only in the DOM node the operator typed
    // it into. A controlled field would have rendered it as a `value` attribute
    // — this asserts the field stays free of one in every state.
    const withDraft = renderPanel({ keyDraft: 'DEPLOY_TOKEN', hasValue: true, revealValue: true });
    check(
      'the value field renders no value attribute, so nothing serialising the DOM can read it',
      !/id="secret-value-input"[^>]*\svalue=/.test(withDraft)
    );
    check('nor a defaultValue', !withDraft.includes('defaultValue'));
    check(
      'even revealed, where a controlled field would have emitted the text',
      withDraft.includes('type="text"') && !withDraft.includes(PLAINTEXT)
    );

    const listed = renderPanel({
      secrets: [secret(), secret({ key: 'API_BASE_URL' })],
      notice: 'DEPLOY_TOKEN stored, encrypted with the workstation vault.'
    });
    check('nor is anything in the list', !listed.includes(PLAINTEXT));
    check('the success notice names the key only', listed.includes('DEPLOY_TOKEN stored'));
    check('and is a status region', listed.includes('role="status"'));

    // A malicious or malformed listing must not become an escape hatch: the
    // Core masks server-side, and if it ever returned a value the panel still
    // has no element that would print it.
    const hostile = renderPanel({
      secrets: [{ ...secret(), maskedValue: MASK, ...({ value: PLAINTEXT } as object) } as EnvironmentSecretSummary]
    });
    check('an unexpected value field on a summary is still not rendered', !hostile.includes(PLAINTEXT));
  }

  describe('EnvironmentSecretsPanelView asks before deleting');
  {
    const listed = renderPanel({ secrets: [secret()] });
    check('each row offers removal', listed.includes('>Remove<'));
    check('labelled for assistive technology', listed.includes('aria-label="Remove DEPLOY_TOKEN"'));
    check('and does not confirm anything yet', !listed.includes('Confirm delete'));

    const arming = renderPanel({ secrets: [secret()], pendingDelete: 'DEPLOY_TOKEN' });
    check('arming asks first', arming.includes('Delete DEPLOY_TOKEN?'));
    check('with an explicit confirmation', arming.includes('Confirm delete'));
    check('and a way out', arming.includes('>Cancel<'));

    const other = renderPanel({
      secrets: [secret(), secret({ key: 'API_BASE_URL' })],
      pendingDelete: 'DEPLOY_TOKEN'
    });
    check('only the armed row is confirming', other.split('Confirm delete').length - 1 === 1);
  }

  describe('EnvironmentSecretsPanelView surfaces failures');
  {
    const failedPanel = renderPanel({ error: "'PATH' cannot be stored as an environment secret" });
    check('the Core’s refusal is shown', failedPanel.includes('cannot be stored as an environment secret'));
    check('as an alert', failedPanel.includes('role="alert"'));
  }

  describe('SecurityStatusCardView renders the vault');
  {
    const healthy = renderCard({ status: vaultStatus() });
    check('the card is labelled', healthy.includes('Workstation Security'));
    check('as a region', healthy.includes('aria-label="Workstation security status"'));
    check('the health badge is green and explicit', healthy.includes('Vault active &amp; healthy'));
    check('the cipher is named', healthy.includes('AES-256-GCM'));
    check('with the derivation and rounds', healthy.includes('PBKDF2-HMAC-SHA512') && healthy.includes('100,000 rounds'));
    check('the salt is reported', healthy.includes('Key derivation salt') && healthy.includes('Present'));
    check('system credentials are tallied', healthy.includes('3 encrypted'));
    check('with the managed-key count', healthy.includes('3 managed keys'));
    check('environment secrets are tallied', healthy.includes('4 encrypted'));
    check('across their environments', healthy.includes('4 total across 2 environments'));
    check('migration is reported complete', healthy.includes('Complete'));
    check('and redaction is counted', healthy.includes('2 values'));
    check('a refresh is offered when one is wired', healthy.includes('aria-label="Refresh vault status"'));

    const noRefresh = renderCard({ status: vaultStatus(), onRefresh: undefined });
    check('and omitted when it is not', !noRefresh.includes('Refresh vault status'));
  }

  describe('SecurityStatusCardView renders the unhappy states');
  {
    const unreadable = renderCard({ status: vaultStatus({ unreadableKeys: 2 }, false) });
    check('unreadable envelopes are called out', unreadable.includes('Unreadable envelopes detected'));
    check('with the count', unreadable.includes('2 stored credentials'));
    check('and the usual cause', unreadable.includes('copied from another workstation'));
    check('in amber, not green', unreadable.includes('var(--color-state-paused)'));

    const plaintext = renderCard({ status: vaultStatus({ plaintextKeys: 1, migrationComplete: false }, false) });
    check('plaintext on disk is called out', plaintext.includes('Plaintext credentials on disk'));
    check('and migration reads as pending', plaintext.includes('Pending'));

    const envPending = renderCard({
      status: vaultStatus(
        {
          environmentSecrets: {
            total: 3,
            encrypted: 2,
            plaintext: 1,
            unreadable: 0,
            environments: 1,
            migrationComplete: false
          }
        },
        false
      )
    });
    check('an environment secret still in plaintext is enough to say Pending', envPending.includes('Pending'));
    check('and the singular reads correctly', envPending.includes('1 environment'));

    const down = renderCard({ status: vaultStatus({ ready: false, saltPresent: false }, false) });
    check('a vault without a key says so', down.includes('Vault key unavailable'));
    check('in red', down.includes('var(--color-state-error)'));
    check('and the salt reads as missing', down.includes('Missing'));

    const failedCard = renderCard({ error: 'Failed to read vault status' });
    check('a fetch failure is shown', failedCard.includes('Failed to read vault status'));
    check('as an alert', failedCard.includes('role="alert"'));
    check('and the card does not claim health it does not have', !failedCard.includes('active &amp; healthy'));

    const loading = renderCard({ isLoading: true });
    check('loading is visible', loading.includes('Reading vault status'));
  }

  describe('the literal bodies a running Core returned');
  {
    // Captured from the real routes (Fastify `inject` against a seeded
    // database) rather than written by hand, so a change to the Core's shape
    // that this dashboard would misread fails here instead of in a browser.
    const listing = JSON.parse(
      '{"secrets":[{"key":"DEPLOY_TOKEN","maskedValue":"••••••••","isSet":true,"createdAt":1786976800132}],"mask":"••••••••"}'
    );
    const status = JSON.parse(
      '{"vault":{"ready":true,"algorithm":"AES-256-GCM","keyDerivation":"PBKDF2-HMAC-SHA512","iterations":100000,"ivBytes":12,"authTagBytes":16,"envelopeVersion":"v1","saltPresent":true,"managedKeys":["ai_api_key","vapid_keys","stripe_secret_key","jwt_secret","hmac_secret"],"encryptedKeys":0,"plaintextKeys":0,"unreadableKeys":0,"migrationComplete":true,"redactedValues":1,"environmentSecrets":{"total":1,"encrypted":1,"plaintext":0,"unreadable":0,"environments":1,"migrationComplete":true}},"healthy":true}'
    );
    const rejection = JSON.parse(
      '{"error":"\'PATH\' controls how the agent process itself is launched and cannot be stored as a secret.","code":"PROTECTED_SECRET_KEY_ERROR"}'
    );

    requests.length = 0;
    nextResponse = { status: 200, body: listing };
    await useSecretStore.getState().fetchSecrets('env_shape');
    const parsed = secretsFor(useSecretStore.getState().secretsByEnvironment, 'env_shape');
    equal('the real listing parses', parsed.length, 1);
    equal('with the mask the Core actually sends', parsed[0].maskedValue, MASK);

    const realPanel = renderPanel({ secrets: parsed });
    check('and the panel renders it', realPanel.includes('DEPLOY_TOKEN') && realPanel.includes(MASK));
    check('with the date the Core stamped', realPanel.includes('2026-08-17'));

    nextResponse = { status: 200, body: status };
    await useSecretStore.getState().fetchVaultStatus();
    const realStatus = useSecretStore.getState().vaultStatus;
    equal('the real vault status parses', realStatus?.vault.algorithm, 'AES-256-GCM');
    equal('including the nested environment tally', realStatus?.vault.environmentSecrets.total, 1);

    const realCard = renderCard({ status: realStatus });
    check('and the card renders it as healthy', realCard.includes('Vault active &amp; healthy'));
    check('with the real managed-key count', realCard.includes('5 managed keys'));
    check('and the real environment tally', realCard.includes('1 total across 1 environment'));

    check(
      'the Core’s real protected-key refusal is shown verbatim',
      describeSecretError(rejection.code, rejection.error).includes('how the agent process itself is launched')
    );
  }

  describe('SecurityStatusCardView carries no credential');
  {
    const rendered = renderCard({ status: vaultStatus() });
    check('the managed key names are configuration, not values', rendered.includes('3 managed keys'));
    check('and no envelope or value appears', !rendered.includes('vault:v1:') && !rendered.includes(PLAINTEXT));
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
