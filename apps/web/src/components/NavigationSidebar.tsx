import React from 'react';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useProjectStore } from '../stores/useProjectStore';
import { useDebugLifecycle } from '../utils/debug';
import { usePanelStore } from '../stores/usePanelStore';

interface NavigationSidebarProps {
  onAddProject: () => void;
}

export function NavigationSidebar({
  onAddProject
}: NavigationSidebarProps) {
  const projects = useWorkspaceStore(s => s.projects);
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const setActiveProject = useProjectStore(s => s.setActiveProject);
  
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
      const newWidth = Math.max(150, Math.min(400, startWidth + delta));
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
      <div 
        onMouseDown={handleDrag}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: '4px',
          cursor: 'col-resize',
          zIndex: 10,
          background: 'transparent'
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      />
      <div
        style={{
          padding: 'var(--spacing-4)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <h3
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            margin: 0
          }}
        >
          Projects
        </h3>
        <button
          onClick={onAddProject}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-accent-primary)',
            cursor: 'pointer',
            fontSize: '1.2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            borderRadius: 'var(--radius-sm)'
          }}
          onMouseOver={e => (e.currentTarget.style.background = 'var(--color-accent-transparent)')}
          onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
        >
          +
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {projects.length === 0 ? (
          <div
            style={{
              padding: 'var(--spacing-4)',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--font-size-sm)',
              textAlign: 'center'
            }}
          >
            No projects found.
          </div>
        ) : (
          projects.map(p => (
            <div
              key={p.id}
              onClick={() => setActiveProject(p.id)}
              style={{
                padding: 'var(--spacing-3) var(--spacing-4)',
                cursor: 'pointer',
                background:
                  activeProjectId === p.id ? 'var(--color-bg-glass-hover)' : 'transparent',
                borderLeft:
                  activeProjectId === p.id
                    ? '3px solid var(--color-accent-primary)'
                    : '3px solid transparent',
                transition: 'background 0.2s'
              }}
              onMouseOver={e => {
                if (activeProjectId !== p.id)
                  e.currentTarget.style.background = 'var(--color-bg-glass)';
              }}
              onMouseOut={e => {
                if (activeProjectId !== p.id) e.currentTarget.style.background = 'transparent';
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  color:
                    activeProjectId === p.id
                      ? 'var(--color-text-primary)'
                      : 'var(--color-text-secondary)',
                  marginBottom: '4px'
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
                  textOverflow: 'ellipsis'
                }}
              >
                {p.path}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
