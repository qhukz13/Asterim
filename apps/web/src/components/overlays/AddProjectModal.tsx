import React, { useState } from 'react';

interface AddProjectModalProps {
  activeBackendUrl?: string;
  onClose: () => void;
  onSuccess: (project: any) => void;
}

export function AddProjectModal({ activeBackendUrl, onClose, onSuccess }: AddProjectModalProps) {
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const baseUrl = activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newPath) return;

    try {
      setIsCreating(true);
      const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';
      
      const res = await fetch(`${baseUrl}/api/v1/projects`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ name: newName, path: newPath })
      });
      if (res.status === 401) {
        localStorage.removeItem(tokenKey);
        window.location.reload();
        return;
      }
      const data = await res.json();
      if (data.project) {
        onSuccess(data.project);
      }
    } catch (err) {
      console.error('Failed to create project', err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-box glass-panel" onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: 0, marginBottom: '24px', fontSize: '1.2rem', color: 'var(--color-text-primary)' }}>Add New Project</h3>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>Project Name</label>
            <input 
              type="text" 
              placeholder="e.g. NextJS App" 
              className="input-box" 
              value={newName}
              onChange={e => setNewName(e.target.value)}
              required
              style={{ width: '100%', padding: '12px' }}
              autoFocus
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>Absolute Path</label>
            <input 
              type="text" 
              placeholder="e.g. C:\Projects\MyApp" 
              className="input-box" 
              value={newPath}
              onChange={e => setNewPath(e.target.value)}
              required
              style={{ width: '100%', padding: '12px' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
            <button type="button" className="btn-secondary" onClick={onClose} style={{ flex: 1, padding: '12px', background: 'transparent', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)' }}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" style={{ flex: 1, padding: '12px' }} disabled={isCreating}>
              {isCreating ? 'Adding...' : 'Add Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
