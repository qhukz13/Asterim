import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useViewStore } from '../stores/useViewStore';
import {
  IconChevronDown,
  IconCheck,
  IconPlus,
  IconUser,
  IconBuilding,
  IconSearch,
  IconStar,
} from './icons/Icons';

export const WorkspaceSwitcher: React.FC = () => {
  const { workspaces, activeWorkspace, setActiveWorkspace, fetchWorkspaces, projects } = useWorkspaceStore();
  const setActiveView = useViewStore((s) => s.setActiveView);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('asterim_pinned_env_ids');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('asterim_recent_env_ids');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [newPreset, setNewPreset] = useState<'company' | 'client' | 'experimental' | 'personal'>('company');
  const [creating, setCreating] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  // Save pinned IDs
  const togglePin = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      localStorage.setItem('asterim_pinned_env_ids', JSON.stringify(next));
      return next;
    });
  };

  // Track recent environments
  const handleSelectEnv = (id: string) => {
    setActiveWorkspace(id);
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((item) => item !== id)].slice(0, 5);
      localStorage.setItem('asterim_recent_env_ids', JSON.stringify(next));
      return next;
    });
    setIsOpen(false);
    setSearchQuery('');
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Shortcut ⌘E
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

  // Focus search input on open
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    setCreating(true);

    try {
      const tokenKey = 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/v1/workspaces', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: newWsName.trim(), preset: newPreset }),
      });

      if (res.ok) {
        const data = await res.json();
        const createdEnv = data.workspace || data.environment;
        await fetchWorkspaces();
        if (createdEnv?.id) {
          handleSelectEnv(createdEnv.id);
        }
        setShowCreateModal(false);
        setNewWsName('');
      }
    } catch (e: any) {
      console.error('Failed to create workspace', e);
    } finally {
      setCreating(false);
      setIsOpen(false);
    }
  };

  const getPresetBadgeColor = (ws?: any) => {
    if (!ws) return '#10b981';
    const preset = ws.preset || (ws.isPersonal ? 'personal' : 'company');
    switch (preset) {
      case 'personal': return '#10b981';
      case 'company': return '#3b82f6';
      case 'client': return '#f59e0b';
      case 'experimental': return '#8b5cf6';
      default: return '#10b981';
    }
  };

  // Grouping & Ordering: Pinned, Recent, All
  const { filteredEnvironments, pinnedList, recentList, otherList } = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const filtered = workspaces.filter(
      (w) => w.name.toLowerCase().includes(q) || (w.preset || '').toLowerCase().includes(q)
    );

    const pinned = filtered.filter((w) => pinnedIds.includes(w.id));
    const unpinned = filtered.filter((w) => !pinnedIds.includes(w.id));
    const recent = unpinned.filter((w) => recentIds.includes(w.id));
    const other = unpinned.filter((w) => !recentIds.includes(w.id));

    return {
      filteredEnvironments: [...pinned, ...recent, ...other],
      pinnedList: pinned,
      recentList: recent,
      otherList: other,
    };
  }, [workspaces, searchQuery, pinnedIds, recentIds]);

  // Keyboard navigation handler
  const handleDropdownKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < filteredEnvironments.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredEnvironments[selectedIndex]) {
        handleSelectEnv(filteredEnvironments[selectedIndex].id);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  // Compute attached project count per environment
  const getProjectCount = (envId: string) => {
    return projects.filter((p) => p.workspaceId === envId || p.environmentId === envId).length;
  };

  const currentName = activeWorkspace?.name || 'Personal Environment';
  const currentInitial = currentName[0].toUpperCase();
  const currentBadgeColor = getPresetBadgeColor(activeWorkspace);

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
            background: currentBadgeColor,
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

      {/* OS-Grade Desktop Dropdown Menu */}
      {isOpen && (
        <div
          onKeyDown={handleDropdownKeyDown}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            width: '280px',
            background: '#090d16',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '8px',
            boxShadow: '0 16px 36px rgba(0, 0, 0, 0.85)',
            padding: '6px',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          {/* Header & ⌘E Label */}
          <div
            style={{
              padding: '4px 8px',
              fontSize: '0.7rem',
              fontWeight: 700,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Environments</span>
            <span style={{ fontSize: '0.65rem', color: '#475569', fontFamily: 'monospace' }}>⌘E</span>
          </div>

          {/* Search Field */}
          <div style={{ position: 'relative', marginBottom: '4px' }}>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search environments..."
              style={{
                width: '100%',
                padding: '6px 10px 6px 28px',
                borderRadius: '5px',
                background: '#131b2e',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#ffffff',
                fontSize: '0.8rem',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', opacity: 0.6 }}>
              <IconSearch size={12} color="#94a3b8" />
            </div>
          </div>

          {/* Environment List */}
          <div ref={listRef} style={{ maxHeight: '260px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {filteredEnvironments.length === 0 ? (
              <div style={{ padding: '12px', textAlign: 'center', fontSize: '0.8rem', color: '#64748b' }}>
                No environments found
              </div>
            ) : (
              filteredEnvironments.map((ws, globalIdx) => {
                const isSelected = activeWorkspace?.id === ws.id;
                const isFocused = selectedIndex === globalIdx;
                const isPinned = pinnedIds.includes(ws.id);
                const badgeColor = getPresetBadgeColor(ws);
                const count = getProjectCount(ws.id);
                const presetLabel = ws.preset || (ws.isPersonal ? 'personal' : 'company');

                return (
                  <button
                    key={ws.id}
                    onClick={() => handleSelectEnv(ws.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '5px',
                      background: isFocused
                        ? 'rgba(16, 185, 129, 0.18)'
                        : isSelected
                        ? 'rgba(255, 255, 255, 0.05)'
                        : 'transparent',
                      border: isFocused ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid transparent',
                      color: isSelected ? '#34d399' : '#f8fafc',
                      fontSize: '0.825rem',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.1s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                      {/* Preset Badge */}
                      <div
                        style={{
                          width: '18px',
                          height: '18px',
                          borderRadius: '4px',
                          background: badgeColor,
                          color: '#042114',
                          fontWeight: 800,
                          fontSize: '0.65rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {ws.name[0].toUpperCase()}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <span style={{ fontWeight: isSelected ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {ws.name}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'capitalize' }}>
                          {presetLabel} • {count} {count === 1 ? 'project' : 'projects'}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span
                        onClick={(e) => togglePin(e, ws.id)}
                        title={isPinned ? 'Unpin environment' : 'Pin environment'}
                        style={{ padding: '2px', cursor: 'pointer', opacity: isPinned ? 1 : 0.3 }}
                      >
                        <IconStar size={12} color={isPinned ? '#fbbf24' : '#94a3b8'} />
                      </span>
                      {isSelected && <IconCheck size={14} color="#10b981" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Action Footer */}
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
                setShowCreateModal(true);
                setIsOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '6px 8px',
                borderRadius: '5px',
                background: 'transparent',
                border: 'none',
                color: '#34d399',
                fontWeight: 600,
                fontSize: '0.8rem',
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
              width: '90%',
              maxWidth: '460px',
              background: '#090d16',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '12px',
              padding: '1.5rem',
              boxShadow: '0 25px 50px rgba(0, 0, 0, 0.8)',
              boxSizing: 'border-box',
            }}
          >
            <h3
              style={{
                fontSize: '1.15rem',
                fontWeight: 800,
                color: '#ffffff',
                margin: '0 0 0.4rem 0',
                wordBreak: 'break-word',
              }}
            >
              Create Environment
            </h3>
            <p
              style={{
                color: '#94a3b8',
                fontSize: '0.825rem',
                margin: '0 0 1.25rem 0',
                lineHeight: 1.5,
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
                whiteSpace: 'normal',
                maxWidth: '100%',
              }}
            >
              Isolated space for repositories, credentials, MCP servers, and agent skills.
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
                  padding: '10px 12px',
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
              <label
                style={{
                  display: 'block',
                  color: '#cbd5e1',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  marginBottom: '6px',
                }}
              >
                Environment Preset Type
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '1.25rem' }}>
                {[
                  { id: 'company', label: 'Company', color: '#3b82f6' },
                  { id: 'experimental', label: 'Experimental', color: '#8b5cf6' },
                  { id: 'client', label: 'Client Sandbox', color: '#f59e0b' },
                  { id: 'personal', label: 'Personal', color: '#10b981' },
                ].map((p) => {
                  const selected = newPreset === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setNewPreset(p.id as any)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        background: selected ? 'rgba(255, 255, 255, 0.08)' : '#131b2e',
                        border: `1px solid ${selected ? p.color : 'rgba(255, 255, 255, 0.12)'}`,
                        color: selected ? p.color : '#cbd5e1',
                        fontWeight: selected ? 700 : 500,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        textAlign: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                      }}
                    >
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: p.color }} />
                      <span>{p.label}</span>
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#cbd5e1',
                    padding: '8px 16px',
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
                    padding: '8px 16px',
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
