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
  lastCommit?: string;
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

  useEffect(() => {
    if (!socket) return;

    const onGitStatus = (event: any) => {
      if (event.payload?.projectId === projectId) {
        setIsRepo(event.payload.isRepo);
        setStatus(event.payload.status);
        setError(null);
      }
    };

    const onGitError = (event: any) => {
      if (event.payload?.projectId === projectId) {
        setError(event.payload.error);
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
    sendAction('commit', { message: commitMessage });
    setCommitMessage('');
  };
  const handlePush = () => sendAction('push');
  const handlePull = () => sendAction('pull');
  
  const handleSelectFile = (f: FileStatus) => {
    setSelectedFile(f.file);
    setDiff('Loading diff...');
    setDiffExplanation(null);
    setDiffReview(null);
    sendAction('get_diff', { file: f.file, staged: f.staged });
  };

  const handleGenerateCommit = async () => {
    const stagedFiles = status?.files.filter(f => f.staged) || [];
    if (stagedFiles.length === 0) return;

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
        body: JSON.stringify({ projectId, stagedFiles: stagedFiles.map(f => f.file) })
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

  return (
    <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', height: '100%', flex: 1, minHeight: 0, minWidth: 0, boxSizing: 'border-box', overflow: 'hidden' }}>
      
      {/* Top Header Summary & Branch Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>Changes</h2>
          <div style={{ display: 'flex', gap: '12px', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            <span>{status.files.length} changed ({stagedFiles.length} staged, {unstagedFiles.length} unstaged)</span>
            <span style={{ color: 'var(--color-accent-primary)', fontWeight: 500 }}>{status.branch}</span>
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            style={{ background: 'transparent', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '4px 12px', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }} 
            onClick={handlePull}
          >
            Pull
          </button>
          <button 
            style={{ background: 'transparent', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '4px 12px', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }} 
            onClick={handlePush}
          >
            Push
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-state-error)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', flexShrink: 0 }}>
          {error}
        </div>
      )}

      {/* Main 2-Column Resizable Layout */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: '12px', overflow: 'hidden' }}>
        
        {/* LEFT COLUMN: Changed Files List & Commit Panel */}
        <div style={{ width: `${leftWidth}px`, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', overflow: 'hidden' }}>
          
          {/* Changed Files List Container */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', background: 'var(--color-surface-1)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-subtle)', padding: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h3 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', margin: 0, fontWeight: 600 }}>
                Files ({status.files.length})
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
              {status.files.length === 0 && (
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '16px 0', textAlign: 'center' }}>
                  No working tree changes
                </div>
              )}
              {status.files.map(f => {
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

          {/* Commit Card (Pinned at Left Bottom) */}
          <div style={{ background: 'var(--color-surface-1)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-subtle)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
              Commit Changes
            </div>

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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button 
                style={{ background: 'transparent', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '6px 12px', fontSize: '0.75rem', color: 'var(--color-accent-primary)', opacity: isGeneratingCommit ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                onClick={handleGenerateCommit}
                disabled={isGeneratingCommit || stagedFiles.length === 0}
              >
                <IconSparkles size={13} color="var(--color-accent-primary)" />
                {isGeneratingCommit ? 'Generating...' : 'Auto-Generate Message'}
              </button>
              
              <button 
                className="btn-primary" 
                style={{ padding: '8px 16px', fontWeight: 600, fontSize: '0.85rem', width: '100%' }} 
                onClick={handleCommit}
                disabled={stagedFiles.length === 0 || commitMessage.trim() === ''}
              >
                Commit Staged Changes
              </button>
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
                      language={selectedFile.split('.').pop() || 'typescript'}
                      style={vscDarkPlus}
                      showLineNumbers={true}
                      wrapLines={true}
                      customStyle={{ margin: 0, background: 'transparent', padding: '16px', fontSize: '0.85rem', lineHeight: '1.5' }}
                      lineProps={(lineNumber: number) => {
                        const lineStr = diff.split('\n')[lineNumber - 1] || '';
                        let style: React.CSSProperties = { display: 'block', padding: '0 4px' };
                        
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
    </div>
  );
}
