/**
 * The native desktop daemon contract (P10-01).
 *
 * Asterim's Core already runs as a long-lived local process; what this describes
 * is the part of it a developer sees when the terminal window is closed — a
 * toast when an agent is blocked on a human, a tray entry that says whether the
 * Core is up, and an entry in the OS login items so neither of those depends on
 * remembering to start it.
 *
 * These types live here rather than in `apps/server` because the dashboard
 * renders the same status the tray does, and a second definition of "what
 * ONLINE means" or "which glyph is the vault badge" is how the two drift. As
 * with the security surface, nothing here can carry a credential: a status is
 * counts, enum states and paths, and a notification is a title and a body the
 * Core composed.
 *
 * The platform strings match `process.platform` values so a caller never has to
 * translate, and `unsupported` is a real state rather than an error — a BSD or
 * an unknown platform runs the Core perfectly well and simply has no desktop
 * integration, which is different from the integration being broken.
 */

/** The platforms with a native desktop integration, plus everything else. */
export type DesktopPlatform = 'win32' | 'darwin' | 'linux' | 'unsupported';

/**
 * What the tray icon says about the Core.
 *
 * `PAUSED` is a Core that is running and deliberately not acting — distinct
 * from `OFFLINE`, which is a Core that cannot answer for itself (its database
 * is unreachable). Collapsing the two would make a degraded daemon look like a
 * deliberate one.
 */
export type DesktopTrayState = 'ONLINE' | 'PAUSED' | 'OFFLINE';

/** The vault badge, as one word. See `VaultStatus` for the full picture. */
export type DesktopVaultState = 'ENCRYPTED' | 'PLAINTEXT' | 'UNAVAILABLE';

/**
 * Why a notification is being raised.
 *
 * The type decides urgency and how long the toast stays up, so it is part of
 * the contract rather than a label: `APPROVAL_REQUIRED` is a human blocking a
 * running agent and is shown as critical, while `SYSTEM` is informational.
 */
export type DesktopNotificationType =
  | 'APPROVAL_REQUIRED'
  | 'DELEGATION_COMPLETED'
  | 'PIPELINE_FAILED'
  | 'SYSTEM';

/** Freedesktop urgency levels, which the macOS and Windows paths also read. */
export type DesktopNotificationUrgency = 'low' | 'normal' | 'critical';

/** How loudly each kind of event is allowed to interrupt. */
export const DESKTOP_NOTIFICATION_URGENCY: Record<
  DesktopNotificationType,
  DesktopNotificationUrgency
> = {
  APPROVAL_REQUIRED: 'critical',
  DELEGATION_COMPLETED: 'normal',
  PIPELINE_FAILED: 'critical',
  SYSTEM: 'low'
};

/** The name every platform's notification and login entry is filed under. */
export const DESKTOP_APP_NAME = 'Asterim';

/**
 * The reverse-DNS identifier the login entry is registered as.
 *
 * One string, used as the macOS LaunchAgent label and file stem, so an entry
 * written by one version is found and removed by the next.
 */
export const DESKTOP_AUTOSTART_ID = 'io.asterim.desktop';

/** The HKCU key Windows reads at login. Values under it are launched once. */
export const DESKTOP_REGISTRY_RUN_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

/** The value name under the Run key. Also what removal looks for. */
export const DESKTOP_REGISTRY_VALUE_NAME = DESKTOP_APP_NAME;

/** `~/Library/LaunchAgents/<this>` on macOS. */
export const DESKTOP_LAUNCH_AGENT_FILE = `${DESKTOP_AUTOSTART_ID}.plist`;

/** `~/.config/autostart/<this>` on Linux, per the XDG autostart spec. */
export const DESKTOP_XDG_AUTOSTART_FILE = 'asterim.desktop';

/**
 * A process to run, already split into argv.
 *
 * Never a shell string: every one of these is handed to `execFile` with the
 * arguments as an array, so a notification body or a data-directory path
 * containing shell metacharacters is an argument and not a command.
 */
export interface DesktopLaunchCommand {
  command: string;
  args: string[];
  /** What this invocation is for, so a failure is legible in a log or a test. */
  purpose: string;
}

/** The live numbers behind the tray icon and its tooltip. */
export interface DesktopTrayStatus {
  state: DesktopTrayState;
  /** One line for the tooltip, composed by the Core so every surface agrees. */
  label: string;
  /** Agent sessions currently running. */
  activeThreads: number;
  /** Supervised MCP servers in `RUNNING`. */
  activeMcpServers: number;
  vault: DesktopVaultState;
  /** Resident set size of the Core process, in whole megabytes. */
  memoryMb: number;
  uptimeSeconds: number;
}

/** Everything `GET /api/v1/desktop/status` reports. Carries no credential. */
export interface DesktopStatus {
  /**
   * True when there is no desktop session to notify — CI, a headless server, or
   * a Linux box with neither an X nor a Wayland display. Notification dispatch
   * is skipped rather than attempted and failed.
   */
  isHeadless: boolean;
  platform: DesktopPlatform;
  autoStartEnabled: boolean;
  trayStatus: DesktopTrayStatus;
  activeAgentsCount: number;
  vaultEncrypted: boolean;
  /** Where the dashboard is served from on this machine. */
  webUrl: string;
  /** The resolved `~/.asterim`, honouring `ASTERIM_DATA_DIR`. */
  dataDir: string;
}

/** What the Core is asked to put on screen. */
export interface DesktopNotificationInput {
  title: string;
  body: string;
  type: DesktopNotificationType;
  /**
   * Where the toast would take the developer if their platform supported an
   * activation payload. Recorded and returned; not appended to the body.
   */
  actionUrl?: string;
}

/** The quick actions the tray menu offers. */
export type DesktopTrayActionId =
  | 'open-dashboard'
  | 'open-data-dir'
  | 'view-log'
  | 'toggle-autostart';

/** One row of the tray / menu-bar menu, as the Core describes it. */
export interface DesktopTrayMenuItem {
  id: DesktopTrayActionId | 'status';
  label: string;
  /** False when the platform cannot perform it — a menu still shows the row. */
  enabled: boolean;
  /** True for the non-actionable status header. */
  readonly?: boolean;
}

/** `GET /api/v1/desktop/status`. */
export interface DesktopStatusResponse {
  desktop: DesktopStatus;
  menu: DesktopTrayMenuItem[];
}

/** What every `POST /api/v1/desktop/*` action answers with. */
export interface DesktopActionResponse {
  success: boolean;
  /** Why it did not happen, when it did not. */
  reason?: string;
}

/** `POST /api/v1/desktop/notify`. */
export interface DesktopNotifyResponse extends DesktopActionResponse {
  /** False on a headless host, where the toast was skipped by design. */
  dispatched: boolean;
  skipped?: 'HEADLESS' | 'UNSUPPORTED_PLATFORM' | 'RATE_LIMITED';
}

/** `POST /api/v1/desktop/autostart`. */
export interface DesktopAutoStartResponse extends DesktopActionResponse {
  enabled: boolean;
  /** The file the entry lives in, when the platform uses one. */
  entryPath?: string;
}
