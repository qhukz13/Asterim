import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/layout.css';
import './index.css';
import { setupGlobalErrorTracking, setupDOMObserver, setupRouterProxy, DebugErrorBoundary, Debug } from './utils/debug';

// Initialize global debug tools
setupGlobalErrorTracking();
setupDOMObserver();
setupRouterProxy();

Debug.log('INIT', 'Application starting...');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DebugErrorBoundary>
      <App />
    </DebugErrorBoundary>
  </React.StrictMode>
);
