import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from './hooks/useSocket';
import { XTerminal } from './XTerminal';
import { ChatView } from './ChatView';
import { useAuth } from './hooks/useAuth';
import { SessionSidebar } from './components/SessionSidebar';
import { PinScreen } from './PinScreen';
import { WorkspaceShell } from './components/WorkspaceShell';
import { TopBar } from './components/TopBar';
import { NavigationSidebar } from './components/NavigationSidebar';
import { EmptyWorkspace } from './components/EmptyWorkspace';
import { AddProjectModal } from './components/overlays/AddProjectModal';
import { ConnectWorkstationModal } from './components/overlays/ConnectWorkstationModal';
import { FirstRunWizard } from './components/overlays/FirstRunWizard';
import { useProjects, Project } from './hooks/useProjects';
import { useWorkstations } from './hooks/useWorkstations';
import { PwaUpdater } from './PwaUpdater';
import { ChangesView } from './components/git/ChangesView';
import { ContextView } from './components/workspace/ContextView';
import { AISettings } from './components/AISettings';

function CustomDropdown({
  value,
  onChange,
  options,
  style = {},
  disabled = false,
  dropup = false
}: {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  style?: React.CSSProperties;
  disabled?: boolean;
  dropup?: boolean;
}) {
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
    <div
      ref={ref}
      style={{ position: 'relative', display: 'block', zIndex: isOpen ? 1000 : 1, ...style }}
    >
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
          color: disabled ? 'rgba(255,255,255,0.4)' : 'var(--color-text-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          fontSize: '0.8rem',
          opacity: disabled ? 0.6 : 1,
          transition: 'all 0.2s ease'
        }}
        onMouseOver={e => {
          if (!disabled) {
            e.currentTarget.style.color = '#fff';
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }
        }}
        onMouseOut={e => {
          if (!disabled) {
            e.currentTarget.style.color = 'var(--color-text-secondary)';
            e.currentTarget.style.background = 'transparent';
          }
        }}
      >
        <span>{selected.label}</span>
        <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>▼</span>
      </div>

      {isOpen && !disabled && (
        <div
          style={{
            position: 'absolute',
            ...(dropup ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
            left: 0,
            right: 0,
            background: '#1e293b',
            border: '1px solid var(--color-border-default)',
            borderRadius: '8px',
            padding: '4px',
            minWidth: '100%',
            zIndex: 1000,
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}
        >
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
                color: value === opt.value ? '#60a5fa' : 'var(--color-text-secondary)',
                fontSize: '0.85rem',
                transition: 'background 0.2s'
              }}
              onMouseOver={e => {
                if (value !== opt.value)
                  e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              }}
              onMouseOut={e => {
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

function ChatInput({
  onSend,
  disabled,
  autoApproval,
  setAutoApproval
}: {
  onSend: (text: string) => void;
  disabled: boolean;
  autoApproval: 'ask' | 'approve' | 'deny';
  setAutoApproval: (val: any) => void;
}) {
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
          onChange={e => {
            setInput(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={disabled}
          rows={1}
        />
        <button className="btn-primary" onClick={handleSend} disabled={disabled}>
          Send
        </button>
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

function ApprovalOverlay({
  approvalRequest,
  onApprove,
  onDeny,
  onSwitchToTerminal
}: ApprovalOverlayProps) {
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
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px'
          }}
        >
          <h3
            style={{
              margin: 0,
              color: isUrgent ? 'var(--color-error-primary)' : 'var(--color-warning-primary)'
            }}
          >
            ⚠️ Action Required
          </h3>
          <div
            className={isUrgent ? 'pulse-timer urgent' : 'pulse-timer'}
            style={{
              padding: '6px 12px',
              borderRadius: '20px',
              fontSize: '0.85rem',
              fontWeight: 'bold',
              background: isUrgent ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.1)',
              color: isUrgent ? 'var(--color-error-primary)' : 'var(--color-text-secondary)',
              border: isUrgent ? '1px solid var(--color-error-primary)' : '1px solid transparent',
              transition: 'all 0.3s ease'
            }}
          >
            ⏱️ {timerText}
          </div>
        </div>

        <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginTop: 0 }}>
          The agent needs your permission to proceed.
        </p>

        <div
          style={{
            background: 'rgba(0,0,0,0.3)',
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid var(--color-border-default)',
            marginBottom: '16px'
          }}
        >
          <div
            style={{
              fontSize: '0.8rem',
              color: 'var(--color-text-secondary)',
              marginBottom: '4px'
            }}
          >
            Description
          </div>
          <div style={{ fontWeight: 500 }}>{approvalRequest.description}</div>

          <div
            style={{
              fontSize: '0.8rem',
              color: 'var(--color-text-secondary)',
              marginTop: '12px',
              marginBottom: '4px'
            }}
          >
            Command
          </div>
          <div
            style={{
              fontFamily: 'monospace',
              color: 'var(--color-accent-hover)',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}
          >
            {approvalRequest.command}
          </div>
        </div>

        <div className="dialog-actions">
          {approvalRequest.command === 'TERMINAL_ACTION_REQUIRED' && onSwitchToTerminal ? (
            <button
              className="btn-approve"
              style={{ width: '100%', padding: '14px' }}
              onClick={() => onSwitchToTerminal(approvalRequest.actionId)}
            >
              Switch to Terminal Tab
            </button>
          ) : (
            <>
              <button className="btn-deny" onClick={() => onDeny(approvalRequest.actionId)}>
                Deny
              </button>
              <button className="btn-approve" onClick={() => onApprove(approvalRequest.actionId)}>
                Approve
              </button>
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
          <h3 style={{ margin: 0, color: 'var(--color-accent-hover)' }}>❓ Question from Agent</h3>
        </div>

        <p style={{ fontSize: '1.05rem', fontWeight: 500, marginTop: 0, marginBottom: '20px' }}>
          {questionRequest.question}
        </p>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginBottom: '16px',
            maxHeight: '50vh',
            overflowY: 'auto',
            paddingRight: '8px'
          }}
        >
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
                  border: isRecommended
                    ? '1px solid var(--color-accent-hover)'
                    : '1px solid var(--color-border-default)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  color: 'var(--color-text-primary)'
                }}
                onMouseOver={e => {
                  e.currentTarget.style.background = isRecommended
                    ? 'rgba(59, 130, 246, 0.25)'
                    : 'rgba(255,255,255,0.05)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseOut={e => {
                  e.currentTarget.style.background = isRecommended
                    ? 'rgba(59, 130, 246, 0.15)'
                    : 'rgba(0,0,0,0.3)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <span
                  style={{
                    marginRight: '12px',
                    color: isRecommended
                      ? 'var(--color-accent-hover)'
                      : 'var(--color-text-secondary)',
                    fontWeight: 'bold',
                    minWidth: '24px'
                  }}
                >
                  {idx + 1}.
                </span>
                <div>
                  <span style={{ display: 'block', lineHeight: 1.4 }}>{cleanOpt}</span>
                  {isRecommended && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--color-accent-hover)',
                        display: 'block',
                        marginTop: '4px'
                      }}
                    >
                      Recommended
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProjectWorkspace({
  project,
  onBack,
  activeBackendUrl,
  topBar,
  navigationSidebar,
  overlays
}: {
  project: Project;
  onBack: () => void;
  activeBackendUrl: string;
  topBar: React.ReactNode;
  navigationSidebar: React.ReactNode;
  overlays?: React.ReactNode;
}) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const {
    socket,
    connected,
    events,
    messages,
    agentStatus,
    approvalRequest,
    questionRequest,
    fileChanges,
    sendCommand,
    sendApproval,
    sendQuestionResponse,
    sendChatMessage,
    clearMessages,
    systemStatus,
    sendInternalEvent
  } = useSocket(project.id, activeThreadId, activeBackendUrl, project.relayUrl);
  const [agentType, setAgentType] = useState<'aider' | 'claude' | 'antigravity'>(
    (localStorage.getItem('asterim_default_agent') as 'aider' | 'claude' | 'antigravity') ||
      'claude'
  );
  const isBinaryMissing =
    systemStatus && systemStatus.binaries && !systemStatus.binaries[agentType];
  const [activeTab, setActiveTab] = useState<'chat' | 'terminal' | 'context' | 'changes' | 'settings'>('chat');
  const [autoApproval, setAutoApproval] = useState<'ask' | 'approve' | 'deny'>('ask');
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const [hasAutoStarted, setHasAutoStarted] = useState(false);

  useEffect(() => {
    setHasAutoStarted(false);
  }, [activeThreadId]);

  useEffect(() => {
    if (activeThreadId && connected && !hasAutoStarted) {
      if (agentStatus.status === 'idle' || agentStatus.status === 'error') {
        sendCommand('start', agentType);
        setHasAutoStarted(true);
      }
    }
  }, [activeThreadId, connected, agentStatus.status, hasAutoStarted, agentType, sendCommand]);

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
        sendCommand('start', agentType);
        sendChatMessage(text);
      } else {
        sendChatMessage(text);
      }

      if (agentType === 'claude' || agentType === 'aider') {
        setActiveTab('terminal');
      }
    }
  };

  useEffect(() => {
    if (activeTab === 'terminal') {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events, activeTab]);

  const mainContent = (
    <main className="workspace-main-content">
      <div
        className="top-bar"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div
            style={{
              display: 'flex',
              gap: '8px',
              background: 'rgba(0,0,0,0.3)',
              padding: '4px',
              borderRadius: '8px'
            }}
          >
            <button
              className={`nav-btn ${activeTab === 'chat' ? 'active' : ''}`}
              style={{
                padding: '6px 12px',
                minWidth: 'auto',
                background: activeTab === 'chat' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                color: activeTab === 'chat' ? '#60a5fa' : 'inherit'
              }}
              onClick={() => setActiveTab('chat')}
            >
              💬 Chat
            </button>
            <button
              className={`nav-btn ${activeTab === 'terminal' ? 'active' : ''}`}
              style={{
                padding: '6px 12px',
                minWidth: 'auto',
                background: activeTab === 'terminal' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                color: activeTab === 'terminal' ? '#60a5fa' : 'inherit'
              }}
              onClick={() => setActiveTab('terminal')}
            >
              ⌨️ Terminal
            </button>
            <button
              className={`nav-btn ${activeTab === 'context' ? 'active' : ''}`}
              style={{
                padding: '6px 12px',
                minWidth: 'auto',
                background: activeTab === 'context' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                color: activeTab === 'context' ? '#60a5fa' : 'inherit'
              }}
              onClick={() => setActiveTab('context')}
            >
              🧠 Context {fileChanges.length > 0 && `(${fileChanges.length})`}
            </button>
            <button
              className={`nav-btn ${activeTab === 'changes' ? 'active' : ''}`}
              style={{
                padding: '6px 12px',
                minWidth: 'auto',
                background: activeTab === 'changes' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                color: activeTab === 'changes' ? '#60a5fa' : 'inherit'
              }}
              onClick={() => setActiveTab('changes')}
            >
              🔄 Changes
            </button>
            <button
              className={`nav-btn ${activeTab === 'settings' ? 'active' : ''}`}
              style={{
                padding: '6px 12px',
                minWidth: 'auto',
                background: activeTab === 'settings' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                color: activeTab === 'settings' ? '#60a5fa' : 'inherit'
              }}
              onClick={() => setActiveTab('settings')}
            >
              ⚙️ Settings
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ width: '220px' }}>
              <CustomDropdown
                value={agentType}
                onChange={(val: any) => setAgentType(val)}
                options={[
                  { value: 'claude', label: 'Claude (Anthropic)' },
                  { value: 'aider', label: 'Aider (Python)' },
                  { value: 'antigravity', label: 'Antigravity (Google)' }
                ]}
                disabled={agentStatus.status !== 'idle' && agentStatus.status !== 'error'}
              />
            </div>
            <button
              onClick={() => {
                sendCommand('stop', agentType);
                setTimeout(() => sendCommand('start', agentType), 500);
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--color-border-default)',
                color: 'var(--color-text-secondary)',
                borderRadius: '8px',
                cursor: 'pointer',
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                transition: 'all 0.2s'
              }}
              title="Restart Agent"
              onMouseOver={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.color = 'var(--color-text-primary)';
              }}
              onMouseOut={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                e.currentTarget.style.color = 'var(--color-text-secondary)';
              }}
            >
              🔄
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {activeTab === 'chat' && messages.length > 0 && (
            <button className="clear-chat-btn" onClick={clearMessages} title="Clear Chat History">
              🧹 Clear Chat
            </button>
          )}
          <div
            className={`status-badge ${agentStatus.status === 'waiting_approval' ? 'waiting' : agentStatus.status === 'working' ? 'working' : 'idle'}`}
          >
            <div className="status-dot"></div>
            {agentStatus.status === 'waiting_approval' ? 'Needs Approval' : agentStatus.status}
          </div>
        </div>
      </div>

      {!connected && (
        <div
          style={{
            background: 'var(--color-error-primary)',
            color: '#fff',
            padding: '8px 16px',
            textAlign: 'center',
            fontSize: '0.9rem',
            fontWeight: 'bold',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span>⚠️ Disconnected from Workstation. Operating in offline mode.</span>
        </div>
      )}

      {activeTab === 'chat' ? (
        <>
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <ChatView
              messages={messages}
              isWorking={agentStatus.status === 'working'}
              onClearChat={clearMessages}
            />
          </div>
          <ChatInput
            onSend={handleSend}
            disabled={
              agentStatus.status === 'waiting_approval' ||
              agentStatus.status === 'working' ||
              agentStatus.status === 'startup'
            }
            autoApproval={autoApproval}
            setAutoApproval={setAutoApproval}
          />
        </>
      ) : activeTab === 'terminal' ? (
        <>
          <div
            className="terminal-view"
            style={{ flex: 1, minHeight: 0, position: 'relative', border: 'none', borderRadius: 0 }}
          >
            <XTerminal
              socket={socket}
              projectId={project.id}
              sendInternalEvent={sendInternalEvent}
            />
          </div>
        </>
      ) : activeTab === 'context' ? (
        <ContextView projectId={project.id} activeBackendUrl={activeBackendUrl} messages={messages} />
      ) : activeTab === 'settings' ? (
        <div
          className="settings-view"
          style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '24px', flex: 1, minHeight: 0, overflowY: 'auto' }}
        >
          <div className="settings-card glass-panel" style={{ padding: '20px' }}>
            <h3 style={{ marginBottom: '16px' }}>Agent Engine</h3>
            <select
              value={agentType}
              onChange={e => setAgentType(e.target.value as any)}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid var(--color-border-default)',
                color: '#fff',
                fontSize: '1rem'
              }}
              disabled={agentStatus.status !== 'idle' && agentStatus.status !== 'error'}
            >
              <option value="claude">Claude Code (Anthropic)</option>
              <option value="aider">Aider (Python)</option>
              <option value="antigravity">Antigravity (Google)</option>
            </select>
            {isBinaryMissing && (
              <div
                style={{
                  marginTop: '12px',
                  padding: '12px',
                  borderRadius: '8px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid var(--color-error-primary)',
                  fontSize: '0.85rem',
                  color: 'var(--color-error-primary)'
                }}
              >
                ⚠️ Warning: <strong>{agentType}</strong> binary not found on server PATH. Starting
                this agent will fail.
              </div>
            )}
          </div>
          <AISettings activeBackendUrl={activeBackendUrl} />
        </div>
      ) : null}

      {/* Persistent Views (Mounted constantly to preserve local state like inputs) */}
      <div style={{ display: activeTab === 'changes' ? 'flex' : 'none', flex: 1, minHeight: 0, position: 'relative', width: '100%', height: '100%' }}>
        <ChangesView socket={socket} projectId={project.id} activeBackendUrl={activeBackendUrl} />
      </div>

      {/* Mobile Bottom Navigation */}
      <nav className="bottom-nav">
        <div
          className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          Chat
        </div>
        <div
          className={`nav-item ${activeTab === 'terminal' ? 'active' : ''}`}
          onClick={() => setActiveTab('terminal')}
        >
          Terminal
        </div>
        <div
          className={`nav-item ${activeTab === 'context' ? 'active' : ''}`}
          onClick={() => setActiveTab('context')}
        >
          Context {fileChanges.length > 0 && `(${fileChanges.length})`}
        </div>
        <div
          className={`nav-item ${activeTab === 'changes' ? 'active' : ''}`}
          onClick={() => setActiveTab('changes')}
        >
          Changes
        </div>
        <div
          className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </div>
      </nav>
    </main>
  );

  return (
    <WorkspaceShell
      topBar={topBar}
      navigationSidebar={navigationSidebar}
      sessionSidebar={
        <SessionSidebar
          projectId={project.id}
          activeThreadId={activeThreadId}
          onSelectThread={setActiveThreadId}
          onBackToProjects={onBack}
          activeBackendUrl={activeBackendUrl}
        />
      }
      mainWorkspace={mainContent}
      overlays={
        <>
          {overlays}
          {approvalRequest && autoApproval === 'ask' && (
            <ApprovalOverlay
              approvalRequest={approvalRequest}
              onApprove={id => sendApproval(id, true)}
              onDeny={id => sendApproval(id, false)}
              onSwitchToTerminal={id => {
                setActiveTab('terminal');
                sendApproval(id, true);
              }}
            />
          )}
          {questionRequest && (
            <QuestionOverlay
              questionRequest={questionRequest}
              onSelect={(id, index, text) => sendQuestionResponse(id, index, text)}
            />
          )}
        </>
      }
    />
  );
}

