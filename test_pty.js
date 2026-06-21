const pty = require('node-pty');
const ptyProcess = pty.spawn('C:\\Users\\qhukz\\AppData\\Local\\agy\\bin\\agy.exe', ['-c'], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: 'C:\\Projects\\AgentDeckTEST_NEW',
  env: { ...process.env, FORCE_COLOR: '1' }
});

ptyProcess.onData((data) => {
  console.log("DATA:", data);
});

ptyProcess.onExit(({ exitCode }) => {
  console.log("EXIT CODE:", exitCode);
});
