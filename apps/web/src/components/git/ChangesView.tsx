import React, { useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';

export interface FileStatus {
  file: string;
  staged: boolean;
  untracked: boolean;
  modified: boolean;
}

export interface RepoStatus {
  branch: string;
  files: FileStatus[];
}

interface ChangesViewProps {
  socket: Socket | null;
  projectId: string;
}

export function ChangesView({ socket, projectId }: ChangesViewProps) {
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket) return;

    const onGitStatus = (event: any) => {
      if (event.payload?.projectId === projectId) {
        setStatus(event.payload.status);
        setError(null);
      }
    };

    const onGitError = (event: any) => {
      if (event.payload?.projectId === projectId) {
        setError(event.payload.error);
      }
    };

    socket.on('git.status', onGitStatus);
    socket.on('git.error', onGitError);

    return () => {
      socket.off('git.status', onGitStatus);
      socket.off('git.error', onGitError);
    };
  }, [socket, projectId]);

  const sendAction = (action: string, payload: any) => {
    if (!socket) return;
    socket.emit('client_event', {
      type: 'git.action',
      payload: { projectId, action, payload }
    });
  };

  const handleStage = (file: string) => sendAction('stage', { file });
  const handleUnstage = (file: string) => sendAction('unstage', { file });
  const handleCommit = () => {
    if (!commitMessage.trim()) return;
    sendAction('commit', { message: commitMessage });
    setCommitMessage('');
  };
  const handlePush = () => sendAction('push', {});
  const handlePull = () => sendAction('pull', {});

  if (!status) {
    return (
      <div style={{ padding: '20px', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
        Loading repository status...
      </div>
    );
  }

  const stagedFiles = status.files.filter(f => f.staged);
  const unstagedFiles = status.files.filter(f => !f.staged);

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
      <div className="glass-panel" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>Current Branch:</strong> <span style={{ marginLeft: '8px', color: '#60a5fa' }}>{status.branch}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-secondary" onClick={handlePull}>Pull</button>
          <button className="btn-primary" onClick={handlePush}>Push</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.15)', color: 'var(--color-error-primary)', borderRadius: '8px' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px', flex: 1, minHeight: 0 }}>
        {/* Left Column: Files */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
          <div className="glass-panel" style={{ padding: '16px' }}>
            <h3 style={{ marginBottom: '12px' }}>Staged Changes ({stagedFiles.length})</h3>
            {stagedFiles.length === 0 && <div style={{ opacity: 0.5 }}>No staged changes</div>}
            {stagedFiles.map(f => (
              <div key={f.file} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span>{f.file}</span>
                <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: '0.8rem' }} onClick={() => handleUnstage(f.file)}>Unstage</button>
              </div>
            ))}
          </div>

          <div className="glass-panel" style={{ padding: '16px' }}>
            <h3 style={{ marginBottom: '12px' }}>Unstaged Changes ({unstagedFiles.length})</h3>
            {unstagedFiles.length === 0 && <div style={{ opacity: 0.5 }}>No unstaged changes</div>}
            {unstagedFiles.map(f => (
              <div key={f.file} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: f.untracked ? 'var(--color-warning-primary)' : 'inherit' }}>
                  {f.untracked ? '[NEW] ' : ''}{f.file}
                </span>
                <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: '0.8rem' }} onClick={() => handleStage(f.file)}>Stage</button>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Commit Box */}
        <div className="glass-panel" style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginBottom: '12px' }}>Commit</h3>
          <textarea 
            style={{ 
              flex: 1, 
              width: '100%', 
              background: 'rgba(0,0,0,0.3)', 
              color: 'white', 
              border: '1px solid var(--color-border-default)', 
              borderRadius: '8px',
              padding: '12px',
              resize: 'none',
              marginBottom: '16px',
              fontFamily: 'inherit'
            }}
            placeholder="Commit message..."
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
          />
          <button 
            className="btn-primary" 
            style={{ padding: '12px', fontWeight: 'bold', width: '100%' }} 
            onClick={handleCommit}
            disabled={stagedFiles.length === 0 || commitMessage.trim() === ''}
          >
            Commit Staged
          </button>
        </div>
      </div>
    </div>
  );
}
