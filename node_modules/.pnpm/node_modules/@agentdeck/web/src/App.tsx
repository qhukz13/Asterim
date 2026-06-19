import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from './hooks/useSocket';
import { ProjectSelector } from './ProjectSelector';
import { XTerminal } from './XTerminal';
import { useAuth } from './hooks/useAuth';
import { PinScreen } from './PinScreen';

interface Project {
  id: string;
  name: string;
  path: string;
  /** Relay server URL — only present when connecting via tunnel (relay mode). */
  relayUrl?: string;
}

function Dashboard({ project, onBack }: { project: Project, onBack: () => void }) {
  const { connected, events, agentStatus, approvalRequest, fileChanges, sendCommand, sendApproval, sendStdin } = useSocket(project.id, project.relayUrl);
  const [input, setInput] = useState('');
  const [agentType, setAgentType] = useState<'aider' | 'claude'>(
    (localStorage.getItem('agentdeck_default_agent') as 'aider' | 'claude') || 'claude'
  );
  const [activeTab, setActiveTab] = useState<'terminal' | 'files'>('terminal');
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const handleSend = () => {
    if (input.trim()) {
      sendCommand(input.trim(), agentType);
      setInput('');
    }
  };

  useEffect(() => {
    // Auto-scroll terminal
    if (activeTab === 'terminal') {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events, activeTab]);

  return (
    <div className="app-container">
      {/* Sidebar - Hidden on mobile */}
      <aside className="sidebar glass-panel">
        <h1>AgentDeck</h1>
        
        <div style={{ marginBottom: '32px' }}>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '12px', letterSpacing: '1px' }}>Connection</div>
          <div className={`status-badge ${connected ? 'connected' : 'disconnected'}`}>
            <div className="status-dot"></div>
            {connected ? 'Connected' : 'Disconnected'}
          </div>
        </div>

        <div style={{ marginBottom: '32px' }}>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '12px', letterSpacing: '1px' }}>Active Project</div>
          <div style={{ padding: '12px 16px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', fontSize: '0.9rem', border: '1px solid var(--panel-border)' }}>
            <div style={{ fontWeight: 600 }}>{project.name}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px', wordBreak: 'break-all' }}>{project.path}</div>
          </div>
          <button 
            onClick={onBack}
            style={{ marginTop: '12px', background: 'transparent', color: 'var(--accent-hover)', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}
          >
            ← Switch Project
          </button>
        </div>
          <div style={{ marginBottom: '32px' }}>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '12px', letterSpacing: '1px' }}>Agent Engine</div>
            <select 
              value={agentType} 
              onChange={(e) => setAgentType(e.target.value as any)}
              style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--panel-border)', color: '#fff' }}
              disabled={agentStatus.status !== 'idle'}
            >
              <option value="claude">Claude Code (Anthropic)</option>
              <option value="aider">Aider (Python)</option>
            </select>
          </div>
        </aside>

      {/* Main Content Area */}
      <main className="main-content glass-panel">
        {/* Top Bar */}
        <div className="top-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button 
              className="mobile-back-btn"
              onClick={onBack}
              style={{ background: 'transparent', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer', fontSize: '1.2rem', display: 'none' }}
            >
              ←
            </button>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{activeTab === 'terminal' ? 'Live Telemetry' : 'Workspace Changes'}</h2>
          </div>
          
          <div className={`status-badge ${agentStatus.status === 'waiting_approval' ? 'waiting' : agentStatus.status === 'working' ? 'working' : 'idle'}`}>
            <div className="status-dot"></div>
            {agentStatus.status === 'waiting_approval' ? 'Needs Approval' : agentStatus.status}
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'terminal' ? (
          <>
            <div className="terminal-view" style={{ flex: 1, minHeight: 0 }}>
              {events.length === 0 ? (
                <div style={{ opacity: 0.5, textAlign: 'center', marginTop: '40px' }}>Waiting for agent events...</div>
              ) : (
                <XTerminal events={events} onData={sendStdin} />
              )}
            </div>

            <div className="input-container">
              <input 
                type="text" 
                className="input-box" 
                placeholder="Send a command... (e.g. 'start', 'stop')" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                disabled={agentStatus.status === 'waiting_approval'}
              />
              <button className="btn-primary" onClick={handleSend} disabled={agentStatus.status === 'waiting_approval'}>Send</button>
            </div>
          </>
        ) : (
          <div className="file-list" style={{ padding: '0 20px 20px 20px' }}>
            {fileChanges.length === 0 ? (
              <div style={{ opacity: 0.5, textAlign: 'center', marginTop: '40px', color: 'var(--text-secondary)' }}>No file changes detected yet.</div>
            ) : (
              fileChanges.map((fc, idx) => (
                <div key={idx} className="file-item">
                  <div className="file-item-header">
                    <span>{fc.filePath}</span>
                    <span style={{ 
                      color: fc.changeType === 'added' ? 'var(--success-color)' : 
                             fc.changeType === 'deleted' ? 'var(--error-color)' : 'var(--warning-color)',
                      textTransform: 'uppercase',
                      fontSize: '0.75rem',
                      fontWeight: 'bold'
                    }}>{fc.changeType}</span>
                  </div>
                  {fc.diff && (
                    <div className="diff-content">{fc.diff}</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="bottom-nav">
        <div className={`nav-item ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => setActiveTab('terminal')}>
          Terminal
        </div>
        <div className={`nav-item ${activeTab === 'files' ? 'active' : ''}`} onClick={() => setActiveTab('files')}>
          Files {fileChanges.length > 0 && `(${fileChanges.length})`}
        </div>
      </nav>

      {/* Approval Overlay */}
      {approvalRequest && (
        <div className="dialog-overlay">
          <div className="dialog-box glass-panel">
            <h3>⚠️ Action Required</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              The agent needs your permission to proceed.
            </p>
            
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Description</div>
              <div style={{ fontWeight: 500 }}>{approvalRequest.description}</div>
              
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '12px', marginBottom: '4px' }}>Command</div>
              <div style={{ fontFamily: 'monospace', color: 'var(--accent-hover)' }}>{approvalRequest.command}</div>
            </div>

            <div className="dialog-actions">
              <button className="btn-deny" onClick={() => sendApproval(approvalRequest.actionId, false)}>Deny</button>
              <button className="btn-approve" onClick={() => sendApproval(approvalRequest.actionId, true)}>Approve</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const { isAuthenticated } = useAuth();

  // If not authenticated and we are running from a local domain, we must pair first
  // For cloud relay hosted versions in the future, we will skip this if it fails,
  // but for now, we assume local or LAN.
  if (!isAuthenticated) {
    return <PinScreen />;
  }

  if (!selectedProject) {
    return <ProjectSelector onSelect={setSelectedProject} />;
  }

  return <Dashboard project={selectedProject} onBack={() => setSelectedProject(null)} />;
}
