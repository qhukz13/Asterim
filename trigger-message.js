import puppeteer from 'puppeteer';

(async () => {
  console.log('Starting puppeteer...');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[PIPELINE_DEBUG]')) {
      console.log(`[BROWSER] ${text}`);
    }
  });
  
  page.on('pageerror', err => {
    console.log(`[BROWSER ERROR] ${err.toString()}`);
  });

  console.log('Navigating to app...');
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle2' });
  
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('--- TRIGGERING SETUP ---');
  await page.evaluate(() => {
    const projectStore = window.__ZUSTAND_STORES?.ProjectStore?.getState?.();
    const threadStore = window.__ZUSTAND_STORES?.ThreadStore?.getState?.();
    const viewStore = window.__ZUSTAND_STORES?.ViewStore?.getState?.();
    
    if (projectStore && threadStore && viewStore) {
      console.log('Stores found. Setting up state...');
      projectStore.setActiveProject('proj1');
      threadStore.setActiveThread('thread1');
      viewStore.setActiveView('chat', 'thread1');
    }
  });
  
  await new Promise(r => setTimeout(r, 1000));
  
  console.log('--- TRIGGERING MESSAGE ---');
  await page.evaluate(() => {
    if (window.__sendChatMessage) {
      window.__sendChatMessage('test message from puppeteer');
      console.log('Message sent via window.__sendChatMessage');
    } else {
      console.log('window.__sendChatMessage not found');
    }
  });
  
  // Wait a bit for the pipeline to process and return logs
  await new Promise(r => setTimeout(r, 8000));
  await browser.close();
  console.log('Done.');
})();
