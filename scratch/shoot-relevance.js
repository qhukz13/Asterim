const puppeteer = require('puppeteer'); const path = require('path');
(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 1600, deviceScaleFactor: 2 });
  await p.goto('file://' + path.resolve('scratch/relevance-explorer.html'), { waitUntil: 'networkidle0' });
  await p.waitForSelector('article');
  await new Promise(r => setTimeout(r, 400));
  await p.screenshot({ path: 'docs/screenshots/p5.4-04/drift-filter-1400.png', fullPage: true });
  console.log('captured'); await b.close();
})();
