import { create } from 'zustand';
import type {
  DesktopActionResponse,
  DesktopAutoStartResponse,
  DesktopNotificationType,
  DesktopNotifyResponse,
  DesktopStatus,
  DesktopStatusResponse,
  DesktopTrayMenuItem
} from '@asterim/shared';
import { getAuthHeaders } from '../utils/auth';

/**
 * The native desktop daemon, as the dashboard sees it (P10-02).
 *
 * Every action here has an effect on the physical machine the Core runs on
 * rather than on its data — a file manager opens, a toast appears, an entry is
 * written to the OS login items — so each one is a deliberate request the
 * operator made, never something the store does on its own. `fetchStatus` is
 * the only read, and it is the only call a mount performs.
 *
 * The store holds no path the client chose. `dataDir` and `webUrl` arrive on a
 * status and are displayed; there is no field a caller could set to redirect
 * what `open-data-dir` or `open-log` launches, because the Core computes both
 * targets for itself and accepts no argument for either.
 *
 * Failure is kept in two places on purpose. `error` is what went wrong and stays
 * until it is cleared or the next request supersedes it; `actionNotice` is what
 * just happened and is what the operator reads after pressing a button whose
 * whole effect happens off-screen. A toast that was skipped on a headless host
 * is a notice, not an error — it is the designed behaviour of the endpoint.
 */

const DESKTOP_BASE = '/api/v1/desktop';

/** The quick actions, so a pending one can be named rather than merely counted. */
export type DesktopQuickAction = 'open-data-dir' | 'open-log' | 'notify';

interface DesktopState {
  status: DesktopStatus | null;
  menu: DesktopTrayMenuItem[];
  isLoading: boolean;
  isTogglingAutoStart: boolean;
  /** Which quick action is in flight, so only its own button shows progress. */
  pendingAction: DesktopQuickAction | null;
  error: string | null;
  actionNotice: string | null;

  fetchStatus: () => Promise<void>;
  toggleAutoStart: (enabled: boolean) => Promise<boolean>;
  openDataDirectory: () => Promise<boolean>;
  openLogFile: () => Promise<boolean>;
  sendTestNotification: (type?: DesktopNotificationType) => Promise<boolean>;
  clearError: () => void;
  clearNotice: () => void;
}

/** One shared empty menu, so a selector returns the same reference every read. */
const NO_MENU: DesktopTrayMenuItem[] = [];

/**
 * The Core's failure, in words an operator can act on.
 *
 * Branches on the status rather than the message, because the desktop routes
 * answer with a plain `error` string and no code: 401 and 403 are the two an
 * operator can actually do something about, and everything else is the Core's
 * own wording or a generic fallback.
 */
export function describeDesktopError(message: string | undefined, status?: number): string {
  if (status === 401) return 'Sign in to manage this workstation’s desktop daemon.';
  if (status === 403) return message || 'You do not have permission to control this workstation.';
  if (status === 404) return message || 'This Core does not expose the desktop daemon API.';
  return message || 'The request failed.';
}

/**
 * What a notification attempt should tell the operator.
 *
 * A skipped toast is the interesting case: nothing appears on screen, so
 * without this the button would read as broken on exactly the hosts where it is
 * behaving correctly.
 */
export function describeNotifyOutcome(result: Partial<DesktopNotifyResponse>): string {
  if (result.dispatched) return 'A test notification was sent to your desktop.';
  switch (result.skipped) {
    case 'HEADLESS':
      return 'This host has no desktop session, so the notification was skipped rather than attempted.';
    case 'UNSUPPORTED_PLATFORM':
      return 'This platform has no native notification mechanism.';
    case 'RATE_LIMITED':
      return 'A notification of this kind was just shown; the Core is rate-limiting it.';
    default:
      return result.reason || 'The notification was not shown.';
  }
}

