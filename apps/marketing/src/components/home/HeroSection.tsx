import React from 'react';
import { ArrowRight, BookOpen, ShieldCheck } from 'lucide-react';
import { TerminalCopyBlock } from '../common/TerminalCopyBlock';

interface HeroSectionProps {
  navigate: (path: string) => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ navigate }) => {
  return (
    <section className="marketing-section" style={{ textAlign: 'center', paddingTop: '80px', paddingBottom: '64px' }}>
      {/* Version Status Pill */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'center' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            borderRadius: '20px',
            background: 'var(--accent-green-bg)',
            border: '1px solid var(--border-accent)',
            fontSize: '0.82rem',
            color: 'var(--accent-green-hover)',
            fontWeight: 600,
          }}
        >
          <ShieldCheck size={14} />
          <span>Asterim v0.4.5 — Hardened Local Control Plane</span>
          <span style={{ color: '#64748b' }}>•</span>
          <span className="status-badge available" style={{ fontSize: '0.68rem', padding: '2px 6px' }}>
            AVAILABLE NOW
          </span>
        </div>
      </div>

      {/* Main Headline */}
      <h1
        style={{
          fontSize: 'clamp(2.5rem, 5vw, 4.25rem)',
          fontWeight: 800,
          color: 'var(--text-primary)',
          letterSpacing: '-0.03em',
          lineHeight: 1.1,
          maxWidth: '900px',
          margin: '0 auto 24px',
        }}
      >
        You already have AI agents.{' '}
        <span style={{ color: 'var(--accent-green-hover)' }}>
          Asterim gives you the system to control them.
        </span>
      </h1>

      {/* Subhead */}
      <p
        style={{
          fontSize: '1.2rem',
          color: 'var(--text-secondary)',
          maxWidth: '720px',
          margin: '0 auto 40px',
          lineHeight: 1.6,
          fontWeight: 400,
        }}
      >
        The local-first AI engineering operating system. Orchestrate, monitor, isolate, and secure autonomous agents across local workstations, web interfaces, and mobile control.
      </p>

      {/* CTA Buttons */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '48px' }}>
        <button onClick={() => navigate('/download')} className="btn-primary" style={{ padding: '14px 28px', fontSize: '1rem' }}>
          <span>Download Workstation</span>
          <ArrowRight size={18} />
        </button>

        <button onClick={() => navigate('/docs')} className="btn-secondary" style={{ padding: '14px 28px', fontSize: '1rem' }}>
          <BookOpen size={18} />
          <span>Documentation</span>
        </button>
      </div>

      {/* Quickstart Terminal Command Snippet */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <TerminalCopyBlock command="npm install -g asterim" />
      </div>
    </section>
  );
};
