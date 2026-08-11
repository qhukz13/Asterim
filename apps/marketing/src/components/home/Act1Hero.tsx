import React, { useState } from 'react';
import { IconCheck, IconCopy, IconArrowRight } from '../common/MarketingIcons';

export const Act1Hero: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText('npm install -g asterim');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="marketing-section" style={{ paddingTop: '80px', paddingBottom: '64px' }}>
      <div style={{ textAlign: 'center', maxWidth: '840px', margin: '0 auto' }}>
        {/* Status Pill Header */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 14px',
            borderRadius: '100px',
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            marginBottom: '28px'
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#34d399', letterSpacing: '0.02em' }}>
            ASTERIM v2.4 RELEASED — LOCAL-FIRST AI AGENT CONTROL PLANE
          </span>
        </div>

        {/* Hero Title */}
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(2.75rem, 5.5vw, 4.5rem)',
            fontWeight: 800,
            letterSpacing: '-0.035em',
            lineHeight: 1.05,
            color: '#f8fafc',
            marginBottom: '24px'
          }}
        >
          The Control Plane for the AI Coding Agents You Already Use.
        </h1>

        {/* Lead Subtitle */}
        <p
          style={{
            fontSize: 'clamp(1.05rem, 2vw, 1.25rem)',
            color: '#94a3b8',
            lineHeight: 1.6,
            marginBottom: '36px',
            maxWidth: '720px',
            margin: '0 auto 36px auto'
          }}
        >
          Transform disconnected terminal chaos into a unified, observable workstation.
          Orchestrate Claude Code, Aider, and custom agent swarms with AST-level security gates.
        </p>

        {/* Quickstart Command Bar + Action CTAs */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            marginBottom: '48px'
          }}
        >
          {/* Terminal Command Pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 18px',
              background: '#04070d',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '8px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.9rem'
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

          <a href="#workstation-sandbox" className="btn-primary">
            Explore Interactive Sandbox
            <IconArrowRight size={16} />
          </a>
        </div>
      </div>
    </section>
  );
};
