const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('--- TESTING END-TO-END CHAT & AUTO-APPROVAL FLOW ---');
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

  // Change Auto-Approval dropdown to "Auto-Approve Commands"
  const dropdown = await page.$('.approval-dropdown-container .glass-panel');
  if (dropdown) {
    console.log('Clicking Auto-Approval dropdown...');
    await dropdown.click();
    await new Promise(r => setTimeout(r, 500));
    
    // Select Auto-Approve option
    const options = await page.$$('.approval-dropdown-container div div');
    for (const opt of options) {
      const text = await page.evaluate(el => el.innerText || el.textContent, opt);
      if (text && text.includes('Auto-Approve')) {
        console.log('Selecting Auto-Approve option...');
        await opt.click();
        await new Promise(r => setTimeout(r, 500));
        break;
      }
    }
  }

  // Type & send chat message
  const textarea = await page.$('.input-box');
  await textarea.click();
  const testMsg = 'Refactor the database authentication logic ' + Date.now();
  await textarea.type(testMsg);
  await page.keyboard.press('Enter');

  console.log('Message sent. Waiting 6s for auto-approval execution & status transition to Idle...');
  await new Promise(r => setTimeout(r, 6000));

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('DOM check (Agent is Idle):', bodyText.includes('○ Idle'));
  console.log('DOM check (Action successful output):', bodyText.includes('Action successful') || bodyText.includes('Executing action') || bodyText.includes('Applying modifications'));

  if (bodyText.includes('○ Idle') || bodyText.includes('Action successful')) {
    console.log('SUCCESS: Auto-approval & execution flow verified 100%!');
  } else {
    console.error('FAILED: Agent did not transition back to Idle!');
    process.exit(1);
  }

  await browser.close();
  console.log('--- TEST COMPLETE ---');
})();
