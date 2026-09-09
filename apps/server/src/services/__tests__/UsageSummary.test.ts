/**
 * The local usage summary (P0-11).
 *
 * The counters matter, but the assertion that matters most is the last one:
 * the summary is offered to users as something safe to paste into a
 * conversation, so this seeds a database whose project name, path, prompt and
 * command are distinctive strings and fails if any of them reaches the output.
 * If that test ever goes red, the feature is not shippable until it is green.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/__tests__/UsageSummary.test.ts
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { computeUsageSummary, formatDuration, formatUsageSummary } from '../UsageSummary';

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-usage-'));

// Distinctive enough that a substring search cannot produce a false negative.
const SECRET_NAME = 'ZZQPROJECTNAMEZZQ';
const SECRET_PATH = '/home/zzqsecretuser/zzqrepodir';
const SECRET_PROMPT = 'ZZQPROMPTTEXTZZQ';
const SECRET_COMMAND = 'rm -rf /zzqcommandpathzzq';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);

function schema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, path TEXT, created_at DATETIME);
    CREATE TABLE threads (id TEXT PRIMARY KEY, project_id TEXT, name TEXT);
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project_id TEXT, thread_id TEXT, agent_type TEXT,
      status TEXT, started_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE approvals (
      id TEXT PRIMARY KEY, project_id TEXT, thread_id TEXT, action_id TEXT,
      description TEXT, command TEXT, status TEXT, created_at INTEGER
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY, project_id TEXT, thread_id TEXT, timestamp INTEGER,
      source TEXT, type TEXT, payload_json TEXT
    );
  `);
}

/** A database with two days of use, both providers, every approval outcome and one failure. */
function seedFull(): DatabaseSync {
  const db = new DatabaseSync(path.join(tmp, 'full.db'));
  schema(db);

  db.prepare('INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)').run(
    'p1',
    SECRET_NAME,
    SECRET_PATH,
    '2026-01-05 12:00:00'
  );
  db.prepare('INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)').run(
    'p2',
    'Second',
    '/tmp/second',
    '2026-01-05 12:00:00'
  );
  for (const id of ['t1', 't2', 't3']) {
    db.prepare('INSERT INTO threads (id, project_id, name) VALUES (?, ?, ?)').run(id, 'p1', id);
  }

  const session = db.prepare(
    'INSERT INTO sessions (id, project_id, thread_id, agent_type, status, started_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  );
  session.run('s1', 'p1', 't1', 'claude', 'stopped', T0, T0);
  session.run('s2', 'p1', 't2', 'claude', 'stopped', T0 + 60_000, T0 + 60_000);
  // A third session two days later, so "active days" and "days" differ.
  session.run('s3', 'p1', 't3', 'antigravity', 'stopped', T0 + 2 * DAY, T0 + 2 * DAY);

  const approval = db.prepare(
    'INSERT INTO approvals (id, project_id, thread_id, action_id, description, command, status, created_at) VALUES (?,?,?,?,?,?,?,?)'
  );
  approval.run('a1', 'p1', 't1', 'act1', SECRET_PROMPT, SECRET_COMMAND, 'approved', T0 + 252_000);
  approval.run('a2', 'p1', 't1', 'act2', SECRET_PROMPT, SECRET_COMMAND, 'approved', T0 + 300_000);
  approval.run('a3', 'p1', 't1', 'act3', SECRET_PROMPT, SECRET_COMMAND, 'denied', T0 + 400_000);
  approval.run('a4', 'p1', 't2', 'act4', SECRET_PROMPT, SECRET_COMMAND, 'expired', T0 + 500_000);
  approval.run('a5', 'p1', 't2', 'act5', SECRET_PROMPT, SECRET_COMMAND, 'cancelled', T0 + 600_000);
  approval.run('a6', 'p1', 't2', 'act6', SECRET_PROMPT, SECRET_COMMAND, 'weird', T0 + 700_000);

  const event = db.prepare(
    'INSERT INTO events (id, project_id, thread_id, timestamp, source, type, payload_json) VALUES (?,?,?,?,?,?,?)'
  );
  let n = 0;
  const addEvent = (source: string, type: string, payload: unknown, at: number) =>
    event.run(`e${n++}`, 'p1', 't1', at, source, type, JSON.stringify(payload));

  // Four agent replies from Claude, one from Antigravity, plus messages the
  // person sent (server source) which must not be counted as agent turns.
  for (let i = 0; i < 4; i++) {
    addEvent('adapter:claude', 'chat.message', { role: 'agent', content: SECRET_PROMPT }, T0 + i * 1000);
  }
  addEvent('adapter:antigravity', 'chat.message', { role: 'agent', content: 'hi' }, T0 + 2 * DAY);
  addEvent('server', 'chat.message', { role: 'user', content: SECRET_PROMPT }, T0);
  addEvent('remote:abc', 'client.chat_message', { content: SECRET_PROMPT }, T0);

  addEvent('adapter:claude', 'agent.tool_call', { tool: 'Bash', input: SECRET_COMMAND }, T0 + 5_000);
  addEvent('adapter:claude', 'agent.tool_call', { tool: 'Write', input: SECRET_PATH }, T0 + 6_000);

  addEvent('server', 'agent.status', { status: 'idle' }, T0);
  addEvent(
    'server',
    'agent.status',
    { status: 'error', message: SECRET_PATH, diagnosis: { code: 'CLI_NOT_FOUND' } },
    T0 + 10_000
  );
  addEvent(
    'server',
    'agent.status',
    { status: 'error', message: SECRET_PATH, diagnosis: { code: 'CLI_NOT_FOUND' } },
    T0 + 11_000
  );
  // An error with no diagnosis still has to be counted, under UNKNOWN.
  addEvent('server', 'agent.status', { status: 'error', message: SECRET_PATH }, T0 + 12_000);

  return db;
}

const full = seedFull();
const summary = computeUsageSummary(full, T0 + 3 * DAY);
const text = formatUsageSummary(summary);

describe('Counters');

check('counts sessions and the distinct days they started on', () => {
  assert.strictEqual(summary.sessions, 3);
  assert.strictEqual(summary.activeDays, 2);
});

check('counts projects and threads', () => {
  assert.strictEqual(summary.projects, 2);
  assert.strictEqual(summary.threads, 3);
});

check('counts only adapter messages as agent turns, and attributes them', () => {
  assert.strictEqual(summary.turns, 5);
  const claude = summary.turnsByProvider.find(p => p.label === 'claude');
  const antigravity = summary.turnsByProvider.find(p => p.label === 'antigravity');
  assert.strictEqual(claude?.count, 4);
  assert.strictEqual(antigravity?.count, 1);
});

check('counts tool calls', () => {
  assert.strictEqual(summary.toolCalls, 2);
});

check('splits approvals by outcome and maps cancelled onto withdrawn', () => {
  assert.strictEqual(summary.approvals.total, 6);
  assert.strictEqual(summary.approvals.approved, 2);
  assert.strictEqual(summary.approvals.denied, 1);
  assert.strictEqual(summary.approvals.expired, 1);
  assert.strictEqual(summary.approvals.withdrawn, 1);
  assert.strictEqual(summary.approvals.other, 1);
});

check('measures time from first activity to the first approval', () => {
  assert.strictEqual(summary.msToFirstApproval, 252_000);
  assert.strictEqual(formatDuration(summary.msToFirstApproval as number), '4m12s');
});

check('groups start failures by diagnosis code, defaulting to UNKNOWN', () => {
  assert.strictEqual(summary.startFailureTotal, 3);
  const byCode = Object.fromEntries(summary.startFailures.map(f => [f.label, f.count]));
  assert.strictEqual(byCode.CLI_NOT_FOUND, 2);
  assert.strictEqual(byCode.UNKNOWN, 1);
});

check('spans the days between the first activity and now', () => {
  assert.strictEqual(summary.days, 3);
  assert.deepStrictEqual(summary.unavailable, []);
});

describe('Durations');

check('formats seconds, minutes and hours', () => {
  assert.strictEqual(formatDuration(18_000), '18s');
  assert.strictEqual(formatDuration(252_000), '4m12s');
  assert.strictEqual(formatDuration(7_500_000), '2h05m');
  assert.strictEqual(formatDuration(-5), '0s');
});

describe('What the output must never contain');

check('no project name, path, prompt or command appears anywhere in the text', () => {
  for (const secret of [SECRET_NAME, SECRET_PATH, SECRET_PROMPT, SECRET_COMMAND, 'zzq']) {
    assert.ok(
      !text.toLowerCase().includes(secret.toLowerCase()),
      `the formatted summary leaked "${secret}"`
    );
  }
});

check('no identifier appears anywhere in the serialised summary either', () => {
  const json = JSON.stringify(summary).toLowerCase();
  for (const secret of [SECRET_NAME, SECRET_PATH, SECRET_PROMPT, SECRET_COMMAND, 'zzq']) {
    assert.ok(!json.includes(secret.toLowerCase()), `the summary object leaked "${secret}"`);
  }
  // Row ids are identifiers too, even if they are not secrets.
  for (const id of ['p1', 'p2', 't1', 's1', 'a1', 'act1']) {
    assert.ok(!json.includes(`"${id}"`), `the summary object leaked the id "${id}"`);
  }
});

check('the text says where it lives and who decides to share it', () => {
  assert.ok(/never sends it anywhere/i.test(text));
  assert.ok(/your choice/i.test(text));
});

describe('Nothing leaves the machine');

check('computing and formatting the summary opens no network connection', () => {
  // The claim on the panel and in SECURITY.md is that this is never sent
  // anywhere. Asserting it by reading the code is not an assertion, so every
  // outbound primitive is replaced with one that throws and the whole path is
  // run again. If a future change adds a fetch, this test fails rather than the
  // promise quietly becoming false.
  const net = require('net') as typeof import('net');
  const dns = require('dns') as typeof import('dns');
  const http = require('http') as typeof import('http');
  const https = require('https') as typeof import('https');

  const originals = {
    connect: net.Socket.prototype.connect,
    netConnect: net.connect,
    lookup: dns.lookup,
    httpRequest: http.request,
    httpsRequest: https.request,
    fetch: (globalThis as { fetch?: unknown }).fetch
  };
  const refuse = () => {
    throw new Error('the usage summary attempted a network call');
  };

  try {
    (net.Socket.prototype as unknown as { connect: unknown }).connect = refuse;
    (net as unknown as { connect: unknown }).connect = refuse;
    (dns as unknown as { lookup: unknown }).lookup = refuse;
    (http as unknown as { request: unknown }).request = refuse;
    (https as unknown as { request: unknown }).request = refuse;
    (globalThis as { fetch?: unknown }).fetch = refuse;

    const again = computeUsageSummary(full, T0 + 3 * DAY);
    formatUsageSummary(again);
    assert.strictEqual(again.approvals.total, 6);
  } finally {
    (net.Socket.prototype as unknown as { connect: unknown }).connect = originals.connect;
    (net as unknown as { connect: unknown }).connect = originals.netConnect;
    (dns as unknown as { lookup: unknown }).lookup = originals.lookup;
    (http as unknown as { request: unknown }).request = originals.httpRequest;
    (https as unknown as { request: unknown }).request = originals.httpsRequest;
    (globalThis as { fetch?: unknown }).fetch = originals.fetch;
  }
});

describe('Empty and damaged databases');

check('an empty database reports nothing recorded rather than zeroes', () => {
  const db = new DatabaseSync(path.join(tmp, 'empty.db'));
  schema(db);
  const empty = computeUsageSummary(db, T0);
  assert.strictEqual(empty.firstActivityAt, null);
  assert.strictEqual(empty.days, 0);
  assert.strictEqual(empty.approvals.total, 0);
  assert.strictEqual(empty.msToFirstApproval, null);
  const emptyText = formatUsageSummary(empty);
  assert.ok(/nothing recorded yet/i.test(emptyText));
  db.close();
});

check('sessions but no approvals still produces a summary', () => {
  const db = new DatabaseSync(path.join(tmp, 'noapprovals.db'));
  schema(db);
  db.prepare(
    'INSERT INTO sessions (id, project_id, thread_id, agent_type, status, started_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  ).run('s1', 'p1', 't1', 'claude', 'stopped', T0, T0);
  const partial = computeUsageSummary(db, T0 + 1000);
  assert.strictEqual(partial.sessions, 1);
  assert.strictEqual(partial.approvals.total, 0);
  assert.strictEqual(partial.msToFirstApproval, null);
  assert.ok(formatUsageSummary(partial).includes('none yet'));
  db.close();
});

check('a database missing a table names it as unavailable instead of throwing', () => {
  const db = new DatabaseSync(path.join(tmp, 'old.db'));
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, path TEXT, created_at DATETIME);
    CREATE TABLE events (
      id TEXT PRIMARY KEY, project_id TEXT, thread_id TEXT, timestamp INTEGER,
      source TEXT, type TEXT, payload_json TEXT
    );
  `);
  db.prepare('INSERT INTO projects (id, name, path, created_at) VALUES (?,?,?,?)').run(
    'p1',
    'x',
    '/x',
    '2026-01-05 12:00:00'
  );
  db.prepare(
    'INSERT INTO events (id, project_id, thread_id, timestamp, source, type, payload_json) VALUES (?,?,?,?,?,?,?)'
  ).run('e1', 'p1', 't1', T0, 'adapter:claude', 'chat.message', '{}');
  const old = computeUsageSummary(db, T0 + 1000);
  assert.strictEqual(old.projects, 1);
  assert.strictEqual(old.turns, 1);
  assert.ok(old.unavailable.includes('sessions'), 'sessions should be reported as unavailable');
  assert.ok(old.unavailable.includes('approvals'), 'approvals should be reported as unavailable');
  assert.ok(/Not recorded on this database/.test(formatUsageSummary(old)));
  db.close();
});

full.close();
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  /* Windows sometimes holds the file briefly; the temp directory is disposable. */
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
