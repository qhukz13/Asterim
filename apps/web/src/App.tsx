import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useSocket } from './hooks/useSocket';
import { XTerminal } from './XTerminal';
import { ChatView } from './ChatView';
import { IconMessage, IconTerminal, IconGitBranch, IconSettings, IconAlertTriangle, IconStar } from './components/icons/Icons';
import type { ViewType } from './stores/useViewStore';

/**
 * The views a thread opens with. Five, on purpose: everything a first session
 * needs is here, and the rest lives under "More" so the strip never overflows
 * at laptop widths. Team and pipeline views are frozen prototypes and are not
 * offered at all; their routes still resolve for anyone who has a URL.
 */
const PRIMARY_VIEWS: { id: ViewType; label: string; icon: typeof IconMessage }[] = [
  { id: 'chat', label: 'Chat', icon: IconMessage },
  { id: 'terminal', label: 'Terminal', icon: IconTerminal },
  { id: 'changes', label: 'Changes', icon: IconGitBranch },
  { id: 'memory', label: 'Memory', icon: IconStar },
  { id: 'settings', label: 'Settings', icon: IconSettings }
];

const MORE_VIEWS: { id: ViewType; label: string }[] = [
  { id: 'mcp', label: 'MCP servers' },
  { id: 'skills', label: 'Skills' },
  { id: 'environment', label: 'Environment' }
];
import { useAuth } from './hooks/useAuth';
import { ChatInput } from './components/ChatInput';
import { ApprovalCard } from './components/approvals/ApprovalCard';
import { DiagnosticsPanel } from './components/diagnostics/DiagnosticsPanel';
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
import { useChannel } from './hooks/useChannel';
import { PwaUpdater } from './PwaUpdater';
import { ChangesView } from './components/git/ChangesView';
import { DecisionExplorer } from './components/memory/DecisionExplorer';
import { McpServerExplorer } from './components/mcp/McpServerExplorer';
import { SkillsExplorer } from './components/skills/SkillsExplorer';
import { TeamAgentExplorer } from './components/teamAgents/TeamAgentExplorer';
import { PipelineDashboard } from './components/pipelines/PipelineDashboard';
import { ContextView } from './components/workspace/ContextView';
import { DelegationStatus, ThreadSandboxStatus } from './components/delegation/DelegationStatus';
import { DelegateModal } from './components/delegation/DelegateModal';
import { EnvironmentSettingsView } from './components/environment/EnvironmentSettingsView';
import { AISettings } from './components/AISettings';
import { RouterSync } from './Router';
import { InteractionEngine } from './InteractionEngine';
import { useWorkspaceStore } from './stores/useWorkspaceStore';
import { useProjectStore } from './stores/useProjectStore';
import { useThreadStore } from './stores/useThreadStore';
import { useViewStore } from './stores/useViewStore';
import { InspectorPanel } from './components/InspectorPanel';
import { CommandPalette } from './components/CommandPalette';
import { IconRefresh } from './components/icons/Icons';
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
          <h3 style={{ margin: 0, color: 'var(--color-accent-hover)' }}>Question from the agent</h3>
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
  // The team a shared agent belongs to is the active environment (P8-02): an
  // environment is a workspace, and a workspace is what the Core rooms team
  // turn events by.
  const activeEnvironmentId = useWorkspaceStore(s => s.activeEnvironmentId);
  useDebugLifecycle('ProjectWorkspace', { project: project?.id, activeBackendUrl, activeTab, activeThreadId });

  useEffect(() => {
    checkLayoutCollapse(`Tab Switch -> ${activeTab}`);
  }, [activeTab]);

  const [, setLocation] = useLocation();
  const setStoreView = useViewStore(s => s.setActiveView);
  const setActiveTab = (view: any) => {
    setStoreView(view);
    if (activeThreadId) {
      setLocation(`/workspace/project/${project.id}/thread/${activeThreadId}/view/${view}`);
    } else if (project?.id) {
      setLocation(`/workspace/project/${project.id}/view/${view}`);
    }
  };
  const [autoApproval, setAutoApproval] = useState<'ask' | 'approve' | 'deny'>('ask');
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const [hasAutoStarted, setHasAutoStarted] = useState(false);

  // Multi-agent delegation (P7-02). Navigating to a child is an ordinary route
  // change, so a delegated thread is inspected exactly like any other one.
  const [showDelegateModal, setShowDelegateModal] = useState(false);
  const parentStates = useProjectStore(s => s.parentStates);
  const isDelegating = activeThreadId
    ? parentStates[activeThreadId] === 'WAITING_FOR_CHILD'
    : false;
  const openThread = (threadId: string) => {
    setLocation(`/workspace/project/${project.id}/thread/${threadId}/view/chat`);
  };
  // An artifact the child named is a file in the working tree, so the place to
  // look at it is Changes. ChangesView owns which file is open in its own local
  // state, so this lands on the diff rather than on that one row.
  const openArtifact = () => setActiveTab('changes');

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
        sendApproval(approvalRequest.actionId, true, 'auto-rule');
      } else if (autoApproval === 'deny') {
        sendApproval(approvalRequest.actionId, false, 'auto-rule');
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
              {agentStatus.status === 'working' ? 'Executing' :
               agentStatus.status === 'waiting_approval' ? 'Paused for review' :
               agentStatus.status === 'error' ? 'Error' : 'Idle'}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ width: '220px' }}>
            <CustomDropdown
              value={agentType}
              onChange={(val: any) => setAgentType(val)}
              options={[
                { value: 'claude', label: 'Claude Code' },
                { value: 'antigravity', label: 'Antigravity — preview' }
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
            <IconRefresh size={14} />
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
        <div className="view-navigation-tabs">
          {PRIMARY_VIEWS.map(view => {
            const Icon = view.icon;
            return (
              <button
                key={view.id}
                className={`view-tab ${activeTab === view.id ? 'active' : ''}`}
                onClick={() => setActiveTab(view.id)}
              >
                <Icon size={15} />
                <span>{view.label}</span>
              </button>
            );
          })}
          <div className="view-tab-more">
            <CustomDropdown
              value={MORE_VIEWS.some(v => v.id === activeTab) ? activeTab : '__more'}
              onChange={(val: string) => {
                if (val !== '__more') setActiveTab(val);
              }}
              options={[{ value: '__more', label: 'More' }, ...MORE_VIEWS.map(v => ({ value: v.id, label: v.label }))]}
            />
          </div>
        </div>

        <div className="view-navigation-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Whether this thread's work is going into a sandbox rather than the
              operator's checkout, and what the project's own checks last said
              about it (P8-03). */}
          {activeTab === 'chat' && activeThreadId && <ThreadSandboxStatus />}
          {activeTab === 'chat' && activeThreadId && (
            <button
              onClick={() => setShowDelegateModal(true)}
              title="Hand this thread's work to another role, or ask for a review"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                fontSize: 'var(--font-size-xs)',
                fontWeight: 'var(--font-weight-semibold)',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s'
              }}
            >
              <IconGitBranch size={13} /> Delegate
            </button>
          )}
          {activeTab === 'chat' && messages.length > 0 && (
            <button className="clear-chat-btn" onClick={clearMessages} title="Clear Chat History">
              Clear chat
            </button>
          )}
        </div>
      </div>

      {!connected && (
        <div
          style={{
            background: 'var(--color-surface-2)',
            borderBottom: '1px solid var(--color-border-subtle)',
            padding: '8px 16px',
            color: 'var(--color-warning-primary)',
            fontSize: '0.9rem',
            fontWeight: 'bold',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <IconAlertTriangle size={16} /> Disconnected from Workstation. Operating in offline mode.
          </span>
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
              <option value="claude">Claude Code</option>
              <option value="antigravity">Antigravity — preview</option>
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
                  color: 'var(--color-error-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <IconAlertTriangle size={16} /> Warning: <strong>{agentType}</strong> binary not found on server PATH. Starting
                this agent will fail.
              </div>
            )}
          </div>
          <AISettings activeBackendUrl={activeBackendUrl} />
          <DiagnosticsPanel activeBackendUrl={activeBackendUrl} />
        </div>
      )}

      {activeTab === 'chat' ? (
        <>
          {/* Whether this thread is parked behind a delegated agent, and what
              the last one came back with. Above the transcript rather than in
              it: it is the state of the session, not a message in it. */}
          <DelegationStatus
            onInspectChild={openThread}
            onOpenArtifact={openArtifact}
            activeBackendUrl={activeBackendUrl}
          />
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
      <div style={{ display: activeTab === 'changes' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, position: 'relative', width: '100%', height: '100%' }}>
        <ChangesView socket={socket} projectId={project.id} activeBackendUrl={activeBackendUrl} />
      </div>
      <div style={{ display: activeTab === 'memory' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, position: 'relative', width: '100%', height: '100%' }}>
        <DecisionExplorer projectId={project.id} />
      </div>
      <div style={{ display: activeTab === 'mcp' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, position: 'relative', width: '100%', height: '100%' }}>
        <McpServerExplorer />
      </div>
      <div style={{ display: activeTab === 'skills' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, position: 'relative', width: '100%', height: '100%' }}>
        <SkillsExplorer workspacePath={project.path} />
      </div>
      {/* Shared team agents (P8-02). Scoped to the active environment, which is
          the team: a shared role belongs to the group, not to this project, and
          the project is passed only so a new thread has a checkout to run in. */}
      <div style={{ display: activeTab === 'team' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, position: 'relative', width: '100%', height: '100%' }}>
        <TeamAgentExplorer teamId={activeEnvironmentId} projectId={project.id} />
      </div>
      {/* Declarative multi-agent pipelines (P9-03). Scoped to this project —
          every step of a run is a delegated session against this checkout — and
          to the active environment, which is the workspace the definitions are
          authorized against. */}
      <div style={{ display: activeTab === 'pipelines' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, position: 'relative', width: '100%', height: '100%' }}>
        <PipelineDashboard
          projectId={project.id}
          workspaceId={activeEnvironmentId}
          activeBackendUrl={activeBackendUrl}
          onOpenThread={openThread}
        />
      </div>
      <div style={{ display: activeTab === 'workspace' || activeTab === 'environment' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, position: 'relative', width: '100%', height: '100%' }}>
        <EnvironmentSettingsView />
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
            <ApprovalCard
              // A fresh subtree per request: two consecutive approvals must not
              // share DOM, so a click aimed at one can never land on the next.
              key={approvalRequest.actionId}
              request={approvalRequest}
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
          {showDelegateModal && (
            <DelegateModal
              onClose={() => setShowDelegateModal(false)}
              activeBackendUrl={activeBackendUrl}
              isDelegating={isDelegating}
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
  const activeEnvironmentId = useWorkspaceStore(s => s.activeEnvironmentId);
  const { projects, refreshProjects } = useProjects(workstations.activeBackendUrl, activeEnvironmentId || undefined);

  useDebugLifecycle('App', { isAuthenticated, activeBackendUrl: workstations.activeBackendUrl, activeEnvironmentId });

  const setProjects = useWorkspaceStore(s => s.setProjects);
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const currentEnvId = activeEnvironmentId || 'personal';

  useEffect(() => {
    setProjects(projects);
  }, [projects, setProjects]);

  // Restore and auto-select active project per environment
  useEffect(() => {
    if (projects.length > 0) {
      const savedId = localStorage.getItem(`asterim_active_project_${currentEnvId}`);
      const validSaved = projects.find(p => p.id === savedId);
      const currentValid = projects.find(p => p.id === activeProjectId);
      if (!currentValid) {
        const target = validSaved || projects[0];
        if (target) {
          useProjectStore.getState().setActiveProject(target.id);
        }
      }
    }
  }, [projects, activeProjectId, currentEnvId]);

  useEffect(() => {
    if (activeProjectId && currentEnvId) {
      localStorage.setItem(`asterim_active_project_${currentEnvId}`, activeProjectId);
    }
  }, [activeProjectId, currentEnvId]);

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

  // Which Asterim this is (DEC-029). Only the Core knows, and the answer decides
  // whether the header carries the [DEV-CHANNEL] badge.
  const channelInfo = useChannel(workstations.activeBackendUrl);

  const topBar = (
    <TopBar
      projectName={selectedProject?.name}
      missionTitle={activeThread?.name}
      activeWorkstationName={workstations.activeWorkstation?.name}
      channelInfo={channelInfo}
      onConnectWorkstation={() => setShowConnect(true)}
    />
  );

  const navigationSidebar = (
    <NavigationSidebar
      onAddProject={() => setShowAddProject(true)}
      onProjectRemoved={refreshProjects}
    />
  );

  const [serverRelayUrl, setServerRelayUrl] = useState<string | undefined>(undefined);
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [detectedBinaries, setDetectedBinaries] = useState<{ claude?: boolean; antigravity?: boolean } | null>(null);

  useEffect(() => {
    // Fetch system info to get relay url
    const baseUrl =
      workstations.activeBackendUrl ||
      window.location.origin;
    const tokenKey = workstations.activeBackendUrl
      ? `asterim_token_${workstations.activeBackendUrl}`
      : 'asterim_token';
    const token = localStorage.getItem(tokenKey) || '';
    fetch(`${baseUrl}/api/v1/system`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        if (data.relayUrl) setServerRelayUrl(data.relayUrl);
        if (data.isFirstRun) setIsFirstRun(true);
        if (data.binaries) setDetectedBinaries(data.binaries);
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
          binaries={detectedBinaries}
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

  const activeTab = useViewStore(s => s.activeView);

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
            activeTab === 'workspace' || activeTab === 'environment' ? (
              <EnvironmentSettingsView />
            ) : (
              <EmptyWorkspace
                onAddProject={() => setShowAddProject(true)}
                onConnectWorkstation={() => setShowConnect(true)}
                activeWorkstationName={workstations.activeWorkstation?.name}
              />
            )
          }
          inspectorPanel={<InspectorPanel socket={null} />}
          overlays={overlays}
        />
      )}
      <PwaUpdater />
    </>
  );
}
