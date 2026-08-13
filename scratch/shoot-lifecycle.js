const puppeteer = require('puppeteer'); const path = require('path');
(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  for (const [file, out, h] of [['lifecycle-explorer', 'decision-actions-1440', 1150], ['lifecycle-archive', 'archive-confirm-1440', 900]]) {
    const p = await b.newPage();
    await p.setViewport({ width: 1440, height: h, deviceScaleFactor: 2 });
    await p.goto('file://' + path.resolve(`scratch/${file}.html`), { waitUntil: 'load' });
    await p.screenshot({ path: `docs/screenshots/p5.3-02/${out}.png` });
    console.log('captured', out); await p.close();
  }
  await b.close();
})();
