import React, { useState } from 'react';
import type { ContextEntry } from '@asterim/shared';
import { IconFileCode } from '../icons/Icons';
import { useThreadContext } from '../../hooks/useThreadContext';

interface ContextViewProps {
  projectId: string;
  threadId: string | null;
  activeBackendUrl?: string;
  socket: any;
  messages?: any[];
}

export function ContextView({
  projectId,
  threadId,
  activeBackendUrl,
  socket
}: ContextViewProps) {
  const {
    entries: contextEntries,
    isLoading: contextLoading,
    error: contextError,
    addEntry: onAddEntry,
    removeEntry: onRemoveEntry
  } = useThreadContext({
    socket,
    threadId,
    projectId,
    activeBackendUrl
  });

  const [addingError, setAddingError] = useState<string | null>(null);

  const handleRemoveContext = async (entry: ContextEntry) => {
    try {
      setAddingError(null);
      if (entry.id) {
        await onRemoveEntry(entry.id);
      }
    } catch (err: any) {
      setAddingError(err.message || 'Failed to remove context file');
    }
  };

  const displayError = contextError || addingError;
  const fileEntries = contextEntries.filter(e => e.entryType === 'file' || e.path);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px', boxSizing: 'border-box' }}>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Active Context Files ({contextEntries.length})
      </div>

      {displayError && (
        <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error-color)', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '8px' }}>
          {displayError}
        </div>
      )}

      {contextLoading && (
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic', padding: '8px', textAlign: 'center' }}>
          Loading context...
        </div>
      )}

      {!contextLoading && fileEntries.length === 0 && (
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic', padding: '8px', textAlign: 'center' }}>
          No files pinned yet.
        </div>
      )}

      {fileEntries.map((entry) => {
        const displayPath = entry.path || entry.label || 'Unknown';
        const parts = displayPath.split('/');
        const filename = parts.pop();
        const folder = parts.length > 0 ? parts.join('/') + '/' : '';
        return (
          <div key={entry.id || entry.path} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px', marginBottom: '4px' }}>
            <IconFileCode size={14} color="var(--text-secondary)" />
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
              <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{filename}</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{folder}</span>
            </div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              {entry.status === 'pinned' && <span style={{ fontSize: '0.7rem', color: '#60a5fa', padding: '2px 4px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '4px' }}>Pinned</span>}
              {entry.status === 'active' && <span style={{ fontSize: '0.7rem', color: 'var(--warning-color)', padding: '2px 4px', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '4px' }}>Active</span>}
              <button onClick={() => handleRemoveContext(entry)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px 4px' }}>×</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