export default function App() {
  const workstations = useWorkstations();
  const { isAuthenticated } = useAuth(workstations.activeBackendUrl);
  const { projects, refreshProjects } = useProjects(workstations.activeBackendUrl);

  const [selectedProject, setSelectedProject] = useState<Project | null>(() => {
    const saved = localStorage.getItem('asterim_active_project');
    return saved ? JSON.parse(saved) : null;
  });

  const [showAddProject, setShowAddProject] = useState(false);
  const [showConnect, setShowConnect] = useState(false);

  useEffect(() => {
    if (selectedProject) {
      localStorage.setItem('asterim_active_project', JSON.stringify(selectedProject));
    } else {
      localStorage.removeItem('asterim_active_project');
    }
  }, [selectedProject]);

  if (!isAuthenticated) {
    return (
      <>
        <PinScreen activeBackendUrl={workstations.activeBackendUrl} />
        <PwaUpdater />
      </>
    );
  }

  const topBar = (
    <TopBar
      activeWorkstationName={workstations.activeWorkstation?.name}
      onConnectWorkstation={() => setShowConnect(true)}
    />
  );

  const navigationSidebar = (
    <NavigationSidebar
      projects={projects}
      activeProjectId={selectedProject?.id}
      onSelectProject={setSelectedProject}
      onAddProject={() => setShowAddProject(true)}
    />
  );

  const [serverRelayUrl, setServerRelayUrl] = useState<string | undefined>(undefined);
  const [isFirstRun, setIsFirstRun] = useState(false);

  useEffect(() => {
    // Fetch system info to get relay url
    const baseUrl =
      workstations.activeBackendUrl ||
      `${window.location.protocol}//${window.location.hostname}:3000`;
    const tokenKey = workstations.activeBackendUrl
      ? `asterim_token_${workstations.activeBackendUrl}`
      : 'asterim_token';
    const token = localStorage.getItem(tokenKey) || '';
    fetch(`${baseUrl}/api/v1/system`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        if (data.relayUrl) setServerRelayUrl(data.relayUrl);
        if (data.isFirstRun) setIsFirstRun(true);
      })
      .catch(console.error);
  }, [workstations.activeBackendUrl]);

  const handleConnectRemote = (tunnelId: string, pin: string) => {
    if (pin) {
      localStorage.setItem('asterim_remote_pin', pin);
    }
    const remoteProject: Project = {
      id: tunnelId,
      name: 'Remote Session',
      path: 'Cloud Relay',
      relayUrl: serverRelayUrl
    };
    setSelectedProject(remoteProject);
    setShowConnect(false);
  };

  const overlays = (
    <>
      {isFirstRun && (
        <FirstRunWizard
          activeBackendUrl={workstations.activeBackendUrl}
          onComplete={() => setIsFirstRun(false)}
        />
      )}
      {showAddProject && (
        <AddProjectModal
          activeBackendUrl={workstations.activeBackendUrl}
          onClose={() => setShowAddProject(false)}
          onSuccess={project => {
            refreshProjects();
            setSelectedProject(project);
            setShowAddProject(false);
          }}
        />
      )}
      {showConnect && (
        <ConnectWorkstationModal
          workstations={workstations}
          onClose={() => setShowConnect(false)}
          onConnectRemote={handleConnectRemote}
        />
      )}
    </>
  );

  return (
    <>
      {selectedProject ? (
        <ProjectWorkspace
          project={selectedProject}
          onBack={() => setSelectedProject(null)}
          activeBackendUrl={workstations.activeBackendUrl}
          topBar={topBar}
          navigationSidebar={navigationSidebar}
          overlays={overlays}
        />
      ) : (
        <WorkspaceShell
          topBar={topBar}
          navigationSidebar={navigationSidebar}
          mainWorkspace={
            <EmptyWorkspace
              onAddProject={() => setShowAddProject(true)}
              onConnectWorkstation={() => setShowConnect(true)}
              activeWorkstationName={workstations.activeWorkstation?.name}
            />
          }
          overlays={overlays}
        />
      )}
      <PwaUpdater />
    </>
  );
}
