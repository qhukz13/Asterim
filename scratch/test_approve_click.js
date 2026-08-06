const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('--- TESTING USER APPROVAL CLICK FLOW ---');
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

  console.log('Message sent. Waiting 2.5s for Approval Dialog to appear...');
  await new Promise(r => setTimeout(r, 2500));

  // Find Approve button in DOM and trigger native click
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const approveBtn = btns.find(b => b.innerText.includes('Approve') || b.className.includes('btn-approve'));
    if (approveBtn) {
      approveBtn.click();
      return true;
    }
    return false;
  });

  console.log('Clicked Approve button in DOM:', clicked);

  if (clicked) {
    await new Promise(r => setTimeout(r, 3500));
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('=== FULL DOM TEXT AFTER APPROVAL CLICK ===');
    console.log(bodyText);
    console.log('===========================================');
  } else {
    console.error('FAILED: Approve button not found in DOM!');
  }

  await browser.close();
  console.log('--- TEST COMPLETE ---');
})();
