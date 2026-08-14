const puppeteer = require('puppeteer'); const path = require('path');
(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
  await p.goto('file://' + path.resolve('scratch/drift-explorer.html'), { waitUntil: 'networkidle0' });
  await p.waitForSelector('article');
  await new Promise(r => setTimeout(r, 500));
  const box = await p.evaluate(() => {
    const r = document.getElementById('root').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), scrollH: document.documentElement.scrollHeight };
  });
  console.log('root box:', JSON.stringify(box));
  await p.screenshot({ path: 'docs/screenshots/p5.4-02/drift-badges-1440.png', captureBeyondViewport: false });
  console.log('captured'); await b.close();
})();
