import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from './hooks/useSocket';
import { ProjectSelector } from './ProjectSelector';
import { XTerminal } from './XTerminal';
import { ChatView } from './ChatView';
import { useAuth } from './hooks/useAuth';
import { PinScreen } from './PinScreen';

interface Project {
  id: string;
  name: string;
  path: string;
  /** Relay server URL — only present when connecting via tunnel (relay mode). */
  relayUrl?: string;
}

interface ApprovalOverlayProps {
  approvalRequest: {
    actionId: string;
    description: string;
    command: string;
    timestamp?: number;
  };
  onApprove: (actionId: string) => void;
  onDeny: (actionId: string) => void;
  onSwitchToTerminal?: (actionId: string) => void;
}

function ApprovalOverlay({ approvalRequest, onApprove, onDeny, onSwitchToTerminal }: ApprovalOverlayProps) {
  const [timeLeft, setTimeLeft] = useState<number>(300);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const startTime = approvalRequest.timestamp || Date.now();
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = Math.max(0, 300 - elapsed);
      setTimeLeft(remaining);
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(interval);
  }, [approvalRequest]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const isUrgent = timeLeft < 60;

  const timerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div className="dialog-overlay">
      <div className="dialog-box glass-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, color: isUrgent ? 'var(--error-color)' : 'var(--warning-color)' }}>⚠️ Action Required</h3>
          <div 
            className={isUrgent ? 'pulse-timer urgent' : 'pulse-timer'}
            style={{
              padding: '6px 12px',
              borderRadius: '20px',
              fontSize: '0.85rem',
              fontWeight: 'bold',
              background: isUrgent ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.1)',
              color: isUrgent ? 'var(--error-color)' : 'var(--text-secondary)',
              border: isUrgent ? '1px solid var(--error-color)' : '1px solid transparent',
              transition: 'all 0.3s ease'
            }}
          >
            ⏱️ {timerText}
          </div>
        </div>
        
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 0 }}>
          The agent needs your permission to proceed.
        </p>
        
        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', border: '1px solid var(--panel-border)', marginBottom: '16px' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Description</div>
          <div style={{ fontWeight: 500 }}>{approvalRequest.description}</div>
          
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '12px', marginBottom: '4px' }}>Command</div>
          <div style={{ fontFamily: 'monospace', color: 'var(--accent-hover)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{approvalRequest.command}</div>
        </div>

        <div className="dialog-actions">
          {approvalRequest.command === 'TERMINAL_ACTION_REQUIRED' && onSwitchToTerminal ? (
            <button className="btn-approve" style={{ width: '100%', padding: '14px' }} onClick={() => onSwitchToTerminal(approvalRequest.actionId)}>
              Switch to Terminal Tab
            </button>
          ) : (
            <>
              <button className="btn-deny" onClick={() => onDeny(approvalRequest.actionId)}>Deny</button>
              <button className="btn-approve" onClick={() => onApprove(approvalRequest.actionId)}>Approve</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Dashboard({ project, onBack }: { project: Project, onBack: () => void }) {
  const { connected, events, messages, agentStatus, approvalRequest, fileChanges, sendCommand, sendApproval, sendStdin, sendChatMessage, clearMessages, systemStatus } = useSocket(project.id, project.relayUrl);
  const [input, setInput] = useState('');
  const [agentType, setAgentType] = useState<'aider' | 'claude' | 'antigravity'>(
    (localStorage.getItem('agentdeck_default_agent') as 'aider' | 'claude' | 'antigravity') || 'claude'
  );
  const isBinaryMissing = systemStatus && systemStatus.binaries && !systemStatus.binaries[agentType];
  const [activeTab, setActiveTab] = useState<'chat' | 'terminal' | 'files' | 'settings'>('chat');
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const handleSend = () => {
    if (input.trim()) {
      const text = input.trim();
      if (text.toLowerCase() === 'start' || text.toLowerCase() === 'stop') {
        sendCommand(text, agentType);
      } else if (agentStatus.status === 'idle' || agentStatus.status === 'error') {
        // Auto-start agent with the message
        sendCommand('start', agentType);
        setTimeout(() => sendChatMessage(text), 1500);
      } else {
        sendChatMessage(text);
      }
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
              disabled={agentStatus.status !== 'idle' && agentStatus.status !== 'error'}
            >
              <option value="claude">Claude Code (Anthropic)</option>
              <option value="aider">Aider (Python)</option>
              <option value="antigravity">Antigravity (Google)</option>
            </select>
            {isBinaryMissing && (
              <div style={{ marginTop: '8px', padding: '8px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--error-color)', fontSize: '0.75rem', color: 'var(--error-color)', lineHeight: '1.4' }}>
                ⚠️ Warning: <strong>{agentType}</strong> binary not found on server PATH. Starting this agent will fail.
              </div>
            )}
            <button 
              className="btn-secondary"
              onClick={() => {
                sendCommand('stop', agentType);
                setTimeout(() => sendCommand('start', agentType), 500);
              }}
              style={{
                width: '100%',
                marginTop: '12px',
                padding: '10px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--panel-border)',
                color: 'var(--text-secondary)',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
              onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
            >
              🔄 Restart Agent
            </button>
          </div>

          {/* PC Navigation Links */}
          <div className="pc-nav" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '4px', letterSpacing: '1px' }}>Views</div>
            <button className={`nav-btn ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>
              <span style={{ fontSize: '1.2rem' }}>💬</span>
              <span>Chat</span>
            </button>
            <button className={`nav-btn ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => setActiveTab('terminal')}>
              <span style={{ fontSize: '1.2rem' }}>⌨️</span>
              <span>Terminal</span>
            </button>
            <button className={`nav-btn ${activeTab === 'files' ? 'active' : ''}`} onClick={() => setActiveTab('files')}>
              <span style={{ fontSize: '1.2rem' }}>📁</span>
              <span>Files {fileChanges.length > 0 && `(${fileChanges.length})`}</span>
            </button>
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
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>
              {activeTab === 'chat' ? 'Agent Chat' : activeTab === 'terminal' ? 'Live Telemetry' : 'Workspace Changes'}
            </h2>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {activeTab === 'chat' && messages.length > 0 && (
              <button className="clear-chat-btn" onClick={clearMessages} title="Clear Chat History">
                🧹 Clear Chat
              </button>
            )}
            <div className={`status-badge ${agentStatus.status === 'waiting_approval' ? 'waiting' : agentStatus.status === 'working' ? 'working' : 'idle'}`}>
              <div className="status-dot"></div>
              {agentStatus.status === 'waiting_approval' ? 'Needs Approval' : agentStatus.status}
            </div>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'chat' ? (
          <>
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <ChatView messages={messages} isWorking={agentStatus.status === 'working'} onClearChat={clearMessages} />
            </div>
            <div className="input-container">
              <input 
                type="text" 
                className="input-box" 
                placeholder="Ask the agent to do something... (or type 'start')" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                disabled={agentStatus.status === 'waiting_approval'}
              />
              <button className="btn-primary" onClick={handleSend} disabled={agentStatus.status === 'waiting_approval'}>Send</button>
            </div>
          </>
        ) : activeTab === 'terminal' ? (
          <>
            <div className="terminal-view" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              {events.length === 0 ? (
                <div style={{ opacity: 0.8, textAlign: 'center', marginTop: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '20px' }}>
                  {agentStatus.message ? (
                    <div style={{
                      color: '#f87171',
                      padding: '16px 24px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      borderRadius: '12px',
                      maxWidth: '500px',
                      fontSize: '0.9rem',
                      lineHeight: '1.5',
                      textAlign: 'left',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                    }}>
                      <strong style={{ display: 'block', marginBottom: '6px', fontSize: '0.95rem', color: '#ef4444' }}>⚠️ Agent Status Alert:</strong>
                      {agentStatus.message}
                    </div>
                  ) : (
                    <span style={{ opacity: 0.5 }}>Waiting for agent events...</span>
                  )}
                </div>
              ) : (
                <>
                  <XTerminal events={events} onData={sendStdin} />
                  {/* Mobile D-Pad */}
                  <div className="mobile-dpad">
                    <button onClick={() => sendStdin('\x1b[A')} aria-label="Up">↑</button>
                    <button onClick={() => sendStdin('\x1b[B')} aria-label="Down">↓</button>
                    <button onClick={() => sendStdin('\r')} aria-label="Enter">↵</button>
                    <button onClick={() => sendStdin('\x03')} aria-label="Ctrl+C" style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>^C</button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : activeTab === 'files' ? (
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
        ) : activeTab === 'settings' ? (
          <div className="settings-view" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="settings-card glass-panel" style={{ padding: '20px' }}>
              <h3 style={{ marginBottom: '16px' }}>Agent Engine</h3>
              <select 
                value={agentType} 
                onChange={(e) => setAgentType(e.target.value as any)}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--panel-border)', color: '#fff', fontSize: '1rem' }}
                disabled={agentStatus.status !== 'idle' && agentStatus.status !== 'error'}
              >
                <option value="claude">Claude Code (Anthropic)</option>
                <option value="aider">Aider (Python)</option>
                <option value="antigravity">Antigravity (Google)</option>
              </select>
              {isBinaryMissing && (
                <div style={{ marginTop: '12px', padding: '12px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--error-color)', fontSize: '0.85rem', color: 'var(--error-color)' }}>
                  ⚠️ Warning: <strong>{agentType}</strong> binary not found on server PATH. Starting this agent will fail.
                </div>
              )}
            </div>
            
            <div className="settings-card glass-panel" style={{ padding: '20px' }}>
              <h3 style={{ marginBottom: '16px' }}>Connection Status</h3>
              <div className={`status-badge ${connected ? 'connected' : 'disconnected'}`} style={{ fontSize: '1rem', padding: '8px 16px' }}>
                <div className="status-dot"></div>
                {connected ? 'Connected' : 'Disconnected'}
              </div>
            </div>
          </div>
        ) : null}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="bottom-nav">
        <div className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>
          Chat
        </div>
        <div className={`nav-item ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => setActiveTab('terminal')}>
          Terminal
        </div>
        <div className={`nav-item ${activeTab === 'files' ? 'active' : ''}`} onClick={() => setActiveTab('files')}>
          Files {fileChanges.length > 0 && `(${fileChanges.length})`}
        </div>
        <div className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
          Settings
        </div>
      </nav>

      {/* Approval Overlay */}
      {approvalRequest && (
        <ApprovalOverlay 
          approvalRequest={approvalRequest} 
          onApprove={(id) => sendApproval(id, true)}
          onDeny={(id) => sendApproval(id, false)}
          onSwitchToTerminal={(id) => {
            setActiveTab('terminal');
            sendApproval(id, true);
          }}
        />
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
