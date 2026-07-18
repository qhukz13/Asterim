const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), '.agentdeck', 'asterim.db');
const db = new DatabaseSync(dbPath);

console.log('--- All Events (Last 50) ---');
const events = db.prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT 50').all();
console.log(events.map(e => ({
  projectId: e.project_id,
  type: e.type,
  timestamp: new Date(e.timestamp).toISOString(),
  payload: JSON.parse(e.payload_json).payload
})));
