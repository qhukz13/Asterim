const Database = require('better-sqlite3');
const db = new Database('/home/qhukz/.asterim/asterim.db');
const rows = db.prepare("SELECT timestamp, source, type, payload_json FROM events WHERE type='chat.message' OR type='agent.status' ORDER BY timestamp DESC LIMIT 20;").all();
rows.forEach(r => {
  console.log(`[${r.type}] ${r.payload_json}`);
});
