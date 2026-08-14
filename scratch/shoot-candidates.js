const puppeteer = require('puppeteer'); const path = require('path');
(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await p.goto('file://' + path.resolve('scratch/candidates.html'), { waitUntil: 'networkidle0' });
  await p.waitForSelector('article');
  await new Promise(r => setTimeout(r, 400));
  await p.screenshot({ path: 'docs/screenshots/p5.4-03/candidate-review-1440.png' });
  console.log('captured'); await b.close();
})();
