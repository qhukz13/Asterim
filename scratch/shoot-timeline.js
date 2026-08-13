const puppeteer = require('puppeteer'); const path = require('path');
(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1250, deviceScaleFactor: 2 });
  await p.goto('file://' + path.resolve('scratch/memory-timeline.html'), { waitUntil: 'load' });
  await p.screenshot({ path: 'docs/screenshots/p5.2-03/memory-timeline-1440.png' });
  console.log('captured');
  await b.close();
})();
