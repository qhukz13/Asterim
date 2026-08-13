const puppeteer = require('puppeteer'); const path = require('path');
(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  for (const [file, out, h] of [['curation-explorer', 'curation-panels-1440', 1000], ['curation-rule', 'add-rule-dialog-1440', 1000]]) {
    const p = await b.newPage();
    await p.setViewport({ width: 1440, height: h, deviceScaleFactor: 2 });
    await p.goto('file://' + path.resolve(`scratch/${file}.html`), { waitUntil: 'load' });
    await p.screenshot({ path: `docs/screenshots/p5.3-03/${out}.png` });
    console.log('captured', out); await p.close();
  }
  await b.close();
})();
