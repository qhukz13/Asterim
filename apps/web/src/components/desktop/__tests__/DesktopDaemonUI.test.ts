/**
 * Tests for the Workstation Desktop Daemon UI (P10-02).
 *
 * Three layers, matching the convention the environment, delegation and
 * profiles suites established:
 *   1. Pure helpers — `trayVerdictOf`, `formatUptime`, `formatMemory`,
 *      `vaultBadgeOf`, `autoStartMechanismOf`, `describeDesktopError`,
 *      `describeNotifyOutcome` — called directly. The state mapping is the
 *      part that must not drift from the tray's own reading of the same
 *      `DesktopTrayStatus`, and it is asserted here without a browser.
 *   2. `useDesktopStore` against a recording `fetch`, so the exact URLs,
 *      methods, headers and bodies are asserted. Every POST here causes
 *      something to happen on the operator's physical machine, so "which
 *      endpoint was called, with what" is the assertion that matters most —
 *      a mock returning data would hide a card that opened a file manager
 *      when it meant to send a toast.
 *   3. Real rendering through `react-dom/server`, driving the props-only
 *      view across ONLINE / PAUSED / OFFLINE, headless, auto-start on and
 *      off, loading, pending and error.
 *
 * What it does NOT cover: click handlers, which need an event loop and a DOM
 * the repository does not have. The connected container is a thin wrapper over
 * the view and the store, both of which are covered directly.
 *
 * Run:  pnpm --filter @asterim/web exec tsx src/components/desktop/__tests__/DesktopDaemonUI.test.ts
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DesktopStatus, DesktopTrayStatus } from '@asterim/shared';

// --- Environment stubs, installed before the store loads ---

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

const requests: RecordedRequest[] = [];
let nextResponse: { status: number; body: unknown } = { status: 200, body: {} };
/** Set to make the next `fetch` reject, standing in for a Core that is down. */
let nextNetworkError: string | null = null;

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
  if (nextNetworkError) {
    const message = nextNetworkError;
    nextNetworkError = null;
    throw new Error(message);
  }
  const { status, body } = nextResponse;
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
};

type StoreModule = typeof import('../../../stores/useDesktopStore');
type CardModule = typeof import('../DesktopDaemonCard');

let storeMod: StoreModule;
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

function tray(overrides: Partial<DesktopTrayStatus> = {}): DesktopTrayStatus {
  return {
    state: 'ONLINE',
    label: 'Asterim — online, 2 active threads, 3 MCP',
    activeThreads: 2,
    activeMcpServers: 3,
    vault: 'ENCRYPTED',
    memoryMb: 182,
    uptimeSeconds: 4 * 3600 + 12 * 60,
    ...overrides
  };
}

function desktopStatus(
  overrides: Partial<DesktopStatus> = {},
  trayOverrides: Partial<DesktopTrayStatus> = {}
): DesktopStatus {
  const trayStatus = tray(trayOverrides);
  return {
    isHeadless: false,
    platform: 'linux',
    autoStartEnabled: false,
    trayStatus,
    activeAgentsCount: trayStatus.activeThreads,
    vaultEncrypted: trayStatus.vault === 'ENCRYPTED',
    webUrl: 'http://localhost:3000',
    dataDir: '/home/dev/.asterim',
    ...overrides
  };
}

const MENU = [
  { id: 'status' as const, label: 'Asterim — online, 2 active threads, 3 MCP', enabled: false, readonly: true },
  { id: 'open-dashboard' as const, label: 'Open Dashboard', enabled: true },
  { id: 'open-data-dir' as const, label: 'Open Data Folder', enabled: true },
  { id: 'view-log' as const, label: 'View Server Log', enabled: true },
  { id: 'toggle-autostart' as const, label: 'Start at Login', enabled: true }
];

const noop = () => undefined;

/** The one `<button>` element whose text is `label`, as rendered. */
function buttonFor(markup: string, label: string): string {
  const match = markup.match(new RegExp(`<button[^>]*>${label}</button>`));
  return match ? match[0] : '';
}

