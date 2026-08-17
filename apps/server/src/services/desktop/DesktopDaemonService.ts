/**
 * The desktop daemon: tray state, native launchers, login auto-start (P10-01).
 *
 * Asterim's Core is a background service that happens to have been started from
 * a terminal. This is the part that makes it behave like one — a status a tray
 * or menu-bar item can render without knowing anything about SQLite or the
 * EventBus, the three "open this for me" actions such a menu offers, and an
 * entry in the OS login items so the developer stops starting it by hand.
 *
 * Everything here is pure Node plus a CLI the platform already ships. There is
 * deliberately no tray *widget* in this process: drawing one needs a GUI
 * toolkit, which needs a native addon, which the Core is not allowed to grow
 * (`tasks/current.md` § 5). What the Core owns is the *state and the commands*;
 * a shell — the dashboard's tray card today, a packaged native shell later —
 * renders them.
 *
 * Two habits run through the file:
 *
 * - **Nothing throws.** A status assembled while the database is being rebuilt
 *   reports `OFFLINE` rather than 500ing the route. Every launcher resolves a
 *   boolean. The daemon layer is a convenience; it must never be the reason the
 *   Core stops answering.
 * - **Every OS-specific decision is a pure function.** `buildAutoStartPlan`,
 *   `buildOpenCommand` and the entry bodies take the platform as an argument
 *   and return data, so the Windows registry path and the macOS plist are
 *   asserted on from a Linux CI runner rather than assumed.
 */

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  DESKTOP_APP_NAME,
  DESKTOP_AUTOSTART_ID,
  DESKTOP_LAUNCH_AGENT_FILE,
  DESKTOP_REGISTRY_RUN_KEY,
  DESKTOP_REGISTRY_VALUE_NAME,
  DESKTOP_XDG_AUTOSTART_FILE,
  dataDirNameForChannel,
  defaultPortForChannel,
  type DesktopLaunchCommand,
  type DesktopPlatform,
  type DesktopStatus,
  type DesktopTrayMenuItem,
  type DesktopTrayState,
  type DesktopTrayStatus,
  type DesktopVaultState
} from '@asterim/shared';
import { dbService, resolveDataDir } from '../DatabaseService';
import { getAsterimChannel } from '../../utils/channel';
import { secretVault } from '../security/SecretVaultService';
import { normalizePlatform } from './DesktopNotificationService';

/** How long a launcher or a `reg` invocation is given before it is abandoned. */
export const DESKTOP_COMMAND_TIMEOUT_MS = 10000;

/** The file `initLogger` writes the Core's console output to. */
export const SERVER_LOG_FILENAME = 'server.log';

/** Where auto-start is written, and how it is checked. */
export type AutoStartMechanism = 'registry' | 'launch-agent' | 'xdg-autostart' | 'none';

/**
 * Everything needed to install, remove or detect the login entry on one
 * platform, as data.
 *
 * `file` and `contents` describe the two platforms that write a file;
 * `install`/`remove`/`query` describe the one that shells out to `reg`. A
 * platform uses one or the other, never both, and `unsupported` has neither —
 * which is what makes "auto-start is unavailable here" a state rather than a
 * failure.
 */
export interface AutoStartPlan {
  mechanism: AutoStartMechanism;
  /** The entry file, for `launch-agent` and `xdg-autostart`. */
  file?: string;
  /** What that file contains. */
  contents?: string;
  /** For `registry`: the commands that add, remove and read the value. */
  install?: DesktopLaunchCommand;
  remove?: DesktopLaunchCommand;
  query?: DesktopLaunchCommand;
}

/** Runs a command; resolves the exit status without ever rejecting. */
export type DesktopCommandRunner = (
  command: DesktopLaunchCommand
) => Promise<{ ok: boolean; stdout: string }>;

export interface DesktopDaemonServiceOptions {
  platform?: DesktopPlatform;
  /** Defaults to `os.homedir()`. */
  homeDir?: string;
  /** Defaults to `resolveDataDir()`, honouring `ASTERIM_DATA_DIR`. */
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  run?: DesktopCommandRunner;
  /**
   * The argv the login entry should re-launch. Defaults to this process's
   * interpreter and entry script, which is what makes an entry written by a
   * `pnpm dev` run point at the checkout and one written by the packaged binary
   * point at the binary.
   */
  launchArgv?: string[];
  /** Test seams for the two live counters. */
  countActiveThreads?: () => number;
  countActiveMcpServers?: () => number;
  getVaultState?: () => DesktopVaultState;
  uptimeSeconds?: () => number;
  memoryBytes?: () => number;
}

