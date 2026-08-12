import React from 'react';
import { IconShield } from '../common/MarketingIcons';

export const Act6SecurityGuardSection: React.FC = () => {
  return (
    <section className="marketing-section" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="section-header">
        <span className="section-tag">SECURITY &amp; APPROVALS</span>
        <h2 className="section-title">Zero-Trust Command Interception.</h2>
        <p className="section-lead">
          Traditional agents run commands blind. Asterim parses CLI command AST trees before execution, scoring hazard severity levels and holding high-risk operations behind a promise clearance gate.
        </p>
      </div>

      <div style={{ background: '#0a0d14', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '4px 10px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', fontWeight: 700, marginBottom: '16px' }}>
              <IconShield size={14} color="#ef4444" />
              INTERCEPTED HAZARD #pr-98214
            </div>

            <h3 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', marginBottom: '12px', letterSpacing: '-0.02em' }}>
              Real-Time Promise Gate Analysis
            </h3>

            <p style={{ fontSize: '0.94rem', color: '#94a3b8', lineHeight: '1.65', marginBottom: '20px' }}>
              When an agent tool call attempts to modify system files, reset git branches, or invoke administrative binaries (`sudo`, `systemctl`, `rm -rf`), execution pauses immediately until human clearance is signaled.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.86rem', color: '#cbd5e1', fontFamily: 'var(--font-mono)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#10b981' }}>✓</span>
                <span>AST Command Parsing &amp; Token Scoring</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#10b981' }}>✓</span>
                <span>Promise-Intercepted Execution Pause (0% CPU leakage)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#10b981' }}>✓</span>
                <span>Immutable SQLite Audit Trail Logging</span>
              </div>
            </div>
          </div>

          <div style={{ background: '#04070d', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', padding: '20px', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
            <div style={{ color: '#64748b', marginBottom: '10px' }}>// AST Security Interceptor log</div>
            <div style={{ color: '#ef4444', marginBottom: '6px' }}>[ALERT] Hazardous command detected in thread #tr-8942</div>
            <div style={{ color: '#cbd5e1', background: '#090e1a', padding: '8px 12px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.3)', marginBottom: '12px' }}>
              &gt; rm -rf /var/log/app.log &amp;&amp; sudo systemctl restart nginx
            </div>
            <div style={{ color: '#94a3b8', marginBottom: '4px' }}>Risk Assessment: <span style={{ color: '#ef4444', fontWeight: 700 }}>LEVEL 4 (CRITICAL)</span></div>
            <div style={{ color: '#94a3b8', marginBottom: '12px' }}>Status: <span style={{ color: '#fbbf24' }}>AWAITING HUMAN APPROVAL...</span></div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <span style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', padding: '4px 10px', borderRadius: '4px', fontWeight: 600 }}>Reject</span>
              <span style={{ background: '#10b981', color: '#042114', padding: '4px 10px', borderRadius: '4px', fontWeight: 700 }}>Approve &amp; Exec</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
