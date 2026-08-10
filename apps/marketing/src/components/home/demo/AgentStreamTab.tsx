import React, { useState, useEffect } from 'react';
import { Terminal, Zap, Play, Pause } from 'lucide-react';

export const AgentStreamTab: React.FC = () => {
  const [streaming, setStreaming] = useState(true);
  const [lineCount, setLineCount] = useState(14820);

  useEffect(() => {
    if (!streaming) return;
    const interval = setInterval(() => {
      setLineCount((prev) => prev + Math.floor(Math.random() * 8) + 1);
    }, 150);
    return () => clearInterval(interval);
  }, [streaming]);

  return (
    <div
      style={{
        background: '#04070d',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        overflow: 'hidden',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.85rem',
      }}
    >
      {/* PTY Header */}
      <div
        style={{
          padding: '12px 16px',
          background: '#0f172a',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }} />
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#eab308' }} />
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e' }} />
          </div>
          <span style={{ color: '#94a3b8', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Terminal size={14} /> agent-session: pid 48912 [Claude Code]
          </span>
        </div>

        {/* Throttler Metrics */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '0.78rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#34d399' }}>
            <Zap size={14} /> 16ms Buffer Frame Chunking (Active)
          </div>
          <div style={{ color: '#64748b' }}>Lines Streamed: <span style={{ color: '#f8fafc', fontWeight: 600 }}>{lineCount.toLocaleString()}</span></div>
          <button
            onClick={() => setStreaming(!streaming)}
            style={{
              background: 'transparent',
              border: 'none',
              color: streaming ? '#f59e0b' : '#10b981',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {streaming ? <Pause size={14} /> : <Play size={14} />}
            {streaming ? 'Pause Stream' : 'Resume'}
          </button>
        </div>
      </div>

      {/* Terminal Log Output */}
      <div
        style={{
          padding: '20px',
          minHeight: '260px',
          color: '#cbd5e1',
          lineHeight: 1.6,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div>
          <span style={{ color: '#38bdf8' }}>[Asterim SubprocessManager]</span> Process tree initialized for child PID 48912.
        </div>
        <div>
          <span style={{ color: '#34d399' }}>[Agent execution]</span> Analyzing codebase AST symbols via SymbolIndexer...
        </div>
        <div>
          <span style={{ color: '#fbbf24' }}>[PTY Stream]</span> Output rate: 12,450 lines/s. Backpressure throttling active (0 dropped frames).
        </div>
        <div style={{ color: '#94a3b8' }}>
          $ git status --porcelain
        </div>
        <div>
          <span style={{ color: '#10b981' }}>M</span> apps/server/src/services/AgentService.ts
        </div>
        <div>
          <span style={{ color: '#10b981' }}>M</span> packages/adapters/src/SessionManager.ts
        </div>
        <div>
          <span style={{ color: '#a855f7' }}>[Agent Action Proposal]</span> Proposed mutation to <span style={{ color: '#38bdf8' }}>ProcessTreeManager.ts</span>. Awaiting AST security guard clearance...
        </div>
      </div>
    </div>
  );
};
