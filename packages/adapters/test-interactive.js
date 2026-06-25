const pty = require('node-pty');
const fs = require('fs');
const ptyProcess = pty.spawn('C:\\Users\\qhukz\\AppData\\Local\\agy\\bin\\agy.exe', ['-c'], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: 'C:\\Projects\\AgentDeck',
  env: process.env
});

let out = '';
ptyProcess.onData((data) => {
  out += data;
  process.stdout.write(data); // print to node console
});

setTimeout(() => {
  console.log("\n--- SENDING COMMAND ---");
  ptyProcess.write("hi\r\n");
}, 3000);

setTimeout(() => {
  fs.writeFileSync('pty_interactive.txt', out);
  console.log("\n--- SAVED TO pty_interactive.txt ---");
  process.exit(0);
}, 8000);
