import React, { useState, useMemo, useEffect } from 'react';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useProjectStore } from '../stores/useProjectStore';
import { useDebugLifecycle } from '../utils/debug';
import { usePanelStore } from '../stores/usePanelStore';
import { useLocation } from 'wouter';
import { IconPlus, IconFolder, IconSearch, IconStar } from './icons/Icons';

interface NavigationSidebarProps {
  onAddProject: () => void;
}

export function NavigationSidebar({ onAddProject }: NavigationSidebarProps) {
  const projects = useWorkspaceStore((s) => s.projects);
  const activeEnvironmentId = useWorkspaceStore((s) => s.activeEnvironmentId) || 'personal';
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const [, setLocation] = useLocation();

  const [searchQuery, setSearchQuery] = useState('');
  const [isCompact, setIsCompact] = useState<boolean>(() => {
    return localStorage.getItem('asterim_sidebar_compact') === 'true';
  });

  // Environment-scoped pinning preference model
  const storageKey = `asterim_env_${activeEnvironmentId}_pinned_projects`;
  const [pinnedProjectIds, setPinnedProjectIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      setPinnedProjectIds(saved ? JSON.parse(saved) : []);
    } catch {
      setPinnedProjectIds([]);
    }
  }, [activeEnvironmentId, storageKey]);

  const togglePinProject = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    setPinnedProjectIds((prev) => {
      const next = prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId];
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };

  const toggleCompact = () => {
    setIsCompact((prev) => {
      const next = !prev;
      localStorage.setItem('asterim_sidebar_compact', String(next));
      return next;
    });
  };

  useDebugLifecycle('NavigationSidebar', { activeProjectId });

  const isCollapsed = usePanelStore((s) => s.isLeftSidebarCollapsed);
  const width = usePanelStore((s) => s.leftSidebarWidth);
  const setWidth = usePanelStore((s) => s.setPanelWidth);

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

  const { filteredProjects, pinnedProjects, unpinnedProjects } = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const filtered = projects.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.path || '').toLowerCase().includes(q)
    );
    const pinned = filtered.filter((p) => pinnedProjectIds.includes(p.id));
    const unpinned = filtered.filter((p) => !pinnedProjectIds.includes(p.id));

    return { filteredProjects: filtered, pinnedProjects: pinned, unpinnedProjects: unpinned };
  }, [projects, searchQuery, pinnedProjectIds]);

  if (isCollapsed) return null;

  return (
    <aside className="workspace-navigation-sidebar" style={{ width: `${width}px`, position: 'relative', display: 'flex', flexDirection: 'column' }}>
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
          background: 'transparent',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-border-subtle)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      />

      {/* Header */}
      <div
        style={{
          padding: 'var(--spacing-2) var(--spacing-3)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--color-border-subtle)',
          height: 'var(--nav-height)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <h3
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-muted)',
              fontWeight: 'var(--font-weight-semibold)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              margin: 0,
            }}
          >
            Projects ({projects.length})
          </h3>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {/* Compact Toggle */}
          <button
            onClick={toggleCompact}
            title={isCompact ? 'Standard Density View' : 'Compact Dense View'}
            style={{
              background: isCompact ? 'var(--color-surface-2)' : 'transparent',
              border: 'none',
              color: 'var(--color-text-muted)',
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 5px',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            {isCompact ? 'DENSE' : 'STD'}
          </button>

          {/* Add Project Button */}
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
              borderRadius: 'var(--radius-sm)',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = 'var(--color-surface-2)')}
            onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <IconPlus size={14} color="var(--color-accent-primary)" />
          </button>
        </div>
      </div>

      {/* Real-Time Sidebar Search Bar */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border-subtle)' }}>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter projects..."
            style={{
              width: '100%',
              padding: '4px 8px 4px 24px',
              borderRadius: '4px',
              background: 'var(--color-surface-1, #0c111d)',
              border: '1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))',
              color: 'var(--color-text-primary, #ffffff)',
              fontSize: '11px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ position: 'absolute', left: '6px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>
            <IconSearch size={10} color="var(--color-text-muted)" />
          </div>
        </div>
      </div>

      {/* Project List Container */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {filteredProjects.length === 0 ? (
          <div
            style={{
              padding: 'var(--spacing-4)',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--font-size-xs)',
              textAlign: 'center',
            }}
          >
            {searchQuery ? 'No matching projects.' : 'No projects attached.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: isCompact ? '2px' : '4px' }}>
            {/* Pinned Section */}
            {pinnedProjects.length > 0 && (
              <div style={{ marginBottom: '4px' }}>
                <div
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    color: '#fbbf24',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    padding: '2px 4px',
                    marginBottom: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <IconStar size={10} color="#fbbf24" /> Pinned
                </div>
                {pinnedProjects.map((p) => renderProjectRow(p, true))}
              </div>
            )}

            {/* All / Unpinned Section */}
            {unpinnedProjects.length > 0 && (
              <div>
                {pinnedProjects.length > 0 && (
                  <div
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      color: 'var(--color-text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      padding: '2px 4px',
                      marginBottom: '2px',
                    }}
                  >
                    All Repositories
                  </div>
                )}
                {unpinnedProjects.map((p) => renderProjectRow(p, false))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );

  function renderProjectRow(p: any, isPinned: boolean) {
    const isActive = activeProjectId === p.id;
    return (
      <div
        key={p.id}
        onClick={() => setLocation(`/workspace/project/${p.id}`)}
        style={{
          padding: isCompact ? '4px 6px' : '6px 8px',
          cursor: 'pointer',
          borderRadius: 'var(--radius-sm)',
          background: isActive ? 'var(--color-surface-2)' : 'transparent',
          border: `1px solid ${isActive ? 'var(--color-border-default)' : 'transparent'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          transition: 'background 0.15s, border-color 0.15s',
        }}
        onMouseOver={(e) => {
          if (!isActive) {
            e.currentTarget.style.background = 'var(--color-surface-1)';
          }
        }}
        onMouseOut={(e) => {
          if (!isActive) {
            e.currentTarget.style.background = 'transparent';
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', flex: 1 }}>
          <IconFolder size={isCompact ? 12 : 14} color={isActive ? '#34d399' : '#94a3b8'} />
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div
              style={{
                fontSize: isCompact ? '12px' : '13px',
                fontWeight: isActive ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)',
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                lineHeight: '1.2',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {p.name}
            </div>
            {!isCompact && (
              <div
                style={{
                  fontSize: '10px',
                  color: 'var(--color-text-muted)',
                  fontFamily: 'var(--font-family-mono)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginTop: '1px',
                }}
              >
                {p.path}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={(e) => togglePinProject(e, p.id)}
          title={isPinned ? 'Unpin from this Environment' : 'Pin in this Environment'}
          style={{
            background: 'none',
            border: 'none',
            padding: '2px',
            cursor: 'pointer',
            opacity: isPinned ? 1 : 0.2,
            transition: 'opacity 0.15s ease',
          }}
          onMouseOver={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseOut={(e) => (e.currentTarget.style.opacity = isPinned ? '1' : '0.2')}
        >
          <IconStar size={12} color={isPinned ? '#fbbf24' : '#94a3b8'} />
        </button>
      </div>
    );
  }
}

function varIndex(key: 'dropdown' | 'sticky' | 'overlay'): number {
  if (key === 'dropdown') return 100;
  if (key === 'sticky') return 200;
  return 1000;
}
