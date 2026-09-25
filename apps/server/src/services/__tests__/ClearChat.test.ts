export {};

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-clear-chat-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

const { dbService } = require('../DatabaseService');
const { eventBus } = require('../EventBus');
const { agentService } = require('../AgentService');

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
  check(label, ok, ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function describe(name: string): void {
  console.log(`\n${name}`);
}

function cleanup(): void {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

async function run(): Promise<void> {
  const db = dbService.getDb();

  describe('client.clear_chat event handler');

  const p1 = 'proj_clear_1';
  const t1 = 'thread_clear_1';
  const t2 = 'thread_clear_2';
  const p2 = 'proj_clear_2';

  // Seed projects
  const insertProject = db.prepare(
    'INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)'
  );
  insertProject.run(p1, 'Project 1', '/path/1', Date.now());
  insertProject.run(p2, 'Project 2', '/path/2', Date.now());

  // Seed events
  const insertEvent = db.prepare(
    `INSERT INTO events (id, project_id, thread_id, timestamp, source, type, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  insertEvent.run('evt_1', p1, t1, Date.now(), 'user', 'chat.message', JSON.stringify({ text: 'hello' }));
  insertEvent.run('evt_2', p1, t1, Date.now(), 'agent', 'chat.message', JSON.stringify({ text: 'world' }));
  insertEvent.run('evt_3', p1, t2, Date.now(), 'user', 'chat.message', JSON.stringify({ text: 'other thread' }));
  insertEvent.run('evt_4', p2, t1, Date.now(), 'user', 'chat.message', JSON.stringify({ text: 'other proj' }));

  // Seed provider session
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run(`provider_session:${t1}`, 'session_claude_12345');
  insertSetting.run(`provider_session:${t2}`, 'session_claude_67890');

  // Verify initial counts
  const countP1T1 = (db.prepare('SELECT COUNT(*) as c FROM events WHERE project_id = ? AND thread_id = ?').get(p1, t1) as any).c;
  equal('initial p1 t1 event count is 2', countP1T1, 2);

  // Publish client.clear_chat for p1, t1
  eventBus.publish({
    id: 'clear_1',
    timestamp: Date.now(),
    source: 'client:test',
    type: 'client.clear_chat',
    payload: {
      projectId: p1,
      threadId: t1
    }
  });

  // Give async subscriber a turn to execute
  await new Promise(resolve => setTimeout(resolve, 80));

  // Verify p1 t1 events are deleted
  const remainingP1T1 = (db.prepare('SELECT COUNT(*) as c FROM events WHERE project_id = ? AND thread_id = ?').get(p1, t1) as any).c;
  equal('p1 t1 events are deleted', remainingP1T1, 0);

  // Verify provider session for t1 is forgotten
  const settingT1 = db.prepare('SELECT value FROM settings WHERE key = ?').get(`provider_session:${t1}`) as any;
  equal('provider session for t1 was deleted', settingT1, undefined);

  // Verify other thread and other project events are untouched
  const countP1T2 = (db.prepare('SELECT COUNT(*) as c FROM events WHERE project_id = ? AND thread_id = ?').get(p1, t2) as any).c;
  equal('p1 t2 events are untouched', countP1T2, 1);

  const countP2T1 = (db.prepare('SELECT COUNT(*) as c FROM events WHERE project_id = ? AND thread_id = ?').get(p2, t1) as any).c;
  equal('p2 t1 events are untouched', countP2T1, 1);

  const settingT2 = db.prepare('SELECT value FROM settings WHERE key = ?').get(`provider_session:${t2}`) as any;
  equal('provider session for t2 is preserved', settingT2?.value, 'session_claude_67890');

  describe('client.clear_chat without threadId clears all project events');

  eventBus.publish({
    id: 'clear_2',
    timestamp: Date.now(),
    source: 'client:test',
    type: 'client.clear_chat',
    payload: {
      projectId: p1
    }
  });

  await new Promise(resolve => setTimeout(resolve, 80));

  const remainingP1 = (db.prepare('SELECT COUNT(*) as c FROM events WHERE project_id = ?').get(p1) as any).c;
  equal('all p1 events are cleared', remainingP1, 0);

  const remainingP2 = (db.prepare('SELECT COUNT(*) as c FROM events WHERE project_id = ?').get(p2) as any).c;
  equal('p2 events still intact', remainingP2, 1);
}

run()
  .catch(err => {
    console.error('Unhandled error during test run:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    cleanup();
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.log('Failures:\n - ' + failures.join('\n - '));
      process.exit(1);
    }
    process.exit(0);
  });

