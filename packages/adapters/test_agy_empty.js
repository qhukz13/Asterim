const pty = require('node-pty');
const ptyProcess = pty.spawn('C:\\Users\\qhukz\\AppData\\Local\\agy\\bin\\agy.exe', [], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: 'C:\\Projects\\AsterimTEST',
  env: process.env
});
ptyProcess.onData(data => console.log('DATA:', data));
ptyProcess.onExit(({ exitCode }) => console.log('EXIT:', exitCode));
