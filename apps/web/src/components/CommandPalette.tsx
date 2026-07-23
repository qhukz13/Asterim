import React, { useEffect, useRef } from 'react';
import { useCommandPaletteStore } from '../stores/useCommandPaletteStore';

interface Action {
  id: string;
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

  const inputRef = useRef<HTMLInputElement>(null);

  // Global keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, toggle, setIsOpen]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    } else if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen, setSearchQuery]);

  if (!isOpen) return null;

  // Placeholder actions representing Global and Workspace scopes
  const actions: Action[] = [
    { id: '1', name: 'Open Settings', shortcut: '⌘,', perform: () => setIsOpen(false) },
    { id: '2', name: 'New Project', perform: () => setIsOpen(false) },
    { id: '3', name: 'Toggle Inspector', perform: () => setIsOpen(false) },
  ];

  const filteredActions = actions.filter(a => a.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div 
      className="dialog-overlay"
      style={{ zIndex: 9999, alignItems: 'flex-start', paddingTop: '10vh' }}
      onClick={() => setIsOpen(false)}
    >
      <div 
        className="dialog-box glass-panel" 
        style={{ width: '600px', padding: '0', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or search..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '1.2rem',
              outline: 'none'
            }}
          />
        </div>
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          {filteredActions.map((action, idx) => (
            <div
              key={action.id}
              onClick={action.perform}
              style={{
                padding: '12px 16px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                borderBottom: '1px solid rgba(255,255,255,0.02)',
                background: idx === 0 ? 'rgba(59, 130, 246, 0.2)' : 'transparent', // basic highlighting
                color: idx === 0 ? '#60a5fa' : 'var(--text-primary)'
              }}
              onMouseOver={e => {
                e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                e.currentTarget.style.color = '#60a5fa';
              }}
              onMouseOut={e => {
                e.currentTarget.style.background = idx === 0 ? 'rgba(59, 130, 246, 0.2)' : 'transparent';
                e.currentTarget.style.color = idx === 0 ? '#60a5fa' : 'var(--text-primary)';
              }}
            >
              <span>{action.name}</span>
              {action.shortcut && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{action.shortcut}</span>}
            </div>
          ))}
          {filteredActions.length === 0 && (
            <div style={{ padding: '16px', color: 'var(--text-muted)', textAlign: 'center' }}>
              No commands found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
