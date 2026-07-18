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
  if (data.includes('Do you want to proceed?')) {
    setTimeout(() => {
      // Send Enter to accept the first option ("Yes")
      ptyProcess.write('\r');
    }, 1000);
  }
});

setTimeout(() => {
  ptyProcess.write('create a new python file test_approval2.py and run it\r\n');
}, 3000);

setTimeout(() => {
  console.log('\n\n--- OUTPUT DUMP ---');
  console.log(output.slice(-500));
  process.exit(0);
}, 10000);
