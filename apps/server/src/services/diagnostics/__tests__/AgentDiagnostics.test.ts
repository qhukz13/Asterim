/**
 * Diagnostics: does a failure tell a stranger what to do, and does a report
 * leak anything it should not?
 *
 * Run:  pnpm --filter asterim exec tsx src/services/diagnostics/__tests__/AgentDiagnostics.test.ts
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-diag-'));
process.env.ASTERIM_DATA_DIR = dataDir;

import {
  collectDiagnostics,
  diagnoseAgentFailure,
  formatDiagnostics,
  isVersionAtLeast,
  readLogTail,
  redactForReport
} from '../AgentDiagnostics';

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name} — ${(err as Error).message}`);
  }
}
function describe(name: string) {
  console.log(`\n${name}`);
}

describe('every recognised failure names a cause and something to try');
{
  const cases: [string, string][] = [
    ['Claude Code is not installed or not on PATH. Install it with…', 'CLI_NOT_FOUND'],
    ['spawn claude ENOENT', 'CLI_NOT_FOUND'],
    ['Turn failed: Not logged in · Please run /login', 'CLI_NOT_LOGGED_IN'],
    ['spawn EACCES', 'CLI_SPAWN_DENIED'],
    ['Error: Workspace directory does not exist: /gone', 'WORKSPACE_MISSING'],
    ['Blocked by fleet policy: model not permitted', 'POLICY_BLOCKED'],
    ['Claude Code exited with code 1.', 'CLI_EXITED'],
    ['Asterim could not talk to it: bad control request', 'PROTOCOL_FAILURE']
  ];

  for (const [message, expected] of cases) {
    check(`"${message.slice(0, 34)}…" → ${expected}`, () => {
      const d = diagnoseAgentFailure('claude', message);
      assert.strictEqual(d.code, expected);
      assert.ok(d.title.length > 0, 'has a title');
      assert.ok(d.remedies.length > 0, 'offers at least one thing to try');
      assert.ok(d.detail.includes(message.slice(0, 12)), 'keeps the original message');
    });
  }

  check('an unrecognised failure still carries the original text and a next step', () => {
    const d = diagnoseAgentFailure('claude', 'something bizarre happened');
    assert.strictEqual(d.code, 'UNKNOWN');
    assert.ok(d.detail.includes('something bizarre'));
    assert.ok(d.remedies.length > 0);
  });

  check('an empty failure never produces an empty explanation', () => {
    const d = diagnoseAgentFailure('claude', '');
    assert.ok(d.title.length > 0);
    assert.ok(d.detail.length > 0);
    assert.ok(d.remedies.length > 0);
  });

  check('the agent is named in the person’s own words', () => {
    assert.ok(diagnoseAgentFailure('claude', 'spawn ENOENT').title.includes('Claude Code'));
  });
}

describe('version comparison');
{
  check('newer and equal pass, older fails', () => {
    assert.strictEqual(isVersionAtLeast('2.1.251', '2.1.0'), true);
    assert.strictEqual(isVersionAtLeast('2.1.0', '2.1.0'), true);
    assert.strictEqual(isVersionAtLeast('2.0.9', '2.1.0'), false);
    assert.strictEqual(isVersionAtLeast('3.0.0', '2.1.0'), true);
  });
  check('a version string with surrounding text still compares', () => {
    assert.strictEqual(isVersionAtLeast('2.1.251 (Claude Code)', '2.1.0'), true);
  });
}

describe('redaction: a report may leave the machine, so nothing private may be in it');
{
  const home = os.homedir();

  check('the home directory is replaced wherever it appears', () => {
    const out = redactForReport(`opened ${home}/projects/secret-client/app.ts`);
    assert.ok(!out.includes(home), out);
    assert.ok(out.includes('<home>'));
  });

  check('the data directory is replaced', () => {
    const out = redactForReport(`database at ${dataDir}/asterim.db`);
    assert.ok(!out.includes(dataDir));
    assert.ok(out.includes('<data-dir>'));
  });

  check('credential-shaped strings are removed', () => {
    const out = redactForReport('using sk-abcdef1234567890 and ghp_ABCDEFGHIJ1234567890');
    assert.ok(!out.includes('sk-abcdef1234567890'), out);
    assert.ok(!out.includes('ghp_ABCDEFGHIJ1234567890'), out);
  });

  check('a labelled secret in JSON is removed but its shape is kept', () => {
    const out = redactForReport('{"token":"super-secret-value","port":3000}');
    assert.ok(!out.includes('super-secret-value'), out);
    assert.ok(out.includes('port'));
  });

  check('a bearer header is removed', () => {
    const out = redactForReport('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc');
    assert.ok(!out.includes('eyJhbGciOiJIUzI1NiJ9'), out);
  });
}

describe('the log tail');
{
  const logPath = path.join(dataDir, 'server.log');
  fs.writeFileSync(
    logPath,
    [
      '{"level":30,"reqId":"req-1","msg":"incoming request"}',
      `[Server] opened ${os.homedir()}/work/thing`,
      'x'.repeat(900),
      '[Agent] started'
    ].join('\n')
  );

  const tail = readLogTail();

  check('request-log noise is dropped', () => {
    assert.ok(!tail.some(l => l.includes('incoming request')), JSON.stringify(tail));
  });
  check('paths in the tail are redacted', () => {
    assert.ok(tail.some(l => l.includes('<home>')));
    assert.ok(!tail.some(l => l.includes(os.homedir())));
  });
  check('very long lines are cut', () => {
    assert.ok(tail.every(l => l.length <= 501), 'no line over the cap');
  });
  check('a missing log file is not an error', () => {
    fs.rmSync(logPath);
    assert.deepStrictEqual(readLogTail(), []);
  });
}

describe('the whole report');
{
  const report = collectDiagnostics(6);

  check('it describes this installation', () => {
    assert.strictEqual(report.asterim.dataDir, '<data-dir>');
    assert.strictEqual(report.asterim.schemaVersion, 6);
    assert.strictEqual(report.runtime.node, process.versions.node);
    assert.ok(report.generatedAt.includes('T'));
  });

  check('it checks every agent Asterim can drive', () => {
    const ids = report.agents.map(a => a.id);
    assert.ok(ids.includes('claude'));
    assert.ok(ids.includes('antigravity'));
  });

  check('every failing or warning row says what to do about it', () => {
    for (const row of [...report.agents, ...report.environment]) {
      if (row.status !== 'ok') {
        assert.ok(row.remedy || row.detail, `${row.id} offers nothing`);
      }
    }
  });

  check('node and the data directory are always checked', () => {
    const ids = report.environment.map(e => e.id);
    assert.ok(ids.includes('node'));
    assert.ok(ids.includes('data-dir'));
  });

  check('the printed form is readable and mentions the version', () => {
    const text = formatDiagnostics(report);
    assert.ok(text.includes('Asterim '));
    assert.ok(text.includes('Agents'));
    assert.ok(text.includes('Environment'));
    assert.ok(!text.includes(os.homedir()), 'no home path survives into the printed form');
  });
}

fs.rmSync(dataDir, { recursive: true, force: true });
console.log(`\n${passed}/${passed + failed} assertions passed`);
if (failed > 0) process.exit(1);
