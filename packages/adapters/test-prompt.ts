import * as pty from 'node-pty';
import { Terminal } from '@xterm/headless';

const xterm = new Terminal({
  cols: 80,
  rows: 30,
  allowProposedApi: true
});

const ptyProcess = pty.spawn('C:\\Users\\qhukz\\AppData\\Local\\agy\\bin\\agy.exe', [], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: 'C:\\Projects\\Asterim',
  env: { ...process.env, FORCE_COLOR: '1' } as any
});

ptyProcess.onData((data) => {
  xterm.write(data, () => {
    let screenText = '';
    const buffer = xterm.buffer.active;
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        screenText += line.translateToString(true) + '\n';
      }
    }
    const lines = screenText.trimEnd().split('\n');
    const lastLines = lines.slice(-3);
    
    console.log('--- LAST 3 LINES ---');
    console.log(lastLines);
  });
});

setTimeout(() => {
  ptyProcess.kill();
  process.exit(0);
}, 5000);