/** Reads a response body without letting a non-JSON error page throw. */
async function readBody(res: Response): Promise<Record<string, unknown> & { error?: string }> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const useDesktopStore = create<DesktopState>(set => ({
  status: null,
  menu: NO_MENU,
  isLoading: false,
  isTogglingAutoStart: false,
  pendingAction: null,
  error: null,
  actionNotice: null,

  fetchStatus: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${DESKTOP_BASE}/status`, { headers: getAuthHeaders() });
      const body = (await readBody(res)) as Partial<DesktopStatusResponse> & { error?: string };
      if (!res.ok) {
        // The previously loaded status is left in place: a transient 500 should
        // not blank a card an operator is reading.
        set({ error: describeDesktopError(body.error, res.status), isLoading: false });
        return;
      }
      set({
        status: body.desktop ?? null,
        menu: body.menu ?? NO_MENU,
        isLoading: false
      });
    } catch (err) {
      set({ error: (err as Error).message || 'Could not reach the Core.', isLoading: false });
    }
  },

  toggleAutoStart: async (enabled: boolean) => {
    set({ isTogglingAutoStart: true, error: null, actionNotice: null });
    try {
      const res = await fetch(`${DESKTOP_BASE}/autostart`, {
        method: 'POST',
        headers: getAuthHeaders({ json: true }),
        body: JSON.stringify({ enabled })
      });
      const body = (await readBody(res)) as Partial<DesktopAutoStartResponse> & { error?: string };
      if (!res.ok) {
        set({ error: describeDesktopError(body.error, res.status), isTogglingAutoStart: false });
        return false;
      }

      // The Core's `enabled` is authoritative even when it disagrees with what
      // was asked: a platform with no auto-start mechanism answers `false` to a
      // request for `true`, and the switch must settle back rather than lie.
      const actual = typeof body.enabled === 'boolean' ? body.enabled : enabled;
      set(state => ({
        status: state.status ? { ...state.status, autoStartEnabled: actual } : state.status,
        isTogglingAutoStart: false,
        error: body.success === false ? describeDesktopError(body.reason, res.status) : null,
        actionNotice:
          body.success === false
            ? null
            : actual
              ? `Asterim will start automatically at login${body.entryPath ? ` (${body.entryPath})` : ''}.`
              : 'Asterim will no longer start automatically at login.'
      }));
      return body.success !== false;
    } catch (err) {
      set({
        error: (err as Error).message || 'Could not reach the Core.',
        isTogglingAutoStart: false
      });
      return false;
    }
  },

  openDataDirectory: async () => runAction(set, 'open-data-dir', 'open-data-dir', {
    ok: 'The data folder was opened in your file manager.',
    fallback: 'The data folder could not be opened on this platform.'
  }),

  openLogFile: async () => runAction(set, 'open-log', 'open-log', {
    ok: 'The server log was opened in your default editor.',
    fallback: 'The server log could not be opened.'
  }),

  sendTestNotification: async (type: DesktopNotificationType = 'SYSTEM') => {
    set({ pendingAction: 'notify', error: null, actionNotice: null });
    try {
      const res = await fetch(`${DESKTOP_BASE}/notify`, {
        method: 'POST',
        headers: getAuthHeaders({ json: true }),
        body: JSON.stringify({
          title: 'Asterim',
          body: 'This is a test notification from the Asterim dashboard.',
          type
        })
      });
      const body = (await readBody(res)) as Partial<DesktopNotifyResponse> & { error?: string };
      if (!res.ok) {
        set({ error: describeDesktopError(body.error, res.status), pendingAction: null });
        return false;
      }
      // A headless skip comes back 200 with `dispatched: false`, and the Core
      // still calls it a success — it is reported as a notice, not a failure.
      set({ pendingAction: null, actionNotice: describeNotifyOutcome(body) });
      return body.success !== false;
    } catch (err) {
      set({ error: (err as Error).message || 'Could not reach the Core.', pendingAction: null });
      return false;
    }
  },

  clearError: () => set({ error: null }),
  clearNotice: () => set({ actionNotice: null })
}));

/**
 * The two launch actions, which differ only in their endpoint and their wording.
 *
 * Written once rather than twice so a change to how a failed launch is reported
 * cannot apply to one of them and not the other.
 */
async function runAction(
  set: (partial: Partial<DesktopState>) => void,
  action: DesktopQuickAction,
  endpoint: string,
  messages: { ok: string; fallback: string }
): Promise<boolean> {
  set({ pendingAction: action, error: null, actionNotice: null });
  try {
    const res = await fetch(`${DESKTOP_BASE}/${endpoint}`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const body = (await readBody(res)) as Partial<DesktopActionResponse> & { error?: string };
    if (!res.ok) {
      set({ error: describeDesktopError(body.error, res.status), pendingAction: null });
      return false;
    }
    if (body.success === false) {
      // The Core answers 200 with a reason when the platform has no launcher.
      // That is a fact about the machine, not a failed request, but it is still
      // the thing that did not happen — so it goes on `error`.
      set({ error: body.reason || messages.fallback, pendingAction: null });
      return false;
    }
    set({ pendingAction: null, actionNotice: messages.ok });
    return true;
  } catch (err) {
    set({ error: (err as Error).message || 'Could not reach the Core.', pendingAction: null });
    return false;
  }
}
