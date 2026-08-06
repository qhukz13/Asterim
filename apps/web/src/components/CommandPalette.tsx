import React, { useEffect, useRef, useState } from 'react';
import { useCommandPaletteStore } from '../stores/useCommandPaletteStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useProjectStore } from '../stores/useProjectStore';
import { useThreadStore } from '../stores/useThreadStore';
import { useViewStore } from '../stores/useViewStore';
import { usePanelStore } from '../stores/usePanelStore';
import { useLocation } from 'wouter';
import { IconCommand } from './icons/Icons';

interface Action {
  id: string;
  category: 'Views' | 'Projects' | 'Threads' | 'Actions';
  name: string;
  shortcut?: string;
  perform: () => void;
}

export function CommandPalette() {
  const isOpen = useCommandPaletteStore(s => s.isOpen);
  const setIsOpen = useCommandPaletteStore(s => s.setIsOpen);
  const toggle = useCommandPaletteStore(s => s.toggle);
  const searchQuery = useCommandPaletteStore(s => s.searchQuery);
  const setSearchQuery = useCommandPaletteStore(s => s.setSearchQuery);

  const projects = useWorkspaceStore(s => s.projects);
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const threads = useProjectStore(s => s.threads);
  const setActiveView = useViewStore(s => s.setActiveView);
  const togglePanel = usePanelStore(s => s.togglePanel);
  const [, setLocation] = useLocation();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build dynamic actions list
  const actions: Action[] = [];

  // Views Navigation Actions
  const activeThreadId = useThreadStore.getState().activeThreadId;
  const navigateToView = (view: 'chat' | 'terminal' | 'changes' | 'settings') => {
    setActiveView(view);
    if (activeProjectId && activeThreadId) {
      setLocation(`/workspace/project/${activeProjectId}/thread/${activeThreadId}/view/${view}`);
    } else if (activeProjectId) {
      setLocation(`/workspace/project/${activeProjectId}/view/${view}`);
    }
  };

  actions.push(
    {
      id: 'view-chat',
      category: 'Views',
      name: 'Jump to Chat View',
      shortcut: '⌘1',
      perform: () => navigateToView('chat')
    },
    {
      id: 'view-terminal',
      category: 'Views',
      name: 'Jump to Terminal View',
      shortcut: '⌘2',
      perform: () => navigateToView('terminal')
    },
    {
      id: 'view-changes',
      category: 'Views',
      name: 'Jump to Changes View',
      shortcut: '⌘3',
      perform: () => navigateToView('changes')
    },
    {
      id: 'view-settings',
      category: 'Views',
      name: 'Jump to Settings View',
      shortcut: '⌘4',
      perform: () => navigateToView('settings')
    }
  );

  // Project Actions
  projects.forEach(p => {
    actions.push({
      id: `project-${p.id}`,
      category: 'Projects',
      name: `Open Project: ${p.name}`,
      perform: () => {
        setLocation(`/workspace/project/${p.id}`);
      }
    });
  });

  // Thread Actions
  threads.forEach(t => {
    actions.push({
      id: `thread-${t.id}`,
      category: 'Threads',
      name: `Switch Thread: ${t.name}`,
      perform: () => {
        if (activeProjectId) {
          setLocation(`/workspace/project/${activeProjectId}/thread/${t.id}/view/chat`);
        }
      }
    });
  });

  // Panel Toggles
  actions.push(
    {
      id: 'toggle-left-sidebar',
      category: 'Actions',
      name: 'Toggle Navigation Sidebar',
      shortcut: '⌘B',
      perform: () => togglePanel('left')
    },
    {
      id: 'toggle-center-sidebar',
      category: 'Actions',
      name: 'Toggle Threads Sidebar',
      perform: () => togglePanel('center')
    },
    {
      id: 'toggle-inspector',
      category: 'Actions',
      name: 'Toggle Inspector Panel',
      shortcut: '⌘I',
      perform: () => togglePanel('inspector')
    }
  );

  // Filter actions based on query
  const filteredActions = actions.filter(
    a =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '1') {
        e.preventDefault();
        navigateToView('chat');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '2') {
        e.preventDefault();
        navigateToView('terminal');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '3') {
        e.preventDefault();
        navigateToView('changes');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '4') {
        e.preventDefault();
        navigateToView('settings');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        togglePanel('left');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault();
        togglePanel('inspector');
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, toggle, activeProjectId, activeThreadId]);

  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % Math.max(1, filteredActions.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredActions.length) % Math.max(1, filteredActions.length));
    } else if (e.key === 'Enter' && filteredActions[selectedIndex]) {
      e.preventDefault();
      filteredActions[selectedIndex].perform();
      setIsOpen(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="dialog-overlay"
      style={{
        zIndex: 2000,
        alignItems: 'flex-start',
        paddingTop: '12vh',
        background: 'rgba(9, 10, 15, 0.75)',
        backdropFilter: 'blur(4px)'
      }}
      onClick={() => setIsOpen(false)}
    >
      <div
        className="glass-panel"
        style={{
          width: '560px',
          padding: 0,
          overflow: 'hidden',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-border-default)',
          animation: 'modalPopIn 180ms var(--ease-out-cubic) forwards'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search Header Input */}
        <div
          style={{
            padding: 'var(--spacing-3) var(--spacing-4)',
            borderBottom: '1px solid var(--color-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-3)'
          }}
        >
          <IconCommand size={16} color="var(--color-text-muted)" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or search actions..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-primary)',
              fontSize: 'var(--font-size-md)',
              fontFamily: 'var(--font-family-sans)',
              outline: 'none'
            }}
          />
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              fontFamily: 'var(--font-family-mono)',
              color: 'var(--color-text-muted)',
              background: 'var(--color-surface-2)',
              padding: '2px 6px',
              borderRadius: 'var(--radius-xs)',
              border: '1px solid var(--color-border-subtle)'
            }}
          >
            ESC
          </span>
        </div>

        {/* Filtered Action List */}
        <div style={{ maxHeight: '360px', overflowY: 'auto', padding: 'var(--spacing-2)' }}>
          {filteredActions.map((action, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={action.id}
                onClick={() => {
                  action.perform();
                  setIsOpen(false);
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                style={{
                  padding: 'var(--spacing-2) var(--spacing-3)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderRadius: 'var(--radius-sm)',
                  background: isSelected ? 'var(--color-surface-2)' : 'transparent',
                  border: `1px solid ${isSelected ? 'var(--color-border-default)' : 'transparent'}`,
                  transition: 'background 0.1s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
                  <span
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      width: '60px'
                    }}
                  >
                    {action.category}
                  </span>
                  <span
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: isSelected ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)',
                      color: isSelected ? 'var(--color-accent-hover)' : 'var(--color-text-primary)'
                    }}
                  >
                    {action.name}
                  </span>
                </div>

                {action.shortcut && (
                  <span
                    style={{
                      fontFamily: 'var(--font-family-mono)',
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-muted)',
                      background: 'var(--color-surface-0)',
                      padding: '1px 5px',
                      borderRadius: 'var(--radius-xs)',
                      border: '1px solid var(--color-border-subtle)'
                    }}
                  >
                    {action.shortcut}
                  </span>
                )}
              </div>
            );
          })}

          {filteredActions.length === 0 && (
            <div
              style={{
                padding: 'var(--spacing-4)',
                color: 'var(--color-text-muted)',
                fontSize: 'var(--font-size-sm)',
                textAlign: 'center'
              }}
            >
              No matching commands or projects found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
