const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('--- TESTING CHAT SENDING VIA ENTER & BUTTON ---');
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

  const textarea = await page.$('.input-box');
  await textarea.click();
  const testMsg = 'Automated QA Message Verification ' + Date.now();
  await textarea.type(testMsg);
  
  console.log('Pressing Enter to send message...');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 2500));

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('Chat DOM includes sent message:', bodyText.includes(testMsg));

  if (bodyText.includes(testMsg)) {
    console.log('SUCCESS: Chat message sending verified 100%!');
  } else {
    console.error('FAILURE: Sent message not found in chat view DOM!');
    process.exit(1);
  }

  await browser.close();
  console.log('--- CHAT SEND TEST COMPLETE ---');
})();
