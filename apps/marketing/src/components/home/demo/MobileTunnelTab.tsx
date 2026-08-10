import React from 'react';
import { Smartphone, Shield, Wifi, Bell, Check } from 'lucide-react';

export const MobileTunnelTab: React.FC = () => {
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
      {/* Tunnel Connection Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              color: '#38bdf8',
              fontSize: '0.8rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Wifi size={14} /> E2E Encrypted Cloud Relay: Active
          </div>
          <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Latency: 28ms • TLS 1.3 Tunnel</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b', fontSize: '0.8rem' }}>
          <Shield size={14} style={{ color: '#10b981' }} /> Zero Plaintext Cloud Storage
        </div>
      </div>

      {/* Mobile Device Mockup Container */}
      <div
        style={{
          background: '#04070d',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '420px',
          margin: '0 auto',
          width: '100%',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
        }}
      >
        {/* Mobile Header Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', color: '#f8fafc' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.95rem' }}>
            <Smartphone size={18} style={{ color: '#10b981' }} /> Asterim Mobile Control
          </div>
          <span style={{ fontSize: '0.75rem', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
            Phase 5 Beta
          </span>
        </div>

        {/* Push Approval Notification Card */}
        <div
          style={{
            background: '#0f172a',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '10px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fbbf24', fontSize: '0.85rem', fontWeight: 600 }}>
            <Bell size={16} /> Remote Approval Required
          </div>

          <div style={{ color: '#f8fafc', fontSize: '0.88rem', lineHeight: 1.5 }}>
            Agent <strong>Claude Code</strong> on Workstation <em>dev-macbook-pro</em> requests permission to execute <code>git push origin main</code>.
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
            <button
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: '6px',
                background: '#10b981',
                border: 'none',
                color: '#042114',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <Check size={14} /> Approve via Mobile
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
