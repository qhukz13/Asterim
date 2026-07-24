import React from 'react';
import { useDebugLifecycle } from '../utils/debug';
import { useCommandPaletteStore } from '../stores/useCommandPaletteStore';

export interface TopBarProps {
  projectName?: string;
  missionTitle?: string;
  agentStatus?: string;
  agentType?: string;
  activeWorkstationName?: string;
  onConnectWorkstation?: () => void;
}

export function TopBar({
  projectName,
  missionTitle,
  agentStatus = 'idle',
  agentType = 'Claude Code',
  activeWorkstationName,
  onConnectWorkstation
}: TopBarProps) {
  useDebugLifecycle('TopBar', { projectName, missionTitle, agentStatus, activeWorkstationName });
  const setIsOpen = useCommandPaletteStore(s => s.setIsOpen);

  // Render Rich Agent Execution State Pill
  const renderAgentStatePill = () => {
    switch (agentStatus) {
      case 'working':
        return (
          <div
            style={{
              padding: 'var(--spacing-1) var(--spacing-3)',
              borderRadius: 'var(--radius-full)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-semibold)',
              background: 'var(--color-state-working-bg)',
              color: 'var(--color-state-working)',
              border: '1px solid rgba(6, 182, 212, 0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-1)'
            }}
          >
            <span style={{ fontSize: '10px' }}>⚡</span>
            <span>Working ({agentType})</span>
          </div>
        );
      case 'paused':
      case 'approval':
        return (
          <div
            style={{
              padding: 'var(--spacing-1) var(--spacing-3)',
              borderRadius: 'var(--radius-full)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-semibold)',
              background: 'var(--color-state-paused-bg)',
              color: 'var(--color-state-paused)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-1)'
            }}
          >
            <span style={{ fontSize: '10px' }}>⚠️</span>
            <span>Action Required · Paused for Review</span>
          </div>
        );
      case 'completed':
        return (
          <div
            style={{
              padding: 'var(--spacing-1) var(--spacing-3)',
              borderRadius: 'var(--radius-full)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-semibold)',
              background: 'var(--color-state-completed-bg)',
              color: 'var(--color-state-completed)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-1)'
            }}
          >
            <span style={{ fontSize: '10px' }}>✓</span>
            <span>Mission Complete</span>
          </div>
        );
      default:
        return (
          <div
            style={{
              padding: 'var(--spacing-1) var(--spacing-3)',
              borderRadius: 'var(--radius-full)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-medium)',
              background: 'var(--color-surface-2)',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-1)'
            }}
          >
            <span style={{ fontSize: '8px', color: 'var(--color-state-completed)' }}>●</span>
            <span>Agent Ready</span>
          </div>
        );
    }
  };

  return (
    <header className="workspace-topbar">
      {/* Left: Location Context (Brand Mark + Project / Mission) */}
      <div className="topbar-left" style={{ gap: 'var(--spacing-2)' }}>
        <div
          style={{
            width: '22px',
            height: '22px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-default)',
            color: 'var(--color-accent-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'var(--font-size-xs)',
            fontWeight: 'var(--font-weight-semibold)',
            userSelect: 'none'
          }}
        >
          A
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-1)' }}>
          <span
            style={{
              fontWeight: 'var(--font-weight-semibold)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-primary)'
            }}
          >
            {projectName || 'Asterim Workspace'}
          </span>
          {missionTitle && (
            <>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>/</span>
              <span
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '180px'
                }}
              >
                {missionTitle}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Center: Prime Objective Focus */}
      <div className="topbar-center">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-2)',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            padding: 'var(--spacing-1) var(--spacing-3)',
            borderRadius: 'var(--radius-full)',
            maxWidth: '380px',
            color: 'var(--color-text-secondary)',
            fontSize: 'var(--font-size-xs)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          <span style={{ opacity: 0.8 }}>🎯 Mission:</span>
          <span
            style={{
              color: 'var(--color-text-primary)',
              fontWeight: 'var(--font-weight-medium)',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {missionTitle || 'Select or create a thread to dispatch an agent'}
          </span>
        </div>
      </div>

      {/* Right: Rich Agent State, Workstation & Command Trigger */}
      <div className="topbar-right" style={{ gap: 'var(--spacing-2)' }}>
        {renderAgentStatePill()}

        <button
          className="workstation-status-btn"
          onClick={onConnectWorkstation}
          title="Workstation Status & Connectivity"
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: activeWorkstationName ? 'var(--color-state-completed)' : 'var(--color-state-working)'
            }}
          />
          <span style={{ fontSize: 'var(--font-size-xs)' }}>{activeWorkstationName || 'Local Host'}</span>
        </button>

        <button
          onClick={() => setIsOpen(true)}
          title="Open Command Palette (⌘K)"
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            color: 'var(--color-text-muted)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 6px',
            fontSize: 'var(--font-size-xs)',
            fontFamily: 'var(--font-family-mono)',
            cursor: 'pointer',
            transition: 'all 0.15s'
          }}
          onMouseOver={e => {
            e.currentTarget.style.background = 'var(--color-surface-3)';
            e.currentTarget.style.color = 'var(--color-text-primary)';
          }}
          onMouseOut={e => {
            e.currentTarget.style.background = 'var(--color-surface-2)';
            e.currentTarget.style.color = 'var(--color-text-muted)';
          }}
        >
          ⌘K
        </button>
      </div>
    </header>
  );
}
