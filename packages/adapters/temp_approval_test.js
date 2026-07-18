const pty = require('node-pty');

const ptyProcess = pty.spawn('cmd.exe', ['/c', 'agy'], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: 'C:/Projects/AsterimTEST',
  env: { ...process.env, FORCE_COLOR: '1' }
});

let output = '';
ptyProcess.onData((data) => {
  output += data;
  process.stdout.write(data);
});

setTimeout(() => {
  ptyProcess.write('create a new python file test_approval.py and run it\r\n');
}, 3000);

setTimeout(() => {
  console.log('\n\n--- RAW OUTPUT DUMP ---');
  console.log(JSON.stringify(output));
  process.exit(0);
}, 10000);
