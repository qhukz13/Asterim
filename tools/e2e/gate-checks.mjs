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

// The PIN changes every time the Core starts, so the restart check replaces it.
let currentPin = pin;

const openPaired = async viewport => {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(`${url}/?pin=${currentPin}`, { waitUntil: 'networkidle2' });
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

  // A fresh thread, so the agent has no history of this request being denied.
  // A thread resumes its Claude Code session, and after a few refusals the
  // agent stops retrying the shape of the request rather than the exact one --
  // it asks what you are actually trying to do instead. Reasonable of it, and
  // fatal to a check that needs a card.
  const threadName = `Gate ${Date.now().toString(36)}`;
  await clickButton(desk, 'New Agent');
  await setReactValue(desk, 'input[placeholder="e.g. Frontend Refactor"]', threadName);
  await clickButton(desk, 'Create Agent');
  await new Promise(r => setTimeout(r, 2500));

  // The phone opens after the thread exists, and is put on it. An approval
  // belongs to a thread, and a window looking at a different thread does not
  // show its card -- correct, and worth knowing if you plan to approve from a
  // phone you left on another screen.
  const phone = await openPaired({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const onThread = await phone.evaluate(name => {
    // Thread rows are role="button" divs carrying the name as their title.
    const el = [...document.querySelectorAll('[role="button"]')].find(
      x => x.getAttribute('title') === name || x.textContent.trim() === name
    );
    if (!el) return false;
    el.click();
    return true;
  }, threadName);
  if (!onThread) throw new Error(`the phone could not find the thread "${threadName}"`);
  // Clicking is not selecting. Confirm the phone is actually on that thread
  // before anything is sent, or the card goes to a window nobody is watching
  // and the failure looks like a missing card.
  await phone
    .waitForFunction(
      name => (document.querySelector('.thread-header')?.innerText || '').includes(name),
      { timeout: 15000 },
      threadName
    )
    .catch(() => {
      throw new Error(`the phone clicked "${threadName}" but stayed on another thread`);
    });
  await new Promise(r => setTimeout(r, 2000));

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

// --- 2b. The usage summary is in Settings and shows real numbers ---------------

await step('the usage summary renders in Settings with numbers from this machine', async () => {
  const page = await openPaired({ width: 1512, height: 900 });
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^Settings$/i.test(x.textContent.trim()));
    if (!b) return false;
    b.click();
    return true;
  });
  if (!opened) throw new Error('the Settings view could not be opened');
  await page.waitForFunction(() => document.body.innerText.includes('Usage on this machine'), {
    timeout: 20000
  });
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('h3')].find(x => /Usage on this machine/i.test(x.textContent));
    el?.scrollIntoView({ block: 'center' });
  });
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(outDir, '05-usage.png') });

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('.usage-row')].map(r => r.innerText.split('\n').join(' | '))
  );
  if (rows.length < 6) throw new Error(`the summary showed only ${rows.length} rows`);
  const approvals = rows.find(r => r.startsWith('Approvals'));
  if (!approvals || !/approved \d+/.test(approvals)) {
    throw new Error(`the approvals row is missing its breakdown: ${approvals}`);
  }
  // Counts only. A name, path or prompt here is the one thing this panel
  // promises never to show.
  const text = await page.evaluate(() => document.querySelector('.usage-panel')?.innerText || '');
  const PATH_SHAPED = /[A-Za-z]:\\|\/home\/|\/Users\//;
  if (PATH_SHAPED.test(text)) {
    throw new Error('the usage panel shows a filesystem path');
  }
  await page.close();
});

// --- 3. A shell command gets the same gate, and denying it stops the command --

