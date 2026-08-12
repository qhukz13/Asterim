import React from 'react';
import { IconX, IconCheck } from '../common/MarketingIcons';

export const Act2ControlPlane: React.FC = () => {
  return (
    <section className="marketing-section" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '104px 24px', maxWidth: '1280px' }}>
      <div className="section-header" style={{ marginBottom: '64px' }}>
        <span className="section-tag">CONTROL PLANE</span>
        <h2 className="section-title">Stop Managing Loose Terminal Windows.</h2>
        <p className="section-lead">
          AI coding agents are fast, but running 5 unmonitored CLI sessions across isolated terminal tabs leads to missing context, secret leaks, and unreviewed system modifications.
        </p>
      </div>

      {/* Asymmetric Split Screen: Unmonitored CLI vs Asterim Control Plane */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
        {/* Left Split: Raw Terminal Chaos */}
        <div
          style={{
            background: '#04070d',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
          }}
        >
          {/* Header */}
          <div style={{ padding: '14px 20px', background: 'rgba(239, 68, 68, 0.08)', borderBottom: '1px solid rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconX size={14} color="#ef4444" />
              </span>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f8fafc', fontFamily: 'var(--font-mono)' }}>
                UNMONITORED TERMINAL CHAOS
              </span>
            </div>
            <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              HIGH RISK
            </span>
          </div>

          {/* Simulated Raw Terminal Log */}
          <div style={{ padding: '20px', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', lineHeight: 1.65, color: '#94a3b8' }}>
            <div style={{ color: '#ef4444' }}>$ claude-code --dangerously-skip-permissions</div>
            <div style={{ color: '#64748b' }}>[bash] rm -rf ./config/secrets.env</div>
            <div style={{ color: '#eab308' }}>[WARN] API_KEY exposed in plain text history</div>
            <div style={{ color: '#ef4444' }}>[ERR] Git branch collision: main overwritten by agent-session-4</div>
            <div style={{ color: '#64748b' }}>[bash] curl -X POST https://untrusted-analytics.io/telemetry</div>
            <div style={{ color: '#ef4444', marginTop: '12px', fontWeight: 700 }}>
              ⚠ CRITICAL: 3 parallel agent sessions mutated shared workspace files without human approval.
            </div>
          </div>
        </div>

        {/* Right Split: Asterim Local Control Plane */}
        <div
          style={{
            background: '#070a10',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
          }}
        >
          {/* Header */}
          <div style={{ padding: '14px 20px', background: 'rgba(16, 185, 129, 0.08)', borderBottom: '1px solid rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconCheck size={14} color="#10b981" />
              </span>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f8fafc', fontFamily: 'var(--font-mono)' }}>
                ASTERIM LOCAL CONTROL PLANE
              </span>
            </div>
            <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              PROTECTED
            </span>
          </div>

          {/* Simulated Protected Control Plane Log */}
          <div style={{ padding: '20px', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', lineHeight: 1.65, color: '#cbd5e1' }}>
            <div style={{ color: '#10b981' }}>$ asterim run --agent claude-code --workspace core</div>
            <div style={{ color: '#38bdf8' }}>[AST Parser] Pre-computation clearance check active</div>
            <div style={{ color: '#10b981' }}>[AST Guard] Intercepted destructive mutation request: rm -rf ./config</div>
            <div style={{ color: '#34d399', background: 'rgba(16, 185, 129, 0.1)', padding: '4px 8px', borderRadius: '4px', display: 'inline-block', margin: '6px 0' }}>
              ✓ PROMISE GATE: Execution held for human review.
            </div>
            <div style={{ color: '#cbd5e1' }}>[Enclave] Secrets masked. Data remains 100% on local machine.</div>
            <div style={{ color: '#10b981', marginTop: '12px', fontWeight: 700 }}>
              ✓ STABLE: Multi-thread isolation active. All agent actions audited and reversible.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
