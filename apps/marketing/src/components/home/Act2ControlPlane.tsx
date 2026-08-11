import React from 'react';
import { IconX, IconCheck } from '../common/MarketingIcons';

export const Act2ControlPlane: React.FC = () => {
  return (
    <section className="marketing-section" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="section-header">
        <span className="section-tag">ACT 2 // CONTROL PLANE VS CHAOS</span>
        <h2 className="section-title">Stop Managing Loose Terminal Windows.</h2>
        <p className="section-lead">
          AI coding agents are fast, but running 5 unmonitored CLI sessions across isolated terminal tabs leads to missing context, secret leaks, and unreviewed system modifications.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
        {/* Left Split: Terminal Chaos */}
        <div
          style={{
            background: '#0a0d14',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '12px',
            padding: '28px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <span style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IconX size={16} color="#ef4444" />
            </span>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>Disconnected CLI Chaos</h3>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.92rem', color: '#94a3b8' }}>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ color: '#ef4444', fontWeight: 700 }}>✕</span>
              <span><strong>Unmonitored Commands:</strong> Agents execute bash commands directly without pre-computation AST parsing.</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ color: '#ef4444', fontWeight: 700 }}>✕</span>
              <span><strong>Context Collisions:</strong> Parallel sessions overwrite shared files and git branches unexpectedly.</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ color: '#ef4444', fontWeight: 700 }}>✕</span>
              <span><strong>Secret Leakage:</strong> Production DB connection strings and API tokens leak across terminal histories.</span>
            </li>
          </ul>
        </div>

        {/* Right Split: Asterim Unified Control Plane */}
        <div
          style={{
            background: '#0d1424',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '12px',
            padding: '28px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <span style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IconCheck size={16} color="#10b981" />
            </span>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>Asterim Local Control Plane</h3>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.92rem', color: '#cbd5e1' }}>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span>
              <span><strong>AST Guard Interception:</strong> Zero-trust clearance rules intercept risky CLI execution with promise gates.</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span>
              <span><strong>Multi-Thread Isolation:</strong> Each agent runs in a scoped PTY thread with its own state telemetry.</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span>
              <span><strong>Scoped Environments:</strong> Environment variables and credentials are enclave-isolated per workspace.</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
};
