import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export const WhyAsterimSection: React.FC = () => {
  return (
    <section className="marketing-section">
      <div className="section-header">
        <span className="section-tag">Product Architecture</span>
        <h2 className="section-title">
          From Loose Terminals to an Engineering Operating System
        </h2>
        <p className="section-lead">
          AI coding agents (Claude Code, Aider, custom scripts) are powerful, but running them in unmonitored terminal tabs introduces operational friction and safety risks.
        </p>
      </div>

      {/* 2-Column Comparison Layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '32px',
        }}
      >
        {/* Left Column: Chaotic Loose Terminals */}
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: 'var(--radius-lg)',
            padding: '36px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#f87171', fontWeight: 700, fontSize: '1.1rem', marginBottom: '20px' }}>
            <AlertTriangle size={20} />
            <span>The Terminal Chaos Problem</span>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <li style={{ display: 'flex', gap: '12px', color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.5 }}>
              <span style={{ color: '#f87171', fontWeight: 700 }}>•</span>
              <div>
                <strong style={{ color: '#f8fafc' }}>Unvetted Command Execution:</strong> Agents running destructive shell commands (<code>rm -rf</code>, accidental path traversal) without real-time AST validation.
              </div>
            </li>
            <li style={{ display: 'flex', gap: '12px', color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.5 }}>
              <span style={{ color: '#f87171', fontWeight: 700 }}>•</span>
              <div>
                <strong style={{ color: '#f8fafc' }}>Orphaned Subprocesses:</strong> Detached agent PID processes consuming CPU and leaking memory after terminal windows close.
              </div>
            </li>
            <li style={{ display: 'flex', gap: '12px', color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.5 }}>
              <span style={{ color: '#f87171', fontWeight: 700 }}>•</span>
              <div>
                <strong style={{ color: '#f8fafc' }}>Mixed Project Secrets:</strong> Leaking client API keys or shared environment variables across unrelated repositories.
              </div>
            </li>
          </ul>
        </div>

        {/* Right Column: Asterim Workstation Control Plane */}
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-accent)',
            borderRadius: 'var(--radius-lg)',
            padding: '36px',
            boxShadow: '0 0 30px rgba(16, 185, 129, 0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--accent-green-hover)', fontWeight: 700, fontSize: '1.1rem', marginBottom: '20px' }}>
            <CheckCircle2 size={20} />
            <span>The Asterim Workstation Control Plane</span>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <li style={{ display: 'flex', gap: '12px', color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.5 }}>
              <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>✓</span>
              <div>
                <strong style={{ color: '#f8fafc' }}>Hardened AST Command Security:</strong> Intercept dangerous shell commands before execution with real-time AST syntax parsing and diff previews.
              </div>
            </li>
            <li style={{ display: 'flex', gap: '12px', color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.5 }}>
              <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>✓</span>
              <div>
                <strong style={{ color: '#f8fafc' }}>Process Lifecycle Management:</strong> Managed PTY execution trees with 16ms backpressure throttling and zombie process sweepers.
              </div>
            </li>
            <li style={{ display: 'flex', gap: '12px', color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.5 }}>
              <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>✓</span>
              <div>
                <strong style={{ color: '#f8fafc' }}>Scoped Environment Presets:</strong> Isolate credentials, MCP servers, and project paths per workspace (Personal, Company, Client).
              </div>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
};
