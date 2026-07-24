import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useSocket } from './hooks/useSocket';
import { XTerminal } from './XTerminal';
import { ChatView } from './ChatView';
import { useAuth } from './hooks/useAuth';
import { ChatInput } from './components/ChatInput';
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
import { RouterSync } from './Router';
import { InteractionEngine } from './InteractionEngine';
import { useWorkspaceStore } from './stores/useWorkspaceStore';
import { useProjectStore } from './stores/useProjectStore';
import { useThreadStore } from './stores/useThreadStore';
import { useViewStore } from './stores/useViewStore';
import { InspectorPanel } from './components/InspectorPanel';
import { CommandPalette } from './components/CommandPalette';
import { useChatStore } from './stores/useChatStore';
import { CustomDropdown } from './components/CustomDropdown';
import { useDebugLifecycle, subscribeToStore, checkLayoutCollapse, measureFreeze, Debug } from './utils/debug';

// 8. Log Zustand stores
subscribeToStore('ViewStore', useViewStore);
subscribeToStore('ThreadStore', useThreadStore);
subscribeToStore('ProjectStore', useProjectStore);
subscribeToStore('WorkspaceStore', useWorkspaceStore);

if (typeof window !== 'undefined') {
  (window as any).__ZUSTAND_STORES = {
    ProjectStore: useProjectStore,
    ThreadStore: useThreadStore,
    ViewStore: useViewStore
  };
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
  inspectorPanel,
  overlays
}: {
  project: Project;
  onBack: () => void;
  activeBackendUrl: string;
  topBar: React.ReactNode;
  navigationSidebar: React.ReactNode;
  inspectorPanel?: React.ReactNode;
  overlays?: React.ReactNode;
}) {
  const activeThreadId = useThreadStore(s => s.activeThreadId);
  const setActiveThreadId = useThreadStore(s => s.setActiveThread);
  const threads = useProjectStore(s => s.threads);
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

  const activeTab = useViewStore(s => s.activeView);
  useDebugLifecycle('ProjectWorkspace', { project: project?.id, activeBackendUrl, activeTab, activeThreadId });

  useEffect(() => {
    checkLayoutCollapse(`Tab Switch -> ${activeTab}`);
  }, [activeTab]);

  const [, setLocation] = useLocation();
  const setActiveTab = (view: any) => {
    if (activeThreadId) {
      setLocation(`/workspace/project/${project.id}/thread/${activeThreadId}/view/${view}`);
    }
  };
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
      {/* Layer 1: Thread Header */}
      <div
        className="thread-header"
        style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          padding: '12px 24px',
          borderBottom: '1px solid var(--color-border-default)',
          background: 'rgba(255, 255, 255, 0.02)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {activeThreadId 
                ? (threads.find(t => t.id === activeThreadId)?.name || `Thread ${activeThreadId.slice(0, 8)}`)
                : 'No Active Mission'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '4px', display: 'flex', gap: '12px' }}>
              <span>{activeThreadId ? `Thread: ${activeThreadId.slice(0, 8)}` : 'Idle Workspace'}</span>
              {activeThreadId && <span>Last activity: just now</span>}
              {agentStatus.status === 'waiting_approval' && <span style={{ color: '#fbbf24' }}>1 Pending Approval</span>}
            </div>
          </div>
          {activeThreadId && (
            <div style={{ 
              fontSize: '0.8rem', 
              padding: '4px 8px', 
              borderRadius: '4px',
              background: agentStatus.status === 'working' ? 'rgba(59, 130, 246, 0.1)' : agentStatus.status === 'waiting_approval' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.05)',
              color: agentStatus.status === 'working' ? '#60a5fa' : agentStatus.status === 'waiting_approval' ? '#fbbf24' : 'var(--color-text-secondary)',
              border: `1px solid ${agentStatus.status === 'working' ? 'rgba(59, 130, 246, 0.3)' : agentStatus.status === 'waiting_approval' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(255,255,255,0.1)'}`
            }}>
              {agentStatus.status === 'working' ? '● Executing' : 
               agentStatus.status === 'waiting_approval' ? '⏸ Paused for Review' :
               agentStatus.status === 'error' ? '✖ Error' : '○ Idle'}
            </div>
          )}
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
              transition: 'background 0.2s'
            }}
            title="Restart Agent"
            onMouseOver={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
            }}
            onMouseOut={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
            }}
          >
            🔄
          </button>
        </div>
      </div>

      {/* Layer 2: View Navigation */}
      <div
        className="view-navigation"
        style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          padding: '8px 24px',
          borderBottom: '1px solid var(--color-border-default)'
        }}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          {/* Future Thread Timeline (Execution History) Placeholder */}
          {/* <ThreadTimeline threadId={activeThreadId} /> */}
          <button
            className={`nav-btn ${activeTab === 'chat' ? 'active' : ''}`}
            style={{
              padding: '8px 18px',
              height: '40px',
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--font-weight-semibold)',
              background: activeTab === 'chat' ? 'var(--color-surface-2)' : 'transparent',
              color: activeTab === 'chat' ? '#ffffff' : 'var(--color-text-secondary)',
              borderBottom: activeTab === 'chat' ? '2px solid var(--color-accent-primary)' : '2px solid transparent',
              borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onClick={() => setActiveTab('chat')}
          >
            💬 Chat
          </button>
          <button
            className={`nav-btn ${activeTab === 'terminal' ? 'active' : ''}`}
            style={{
              padding: '8px 18px',
              height: '40px',
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--font-weight-semibold)',
              background: activeTab === 'terminal' ? 'var(--color-surface-2)' : 'transparent',
              color: activeTab === 'terminal' ? '#ffffff' : 'var(--color-text-secondary)',
              borderBottom: activeTab === 'terminal' ? '2px solid var(--color-accent-primary)' : '2px solid transparent',
              borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onClick={() => setActiveTab('terminal')}
          >
            ⌨️ Terminal
          </button>

          <button
            className={`nav-btn ${activeTab === 'changes' ? 'active' : ''}`}
            style={{
              padding: '8px 18px',
              height: '40px',
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--font-weight-semibold)',
              background: activeTab === 'changes' ? 'var(--color-surface-2)' : 'transparent',
              color: activeTab === 'changes' ? '#ffffff' : 'var(--color-text-secondary)',
              borderBottom: activeTab === 'changes' ? '2px solid var(--color-accent-primary)' : '2px solid transparent',
              borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onClick={() => setActiveTab('changes')}
          >
            🔄 Changes
          </button>
          <button
            className={`nav-btn ${activeTab === 'settings' ? 'active' : ''}`}
            style={{
              padding: '8px 18px',
              height: '40px',
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--font-weight-semibold)',
              background: activeTab === 'settings' ? 'var(--color-surface-2)' : 'transparent',
              color: activeTab === 'settings' ? '#ffffff' : 'var(--color-text-secondary)',
              borderBottom: activeTab === 'settings' ? '2px solid var(--color-accent-primary)' : '2px solid transparent',
              borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onClick={() => setActiveTab('settings')}
          >
            ⚙️ Settings
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {activeTab === 'chat' && messages.length > 0 && (
            <button className="clear-chat-btn" onClick={clearMessages} title="Clear Chat History">
              🧹 Clear Chat
            </button>
          )}
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

      {activeTab === 'settings' && (
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
            threadId={activeThreadId || null}
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
      ) : null}

      {/* Persistent Views (Mounted constantly to preserve local state like inputs) */}
      <div style={{ display: activeTab === 'changes' ? 'flex' : 'none', flex: 1, minHeight: 0, position: 'relative', width: '100%', height: '100%' }}>
        <ChangesView socket={socket} projectId={project.id} activeBackendUrl={activeBackendUrl} />
      </div>

      {/* Mobile Bottom Navigation */}
      <nav className="bottom-nav">
        <div
          className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => {
            measureFreeze('Switch to Chat', () => setActiveTab('chat'));
          }}
        >
          Chat
        </div>
        <div
          className={`nav-item ${activeTab === 'terminal' ? 'active' : ''}`}
          onClick={() => {
            measureFreeze('Switch to Terminal', () => setActiveTab('terminal'));
          }}
        >
          Terminal
        </div>
        <div
          className={`nav-item ${activeTab === 'changes' ? 'active' : ''}`}
          onClick={() => {
            measureFreeze('Switch to Changes', () => setActiveTab('changes'));
          }}
        >
          Changes
        </div>
        <div
          className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => {
            measureFreeze('Switch to Settings', () => setActiveTab('settings'));
          }}
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
          onBackToProjects={onBack}
          activeBackendUrl={activeBackendUrl}
        />
      }
      inspectorPanel={
        <InspectorPanel
          socket={socket}
          activeBackendUrl={activeBackendUrl}
          projectId={project.id}
          activeTab={activeTab}
          agentStatus={agentStatus.status}
          agentType={agentType}
          approvalRequest={approvalRequest}
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

export function App() {
  const workstations = useWorkstations();
  const { isAuthenticated } = useAuth(workstations.activeBackendUrl);
  const { projects, refreshProjects } = useProjects(workstations.activeBackendUrl);

  useDebugLifecycle('App', { isAuthenticated, activeBackendUrl: workstations.activeBackendUrl });

  const setProjects = useWorkspaceStore(s => s.setProjects);
  useEffect(() => {
    setProjects(projects);
  }, [projects, setProjects]);

  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const [, setAppLocation] = useLocation();
  
  const selectedProject = projects.find(p => p.id === activeProjectId) || null;

  const [showAddProject, setShowAddProject] = useState(false);
  const [showConnect, setShowConnect] = useState(false);

  if (!isAuthenticated) {
    return (
      <>
        <PinScreen activeBackendUrl={workstations.activeBackendUrl} />
        <PwaUpdater />
      </>
    );
  }

  const activeThreadId = useThreadStore(s => s.activeThreadId);
  const threads = useProjectStore(s => s.threads);
  const activeThread = threads.find(t => t.id === activeThreadId);

  const topBar = (
    <TopBar
      projectName={selectedProject?.name}
      missionTitle={activeThread?.name}
      activeWorkstationName={workstations.activeWorkstation?.name}
      onConnectWorkstation={() => setShowConnect(true)}
    />
  );

  const navigationSidebar = (
    <NavigationSidebar
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
    setAppLocation(`/workspace/project/${tunnelId}`);
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
            setAppLocation(`/workspace/project/${project.id}`);
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
      <CommandPalette />
      <RouterSync />
      <InteractionEngine />
      {selectedProject ? (
        <ProjectWorkspace
          project={selectedProject}
          onBack={() => setAppLocation('/')}
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
          inspectorPanel={<InspectorPanel socket={null} />}
          overlays={overlays}
        />
      )}
      <PwaUpdater />
    </>
  );
}
