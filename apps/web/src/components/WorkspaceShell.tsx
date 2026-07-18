import React, { ReactNode } from 'react';

interface WorkspaceShellProps {
  topBar: ReactNode;
  navigationSidebar: ReactNode;
  sessionSidebar?: ReactNode;
  mainWorkspace: ReactNode;
  overlays?: ReactNode;
}

export function WorkspaceShell({ 
  topBar, 
  navigationSidebar, 
  sessionSidebar, 
  mainWorkspace,
  overlays
}: WorkspaceShellProps) {
  return (
    <div className="workspace-shell">
      {topBar}
      <div className="workspace-body">
        {navigationSidebar}
        {sessionSidebar}
        {mainWorkspace}
      </div>
      {overlays}
    </div>
  );
}
