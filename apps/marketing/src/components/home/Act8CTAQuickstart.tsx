import React, { useState } from 'react';
import { IconCheck, IconCopy } from '../common/MarketingIcons';

export const Act8CTAQuickstart: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText('npm install -g asterim');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="marketing-section" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingBottom: '120px' }}>
      <div
        style={{
          background: 'linear-gradient(180deg, #0d1424 0%, #070a10 100%)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '56px 36px',
          textAlign: 'center',
          maxWidth: '880px',
          margin: '0 auto'
        }}
      >
        <span className="section-tag" style={{ marginBottom: '16px' }}>ACT 8 // GET STARTED LOCAL-FIRST</span>
        
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(2rem, 4vw, 3rem)',
            fontWeight: 800,
            color: '#f8fafc',
            letterSpacing: '-0.03em',
            marginBottom: '16px'
          }}
        >
          Ready to Unify Your AI Coding Agents?
        </h2>

        <p
          style={{
            fontSize: '1.1rem',
            color: '#94a3b8',
            maxWidth: '620px',
            margin: '0 auto 36px auto',
            lineHeight: '1.6'
          }}
        >
          Install the local Asterim CLI control plane in 5 seconds. Open source, local-first, MIT licensed.
        </p>

        {/* Quickstart Command Pill */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 24px',
            background: '#04070d',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            borderRadius: '8px',
            fontFamily: 'var(--font-mono)',
            fontSize: '1rem',
            marginBottom: '36px'
          }}
        >
          <span style={{ color: '#10b981', fontWeight: 700 }}>$</span>
          <span style={{ color: '#f8fafc' }}>npm install -g asterim</span>
          <button
            onClick={handleCopy}
            title="Copy Quickstart Command"
            style={{
              background: 'transparent',
              border: 'none',
              color: copied ? '#10b981' : '#94a3b8',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              padding: '4px',
              marginLeft: '8px'
            }}
          >
            {copied ? <IconCheck size={18} color="#10b981" /> : <IconCopy size={18} color="#94a3b8" />}
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '20px', fontSize: '0.88rem', color: '#64748b', fontFamily: 'var(--font-mono)' }}>
          <span>✓ macOS (Apple Silicon &amp; Intel)</span>
          <span>✓ Linux (AppImage &amp; Deb)</span>
          <span>✓ Windows Subsystem for Linux</span>
        </div>
      </div>
    </section>
  );
};
