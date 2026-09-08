/**
 * Core-loop smoke test and screenshot capture (task P0-07).
 *
 * Drives a running Core through the real dashboard with puppeteer:
 *   pair → open project → send a task → approval card → approve → file exists
 *   → transcript closed → Changes view.
 *
 * Usage (Core already running, e.g. `node apps/server/dist/index.js`):
 *   ASTERIM_URL=http://localhost:3000 ASTERIM_PIN=123456 ASTERIM_PROJECT_PATH=C:\path\to\repo \
 *   node tools/e2e/core-loop.mjs
 *
 * With MOCK_AGENT=true on the Core, pass ASTERIM_ENGINE=antigravity to exercise the
 * mock instead of Claude Code. Screenshots land in docs/screenshots/e2e/.
 * Exit code is non-zero on any failed step.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.ASTERIM_URL || 'http://localhost:3000';
const pin = process.env.ASTERIM_PIN;
const projectPath = process.env.ASTERIM_PROJECT_PATH;
const engine = process.env.ASTERIM_ENGINE || 'claude';
const outDir = path.resolve('docs/screenshots/e2e');
if (!pin || !projectPath) {
  console.error('ASTERIM_PIN and ASTERIM_PROJECT_PATH are required');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const target = path.join(projectPath, 'ASTERIM_E2E.txt');
fs.rmSync(target, { force: true });

const steps = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    steps.push({ name, ok: true, ms: Date.now() - t });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    steps.push({ name, ok: false, ms: Date.now() - t, err: String(err.message || err) });
    console.log(`  FAIL  ${name} — ${err.message || err}`);
    throw err;
  }
};

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage();
const shot = name => page.screenshot({ path: path.join(outDir, `${name}.png`) });

const setReactValue = async (selector, value) => {
  await page.waitForSelector(selector);
  await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    selector,
    value
  );
};
const clickButton = async text =>
  page.evaluate(t => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === t && !x.disabled);
    if (!b) return false;
    b.click();
    return true;
  }, text);
const waitForButton = (text, timeout) =>
  page.waitForFunction(
    t => [...document.querySelectorAll('button')].some(x => x.textContent.trim() === t && !x.disabled),
    { timeout },
    text
  );

try {
  await step('pair with the PIN', async () => {
    await page.goto(`${url}/?pin=${pin}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => !document.querySelector('input[placeholder="Enter PIN"]'), { timeout: 15000 });
  });

  await step('dismiss the first-run wizard if shown', async () => {
    for (const label of ['Choose an agent', 'Continue', 'Open the workspace']) {
      const found = await page.evaluate(t => [...document.querySelectorAll('button')].some(x => x.textContent.trim() === t), label);
      if (found) {
        await clickButton(label);
        await new Promise(r => setTimeout(r, 400));
      }
    }
  });

  await step('add the project', async () => {
    const already = await page.evaluate(p => document.body.innerText.includes(p), projectPath);
    if (already) {
      await page.evaluate(p => {
        const el = [...document.querySelectorAll('.workspace-navigation-sidebar *')].find(x => x.textContent.trim() === p);
        el?.closest('div[role], button, div')?.click();
      }, projectPath);
      return;
    }
    await clickButton('Add Project / Existing Repository');
    await waitForButton('+ Add New Folder', 5000);
    await clickButton('+ Add New Folder');
    await setReactValue('input[placeholder="e.g. Asterim Service"]', 'E2E project');
    await setReactValue('input[placeholder="e.g. /home/user/code/my-project"]', projectPath);
    await clickButton('Add & Attach Project');
  });

  await step('socket connects and a thread is active', async () => {
    await page.waitForFunction(() => !document.body.innerText.includes('Disconnected from Workstation'), { timeout: 30000 });
    const hasThread = () => /Thread:/.test(document.querySelector('.thread-header')?.innerText || '');
    const active = await page.evaluate(hasThread);
    if (!active) {
      // Select the first existing thread, or create one for a fresh project.
      const selected = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => /session/i.test(x.textContent) && x.closest('aside'));
        if (!b) return false;
        b.click();
        return true;
      });
      if (!selected) {
        await clickButton('New Agent');
        await setReactValue('input[placeholder="e.g. Frontend Refactor"]', 'E2E thread');
        await clickButton('Create Agent');
      }
      await page.waitForFunction(hasThread, { timeout: 20000 });
    }
  });

  await step('thread opens with the composer enabled', async () => {
    await page.waitForSelector('textarea.input-box', { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('textarea.input-box').disabled, { timeout: 60000 });
    if (engine !== 'claude') {
      // The engine dropdown is a custom control; pick by visible label.
      await page.evaluate(() => [...document.querySelectorAll('.glass-panel')].find(x => x.textContent.includes('Claude Code'))?.click());
      await page.evaluate(() => [...document.querySelectorAll('div')].find(x => x.textContent.trim() === 'Antigravity (Google)')?.click());
    }
    await shot('01-thread-empty');
  });

  await step('send a task that needs a file write', async () => {
    const prompt =
      engine === 'claude'
        ? 'Create a file named ASTERIM_E2E.txt in the project root containing exactly one line: e2e ok. Do nothing else and do not run any other commands.'
        : 'Please refactor the index file';
    await setReactValue('textarea.input-box', prompt);
    if (!(await clickButton('Send'))) throw new Error('Send button not enabled');
  });

  await step('approval card appears', async () => {
    await waitForButton('Approve', 90000);
    await shot('02-approval-card');
    const card = await page.evaluate(() => document.querySelector('.dialog-box')?.innerText || '');
    if (!/Write|Bash|proceed/i.test(card)) throw new Error(`unexpected card text: ${card.slice(0, 120)}`);
  });

  await step('approve and the agent finishes', async () => {
    await clickButton('Approve');
    await page.waitForFunction(() => !document.querySelector('.dialog-box'), { timeout: 15000 });
    await page.waitForFunction(
      () => /Idle|Done/.test(document.querySelector('.thread-header')?.innerText || '') || document.body.innerText.includes('Done'),
      { timeout: 90000 }
    );
    await shot('03-transcript');
  });

  if (engine === 'claude') {
    await step('the approved file exists on disk', async () => {
      const deadline = Date.now() + 30000;
      while (!fs.existsSync(target) && Date.now() < deadline) await new Promise(r => setTimeout(r, 500));
      if (!fs.existsSync(target)) throw new Error(`${target} was not created`);
    });
  }

  await step('Changes view renders', async () => {
    await clickButton('Changes');
    await new Promise(r => setTimeout(r, 2500));
    await shot('04-changes');
  });
} catch {
  await shot('99-failure').catch(() => undefined);
} finally {
  fs.rmSync(target, { force: true });
  await browser.close();
  const failed = steps.filter(s => !s.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} steps passed; screenshots in ${outDir}`);
  process.exit(failed.length ? 1 : 0);
}
