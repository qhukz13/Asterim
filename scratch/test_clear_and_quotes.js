const { AntigravityFSM } = require('../packages/adapters/dist/providers/antigravity/terminal/TerminalFSM');

console.log('--- RUNNING AGENT PARSER UNIT TESTS ---');

// Test 1: Send /clear command and verify NO message is emitted when returning to idle
console.log('\n--- Test 1: /clear command handling ---');
let emitted1 = [];
const fsm1 = new AntigravityFSM(
  (msg) => emitted1.push(msg),
  () => {},
  () => {},
  () => {},
  () => {},
  () => {}
);

fsm1.notifyCommandSent('/clear');

const mockSnapshotClear = {
  lines: [
    '      ▄▀▀▄        Antigravity CLI 1.1.8',
    '     ▀▀▀▀▀▀       v.onashchuk@gmail.com',
    '────────────────────────────────────────',
    '> ',
    '────────────────────────────────────────',
    '? for shortcuts'
  ],
  isWrapped: [false, false, false, false, false, false],
  cursorX: 2,
  cursorY: 3,
  baseY: 0
};

fsm1.process({ appendedText: '' }, mockSnapshotClear);

setTimeout(() => {
  if (emitted1.length === 0) {
    console.log('✓ TEST 1 PASSED: /clear produced NO assistant message output.');
  } else {
    console.error('✗ TEST 1 FAILED: /clear emitted message:', emitted1);
  }

  // Test 2: Send message and receive response containing markdown quote block
  console.log('\n--- Test 2: Markdown quote block response handling ---');
  let emitted2 = [];
  const fsm2 = new AntigravityFSM(
    (msg) => emitted2.push(msg),
    () => {},
    () => {},
    () => {},
    () => {},
    () => {}
  );

  fsm2.notifyCommandSent('explain git');

  const mockSnapshotWorking = {
    lines: [
      '────────────────────────────────────────',
      '> explain git',
      '────────────────────────────────────────',
      'Thinking...',
      'esc to cancel'
    ],
    isWrapped: new Array(5).fill(false),
    cursorX: 2,
    cursorY: 3,
    baseY: 0
  };

  const mockSnapshotQuote = {
    lines: [
      '────────────────────────────────────────',
      '> explain git',
      '────────────────────────────────────────',
      'Here is an explanation of git:',
      '> Note: Git is a distributed version control system.',
      '> Make sure to configure your user name and email.',
      'It tracks changes in source code during software development.',
      '────────────────────────────────────────',
      '> ',
      '────────────────────────────────────────',
      '? for shortcuts'
    ],
    isWrapped: new Array(11).fill(false),
    cursorX: 2,
    cursorY: 8,
    baseY: 0
  };

  // Step A: Agent works (sets hasSeenWorkingIndicator = true)
  fsm2.process({ appendedText: 'esc to cancel' }, mockSnapshotWorking);

  // Step B: Agent finishes response and reaches idle prompt
  fsm2.process({ appendedText: '' }, mockSnapshotQuote);

  setTimeout(() => {
    const lastMsg = emitted2[emitted2.length - 1] || '';
    if (lastMsg.includes('Here is an explanation of git:') && lastMsg.includes('> Note:') && lastMsg.includes('It tracks changes')) {
      console.log('✓ TEST 2 PASSED: Response containing markdown quote was fully extracted without truncation.');
      console.log('\nExtracted Response Content:\n-------------------\n' + lastMsg + '\n-------------------');
    } else {
      console.error('✗ TEST 2 FAILED: Response was cut off or incomplete:', JSON.stringify(lastMsg));
    }
  }, 400);

}, 400);
