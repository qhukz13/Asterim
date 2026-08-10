import React, { useState } from 'react';
import { Wifi, Bell, Check, X } from 'lucide-react';

export const MobileTunnelTab: React.FC = () => {
  const [remoteDecision, setRemoteDecision] = useState<'pending' | 'approved' | 'rejected'>('pending');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Relay Status Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Wifi size={18} style={{ color: 'var(--accent-green)' }} />
          <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.92rem' }}>
            E2E Relay Tunnel: relay.asterim.dev:443
          </span>
        </div>

        <span className="status-badge beta" style={{ fontSize: '0.7rem' }}>
          PHASE 5 BETA
        </span>
      </div>

      {/* Interactive Push Approval Card Mockup */}
      <div
        style={{
          background: '#04070d',
          border: '1px solid var(--border-accent)',
          borderRadius: 'var(--radius-md)',
          padding: '24px',
          maxWidth: '480px',
          margin: '0 auto',
          width: '100%',
          boxShadow: '0 0 24px rgba(16, 185, 129, 0.12)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-green-hover)', fontSize: '0.82rem', fontWeight: 700 }}>
            <Bell size={16} /> Asterim Mobile Push Prompt
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Just now</span>
        </div>

        <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', marginBottom: '6px' }}>
          Approval Required: Remote Workstation
        </div>

        <div style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.5, marginBottom: '16px' }}>
          Claude Code v0.4.5 requests authorization to execute command on local workstation:
        </div>

        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--accent-green-hover)', background: 'rgba(16, 185, 129, 0.1)', padding: '10px 12px', borderRadius: '4px', marginBottom: '20px' }}>
          $ git push origin main --force-with-lease
        </div>

        {/* Action Clearance Buttons */}
        {remoteDecision === 'pending' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <button
              onClick={() => setRemoteDecision('rejected')}
              className="btn-secondary"
              style={{ padding: '10px', fontSize: '0.85rem', color: '#f87171', justifyContent: 'center' }}
            >
              <X size={16} /> Deny Push
            </button>

            <button
              onClick={() => setRemoteDecision('approved')}
              className="btn-primary"
              style={{ padding: '10px', fontSize: '0.85rem', justifyContent: 'center' }}
            >
              <Check size={16} /> Approve Remote
            </button>
          </div>
        ) : (
          <div
            style={{
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
              background: remoteDecision === 'approved' ? 'var(--accent-green-bg)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${remoteDecision === 'approved' ? 'var(--border-accent)' : 'rgba(239, 68, 68, 0.3)'}`,
              color: remoteDecision === 'approved' ? 'var(--accent-green-hover)' : '#f87171',
              fontWeight: 700,
              fontSize: '0.9rem',
              textAlign: 'center',
            }}
          >
            {remoteDecision === 'approved' ? '✓ Remote Approval Transmitted to Workstation' : '✕ Remote Execution Denied by Mobile Push'}
          </div>
        )}
      </div>
    </div>
  );
};
