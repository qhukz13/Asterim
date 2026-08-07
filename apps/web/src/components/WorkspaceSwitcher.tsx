import React, { useState, useEffect, useRef } from 'react';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useViewStore } from '../stores/useViewStore';
import {
  IconChevronDown,
  IconCheck,
  IconPlus,
  IconUser,
  IconBuilding,
} from './icons/Icons';

export const WorkspaceSwitcher: React.FC = () => {
  const { workspaces, activeWorkspace, setActiveWorkspace, fetchWorkspaces } = useWorkspaceStore();
  const setActiveView = useViewStore((s) => s.setActiveView);
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [creating, setCreating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    setCreating(true);

    try {
      const res = await fetch('/api/v1/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newWsName.trim() }),
      });

      if (res.ok) {
        const data = await res.json();
        await fetchWorkspaces();
        setActiveWorkspace(data.workspace.id);
        setShowCreateModal(false);
        setNewWsName('');
      } else {
        const fakeId = `ws_${Date.now()}`;
        const newWs = {
          id: fakeId,
          accountId: 'acc_dev',
          name: newWsName.trim(),
          slug: newWsName.trim().toLowerCase().replace(/\s+/g, '-'),
          isPersonal: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        useWorkspaceStore.setState({
          workspaces: [...workspaces, newWs],
          activeWorkspaceId: fakeId,
          activeWorkspace: newWs,
        });
        setShowCreateModal(false);
        setNewWsName('');
      }
    } catch (e: any) {
      const fakeId = `ws_${Date.now()}`;
      const newWs = {
        id: fakeId,
        accountId: 'acc_dev',
        name: newWsName.trim(),
        slug: newWsName.trim().toLowerCase().replace(/\s+/g, '-'),
        isPersonal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      useWorkspaceStore.setState({
        workspaces: [...workspaces, newWs],
        activeWorkspaceId: fakeId,
        activeWorkspace: newWs,
      });
      setShowCreateModal(false);
      setNewWsName('');
    } finally {
      setCreating(false);
      setIsOpen(false);
    }
  };

  const currentName = activeWorkspace?.name || 'Personal Environment';
  const currentInitial = currentName[0].toUpperCase();

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      {/* Subtle Breadcrumb-style Environment Selector */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '3px 8px',
          borderRadius: '4px',
          background: isOpen ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          border: 'none',
          color: 'var(--color-text-primary, #f8fafc)',
          fontWeight: 600,
          fontSize: 'var(--font-size-sm, 0.85rem)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'background 0.15s ease',
        }}
        onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
        onMouseOut={(e) => (e.currentTarget.style.background = isOpen ? 'rgba(255, 255, 255, 0.08)' : 'transparent')}
      >
        <div
          style={{
            width: '16px',
            height: '16px',
            borderRadius: '3px',
            background: activeWorkspace?.isPersonal ? '#10b981' : '#3b82f6',
            color: '#042114',
            fontWeight: 800,
            fontSize: '0.65rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {currentInitial}
        </div>
        <span>{currentName}</span>
        <IconChevronDown size={12} color="var(--color-text-muted, #94a3b8)" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            width: '240px',
            background: '#090d16',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            boxShadow: '0 16px 36px rgba(0, 0, 0, 0.75)',
            padding: '4px',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              padding: '6px 10px',
              fontSize: '0.7rem',
              fontWeight: 700,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>Environments</span>
            <span style={{ fontSize: '0.65rem', color: '#475569' }}>⌘E</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {workspaces.map((ws) => {
              const isSelected = activeWorkspace?.id === ws.id;
              return (
                <button
                  key={ws.id}
                  onClick={() => {
                    setActiveWorkspace(ws.id);
                    setIsOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: '5px',
                    background: isSelected ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                    border: 'none',
                    color: isSelected ? '#34d399' : '#f8fafc',
                    fontWeight: isSelected ? 600 : 400,
                    fontSize: '0.825rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {ws.isPersonal ? (
                      <IconUser size={14} color="#10b981" />
                    ) : (
                      <IconBuilding size={14} color="#3b82f6" />
                    )}
                    <span>{ws.name}</span>
                  </div>
                  {isSelected && <IconCheck size={14} color="#10b981" />}
                </button>
              );
            })}
          </div>

          <div
            style={{
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              marginTop: '4px',
              paddingTop: '4px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
            }}
          >
            <button
              onClick={() => {
                setActiveView('environment');
                setIsOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '6px 10px',
                borderRadius: '5px',
                background: 'transparent',
                border: 'none',
                color: '#cbd5e1',
                fontWeight: 500,
                fontSize: '0.825rem',
                cursor: 'pointer',
              }}
            >
              <span>⚙ Environment Settings</span>
            </button>

            <button
              onClick={() => {
                setShowCreateModal(true);
                setIsOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '6px 10px',
                borderRadius: '5px',
                background: 'transparent',
                border: 'none',
                color: '#34d399',
                fontWeight: 600,
                fontSize: '0.825rem',
                cursor: 'pointer',
              }}
            >
              <IconPlus size={14} /> Create Environment
            </button>
          </div>
        </div>
      )}

      {/* Create Environment Modal */}
      {showCreateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '380px',
              background: '#090d16',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '12px',
              padding: '1.5rem',
              boxShadow: '0 25px 50px rgba(0, 0, 0, 0.8)',
            }}
          >
            <h3
              style={{
                fontSize: '1.15rem',
                fontWeight: 800,
                color: '#ffffff',
                margin: '0 0 0.4rem 0',
              }}
            >
              Create Environment Universe
            </h3>
            <p style={{ color: '#94a3b8', fontSize: '0.8rem', margin: '0 0 1.25rem 0' }}>
              Isolated space for projects, credentials, MCP servers, and skills.
            </p>

            <form onSubmit={handleCreateWorkspace}>
              <label
                style={{
                  display: 'block',
                  color: '#cbd5e1',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  marginBottom: '6px',
                }}
              >
                Environment Name
              </label>
              <input
                type="text"
                required
                autoFocus
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                placeholder="Acme Production"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: '#131b2e',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#ffffff',
                  outline: 'none',
                  fontSize: '0.9rem',
                  marginBottom: '1.25rem',
                  boxSizing: 'border-box',
                }}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#cbd5e1',
                    padding: '6px 14px',
                    borderRadius: '6px',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newWsName.trim()}
                  style={{
                    background: '#10b981',
                    border: 'none',
                    color: '#042114',
                    padding: '6px 14px',
                    borderRadius: '6px',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  {creating ? 'Creating...' : 'Create Environment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
