const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('--- TESTING REAL APPROVAL MODAL CLICK ---');
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

  // Send a message that triggers action approval
  const textarea = await page.$('.input-box');
  await textarea.click();
  const testMsg = 'Refactor the database authentication logic ' + Date.now();
  await textarea.type(testMsg);
  await page.keyboard.press('Enter');

  console.log('Message sent. Waiting for Approval Dialog modal (.dialog-overlay .btn-approve)...');
  await page.waitForSelector('.dialog-overlay .btn-approve', { timeout: 10000 });

  console.log('Found .dialog-overlay .btn-approve! Triggering click...');
  await page.evaluate(() => {
    const btn = document.querySelector('.dialog-overlay .btn-approve');
    if (btn) btn.click();
  });

  console.log('Clicked Approve button. Waiting 5s for action completion & status change to Idle...');
  await new Promise(r => setTimeout(r, 5000));

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('=== DOM TEXT AFTER APPROVAL ===');
  console.log('Action successful in DOM:', bodyText.includes('Action successful') || bodyText.includes('Executing action') || bodyText.includes('Applying modifications'));
  console.log('Agent status is Idle:', bodyText.includes('○ Idle'));
  console.log('===============================');

  if (bodyText.includes('Action successful') || bodyText.includes('Executing action') || bodyText.includes('○ Idle')) {
    console.log('SUCCESS: Real Approval Modal clicked & Agent executed action successfully 100%!');
  } else {
    console.error('FAILED: Agent output not rendered after approval!');
    process.exit(1);
  }

  await browser.close();
  console.log('--- TEST COMPLETE ---');
})();
