import React from 'react';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useProjectStore } from '../stores/useProjectStore';
import { useDebugLifecycle } from '../utils/debug';
import { usePanelStore } from '../stores/usePanelStore';
import { useLocation } from 'wouter';

interface NavigationSidebarProps {
  onAddProject: () => void;
}

export function NavigationSidebar({ onAddProject }: NavigationSidebarProps) {
  const projects = useWorkspaceStore(s => s.projects);
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const [, setLocation] = useLocation();

  useDebugLifecycle('NavigationSidebar', { activeProjectId });

  const isCollapsed = usePanelStore(s => s.isLeftSidebarCollapsed);
  const width = usePanelStore(s => s.leftSidebarWidth);
  const setWidth = usePanelStore(s => s.setPanelWidth);

  const handleDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(160, Math.min(360, startWidth + delta));
      setWidth('left', newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  if (isCollapsed) return null;

  return (
    <aside className="workspace-navigation-sidebar" style={{ width: `${width}px`, position: 'relative' }}>
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
          zIndex: varIndex('dropdown'),
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
        <h3
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)',
            fontWeight: 'var(--font-weight-semibold)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            margin: 0
          }}
        >
          Projects
        </h3>
        <button
          onClick={onAddProject}
          title="Add New Project"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-accent-primary)',
            cursor: 'pointer',
            fontSize: 'var(--font-size-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '20px',
            height: '20px',
            borderRadius: 'var(--radius-sm)'
          }}
          onMouseOver={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
          onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
        >
          +
        </button>
      </div>

      {/* Project List Container */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--spacing-2)' }}>
        {projects.length === 0 ? (
          <div
            style={{
              padding: 'var(--spacing-4)',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--font-size-xs)',
              textAlign: 'center'
            }}
          >
            No projects found.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
            {projects.map(p => {
              const isActive = activeProjectId === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => setLocation(`/workspace/project/${p.id}`)}
                  style={{
                    padding: 'var(--spacing-2) var(--spacing-3)',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)',
                    background: isActive ? 'var(--color-surface-2)' : 'transparent',
                    border: `1px solid ${isActive ? 'var(--color-border-default)' : 'transparent'}`,
                    transition: 'background 0.15s, border-color 0.15s'
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
                  <div
                    style={{
                      fontSize: 'var(--font-size-lg)',
                      fontWeight: isActive ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)',
                      color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                      lineHeight: '1.35'
                    }}
                  >
                    {p.name}
                  </div>
                  <div
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-muted)',
                      fontFamily: 'var(--font-family-mono)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      marginTop: '3px'
                    }}
                  >
                    {p.path}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function varIndex(key: 'dropdown' | 'sticky' | 'overlay'): number {
  if (key === 'dropdown') return 100;
  if (key === 'sticky') return 200;
  return 1000;
}