function renderCard(props: Partial<Parameters<typeof card.DesktopDaemonCardView>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(card.DesktopDaemonCardView, {
      status: null,
      isLoading: false,
      isTogglingAutoStart: false,
      pendingAction: null,
      error: null,
      notice: null,
      onRefresh: noop,
      onToggleAutoStart: noop,
      onOpenDataDirectory: noop,
      onOpenLogFile: noop,
      onSendTestNotification: noop,
      ...props
    })
  );
}

/** Puts the store back to the state a fresh mount would see. */
function resetStore(): void {
  storeMod.useDesktopStore.setState({
    status: null,
    menu: [],
    isLoading: false,
    isTogglingAutoStart: false,
    pendingAction: null,
    error: null,
    actionNotice: null
  });
  requests.length = 0;
}

async function main(): Promise<void> {
  storeMod = await import('../../../stores/useDesktopStore');
  card = await import('../DesktopDaemonCard');

  const { useDesktopStore, describeDesktopError, describeNotifyOutcome } = storeMod;
  const { trayVerdictOf, formatUptime, formatMemory, vaultBadgeOf, autoStartMechanismOf } = card;

  // --- Pure helpers ----------------------------------------------------------
  describe('trayVerdictOf keeps PAUSED and OFFLINE apart');
  {
    equal('an online Core reads as online', trayVerdictOf(desktopStatus()).label, 'Daemon online');
    check('in green', trayVerdictOf(desktopStatus()).color === 'var(--color-state-completed)');
    check(
      'and the detail is the Core’s own tooltip, not a second opinion',
      trayVerdictOf(desktopStatus()).detail === 'Asterim — online, 2 active threads, 3 MCP'
    );

    const paused = trayVerdictOf(desktopStatus({}, { state: 'PAUSED', label: 'Asterim — paused, 0 active threads, 0 MCP' }));
    equal('a paused Core reads as paused', paused.label, 'Daemon paused');
    check('in amber', paused.color === 'var(--color-state-paused)');
    check('and says it is deliberate', paused.detail.includes('deliberately not acting'));

    const offline = trayVerdictOf(desktopStatus({}, { state: 'OFFLINE', label: 'Asterim — unavailable' }));
    equal('an offline Core reads as offline', offline.label, 'Daemon offline');
    check('in red, which paused is not', offline.color === 'var(--color-state-error)');
    check('and names the actual cause', offline.detail.includes('cannot read its own database'));

    equal('no status at all is unknown, not online', trayVerdictOf(null).label, 'Daemon status unavailable');
    check('and is neither green nor red', trayVerdictOf(null).color === 'var(--color-text-muted)');
  }

  describe('formatUptime');
  {
    equal('seconds stay seconds', formatUptime(45), '45s');
    equal('a minute is minutes and seconds', formatUptime(90), '1m 30s');
    equal('an hour is hours and minutes', formatUptime(3600 + 12 * 60), '1h 12m');
    equal('a day is days and hours', formatUptime(3 * 86400 + 4 * 3600 + 30 * 60), '3d 4h');
    equal('the boundary at a minute', formatUptime(60), '1m 0s');
    equal('the boundary at an hour', formatUptime(3600), '1h 0m');
    equal('the boundary at a day', formatUptime(86400), '1d 0h');
    equal('a freshly started Core is not blank', formatUptime(0), '0s');
    equal('a fractional uptime is floored, not rendered as 4.7s', formatUptime(4.7), '4s');
    equal('a missing uptime is not "0s"', formatUptime(undefined), 'unknown');
    equal('nor is a broken one NaN', formatUptime(Number.NaN), 'unknown');
    equal('a negative uptime is refused', formatUptime(-1), 'unknown');
  }

  describe('formatMemory');
  {
    equal('the Core’s megabytes are shown as such', formatMemory(182), '182 MB');
    equal('zero is a real reading', formatMemory(0), '0 MB');
    equal('a missing figure says so', formatMemory(undefined), 'unknown');
    equal('and NaN does not reach the badge', formatMemory(Number.NaN), 'unknown');
  }

  describe('vaultBadgeOf');
  {
    equal('an encrypted vault is the good state', vaultBadgeOf('ENCRYPTED').tone, 'good');
    equal('and is badged as one word', vaultBadgeOf('ENCRYPTED').value, 'ENCRYPTED');
    equal('plaintext on disk is a warning', vaultBadgeOf('PLAINTEXT').tone, 'warn');
    check('that says what is wrong', vaultBadgeOf('PLAINTEXT').hint.includes('readable on disk'));
    equal('an unreadable vault warns too', vaultBadgeOf('UNAVAILABLE').tone, 'warn');
    equal('and so does a missing reading', vaultBadgeOf(undefined).value, 'UNAVAILABLE');
  }

  describe('autoStartMechanismOf names the OS mechanism');
  {
    check('Windows is the Run key', autoStartMechanismOf('win32').label.includes('Registry'));
    check('macOS is a LaunchAgent', autoStartMechanismOf('darwin').label.includes('LaunchAgent'));
    check('Linux is an XDG entry', autoStartMechanismOf('linux').label.includes('XDG'));
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      equal(`${platform} can register a login item`, autoStartMechanismOf(platform).available, true);
    }
    equal('an unsupported platform cannot', autoStartMechanismOf('unsupported').available, false);
    check('and says so rather than offering a switch', autoStartMechanismOf('unsupported').label.includes('No login-item mechanism'));
    equal('nor can an absent platform', autoStartMechanismOf(undefined).available, false);
  }

  describe('describeDesktopError');
  {
    check('401 asks the operator to sign in', describeDesktopError(undefined, 401).includes('Sign in'));
    check(
      '403 is about permission, not authentication',
      describeDesktopError(undefined, 403).includes('permission')
    );
    check(
      'a 404 reads as an older Core rather than a missing file',
      describeDesktopError(undefined, 404).includes('does not expose the desktop daemon API')
    );
    equal(
      'the Core’s own wording is kept when it sent one',
      describeDesktopError('Failed to read desktop status', 500),
      'Failed to read desktop status'
    );
    equal('and there is a fallback when it did not', describeDesktopError(undefined, 500), 'The request failed.');
  }

  describe('describeNotifyOutcome explains an invisible outcome');
  {
    check(
      'a dispatched toast is confirmed',
      describeNotifyOutcome({ dispatched: true }).includes('sent to your desktop')
    );
    check(
      'a headless skip is explained rather than read as a failure',
      describeNotifyOutcome({ dispatched: false, skipped: 'HEADLESS' }).includes('no desktop session')
    );
    check(
      'an unsupported platform says so',
      describeNotifyOutcome({ dispatched: false, skipped: 'UNSUPPORTED_PLATFORM' }).includes('no native notification')
    );
    check(
      'and rate limiting is named, not silent',
      describeNotifyOutcome({ dispatched: false, skipped: 'RATE_LIMITED' }).includes('rate-limiting')
    );
    equal(
      'an unexplained failure falls back to the Core’s reason',
      describeNotifyOutcome({ dispatched: false, reason: 'notify-send is not installed' }),
      'notify-send is not installed'
    );
  }

  // --- The store -------------------------------------------------------------
  describe('useDesktopStore — fetching status');
  {
    resetStore();
    nextResponse = { status: 200, body: { desktop: desktopStatus(), menu: MENU } };
    await useDesktopStore.getState().fetchStatus();

    equal('it asks the status endpoint', requests[0].url, '/api/v1/desktop/status');
    equal('with a GET', requests[0].method, 'GET');
    equal('carrying the token', requests[0].headers.Authorization, 'Bearer test-token');
    equal('and no JSON content type on a read', requests[0].headers['Content-Type'], undefined);
    equal('the platform is parsed', useDesktopStore.getState().status?.platform, 'linux');
    equal('so is the thread count', useDesktopStore.getState().status?.trayStatus.activeThreads, 2);
    equal('and the MCP count', useDesktopStore.getState().status?.trayStatus.activeMcpServers, 3);
    equal('the tray menu lands too', useDesktopStore.getState().menu.length, 5);
    equal('loading is finished', useDesktopStore.getState().isLoading, false);
    equal('and nothing failed', useDesktopStore.getState().error, null);
  }

  describe('useDesktopStore — a failed status does not blank the card');
  {
    requests.length = 0;
    nextResponse = { status: 500, body: { error: 'Failed to read desktop status' } };
    await useDesktopStore.getState().fetchStatus();
    check(
      'the Core’s failure is surfaced',
      (useDesktopStore.getState().error || '').includes('Failed to read desktop status')
    );
    equal(
      'while the last good status is left in place',
      useDesktopStore.getState().status?.platform,
      'linux'
    );
    equal('and loading is not left running', useDesktopStore.getState().isLoading, false);

    nextResponse = { status: 401, body: {} };
    await useDesktopStore.getState().fetchStatus();
    check('a bodyless 401 still says what to do', (useDesktopStore.getState().error || '').includes('Sign in'));

    nextNetworkError = 'fetch failed';
    await useDesktopStore.getState().fetchStatus();
    check('an unreachable Core is reported', (useDesktopStore.getState().error || '').includes('fetch failed'));
    equal('without hanging the spinner', useDesktopStore.getState().isLoading, false);
  }

  describe('useDesktopStore — toggling auto-start');
  {
    resetStore();
    useDesktopStore.setState({ status: desktopStatus() });
    nextResponse = {
      status: 200,
      body: {
        success: true,
        enabled: true,
        entryPath: '/home/dev/.config/autostart/asterim.desktop'
      }
    };
    const enabled = await useDesktopStore.getState().toggleAutoStart(true);

    equal('it posts to the autostart endpoint', requests[0].url, '/api/v1/desktop/autostart');
    equal('with a POST', requests[0].method, 'POST');
    equal('declaring JSON', requests[0].headers['Content-Type'], 'application/json');
    equal('carrying the token', requests[0].headers.Authorization, 'Bearer test-token');
    equal('and the requested state as a boolean', requests[0].body, { enabled: true });
    equal('the call reports success', enabled, true);
    equal('the switch settles on the Core’s answer', useDesktopStore.getState().status?.autoStartEnabled, true);
    check(
      'and the entry path is named, so the operator can find what was written',
      (useDesktopStore.getState().actionNotice || '').includes('/home/dev/.config/autostart/asterim.desktop')
    );
    equal('the pending flag is cleared', useDesktopStore.getState().isTogglingAutoStart, false);

    requests.length = 0;
    nextResponse = { status: 200, body: { success: true, enabled: false } };
    await useDesktopStore.getState().toggleAutoStart(false);
    equal('turning it off sends false', requests[0].body, { enabled: false });
    equal('and the switch follows', useDesktopStore.getState().status?.autoStartEnabled, false);
    check(
      'with a notice that does not claim a path that was removed',
      (useDesktopStore.getState().actionNotice || '').includes('no longer start automatically')
    );
  }

  describe('useDesktopStore — a platform that cannot register a login item');
  {
    resetStore();
    useDesktopStore.setState({ status: desktopStatus({ platform: 'unsupported' }) });
    // The Core answers 200 with `enabled: false` to a request for `true`.
    nextResponse = {
      status: 200,
      body: { success: false, enabled: false, reason: 'auto-start is not available on unsupported' }
    };
    const refused = await useDesktopStore.getState().toggleAutoStart(true);

    equal('the call reports failure', refused, false);
    equal(
      'the switch does not stay on a state the machine is not in',
      useDesktopStore.getState().status?.autoStartEnabled,
      false
    );
    check(
      'and the reason is shown',
      (useDesktopStore.getState().error || '').includes('not available on unsupported')
    );
    equal('with no success notice contradicting it', useDesktopStore.getState().actionNotice, null);

    resetStore();
    useDesktopStore.setState({ status: desktopStatus() });
    nextResponse = { status: 400, body: { error: 'enabled must be a boolean' } };
    const rejected = await useDesktopStore.getState().toggleAutoStart(true);
    equal('a 400 reports failure too', rejected, false);
    check('with the Core’s message', (useDesktopStore.getState().error || '').includes('must be a boolean'));
    equal(
      'and the switch is left where it was rather than moving optimistically',
      useDesktopStore.getState().status?.autoStartEnabled,
      false
    );
    equal('the pending flag is cleared', useDesktopStore.getState().isTogglingAutoStart, false);
  }

  describe('useDesktopStore — the launch actions address their own endpoints');
  {
    resetStore();
    nextResponse = { status: 200, body: { success: true } };
    const opened = await useDesktopStore.getState().openDataDirectory();
    equal('the data folder has its own route', requests[0].url, '/api/v1/desktop/open-data-dir');
    equal('with a POST', requests[0].method, 'POST');
    equal('carrying the token', requests[0].headers.Authorization, 'Bearer test-token');
    equal('and no body — the Core computes the target itself', requests[0].body, undefined);
    equal('the call reports success', opened, true);
    check(
      'with a notice, because nothing about this is visible in the browser',
      (useDesktopStore.getState().actionNotice || '').includes('file manager')
    );
    equal('and the pending action is cleared', useDesktopStore.getState().pendingAction, null);

    resetStore();
    nextResponse = { status: 200, body: { success: true } };
    const log = await useDesktopStore.getState().openLogFile();
    equal('the log has its own route', requests[0].url, '/api/v1/desktop/open-log');
    equal('with a POST', requests[0].method, 'POST');
    equal('and no client-supplied path', requests[0].body, undefined);
    equal('the call reports success', log, true);
    check('with its own notice', (useDesktopStore.getState().actionNotice || '').includes('server log'));
  }

  describe('useDesktopStore — a launch the platform cannot perform');
  {
    resetStore();
    // 200 with `success: false` is how the Core reports "no launcher here".
    nextResponse = { status: 200, body: { success: false, reason: 'no file manager launcher on unsupported' } };
    const failedOpen = await useDesktopStore.getState().openDataDirectory();
    equal('the call reports failure', failedOpen, false);
    check(
      'the Core’s reason is shown rather than a generic message',
      (useDesktopStore.getState().error || '').includes('no file manager launcher')
    );
    equal('and no success notice is left claiming it worked', useDesktopStore.getState().actionNotice, null);
    equal('the pending action is cleared', useDesktopStore.getState().pendingAction, null);

    resetStore();
    nextResponse = { status: 401, body: {} };
    const unauthorised = await useDesktopStore.getState().openLogFile();
    equal('an unauthenticated launch fails', unauthorised, false);
    check('and asks the operator to sign in', (useDesktopStore.getState().error || '').includes('Sign in'));

    resetStore();
    nextNetworkError = 'Failed to fetch';
    const unreachable = await useDesktopStore.getState().openDataDirectory();
    equal('an unreachable Core fails', unreachable, false);
    equal('without leaving the button spinning', useDesktopStore.getState().pendingAction, null);
  }

  describe('useDesktopStore — the test notification');
  {
    resetStore();
    nextResponse = { status: 200, body: { success: true, dispatched: true } };
    const sent = await useDesktopStore.getState().sendTestNotification();

    equal('it posts to the notify endpoint', requests[0].url, '/api/v1/desktop/notify');
    equal('with a POST', requests[0].method, 'POST');
    equal('declaring JSON', requests[0].headers['Content-Type'], 'application/json');
    const body = requests[0].body as { title: string; body: string; type: string };
    check('a title is sent, which the route requires', typeof body.title === 'string' && body.title.length > 0);
    check('so is a body', typeof body.body === 'string' && body.body.length > 0);
    equal('and the default kind is the informational one', body.type, 'SYSTEM');
    equal('the call reports success', sent, true);
    check('with a confirmation', (useDesktopStore.getState().actionNotice || '').includes('sent to your desktop'));

    resetStore();
    nextResponse = { status: 200, body: { success: true, dispatched: true } };
    await useDesktopStore.getState().sendTestNotification('APPROVAL_REQUIRED');
    equal(
      'an explicit kind is passed through, so urgency is the Core’s to decide',
      (requests[0].body as { type: string }).type,
      'APPROVAL_REQUIRED'
    );

    resetStore();
    // A headless host answers 200, success, dispatched: false — by design.
    nextResponse = { status: 200, body: { success: true, dispatched: false, skipped: 'HEADLESS' } };
    const skipped = await useDesktopStore.getState().sendTestNotification();
    equal('a skipped toast is not a failed request', skipped, true);
    check(
      'and the reason is shown, since nothing appeared on screen',
      (useDesktopStore.getState().actionNotice || '').includes('no desktop session')
    );
    equal('with no error banner', useDesktopStore.getState().error, null);

    resetStore();
    nextResponse = { status: 400, body: { error: 'title is required' } };
    const rejected = await useDesktopStore.getState().sendTestNotification();
    equal('a rejected notification reports failure', rejected, false);
    check('with the Core’s message', (useDesktopStore.getState().error || '').includes('title is required'));
    equal('and the button is released', useDesktopStore.getState().pendingAction, null);
  }

  describe('useDesktopStore — clearing');
  {
    resetStore();
    useDesktopStore.setState({ error: 'something failed', actionNotice: 'something happened' });
    useDesktopStore.getState().clearError();
    equal('an error can be dismissed', useDesktopStore.getState().error, null);
    equal('without taking the notice with it', useDesktopStore.getState().actionNotice, 'something happened');
    useDesktopStore.getState().clearNotice();
    equal('and the notice can be dismissed on its own', useDesktopStore.getState().actionNotice, null);
  }

  describe('useDesktopStore — no action sends a path the client chose');
  {
    resetStore();
    nextResponse = { status: 200, body: { success: true } };
    await useDesktopStore.getState().openDataDirectory();
    nextResponse = { status: 200, body: { success: true } };
    await useDesktopStore.getState().openLogFile();
    nextResponse = { status: 200, body: { success: true, dispatched: true } };
    await useDesktopStore.getState().sendTestNotification();
    nextResponse = { status: 200, body: { success: true, enabled: true } };
    await useDesktopStore.getState().toggleAutoStart(true);

    const serialised = JSON.stringify(requests.map(r => r.body));
    check('no request carries a path', !serialised.includes('/'));
    check('nor a command', !/command|argv|exec/i.test(serialised));
    check(
      'and every one of them was authenticated',
      requests.every(r => r.headers.Authorization === 'Bearer test-token')
    );
  }

  // --- Rendering -------------------------------------------------------------
  describe('DesktopDaemonCardView renders a healthy daemon');
  {
    const online = renderCard({ status: desktopStatus() });
    check('the card is labelled', online.includes('Workstation Daemon'));
    check('as a region', online.includes('aria-label="Workstation desktop daemon"'));
    check('the state badge is explicit', online.includes('Daemon online'));
    check('in green', online.includes('var(--color-state-completed)'));
    check('the Core’s own tooltip is the detail', online.includes('2 active threads, 3 MCP'));
    check('the platform is named', online.includes('linux'));
    check('threads are counted', online.includes('Active threads'));
    check('MCP servers are counted', online.includes('3 running'));
    check('the vault is badged', online.includes('ENCRYPTED'));
    check('memory is shown in megabytes', online.includes('182 MB'));
    check('uptime is a duration, not a second count', online.includes('4h 12m') && !online.includes('15120'));
    check('the data directory is shown', online.includes('/home/dev/.asterim'));
    check('a refresh is offered when one is wired', online.includes('aria-label="Refresh desktop daemon status"'));
    check('and the headless badge is absent', !online.includes('Headless / CI'));

    const noRefresh = renderCard({ status: desktopStatus(), onRefresh: undefined });
    check('the refresh is omitted when it is not', !noRefresh.includes('Refresh desktop daemon status'));
  }

  describe('DesktopDaemonCardView renders the unhappy states');
  {
    const paused = renderCard({
      status: desktopStatus({}, { state: 'PAUSED', label: 'Asterim — paused, 0 active threads, 0 MCP', activeThreads: 0 })
    });
    check('a paused daemon says so', paused.includes('Daemon paused'));
    check('in amber', paused.includes('var(--color-state-paused)'));
    check('and does not claim to be online', !paused.includes('Daemon online'));

    const offline = renderCard({
      status: desktopStatus({}, { state: 'OFFLINE', label: 'Asterim — unavailable', vault: 'UNAVAILABLE' })
    });
    check('an offline daemon says so', offline.includes('Daemon offline'));
    check('in red', offline.includes('var(--color-state-error)'));
    check('and the vault reads as unavailable rather than encrypted', offline.includes('UNAVAILABLE'));

    const plaintext = renderCard({ status: desktopStatus({}, { vault: 'PLAINTEXT' }) });
    check('a plaintext vault is badged', plaintext.includes('PLAINTEXT'));
    check('as a warning', plaintext.includes('var(--color-state-paused)'));

    const empty = renderCard({ status: null });
    check('no status reads as unavailable', empty.includes('Daemon status unavailable'));
    check('and offers no action it cannot perform', !empty.includes('Reveal Data Directory'));

    const loading = renderCard({ isLoading: true });
    check('loading is visible', loading.includes('Reading daemon status'));
  }

  describe('DesktopDaemonCardView renders the headless case');
  {
    const headless = renderCard({ status: desktopStatus({ isHeadless: true }) });
    check('the headless badge is shown', headless.includes('Headless / CI'));
    check('the metrics are still rendered — a headless Core is a working Core', headless.includes('182 MB'));
    check('the data folder is still offered', headless.includes('Reveal Data Directory'));
    check(
      'but the notification test is disabled, since there is nothing to show it on',
      buttonFor(headless, 'Test OS Notification').includes('disabled=""')
    );
    check(
      'while the two launch actions, which do not need a display, stay live',
      !buttonFor(headless, 'Reveal Data Directory').includes('disabled=""') &&
        !buttonFor(headless, 'View Server Log').includes('disabled=""')
    );
  }

  describe('DesktopDaemonCardView renders the auto-start switch');
  {
    const off = renderCard({ status: desktopStatus({ autoStartEnabled: false }) });
    check('the switch is labelled', off.includes('Start at login'));
    check('as a switch for assistive technology', off.includes('role="switch"'));
    check('reading off', off.includes('aria-checked="false"'));
    check('and the platform mechanism is named', off.includes('XDG autostart entry'));
    check('with the current registration state', off.includes('not registered'));

    const on = renderCard({ status: desktopStatus({ autoStartEnabled: true }) });
    check('an enabled switch reads on', on.includes('aria-checked="true"'));
    check('and says it is registered', on.includes('· registered'));

    const windows = renderCard({ status: desktopStatus({ platform: 'win32', autoStartEnabled: true }) });
    check('Windows names the Run key', windows.includes('Registry (HKCU Run key)'));
    const mac = renderCard({ status: desktopStatus({ platform: 'darwin' }) });
    check('macOS names the LaunchAgent', mac.includes('LaunchAgent'));

    const unsupported = renderCard({ status: desktopStatus({ platform: 'unsupported' }) });
    check('a platform without a mechanism says so', unsupported.includes('No login-item mechanism'));
    check('and its switch is disabled rather than lying', unsupported.includes('disabled=""'));

    const toggling = renderCard({ status: desktopStatus(), isTogglingAutoStart: true });
    check('a toggle in flight disables the switch', toggling.includes('disabled=""'));
  }

  describe('DesktopDaemonCardView renders the quick actions');
  {
    const ready = renderCard({ status: desktopStatus() });
    check('the data folder action is offered', ready.includes('Reveal Data Directory'));
    check('so is the log', ready.includes('View Server Log'));
    check('and the notification test', ready.includes('Test OS Notification'));
    check(
      'none of them is disabled once the daemon has answered',
      !ready.includes('disabled=""')
    );

    const pending = renderCard({ status: desktopStatus(), pendingAction: 'open-data-dir' });
    check('the pending action shows progress', pending.includes('Opening…'));
    check('marked busy for assistive technology', buttonFor(pending, 'Opening…').includes('aria-busy="true"'));
    check(
      'and the others are disabled while it runs, so two launches cannot race',
      buttonFor(pending, 'View Server Log').includes('disabled=""') &&
        buttonFor(pending, 'Test OS Notification').includes('disabled=""')
    );
    check('while the label of the idle notification button is untouched', pending.includes('Test OS Notification'));

    const sending = renderCard({ status: desktopStatus(), pendingAction: 'notify' });
    check('a notification in flight has its own wording', sending.includes('Sending…'));
    check('and does not claim to be opening anything', !sending.includes('Opening…'));
  }

  describe('DesktopDaemonCardView surfaces failures and notices');
  {
    const failedCard = renderCard({ status: desktopStatus(), error: 'no file manager launcher on unsupported' });
    check('the Core’s reason is shown', failedCard.includes('no file manager launcher'));
    check('as an alert', failedCard.includes('role="alert"'));

    const noticed = renderCard({ status: desktopStatus(), notice: 'The data folder was opened in your file manager.' });
    check('a notice is shown', noticed.includes('The data folder was opened'));
    check('as a status region, not an alert', noticed.includes('role="status"') && !noticed.includes('role="alert"'));

    const both = renderCard({
      status: desktopStatus(),
      error: 'The request failed.',
      notice: 'The data folder was opened in your file manager.'
    });
    check('an error outranks a stale notice', both.includes('The request failed.'));
    check('so the card never says a thing worked and failed at once', !both.includes('The data folder was opened'));
  }

  describe('DesktopDaemonCardView uses design tokens, not hex values');
  {
    const rendered = renderCard({ status: desktopStatus({ isHeadless: true, autoStartEnabled: true }) });
    check('surfaces are tokens', rendered.includes('var(--color-surface-1)') && rendered.includes('var(--color-surface-2)'));
    check('borders are tokens', rendered.includes('var(--color-border-default)'));
    check('the accent is the token', rendered.includes('var(--color-accent-primary)'));
    check(
      'and no colour is hardcoded',
      !/#[0-9a-fA-F]{6}\b/.test(rendered) && !/rgba?\(\s*\d/.test(rendered)
    );
  }

  describe('the literal bodies a running Core returns');
  {
    // The shape `apps/server/src/routes/desktop.ts` sends, written out in full
    // rather than built from the fixture, so a change to the Core's contract
    // that this dashboard would misread fails here instead of in a browser.
    const statusBody = JSON.parse(
      '{"desktop":{"isHeadless":true,"platform":"linux","autoStartEnabled":false,"trayStatus":{"state":"ONLINE","label":"Asterim — online, 0 active threads, 0 MCP","activeThreads":0,"activeMcpServers":0,"vault":"ENCRYPTED","memoryMb":97,"uptimeSeconds":132},"activeAgentsCount":0,"vaultEncrypted":true,"webUrl":"http://localhost:3000","dataDir":"/home/dev/.asterim"},"menu":[{"id":"status","label":"Asterim — online, 0 active threads, 0 MCP","enabled":false,"readonly":true},{"id":"open-dashboard","label":"Open Dashboard","enabled":true},{"id":"open-data-dir","label":"Open Data Folder","enabled":true},{"id":"view-log","label":"View Server Log","enabled":true},{"id":"toggle-autostart","label":"Start at Login","enabled":true}]}'
    );
    const notifySkipped = JSON.parse('{"success":true,"dispatched":false,"skipped":"HEADLESS"}');
    const autostartBody = JSON.parse(
      '{"success":true,"enabled":true,"entryPath":"/home/dev/.config/autostart/asterim.desktop"}'
    );

    resetStore();
    nextResponse = { status: 200, body: statusBody };
    await useDesktopStore.getState().fetchStatus();
    const parsed = useDesktopStore.getState().status;
    equal('the real status parses', parsed?.platform, 'linux');
    equal('the headless flag comes through', parsed?.isHeadless, true);
    equal('and the tray state', parsed?.trayStatus.state, 'ONLINE');
    equal('the menu comes through whole', useDesktopStore.getState().menu.length, 5);

    const realCard = renderCard({ status: parsed });
    check('and the card renders it', realCard.includes('Daemon online'));
    check('with the real memory figure', realCard.includes('97 MB'));
    check('the real uptime as a duration', realCard.includes('2m 12s'));
    check('and the headless badge the real Core reported', realCard.includes('Headless / CI'));

    resetStore();
    nextResponse = { status: 200, body: notifySkipped };
    const skipped = await useDesktopStore.getState().sendTestNotification();
    equal('the real headless notify body is not a failure', skipped, true);
    check(
      'and reads as skipped',
      (useDesktopStore.getState().actionNotice || '').includes('no desktop session')
    );

    resetStore();
    useDesktopStore.setState({ status: desktopStatus() });
    nextResponse = { status: 200, body: autostartBody };
    await useDesktopStore.getState().toggleAutoStart(true);
    equal('the real autostart body flips the switch', useDesktopStore.getState().status?.autoStartEnabled, true);
    check(
      'and names the real entry path',
      (useDesktopStore.getState().actionNotice || '').includes('asterim.desktop')
    );
  }

  describe('DesktopDaemonCardView carries nothing private');
  {
    const rendered = renderCard({ status: desktopStatus({ autoStartEnabled: true }) });
    check('the data directory is a path, which is what it is for', rendered.includes('/home/dev/.asterim'));
    check('no token appears', !rendered.includes('test-token') && !rendered.includes('Bearer'));
    check('no vault envelope appears', !rendered.includes('vault:v1:'));
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
