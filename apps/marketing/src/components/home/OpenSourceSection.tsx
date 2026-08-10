import React from 'react';
import { HardDrive, Lock, FileCode2 } from 'lucide-react';

export const OpenSourceSection: React.FC = () => {
  return (
    <section className="marketing-section">
      <div
        className="surface-card"
        style={{
          padding: '56px 40px',
          borderColor: 'var(--border-accent)',
          background: 'radial-gradient(circle at 50% 0%, var(--accent-green-subtle), transparent 70%), var(--bg-surface)',
        }}
      >
        <div className="section-header" style={{ marginBottom: '40px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '20px',
              background: 'var(--accent-green-bg)',
              color: 'var(--accent-green-hover)',
              fontSize: '0.82rem',
              fontWeight: 600,
              marginBottom: '16px',
            }}
          >
            <FileCode2 size={16} /> Open Core & Local-First Philosophy
          </div>
          <h2 style={{ fontSize: 'clamp(1.8rem, 3vw, 2.5rem)', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '16px' }}>
            Open Source Core. Zero Code Telemetry.
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', maxWidth: '640px', margin: '0 auto', lineHeight: 1.6 }}>
            Asterim Core is distributed under the liberal MIT License. Your source code, AST indexes, terminal outputs, and prompt logs remain 100% local to your machine.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '24px',
          }}
        >
          <div style={{ background: '#04070d', padding: '24px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ color: 'var(--accent-green)', marginBottom: '12px' }}>
              <FileCode2 size={24} />
            </div>
            <h4 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.05rem', marginBottom: '8px' }}>
              MIT Open License
            </h4>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.5, margin: 0 }}>
              The local engine and client interface are completely open source under the MIT License for developer trust and community auditability.
            </p>
          </div>

          <div style={{ background: '#04070d', padding: '24px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ color: '#38bdf8', marginBottom: '12px' }}>
              <HardDrive size={24} />
            </div>
            <h4 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.05rem', marginBottom: '8px' }}>
              100% Offline Capability
            </h4>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.5, margin: 0 }}>
              Works flawlessly without internet access. Run local agents (Ollama, vLLM) with zero cloud connection required.
            </p>
          </div>

          <div style={{ background: '#04070d', padding: '24px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ color: '#a855f7', marginBottom: '12px' }}>
              <Lock size={24} />
            </div>
            <h4 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.05rem', marginBottom: '8px' }}>
              Strict Data Boundaries
            </h4>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.5, margin: 0 }}>
              No proprietary code or git diffs are ever transmitted to Asterim cloud servers. Cloud identity is strictly separated from local execution.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
