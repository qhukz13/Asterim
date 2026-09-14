/**
 * Turning failures into something a person can act on.
 *
 * Asterim is installed by strangers and run without support, so every failure
 * it can recognise has to say what happened and what to try. "Something went
 * wrong" means the user's only recourse is the founder, which does not scale
 * past the first ten people.
 *
 * Two jobs live here: classifying a failure at the moment it happens
 * (`diagnoseAgentFailure`), and answering "is my machine set up correctly?" on
 * demand (`collectDiagnostics`).
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Diagnosis, DiagnosticCheck, DiagnosticsReport } from '@asterim/shared';
import { describeChannel, resolveDataDir } from '../../utils/channel';

/** Lines of `server.log` included in a report. */
const LOG_TAIL_LINES = 120;

/**
 * The oldest Claude Code that speaks the protocol the adapter needs:
 * `--permission-prompt-tool stdio` with `can_use_tool` control requests.
 */
export const MIN_CLAUDE_VERSION = '2.1.0';

/** Compares dotted version strings. Missing parts count as zero. */
export function isVersionAtLeast(found: string, minimum: string): boolean {
  const parse = (v: string) =>
    (v.match(/\d+(\.\d+)*/)?.[0] ?? '').split('.').map(n => parseInt(n, 10) || 0);
  const a = parse(found);
  const b = parse(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

/**
 * Classifies a failure message from an adapter or a spawn attempt.
 *
 * Matching is on the text because that is what the CLI and the OS actually
 * give us. Anything unrecognised is reported as unknown *with the original
 * message*, which is still more useful than a generic apology.
 */
export function diagnoseAgentFailure(agentType: string, rawMessage: string): Diagnosis {
  const message = (rawMessage ?? '').toString();
  const lower = message.toLowerCase();
  const agent = agentType === 'claude' ? 'Claude Code' : agentType;

  if (lower.includes('is not installed or not on path') || lower.includes('enoent')) {
    return {
      code: 'CLI_NOT_FOUND',
      title: `${agent} is not installed, or Asterim cannot find it`,
      detail: message,
      remedies:
        agentType === 'claude'
          ? [
              'Install it: npm install -g @anthropic-ai/claude-code',
              'Check it runs: open a new terminal and type `claude --version`',
              'If it is installed somewhere unusual, set ASTERIM_CLAUDE_BIN to its full path and restart Asterim',
              'If you just installed it, restart Asterim so it picks up your new PATH'
            ]
          : [`Install the ${agent} CLI and make sure it is on your PATH, then restart Asterim`],
      docsAnchor: 'troubleshooting'
    };
  }

  if (lower.includes('not logged in') || lower.includes('/login') || lower.includes('unauthorized')) {
    return {
      code: 'CLI_NOT_LOGGED_IN',
      title: `${agent} is installed but not signed in`,
      detail: message,
      remedies: [
        'Run `claude` once in a terminal and complete the sign-in',
        'Then send your message again — Asterim will start a fresh session'
      ],
      docsAnchor: 'troubleshooting'
    };
  }

  // Policy is checked before the OS permission cases: "model not permitted by
  // fleet policy" is not the operating system refusing to execute a file.
  if (lower.includes('fleet policy') || lower.includes('blocked by policy')) {
    return {
      code: 'POLICY_BLOCKED',
      title: 'A policy on this machine refused the action',
      detail: message,
      remedies: ['Check asterim.policy.json in your Asterim data directory'],
      docsAnchor: 'configuration'
    };
  }

  if (
    lower.includes('eacces') ||
    lower.includes('permission denied') ||
    lower.includes('operation not permitted')
  ) {
    return {
      code: 'CLI_SPAWN_DENIED',
      title: `The operating system refused to run ${agent}`,
      detail: message,
      remedies: [
        'Check the file is executable (on macOS and Linux: chmod +x the binary)',
        'If a security tool is blocking it, allow the binary and try again',
        'Run `claude --version` in a terminal to confirm you can start it yourself'
      ],
      docsAnchor: 'troubleshooting'
    };
  }

  if (lower.includes('workspace directory does not exist') || lower.includes('folder not found')) {
    return {
      code: 'WORKSPACE_MISSING',
      title: 'The project folder is gone',
      detail: message,
      remedies: [
        'Check the folder still exists at the path shown',
        'If you moved it, remove the project from Asterim and add it again'
      ],
      docsAnchor: 'first-run'
    };
  }

  if (lower.includes('exited with code')) {
    return {
      code: 'CLI_EXITED',
      title: `${agent} started and then stopped`,
      detail: message,
      remedies: [
        'Run the same request in a terminal with `claude` to see its own error',
        'Copy the diagnostics from Settings and include them in a bug report'
      ],
      docsAnchor: 'troubleshooting'
    };
  }

  if (lower.includes('protocol') || lower.includes('control request')) {
    return {
      code: 'PROTOCOL_FAILURE',
      title: `Asterim could not talk to ${agent}`,
      detail: message,
      remedies: [
        `Check your ${agent} version: Asterim needs ${MIN_CLAUDE_VERSION} or newer`,
        'Update it: npm install -g @anthropic-ai/claude-code@latest',
        'Copy the diagnostics from Settings and include them in a bug report'
      ],
      docsAnchor: 'troubleshooting'
    };
  }

  return {
    code: 'UNKNOWN',
    title: `${agent} could not be started`,
    detail: message || 'No further detail was reported.',
    remedies: [
      'Open Settings and copy the diagnostics, which include the recent log',
      'Check the same request works by running `claude` in a terminal'
    ],
    docsAnchor: 'troubleshooting'
  };
}

/** Replaces anything machine-specific in a line of log or path text. */
export function redactForReport(text: string): string {
  let out = text;
  const home = os.homedir();
  const dataDir = resolveDataDir();
  const replacements: [string, string][] = [
    [dataDir, '<data-dir>'],
    [home, '<home>']
  ];
  for (const [from, to] of replacements) {
    if (!from) continue;
    // Both separators, because Windows logs contain each in different places.
    for (const variant of [from, from.split(path.sep).join('/'), from.split(path.sep).join('\\\\')]) {
      if (variant) out = out.split(variant).join(to);
    }
  }
  // Anything that looks like a credential, whatever it is attached to.
  out = out.replace(/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,})\b/g, '<redacted>');
  out = out.replace(
    /("?(?:token|secret|password|api[_-]?key|authorization)"?\s*[:=]\s*")([^"]{4,})(")/gi,
    '$1<redacted>$3'
  );
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/g, '$1<redacted>');
  return out;
}

