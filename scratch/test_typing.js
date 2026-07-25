const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('--- TESTING CHAT INPUT TYPING & SENDING ---');
  const pin = fs.readFileSync(path.join(process.cwd(), 'apps/server/pairing_pin.txt'), 'utf8').trim();

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('asterim_default_agent', 'antigravity');
  });

  const pinInput = await page.$('input[placeholder*="PIN"], input[type="text"]');
  if (pinInput) {
    await pinInput.type(pin);
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 2000));
  }

  const projectId = 'a0c0d755-e2df-479e-92c1-6701e8cb3ddb';
  const threadId = '6ae1794d-8caf-4d9c-af67-d445399841f3';
  await page.goto(`http://127.0.0.1:5173/workspace/project/${projectId}/thread/${threadId}/view/chat`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 3000));

  // Find chat input textarea
  const textarea = await page.$('.input-box');
  if (!textarea) {
    console.error('ERROR: .input-box textarea not found!');
    process.exit(1);
  }

  console.log('Found .input-box textarea. Focus & type...');
  await textarea.click();
  await textarea.type('Hello Asterim Test');
  
  const value = await page.evaluate(el => el.value, textarea);
  console.log('Textarea value after typing:', JSON.stringify(value));

  if (value === 'Hello Asterim Test') {
    console.log('SUCCESS: Typing in chat input works 100%!');
  } else {
    console.error('FAILURE: Textarea value is empty or incorrect!');
    process.exit(1);
  }

  await browser.close();
  console.log('--- CHAT TYPING TEST COMPLETE ---');
})();
