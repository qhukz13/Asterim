import puppeteer from 'puppeteer';

(async () => {
  console.log('Starting puppeteer...');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Vite]') || text.includes('Download the React') || text.includes('Failed to load resource')) return;
    console.log(`${text}`);
  });
  
  page.on('pageerror', err => {
    console.log(`[BROWSER ERROR] ${err.toString()}`);
  });

  console.log('Navigating to app...');
  await page.goto('http://localhost:5175', { waitUntil: 'networkidle2' });
  
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('--- TRIGGERING SETUP ---');
  await page.evaluate(() => {
    // We need to bypass the auth to mount the app, or we can just mock it.
    // Let's just create a mock project and thread.
    const projectStore = window.__ZUSTAND_STORES?.ProjectStore?.getState?.();
    const threadStore = window.__ZUSTAND_STORES?.ThreadStore?.getState?.();
    const viewStore = window.__ZUSTAND_STORES?.ViewStore?.getState?.();
    
    if (projectStore && threadStore && viewStore) {
      console.log('Stores found. Setting up state...');
      projectStore.setActiveProject('proj1');
      threadStore.setActiveThread('thread1');
      viewStore.setActiveView('terminal', 'thread1');
    } else {
      console.log('Stores not found on window. Will try to dispatch custom events or click.');
    }
  });
  
  await new Promise(r => setTimeout(r, 1000));
  
  console.log('--- TRIGGERING LOOP ---');
  await page.evaluate(() => {
    const threadStore = window.__ZUSTAND_STORES?.ThreadStore?.getState?.();
    const viewStore = window.__ZUSTAND_STORES?.ViewStore?.getState?.();
    
    if (threadStore && viewStore) {
      console.log('Setting last view for thread2 to chat');
      viewStore.setActiveView('chat', 'thread2');
      console.log('Switching to thread2...');
      threadStore.setActiveThread('thread2');
    }
  });
  
  // Wait a bit to collect logs
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
})();
