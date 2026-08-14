import React, { useState, useEffect } from 'react';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';

interface AddProjectModalProps {
  activeBackendUrl?: string;
  onClose: () => void;
  onSuccess: (project: any) => void;
}

export function AddProjectModal({ activeBackendUrl, onClose, onSuccess }: AddProjectModalProps) {
  const activeEnvironment = useWorkspaceStore((s) => s.activeEnvironment);
  const activeEnvironmentId = useWorkspaceStore((s) => s.activeEnvironmentId) || 'personal';

  const [activeTab, setActiveTab] = useState<'existing' | 'new'>('existing');
  const [existingProjects, setExistingProjects] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [modalSearchQuery, setModalSearchQuery] = useState('');

  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const baseUrl =
    activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;

  const envName = activeEnvironment?.name || 'Personal Environment';

  const fetchAllProjects = async () => {
    try {
      setLoadingExisting(true);
      const res = await fetch(`${baseUrl}/api/v1/projects`);
      if (res.ok) {
        const data = await res.json();
        setExistingProjects(data.projects || []);
      }
    } catch {
      // The request failed; the finally block below clears the pending flag.
    } finally {
      setLoadingExisting(false);
    }
  };

  useEffect(() => {
    fetchAllProjects();
  }, [baseUrl]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchAttach = async () => {
    if (selectedIds.size === 0) return;
    try {
      setIsSubmitting(true);
      const res = await fetch(`${baseUrl}/api/v1/environments/${activeEnvironmentId}/attach-projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds: Array.from(selectedIds) }),
      });
      if (res.ok) {
        useWorkspaceStore.getState().fetchWorkspaces();
        setSelectedIds(new Set());
        onSuccess(null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPath.trim()) return;

    try {
      setIsSubmitting(true);
      const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';

      const res = await fetch(`${baseUrl}/api/v1/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newName.trim(),
          path: newPath.trim(),
          workspaceId: activeEnvironmentId,
        }),
      });
      if (res.status === 401) {
        localStorage.removeItem(tokenKey);
        window.location.reload();
        return;
      }
      const data = await res.json();
      if (data.project) {
        useWorkspaceStore.getState().fetchWorkspaces();
        onSuccess(data.project);
      }
    } catch (err) {
      console.error('Failed to create project', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box glass-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '520px', width: '92%', padding: '1.5rem', borderRadius: '12px' }}
      >
        <h3
          style={{
            margin: '0 0 4px 0',
            fontSize: '1.2rem',
            fontWeight: 800,
            color: 'var(--color-text-primary, #ffffff)',
          }}
        >
          Manage Projects for {envName}
        </h3>
        <p style={{ color: '#94a3b8', fontSize: '0.8rem', margin: '0 0 1.25rem 0' }}>
          Select multiple projects to attach to this Environment or add a new local folder.
        </p>

        {/* Modal Tabs */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            marginBottom: '1.25rem',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('existing')}
            style={{
              padding: '8px 14px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'existing' ? '2px solid #10b981' : '2px solid transparent',
              color: activeTab === 'existing' ? '#34d399' : '#94a3b8',
              fontWeight: activeTab === 'existing' ? 700 : 500,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            Attach Repositories ({existingProjects.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('new')}
            style={{
              padding: '8px 14px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'new' ? '2px solid #10b981' : '2px solid transparent',
              color: activeTab === 'new' ? '#34d399' : '#94a3b8',
              fontWeight: activeTab === 'new' ? 700 : 500,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            + Add New Folder
          </button>
        </div>

        {/* Tab 1: Multi-Select Existing Repositories */}
        {activeTab === 'existing' && (() => {
          const q = modalSearchQuery.toLowerCase().trim();
          const filtered = existingProjects.filter(
            (p) => p.name.toLowerCase().includes(q) || (p.path || '').toLowerCase().includes(q)
          );

          return (
            <div>
              {/* Search Filter Bar */}
              <div style={{ marginBottom: '10px' }}>
                <input
                  type="text"
                  value={modalSearchQuery}
                  onChange={(e) => setModalSearchQuery(e.target.value)}
                  placeholder="Filter local repositories..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: '#131b2e',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#ffffff',
                    fontSize: '0.85rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  maxHeight: '260px',
                  overflowY: 'auto',
                  marginBottom: '1.25rem',
                }}
              >
                {loadingExisting ? (
                  <div style={{ color: '#94a3b8', fontSize: '0.85rem', padding: '1rem', textAlign: 'center' }}>
                    Scanning local repositories...
                  </div>
                ) : filtered.length === 0 ? (
                  <div style={{ color: '#94a3b8', fontSize: '0.85rem', padding: '1.5rem', textAlign: 'center' }}>
                    {modalSearchQuery ? 'No matching repositories found.' : 'No local projects found. Switch to "+ Add New Folder" to import one.'}
                  </div>
                ) : (
                  filtered.map((p) => {
                    const isChecked = selectedIds.has(p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={() => toggleSelect(p.id)}
                        style={{
                          padding: '10px 14px',
                          background: isChecked ? 'rgba(16, 185, 129, 0.12)' : '#131b2e',
                          borderRadius: '8px',
                          border: `1px solid ${isChecked ? '#10b981' : 'rgba(255, 255, 255, 0.08)'}`,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#10b981' }}
                        />
                        <div style={{ overflow: 'hidden', flex: 1 }}>
                          <div
                            style={{
                              color: '#ffffff',
                              fontWeight: 700,
                              fontSize: '0.9rem',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {p.name}
                          </div>
                          <div
                            style={{
                              color: '#64748b',
                              fontSize: '0.78rem',
                              fontFamily: 'monospace',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {p.path}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={onClose}
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
                  Done / Close
                </button>
                <button
                  type="button"
                  disabled={isSubmitting || selectedIds.size === 0}
                  onClick={handleBatchAttach}
                  style={{
                    background: selectedIds.size > 0 ? '#10b981' : '#334155',
                    border: 'none',
                    color: selectedIds.size > 0 ? '#042114' : '#94a3b8',
                    padding: '8px 18px',
                    borderRadius: '6px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
                  }}
                >
                  {isSubmitting
                    ? 'Attaching...'
                    : `Attach Selected Projects (${selectedIds.size})`}
                </button>
              </div>
            </div>
          );
        })()}

        {/* Tab 2: Create New Folder */}
        {activeTab === 'new' && (
          <form onSubmit={handleCreateNew} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 600 }}>
                Project Name
              </label>
              <input
                type="text"
                placeholder="e.g. Asterim Service"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                autoFocus
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  background: '#131b2e',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#ffffff',
                  outline: 'none',
                  fontSize: '0.9rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 600 }}>
                Absolute Folder Path
              </label>
              <input
                type="text"
                placeholder="e.g. /home/user/code/my-project"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  background: '#131b2e',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#ffffff',
                  outline: 'none',
                  fontSize: '0.9rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={onClose}
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
                disabled={isSubmitting || !newName.trim() || !newPath.trim()}
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
                {isSubmitting ? 'Adding...' : 'Add & Attach Project'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

