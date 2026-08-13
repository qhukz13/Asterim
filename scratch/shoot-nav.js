const puppeteer = require('puppeteer'); const path = require('path');
(async () => {
  const out = process.argv[2];
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 420, deviceScaleFactor: 2 });
  await page.goto('file://' + path.resolve('scratch/nav-repro.html'), { waitUntil: 'load' });
  const q = () => page.evaluate(() => {
    const strip = document.querySelector('.view-navigation-tabs') || document.querySelector('.view-navigation > div');
    const last = document.querySelectorAll('.nav-btn')[5];
    const main = document.querySelector('.workspace-main-content');
    const mr = main.getBoundingClientRect().right;
    return {
      canScroll: strip.scrollWidth > strip.clientWidth,
      scrollLeft: Math.round(strip.scrollLeft),
      lastTabRight: Math.round(last.getBoundingClientRect().right),
      mainRight: Math.round(mr),
      lastTabReachable: last.getBoundingClientRect().right <= mr + 1
    };
  });
  console.log('at rest      :', JSON.stringify(await q()));
  await page.evaluate(() => {
    const s = document.querySelector('.view-navigation-tabs') || document.querySelector('.view-navigation > div');
    s.scrollLeft = s.scrollWidth; // scroll to the end, as a user would
  });
  await new Promise(r => setTimeout(r, 300));
  console.log('scrolled末end:', JSON.stringify(await q()));
  await page.screenshot({ path: out });
  await browser.close();
})();
