const { spawn } = require('child_process');

const child = spawn('C:\\Users\\qhukz\\AppData\\Local\\agy\\bin\\agy.exe', ['-c'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

child.stdout.on('data', (data) => {
  console.log('STDOUT:', JSON.stringify(data.toString()));
});

child.stderr.on('data', (data) => {
  console.error('STDERR:', JSON.stringify(data.toString()));
});

setTimeout(() => {
  child.stdin.write('hi\n');
}, 5000);

setTimeout(() => {
  child.kill();
  process.exit(0);
}, 15000);
