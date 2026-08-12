import React from 'react';
import { IconSmartphone } from '../common/MarketingIcons';

export const Act7RemoteRelaySection: React.FC = () => {
  return (
    <section className="marketing-section" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="section-header">
        <span className="section-tag">LOCAL-FIRST ARCHITECTURE</span>
        <h2 className="section-title">Local Heavy Lift. Remote Control.</h2>
        <p className="section-lead">
          Heavy agent LLM tool calls and PTY sessions run locally on your desktop machine. Monitor execution, stream logs, and approve AST security gates remotely from your phone or web browser via encrypted cloud relay.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px', alignItems: 'center' }}>
        {/* Desktop Heavy Execution */}
        <div style={{ background: '#0d1424', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>Local Workstation Server</h3>
          </div>
          <p style={{ fontSize: '0.9rem', color: '#94a3b8', lineHeight: '1.6', marginBottom: '16px' }}>
            Full source code, git history, and local filesystem files remain exclusively on your local workstation machine. Zero source code is stored on cloud servers.
          </p>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: '#10b981', background: '#04070d', padding: '10px 14px', borderRadius: '6px' }}>
            Workstation PTY: 127.0.0.1:4242 [ENCRYPTED TUNNEL]
          </div>
        </div>

        {/* Encrypted Mobile/Web Relay */}
        <div style={{ background: '#0d1424', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '12px', padding: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <IconSmartphone size={20} color="#10b981" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>Mobile &amp; Web Control Plane</h3>
          </div>
          <p style={{ fontSize: '0.9rem', color: '#cbd5e1', lineHeight: '1.6', marginBottom: '16px' }}>
            Step away from your desk while long-running agent missions complete. Receive instant push notifications on AST security approvals and stream live telemetry logs.
          </p>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: '#38bdf8', background: '#04070d', padding: '10px 14px', borderRadius: '6px' }}>
            Cloud Relay: relay.asterim.dev [E2E TLS ENCRYPTED]
          </div>
        </div>
      </div>
    </section>
  );
};
