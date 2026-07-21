const { AntigravityFSM } = require('./packages/adapters/dist/terminal/TerminalFSM.js');

const fsm = new AntigravityFSM(
  () => {},
  (state, reason) => console.log('STATE CHANGED TO:', state, reason),
  () => {},
  () => {},
  (q, opts) => console.log('QUESTION TRIGGERED:', q, opts)
);

// Force state to Working
fsm.state = 'Working';

const lines = [
  '  Write: C:\\Projects\\test_folder\\test.txt',
  '  Reason: outside workspace',
  '',
  'Allow access to this file?',
  '> 1. Yes, allow access',
  '  2. Yes, and always allow non-workspace access',
  '  3. No, deny access',
  '',
  '  ↑/↓ Navigate',
  'esc to cancel                                          Gemini 3.5 Flash (Medium)'
];

// simulate process to trigger evaluateState
fsm.process(
  { appendedText: '  Reason: outside workspace' },
  { lines: lines, baseY: 0, cursorY: lines.length - 1, cursorX: 0 }
);
console.log('FINAL STATE:', fsm.getState());
