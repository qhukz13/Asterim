const pty = require('node-pty');
const { Terminal } = require('@xterm/headless');
const { takeSnapshot } = require('./dist/terminal/ScreenSnapshot');
const { diffScreens } = require('./dist/terminal/ScreenDiff');
const { AntigravityFSM } = require('./dist/terminal/TerminalFSM');
const fs = require('fs');

const term = new Terminal({
  allowProposedApi: true,
  cols: 80,
  rows: 24,
  scrollback: 10000
});

let prev = null;
const fsm = new AntigravityFSM(
  msg => console.log('✅ MSG:', msg),
  (state, reason) => console.log(`🔄 STATE: ${state} (${reason})`),
  (desc, cmd) => console.log(`✋ APPROVAL REQUIRED: ${cmd}`),
  () => console.log('✋ TRUST REQUIRED')
);

const agyPath = 'C:\\Users\\qhukz\\AppData\\Local\\agy\\bin\\agy.exe';

const p = pty.spawn(agyPath, ['-c'], {
  name: 'xterm-color',
  cols: 80,
  rows: 24,
  env: process.env,
  useConpty: true
});

p.onData(data => {
  term.write(data, () => {
    const curr = takeSnapshot(term);
    let diff = { newLines: [], modifiedLines: [], appendedText: '' };
    if (prev) {
      diff = diffScreens(prev, curr);
    }
    prev = curr;
    fsm.process(diff, curr);

    const cursorLine = curr.lines[curr.baseY + curr.cursorY] || '';
    if (diff.appendedText || true) {
      // Always log
      console.log(
        `[TICK] cursorY=${curr.cursorY} line="${cursorLine.trimEnd()}" appended="${diff.appendedText.replace(/\n/g, '\\n')}"`
      );
    }
  });
});

setTimeout(() => {
  console.log('Sending command...');
  p.write('hello\\r');
}, 5000);
