import React from 'react';
import { Project } from '../hooks/useProjects';

interface NavigationSidebarProps {
  projects: Project[];
  activeProjectId?: string;
  onSelectProject: (p: Project) => void;
  onAddProject: () => void;
}

export function NavigationSidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onAddProject
}: NavigationSidebarProps) {
  return (
    <aside className="workspace-navigation-sidebar">
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
              onClick={() => onSelectProject(p)}
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
