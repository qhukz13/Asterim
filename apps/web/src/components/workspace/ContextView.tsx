import React, { useState } from 'react';
import type { ContextEntry } from '@asterim/shared';
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
  socket,
  messages = []
}: ContextViewProps) {
  const {
    entries: contextEntries,
    isLoading: contextLoading,
    error: contextError,
    addEntry: onAddEntry,
    removeEntry: onRemoveEntry,
    clearEntries: onClearEntries
  } = useThreadContext({
    socket,
    threadId,
    projectId,
    activeBackendUrl
  });
  
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [missionInput, setMissionInput] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const displayError = contextError || localError;

  const handleSuggestFiles = async () => {
    if (!missionInput.trim()) return;
    setIsSuggesting(true);
    setLocalError(null);
    try {
      const baseUrl = activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;
      const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';
      
      const res = await fetch(`${baseUrl}/api/v1/ai/suggest-files`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ projectId, task: missionInput })
      });
      const data = await res.json();
      if (res.ok) {
        setSuggestions(data.suggestions || []);
      } else {
        setLocalError(data.error || 'Failed to suggest files');
      }
    } catch (err: any) {
      setLocalError(err.message || 'Failed to suggest files');
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleExtractMission = async () => {
    if (messages.length === 0) {
      setLocalError('No chat history available to extract a mission from.');
      return;
    }
    
    setIsExtracting(true);
    setLocalError(null);
    try {
      const baseUrl = activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;
      const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';
      
      const res = await fetch(`${baseUrl}/api/v1/ai/extract-mission`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ projectId, history: messages.slice(-10) })
      });
      const data = await res.json();
      if (res.ok && data.mission) {
        setMissionInput(data.mission);
      } else {
        setLocalError(data.error || 'Failed to extract mission');
      }
    } catch (err: any) {
      setLocalError(err.message || 'Failed to extract mission');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleAddContext = async (file: string) => {
    await onAddEntry({ entryType: 'file', path: file, createdBy: 'ai' });
    setSuggestions(prev => prev.filter(s => s !== file));
  };

  const handleRemoveContext = async (entryId: string) => {
    await onRemoveEntry(entryId);
  };

  // Derive file entries from the full context
  const fileEntries = contextEntries.filter(e => e.entryType === 'file');

  return (
    <div style={{ padding: '0', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {displayError && (
        <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error-color)', borderRadius: '6px', fontSize: '0.85rem' }}>
          {displayError}
        </div>
      )}

      {suggestions.length > 0 && (
        <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: '0.75rem', color: '#60a5fa', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 8px' }}>AI Suggestions</div>
          {suggestions.map(file => (
            <div key={file} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 8px', borderRadius: '4px', fontSize: '0.85rem' }}>
              <span style={{ fontSize: '1rem' }}>✨</span>
              <span style={{ color: 'var(--text-primary)' }}>{file}</span>
              <button onClick={() => handleAddContext(file)} style={{ marginLeft: 'auto', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#60a5fa', cursor: 'pointer', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>Add</button>
            </div>
          ))}
        </div>
      )}

      {contextLoading && (
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic', padding: '8px', textAlign: 'center' }}>
          Loading context...
        </div>
      )}

      {!contextLoading && fileEntries.length === 0 && suggestions.length === 0 && (
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
          <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
            <span style={{ fontSize: '1rem' }}>📄</span>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
              <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{filename}</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{folder}</span>
            </div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              {entry.status === 'pinned' && <span style={{ fontSize: '0.7rem', color: '#60a5fa', padding: '2px 4px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '4px' }}>Pinned</span>}
              {entry.status === 'active' && <span style={{ fontSize: '0.7rem', color: 'var(--warning-color)', padding: '2px 4px', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '4px' }}>Active</span>}
              <button onClick={() => handleRemoveContext(entry.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px 4px' }}>×</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
