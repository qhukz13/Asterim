const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('--- DEBUGGING DOM STATE & STATUS BADGE ---');
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
  const testMsg = 'Hello agent test ' + Date.now();
  await textarea.type(testMsg);
  await page.keyboard.press('Enter');

  console.log('Sent prompt. Watching status every 2 seconds for 20s...');

  for (let sec = 2; sec <= 20; sec += 2) {
    await new Promise(r => setTimeout(r, 2000));
    const statusText = await page.evaluate(() => {
      const badge = document.querySelector('[class*="status"], [class*="badge"], .agent-status');
      return {
        badgeText: badge ? badge.innerText : 'NO BADGE FOUND',
        bodyContainsExecuting: document.body.innerText.includes('Executing'),
        bodyContainsReady: document.body.innerText.includes('Ready') || document.body.innerText.includes('Idle'),
        messagesCount: document.querySelectorAll('.chat-message, [class*="message"]').length
      };
    });
    console.log(`[t=${sec}s] Badge: "${statusText.badgeText}" | ExecutingInBody: ${statusText.bodyContainsExecuting} | Messages: ${statusText.messagesCount}`);
  }

  await browser.close();
})();
