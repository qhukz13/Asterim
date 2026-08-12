import React, { useState } from 'react';
import { IconCheck, IconCopy, IconArrowRight } from '../common/MarketingIcons';
import { AsterimWorkstationSandbox } from './AsterimWorkstationSandbox';

export const Act1Hero: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText('npx asterim');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="marketing-section" style={{ paddingTop: '72px', paddingBottom: '96px', maxWidth: '1280px' }}>
      {/* Top Hero Messaging & Copy Composition */}
      <div style={{ textAlign: 'center', maxWidth: '920px', margin: '0 auto 56px auto' }}>
        {/* Release Pill Badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '9px',
            padding: '7px 16px',
            borderRadius: '100px',
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            marginBottom: '28px',
            lineHeight: 1
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981', flexShrink: 0 }} />
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#34d399', letterSpacing: '0.04em', fontFamily: 'var(--font-mono)', lineHeight: 1.2 }}>
            Asterim Open-Core v1.0 Released
          </span>
        </div>

        {/* H1 Headline */}
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(2.75rem, 5.5vw, 4.75rem)',
            fontWeight: 700,
            letterSpacing: '-0.035em',
            lineHeight: 1.05,
            color: '#f8fafc',
            marginBottom: '24px'
          }}
        >
          The Operating System for AI Engineering Teams
        </h1>

        {/* Lead Subhead */}
        <p
          style={{
            fontSize: 'clamp(1.1rem, 2.2vw, 1.25rem)',
            color: '#94a3b8',
            lineHeight: 1.6,
            marginBottom: '36px',
            maxWidth: '740px',
            margin: '0 auto 36px auto'
          }}
        >
          Orchestrate autonomous AI coding agents directly on your workstation. Keep their work isolated, observe what they modify, and stay in complete control.
        </p>

        {/* CTA Composition Row */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px'
          }}
        >
          {/* Primary Emerald Button */}
          <a href="/account/register" className="btn-primary" style={{ padding: '14px 28px', fontSize: '1.0rem' }}>
            Get Started Free
            <IconArrowRight size={18} />
          </a>

          {/* Shell Command Snippet Pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 18px',
              background: '#04070d',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '8px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.9rem'
            }}
          >
            <span style={{ color: '#10b981', fontWeight: 700 }}>$</span>
            <span style={{ color: '#f8fafc' }}>npx asterim</span>
            <button
              onClick={handleCopy}
              title="Copy Shell Snippet"
              style={{
                background: 'transparent',
                border: 'none',
                color: copied ? '#10b981' : '#64748b',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px',
                marginLeft: '4px',
                transition: 'color 0.15s ease'
              }}
            >
              {copied ? <IconCheck size={16} color="#10b981" /> : <IconCopy size={16} color="#94a3b8" />}
            </button>
          </div>
        </div>
      </div>

      {/* Live Interactive Asterim Workstation Simulator */}
      <AsterimWorkstationSandbox />
    </section>
  );
};

