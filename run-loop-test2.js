import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Vite]') || text.includes('Download the React') || text.includes('Failed to load resource')) return;
    if (text.includes('ServiceWorker')) return;
    console.log(`[BROWSER] ${text}`);
  });
  
  page.on('pageerror', err => {
    console.log(`[BROWSER ERROR] ${err.toString()}`);
  });

  await page.goto('http://localhost:5175', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));
  
  await page.evaluate(() => {
    const projectStore = window.__ZUSTAND_STORES?.ProjectStore?.getState?.();
    const threadStore = window.__ZUSTAND_STORES?.ThreadStore?.getState?.();
    const viewStore = window.__ZUSTAND_STORES?.ViewStore?.getState?.();
    
    if (projectStore && threadStore && viewStore) {
      console.log('--- Setting up Thread 2 ---');
      projectStore.setActiveProject('proj1');
      threadStore.setActiveThread('thread2');
      viewStore.setActiveView('chat', 'thread2');
      
      console.log('--- Setting up Thread 1 ---');
      threadStore.setActiveThread('thread1');
      viewStore.setActiveView('terminal', 'thread1');
    }
  });
  
  await new Promise(r => setTimeout(r, 1000));
  
  await page.evaluate(() => {
    console.log('--- Switching to Thread 2 to trigger loop ---');
    const threadStore = window.__ZUSTAND_STORES?.ThreadStore?.getState?.();
    threadStore.setActiveThread('thread2');
  });
  
  await new Promise(r => setTimeout(r, 3000));
  await browser.close();
})();