await step('a shell command is gated, and denying it stops the command running', async () => {
  const desk = await openPaired({ width: 1512, height: 900 });
  const threadName = `Shell ${Date.now().toString(36)}`;
  await clickButton(desk, 'New Agent');
  await setReactValue(desk, 'input[placeholder="e.g. Frontend Refactor"]', threadName);
  await clickButton(desk, 'Create Agent');
  await new Promise(r => setTimeout(r, 2500));

  await desk.waitForSelector('textarea.input-box', { timeout: 30000 });
  await desk.waitForFunction(() => !document.querySelector('textarea.input-box').disabled, { timeout: 60000 });

  // The command has to have an effect the agent cannot fake. Asked to "run
  // echo hello", Claude Code will often just reply "hello" without invoking
  // anything -- correct of it, and it produces no card because nothing was
  // attempted. A file written by the shell is unambiguous: either the command
  // ran or the file is not there.
  const shellFile = `ASTERIM_GATE_SHELL_${Date.now().toString(36)}.txt`;
  const shellTarget = path.join(projectPath, shellFile);
  fs.rmSync(shellTarget, { force: true });

  await setReactValue(
    desk,
    'textarea.input-box',
    `Use your Bash tool to run a single shell command that creates ${shellFile} in the project root containing the word ok. Use the shell, not your file-writing tool. Do nothing else.`
  );
  await clickButton(desk, 'Send');

  try {
    await desk.waitForFunction(() => document.querySelector('.approval-card'), { timeout: 150000 });
  } catch {
    await desk.screenshot({ path: path.join(outDir, '99-shell-no-card.png') });
    const said = await desk.evaluate(() => document.body.innerText.slice(-700));
    throw new Error(`no card for the shell command; the thread ended with: ${said.replace(/s+/g, ' ')}`);
  }
  await new Promise(r => setTimeout(r, 900));
  await desk.screenshot({ path: path.join(outDir, '04-shell-approval.png') });

  const card = await desk.evaluate(() => document.querySelector('.approval-card')?.innerText || '');
  if (!card.includes(shellFile)) {
    throw new Error(`the card does not show the command it would run: ${card.replace(/s+/g, ' ').slice(0, 240)}`);
  }

  await new Promise(r => setTimeout(r, 700));
  await clickButton(desk, 'Deny');
  await desk.waitForFunction(() => !document.querySelector('.approval-card'), { timeout: 15000 });
  await new Promise(r => setTimeout(r, 4000));
  if (fs.existsSync(shellTarget)) {
    fs.rmSync(shellTarget, { force: true });
    throw new Error('the command ran even though it was denied');
  }
  await desk.close();
});

// --- 3. The thread survives the Core restarting ------------------------------

// Opt-in, because only the caller knows how to stop and start this Core.
// ASTERIM_RESTART_CMD must return once the Core is answering again.
if (process.env.ASTERIM_RESTART_CMD) {
  await step('the transcript and the session survive the Core restarting', async () => {
    const before = await openPaired({ width: 1512, height: 900 });
    await before.waitForSelector('textarea.input-box', { timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    const seen = await before.evaluate(() => document.body.innerText);
    const marker = /ASTERIM_[A-Z0-9_]+\.txt/.exec(seen)?.[0];
    if (!marker) throw new Error('no earlier task found in the transcript to look for after the restart');
    await before.close();

    const { execSync } = await import('node:child_process');
    // A restart prints a new pairing PIN. If the command echoes one, use it —
    // otherwise the next page load would spend an attempt on a stale PIN and
    // walk into the lockout this same gate verifies works.
    const output = execSync(process.env.ASTERIM_RESTART_CMD, { encoding: 'utf8', shell: true });
    process.stdout.write(output);
    const fresh = /(\d{6})/.exec(output);
    if (fresh) currentPin = fresh[1];

    const after = await openPaired({ width: 1512, height: 900 });
    await after.waitForSelector('textarea.input-box', { timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));
    await after.screenshot({ path: path.join(outDir, '03-after-restart.png') });
    const text = await after.evaluate(() => document.body.innerText);
    if (!text.includes(marker)) {
      throw new Error(`the transcript did not come back; "${marker}" is missing after the restart`);
    }
    await after.close();
  });
}

fs.rmSync(phoneTarget, { force: true });
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${outDir}`);
process.exit(failed.length ? 1 : 0);
