import React, { useState, useEffect } from 'react';
import { Zap, Play, Pause } from 'lucide-react';

export const AgentStreamTab: React.FC = () => {
  const [streaming, setStreaming] = useState(true);
  const [lines, setLines] = useState<string[]>([
    '[asterim::pty] Spawning agent adapter Claude Code (PID 4912)...',
    '[asterim::ast] Analyzing workspace AST symbols across 142 files...',
    '[asterim::git] Attached repository status: clean on branch main',
    'Claude> Inspecting src/services/agent/ProcessTreeManager.ts',
    'Claude> Adding SIGTERM cascading shutdown handler with 5000ms timeout',
  ]);

  useEffect(() => {
    if (!streaming) return;
    const interval = setInterval(() => {
      setLines((prev) => {
        if (prev.length >= 8) {
          return [
            '[asterim::pty] Spawning agent adapter Claude Code (PID 4912)...',
            '[asterim::ast] Analyzing workspace AST symbols across 142 files...',
            '[asterim::git] Attached repository status: clean on branch main',
            'Claude> Inspecting src/services/agent/ProcessTreeManager.ts',
            'Claude> Adding SIGTERM cascading shutdown handler with 5000ms timeout',
          ];
        }
        const updates = [
          '[asterim::security] Command verified: tsc -b (AST risk: CLEAR)',
          'Claude> Build output clean in 840ms. Workstation execution ready.',
          '[asterim::pty] Throttler active: 16ms frame rate (60 FPS output)',
        ];
        return [...prev, updates[prev.length - 5]];
      });
    }, 2200);
    return () => clearInterval(interval);
  }, [streaming]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Top Controls Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-green-hover)', fontSize: '0.85rem', fontWeight: 600 }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
            Claude Code v0.4.5 (PID 4912)
          </div>
          <span className="status-badge available" style={{ fontSize: '0.7rem' }}>
            AVAILABLE NOW
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
            <Zap size={14} style={{ color: '#10b981' }} />
            16ms Throttled (60 FPS)
          </div>

          <button
            onClick={() => setStreaming(!streaming)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-subtle)',
              color: '#f8fafc',
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
          >
            {streaming ? <Pause size={12} /> : <Play size={12} />}
            {streaming ? 'Pause Stream' : 'Resume Stream'}
          </button>
        </div>
      </div>

      {/* Live Terminal Log Frame */}
      <div
        style={{
          background: '#04070d',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '16px 20px',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          lineHeight: 1.7,
          minHeight: '200px',
        }}
      >
        {lines.map((line, idx) => {
          const isSystem = line.startsWith('[asterim');
          const isClaude = line.startsWith('Claude>');
          return (
            <div key={idx} style={{ display: 'flex', gap: '12px', alignItems: 'baseline' }}>
              <span style={{ color: '#475569', fontSize: '0.75rem', width: '20px', textAlign: 'right', flexShrink: 0 }}>
                {idx + 1}
              </span>
              <span
                style={{
                  color: isSystem ? '#38bdf8' : isClaude ? '#34d399' : '#cbd5e1',
                  wordBreak: 'break-all',
                }}
              >
                {line}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
