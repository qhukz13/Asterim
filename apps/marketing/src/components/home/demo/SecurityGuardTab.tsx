import React, { useState } from 'react';
import { ShieldCheck, Check, X } from 'lucide-react';

export const SecurityGuardTab: React.FC = () => {
  const [decision, setDecision] = useState<'pending' | 'approved' | 'rejected'>('pending');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Hazard Header Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldCheck size={18} style={{ color: '#f87171' }} />
          <span style={{ color: '#f87171', fontWeight: 700, fontSize: '0.9rem' }}>
            CRITICAL HAZARD DETECTED
          </span>
          <span className="status-badge available" style={{ fontSize: '0.7rem' }}>
            AVAILABLE NOW
          </span>
        </div>

        <div style={{ color: '#64748b', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
          AST Scanner: Path Traversal Bounds Check
        </div>
      </div>

      {/* Flagged Command Details */}
      <div
        style={{
          background: '#04070d',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '10px',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ color: '#94a3b8', fontSize: '0.82rem', fontWeight: 600 }}>
          Target Shell Execution Command:
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', color: '#f87171', fontSize: '0.9rem', background: 'rgba(239, 68, 68, 0.1)', padding: '8px 12px', borderRadius: '6px' }}>
          $ rm -rf /var/log/asterim-daemon.log
        </div>

        <div style={{ color: '#cbd5e1', fontSize: '0.85rem', lineHeight: 1.5 }}>
          ⚠️ <strong style={{ color: '#f8fafc' }}>Reason:</strong> Command matches recursive un-scoped deletion pattern outside project root boundary (<code>/var/log</code>).
        </div>
      </div>

      {/* Decision Actions Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', paddingTop: '8px' }}>
        <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
          Status: {' '}
          <span style={{ fontWeight: 700, color: decision === 'approved' ? '#34d399' : decision === 'rejected' ? '#f87171' : '#fbbf24' }}>
            {decision === 'approved' ? '✓ Command Approved & Executed' : decision === 'rejected' ? '✗ Execution Blocked & Aborted' : '⏳ Awaiting Developer Clearance'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setDecision('rejected')}
            disabled={decision !== 'pending'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '6px',
              background: decision === 'rejected' ? 'rgba(239, 68, 68, 0.2)' : '#04070d',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#f87171',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: decision === 'pending' ? 'pointer' : 'default',
            }}
          >
            <X size={16} /> Reject & Terminate
          </button>

          <button
            onClick={() => setDecision('approved')}
            disabled={decision !== 'pending'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '6px',
              background: decision === 'approved' ? 'var(--accent-green-hover)' : 'var(--accent-green)',
              border: 'none',
              color: '#042114',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: decision === 'pending' ? 'pointer' : 'default',
            }}
          >
            <Check size={16} /> Approve & Continue
          </button>
        </div>
      </div>
    </div>
  );
};
