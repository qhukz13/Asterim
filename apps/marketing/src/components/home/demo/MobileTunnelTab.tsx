import React from 'react';
import { Wifi, Bell } from 'lucide-react';

export const MobileTunnelTab: React.FC = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Relay Header Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Wifi size={18} style={{ color: '#fbbf24' }} />
          <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: '0.9rem' }}>
            E2E Relay Tunnel Status: CONNECTED
          </span>
          <span className="status-badge planned" style={{ fontSize: '0.7rem' }}>
            PHASE 5 BETA
          </span>
        </div>

        <div style={{ color: '#64748b', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
          relay.asterim.dev:443 (Noise Protocol E2EE)
        </div>
      </div>

      {/* Mobile Push Notification Mockup Card */}
      <div
        style={{
          background: '#04070d',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
          padding: '20px 24px',
          maxWidth: '440px',
          margin: '0 auto',
          width: '100%',
          boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#38bdf8', fontWeight: 600, fontSize: '0.85rem' }}>
            <Bell size={16} /> Asterim Mobile Push Prompt
          </div>
          <span style={{ color: '#64748b', fontSize: '0.75rem' }}>Just Now</span>
        </div>

        <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '0.92rem', marginBottom: '6px' }}>
          Remote Approval Request
        </div>
        <p style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.5, marginBottom: '16px' }}>
          Agent <strong style={{ color: '#cbd5e1' }}>Claude Code</strong> requests permission to execute <code>git push origin main</code> on workstation <code>macbook-pro</code>.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <button
            style={{
              padding: '8px',
              borderRadius: '6px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              fontWeight: 600,
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
          >
            Deny
          </button>
          <button
            style={{
              padding: '8px',
              borderRadius: '6px',
              background: 'var(--accent-green)',
              border: 'none',
              color: '#042114',
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
          >
            Approve Remote
          </button>
        </div>
      </div>
    </div>
  );
};
