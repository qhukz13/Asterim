/**
 * Native OS desktop notifications (P10-01).
 *
 * The developer is not watching the dashboard. An agent that stops on an
 * approval gate is stopped until someone notices, and "someone notices" is the
 * part Asterim has so far left to the developer's attention. This turns the
 * three moments that actually block or surprise a human — an approval request,
 * a delegation finishing, a verification pipeline failing — into a toast the OS
 * puts on screen.
 *
 * Three properties matter more than the feature itself:
 *
 * 1. **No native dependency.** Every platform is driven through a CLI that is
 *    already on it: `notify-send`, `osascript`, `powershell`. Adding a node-gyp
 *    addon to the Core would mean the `asterim` binary stops installing cleanly
 *    on a machine without a toolchain, which is a far worse trade than losing a
 *    toast on an exotic desktop.
 * 2. **Never a shell.** Titles and bodies contain whatever an agent printed.
 *    Commands are built as argv arrays and handed to `execFile`, so a body
 *    containing `; rm -rf ~` is a string argument. The two platforms whose CLI
 *    takes a script rather than arguments — macOS and Windows — get their
 *    interpolated values escaped for that specific language, and control
 *    characters stripped first.
 * 3. **Never fatal.** `notify` resolves `false`; it does not reject and it does
 *    not throw. A missing `notify-send`, a locked-down PowerShell policy, a
 *    headless CI runner — all of them are "no toast", never "the Core fell
 *    over". The EventBus subscriptions dispatch without awaiting for the same
 *    reason: an approval must reach the dashboard whether or not a toast does.
 */

import { execFile } from 'child_process';
import {
  DESKTOP_APP_NAME,
  DESKTOP_NOTIFICATION_URGENCY,
  type DelegationBatchCompletedPayload,
  type DelegationCompletedPayload,
  type ApprovalRequestPayload,
  type DesktopLaunchCommand,
  type DesktopNotificationInput,
  type DesktopNotificationType,
  type DesktopNotificationUrgency,
  type DesktopPlatform,
  DELEGATION_BATCH_COMPLETED_EVENT,
  DELEGATION_COMPLETED_EVENT
} from '@asterim/shared';
import { eventBus } from '../EventBus';

/** The event the Core publishes when an agent is blocked on a human. */
export const APPROVAL_REQUEST_EVENT = 'agent.approval_request';

/**
 * A toast the OS never rendered is still a process this one spawned. Beyond
 * this many characters nothing is displayed on any of the three platforms, so
 * the excess is only ever a bigger argv.
 */
export const MAX_NOTIFICATION_TITLE_CHARS = 120;
export const MAX_NOTIFICATION_BODY_CHARS = 400;

/**
 * The shortest gap between two toasts of the same kind.
 *
 * An agent working through a task can raise approval gates in bursts, and one
 * spawned process per gate is both a notification the developer will dismiss
 * without reading and a real cost. The first of a burst is shown; the rest are
 * dropped until the window passes. Per type, so a delegation finishing is never
 * suppressed by an unrelated approval storm.
 */
export const NOTIFICATION_COOLDOWN_MS = 1500;

/** How long a dispatch is given before it is abandoned. */
export const NOTIFICATION_TIMEOUT_MS = 5000;

/** Why a dispatch did not put anything on screen. */
export type NotificationSkipReason = 'HEADLESS' | 'UNSUPPORTED_PLATFORM' | 'RATE_LIMITED';

/** The outcome of one `notify` call, for the REST surface and for tests. */
export interface DesktopNotificationResult {
  dispatched: boolean;
  skipped?: NotificationSkipReason;
  /** Which command in the chain succeeded, when one did. */
  via?: string;
  reason?: string;
}

/** Runs a command, resolving false rather than rejecting. See `defaultRunner`. */
export type CommandRunner = (command: DesktopLaunchCommand) => Promise<boolean>;

export interface DesktopNotificationServiceOptions {
  /** Defaults to `process.platform`, normalised onto `DesktopPlatform`. */
  platform?: DesktopPlatform;
  /** Defaults to `process.env`. Read through, never captured at import time. */
  env?: NodeJS.ProcessEnv;
  /** Test seam: replaces `execFile` dispatch entirely. */
  run?: CommandRunner;
  /** Test seam for the cooldown window. */
  now?: () => number;
  cooldownMs?: number;
}

/** `process.platform` onto the four states the desktop layer knows. */
export function normalizePlatform(platform: string): DesktopPlatform {
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') return platform;
  return 'unsupported';
}

