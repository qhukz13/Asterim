import React, { useState } from 'react';

interface ContextViewProps {
  projectId: string;
  activeBackendUrl?: string;
  messages?: any[];
}

interface ContextFile {
  path: string;
  type: 'modified' | 'read-only' | 'suggestion';
}

export function ContextView({ projectId, activeBackendUrl, messages = [] }: ContextViewProps) {
  const [activeTask, setActiveTask] = useState('');
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [contextFiles, setContextFiles] = useState<ContextFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleSuggestFiles = async () => {
    if (!activeTask.trim()) return;
    setIsSuggesting(true);
    setError(null);
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
        body: JSON.stringify({ projectId, task: activeTask })
      });
      const data = await res.json();
      if (res.ok) {
        setSuggestions(data.suggestions || []);
      } else {
        setError(data.error || 'Failed to suggest files');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to suggest files');
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleExtractMission = async () => {
    if (messages.length === 0) {
      setError('No chat history available to extract a mission from.');
      return;
    }
    
    setIsExtracting(true);
    setError(null);
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
        setActiveTask(data.mission);
      } else {
        setError(data.error || 'Failed to extract mission');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to extract mission');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleAddContext = (file: string) => {
    if (!contextFiles.find(c => c.path === file)) {
      setContextFiles([...contextFiles, { path: file, type: 'suggestion' }]);
    }
    setSuggestions(suggestions.filter(s => s !== file));
  };

  const handleRemoveContext = (file: string) => {
    setContextFiles(contextFiles.filter(c => c.path !== file));
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '32px', height: '100%', boxSizing: 'border-box', overflowY: 'auto' }}>
      
      {/* Top Header / Mission */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Current Mission</h2>
        <div className="glass-panel" style={{ padding: '16px', background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '6px' }}>
          <div style={{ color: '#60a5fa', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>✨</span>
            <input 
              style={{ fontWeight: 500, background: 'transparent', border: 'none', color: 'inherit', width: '100%', outline: 'none' }} 
              value={activeTask}
              onChange={(e) => setActiveTask(e.target.value)}
              placeholder="What are you currently working on?"
            />
            <button 
              onClick={handleExtractMission} 
              disabled={isExtracting}
              style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#60a5fa', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap', fontSize: '0.8rem' }}
            >
              {isExtracting ? 'Extracting...' : '✨ Auto-extract'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', flex: 1, minHeight: 0 }}>
        {/* Main Context Column */}
        <div style={{ flex: '0 0 65%', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', margin: 0 }}>
                Pinned & Active Context
              </h3>
              <button 
                style={{ background: 'transparent', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '4px', cursor: 'pointer', padding: '4px 12px', fontSize: '0.8rem', color: '#60a5fa', opacity: isSuggesting ? 0.6 : 1 }}
                onClick={handleSuggestFiles}
                disabled={isSuggesting}
              >
                {isSuggesting ? '✨ Suggesting...' : '✨ Suggest Files'}
              </button>
            </div>
            
            {error && (
              <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error-color)', borderRadius: '6px', fontSize: '0.85rem' }}>
                {error}
              </div>
            )}

            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '12px' }}>
              
              {suggestions.length > 0 && (
                <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '0.8rem', color: '#60a5fa', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Suggestions</div>
                  {suggestions.map(file => (
                    <div key={file} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 8px', borderRadius: '4px', fontSize: '0.85rem' }}>
                      <span style={{ fontSize: '1rem' }}>✨</span>
                      <span style={{ color: 'var(--text-primary)' }}>{file}</span>
                      <button onClick={() => handleAddContext(file)} style={{ marginLeft: 'auto', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#60a5fa', cursor: 'pointer', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>Add</button>
                    </div>
                  ))}
                </div>
              )}

              {contextFiles.length === 0 && (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic', padding: '8px', textAlign: 'center' }}>
                  No files added to context yet.
                </div>
              )}

              {contextFiles.map((file) => {
                const parts = file.path.split('/');
                const filename = parts.pop();
                const folder = parts.length > 0 ? parts.join('/') + '/' : '';
                return (
                  <div key={file.path} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                    <span style={{ fontSize: '1.1rem' }}>📄</span>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>{filename}</span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{folder}</span>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                      {file.type === 'modified' && <span style={{ fontSize: '0.75rem', color: 'var(--warning-color)', padding: '2px 6px', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '4px' }}>Modified</span>}
                      {file.type === 'suggestion' && <span style={{ fontSize: '0.75rem', color: '#60a5fa', padding: '2px 6px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '4px' }}>Suggestion</span>}
                      {file.type === 'read-only' && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>Read-only</span>}
                      <button onClick={() => handleRemoveContext(file.path)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>×</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          
        </div>

        {/* Sidebar Context Column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', margin: 0, marginBottom: '4px' }}>
              Actions
            </h3>
            <button 
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--panel-border)', borderRadius: '6px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '10px 12px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}
              onClick={() => alert("Browse Project modal will open here.")}
            >
              <span style={{ opacity: 0.7, fontSize: '1rem' }}>🔍</span> Browse Project... <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: '0.75rem' }}>Cmd+K</span>
            </button>
            <button 
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--panel-border)', borderRadius: '6px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '10px 12px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}
              onClick={() => alert("Manual context addition will open here.")}
            >
              <span style={{ opacity: 0.7, fontSize: '1rem' }}>➕</span> Add File to Context
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
              Related Knowledge
            </h3>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '12px', border: '1px dashed var(--panel-border)', borderRadius: '6px', textAlign: 'center' }}>
              No related PRs or documentation found for this context.
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
