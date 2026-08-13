const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  for (const w of [1440, 768]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 1200, deviceScaleFactor: 2 });
    await page.goto('file://' + path.resolve('scratch/decision-explorer.html'), { waitUntil: 'load' });
    // Screenshot the viewport, not fullPage: the panel scrolls internally.
    await page.screenshot({ path: `docs/screenshots/p5.2-02/decision-explorer-${w}.png` });
    console.log('captured', w);
    await page.close();
  }
  await browser.close();
})();
