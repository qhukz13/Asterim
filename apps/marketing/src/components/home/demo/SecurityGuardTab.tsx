import React, { useState } from 'react';
import { ShieldCheck, Check, X, FileDiff, Lock } from 'lucide-react';

export const SecurityGuardTab: React.FC = () => {
  const [decision, setDecision] = useState<'pending' | 'approved' | 'rejected'>('pending');

  return (
    <div
      style={{
        background: '#0f172a',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      {/* Header Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#34d399',
              fontSize: '0.8rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <ShieldCheck size={16} /> AST Security Evaluation: PASSED
          </div>
          <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Sandbox Boundary: Strict Workspace Scope</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b', fontSize: '0.8rem' }}>
          <Lock size={14} style={{ color: '#10b981' }} /> Path Traversal Sandbox Guard Active
        </div>
      </div>

      {/* Evaluated Command Box */}
      <div
        style={{
          background: '#04070d',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '8px',
          padding: '16px',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.88rem',
        }}
      >
        <div style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: '6px' }}>Proposed Shell Command:</div>
        <div style={{ color: '#f8fafc', fontWeight: 500 }}>
          $ pnpm --filter @asterim/server exec node ./scripts/build-sandbox.js --scope=isolated
        </div>
      </div>

      {/* Diff Inspector Preview */}
      <div
        style={{
          background: '#04070d',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '8px',
          padding: '16px',
          fontSize: '0.85rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#38bdf8', marginBottom: '10px', fontWeight: 600 }}>
          <FileDiff size={16} /> File Mutation Diff Inspection:
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
          <div style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '2px 8px', borderRadius: '4px' }}>
            - const enableUnsafeShell = true;
          </div>
          <div style={{ color: '#22c55e', background: 'rgba(34, 197, 94, 0.1)', padding: '2px 8px', borderRadius: '4px', marginTop: '4px' }}>
            + const enableUnsafeShell = false; // AST Command Security Enforced
          </div>
        </div>
      </div>

      {/* Decision Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '8px' }}>
        <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
          Status:{' '}
          <span
            style={{
              color: decision === 'approved' ? '#22c55e' : decision === 'rejected' ? '#f87171' : '#fbbf24',
              fontWeight: 600,
            }}
          >
            {decision === 'approved' ? 'Command Approved & Executing' : decision === 'rejected' ? 'Execution Intercepted & Blocked' : 'Awaiting User Clearance'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => setDecision('rejected')}
            disabled={decision !== 'pending'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '6px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: decision === 'pending' ? 'pointer' : 'not-allowed',
            }}
          >
            <X size={16} /> Reject Execution
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
              background: '#10b981',
              border: 'none',
              color: '#042114',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: decision === 'pending' ? 'pointer' : 'not-allowed',
            }}
          >
            <Check size={16} /> Approve Action
          </button>
        </div>
      </div>
    </div>
  );
};
