import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from './hooks/useAuth';
import { useProjects, Project } from './hooks/useProjects';
import { useWorkstations } from './hooks/useWorkstations';
import { useChannel } from './hooks/useChannel';
import { PinScreen } from './PinScreen';
import { PwaUpdater } from './PwaUpdater';
import { TopBar } from './components/TopBar';
import { NavigationSidebar } from './components/NavigationSidebar';
import { WorkspaceShell } from './components/WorkspaceShell';
import { EmptyWorkspace } from './components/EmptyWorkspace';
import { EnvironmentSettingsView } from './components/environment/EnvironmentSettingsView';
import { InspectorPanel } from './components/InspectorPanel';
import { CommandPalette } from './components/CommandPalette';
import { AddProjectModal } from './components/overlays/AddProjectModal';
import { ConnectWorkstationModal } from './components/overlays/ConnectWorkstationModal';
import { FirstRunWizard } from './components/overlays/FirstRunWizard';
import { RouterSync } from './Router';
import { InteractionEngine } from './InteractionEngine';
import { ProjectWorkspace } from './workspace/ProjectWorkspace';
import { useWorkspaceStore } from './stores/useWorkspaceStore';
import { useProjectStore } from './stores/useProjectStore';
import { useThreadStore } from './stores/useThreadStore';
import { useViewStore } from './stores/useViewStore';
import { useDebugLifecycle, subscribeToStore } from './utils/debug';

if (import.meta.env.DEV) {
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

  const activeThreadId = useThreadStore(s => s.activeThreadId);
  const threads = useProjectStore(s => s.threads);
  const activeThread = threads.find(t => t.id === activeThreadId);

  // Which Asterim this is (DEC-029).
  const channelInfo = useChannel(workstations.activeBackendUrl);

  const [serverRelayUrl, setServerRelayUrl] = useState<string | undefined>(undefined);
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [detectedBinaries, setDetectedBinaries] = useState<{ claude?: boolean; antigravity?: boolean } | null>(null);

  useEffect(() => {
    const baseUrl = workstations.activeBackendUrl || window.location.origin;
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
