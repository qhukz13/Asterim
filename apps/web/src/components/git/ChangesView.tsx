import React, { useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDebugLifecycle } from '../../utils/debug';

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

  if (isRepo === false) {
    return (
      <div style={{ padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-secondary)' }}>
        <h2 style={{ marginBottom: '16px', color: 'var(--text-primary)' }}>Not a Git Repository</h2>
        <p style={{ marginBottom: '24px' }}>This project is not currently tracked by version control.</p>
        <button className="btn-primary" style={{ padding: '8px 16px' }} onClick={handleInit}>
          Initialize Repository
        </button>
      </div>
    );
  }

  if (!status) {
    return (
      <div style={{ padding: '40px', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
        Loading repository status...
      </div>
    );
  }

  const stagedFiles = status.files.filter(f => f.staged);
  const unstagedFiles = status.files.filter(f => !f.staged);
  
  // Repo Name logic (fallback to project id if path not available easily)
  const repoName = projectId.split('/').pop() || projectId;

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', height: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
      
      {/* Top Summary Card & Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Review Changes</h2>
          <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <span>{status.files.length} changed ({stagedFiles.length} staged, {unstagedFiles.length} unstaged)</span>
            <span style={{ color: 'var(--accent-hover)' }}>{status.branch}</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            <span style={{ opacity: 0.7 }}>Last commit:</span> {status.lastCommit || 'No commits yet'}
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={{ background: 'transparent', border: '1px solid var(--panel-border)', borderRadius: '4px', cursor: 'pointer', padding: '4px 12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }} onClick={handlePull}>Pull</button>
          <button style={{ background: 'transparent', border: '1px solid var(--panel-border)', borderRadius: '4px', cursor: 'pointer', padding: '4px 12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }} onClick={handlePush}>Push</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error-color)', borderRadius: '6px', fontSize: '0.9rem' }}>
          {error}
        </div>
      )}

      {/* Two-Column Layout */}
      <div style={{ display: 'flex', gap: '24px', flex: 1, minHeight: 0 }}>
        
        {/* LEFT COLUMN: Changed Files (30%) */}
        <div style={{ flex: '0 0 32%', display: 'flex', flexDirection: 'column', overflowY: 'auto', borderRight: '1px solid var(--panel-border)', paddingRight: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', margin: 0 }}>
              Review Changes
            </h3>
            {unstagedFiles.length > 0 && (
              <button 
                onClick={handleStageAll}
                style={{ background: 'transparent', border: '1px solid var(--panel-border)', borderRadius: '4px', cursor: 'pointer', padding: '2px 8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}
              >
                Select All
              </button>
            )}
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {status.files.length === 0 && (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic', padding: '8px 0' }}>
                No working tree changes
              </div>
            )}
            {status.files.map(f => {
              const isSelected = selectedFile === f.file;
              
              // Simple change badge logic
              let badge = 'M';
              let badgeColor = 'var(--accent-hover)';
              if (f.untracked) {
                badge = 'A';
                badgeColor = 'var(--success-color)';
              }
              // You can expand this logic for D (deleted), R (renamed), etc.
              
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
                    borderRadius: '4px',
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(255,255,255,0.06)' : 'transparent',
                    fontSize: '0.85rem'
                  }}
                >
                  <div 
                    onClick={(e) => { e.stopPropagation(); handleToggleStage(f); }}
                    style={{ 
                      width: '16px', height: '16px', 
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: '1px solid var(--text-secondary)', borderRadius: '3px',
                      cursor: 'pointer',
                      color: f.staged ? 'var(--accent-hover)' : 'transparent',
                      background: f.staged ? 'rgba(59, 130, 246, 0.1)' : 'transparent'
                    }}
                  >
                    {f.staged && '✓'}
                  </div>
                  
                  <div style={{ fontWeight: 600, color: badgeColor, fontSize: '0.75rem', width: '12px', textAlign: 'center' }}>
                    {badge}
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    <span style={{ color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden' }}>{filename}</span>
                    {folder && <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', textOverflow: 'ellipsis', overflow: 'hidden' }}>{folder}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN: Diff Viewer & Commit Panel (68%) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0 }}>
          
          {/* Diff Viewer */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--panel-bg)', borderRadius: '6px', border: '1px solid var(--panel-border)' }}>
            {!selectedFile ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Select a file to view its diff
              </div>
            ) : (
              <>
                {/* Diff Header with AI Actions */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--panel-border)', background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {selectedFile.split('/').pop()}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      style={{ background: 'transparent', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '4px', cursor: 'pointer', padding: '4px 10px', fontSize: '0.75rem', color: '#60a5fa' }} 
                      onClick={handleExplainDiff}
                      disabled={isExplainingDiff || !diff || diff === 'Loading diff...'}
                    >
                      {isExplainingDiff ? '✨ Explaining...' : '✨ Explain Intent'}
                    </button>
                    <button 
                      style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.4)', borderRadius: '4px', cursor: 'pointer', padding: '4px 10px', fontSize: '0.75rem', color: '#60a5fa' }} 
                      onClick={handleReviewChanges}
                      disabled={isReviewingChanges || !diff || diff === 'Loading diff...'}
                    >
                      {isReviewingChanges ? '✨ Reviewing...' : '✨ AI Code Review'}
                    </button>
                  </div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                  {diffExplanation && (
                    <div style={{ padding: '16px', background: 'rgba(59, 130, 246, 0.1)', borderBottom: '1px solid rgba(59, 130, 246, 0.3)', color: 'var(--text-primary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                      <strong style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>✨</span> AI Explanation:
                      </strong>
                      <div style={{ marginTop: '8px' }} className="markdown-body">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {diffExplanation}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                  {diffReview && (
                    <div style={{ padding: '16px', background: 'rgba(16, 185, 129, 0.08)', borderBottom: '1px solid rgba(16, 185, 129, 0.3)', color: 'var(--text-primary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                      <strong style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#34d399' }}>
                        <span>🔍</span> AI Code Review:
                      </strong>
                      <div style={{ marginTop: '8px' }} className="markdown-body">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {diffReview}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                  <div style={{ flex: 1, overflow: 'auto', background: 'var(--panel-bg)' }}>
                    {diff === 'Loading diff...' ? (
                      <div style={{ padding: '16px', color: 'var(--text-secondary)' }}>Loading diff...</div>
                    ) : diff ? (
                      <SyntaxHighlighterComp
                        language={selectedFile.split('.').pop() || 'typescript'}
                        style={vscDarkPlus}
                        showLineNumbers={true}
                        wrapLines={true}
                        customStyle={{ margin: 0, background: 'transparent', padding: '16px', fontSize: '0.85rem' }}
                        lineProps={(lineNumber: number) => {
                          const lineStr = diff.split('\n')[lineNumber - 1] || '';
                          let style: React.CSSProperties = { display: 'block', padding: '0 4px' };
                          
                          if (lineStr.startsWith('+')) {
                            style.backgroundColor = 'rgba(46, 160, 67, 0.2)';
                          } else if (lineStr.startsWith('-')) {
                            style.backgroundColor = 'rgba(248, 81, 73, 0.2)';
                          } else if (lineStr.startsWith('@@')) {
                            style.color = '#3b82f6';
                            style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
                          }
                          
                          return { style };
                        }}
                      >
                        {diff}
                      </SyntaxHighlighterComp>
                    ) : (
                      <div style={{ padding: '16px', color: 'var(--text-secondary)' }}>No diff available.</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Review & Approval Action Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            
            {/* Future Approval System Placeholder */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
               <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-secondary)', marginRight: 'auto' }}>Execution Approval</span>
               <button 
                 disabled={agentStatus?.status !== 'waiting_approval'} 
                 onClick={() => sendCommand?.('approve')}
                 style={{ opacity: agentStatus?.status === 'waiting_approval' ? 1 : 0.4, cursor: agentStatus?.status === 'waiting_approval' ? 'pointer' : 'not-allowed', fontSize: '0.8rem', padding: '4px 12px', background: 'var(--success-color)', color: '#fff', border: 'none', borderRadius: '4px' }}>
                 Approve
               </button>
               <button 
                 disabled={agentStatus?.status !== 'waiting_approval'} 
                 onClick={() => {
                   const feedback = prompt("What changes are requested?");
                   if (feedback) sendCommand?.('input', feedback);
                 }}
                 style={{ opacity: agentStatus?.status === 'waiting_approval' ? 1 : 0.4, cursor: agentStatus?.status === 'waiting_approval' ? 'pointer' : 'not-allowed', fontSize: '0.8rem', padding: '4px 12px', background: 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', borderRadius: '4px' }}>
                 Request Changes
               </button>
               <button 
                 disabled={agentStatus?.status !== 'waiting_approval'} 
                 onClick={() => sendCommand?.('reject')}
                 style={{ opacity: agentStatus?.status === 'waiting_approval' ? 1 : 0.4, cursor: agentStatus?.status === 'waiting_approval' ? 'pointer' : 'not-allowed', fontSize: '0.8rem', padding: '4px 12px', background: 'transparent', border: '1px solid var(--panel-border)', color: 'var(--error-color)', borderRadius: '4px' }}>
                 Reject
               </button>
               <button 
                 disabled={agentStatus?.status !== 'idle' && agentStatus?.status !== 'error'} 
                 onClick={() => sendCommand?.('start')}
                 style={{ opacity: (agentStatus?.status === 'idle' || agentStatus?.status === 'error') ? 1 : 0.4, cursor: (agentStatus?.status === 'idle' || agentStatus?.status === 'error') ? 'pointer' : 'not-allowed', fontSize: '0.8rem', padding: '4px 12px', background: 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', borderRadius: '4px' }}>
                 Continue Execution
               </button>
            </div>

            <textarea 
              style={{ 
                width: '100%', 
                height: '80px',
                background: 'var(--panel-bg)', 
                color: 'var(--text-primary)', 
                border: '1px solid var(--panel-border)', 
                borderRadius: '6px',
                padding: '12px',
                resize: 'none',
                fontFamily: 'inherit',
                fontSize: '0.9rem'
              }}
              placeholder="Commit message (describing the agent's work)..."
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', alignItems: 'center' }}>
              <button 
                style={{ background: 'transparent', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '4px', cursor: 'pointer', padding: '8px 16px', fontSize: '0.85rem', color: '#60a5fa', opacity: isGeneratingCommit ? 0.6 : 1 }}
                onClick={handleGenerateCommit}
                disabled={isGeneratingCommit || stagedFiles.length === 0}
              >
                {isGeneratingCommit ? '✨ Generating...' : '✨ Auto-Generate Message'}
              </button>
              
              <div style={{ display: 'flex', gap: '12px' }}>
                <button 
                  className="btn-primary" 
                  style={{ padding: '8px 24px', fontWeight: 600, background: 'var(--success-color)' }} 
                  onClick={handleCommit}
                  disabled={stagedFiles.length === 0 || commitMessage.trim() === ''}
                >
                  Approve & Commit Work
                </button>
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
