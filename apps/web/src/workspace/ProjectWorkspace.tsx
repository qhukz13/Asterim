import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useSocket } from '../hooks/useSocket';
import type { Project } from '../hooks/useProjects';
import type { ViewType } from '../stores/useViewStore';
import { useViewStore } from '../stores/useViewStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useProjectStore } from '../stores/useProjectStore';
import { useThreadStore } from '../stores/useThreadStore';
import { WorkspaceShell } from '../components/WorkspaceShell';
import { SessionSidebar } from '../components/SessionSidebar';
import { InspectorPanel } from '../components/InspectorPanel';
import { ChatView } from '../ChatView';
import { ChatInput } from '../components/ChatInput';
import { XTerminal } from '../XTerminal';
import { ChangesView } from '../components/git/ChangesView';
import { DecisionExplorer } from '../components/memory/DecisionExplorer';
import { McpServerExplorer } from '../components/mcp/McpServerExplorer';
import { SkillsExplorer } from '../components/skills/SkillsExplorer';
import { TeamAgentExplorer } from '../components/teamAgents/TeamAgentExplorer';
import { PipelineDashboard } from '../components/pipelines/PipelineDashboard';
import { EnvironmentSettingsView } from '../components/environment/EnvironmentSettingsView';
import { DelegationStatus } from '../components/delegation/DelegationStatus';
import { DelegateModal } from '../components/delegation/DelegateModal';
import { ThreadHeader } from './ThreadHeader';
import { ViewTabs } from './ViewTabs';
import { SettingsView } from './SettingsView';
import { ApprovalOverlay } from '../overlays/ApprovalOverlay';
import { QuestionOverlay } from '../overlays/QuestionOverlay';
import { useDebugLifecycle, checkLayoutCollapse, measureFreeze } from '../utils/debug';

export interface ProjectWorkspaceProps {
  project: Project;
  onBack: () => void;
  activeBackendUrl: string;
  topBar: React.ReactNode;
  navigationSidebar: React.ReactNode;
  inspectorPanel?: React.ReactNode;
  overlays?: React.ReactNode;
}

export function ProjectWorkspace({
  project,
  onBack,
  activeBackendUrl,
  topBar,
  navigationSidebar,
  overlays
}: ProjectWorkspaceProps) {
  const activeThreadId = useThreadStore(s => s.activeThreadId);
  const threads = useProjectStore(s => s.threads);
  const {
    socket,
    connected,
    events,
    messages,
    agentStatus,
    approvalRequest,
    questionRequest,
    sendCommand,
    sendApproval,
    sendQuestionResponse,
    sendChatMessage,
    clearMessages,
    systemStatus,
    sendInternalEvent
  } = useSocket(project.id, activeThreadId, activeBackendUrl, project.relayUrl);

  const [agentType, setAgentType] = useState<'claude' | 'antigravity'>(
    (localStorage.getItem('asterim_default_agent') as 'claude' | 'antigravity') || 'claude'
  );
  const isBinaryMissing = Boolean(
    systemStatus && systemStatus.binaries && !systemStatus.binaries[agentType]
  );

  const activeTab = useViewStore(s => s.activeView);
  const activeEnvironmentId = useWorkspaceStore(s => s.activeEnvironmentId);
  useDebugLifecycle('ProjectWorkspace', { project: project?.id, activeBackendUrl, activeTab, activeThreadId });

  useEffect(() => {
    checkLayoutCollapse(`Tab Switch -> ${activeTab}`);
  }, [activeTab]);

  const [, setLocation] = useLocation();
  const setStoreView = useViewStore(s => s.setActiveView);
  const setActiveTab = (view: ViewType) => {
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

  // Multi-agent delegation (P7-02)
  const [showDelegateModal, setShowDelegateModal] = useState(false);
  const parentStates = useProjectStore(s => s.parentStates);
  const isDelegating = activeThreadId
    ? parentStates[activeThreadId] === 'WAITING_FOR_CHILD'
    : false;

  const openThread = (threadId: string) => {
    setLocation(`/workspace/project/${project.id}/thread/${threadId}/view/chat`);
  };
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

  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    setClockTick(Date.now());
    const id = setInterval(() => setClockTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [messages]);

  const lastActivityLabel = useMemo(() => {
    const last = messages.length ? messages[messages.length - 1].timestamp : 0;
    if (!last || !clockTick) return '';
    const seconds = Math.max(0, Math.round((clockTick - last) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }, [messages, clockTick]);

  const activeThread = threads.find(t => t.id === activeThreadId);

  const mainContent = (
    <main className="workspace-main-content">
      <ThreadHeader
        activeThreadId={activeThreadId}
        threadName={activeThread?.name}
        lastActivityLabel={lastActivityLabel}
        agentStatus={agentStatus.status}
        agentType={agentType}
        onAgentTypeChange={type => {
          setAgentType(type);
          localStorage.setItem('asterim_default_agent', type);
        }}
        onRestartAgent={() => {
          sendCommand('stop', agentType);
          setTimeout(() => sendCommand('start', agentType), 500);
        }}
        isControlsDisabled={agentStatus.status !== 'idle' && agentStatus.status !== 'error'}
      />

      <ViewTabs
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        activeThreadId={activeThreadId}
        connected={connected}
        hasMessages={messages.length > 0}
        onOpenDelegateModal={() => setShowDelegateModal(true)}
        onClearChat={clearMessages}
      />

      {activeTab === 'settings' && (
        <SettingsView
          agentType={agentType}
          setAgentType={type => {
            setAgentType(type);
            localStorage.setItem('asterim_default_agent', type);
          }}
          agentStatus={agentStatus.status}
          isBinaryMissing={isBinaryMissing}
          activeBackendUrl={activeBackendUrl}
        />
      )}

      {activeTab === 'chat' ? (
        <>
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
      <div style={{ display: activeTab === 'team' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, position: 'relative', width: '100%', height: '100%' }}>
        <TeamAgentExplorer teamId={activeEnvironmentId} projectId={project.id} />
      </div>
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
          onClick={() => measureFreeze('Switch to Chat', () => setActiveTab('chat'))}
        >
          Chat
        </div>
        <div
          className={`nav-item ${activeTab === 'terminal' ? 'active' : ''}`}
          onClick={() => measureFreeze('Switch to Terminal', () => setActiveTab('terminal'))}
        >
          Terminal
        </div>
        <div
          className={`nav-item ${activeTab === 'changes' ? 'active' : ''}`}
          onClick={() => measureFreeze('Switch to Changes', () => setActiveTab('changes'))}
        >
          Changes
        </div>
        <div
          className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => measureFreeze('Switch to Settings', () => setActiveTab('settings'))}
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
          <ApprovalOverlay
            approvalRequest={approvalRequest}
            autoApproval={autoApproval}
            onApprove={id => sendApproval(id, true)}
            onDeny={id => sendApproval(id, false)}
            onSwitchToTerminal={id => {
              setActiveTab('terminal');
              sendApproval(id, true);
            }}
          />
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
