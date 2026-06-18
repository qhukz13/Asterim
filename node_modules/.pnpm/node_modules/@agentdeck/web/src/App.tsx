import React, { useState } from 'react';
import { useSocket } from './hooks/useSocket';

function App() {
  const { connected, events, sendCommand } = useSocket();
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const handleSend = () => {
    if (input.trim()) {
      sendCommand(input);
      setInput('');
    }
  };

  return (
    <div className="app-container">
      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <h1>AgentDeck</h1>
        
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600 }}>Connection</div>
          <div className="status-badge" style={{ color: connected ? 'var(--success-color)' : 'var(--error-color)', background: connected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)' }}>
            <div className="status-dot"></div>
            {connected ? 'Connected' : 'Disconnected'}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600 }}>Active Projects</div>
          <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '0.875rem' }}>
            AgentDeck
          </div>
        </div>
      </aside>

      <main className="main-content">
        <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button 
              className="mobile-menu-btn" 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              style={{ background: 'none', border: 'none', color: 'var(--text-primary)', fontSize: '1.25rem', cursor: 'pointer', display: 'none' }}
            >
              ☰
            </button>
            <h2 style={{ fontSize: '1rem', fontWeight: 500 }}>Live Telemetry</h2>
          </div>
          <div className="status-badge" style={{ color: 'var(--accent-color)', background: 'rgba(59, 130, 246, 0.1)' }}>
            <div className="status-dot"></div>
            Agent Idle
          </div>
        </div>

        <div className="terminal-view">
          {events.length === 0 ? (
            <div style={{ opacity: 0.5 }}>Waiting for agent events...</div>
          ) : (
            events.map((evt, idx) => (
              <div key={idx} className="terminal-line">
                <span className="timestamp">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                <span>[{evt.type}] {JSON.stringify(evt.payload)}</span>
              </div>
            ))
          )}
        </div>

        <div className="input-container">
          <input 
            type="text" 
            className="input-box" 
            placeholder="Send a command to the agent..." 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
          <button className="btn-primary" onClick={handleSend}>Send</button>
        </div>
      </main>
    </div>
  );
}

export default App;
