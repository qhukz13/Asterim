/**
 * Release-gate checks the core loop does not cover.
 *
 * `core-loop.mjs` answers "does the product work". This answers the smaller
 * questions `docs/release-gate.md` asks that a happy-path run never touches:
 * does a bad project path fail where the person is looking, and is the approval
 * card usable on a phone and answerable without a mouse.
 *
 * It expects a Core that already has the project attached — run `core-loop.mjs`
 * first, or point it at a workspace you have used.
 *
 * Usage (Core already running):
 *   ASTERIM_URL=http://localhost:3000 ASTERIM_PIN=123456 \
 *   ASTERIM_PROJECT_PATH=C:\path\to\repo node tools/e2e/gate-checks.mjs
 *
 * Screenshots land in docs/screenshots/gate/. Exit code is non-zero on any
 * failed check.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.ASTERIM_URL || 'http://localhost:3000';
const pin = process.env.ASTERIM_PIN;
const projectPath = process.env.ASTERIM_PROJECT_PATH;
const outDir = path.resolve('docs/screenshots/gate');
if (!pin || !projectPath) {
  console.error('ASTERIM_PIN and ASTERIM_PROJECT_PATH are required');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

// A fresh name every run. Asking for the same write repeatedly on a thread that
// resumes its Claude Code session teaches the agent that this request keeps
// being denied, and it eventually declines to retry without confirmation --
// correct of it, and fatal to a test that expects a card.
const PHONE_FILE = `ASTERIM_GATE_PHONE_${Date.now().toString(36)}.txt`;
const phoneTarget = path.join(projectPath, PHONE_FILE);
fs.rmSync(phoneTarget, { force: true });

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: String(err.message || err) });
    console.log(`  FAIL  ${name} — ${err.message || err}`);
  }
};

const browser = await puppeteer.launch({ headless: true });

const setReactValue = async (page, selector, value) => {
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

const clickButton = async (page, text, { timeout = 15000, optional = false } = {}) => {
  try {
    await page.waitForFunction(
      t => [...document.querySelectorAll('button')].some(x => x.textContent.trim() === t && !x.disabled),
      { timeout },
      text
    );
  } catch {
    if (optional) return false;
    throw new Error(`button "${text}" never became clickable`);
  }
  return page.evaluate(t => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === t && !x.disabled);
    if (!b) return false;
    b.click();
    return true;
  }, text);
};

const openPaired = async viewport => {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(`${url}/?pin=${pin}`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => !document.querySelector('input[placeholder="Enter PIN"]'), { timeout: 20000 });
  for (const label of ['Choose an agent', 'Continue', 'Open the workspace']) {
    if (await clickButton(page, label, { optional: true, timeout: 2000 })) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  await new Promise(r => setTimeout(r, 2000));
  return page;
};

// --- 1. A project path that does not exist fails where the person is looking --

await step('a project path that does not exist is reported, and the dialog stays open', async () => {
  const page = await openPaired({ width: 1512, height: 900 });

  // The empty-state button exists only while there are no projects; after that
  // the affordance is the "+" in the sidebar header.
  if (!(await clickButton(page, 'Add Project / Existing Repository', { optional: true, timeout: 3000 }))) {
    const opened = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(
        x => x.getAttribute('title') === 'Add New Project'
      );
      if (!b) return false;
      b.click();
      return true;
    });
    if (!opened) throw new Error('no way to add a project was found');
    await new Promise(r => setTimeout(r, 800));
  }
  await clickButton(page, '+ Add New Folder', { optional: true, timeout: 3000 });
  await setReactValue(page, 'input[placeholder="e.g. Asterim Service"]', 'Nowhere');
  await setReactValue(
    page,
    'input[placeholder="e.g. /home/user/code/my-project"]',
    path.join(projectPath, 'this-folder-does-not-exist-1234')
  );
  await clickButton(page, 'Add & Attach Project');

  await new Promise(r => setTimeout(r, 3000));
  const state = await page.evaluate(() => ({
    dialogOpen: Boolean(document.querySelector('.dialog-box')),
    text: document.querySelector('.dialog-box')?.innerText || ''
  }));
  await page.screenshot({ path: path.join(outDir, '01-bad-path.png') });
  if (!state.dialogOpen) {
    throw new Error('the dialog closed, so a folder that does not exist was accepted');
  }
  if (!/exist|not found|invalid|no such|could not|directory/i.test(state.text)) {
    throw new Error(`no error shown; the dialog said: ${state.text.slice(0, 200)}`);
  }
  await page.close();
});

// --- 2. The approval card on a phone, answered without a mouse ---------------

await step('the approval card fits a 390px phone, takes focus, and Escape denies', async () => {
  // Two windows: the desktop one asks for the write, the phone one answers it.
  // That is the situation the site describes — you are at your machine, the
  // phone is what you have in your hand — and it is also the only way to reach
  // the composer, which the workspace layout does not give a phone.
  const desk = await openPaired({ width: 1512, height: 900 });
  const phone = await openPaired({ width: 390, height: 844, isMobile: true, hasTouch: true });

  await desk.waitForSelector('textarea.input-box', { timeout: 30000 });
  await desk.waitForFunction(() => !document.querySelector('textarea.input-box').disabled, { timeout: 60000 });
  await setReactValue(
    desk,
    'textarea.input-box',
    `Create a file named ${PHONE_FILE} in the project root containing exactly one line: phone. Do nothing else and do not run any other commands.`
  );
  await clickButton(desk, 'Send');

  try {
    await phone.waitForFunction(() => document.querySelector('.approval-card'), { timeout: 120000 });
  } catch (err) {
    await desk.screenshot({ path: path.join(outDir, '99-desk-when-phone-saw-nothing.png') });
    await phone.screenshot({ path: path.join(outDir, '99-phone-saw-nothing.png') });
    const deskHasCard = await desk.evaluate(() => Boolean(document.querySelector('.approval-card')));
    throw new Error(
      `no approval card reached the phone in 120s (the desktop window ${
        deskHasCard ? 'did' : 'did not'
      } have one)`
    );
  }
  await new Promise(r => setTimeout(r, 1000));
  await phone.screenshot({ path: path.join(outDir, '02-approval-390.png') });

  const card = await phone.evaluate(() => {
    const el = document.querySelector('.approval-card');
    const r = el.getBoundingClientRect();
    const buttons = [...el.querySelectorAll('button')]
      .filter(b => ['Approve', 'Deny'].includes(b.textContent.trim()))
      .map(b => {
        const q = b.getBoundingClientRect();
        return {
          label: b.textContent.trim(),
          height: q.height,
          left: q.left,
          right: q.right,
          bottom: q.bottom
        };
      });
    return {
      left: r.left,
      right: r.right,
      viewport: window.innerWidth,
      viewportHeight: window.innerHeight,
      buttons,
      focusInCard: Boolean(document.activeElement?.closest('.approval-card')),
      overflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });

  if (card.left < 4) throw new Error(`the card touches the left edge (${Math.round(card.left)}px)`);
  if (card.right > card.viewport - 4) throw new Error('the card touches the right edge');
  if (card.overflowsX) throw new Error('the page scrolls horizontally at 390px');
  if (!card.focusInCard) throw new Error('the card did not take focus; a keyboard user has nothing selected');
  if (card.buttons.length !== 2) throw new Error(`expected Approve and Deny, found ${card.buttons.length}`);
  for (const b of card.buttons) {
    if (b.height < 44) throw new Error(`${b.label} is ${Math.round(b.height)}px tall; too small for a finger`);
    if (b.left < 0 || b.right > card.viewport) throw new Error(`${b.label} is off screen`);
    if (b.bottom > card.viewportHeight) throw new Error(`${b.label} is below the fold`);
  }

  // Escape is the only key that decides, and it decides against the agent. A
  // stray Return must never approve anything.
  await phone.keyboard.press('Escape');
  await phone.waitForFunction(() => !document.querySelector('.approval-card'), { timeout: 10000 });
  await new Promise(r => setTimeout(r, 3000));
  if (fs.existsSync(phoneTarget)) throw new Error('Escape closed the card but the write happened anyway');

  await phone.close();
  await desk.close();
});

fs.rmSync(phoneTarget, { force: true });
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${outDir}`);
process.exit(failed.length ? 1 : 0);
