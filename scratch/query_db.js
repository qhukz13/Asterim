const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/home/qhukz/.asterim/asterim.db');
const rows = db.prepare("SELECT timestamp, source, type, payload_json FROM events WHERE type='chat.message' OR type='agent.status' ORDER BY timestamp DESC LIMIT 100;").all();
rows.forEach(r => {
  console.log(`[${r.timestamp}] [${r.type}] ${r.payload_json}`);
});
