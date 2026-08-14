import React, { useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDebugLifecycle } from '../../utils/debug';
import { IconFileCode, IconSparkles } from '../icons/Icons';

const SyntaxHighlighterComp = SyntaxHighlighter as any;

export interface FileStatus {
  file: string;
  staged: boolean;
  untracked: boolean;
  modified: boolean;
}

export interface RepoStatus {
  branch: string;
  files: FileStatus[];
  syncStatus?: string;
  ahead?: number;
  behind?: number;
  lastCommit?: string;
  hasRemote?: boolean;
  remoteUrl?: string;
}

interface ChangesViewProps {
  socket: Socket | null;
  projectId: string;
  activeBackendUrl?: string;
  agentStatus?: { status: string; message?: string };
  sendCommand?: (cmd: string, ...args: any[]) => void;
}

export function ChangesView({ socket, projectId, activeBackendUrl, agentStatus, sendCommand }: ChangesViewProps) {
  useDebugLifecycle('ChangesView', { projectId });
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [isRepo, setIsRepo] = useState<boolean | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>('');
  
  const [isGeneratingCommit, setIsGeneratingCommit] = useState(false);
  const [isExplainingDiff, setIsExplainingDiff] = useState(false);
  const [diffExplanation, setDiffExplanation] = useState<string | null>(null);
  const [isReviewingChanges, setIsReviewingChanges] = useState(false);
  const [diffReview, setDiffReview] = useState<string | null>(null);

  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [remoteInputUrl, setRemoteInputUrl] = useState('');
  const [isSettingRemote, setIsSettingRemote] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (!socket) return;

    const onGitStatus = (event: any) => {
      if (event.payload?.projectId === projectId) {
        setIsRepo(event.payload.isRepo);
        setStatus(event.payload.status);
        setIsSyncing(false);
      }
    };

    const onGitError = (event: any) => {
      if (event.payload?.projectId === projectId) {
        setError(event.payload.error);
        setIsSyncing(false);
      }
    };
    
    const onGitDiff = (event: any) => {
      if (event.payload?.projectId === projectId && event.payload?.file === selectedFile) {
        setDiff(event.payload.diff);
        setDiffExplanation(null);
        setDiffReview(null);
      }
    };

    socket.on('git.status', onGitStatus);
    socket.on('git.error', onGitError);
    socket.on('git.diff', onGitDiff);

    return () => {
      socket.off('git.status', onGitStatus);
      socket.off('git.error', onGitError);
      socket.off('git.diff', onGitDiff);
    };
  }, [socket, projectId, selectedFile]);

  const sendAction = (action: string, payload: any = {}) => {
    if (!socket) return;
    socket.emit('client_event', {
      type: 'git.action',
      payload: { projectId, action, payload }
    });
  };

  useEffect(() => {
    if (!socket) return;
    
    const onConnect = () => sendAction('get_status');
    socket.on('connect', onConnect);
    
    if (socket.connected) {
      sendAction('get_status');
    }

    return () => {
      socket.off('connect', onConnect);
    };
  }, [socket, projectId]);

  const handleInit = () => sendAction('init');
  const handleStage = (file: string) => sendAction('stage', { file });
  const handleUnstage = (file: string) => sendAction('unstage', { file });
  const handleStageAll = () => sendAction('stage_all');
  const handleToggleStage = (f: FileStatus) => {
    if (f.staged) handleUnstage(f.file);
    else handleStage(f.file);
  };
  const handleCommit = () => {
    if (!commitMessage.trim()) return;
    const stagedCount = status?.files.filter(f => f.staged).length || 0;
    if (stagedCount === 0 && (status?.files.length || 0) > 0) {
      handleStageAll();
    }
    sendAction('commit', { message: commitMessage });
    setCommitMessage('');
  };
  const handlePull = () => sendAction('pull');
  
  const handleSelectFile = (f: FileStatus) => {
    setSelectedFile(f.file);
    setDiff('Loading diff...');
    setDiffExplanation(null);
    setDiffReview(null);
    sendAction('get_diff', { file: f.file, staged: f.staged });
  };

  const handleSaveRemote = async (customUrl?: string) => {
    const targetUrl = (customUrl || remoteInputUrl).trim();
    if (!targetUrl) return;

    setIsSettingRemote(true);
    setError(null);
    try {
      const baseUrl = activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;
      const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/git/remote`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ remoteUrl: targetUrl })
      });
      const data = await res.json();
      if (res.ok) {
        setShowRemoteModal(false);
        setRemoteInputUrl('');
        sendAction('get_status');
      } else {
        setError(data.error || 'Failed to update remote repository URL');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update remote repository URL');
    } finally {
      setIsSettingRemote(false);
    }
  };

  const handlePush = async () => {
    if (!status?.hasRemote && !status?.remoteUrl) {
      setShowRemoteModal(true);
      return;
    }

    setIsSyncing(true);
    setError(null);

    try {
      const baseUrl = activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;
      const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/git/push`, {
        method: 'POST',
        headers,
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) {
        const errMsg = data.error || 'Failed to push changes';
        setError(errMsg);
        setShowRemoteModal(true);
      } else {
        setError(null);
        sendAction('get_status');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to push changes');
      setShowRemoteModal(true);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleGenerateCommit = async () => {
    let filesToInspect = status?.files.filter(f => f.staged) || [];
    if (filesToInspect.length === 0) {
      filesToInspect = status?.files || [];
    }
    if (filesToInspect.length === 0) return;

    setIsGeneratingCommit(true);
    try {
      const baseUrl = activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;
      const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';

      const res = await fetch(`${baseUrl}/api/v1/ai/generate-commit`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ projectId, stagedFiles: filesToInspect.map(f => f.file) })
      });
      const data = await res.json();
      if (res.ok && data.commitMessage) {
        setCommitMessage(data.commitMessage);
      } else {
        setError(data.error || 'Failed to generate commit message');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate commit message');
    } finally {
      setIsGeneratingCommit(false);
    }
  };

  const handleExplainDiff = async () => {
    if (!diff || diff === 'Loading diff...') return;

    setIsExplainingDiff(true);
    try {
      const baseUrl = activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;
      const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';

      const res = await fetch(`${baseUrl}/api/v1/ai/explain-diff`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ diff, projectId })
      });
      const data = await res.json();
      if (res.ok && data.explanation) {
        setDiffExplanation(data.explanation);
      } else {
        setError(data.error || 'Failed to explain diff');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to explain diff');
    } finally {
      setIsExplainingDiff(false);
    }
  };

  const handleReviewChanges = async () => {
    if (!diff || diff === 'Loading diff...') return;

    setIsReviewingChanges(true);
    try {
      const baseUrl = activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;
      const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';

      const res = await fetch(`${baseUrl}/api/v1/ai/review-changes`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ diff, projectId })
      });
      const data = await res.json();
      if (res.ok && data.review) {
        setDiffReview(data.review);
      } else {
        setError(data.error || 'Failed to review changes');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to review changes');
    } finally {
      setIsReviewingChanges(false);
    }
  };

  const [leftWidth, setLeftWidth] = useState(340);

  const handleDragSplitter = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(240, Math.min(550, startWidth + delta));
      setLeftWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  if (isRepo === false) {
    return (
      <div style={{ width: '100%', flex: 1, padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-secondary)' }}>
        <h2 style={{ marginBottom: '16px', color: 'var(--color-text-primary)', fontSize: 'var(--font-size-xl)' }}>Not a Git Repository</h2>
        <p style={{ marginBottom: '24px', fontSize: 'var(--font-size-md)' }}>This project is not currently tracked by version control.</p>
        <button className="btn-primary" style={{ padding: '8px 16px' }} onClick={handleInit}>
          Initialize Repository
        </button>
      </div>
    );
  }

  if (!status) {
    return (
      <div style={{ width: '100%', flex: 1, padding: '40px', color: 'var(--color-text-secondary)', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        Loading repository status...
      </div>
    );
  }

  const stagedFiles = status.files.filter(f => f.staged);
  const unstagedFiles = status.files.filter(f => !f.staged);
  const hasWorkingTreeChanges = status.files.length > 0;

  const handleFormatSsh = () => {
    let url = remoteInputUrl.trim();
    if (!url && status?.remoteUrl) url = status.remoteUrl;
    if (url.startsWith('https://github.com/')) {
      const path = url.replace('https://github.com/', '');
      url = `git@github.com:${path}`;
    }
    setRemoteInputUrl(url);
  };

  const handleFormatPat = () => {
    let url = remoteInputUrl.trim();
    if (!url && status?.remoteUrl) url = status.remoteUrl;
    if (url.startsWith('git@github.com:')) {
      const path = url.replace('git@github.com:', '');
      url = `https://YOUR_TOKEN@github.com/${path}`;
    } else if (url.startsWith('https://github.com/')) {
      const path = url.replace('https://github.com/', '');
      url = `https://YOUR_TOKEN@github.com/${path}`;
    }
    setRemoteInputUrl(url);
  };

  return (
    <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', height: '100%', flex: 1, minHeight: 0, minWidth: 0, boxSizing: 'border-box', overflow: 'hidden' }}>
      
      {/* Top Header Summary & Branch Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>Changes</h2>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            <span>{status?.files.length || 0} changed ({stagedFiles.length} staged, {unstagedFiles.length} unstaged)</span>
            <span style={{ color: 'var(--color-accent-primary)', fontWeight: 500 }}>{status?.branch}</span>
            {status?.remoteUrl && (
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', background: 'var(--color-surface-2)', padding: '2px 8px', borderRadius: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '220px' }} title={status.remoteUrl}>
                origin: {status.remoteUrl}
              </span>
            )}
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button 
            style={{ background: 'transparent', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '4px 12px', fontSize: '0.85rem', color: 'var(--color-accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '6px' }} 
            onClick={() => { setRemoteInputUrl(status?.remoteUrl || ''); setShowRemoteModal(true); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
              <path d="M9 18c-4.51 2-5-2-7-2" />
            </svg>
            {status?.hasRemote ? 'Remote Setup' : 'Connect GitHub / Remote'}
          </button>

          <button 
            style={{ background: 'transparent', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '4px 12px', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }} 
            onClick={handlePull}
          >
            Pull
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--color-state-error)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <div>
            <strong>Error: </strong> {error}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button 
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-xs)', padding: '2px 8px', fontSize: '0.75rem', color: 'var(--color-accent-primary)', cursor: 'pointer' }}
              onClick={() => { setRemoteInputUrl(status?.remoteUrl || ''); setShowRemoteModal(true); }}
            >
              Configure Remote
            </button>
            <button 
              style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.9rem', padding: '0 4px' }}
              onClick={() => setError(null)}
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main 2-Column Resizable Layout */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: '12px', overflow: 'hidden' }}>
        
        {/* LEFT COLUMN: Changed Files List & Commit/Sync Panel */}
        <div style={{ width: `${leftWidth}px`, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', overflow: 'hidden' }}>
          
          {/* Changed Files List Container */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', background: 'var(--color-surface-1)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-subtle)', padding: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h3 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', margin: 0, fontWeight: 600 }}>
                Files ({status?.files.length || 0})
              </h3>
              {unstagedFiles.length > 0 && (
                <button 
                  onClick={handleStageAll}
                  style={{ background: 'transparent', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-xs)', cursor: 'pointer', padding: '2px 8px', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}
                >
                  Stage All
                </button>
              )}
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, overflowY: 'auto' }}>
              {status?.files.length === 0 && (
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '16px 0', textAlign: 'center' }}>
                  No working tree changes
                </div>
              )}
              {status?.files.map(f => {
                const isSelected = selectedFile === f.file;
                
                let badge = 'M';
                let badgeColor = 'var(--color-accent-primary)';
                if (f.untracked) {
                  badge = 'A';
                  badgeColor = 'var(--color-state-completed)';
                }
                
                const parts = f.file.split('/');
                const filename = parts.pop();
                const folder = parts.length > 0 ? parts.join('/') + '/' : '';

                return (
                  <div 
                    key={f.file} 
                    onClick={() => handleSelectFile(f)}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px', 
                      padding: '6px 8px', 
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--color-surface-2)' : 'transparent',
                      border: `1px solid ${isSelected ? 'var(--color-border-subtle)' : 'transparent'}`,
                      fontSize: '0.85rem'
                    }}
                  >
                    <div 
                      onClick={(e) => { e.stopPropagation(); handleToggleStage(f); }}
                      style={{ 
                        width: '16px', height: '16px', 
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1px solid var(--color-border-default)', borderRadius: '3px',
                        cursor: 'pointer',
                        color: f.staged ? 'var(--color-accent-primary)' : 'transparent',
                        background: f.staged ? 'var(--color-surface-2)' : 'transparent'
                      }}
                    >
                      {f.staged && '✓'}
                    </div>
                    
                    <div style={{ fontWeight: 600, color: badgeColor, fontSize: '0.75rem', width: '12px', textAlign: 'center' }}>
                      {badge}
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--color-text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', fontSize: '0.85rem' }}>{filename}</span>
                      {folder && <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', textOverflow: 'ellipsis', overflow: 'hidden' }}>{folder}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Commit & Sync Card (Pinned at Left Bottom) */}
          <div style={{ background: 'var(--color-surface-1)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-subtle)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
              {hasWorkingTreeChanges ? 'Commit Changes' : 'Sync Workspace'}
            </div>

            {hasWorkingTreeChanges && (
              <textarea 
                style={{ 
                  width: '100%', 
                  height: '70px',
                  background: 'var(--color-surface-0)', 
                  color: 'var(--color-text-primary)', 
                  border: '1px solid var(--color-border-subtle)', 
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px',
                  resize: 'none',
                  fontFamily: 'inherit',
                  fontSize: '0.85rem',
                  boxSizing: 'border-box'
                }}
                placeholder="Commit message summary..."
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
              />
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {hasWorkingTreeChanges ? (
                <>
                  <button 
                    style={{ background: 'transparent', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '6px 12px', fontSize: '0.75rem', color: 'var(--color-accent-primary)', opacity: isGeneratingCommit ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                    onClick={handleGenerateCommit}
                    disabled={isGeneratingCommit}
                  >
                    <IconSparkles size={13} color="var(--color-accent-primary)" />
                    {isGeneratingCommit ? 'Generating...' : 'Auto-Generate Message'}
                  </button>
                  
                  <button 
                    className="btn-primary" 
                    style={{ padding: '8px 16px', fontWeight: 600, fontSize: '0.85rem', width: '100%' }} 
                    onClick={handleCommit}
                    disabled={commitMessage.trim() === ''}
                  >
                    Commit Changes
                  </button>
                </>
              ) : (
                <button 
                  className={(status?.ahead || status?.behind) ? "btn-primary" : ""} 
                  style={{ 
                    padding: '10px 16px', 
                    fontWeight: 600, 
                    fontSize: '0.85rem', 
                    width: '100%', 
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    opacity: isSyncing ? 0.7 : 1,
                    background: (status?.ahead || status?.behind) ? 'var(--color-accent-primary)' : 'var(--color-surface-2)',
                    color: (status?.ahead || status?.behind) ? '#ffffff' : 'var(--color-text-secondary)',
                    border: (status?.ahead || status?.behind) ? 'none' : '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: isSyncing ? 'not-allowed' : 'pointer'
                  }} 
                  onClick={handlePush}
                  disabled={isSyncing}
                >
                  {isSyncing ? (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.5 2v6h-6M2.5 22v-6h6" />
                        <path d="M2 11.5a10 10 0 0 1 18.8-4.3L21.5 8M2.5 16l1.2 1.8a10 10 0 0 0 18.8-4.3" />
                      </svg>
                      <span>Syncing...</span>
                    </>
                  ) : (status?.ahead || status?.behind) ? (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.5 2v6h-6M2.5 22v-6h6" />
                        <path d="M2 11.5a10 10 0 0 1 18.8-4.3L21.5 8M2.5 16l1.2 1.8a10 10 0 0 0 18.8-4.3" />
                      </svg>
                      <span>
                        Sync Changes{status?.ahead && status.ahead > 0 ? ` ${status.ahead} ↑` : ''}{status?.behind && status.behind > 0 ? ` ${status.behind} ↓` : ''}
                      </span>
                    </>
                  ) : (
                    <>
                      <span style={{ color: 'var(--color-state-completed)', fontWeight: 700 }}>✓</span>
                      <span>Synced</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

        </div>

        {/* DRAGGABLE RESIZER HANDLE */}
        <div
          onMouseDown={handleDragSplitter}
          style={{
            width: '6px',
            cursor: 'col-resize',
            background: 'transparent',
            borderRadius: '3px',
            transition: 'background 0.15s',
            margin: '0 -3px',
            zIndex: 10
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-border-subtle)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        />

        {/* RIGHT COLUMN: Full-Height Diff Viewer */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
          
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden', background: 'var(--color-surface-1)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-subtle)' }}>
            {!selectedFile ? (
              <div 
                style={{ 
                  flex: 1, 
                  display: 'flex', 
                  flexDirection: 'column',
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  color: 'var(--color-text-muted)', 
                  padding: '32px',
                  height: '100%',
                  minHeight: 0
                }}
              >
                <div style={{ marginBottom: '12px', opacity: 0.5 }}>
                  <IconFileCode size={36} color="var(--color-text-muted)" />
                </div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                  No File Selected
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                  Select a file from the left panel to review diff
                </div>
              </div>
            ) : (
              <>
                {/* Diff Header Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--color-border-subtle)', background: 'var(--color-surface-2)', flexShrink: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)', fontFamily: 'var(--font-family-mono)' }}>
                    {selectedFile}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      style={{ background: 'transparent', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '4px 10px', fontSize: '0.75rem', color: 'var(--color-accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '5px' }} 
                      onClick={handleExplainDiff}
                      disabled={isExplainingDiff || !diff || diff === 'Loading diff...'}
                    >
                      <IconSparkles size={12} color="var(--color-accent-primary)" />
                      {isExplainingDiff ? 'Explaining...' : 'Explain Intent'}
                    </button>
                    <button 
                      style={{ background: 'var(--color-surface-0)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '4px 10px', fontSize: '0.75rem', color: 'var(--color-accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '5px' }} 
                      onClick={handleReviewChanges}
                      disabled={isReviewingChanges || !diff || diff === 'Loading diff...'}
                    >
                      <IconSparkles size={12} color="var(--color-accent-primary)" />
                      {isReviewingChanges ? 'Reviewing...' : 'AI Code Review'}
                    </button>
                  </div>
                </div>

                {/* Collapsible AI Explanation & Review Panels */}
                {diffExplanation && (
                  <div style={{ padding: '16px', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)', fontSize: '0.85rem', lineHeight: 1.5, flexShrink: 0, maxHeight: '200px', overflowY: 'auto' }}>
                    <strong style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-accent-primary)' }}>
                      <IconSparkles size={14} color="var(--color-accent-primary)" /> AI Explanation:
                    </strong>
                    <div style={{ marginTop: '8px' }} className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {diffExplanation}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
                {diffReview && (
                  <div style={{ padding: '16px', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)', fontSize: '0.85rem', lineHeight: 1.5, flexShrink: 0, maxHeight: '200px', overflowY: 'auto' }}>
                    <strong style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-state-completed)' }}>
                      <IconSparkles size={14} color="var(--color-state-completed)" /> AI Code Review:
                    </strong>
                    <div style={{ marginTop: '8px' }} className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {diffReview}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {/* 100% Full-Height Scrollable Diff Canvas */}
                <div style={{ flex: 1, overflow: 'auto', background: 'var(--color-surface-0)' }}>
                  {diff === 'Loading diff...' ? (
                    <div style={{ padding: '16px', color: 'var(--color-text-muted)' }}>Loading diff...</div>
                  ) : diff ? (
                    <SyntaxHighlighterComp
                      language="diff"
                      style={vscDarkPlus}
                      showLineNumbers={true}
                      wrapLines={true}
                      customStyle={{ margin: 0, background: 'transparent', padding: '16px', fontSize: '0.85rem', lineHeight: '1.5' }}
                      lineProps={(lineNumber: number) => {
                        const lineStr = diff.split('\n')[lineNumber - 1] || '';
                        const style: React.CSSProperties = { display: 'flex', width: '100%', minWidth: 'max-content', padding: '0 4px', boxSizing: 'border-box' };
                        
                        if (lineStr.startsWith('+')) {
                          style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
                        } else if (lineStr.startsWith('-')) {
                          style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
                        } else if (lineStr.startsWith('@@')) {
                          style.color = 'var(--color-accent-primary)';
                          style.backgroundColor = 'var(--color-surface-2)';
                        }
                        
                        return { style };
                      }}
                    >
                      {diff}
                    </SyntaxHighlighterComp>
                  ) : (
                    <div style={{ padding: '16px', color: 'var(--color-text-muted)' }}>No diff available.</div>
                  )}
                </div>
              </>
            )}
          </div>

        </div>

      </div>

      {/* GitHub / Remote Repository Configuration Modal */}
      {showRemoteModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--color-surface-1)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', width: '520px', maxWidth: '90vw', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                  <path d="M9 18c-4.51 2-5-2-7-2" />
                </svg>
                Connect Remote Repository
              </h3>
              <button 
                style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '1.1rem' }}
                onClick={() => setShowRemoteModal(false)}
              >
                ✕
              </button>
            </div>

            {error && (
              <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.15)', color: 'var(--color-state-error)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', lineHeight: 1.4 }}>
                {error}
              </div>
            )}

            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              Link your local repository to GitHub, GitLab, or any remote Git host by configuring the <code>origin</code> remote URL.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
                  Remote Repository URL
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button 
                    style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-xs)', padding: '2px 6px', fontSize: '0.7rem', color: 'var(--color-accent-primary)', cursor: 'pointer' }}
                    onClick={handleFormatSsh}
                    title="Format as SSH git@github.com:owner/repo.git"
                  >
                    Format SSH
                  </button>
                  <button 
                    style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-xs)', padding: '2px 6px', fontSize: '0.7rem', color: 'var(--color-accent-primary)', cursor: 'pointer' }}
                    onClick={handleFormatPat}
                    title="Format as HTTPS PAT https://TOKEN@github.com/owner/repo.git"
                  >
                    Format PAT
                  </button>
                </div>
              </div>

              <input 
                type="text"
                style={{ 
                  width: '100%', 
                  padding: '10px 12px', 
                  background: 'var(--color-surface-0)', 
                  border: '1px solid var(--color-border-subtle)', 
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-primary)',
                  fontSize: '0.85rem',
                  boxSizing: 'border-box'
                }}
                placeholder="https://github.com/username/repository.git or git@github.com:username/repository.git"
                value={remoteInputUrl}
                onChange={(e) => setRemoteInputUrl(e.target.value)}
              />
            </div>

            <div style={{ background: 'var(--color-surface-2)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
              <strong>Non-Interactive Authentication Guide:</strong>
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                <li><strong>HTTPS with Token:</strong> Use <code>https://YOUR_GITHUB_TOKEN@github.com/username/repo.git</code></li>
                <li><strong>SSH Keys:</strong> Use <code>git@github.com:username/repo.git</code> with standard SSH keys (e.g. <code>ssh-add</code>).</li>
              </ul>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button 
                style={{ background: 'transparent', border: '1px solid var(--color-border-subtle)', padding: '8px 16px', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '0.85rem' }}
                onClick={() => setShowRemoteModal(false)}
              >
                Cancel
              </button>
              <button 
                className="btn-primary"
                style={{ padding: '8px 16px', borderRadius: 'var(--radius-sm)', fontWeight: 600, fontSize: '0.85rem', cursor: isSettingRemote ? 'not-allowed' : 'pointer' }}
                onClick={() => handleSaveRemote()}
                disabled={isSettingRemote || !remoteInputUrl.trim()}
              >
                {isSettingRemote ? 'Saving...' : 'Save Remote'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

