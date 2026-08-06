import React from 'react';
import { IconTerminal, IconPlus } from './icons/Icons';

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
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 'var(--spacing-4)'
          }}
        >
          <IconTerminal size={24} color="var(--color-accent-primary)" />
        </div>
        <h2 style={{ marginBottom: 'var(--spacing-3)', fontSize: 'var(--font-size-xl)' }}>Welcome to Asterim</h2>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-8)', fontSize: 'var(--font-size-md)' }}>
          Select a project from the sidebar, or create a new one to get started.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
          <button className="btn-primary" onClick={onAddProject} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--spacing-2)' }}>
            <IconPlus size={16} color="#ffffff" />
            <span>Add Project</span>
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