/**
 * Quotes one argv element for a Windows registry value.
 *
 * The Run key holds a single command line that the shell re-splits at login, so
 * unlike everywhere else in this file the argument boundaries have to survive
 * as text. A path containing a space — `C:\Program Files\...` — is the normal
 * case, not the exotic one.
 */
function quoteForWindowsCommandLine(part: string): string {
  return /[\s"]/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part;
}

/**
 * Escapes for an XML text node, used by the macOS plist.
 *
 * A home directory can legally contain `&`. Writing it raw produces a plist
 * `launchd` refuses to parse, which fails silently at login — the worst kind of
 * failure this subsystem can have.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The macOS LaunchAgent that starts the Core at login and keeps it up. */
export function buildLaunchAgentPlist(argv: string[]): string {
  const args = argv.map(part => `    <string>${escapeXml(part)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${DESKTOP_AUTOSTART_ID}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

/**
 * The XDG desktop entry Linux session managers read out of `~/.config/autostart`.
 *
 * `Terminal=false` and `NoDisplay=true` keep it out of the application menu:
 * this is a background service, not something to launch twice by clicking it.
 */
export function buildXdgAutostartEntry(argv: string[]): string {
  const exec = argv.map(part => (/\s/.test(part) ? `"${part}"` : part)).join(' ');
  return `[Desktop Entry]
Type=Application
Version=1.0
Name=${DESKTOP_APP_NAME}
Comment=Asterim local-first AI engineering Core
Exec=${exec}
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
`;
}

/**
 * What auto-start looks like on one platform, given a home directory and the
 * argv to relaunch. Pure: writes nothing, runs nothing.
 */
export function buildAutoStartPlan(
  platform: DesktopPlatform,
  homeDir: string,
  argv: string[]
): AutoStartPlan {
  switch (platform) {
    case 'win32': {
      const commandLine = argv.map(quoteForWindowsCommandLine).join(' ');
      return {
        mechanism: 'registry',
        install: {
          command: 'reg',
          args: [
            'add',
            DESKTOP_REGISTRY_RUN_KEY,
            '/v',
            DESKTOP_REGISTRY_VALUE_NAME,
            '/t',
            'REG_SZ',
            '/d',
            commandLine,
            '/f'
          ],
          purpose: 'add HKCU Run value'
        },
        remove: {
          command: 'reg',
          args: ['delete', DESKTOP_REGISTRY_RUN_KEY, '/v', DESKTOP_REGISTRY_VALUE_NAME, '/f'],
          purpose: 'delete HKCU Run value'
        },
        query: {
          command: 'reg',
          args: ['query', DESKTOP_REGISTRY_RUN_KEY, '/v', DESKTOP_REGISTRY_VALUE_NAME],
          purpose: 'read HKCU Run value'
        }
      };
    }

    case 'darwin':
      return {
        mechanism: 'launch-agent',
        file: path.join(homeDir, 'Library', 'LaunchAgents', DESKTOP_LAUNCH_AGENT_FILE),
        contents: buildLaunchAgentPlist(argv)
      };

    case 'linux':
      return {
        mechanism: 'xdg-autostart',
        file: path.join(homeDir, '.config', 'autostart', DESKTOP_XDG_AUTOSTART_FILE),
        contents: buildXdgAutostartEntry(argv)
      };

    default:
      return { mechanism: 'none' };
  }
}

/**
 * The command that hands a URL or a path to whatever the OS has registered for
 * it. `null` where there is nothing to hand it to.
 *
 * Windows splits: `explorer.exe` is the right way to reveal a folder or a file,
 * but it does not open a URL in the default browser — `cmd /c start` does, and
 * its first quoted argument is the window title, which is why the empty string
 * is there rather than by accident.
 */
export function buildOpenCommand(
  platform: DesktopPlatform,
  target: string,
  kind: 'url' | 'path'
): DesktopLaunchCommand | null {
  switch (platform) {
    case 'win32':
      return kind === 'url'
        ? { command: 'cmd.exe', args: ['/c', 'start', '', target], purpose: 'open url' }
        : { command: 'explorer.exe', args: [target], purpose: 'reveal path' };
    case 'darwin':
      return { command: 'open', args: [target], purpose: kind === 'url' ? 'open url' : 'open path' };
    case 'linux':
      return {
        command: 'xdg-open',
        args: [target],
        purpose: kind === 'url' ? 'open url' : 'open path'
      };
    default:
      return null;
  }
}

export class DesktopDaemonService {
  private readonly platform: DesktopPlatform;
  private readonly homeDirOverride?: string;
  private readonly dataDirOverride?: string;
  private readonly envSource?: NodeJS.ProcessEnv;
  private readonly runner: DesktopCommandRunner;
  private readonly launchArgvOverride?: string[];
  private readonly countThreads: () => number;
  private readonly countMcpServers: () => number;
  private readonly vaultState: () => DesktopVaultState;
  private readonly uptime: () => number;
  private readonly memory: () => number;

  /**
   * Whether the Core is deliberately idle.
   *
   * The tray protocol distinguishes a Core that is up and working from one that
   * is up and holding, so the state has to live somewhere; this is it. Nothing
   * in the Core sets it yet — the surface exists so a tray shell has a state to
   * drive rather than inventing one client-side.
   */
  private paused = false;

  /**
   * The last authoritative answer from `getAutoStart`.
   *
   * `getStatus` is synchronous by contract, and on Windows the only truthful
   * answer involves spawning `reg`. Rather than block a status call on a child
   * process, the answer is cached and refreshed by every `getAutoStart` and
   * every successful `setAutoStart`; the REST route refreshes before reading.
   */
  private autoStartCache = false;

  constructor(options: DesktopDaemonServiceOptions = {}) {
    this.platform = options.platform ?? normalizePlatform(process.platform);
    this.homeDirOverride = options.homeDir;
    this.dataDirOverride = options.dataDir;
    this.envSource = options.env;
    this.runner = options.run ?? defaultRunner;
    this.launchArgvOverride = options.launchArgv;
    this.countThreads = options.countActiveThreads ?? (() => this.countRunningSessions());
    this.countMcpServers = options.countActiveMcpServers ?? (() => countRunningMcpServers());
    this.vaultState = options.getVaultState ?? (() => readVaultState());
    this.uptime = options.uptimeSeconds ?? (() => Math.floor(process.uptime()));
    this.memory = options.memoryBytes ?? (() => process.memoryUsage().rss);
  }

  private env(): NodeJS.ProcessEnv {
    return this.envSource ?? process.env;
  }

  public getPlatform(): DesktopPlatform {
    return this.platform;
  }

  public homeDirectory(): string {
    return this.homeDirOverride ?? os.homedir();
  }

  /** The resolved `~/.asterim`. */
  public dataDirectory(): string {
    return this.dataDirOverride ?? resolveDataDir();
  }

  /**
   * Where the Core's console output is.
   *
   * `initLogger` writes into the channel's data directory, so a run with
   * `ASTERIM_DATA_DIR` pointed elsewhere is checked first: if a log is there it
   * is the one that run produced. The fallback is the channel's home-relative
   * directory — `~/.asterim` on stable, `~/.asterim-dev` on development — never
   * the other channel's (DEC-029).
   */
  public logFilePath(): string {
    const inDataDir = path.join(this.dataDirectory(), SERVER_LOG_FILENAME);
    try {
      if (fs.existsSync(inDataDir)) return inDataDir;
    } catch {
      /* an unreadable data directory falls through to the default location. */
    }
    return path.join(
      this.homeDirectory(),
      dataDirNameForChannel(getAsterimChannel()),
      SERVER_LOG_FILENAME
    );
  }

  /** Where this machine serves the dashboard. */
  public webUrl(): string {
    // Without an explicit PORT the channel decides, so the tray on a development
    // Core opens 3001 rather than whatever the stable one is serving.
    const port = this.env().PORT || String(defaultPortForChannel(getAsterimChannel()));
    return `http://localhost:${port}`;
  }

  /** The argv a login entry re-launches. See `launchArgv` in the options. */
  public launchArgv(): string[] {
    if (this.launchArgvOverride) return this.launchArgvOverride;
    const script = process.argv[1];
    return script ? [process.execPath, script] : [process.execPath];
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** The auto-start plan for this host. Pure; nothing is written or run. */
  public autoStartPlan(): AutoStartPlan {
    return buildAutoStartPlan(this.platform, this.homeDirectory(), this.launchArgv());
  }

  /** The file the login entry lives in, where the platform uses one. */
  public autoStartEntryPath(): string | undefined {
    return this.autoStartPlan().file;
  }

  /**
   * Whether Asterim is registered to start at login.
   *
   * Never throws: an unreadable `~/.config` or a `reg` that is not on PATH both
   * read as "not configured", which is the answer that leads a caller to try
   * writing the entry rather than to give up.
   */
  public async getAutoStart(): Promise<boolean> {
    const plan = this.autoStartPlan();
    let enabled = false;

    try {
      if (plan.mechanism === 'registry' && plan.query) {
        const { ok, stdout } = await this.runner(plan.query);
        // `reg query` exits 1 when the value is absent, so the exit status is
        // the answer; the name check guards against a shell that reports success
        // for an empty result set.
        enabled = ok && stdout.includes(DESKTOP_REGISTRY_VALUE_NAME);
      } else if (plan.file) {
        enabled = fs.existsSync(plan.file);
      }
    } catch {
      enabled = false;
    }

    this.autoStartCache = enabled;
    return enabled;
  }

  /**
   * Registers or removes the login entry.
   *
   * Returns the state auto-start is actually in afterwards, not the state that
   * was asked for — a caller that gets `false` back from `setAutoStart(true)`
   * knows the entry was not written, which is the whole point of returning
   * anything.
   */
  public async setAutoStart(enabled: boolean): Promise<boolean> {
    const plan = this.autoStartPlan();

    try {
      if (plan.mechanism === 'none') {
        this.autoStartCache = false;
        return false;
      }

      if (plan.mechanism === 'registry') {
        const command = enabled ? plan.install : plan.remove;
        if (!command) return this.autoStartCache;
        const { ok } = await this.runner(command);
        // Removing a value that is not there exits non-zero and is not a
        // failure: the requested state — absent — already holds.
        if (!ok && enabled) {
          this.autoStartCache = false;
          return false;
        }
        this.autoStartCache = enabled;
        return enabled;
      }

      const file = plan.file!;
      if (enabled) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, plan.contents ?? '', { mode: 0o644 });
      } else if (fs.existsSync(file)) {
        fs.rmSync(file);
      }
      this.autoStartCache = enabled;
      return enabled;
    } catch (err) {
      console.error(
        `[DesktopDaemon] Could not ${enabled ? 'enable' : 'disable'} auto-start:`,
        (err as Error).message
      );
      // Re-read rather than assume: a partial write may have left the entry in
      // place, and reporting the wrong state is worse than reporting a failure.
      return this.getAutoStart();
    }
  }

  /** Opens the dashboard in the default browser. */
  public async openDashboard(): Promise<boolean> {
    return this.launch(buildOpenCommand(this.platform, this.webUrl(), 'url'));
  }

  /** Reveals `~/.asterim` in the native file manager, creating it if absent. */
  public async openDataDirectory(): Promise<boolean> {
    const dir = this.dataDirectory();
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch {
      /* an explorer pointed at a missing directory simply opens nothing. */
    }
    return this.launch(buildOpenCommand(this.platform, dir, 'path'));
  }

  /** Opens `server.log` in whatever the OS has registered for a `.log`. */
  public async openLogFile(): Promise<boolean> {
    const file = this.logFilePath();
    if (!fs.existsSync(file)) return false;
    return this.launch(buildOpenCommand(this.platform, file, 'path'));
  }

  /** The rows a tray or menu-bar menu draws. */
  public getTrayMenu(): DesktopTrayMenuItem[] {
    const tray = this.getTrayStatus();
    const canLaunch = this.platform !== 'unsupported';
    return [
      { id: 'status', label: tray.label, enabled: false, readonly: true },
      { id: 'open-dashboard', label: 'Open Dashboard', enabled: canLaunch },
      { id: 'open-data-dir', label: 'Open Data Folder', enabled: canLaunch },
      {
        id: 'view-log',
        label: 'View Server Log',
        // Disabled rather than hidden when the Core has not written one yet: a
        // menu whose rows move between runs is harder to use than one whose
        // rows are sometimes greyed out.
        enabled: canLaunch && fs.existsSync(this.logFilePath())
      },
      {
        id: 'toggle-autostart',
        label: this.autoStartCache ? 'Disable Start at Login' : 'Start at Login',
        enabled: this.autoStartPlan().mechanism !== 'none'
      }
    ];
  }

  /**
   * The live numbers behind the tray icon.
   *
   * Assembled defensively, one failure at a time: a database that cannot be
   * read costs the thread count and downgrades the state to `OFFLINE`, but the
   * vault badge and the memory figure are still true and still reported.
   */
  public getTrayStatus(): DesktopTrayStatus {
    let activeThreads = 0;
    let state: DesktopTrayState = this.paused ? 'PAUSED' : 'ONLINE';
    try {
      activeThreads = this.countThreads();
    } catch {
      state = 'OFFLINE';
    }

    // A supervisor or a vault that cannot answer is reported as zero and
    // `UNAVAILABLE` rather than taken as evidence the Core is down — neither of
    // them is what "the Core is serving requests" means.
    const activeMcpServers = attempt(() => this.countMcpServers(), 0);
    const vault = attempt<DesktopVaultState>(() => this.vaultState(), 'UNAVAILABLE');

    const memoryMb = Math.round(this.memory() / (1024 * 1024));
    const label =
      state === 'OFFLINE'
        ? `${DESKTOP_APP_NAME} — unavailable`
        : `${DESKTOP_APP_NAME} — ${state.toLowerCase()}, ${activeThreads} active ${
            activeThreads === 1 ? 'thread' : 'threads'
          }, ${activeMcpServers} MCP`;

    return {
      state,
      label,
      activeThreads,
      activeMcpServers,
      vault,
      memoryMb,
      uptimeSeconds: this.uptime()
    };
  }

  /**
   * Everything the status endpoint reports.
   *
   * Synchronous by contract, so `autoStartEnabled` is the cached answer — see
   * `autoStartCache`. Callers that need it fresh await `getAutoStart()` first,
   * which is exactly what the REST route does.
   */
  public getStatus(): DesktopStatus {
    const trayStatus = this.getTrayStatus();
    return {
      isHeadless: this.isHeadless(),
      platform: this.platform,
      autoStartEnabled: this.autoStartCache,
      trayStatus,
      activeAgentsCount: trayStatus.activeThreads,
      vaultEncrypted: trayStatus.vault === 'ENCRYPTED',
      webUrl: this.webUrl(),
      dataDir: this.dataDirectory()
    };
  }

  /**
   * Whether this host has a desktop session at all.
   *
   * The same rule the notification service applies, restated here rather than
   * routed through it so a status call never depends on a notification service
   * having been constructed.
   */
  public isHeadless(): boolean {
    const env = this.env();
    if (env.ASTERIM_HEADLESS === 'true') return true;
    if (env.ASTERIM_HEADLESS === 'false') return false;
    if (env.CI && env.CI !== 'false' && env.CI !== '0') return true;
    if (this.platform === 'unsupported') return true;
    if (this.platform === 'linux') return !env.DISPLAY && !env.WAYLAND_DISPLAY;
    return false;
  }

  /** Agent sessions the Core currently has running. */
  private countRunningSessions(): number {
    const row = dbService
      .getDb()
      .prepare("SELECT COUNT(*) AS count FROM sessions WHERE status = 'running'")
      .get() as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  /** Runs one launcher, or reports that this platform has none. */
  private async launch(command: DesktopLaunchCommand | null): Promise<boolean> {
    if (!command) return false;
    try {
      const { ok } = await this.runner(command);
      return ok;
    } catch {
      return false;
    }
  }
}

/** Runs a probe that is allowed to fail, substituting a fallback if it does. */
function attempt<T>(probe: () => T, fallback: T): T {
  try {
    return probe();
  } catch {
    return fallback;
  }
}

/**
 * The vault badge.
 *
 * `PLAINTEXT` is deliberately the verdict for "readable on disk *or*
 * unreadable by this machine's key" — both mean the encrypted-at-rest claim
 * does not hold for everything the vault owns, and a tray badge has one bit to
 * say it with.
 */
function readVaultState(): DesktopVaultState {
  try {
    const status = secretVault.getStatus();
    if (!status.ready) return 'UNAVAILABLE';
    return status.plaintextKeys === 0 && status.unreadableKeys === 0 ? 'ENCRYPTED' : 'PLAINTEXT';
  } catch {
    return 'UNAVAILABLE';
  }
}

/**
 * Supervised MCP servers currently up.
 *
 * Required lazily and inside a try: the supervisor owns child processes, and
 * importing it at module scope would mean a status call — or a test that only
 * wants the tray label — pulls that whole subsystem in.
 */
function countRunningMcpServers(): number {
  try {
    const { mcpProcessSupervisor } = require('../mcp/McpProcessSupervisor');
    const servers: Array<{ status?: string }> = mcpProcessSupervisor.listServers() ?? [];
    return servers.filter(server => server.status === 'RUNNING').length;
  } catch {
    return 0;
  }
}

/** `execFile` with the arguments as argv, never through a shell. */
const defaultRunner: DesktopCommandRunner = command =>
  new Promise(resolve => {
    try {
      execFile(
        command.command,
        command.args,
        { timeout: DESKTOP_COMMAND_TIMEOUT_MS, windowsHide: true },
        (error, stdout) => resolve({ ok: !error, stdout: String(stdout ?? '') })
      );
    } catch {
      resolve({ ok: false, stdout: '' });
    }
  });

export const desktopDaemonService = new DesktopDaemonService();