/** Runs a binary with a short timeout and returns its trimmed stdout. */
function tryRun(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/** One row per agent: is it there, does it run, is it new enough. */
export function checkAgents(): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];

  // Claude Code, resolved exactly the way the adapter resolves it.
  let claudeLaunch: { cmd: string; prefixArgs: string[]; binary: string } | null;
  try {
    // Required lazily: this module is loaded by a route, and the adapters
    // package pulls in node-pty.
    const { resolveClaudeLaunch } = require('@asterim/adapters');
    claudeLaunch = resolveClaudeLaunch();
  } catch {
    claudeLaunch = null;
  }

  if (!claudeLaunch) {
    checks.push({
      id: 'claude',
      label: 'Claude Code',
      status: 'fail',
      detail: 'Not found on PATH, in ~/.local/bin, or at ASTERIM_CLAUDE_BIN.',
      remedy: 'npm install -g @anthropic-ai/claude-code, then restart Asterim.'
    });
  } else {
    const version = tryRun(claudeLaunch.cmd, [...claudeLaunch.prefixArgs, '--version']);
    if (!version) {
      checks.push({
        id: 'claude',
        label: 'Claude Code',
        status: 'warn',
        detail: 'Found, but it did not answer `--version`.',
        remedy: 'Run `claude --version` in a terminal to see what it reports.'
      });
    } else if (!isVersionAtLeast(version, MIN_CLAUDE_VERSION)) {
      checks.push({
        id: 'claude',
        label: 'Claude Code',
        status: 'warn',
        detail: `${version} — older than ${MIN_CLAUDE_VERSION}, which Asterim needs for approvals.`,
        remedy: 'npm install -g @anthropic-ai/claude-code@latest'
      });
    } else {
      checks.push({ id: 'claude', label: 'Claude Code', status: 'ok', detail: version });
    }
  }

  // Antigravity is a preview adapter; its absence is not a problem.
  const agy = tryRun(process.platform === 'win32' ? 'where' : 'which', ['agy']);
  checks.push({
    id: 'antigravity',
    label: 'Antigravity (preview)',
    status: agy ? 'ok' : 'warn',
    detail: agy ? 'Found on PATH.' : 'Not installed. Optional.',
    remedy: agy ? undefined : 'Only needed if you want to try the preview adapter.'
  });

  return checks;
}

