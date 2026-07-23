import puppeteer from 'puppeteer';

(async () => {
  console.log('Starting puppeteer...');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Vite]') || text.includes('Download the React')) return;
    console.log(`[BROWSER] ${text}`);
  });
  
  page.on('pageerror', err => {
    console.log(`[BROWSER ERROR] ${err.toString()}`);
  });

  console.log('Navigating to app...');
  await page.goto('http://localhost:5175', { waitUntil: 'networkidle2' });
  
  // Wait for React to render
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('Trying to trigger loop...');
  // The loop happens when activeThreadId changes and InteractionEngine fights RouterSync.
  // We can trigger this by switching to a project and thread.
  // Or we can just evaluate code in the page context.
  await page.evaluate(() => {
    console.log('Clicking to trigger loop...');
    // We need to simulate switching threads.
    // Assuming the app has state attached to window, or we can just click the DOM.
    // If not, we can inject a script to call the Zustand store directly!
    // But since the user wants the exact runtime sequence, I'll add logs to the actual files first.
  });
  
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
})();
