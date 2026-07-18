import React, { useEffect, useState } from 'react';
import { NewAgentModal } from './overlays/NewAgentModal';

export interface Thread {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
}

export function SessionSidebar({
  projectId,
  activeThreadId,
  onSelectThread,
  onBackToProjects,
  activeBackendUrl
}: {
  projectId: string;
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onBackToProjects: () => void;
  activeBackendUrl?: string;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewAgentModal, setShowNewAgentModal] = useState(false);

  useEffect(() => {
    const baseUrl = activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;
    const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
    const token = localStorage.getItem(tokenKey) || '';
    
    fetch(`${baseUrl}/api/v1/projects/${projectId}/threads`, { headers: token ? { "Authorization": `Bearer ${token}` } : {} })
      .then(res => res.json())
      .then(data => {
        if (data.threads) {
          setThreads(data.threads);
          if (!activeThreadId && data.threads.length > 0) {
            onSelectThread(data.threads[0].id);
          }
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch threads', err);
        setLoading(false);
      });
  }, [projectId]);

  const handleCreateThreadSubmit = async (name: string) => {
    setShowNewAgentModal(false);
    try {
      const baseUrl = activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;
      const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';
      
      const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/threads`, {
        method: 'POST',
        headers: { "Content-Type": "application/json", "Authorization": token ? `Bearer ${token}` : "" },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (data.thread) {
        setThreads(prev => [...prev, data.thread]);
        onSelectThread(data.thread.id);
      }
    } catch (err) {
      console.error('Failed to create thread', err);
    }
  };

  return (
    <div className="workspace-session-sidebar">
      <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <button 
          onClick={onBackToProjects} 
          style={{ 
            padding: '6px 12px', 
            fontSize: '0.85rem',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid var(--panel-border)',
            color: 'var(--text-secondary)',
            borderRadius: '6px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          ← Back
        </button>
        <button className="btn-primary" onClick={() => setShowNewAgentModal(true)} style={{ padding: '6px 12px', fontSize: '0.85rem', borderRadius: '6px' }}>
          + New Agent
        </button>
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.05em' }}>
          Parallel Agents
        </div>
        
        {loading ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Loading agents...</div>
        ) : threads.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No agents started yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {threads.map(thread => (
              <div
                key={thread.id}
                onClick={() => onSelectThread(thread.id)}
                style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  background: activeThreadId === thread.id ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                  color: activeThreadId === thread.id ? '#60a5fa' : 'var(--text-primary)',
                  transition: 'background 0.2s',
                  border: `1px solid ${activeThreadId === thread.id ? 'rgba(59, 130, 246, 0.3)' : 'transparent'}`
                }}
                onMouseOver={(e) => {
                  if (activeThreadId !== thread.id) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                }}
                onMouseOut={(e) => {
                  if (activeThreadId !== thread.id) e.currentTarget.style.background = 'transparent';
                }}
              >
                <div style={{ marginRight: '8px', opacity: 0.7 }}>🤖</div>
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {thread.name}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        Asterim Workspace
      </div>

      {showNewAgentModal && (
        <NewAgentModal 
          onClose={() => setShowNewAgentModal(false)}
          onSubmit={handleCreateThreadSubmit}
        />
      )}
    </div>
  );
}
