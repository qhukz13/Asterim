import React, { ReactNode } from 'react';
import { useDebugLifecycle } from '../utils/debug';

interface WorkspaceShellProps {
  topBar: ReactNode;
  navigationSidebar: ReactNode;
  sessionSidebar?: ReactNode;
  mainWorkspace: ReactNode;
  inspectorPanel?: ReactNode;
  overlays?: ReactNode;
}

export function WorkspaceShell({
  topBar,
  navigationSidebar,
  sessionSidebar,
  mainWorkspace,
  inspectorPanel,
  overlays
}: WorkspaceShellProps) {
  useDebugLifecycle('WorkspaceShell', {
    hasTopBar: !!topBar,
    hasNavigationSidebar: !!navigationSidebar,
    hasSessionSidebar: !!sessionSidebar,
    hasMainWorkspace: !!mainWorkspace,
    hasInspectorPanel: !!inspectorPanel,
    hasOverlays: !!overlays
  });

  return (
    <div className="workspace-shell">
      {topBar}
      <div className="workspace-body">
        {navigationSidebar}
        {sessionSidebar}
        {mainWorkspace}
        {inspectorPanel}
      </div>
      {overlays}
    </div>
  );
}
