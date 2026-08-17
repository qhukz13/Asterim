/**
 * Tests for the native desktop daemon (P10-01).
 *
 * The repository has no test runner (`docs/p5.0-01-verification-report.md` § 3),
 * so this is a standalone script with its own assertion harness, matching the
 * vault, verification, worktree, delegation, billing and pairing suites.
 *
 * What is real and what is not, deliberately:
 *
 * - **Real**: every filesystem effect. The macOS LaunchAgent and the Linux XDG
 *   entry are written into a temp home directory and read back, because the
 *   claim being made is that a real login entry appears at a real path with
 *   parseable contents.
 * - **Faked**: process launch. `notify-send`, `osascript`, `powershell.exe`,
 *   `reg`, `open` and `xdg-open` are recorded rather than run — a CI runner has
 *   none of them, and the assertion that matters is *which argv would be
 *   executed*, not whether this machine happens to have a notification daemon.
 *   The platform is injected for the same reason: the Windows registry path and
 *   the AppleScript escaping are what a Linux runner has to be able to check.
 *
 * The suite ends with the REST surface driven through a real Fastify instance
 * with `fastify.inject()`, over the real service singletons.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/desktop/__tests__/DesktopDaemonService.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-desktop-'));
process.env.ASTERIM_DATA_DIR = tmpDir;
// Nothing in this suite should open a relay socket or start mDNS by being
// imported, and no test may put a real toast on the operator's screen.
process.env.ASTERIM_SOVEREIGN_MODE = 'true';
process.env.ASTERIM_HEADLESS = 'true';

const Fastify = require('fastify');
const { dbService } = require('../../DatabaseService');
const {
  DesktopDaemonService,
  buildAutoStartPlan,
  buildLaunchAgentPlist,
  buildOpenCommand,
  buildXdgAutostartEntry,
  desktopDaemonService
} = require('../DesktopDaemonService');
const {
  DesktopNotificationService,
  buildNotificationCommands,
  desktopNotificationService,
  escapeAppleScript,
  escapePowerShell,
  normalizePlatform,
  sanitizeNotificationText,
  MAX_NOTIFICATION_BODY_CHARS
} = require('../DesktopNotificationService');
const { eventBus } = require('../../EventBus');
const {
  DELEGATION_COMPLETED_EVENT,
  DELEGATION_BATCH_COMPLETED_EVENT,
  DESKTOP_REGISTRY_RUN_KEY,
  DESKTOP_AUTOSTART_ID
} = require('@asterim/shared');
const desktopRoutes = require('../../../routes/desktop').default;

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

function cleanup(): void {
  try {
    dbService.close();
  } catch {
    /* already closed */
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

// --- Fixtures -------------------------------------------------------------

interface RecordedCommand {
  command: string;
  args: string[];
  purpose: string;
}

/**
 * A runner that records instead of spawning.
 *
 * `ok` decides the exit status, which is how the fallback chain and the
 * "`reg query` says the value is absent" path are exercised without a registry.
 */
function recorder(ok: boolean | ((cmd: RecordedCommand) => boolean) = true, stdout = '') {
  const calls: RecordedCommand[] = [];
  const run = async (command: RecordedCommand) => {
    calls.push({ command: command.command, args: [...command.args], purpose: command.purpose });
    const success = typeof ok === 'function' ? ok(command) : ok;
    return { ok: success, stdout };
  };
  // The notification service's runner resolves a bare boolean.
  const runBool = async (command: RecordedCommand) => (await run(command)).ok;
  return { calls, run, runBool };
}