/** Environment rows: the things that stop Asterim itself from working. */
export function checkEnvironment(): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];
  const channel = describeChannel();

  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  checks.push({
    id: 'node',
    label: 'Node.js',
    status: nodeMajor >= 22 ? 'ok' : 'fail',
    detail: process.versions.node,
    remedy: nodeMajor >= 22 ? undefined : 'Asterim needs Node 22 or newer (it uses the built-in SQLite).'
  });

  const dataDir = channel.dataDir;
  let dataDirStatus: DiagnosticCheck = {
    id: 'data-dir',
    label: 'Data directory',
    status: 'ok',
    detail: '<data-dir>'
  };
  try {
    fs.accessSync(dataDir, fs.constants.W_OK);
  } catch {
    dataDirStatus = {
      id: 'data-dir',
      label: 'Data directory',
      status: 'fail',
      detail: '<data-dir> is not writable.',
      remedy: 'Check permissions on the folder, or set ASTERIM_DATA_DIR to somewhere writable.'
    };
  }
  checks.push(dataDirStatus);

  // Stale WAL sidecars are the known Windows failure after a force-kill.
  try {
    const wal = path.join(dataDir, 'asterim.db-wal');
    if (fs.existsSync(wal) && fs.statSync(wal).size > 32 * 1024 * 1024) {
      checks.push({
        id: 'wal',
        label: 'Database journal',
        status: 'warn',
        detail: 'The write-ahead log is unusually large.',
        remedy: 'Stop Asterim with Ctrl+C rather than killing it, then start it again.'
      });
    }
  } catch {
    /* not important enough to fail a report */
  }

  checks.push({
    id: 'sovereign',
    label: 'Sovereign mode',
    status: 'ok',
    detail: process.env.ASTERIM_SOVEREIGN_MODE === 'true' ? 'On — no outbound connections.' : 'Off (Asterim still makes none of its own).'
  });

  checks.push({
    id: 'hooks',
    label: 'Claude Code hooks',
    status: process.env.ASTERIM_CLAUDE_DISABLE_HOOKS === 'true' ? 'ok' : 'warn',
    detail:
      process.env.ASTERIM_CLAUDE_DISABLE_HOOKS === 'true'
        ? 'Disabled for Asterim sessions — its approval card is the only decider.'
        : 'Enabled. Your own hooks or permission rules may answer a request before Asterim shows it.',
    remedy:
      process.env.ASTERIM_CLAUDE_DISABLE_HOOKS === 'true'
        ? undefined
        : 'Set ASTERIM_CLAUDE_DISABLE_HOOKS=true if you want every action to reach the approval card.'
  });

  return checks;
}

/** The last lines of this channel's log, redacted. */
export function readLogTail(lines = LOG_TAIL_LINES): string[] {
  try {
    const logPath = path.join(resolveDataDir(), 'server.log');
    if (!fs.existsSync(logPath)) return [];
    const raw = fs.readFileSync(logPath, 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      // Request logging is noise in a bug report and is the bulk of the file.
      .filter(line => !line.includes('"reqId"'))
      .slice(-lines)
      .map(redactForReport)
      .map(line => (line.length > 500 ? `${line.slice(0, 500)}…` : line));
  } catch {
    return [];
  }
}

/** Everything a support conversation needs, and nothing private. */
export function collectDiagnostics(schemaVersion?: number): DiagnosticsReport {
  const channel = describeChannel();
  return {
    generatedAt: new Date().toISOString(),
    asterim: {
      version: channel.version,
      channel: channel.channel,
      port: channel.port,
      dataDir: '<data-dir>',
      uptimeSeconds: Math.round(process.uptime()),
      schemaVersion
    },
    runtime: {
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release()
    },
    agents: checkAgents(),
    environment: checkEnvironment(),
    logTail: readLogTail()
  };
}

/** The report as the block of text a person pastes into an issue. */
export function formatDiagnostics(report: DiagnosticsReport): string {
  const line = (check: DiagnosticCheck) =>
    `  ${check.status === 'ok' ? '[ok]' : check.status === 'warn' ? '[warn]' : '[FAIL]'} ${check.label}${
      check.detail ? ` — ${check.detail}` : ''
    }${check.remedy ? `\n        → ${check.remedy}` : ''}`;

  return [
    `Asterim ${report.asterim.version} (${report.asterim.channel} channel, port ${report.asterim.port})`,
    `Node ${report.runtime.node} · ${report.runtime.platform} ${report.runtime.arch} ${report.runtime.osRelease}`,
    `Up ${report.asterim.uptimeSeconds}s${report.asterim.schemaVersion ? ` · schema v${report.asterim.schemaVersion}` : ''}`,
    '',
    'Agents',
    ...report.agents.map(line),
    '',
    'Environment',
    ...report.environment.map(line),
    '',
    `Recent log (${report.logTail.length} lines, paths and credentials redacted)`,
    ...report.logTail.map(l => `  ${l}`)
  ].join('\n');
}
