const Database = require('better-sqlite3');
const db = new Database('c:\\Projects\\AgentDeck\\apps\\server\\agentdeck.db');

// Delete all projects
db.prepare('DELETE FROM projects').run();

// Insert one test project
const crypto = require('crypto');
const id = crypto.randomUUID();
db.prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)').run(
  id,
  'Antigravity Test',
  'C:\\Projects\\AgentDeckTEST'
);

console.log("Projects cleared, inserted 1 test project.");
db.close();
