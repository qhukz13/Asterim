import React, { useState } from 'react';

interface NewAgentModalProps {
  onClose: () => void;
  onSubmit: (name: string) => void;
}

export function NewAgentModal({ onClose, onSubmit }: NewAgentModalProps) {
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim());
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box glass-panel"
        style={{ maxWidth: '400px' }}
        onClick={e => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px'
          }}
        >
          <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-text-primary)' }}>
            New Agent Session
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: '1.2rem'
            }}
          >
            ×
          </button>
        </div>

        <p
          style={{
            fontSize: '0.9rem',
            color: 'var(--color-text-secondary)',
            marginBottom: '20px',
            marginTop: 0
          }}
        >
          Enter a name for the new parallel agent session.
        </p>

        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          <input
            type="text"
            placeholder="e.g. Frontend Refactor"
            className="input-box"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            autoFocus
            style={{ width: '100%', padding: '12px' }}
          />
          <div
            style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}
          >
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              style={{
                padding: '10px 16px',
                background: 'transparent',
                border: '1px solid var(--color-border-default)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ padding: '10px 16px' }}
              disabled={!name.trim()}
            >
              Create Agent
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
