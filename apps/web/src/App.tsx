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
  /** Relay server URL — only present when connecting via tunnel (relay mode). */
  relayUrl?: string;
}

function CustomDropdown({ value, onChange, options, style = {}, disabled = false, dropup = false }: { value: string, onChange: (val: string) => void, options: {value: string, label: string}[], style?: React.CSSProperties, disabled?: boolean, dropup?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = options.find(o => o.value === value) || options[0];

  return (
    <div ref={ref} style={{ position: 'relative', display: 'block', zIndex: isOpen ? 1000 : 1, ...style }}>
      <div 
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className="glass-panel"
        style={{ 
          width: '100%',
          padding: '6px 12px', 
          background: disabled ? 'rgba(0,0,0,0.1)' : 'transparent', 
          border: '1px solid transparent', 
          borderRadius: '8px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: disabled ? 'rgba(255,255,255,0.4)' : 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          fontSize: '0.8rem',
          opacity: disabled ? 0.6 : 1,
          transition: 'all 0.2s ease',
        }}
        onMouseOver={(e) => {
          if (!disabled) {
            e.currentTarget.style.color = '#fff';
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }
        }}
        onMouseOut={(e) => {
          if (!disabled) {
            e.currentTarget.style.color = 'var(--text-secondary)';
            e.currentTarget.style.background = 'transparent';
          }
        }}
      >
        <span>{selected.label}</span>
        <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>▼</span>
      </div>
      
      {isOpen && !disabled && (
        <div style={{
          position: 'absolute',
          ...(dropup ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
          left: 0,
          right: 0,
          background: '#1e293b',
          border: '1px solid var(--panel-border)',
          borderRadius: '8px',
          padding: '4px',
          minWidth: '100%',
          zIndex: 1000,
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px'
        }}>
          {options.map(opt => (
            <div 
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                background: value === opt.value ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                color: value === opt.value ? '#60a5fa' : 'var(--text-secondary)',
                fontSize: '0.85rem',
                transition: 'background 0.2s'
              }}
              onMouseOver={(e) => {
                if (value !== opt.value) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              }}
              onMouseOut={(e) => {
                if (value !== opt.value) e.currentTarget.style.background = 'transparent';
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatInput({ onSend, disabled, autoApproval, setAutoApproval }: { onSend: (text: string) => void, disabled: boolean, autoApproval: 'ask' | 'approve' | 'deny', setAutoApproval: (val: any) => void }) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const handleSend = () => {
    if (input.trim()) {
      onSend(input.trim());
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  return (
    <>
      <div className="approval-dropdown-container">
        <CustomDropdown 
          value={autoApproval}
          onChange={setAutoApproval}
          options={[
            { value: 'ask', label: '⚠️ Always Ask for Approval' },
            { value: 'approve', label: '✅ Auto-Approve Commands' },
            { value: 'deny', label: '❌ Auto-Deny Commands' }
          ]}
          dropup={true}
        />
      </div>
      <div className="input-container">
        <textarea 
          ref={textareaRef}
          className="input-box" 
          placeholder="Ask the agent to do something..." 
          value={input}
          onChange={(e) => {
             setInput(e.target.value);
             e.target.style.height = 'auto';
             e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={disabled}
          rows={1}
        />
        <button className="btn-primary" onClick={handleSend} disabled={disabled}>Send</button>
      </div>
    </>
  );
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

interface QuestionOverlayProps {
  questionRequest: {
    questionId: string;
    question: string;
    options: string[];
    timestamp?: number;
  };
  onSelect: (questionId: string, index: number, text: string) => void;
}

function QuestionOverlay({ questionRequest, onSelect }: QuestionOverlayProps) {
  return (
    <div className="dialog-overlay">
      <div className="dialog-box glass-panel" style={{ maxWidth: '600px', width: '90%' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, color: 'var(--accent-hover)' }}>❓ Question from Agent</h3>
        </div>
        
        <p style={{ fontSize: '1.05rem', fontWeight: 500, marginTop: 0, marginBottom: '20px' }}>
          {questionRequest.question}
        </p>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px', maxHeight: '50vh', overflowY: 'auto', paddingRight: '8px' }}>
          {questionRequest.options.map((opt, idx) => {
            const isRecommended = opt.includes('(Recommended)');
            const cleanOpt = opt.replace('(Recommended)', '').trim();
            
            return (
              <button 
                key={idx}
                onClick={() => onSelect(questionRequest.questionId, idx + 1, opt)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  textAlign: 'left',
                  padding: '12px 16px',
                  background: isRecommended ? 'rgba(59, 130, 246, 0.15)' : 'rgba(0,0,0,0.3)',
                  border: isRecommended ? '1px solid var(--accent-hover)' : '1px solid var(--panel-border)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  color: 'var(--text-primary)'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = isRecommended ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255,255,255,0.05)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = isRecommended ? 'rgba(59, 130, 246, 0.15)' : 'rgba(0,0,0,0.3)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <span style={{ 
                  marginRight: '12px', 
                  color: isRecommended ? 'var(--accent-hover)' : 'var(--text-secondary)', 
                  fontWeight: 'bold',
                  minWidth: '24px'
                }}>{idx + 1}.</span>
                <div>
                  <span style={{ display: 'block', lineHeight: 1.4 }}>{cleanOpt}</span>
                  {isRecommended && <span style={{ fontSize: '0.75rem', color: 'var(--accent-hover)', display: 'block', marginTop: '4px' }}>Recommended</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Dashboard({ project, onBack }: { project: Project, onBack: () => void }) {
  const { connected, events, messages, agentStatus, approvalRequest, questionRequest, fileChanges, sendCommand, sendApproval, sendQuestionResponse, sendStdin, sendChatMessage, clearMessages, systemStatus } = useSocket(project.id, project.relayUrl);
  const [agentType, setAgentType] = useState<'aider' | 'claude' | 'antigravity'>(
    (localStorage.getItem('agentdeck_default_agent') as 'aider' | 'claude' | 'antigravity') || 'claude'
  );
  const isBinaryMissing = systemStatus && systemStatus.binaries && !systemStatus.binaries[agentType];
  const [activeTab, setActiveTab] = useState<'chat' | 'terminal' | 'files' | 'settings'>('chat');
  const [autoApproval, setAutoApproval] = useState<'ask' | 'approve' | 'deny'>('ask');
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (approvalRequest && autoApproval !== 'ask') {
      if (autoApproval === 'approve') {
        sendApproval(approvalRequest.actionId, true);
      } else if (autoApproval === 'deny') {
        sendApproval(approvalRequest.actionId, false);
      }
    }
  }, [approvalRequest, autoApproval, sendApproval]);

  const handleSend = (text: string) => {
    if (text.trim()) {
      if (text.toLowerCase() === 'start' || text.toLowerCase() === 'stop') {
        sendCommand(text, agentType);
      } else if (agentStatus.status === 'idle' || agentStatus.status === 'error') {
        // Auto-start agent with the message
        sendCommand('start', agentType);
        setTimeout(() => sendChatMessage(text), 1500);
      } else {
        sendChatMessage(text);
      }
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
            <CustomDropdown 
              value={agentType} 
              onChange={(val: any) => setAgentType(val)}
              options={[
                { value: 'claude', label: 'Claude Code (Anthropic)' },
                { value: 'aider', label: 'Aider (Python)' },
                { value: 'antigravity', label: 'Antigravity (Google)' }
              ]}
              disabled={agentStatus.status !== 'idle' && agentStatus.status !== 'error'}
            />
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

        {activeTab === 'chat' ? (
          <>
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <ChatView messages={messages} isWorking={agentStatus.status === 'working'} onClearChat={clearMessages} />
            </div>
            <ChatInput 
              onSend={handleSend} 
              disabled={agentStatus.status === 'waiting_approval'} 
              autoApproval={autoApproval} 
              setAutoApproval={setAutoApproval} 
            />
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
      {approvalRequest && autoApproval === 'ask' && (
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

      {/* Question Overlay */}
      {questionRequest && (
        <QuestionOverlay 
          questionRequest={questionRequest}
          onSelect={(id, index, text) => sendQuestionResponse(id, index, text)}
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