/**
 * Drops what no notification system renders and no script literal survives.
 *
 * Written as a codepoint filter rather than a character class so that no raw
 * control byte has to appear in this file to describe one. C0 (minus the
 * whitespace already folded into spaces above), DEL and C1 all go.
 */
function stripControlCharacters(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20) continue;
    if (code >= 0x7f && code <= 0x9f) continue;
    out += char;
  }
  return out;
}

/**
 * Normalises one line of notification text.
 *
 * Newlines become spaces — a body is one paragraph on every platform, and a
 * literal newline inside an AppleScript or PowerShell string literal would end
 * the statement rather than wrap the text.
 */
export function sanitizeNotificationText(text: string, maxChars: number): string {
  const folded = String(text ?? '').replace(/\s+/g, ' ');
  const collapsed = stripControlCharacters(folded).trim();
  return collapsed.length > maxChars ? `${collapsed.slice(0, maxChars - 1)}…` : collapsed;
}

/**
 * Escapes for an AppleScript string literal: backslash first, then the quote.
 * Doing it in the other order would re-escape the backslashes just inserted.
 */
export function escapeAppleScript(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Escapes for a single-quoted PowerShell string, where `'` is doubled. */
export function escapePowerShell(text: string): string {
  return text.replace(/'/g, "''");
}

/**
 * The commands that would show this notification, best first.
 *
 * A list rather than one command because the primary path is not universally
 * available: a Windows Server image without the WinRT toast stack, or a Linux
 * desktop running KDE's daemon without `notify-send` installed, still has a
 * second way to put something on screen. `notify` walks the list and stops at
 * the first that exits zero.
 *
 * Pure, and exported, because this is the part worth asserting on: a test can
 * check exactly what would be executed on Windows without being on Windows.
 */
export function buildNotificationCommands(
  input: DesktopNotificationInput,
  platform: DesktopPlatform
): DesktopLaunchCommand[] {
  const title = sanitizeNotificationText(input.title, MAX_NOTIFICATION_TITLE_CHARS);
  const body = sanitizeNotificationText(input.body, MAX_NOTIFICATION_BODY_CHARS);
  const urgency: DesktopNotificationUrgency =
    DESKTOP_NOTIFICATION_URGENCY[input.type] ?? DESKTOP_NOTIFICATION_URGENCY.SYSTEM;

  switch (platform) {
    case 'linux':
      return [
        {
          // Arguments, not a script: execFile passes argv straight to the
          // process, so a title that happens to begin with `-` or contain a
          // semicolon is still exactly one argument.
          command: 'notify-send',
          args: [
            '--app-name',
            DESKTOP_APP_NAME,
            '--urgency',
            urgency,
            '--expire-time',
            urgency === 'critical' ? '0' : '8000',
            title,
            body
          ],
          purpose: 'freedesktop notify-send'
        },
        {
          // KDE ships this when the Freedesktop CLI is absent.
          command: 'kdialog',
          args: ['--title', title, '--passivepopup', body, '8'],
          purpose: 'kdialog passive popup'
        }
      ];

    case 'darwin': {
      const script =
        `display notification "${escapeAppleScript(body)}"` +
        ` with title "${DESKTOP_APP_NAME}"` +
        ` subtitle "${escapeAppleScript(title)}"`;
      return [{ command: 'osascript', args: ['-e', script], purpose: 'osascript notification' }];
    }

    case 'win32': {
      const psTitle = escapePowerShell(title);
      const psBody = escapePowerShell(body);
      // WinRT toast: the real notification-centre entry, which is what a
      // developer expects on Windows 10/11. `> $null` on each statement that
      // returns a node keeps XML off stdout.
      const toast = [
        `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null`,
        `$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)`,
        `$nodes = $template.GetElementsByTagName('text')`,
        `$nodes.Item(0).AppendChild($template.CreateTextNode('${psTitle}')) > $null`,
        `$nodes.Item(1).AppendChild($template.CreateTextNode('${psBody}')) > $null`,
        `$toast = [Windows.UI.Notifications.ToastNotification]::new($template)`,
        `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${DESKTOP_APP_NAME}').Show($toast)`
      ].join('; ');
      // Balloon fallback for images where the WinRT namespace is unavailable.
      const balloon = [
        `Add-Type -AssemblyName System.Windows.Forms`,
        `$icon = New-Object System.Windows.Forms.NotifyIcon`,
        `$icon.Icon = [System.Drawing.SystemIcons]::Information`,
        `$icon.Visible = $true`,
        `$icon.ShowBalloonTip(8000, '${psTitle}', '${psBody}', [System.Windows.Forms.ToolTipIcon]::Info)`,
        `Start-Sleep -Seconds 1`,
        `$icon.Dispose()`
      ].join('; ');
      const shellArgs = (script: string) => [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script
      ];
      return [
        { command: 'powershell.exe', args: shellArgs(toast), purpose: 'WinRT toast' },
        { command: 'powershell.exe', args: shellArgs(balloon), purpose: 'NotifyIcon balloon' }
      ];
    }

    default:
      return [];
  }
}

export class DesktopNotificationService {
  private readonly platform: DesktopPlatform;
  private readonly envSource?: NodeJS.ProcessEnv;
  private readonly runner: CommandRunner;
  private readonly now: () => number;
  private readonly cooldownMs: number;

  /** When a toast of each type was last put on screen. */
  private readonly lastDispatchAt = new Map<DesktopNotificationType, number>();

  /** Subscriptions are registered once; `initEventBusListeners` is idempotent. */
  private listenersRegistered = false;

  /** Counters, for the status surface and for asserting in tests. */
  private dispatched = 0;
  private skipped = 0;
  private failed = 0;

  constructor(options: DesktopNotificationServiceOptions = {}) {
    this.platform = options.platform ?? normalizePlatform(process.platform);
    this.envSource = options.env;
    this.runner = options.run ?? defaultRunner;
    this.now = options.now ?? Date.now;
    this.cooldownMs = options.cooldownMs ?? NOTIFICATION_COOLDOWN_MS;
  }

  private env(): NodeJS.ProcessEnv {
    return this.envSource ?? process.env;
  }

  public getPlatform(): DesktopPlatform {
    return this.platform;
  }

  /**
   * Whether there is a desktop session to notify.
   *
   * `ASTERIM_HEADLESS` is authoritative in both directions — a developer running
   * the Core inside a container that does have a forwarded display sets it to
   * `false` and gets toasts. Otherwise: any CI runner is headless, and on Linux
   * the absence of both `DISPLAY` and `WAYLAND_DISPLAY` means there is no
   * session to deliver to, so `notify-send` would spawn only to fail.
   *
   * Read on every call rather than cached, because a service constructed at
   * import time predates anything a test or a launcher sets.
   */
  public isHeadless(): boolean {
    const env = this.env();
    const explicit = env.ASTERIM_HEADLESS;
    if (explicit === 'true') return true;
    if (explicit === 'false') return false;

    if (env.CI && env.CI !== 'false' && env.CI !== '0') return true;
    if (this.platform === 'unsupported') return true;
    if (this.platform === 'linux') return !env.DISPLAY && !env.WAYLAND_DISPLAY;
    return false;
  }

  /** What would be run for this input on this host. Never executes anything. */
  public buildCommands(input: DesktopNotificationInput): DesktopLaunchCommand[] {
    return buildNotificationCommands(input, this.platform);
  }

  public getStats(): { dispatched: number; skipped: number; failed: number } {
    return { dispatched: this.dispatched, skipped: this.skipped, failed: this.failed };
  }

  /** Test seam: forget the cooldown window and the counters. */
  public reset(): void {
    this.lastDispatchAt.clear();
    this.dispatched = 0;
    this.skipped = 0;
    this.failed = 0;
  }

  /**
   * Puts one notification on screen, or explains why it did not.
   *
   * Resolves `false` for every failure mode there is. The only thing a caller
   * has to know is that awaiting this can never be the reason a request handler
   * or an event listener throws.
   */
  public async notify(input: DesktopNotificationInput): Promise<boolean> {
    const result = await this.dispatch(input);
    return result.dispatched;
  }

  /** `notify`, with the reason attached. What the REST route reports. */
  public async dispatch(input: DesktopNotificationInput): Promise<DesktopNotificationResult> {
    try {
      const title = sanitizeNotificationText(input?.title ?? '', MAX_NOTIFICATION_TITLE_CHARS);
      const body = sanitizeNotificationText(input?.body ?? '', MAX_NOTIFICATION_BODY_CHARS);
      if (!title) {
        this.failed++;
        return { dispatched: false, reason: 'title is required' };
      }

      if (this.isHeadless()) {
        this.skipped++;
        return { dispatched: false, skipped: 'HEADLESS' };
      }

      const type: DesktopNotificationType = input.type ?? 'SYSTEM';
      const last = this.lastDispatchAt.get(type);
      const at = this.now();
      if (last !== undefined && at - last < this.cooldownMs) {
        this.skipped++;
        return { dispatched: false, skipped: 'RATE_LIMITED' };
      }

      const commands = this.buildCommands({ ...input, title, body, type });
      if (commands.length === 0) {
        this.skipped++;
        return { dispatched: false, skipped: 'UNSUPPORTED_PLATFORM' };
      }

      // Claimed before the first attempt: two approval events arriving in the
      // same tick would otherwise both pass the window check while the first is
      // still awaiting its child process.
      this.lastDispatchAt.set(type, at);

      for (const command of commands) {
        const ok = await this.runner(command);
        if (ok) {
          this.dispatched++;
          return { dispatched: true, via: command.purpose };
        }
      }

      // Nothing was shown, so the window must not suppress the next attempt.
      this.lastDispatchAt.delete(type);
      this.failed++;
      return {
        dispatched: false,
        reason: `no notification backend succeeded on ${this.platform}`
      };
    } catch (err) {
      this.failed++;
      return { dispatched: false, reason: (err as Error)?.message ?? 'unknown failure' };
    }
  }

  /**
   * Subscribes to the three moments worth interrupting a developer for.
   *
   * Every handler dispatches with `void` rather than awaiting: an EventBus
   * listener runs inside `publish`, and awaiting a spawned process there would
   * put a child process on the critical path of every approval the Core raises.
   */
  public initEventBusListeners(): void {
    if (this.listenersRegistered) return;
    this.listenersRegistered = true;

    eventBus.subscribe<ApprovalRequestPayload>(APPROVAL_REQUEST_EVENT, event => {
      void this.notify({
        type: 'APPROVAL_REQUIRED',
        title: 'Approval required',
        body: event?.payload?.description || 'An agent is waiting for your decision.',
        actionUrl: this.threadUrl(event?.payload)
      });
    });

    eventBus.subscribe<DelegationCompletedPayload>(DELEGATION_COMPLETED_EVENT, event => {
      const result = event?.payload?.result;
      if (!result) return;

      // A pipeline that ran and failed is the more urgent fact about a finished
      // child, so it is reported as that rather than as a completion.
      const report = (result as { verificationReport?: { passed: boolean; totalSteps: number } })
        .verificationReport;
      if (report && report.totalSteps > 0 && !report.passed) {
        void this.notify({
          type: 'PIPELINE_FAILED',
          title: 'Verification failed',
          body: `${result.summary || 'A delegated task finished'} — its verification pipeline did not pass.`,
          actionUrl: this.threadUrl(event.payload)
        });
        return;
      }

      void this.notify({
        type: 'DELEGATION_COMPLETED',
        title: `Delegation ${String(result.status ?? 'finished').toLowerCase()}`,
        body: result.summary || 'A delegated agent finished its task.',
        actionUrl: this.threadUrl(event.payload)
      });
    });

    eventBus.subscribe<DelegationBatchCompletedPayload>(DELEGATION_BATCH_COMPLETED_EVENT, event => {
      const batch = event?.payload?.batch as { results?: unknown[]; summary?: string } | undefined;
      if (!batch) return;
      const count = Array.isArray(batch.results) ? batch.results.length : 0;
      void this.notify({
        type: 'DELEGATION_COMPLETED',
        title: 'Batch delegation finished',
        body: batch.summary || `${count} delegated task${count === 1 ? '' : 's'} settled.`,
        actionUrl: this.threadUrl(event.payload)
      });
    });
  }

  /** Where the dashboard shows the thread an event came from, when it names one. */
  private threadUrl(payload?: { projectId?: string; threadId?: string }): string | undefined {
    if (!payload?.projectId || !payload?.threadId) return undefined;
    const port = this.env().PORT || '3000';
    return `http://localhost:${port}/workspace/project/${payload.projectId}/thread/${payload.threadId}`;
  }
}

/**
 * Spawns the command and reports whether it exited zero.
 *
 * `execFile`, so the arguments never reach a shell. `windowsHide` keeps the
 * PowerShell path from flashing a console window on every toast. Rejections are
 * swallowed here rather than propagated: an ENOENT for a missing `notify-send`
 * is the normal way this discovers which backend a host has.
 */
const defaultRunner: CommandRunner = command =>
  new Promise<boolean>(resolve => {
    try {
      execFile(
        command.command,
        command.args,
        { timeout: NOTIFICATION_TIMEOUT_MS, windowsHide: true },
        error => resolve(!error)
      );
    } catch {
      resolve(false);
    }
  });

export const desktopNotificationService = new DesktopNotificationService();
