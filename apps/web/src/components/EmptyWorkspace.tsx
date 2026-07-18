import React from 'react';

interface EmptyWorkspaceProps {
  onAddProject: () => void;
  onConnectWorkstation: () => void;
  activeWorkstationName?: string;
}

export function EmptyWorkspace({
  onAddProject,
  onConnectWorkstation,
  activeWorkstationName
}: EmptyWorkspaceProps) {
  return (
    <div
      className="workspace-main-content"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column'
      }}
    >
      <div style={{ maxWidth: '400px', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: 'var(--spacing-4)' }}>🚀</div>
        <h2 style={{ marginBottom: 'var(--spacing-3)' }}>Welcome to Asterim</h2>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-8)' }}>
          Select a project from the sidebar, or create a new one to get started.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
          <button className="btn-primary" onClick={onAddProject} style={{ width: '100%' }}>
            + Add Project
          </button>
          {!activeWorkstationName && (
            <button
              onClick={onConnectWorkstation}
              style={{
                background: 'var(--color-bg-glass)',
                border: '1px solid var(--color-border-default)',
                padding: 'var(--spacing-3)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Connect Remote Workstation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