/** A home directory per case, so one platform's entry cannot mask another's. */
let homeCounter = 0;
function makeHome(): string {
  homeCounter++;
  const dir = path.join(tmpDir, `home_${homeCounter}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const LAUNCH_ARGV = ['/usr/bin/node', '/opt/Asterim App/dist/index.js'];

async function main(): Promise<void> {
  dbService.getDb();

  // --- Platform normalisation ------------------------------------------------
  describe('platform detection');
  {
    equal('win32 is a supported platform', normalizePlatform('win32'), 'win32');
    equal('darwin is a supported platform', normalizePlatform('darwin'), 'darwin');
    equal('linux is a supported platform', normalizePlatform('linux'), 'linux');
    equal('freebsd is unsupported rather than an error', normalizePlatform('freebsd'), 'unsupported');
    equal('so is a platform string nobody has heard of', normalizePlatform('haiku'), 'unsupported');
  }

  // --- Text handling ---------------------------------------------------------
  describe('notification text is safe to interpolate');
  {
    equal(
      'newlines are folded into a single line',
      sanitizeNotificationText('one\ntwo\r\nthree', 100),
      'one two three'
    );
    equal(
      'control characters are removed outright',
      sanitizeNotificationText('be\u0000fo\u0007re', 100),
      'before'
    );
    const long = 'x'.repeat(MAX_NOTIFICATION_BODY_CHARS + 50);
    const trimmed = sanitizeNotificationText(long, MAX_NOTIFICATION_BODY_CHARS);
    equal('an over-long body is truncated to the cap', trimmed.length, MAX_NOTIFICATION_BODY_CHARS);
    check('and marked as truncated', trimmed.endsWith('…'));
    equal('a null title becomes an empty string, not a crash', sanitizeNotificationText(null as any, 10), '');

    equal(
      'AppleScript quotes are escaped after backslashes',
      escapeAppleScript('a\\b"c'),
      'a\\\\b\\"c'
    );
    equal('PowerShell single quotes are doubled', escapePowerShell("it's"), "it''s");
  }

  // --- Cross-platform notification commands ----------------------------------
  describe('notification commands per platform');
  {
    const input = {
      title: 'Approval required',
      body: 'Agent wants to run rm -rf /tmp/x',
      type: 'APPROVAL_REQUIRED' as const
    };

    const linux = buildNotificationCommands(input, 'linux');
    equal('Linux uses notify-send first', linux[0].command, 'notify-send');
    check('with the Asterim app name', linux[0].args.includes('Asterim'));
    check('at critical urgency for an approval gate', linux[0].args.includes('critical'));
    equal(
      'and the title and body as the last two arguments',
      linux[0].args.slice(-2),
      [input.title, input.body]
    );
    equal('with kdialog as the fallback', linux[1].command, 'kdialog');

    const normalUrgency = buildNotificationCommands(
      { title: 't', body: 'b', type: 'SYSTEM' },
      'linux'
    );
    check('a SYSTEM notification is low urgency', normalUrgency[0].args.includes('low'));
    check('and expires on its own', normalUrgency[0].args.includes('8000'));

    const darwin = buildNotificationCommands(input, 'darwin');
    equal('macOS uses osascript', darwin[0].command, 'osascript');
    equal('with a single -e script argument', darwin[0].args.length, 2);
    check('containing a display notification statement', darwin[0].args[1].startsWith('display notification "'));
    check('the title as the subtitle', darwin[0].args[1].includes('subtitle "Approval required"'));

    const win = buildNotificationCommands(input, 'win32');
    equal('Windows uses PowerShell', win[0].command, 'powershell.exe');
    check('with the profile and interaction disabled', win[0].args.includes('-NonInteractive'));
    check('hidden, so no console flashes', win[0].args.includes('Hidden'));
    check('driving the WinRT toast API', win[0].args[win[0].args.length - 1].includes('ToastNotificationManager'));
    equal('and a balloon fallback behind it', win[1].purpose, 'NotifyIcon balloon');
    check(
      'the fallback uses NotifyIcon',
      win[1].args[win[1].args.length - 1].includes('System.Windows.Forms.NotifyIcon')
    );

    equal('an unsupported platform has no command at all', buildNotificationCommands(input, 'unsupported'), []);
  }

  describe('a body full of metacharacters cannot become a command');
  {
    const hostile = {
      title: "'; Stop-Process -Name asterim; '",
      body: 'x"; do-something-bad; "',
      type: 'SYSTEM' as const
    };

    const linux = buildNotificationCommands(hostile, 'linux');
    // execFile passes argv straight through, so the payload stays one argument.
    equal('on Linux the payload is a single argv element', linux[0].args.slice(-2), [
      hostile.title,
      hostile.body
    ]);

    const darwin = buildNotificationCommands(hostile, 'darwin')[0].args[1];
    check('on macOS the double quote is escaped', darwin.includes('\\"'));
    check('so the AppleScript string is never closed early', !/[^\\]"\s*;/.test(darwin));

    const win = buildNotificationCommands(hostile, 'win32')[0].args.slice(-1)[0];
    check('on Windows every single quote is doubled', win.includes("''; Stop-Process"));
  }

  // --- Headless degradation --------------------------------------------------
  describe('headless and CI hosts skip dispatch instead of failing');
  {
    const ci = recorder(true);
    const inCi = new DesktopNotificationService({
      platform: 'linux',
      env: { CI: 'true', DISPLAY: ':0' },
      run: ci.runBool
    });
    check('CI is detected as headless', inCi.isHeadless());
    const result = await inCi.dispatch({ title: 'Hi', body: 'there', type: 'SYSTEM' });
    equal('nothing is dispatched there', result.dispatched, false);
    equal('and the reason is recorded', result.skipped, 'HEADLESS');
    equal('no process was spawned', ci.calls.length, 0);

    const noDisplay = new DesktopNotificationService({ platform: 'linux', env: {} });
    check('a Linux host with no display is headless', noDisplay.isHeadless());
    const wayland = new DesktopNotificationService({
      platform: 'linux',
      env: { WAYLAND_DISPLAY: 'wayland-0' }
    });
    check('a Wayland session is not', !wayland.isHeadless());

    const overridden = new DesktopNotificationService({
      platform: 'linux',
      env: { CI: 'true', ASTERIM_HEADLESS: 'false', DISPLAY: ':0' }
    });
    check('ASTERIM_HEADLESS=false overrides CI detection', !overridden.isHeadless());

    const forced = new DesktopNotificationService({
      platform: 'darwin',
      env: { ASTERIM_HEADLESS: 'true' }
    });
    check('and ASTERIM_HEADLESS=true forces it on a desktop platform', forced.isHeadless());

    const exotic = new DesktopNotificationService({ platform: 'unsupported', env: {} });
    check('an unsupported platform is headless by definition', exotic.isHeadless());
  }

  describe('dispatch on a real desktop');
  {
    const rec = recorder(true);
    const service = new DesktopNotificationService({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      run: rec.runBool,
      cooldownMs: 0
    });

    const ok = await service.notify({ title: 'Approval required', body: 'Run tests?', type: 'APPROVAL_REQUIRED' });
    check('the notification is dispatched', ok);
    equal('through exactly one command', rec.calls.length, 1);
    equal('the first backend in the chain', rec.calls[0].command, 'notify-send');
    equal('and it is counted', service.getStats().dispatched, 1);
  }

  describe('a failing backend falls through to the next');
  {
    const rec = recorder(cmd => cmd.command === 'kdialog');
    const service = new DesktopNotificationService({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      run: rec.runBool,
      cooldownMs: 0
    });

    const result = await service.dispatch({ title: 'T', body: 'B', type: 'SYSTEM' });
    check('the notification still lands', result.dispatched);
    equal('via the fallback', result.via, 'kdialog passive popup');
    equal('after both were tried', rec.calls.map(c => c.command), ['notify-send', 'kdialog']);
  }

  describe('a host where nothing works is not an error');
  {
    const rec = recorder(false);
    const service = new DesktopNotificationService({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      run: rec.runBool,
      cooldownMs: 0
    });
    const result = await service.dispatch({ title: 'T', body: 'B', type: 'SYSTEM' });
    equal('it simply did not dispatch', result.dispatched, false);
    check('and says so', (result.reason ?? '').includes('no notification backend'));
    equal('both backends were tried', rec.calls.length, 2);

    // The cooldown must not have been claimed by a dispatch that showed nothing.
    const second = await service.dispatch({ title: 'T', body: 'B', type: 'SYSTEM' });
    equal('a retry is not rate-limited after a total failure', second.skipped, undefined);
  }

  describe('an approval storm is rate-limited per type');
  {
    let clock = 1_000_000;
    const rec = recorder(true);
    const service = new DesktopNotificationService({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      run: rec.runBool,
      now: () => clock,
      cooldownMs: 1500
    });

    const first = await service.dispatch({ title: 'Approval', body: '1', type: 'APPROVAL_REQUIRED' });
    check('the first is shown', first.dispatched);
    clock += 100;
    const second = await service.dispatch({ title: 'Approval', body: '2', type: 'APPROVAL_REQUIRED' });
    equal('the next one in the window is dropped', second.skipped, 'RATE_LIMITED');
    const other = await service.dispatch({ title: 'Done', body: '3', type: 'DELEGATION_COMPLETED' });
    check('but an unrelated type is unaffected', other.dispatched);
    clock += 2000;
    const later = await service.dispatch({ title: 'Approval', body: '4', type: 'APPROVAL_REQUIRED' });
    check('and the type resumes once the window passes', later.dispatched);
    equal('so three toasts were spawned, not four', rec.calls.length, 3);
  }

  describe('malformed input never throws');
  {
    const service = new DesktopNotificationService({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      run: async () => true,
      cooldownMs: 0
    });
    const empty = await service.dispatch({ title: '   ', body: 'b', type: 'SYSTEM' });
    equal('an empty title is refused', empty.dispatched, false);
    equal('with a reason rather than an exception', empty.reason, 'title is required');
    equal('and notify() reports false', await service.notify(undefined as any), false);
  }

  // --- EventBus wiring -------------------------------------------------------
  describe('the bus subscriptions raise the right kind of notification');
  {
    const seen: Array<{ type: string; title: string; body: string }> = [];
    const service = new DesktopNotificationService({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      run: async () => true,
      cooldownMs: 0
    });
    // Capture what each handler composed, without spawning anything.
    (service as any).notify = async (input: any) => {
      seen.push({ type: input.type, title: input.title, body: input.body });
      return true;
    };
    service.initEventBusListeners();
    service.initEventBusListeners(); // idempotent: a second call must not double-subscribe

    eventBus.publish({
      id: 'evt_1',
      timestamp: Date.now(),
      source: 'test',
      type: 'agent.approval_request',
      payload: { actionId: 'act_1', description: 'Run the migration', command: 'pnpm migrate', projectId: 'p1', threadId: 't1' }
    });
    equal('an approval request raises exactly one toast', seen.length, 1);
    equal('of the approval kind', seen[0].type, 'APPROVAL_REQUIRED');
    equal('carrying the description', seen[0].body, 'Run the migration');

    eventBus.publish({
      id: 'evt_2',
      timestamp: Date.now(),
      source: 'test',
      type: DELEGATION_COMPLETED_EVENT,
      payload: {
        projectId: 'p1',
        threadId: 't1',
        result: { childThreadId: 'c1', status: 'COMPLETED', summary: 'Refactored the parser', output: '' }
      }
    });
    equal('a finished delegation raises a completion', seen[1].type, 'DELEGATION_COMPLETED');
    equal('summarised by the child', seen[1].body, 'Refactored the parser');

    eventBus.publish({
      id: 'evt_3',
      timestamp: Date.now(),
      source: 'test',
      type: DELEGATION_COMPLETED_EVENT,
      payload: {
        projectId: 'p1',
        threadId: 't1',
        result: {
          childThreadId: 'c2',
          status: 'COMPLETED',
          summary: 'Touched the build',
          output: '',
          verificationReport: { passed: false, totalSteps: 4, passedSteps: 3, failedSteps: 1 }
        }
      }
    });
    equal('a failed pipeline is reported as a failure, not a completion', seen[2].type, 'PIPELINE_FAILED');

    eventBus.publish({
      id: 'evt_4',
      timestamp: Date.now(),
      source: 'test',
      type: DELEGATION_COMPLETED_EVENT,
      payload: {
        projectId: 'p1',
        threadId: 't1',
        result: {
          childThreadId: 'c3',
          status: 'COMPLETED',
          summary: 'Clean',
          output: '',
          verificationReport: { passed: true, totalSteps: 4, passedSteps: 4, failedSteps: 0 }
        }
      }
    });
    equal('a passing pipeline is an ordinary completion', seen[3].type, 'DELEGATION_COMPLETED');

    eventBus.publish({
      id: 'evt_5',
      timestamp: Date.now(),
      source: 'test',
      type: DELEGATION_BATCH_COMPLETED_EVENT,
      payload: { projectId: 'p1', threadId: 't1', batch: { results: [{}, {}, {}] } }
    });
    equal('a settled batch says how many children it had', seen[4].body, '3 delegated tasks settled.');

    eventBus.publish({
      id: 'evt_6',
      timestamp: Date.now(),
      source: 'test',
      type: DELEGATION_COMPLETED_EVENT,
      payload: { projectId: 'p1', threadId: 't1' }
    });
    equal('a completion with no result raises nothing', seen.length, 5);
  }

  // --- Auto-start ------------------------------------------------------------
  describe('auto-start entries per platform');
  {
    const home = makeHome();

    const win = buildAutoStartPlan('win32', home, LAUNCH_ARGV);
    equal('Windows uses the HKCU Run key', win.mechanism, 'registry');
    equal('under the documented path', win.install!.args[1], DESKTOP_REGISTRY_RUN_KEY);
    check('written as a REG_SZ', win.install!.args.includes('REG_SZ'));
    check('overwriting any previous value', win.install!.args.includes('/f'));
    check(
      'with the space-bearing path quoted so the shell re-splits it correctly',
      win.install!.args[7] === '/usr/bin/node "/opt/Asterim App/dist/index.js"'
    );
    equal('removal deletes the same value', win.remove!.args[0], 'delete');
    equal('and detection queries it', win.query!.args[0], 'query');

    const mac = buildAutoStartPlan('darwin', home, LAUNCH_ARGV);
    equal('macOS uses a LaunchAgent', mac.mechanism, 'launch-agent');
    equal(
      'at the documented path',
      mac.file,
      path.join(home, 'Library', 'LaunchAgents', 'io.asterim.desktop.plist')
    );
    check('labelled with the reverse-DNS id', mac.contents!.includes(`<string>${DESKTOP_AUTOSTART_ID}</string>`));
    check('running at load', mac.contents!.includes('<key>RunAtLoad</key>'));
    check('as a background process', mac.contents!.includes('<string>Background</string>'));
    check('with each argv element its own <string>', mac.contents!.includes('<string>/usr/bin/node</string>'));

    const linux = buildAutoStartPlan('linux', home, LAUNCH_ARGV);
    equal('Linux uses an XDG autostart entry', linux.mechanism, 'xdg-autostart');
    equal('at the documented path', linux.file, path.join(home, '.config', 'autostart', 'asterim.desktop'));
    check('declared as an Application', linux.contents!.includes('Type=Application'));
    check('not shown in the application menu', linux.contents!.includes('NoDisplay=true'));
    check('with the space-bearing path quoted in Exec', linux.contents!.includes('Exec=/usr/bin/node "/opt/Asterim App/dist/index.js"'));

    equal('an unsupported platform has no mechanism', buildAutoStartPlan('unsupported', home, LAUNCH_ARGV).mechanism, 'none');
  }

  describe('XML and shell metacharacters in a home path survive');
  {
    const argv = ['/usr/bin/node', '/home/a&b/<Asterim>/index.js'];
    const plist = buildLaunchAgentPlist(argv);
    check('the ampersand is entity-escaped', plist.includes('&amp;'));
    check('and the angle brackets too', plist.includes('&lt;Asterim&gt;'));
    check('so no raw < survives inside the argv string', !plist.includes('<string>/home/a&b'));

    const entry = buildXdgAutostartEntry(['/usr/bin/node', '/home/dev/my app/index.js']);
    check('the XDG Exec line quotes the spaced path', entry.includes('"/home/dev/my app/index.js"'));
  }

  // --- Auto-start, actually written ------------------------------------------
  describe('enabling auto-start on Linux writes a real entry');
  {
    const home = makeHome();
    const daemon = new DesktopDaemonService({
      platform: 'linux',
      homeDir: home,
      dataDir: tmpDir,
      env: { DISPLAY: ':0' },
      launchArgv: LAUNCH_ARGV
    });

    equal('it starts disabled', await daemon.getAutoStart(), false);
    equal('enabling it reports enabled', await daemon.setAutoStart(true), true);
    const file = path.join(home, '.config', 'autostart', 'asterim.desktop');
    check('the entry file exists', fs.existsSync(file));
    check('with the parent directory created', fs.existsSync(path.dirname(file)));
    check('and it is a valid desktop entry', fs.readFileSync(file, 'utf8').startsWith('[Desktop Entry]'));
    equal('detection now agrees', await daemon.getAutoStart(), true);
    equal('and the status reports it', daemon.getStatus().autoStartEnabled, true);

    equal('enabling it twice is idempotent', await daemon.setAutoStart(true), true);

    equal('disabling it reports disabled', await daemon.setAutoStart(false), false);
    check('and the file is gone', !fs.existsSync(file));
    equal('detection agrees again', await daemon.getAutoStart(), false);
    equal('disabling an absent entry is not a failure', await daemon.setAutoStart(false), false);
  }

  describe('enabling auto-start on macOS writes a real LaunchAgent');
  {
    const home = makeHome();
    const daemon = new DesktopDaemonService({
      platform: 'darwin',
      homeDir: home,
      dataDir: tmpDir,
      env: {},
      launchArgv: LAUNCH_ARGV
    });

    equal('enabling it succeeds', await daemon.setAutoStart(true), true);
    const plist = path.join(home, 'Library', 'LaunchAgents', 'io.asterim.desktop.plist');
    check('the plist exists at the LaunchAgents path', fs.existsSync(plist));
    const contents = fs.readFileSync(plist, 'utf8');
    check('declared as a plist', contents.includes('<!DOCTYPE plist'));
    check('with ProgramArguments', contents.includes('<key>ProgramArguments</key>'));
    equal('and it is detected', await daemon.getAutoStart(), true);
    equal('removal cleans it up', await daemon.setAutoStart(false), false);
    check('leaving nothing behind', !fs.existsSync(plist));
  }

  describe('auto-start on Windows drives reg, not the filesystem');
  {
    const home = makeHome();
    const absent = recorder(false);
    const daemon = new DesktopDaemonService({
      platform: 'win32',
      homeDir: home,
      dataDir: tmpDir,
      env: {},
      run: absent.run,
      launchArgv: LAUNCH_ARGV
    });

    equal('a reg query that exits non-zero means not configured', await daemon.getAutoStart(), false);
    equal('through exactly one reg invocation', absent.calls.length, 1);
    equal('which was a query', absent.calls[0].args[0], 'query');
    equal('and it failing to add means it is still off', await daemon.setAutoStart(true), false);

    const present = recorder(true, `    Asterim    REG_SZ    ${LAUNCH_ARGV.join(' ')}`);
    const working = new DesktopDaemonService({
      platform: 'win32',
      homeDir: home,
      dataDir: tmpDir,
      env: {},
      run: present.run,
      launchArgv: LAUNCH_ARGV
    });
    equal('a successful add reports enabled', await working.setAutoStart(true), true);
    equal('via reg add', present.calls[0].args[0], 'add');
    equal('a query that finds the value reports enabled', await working.getAutoStart(), true);
    equal('no entry file was written on Windows', working.autoStartEntryPath(), undefined);
    check('and no autostart directory was created', !fs.existsSync(path.join(home, '.config', 'autostart')));
  }

  describe('a platform with no auto-start mechanism says so');
  {
    const daemon = new DesktopDaemonService({
      platform: 'unsupported',
      homeDir: makeHome(),
      dataDir: tmpDir,
      env: {},
      launchArgv: LAUNCH_ARGV
    });
    equal('enabling it is refused rather than faked', await daemon.setAutoStart(true), false);
    equal('and it reads back as off', await daemon.getAutoStart(), false);
  }

  // --- Native launchers ------------------------------------------------------
  describe('open commands per platform');
  {
    equal(
      'Windows opens a URL through cmd start, with the empty title argument',
      buildOpenCommand('win32', 'http://localhost:3000', 'url'),
      { command: 'cmd.exe', args: ['/c', 'start', '', 'http://localhost:3000'], purpose: 'open url' }
    );
    equal('but reveals a folder with explorer', buildOpenCommand('win32', 'C:\\x', 'path')!.command, 'explorer.exe');
    equal('macOS uses open for both', buildOpenCommand('darwin', '/tmp/x', 'path')!.command, 'open');
    equal('Linux uses xdg-open for both', buildOpenCommand('linux', '/tmp/x', 'path')!.command, 'xdg-open');
    equal('an unsupported platform has no launcher', buildOpenCommand('unsupported', '/tmp/x', 'path'), null);
  }

  describe('the daemon launches the right target');
  {
    const rec = recorder(true);
    const daemon = new DesktopDaemonService({
      platform: 'linux',
      homeDir: makeHome(),
      dataDir: tmpDir,
      env: { DISPLAY: ':0', PORT: '4321' },
      run: rec.run,
      launchArgv: LAUNCH_ARGV
    });

    check('the dashboard opens', await daemon.openDashboard());
    equal('at the port this Core is serving', rec.calls[0].args, ['http://localhost:4321']);

    check('the data folder opens', await daemon.openDataDirectory());
    equal('at the resolved data directory', rec.calls[1].args, [tmpDir]);
    check('which is created if it was missing', fs.existsSync(tmpDir));

    equal('the log does not open when there is none', await daemon.openLogFile(), false);
    equal('and nothing was spawned for it', rec.calls.length, 2);

    fs.writeFileSync(path.join(tmpDir, 'server.log'), 'started\n');
    check('but it does once the Core has written one', await daemon.openLogFile());
    equal('pointing at that file', rec.calls[2].args, [path.join(tmpDir, 'server.log')]);
  }

  describe('launchers on a platform with none are refused, not attempted');
  {
    const rec = recorder(true);
    const daemon = new DesktopDaemonService({
      platform: 'unsupported',
      homeDir: makeHome(),
      dataDir: tmpDir,
      env: {},
      run: rec.run
    });
    equal('the dashboard does not open', await daemon.openDashboard(), false);
    equal('nor the data folder', await daemon.openDataDirectory(), false);
    equal('and nothing was spawned', rec.calls.length, 0);
  }

  // --- Tray status -----------------------------------------------------------
  describe('tray status reflects the live Core');
  {
    const daemon = new DesktopDaemonService({
      platform: 'linux',
      homeDir: makeHome(),
      dataDir: tmpDir,
      env: { DISPLAY: ':0', PORT: '3000' },
      run: async () => ({ ok: true, stdout: '' }),
      countActiveThreads: () => 2,
      countActiveMcpServers: () => 3,
      getVaultState: () => 'ENCRYPTED',
      uptimeSeconds: () => 42,
      memoryBytes: () => 128 * 1024 * 1024,
      launchArgv: LAUNCH_ARGV
    });

    const tray = daemon.getTrayStatus();
    equal('the Core reads as online', tray.state, 'ONLINE');
    equal('with the running thread count', tray.activeThreads, 2);
    equal('and the running MCP server count', tray.activeMcpServers, 3);
    equal('the vault badge says encrypted', tray.vault, 'ENCRYPTED');
    equal('memory is reported in whole megabytes', tray.memoryMb, 128);
    equal('uptime in seconds', tray.uptimeSeconds, 42);
    equal('and the tooltip states all of it', tray.label, 'Asterim — online, 2 active threads, 3 MCP');

    const status = daemon.getStatus();
    equal('the status echoes the active count', status.activeAgentsCount, 2);
    equal('reports the vault as encrypted', status.vaultEncrypted, true);
    equal('names the platform', status.platform, 'linux');
    equal('the dashboard URL', status.webUrl, 'http://localhost:3000');
    equal('and the data directory', status.dataDir, tmpDir);
    equal('a Linux host with a display is not headless', status.isHeadless, false);

    daemon.setPaused(true);
    equal('pausing the Core changes the tray state', daemon.getTrayStatus().state, 'PAUSED');
    check('and says so in the tooltip', daemon.getTrayStatus().label.includes('paused'));
    daemon.setPaused(false);
  }

  describe('a Core that cannot read its own database degrades rather than throws');
  {
    const daemon = new DesktopDaemonService({
      platform: 'linux',
      homeDir: makeHome(),
      dataDir: tmpDir,
      env: { DISPLAY: ':0' },
      countActiveThreads: () => {
        throw new Error('database is locked');
      },
      countActiveMcpServers: () => {
        throw new Error('supervisor is gone');
      },
      getVaultState: () => {
        throw new Error('no salt');
      },
      memoryBytes: () => 64 * 1024 * 1024
    });

    const tray = daemon.getTrayStatus();
    equal('the tray reports offline', tray.state, 'OFFLINE');
    equal('with no thread count to give', tray.activeThreads, 0);
    equal('no MCP count', tray.activeMcpServers, 0);
    equal('and an unavailable vault', tray.vault, 'UNAVAILABLE');
    equal('the tooltip says as much', tray.label, 'Asterim — unavailable');
    equal('but memory is still true', tray.memoryMb, 64);
    equal('and getStatus still answers', daemon.getStatus().vaultEncrypted, false);
  }

  describe('the tray menu offers the quick actions');
  {
    const home = makeHome();
    const daemon = new DesktopDaemonService({
      platform: 'linux',
      homeDir: home,
      dataDir: tmpDir,
      env: { DISPLAY: ':0' },
      countActiveThreads: () => 0,
      countActiveMcpServers: () => 0,
      getVaultState: () => 'ENCRYPTED'
    });

    const menu = daemon.getTrayMenu();
    equal(
      'the rows are the status header plus the four actions',
      menu.map((item: any) => item.id),
      ['status', 'open-dashboard', 'open-data-dir', 'view-log', 'toggle-autostart']
    );
    equal('the header is not clickable', menu[0].enabled, false);
    check('the launch actions are available on Linux', menu[1].enabled && menu[2].enabled);
    check('the log row is enabled because a log exists', menu[3].enabled);
    equal('auto-start is offered', menu[4].label, 'Start at Login');

    const exotic = new DesktopDaemonService({
      platform: 'unsupported',
      homeDir: home,
      dataDir: tmpDir,
      env: {},
      countActiveThreads: () => 0,
      countActiveMcpServers: () => 0,
      getVaultState: () => 'UNAVAILABLE'
    });
    const exoticMenu = exotic.getTrayMenu();
    check('every action is disabled where none can run', exoticMenu.slice(1).every((item: any) => !item.enabled));
  }

  describe('the live session counter reads the sessions table');
  {
    const db = dbService.getDb();
    const now = Date.now();
    db.prepare(
      "INSERT INTO sessions (id, project_id, thread_id, agent_type, status, pid, started_at, updated_at) VALUES ('s1','p1','t1','claude','running',1,?,?)"
    ).run(now, now);
    db.prepare(
      "INSERT INTO sessions (id, project_id, thread_id, agent_type, status, pid, started_at, updated_at) VALUES ('s2','p1','t2','claude','exited',2,?,?)"
    ).run(now, now);
    db.prepare(
      "INSERT INTO sessions (id, project_id, thread_id, agent_type, status, pid, started_at, updated_at) VALUES ('s3','p1','t3','aider','running',3,?,?)"
    ).run(now, now);

    const daemon = new DesktopDaemonService({
      platform: 'linux',
      homeDir: makeHome(),
      dataDir: tmpDir,
      env: { DISPLAY: ':0' },
      getVaultState: () => 'ENCRYPTED'
    });
    equal('only running sessions are counted', daemon.getTrayStatus().activeThreads, 2);
  }

  // --- REST surface ----------------------------------------------------------
  describe('the REST surface');
  {
    const app = Fastify();
    // The Core's own auth middleware is not registered here; the routes are
    // driven directly, with `request.user` set the way authMiddleware sets it,
    // so both the authorised and the unauthorised path are exercised.
    let authenticated = true;
    app.addHook('preHandler', async (request: any) => {
      if (authenticated) request.user = { sub: 'usr_dev', acc: 'acc_dev' };
    });
    await app.register(desktopRoutes);

    const statusRes = await app.inject({ method: 'GET', url: '/api/v1/desktop/status' });
    equal('GET /status answers 200', statusRes.statusCode, 200);
    const statusBody = statusRes.json();
    check('with a desktop status', typeof statusBody.desktop === 'object');
    check('naming this platform', typeof statusBody.desktop.platform === 'string');
    check('carrying the tray status', typeof statusBody.desktop.trayStatus.state === 'string');
    check('and the menu rows', Array.isArray(statusBody.menu) && statusBody.menu.length === 5);
    check(
      'the status carries no secret material',
      !JSON.stringify(statusBody).toLowerCase().includes('vault:v1:')
    );

    // ASTERIM_HEADLESS is true for this whole process, so a dispatch is skipped
    // rather than putting a real toast on the operator's screen.
    const notifyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/desktop/notify',
      payload: { title: 'Test', body: 'From the suite', type: 'SYSTEM' }
    });
    equal('POST /notify answers 200 on a headless host', notifyRes.statusCode, 200);
    equal('reporting that nothing was dispatched', notifyRes.json().dispatched, false);
    equal('because the host is headless', notifyRes.json().skipped, 'HEADLESS');
    equal('which is a success, not a failure', notifyRes.json().success, true);

    const badNotify = await app.inject({
      method: 'POST',
      url: '/api/v1/desktop/notify',
      payload: { body: 'no title' }
    });
    equal('a notification with no title is a 400', badNotify.statusCode, 400);

    const badType = await app.inject({
      method: 'POST',
      url: '/api/v1/desktop/notify',
      payload: { title: 'T', body: 'B', type: 'NOT_A_TYPE' }
    });
    equal('an unknown type is coerced rather than rejected', badType.statusCode, 200);

    const badAutostart = await app.inject({
      method: 'POST',
      url: '/api/v1/desktop/autostart',
      payload: { enabled: 'yes' }
    });
    equal('a non-boolean autostart flag is a 400', badAutostart.statusCode, 400);

    // The route drives the real singleton, so this writes a real login entry in
    // the real home directory. Two precautions, because a test suite that
    // silently reconfigures the machine it runs on is worse than one that skips
    // a case: the developer's existing entry is snapshotted and put back
    // afterwards, and the Windows branch is not exercised at all — there the
    // effect would be a registry write with no equivalent way to restore it.
    const entryPath = desktopDaemonService.autoStartEntryPath();
    const preexisting =
      entryPath && fs.existsSync(entryPath) ? fs.readFileSync(entryPath, 'utf8') : null;

    if (desktopDaemonService.getPlatform() === 'win32') {
      console.log('  SKIP  autostart round-trip (would write to the real HKCU Run key)');
    } else {
      const enableRes = await app.inject({
        method: 'POST',
        url: '/api/v1/desktop/autostart',
        payload: { enabled: true }
      });
      equal('POST /autostart answers 200', enableRes.statusCode, 200);
      equal('the entry is now enabled', enableRes.json().enabled, true);
      equal('and it reports where the entry lives', enableRes.json().entryPath, entryPath);
      check('the entry file exists', !!entryPath && fs.existsSync(entryPath));

      const disableRes = await app.inject({
        method: 'POST',
        url: '/api/v1/desktop/autostart',
        payload: { enabled: false }
      });
      equal('disabling it answers enabled: false', disableRes.json().enabled, false);
      check('and the entry file is gone', !entryPath || !fs.existsSync(entryPath));

      if (preexisting !== null && entryPath) {
        fs.mkdirSync(path.dirname(entryPath), { recursive: true });
        fs.writeFileSync(entryPath, preexisting);
        check('the developer’s own entry was restored', fs.existsSync(entryPath));
      }
    }

    // The launchers are exercised through a runner that records rather than
    // spawns, so the suite never opens a browser on the machine running it.
    const launched: string[] = [];
    const originalLaunch = (desktopDaemonService as any).launch;
    (desktopDaemonService as any).launch = async (command: any) => {
      if (!command) return false;
      launched.push(`${command.command} ${command.args.join(' ')}`);
      return true;
    };

    const dashRes = await app.inject({ method: 'POST', url: '/api/v1/desktop/open-dashboard' });
    equal('POST /open-dashboard answers 200', dashRes.statusCode, 200);
    equal('reporting success', dashRes.json().success, true);
    check('and it launched the dashboard URL', launched[0].includes('http://localhost:'));

    const dirRes = await app.inject({ method: 'POST', url: '/api/v1/desktop/open-data-dir' });
    equal('POST /open-data-dir answers 200', dirRes.statusCode, 200);
    check('and it launched the data directory', launched[1].includes(tmpDir));

    const logRes = await app.inject({ method: 'POST', url: '/api/v1/desktop/open-log' });
    equal('POST /open-log answers 200', logRes.statusCode, 200);
    check('and it launched the server log', launched[2].includes('server.log'));

    (desktopDaemonService as any).launch = originalLaunch;

    // Every one of these acts on the operator's physical desktop, so none of
    // them may be reachable without a session.
    authenticated = false;
    for (const [method, url] of [
      ['GET', '/api/v1/desktop/status'],
      ['POST', '/api/v1/desktop/open-dashboard'],
      ['POST', '/api/v1/desktop/open-data-dir'],
      ['POST', '/api/v1/desktop/open-log'],
      ['POST', '/api/v1/desktop/notify'],
      ['POST', '/api/v1/desktop/autostart']
    ] as Array<[string, string]>) {
      const res = await app.inject({ method: method as any, url, payload: { title: 'T', enabled: true } });
      equal(`${method} ${url} is 401 without a session`, res.statusCode, 401);
    }
    equal('and no launcher ran for any of them', launched.length, 3);

    await app.close();
  }

  describe('the exported singletons are usable');
  {
    equal('the notification singleton knows this platform', desktopNotificationService.getPlatform(), normalizePlatform(process.platform));
    check('and is headless in this process', desktopNotificationService.isHeadless());
    equal('the daemon singleton agrees on the platform', desktopDaemonService.getPlatform(), normalizePlatform(process.platform));
    equal('and resolves the temp data directory', desktopDaemonService.dataDirectory(), tmpDir);
  }
}

main()
  .catch(err => {
    failed++;
    console.error('\nUNCAUGHT ERROR:', err);
  })
  .finally(() => {
    cleanup();
    console.log(`\n${passed}/${passed + failed} assertions passed`);
    if (failures.length > 0) {
      console.log('Failed assertions:');
      for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed === 0 ? 0 : 1);
  });
