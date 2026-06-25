import * as fs from 'fs';

function testPrompt(filename: string) {
  const data = fs.readFileSync(filename, 'utf8');

  let chatBuffer = data;
  let cleanedBuffer = chatBuffer;

  cleanedBuffer = cleanedBuffer.replace(/\x1b\[\d*D/g, '\x08');
  cleanedBuffer = cleanedBuffer.replace(/\x1B\[\??[0-9;]*[A-Za-z]/g, '');
  cleanedBuffer = cleanedBuffer.replace(/\x1B\][^\x07]+\x07/g, '');

  const spinnerRegex = /[⣷⣯⣟⡿⢿⣻⣽⣾⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g;
  cleanedBuffer = cleanedBuffer.replace(spinnerRegex, '');

  while (cleanedBuffer.includes('\x08')) {
    cleanedBuffer = cleanedBuffer.replace(/[^\x08]\x08/, '');
    cleanedBuffer = cleanedBuffer.replace(/^\x08+/, '');
  }

  cleanedBuffer = cleanedBuffer.replace(/\r\n/g, '\n');
  let lines = cleanedBuffer.split('\n');
  lines = lines.map(line => {
    const parts = line.split('\r');
    return parts[parts.length - 1];
  });
  cleanedBuffer = lines.join('\n');

  const promptRegex = /(?:^|\n)>\s*\n─{10,}\n\? for shortcuts/i;
  console.log(`[${filename}] MATCH:`, promptRegex.test(cleanedBuffer));
  
  if (promptRegex.test(cleanedBuffer)) {
      const match = cleanedBuffer.match(promptRegex);
      if (match) {
          const msg = cleanedBuffer.substring(0, match.index);
          console.log("EXTRACTED MSG LENGTH:", msg.length);
          console.log("EXTRACTED MSG ENDS WITH:");
          console.log(JSON.stringify(msg.substring(msg.length - 200)));
      }
  }
}

testPrompt('pty_out.txt');
testPrompt('pty_interactive.txt');
