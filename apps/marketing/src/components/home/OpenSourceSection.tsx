import React from 'react';
import { HardDrive, Lock, FileCode2 } from 'lucide-react';

export const OpenSourceSection: React.FC = () => {
  return (
    <section
      style={{
        padding: '80px 24px',
        maxWidth: '1240px',
        margin: '0 auto',
        width: '100%',
      }}
    >
      <div
        style={{
          background: 'radial-gradient(circle at 50% 0%, rgba(16, 185, 129, 0.1), transparent 70%), #0f172a',
          border: '1px solid rgba(16, 185, 129, 0.25)',
          borderRadius: '24px',
          padding: '56px 40px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '20px',
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#34d399',
              fontSize: '0.85rem',
              fontWeight: 600,
              marginBottom: '16px',
            }}
          >
            <FileCode2 size={16} /> Open Core & Privacy First
          </div>
          <h2 style={{ fontSize: 'clamp(1.8rem, 3vw, 2.5rem)', fontWeight: 800, color: '#ffffff', marginBottom: '16px' }}>
            Open Source Core. Zero Code Telemetry.
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '1.1rem', maxWidth: '640px', margin: '0 auto', lineHeight: 1.6 }}>
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
          <div style={{ background: '#04070d', padding: '24px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <div style={{ color: '#10b981', marginBottom: '12px' }}>
              <FileCode2 size={24} />
            </div>
            <h4 style={{ color: '#f8fafc', fontWeight: 700, fontSize: '1.05rem', marginBottom: '8px' }}>
              MIT Open License
            </h4>
            <p style={{ color: '#94a3b8', fontSize: '0.88rem', lineHeight: 1.5, margin: 0 }}>
              The local engine and client interface are completely open source to ensure developer trust and community extensibility.
            </p>
          </div>

          <div style={{ background: '#04070d', padding: '24px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <div style={{ color: '#38bdf8', marginBottom: '12px' }}>
              <HardDrive size={24} />
            </div>
            <h4 style={{ color: '#f8fafc', fontWeight: 700, fontSize: '1.05rem', marginBottom: '8px' }}>
              100% Offline Capability
            </h4>
            <p style={{ color: '#94a3b8', fontSize: '0.88rem', lineHeight: 1.5, margin: 0 }}>
              Works flawlessly without internet access. Run local agents (Ollama, vLLM) with zero cloud connection required.
            </p>
          </div>

          <div style={{ background: '#04070d', padding: '24px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <div style={{ color: '#a855f7', marginBottom: '12px' }}>
              <Lock size={24} />
            </div>
            <h4 style={{ color: '#f8fafc', fontWeight: 700, fontSize: '1.05rem', marginBottom: '8px' }}>
              Strict Data Boundaries
            </h4>
            <p style={{ color: '#94a3b8', fontSize: '0.88rem', lineHeight: 1.5, margin: 0 }}>
              No proprietary code or git diffs are ever transmitted to Asterim cloud servers. Cloud identity is strictly separated from local execution.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
