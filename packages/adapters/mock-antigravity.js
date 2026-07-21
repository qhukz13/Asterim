const readline = require('readline');

console.log('Welcome to Google Antigravity Agent v1.0.0');
console.log('Initializing workspace...');
console.log('Antigravity is ready. Enter command:');
process.stdout.write('antigravity> ');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

let waitingForApproval = false;

rl.on('line', line => {
  const trimmed = line.trim();
  if (trimmed === 'exit' || trimmed === 'quit') {
    console.log('Exiting Antigravity...');
    process.exit(0);
  }

  if (waitingForApproval) {
    if (trimmed.toLowerCase() === 'y' || trimmed.toLowerCase() === 'yes') {
      console.log('\nExecuting action...');
      console.log('Applying modifications...');
      console.log('Action successful!');
      waitingForApproval = false;
      process.stdout.write('\nantigravity> ');
    } else if (trimmed.toLowerCase() === 'n' || trimmed.toLowerCase() === 'no') {
      console.log('\nAction cancelled.');
      waitingForApproval = false;
      process.stdout.write('\nantigravity> ');
    } else {
      console.log('\nInvalid input. Please enter y or n:');
      process.stdout.write('? Execute action? (y/n) ');
    }
  } else {
    if (trimmed) {
      console.log(`Thinking about: ${trimmed}`);
      console.log('Analyzing project files...');
      console.log('Proposed change: Modify packages/core/src/index.ts to add new features');
      // Output the exact format the adapter expects for approvals
      process.stdout.write('? Execute action? (y/n) ');
      waitingForApproval = true;
    } else {
      process.stdout.write('antigravity> ');
    }
  }
});
