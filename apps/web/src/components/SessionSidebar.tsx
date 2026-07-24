import React, { useEffect, useState } from 'react';
import { NewAgentModal } from './overlays/NewAgentModal';
import { useProjectStore } from '../stores/useProjectStore';
import { useThreadStore } from '../stores/useThreadStore';
import { usePanelStore } from '../stores/usePanelStore';
import { useDebugLifecycle } from '../utils/debug';
import { useViewStore } from '../stores/useViewStore';
import { useLocation } from 'wouter';

export interface Thread {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
}

export function SessionSidebar({
  projectId,
  onBackToProjects,
  activeBackendUrl
}: {
  projectId: string;
  onBackToProjects: () => void;
  activeBackendUrl?: string;
}) {
  useDebugLifecycle('SessionSidebar', { projectId, activeBackendUrl });

  const threads = useProjectStore(s => s.threads);
  const setThreads = useProjectStore(s => s.setThreads);
  const activeThreadId = useThreadStore(s => s.activeThreadId);
  const perThreadViewState = useViewStore(s => s.perThreadViewState);
  const [, setLocation] = useLocation();

  const handleSelectThread = (threadId: string) => {
    const lastView = perThreadViewState[threadId] || 'chat';
    setLocation(`/workspace/project/${projectId}/thread/${threadId}/view/${lastView}`);
  };
  const [loading, setLoading] = useState(true);
  const [showNewAgentModal, setShowNewAgentModal] = useState(false);

  const isCollapsed = usePanelStore(s => s.isCenterSidebarCollapsed);
  const width = usePanelStore(s => s.centerSidebarWidth);
  const setWidth = usePanelStore(s => s.setPanelWidth);

  const handleDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(180, Math.min(440, startWidth + delta));
      setWidth('center', newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  useEffect(() => {
    const baseUrl =
      activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;
    const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
    const token = localStorage.getItem(tokenKey) || '';

    fetch(`${baseUrl}/api/v1/projects/${projectId}/threads`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(res => res.json())
      .then(data => {
        if (data.threads) {
          setThreads(data.threads);
          if (!activeThreadId && data.threads.length > 0) {
            handleSelectThread(data.threads[0].id);
          }
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch threads', err);
        setLoading(false);
      });
  }, [projectId]);

  const handleCreateThreadSubmit = async (name: string) => {
    setShowNewAgentModal(false);
    try {
      const baseUrl =
        activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;
      const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';

      const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/threads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (data.thread) {
        setThreads([...threads, data.thread]);
        handleSelectThread(data.thread.id);
      }
    } catch (err) {
      console.error('Failed to create thread', err);
    }
  };

  if (isCollapsed) return null;

  return (
    <div className="workspace-session-sidebar" style={{ width: `${width}px`, position: 'relative' }}>
      {/* Resizer Handle */}
      <div
        onMouseDown={handleDrag}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: '4px',
          cursor: 'col-resize',
          zIndex: 100,
          background: 'transparent'
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-border-subtle)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      />

      {/* Header */}
      <div
        style={{
          padding: 'var(--spacing-2) var(--spacing-3)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--color-border-subtle)',
          height: 'var(--nav-height)'
        }}
      >
        <button
          onClick={onBackToProjects}
          style={{
            padding: 'var(--spacing-1) var(--spacing-2)',
            fontSize: 'var(--font-size-xs)',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            color: 'var(--color-text-secondary)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-1)'
          }}
          onMouseOver={e => {
            e.currentTarget.style.background = 'var(--color-surface-3)';
            e.currentTarget.style.color = 'var(--color-text-primary)';
          }}
          onMouseOut={e => {
            e.currentTarget.style.background = 'var(--color-surface-2)';
            e.currentTarget.style.color = 'var(--color-text-secondary)';
          }}
        >
          ← Projects
        </button>
        <button
          onClick={() => setShowNewAgentModal(true)}
          style={{
            width: '100%',
            height: 'var(--control-height-lg)',
            padding: '0 var(--spacing-4)',
            fontSize: 'var(--font-size-lg)',
            fontWeight: 'var(--font-weight-semibold)',
            background: 'var(--color-accent-primary)',
            color: 'var(--color-text-contrast)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            transition: 'background 0.15s'
          }}
          onMouseOver={e => (e.currentTarget.style.background = 'var(--color-accent-hover)')}
          onMouseOut={e => (e.currentTarget.style.background = 'var(--color-accent-primary)')}
        >
          + New Agent
        </button>
      </div>

      {/* Thread List Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--spacing-2)' }}>
        <div
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)',
            fontWeight: 'var(--font-weight-semibold)',
            textTransform: 'uppercase',
            marginBottom: 'var(--spacing-2)',
            letterSpacing: '0.05em',
            padding: '0 var(--spacing-1)'
          }}
        >
          Active Threads
        </div>

        {loading ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', padding: 'var(--spacing-2)' }}>
            Loading threads...
          </div>
        ) : threads.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', padding: 'var(--spacing-2)' }}>
            No active threads.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
            {threads.map(thread => {
              const isActive = activeThreadId === thread.id;
              return (
                <div
                  key={thread.id}
                  onClick={() => handleSelectThread(thread.id)}
                  style={{
                    padding: 'var(--spacing-2) var(--spacing-3)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontSize: 'var(--font-size-lg)',
                    display: 'flex',
                    alignItems: 'center',
                    background: isActive ? 'var(--color-surface-2)' : 'transparent',
                    color: isActive ? 'var(--color-accent-hover)' : 'var(--color-text-primary)',
                    border: `1px solid ${isActive ? 'var(--color-border-default)' : 'transparent'}`,
                    transition: 'background 0.15s, color 0.15s'
                  }}
                  onMouseOver={e => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'var(--color-surface-1)';
                    }
                  }}
                  onMouseOut={e => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <span style={{ marginRight: 'var(--spacing-2)', opacity: 0.7, fontSize: 'var(--font-size-xs)' }}>🤖</span>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                    {thread.name}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: 'var(--spacing-2) var(--spacing-3)',
          borderTop: '1px solid var(--color-border-subtle)',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-text-muted)'
        }}
      >
        Asterim Session
      </div>

      {showNewAgentModal && (
        <NewAgentModal
          onClose={() => setShowNewAgentModal(false)}
          onSubmit={handleCreateThreadSubmit}
        />
      )}
    </div>
  );
}
