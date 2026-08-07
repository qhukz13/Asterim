import React from 'react';
import { IconTerminal, IconPlus, IconFolder, IconSettings } from './icons/Icons';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useViewStore } from '../stores/useViewStore';

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
  const activeEnvironment = useWorkspaceStore(s => s.activeEnvironment);
  const setActiveView = useViewStore(s => s.setActiveView);

  const isPersonalEnv = !activeEnvironment || activeEnvironment.isPersonal || activeEnvironment.id === 'personal' || activeEnvironment.slug === 'personal';
  const envName = activeEnvironment?.name || 'Personal Environment';
  const envPreset = isPersonalEnv ? 'personal' : (activeEnvironment.preset || 'company');

  const getBadgeStyle = (preset: string) => {
    switch (preset) {
      case 'company':
        return { bg: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.4)', text: '#60a5fa' };
      case 'client':
        return { bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.4)', text: '#fbbf24' };
      case 'experimental':
        return { bg: 'rgba(139, 92, 246, 0.15)', border: 'rgba(139, 92, 246, 0.4)', text: '#a78bfa' };
      default:
        return { bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.4)', text: '#34d399' };
    }
  };

  const badgeStyle = getBadgeStyle(envPreset);

  return (
    <div
      className="workspace-main-content"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        flex: 1,
        height: '100%',
        background: 'var(--color-bg-primary, #080c14)',
        padding: '2rem'
      }}
    >
      <div style={{ maxWidth: '440px', width: '100%', textAlign: 'center' }}>
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            background: badgeStyle.bg,
            border: `1px solid ${badgeStyle.border}`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 'var(--spacing-4)'
          }}
        >
          <IconTerminal size={28} color={badgeStyle.text} />
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <span
            style={{
              background: badgeStyle.bg,
              border: `1px solid ${badgeStyle.border}`,
              color: badgeStyle.text,
              fontSize: '0.75rem',
              padding: '2px 10px',
              borderRadius: '12px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
          >
            {envPreset} Environment
          </span>
          <h2 style={{ margin: '8px 0 4px 0', fontSize: '1.5rem', fontWeight: 800, color: '#ffffff' }}>
            {envName}
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: 0 }}>
            This Environment is completely isolated. Attach a repository or create a new project to begin.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '1.5rem' }}>
          <button
            className="btn-primary"
            onClick={onAddProject}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '12px 16px',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: 'pointer'
            }}
          >
            <IconPlus size={18} color="#042114" />
            <span>Add Project / Existing Repository</span>
          </button>

          <button
            onClick={() => setActiveView('environment')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '12px 16px',
              background: '#131b2e',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '8px',
              color: '#ffffff',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.9rem'
            }}
          >
            <IconSettings size={18} color="#94a3b8" />
            <span>Open Environment Settings</span>
          </button>

          {!activeWorkstationName && (
            <button
              onClick={onConnectWorkstation}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '10px 16px',
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                fontSize: '0.825rem'
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

