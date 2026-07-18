const pty = require('node-pty');
const ptyProcess = pty.spawn('cmd.exe', ['/c', 'echo привет'], {
  name: 'xterm-color',
  cols: 80,
  rows: 24,
  useConpty: true
});
ptyProcess.onData((data) => {
  console.log('OUTPUT:', Buffer.from(data).toString());
});
