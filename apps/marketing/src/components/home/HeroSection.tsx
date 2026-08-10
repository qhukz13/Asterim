import React from 'react';
import { ArrowRight, BookOpen, ShieldCheck, Download } from 'lucide-react';
import { TerminalCopyBlock } from '../common/TerminalCopyBlock';

interface HeroSectionProps {
  navigate: (path: string) => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ navigate }) => {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '96px 24px 64px',
        maxWidth: '1080px',
        margin: '0 auto',
      }}
    >
      {/* Version Status Pill Badge */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 16px',
          borderRadius: '20px',
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.25)',
          color: '#34d399',
          fontSize: '0.85rem',
          fontWeight: 600,
          marginBottom: '28px',
          boxShadow: '0 0 16px rgba(16, 185, 129, 0.12)',
        }}
      >
        <div
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#10b981',
            boxShadow: '0 0 8px #10b981',
          }}
        />
        <ShieldCheck size={14} style={{ color: '#10b981' }} />
        Asterim v0.4.5 — Hardened Local Engine Available
      </div>

      {/* Main Title */}
      <h1
        style={{
          fontSize: 'clamp(2.5rem, 5vw, 4.25rem)',
          fontWeight: 800,
          lineHeight: 1.08,
          marginBottom: '24px',
          letterSpacing: '-0.03em',
          color: '#ffffff',
          maxWidth: '920px',
        }}
      >
        The Local-First AI Engineering Operating System.
      </h1>

      {/* Subhead */}
      <p
        style={{
          fontSize: 'clamp(1.1rem, 2vw, 1.25rem)',
          color: '#94a3b8',
          maxWidth: '720px',
          lineHeight: 1.6,
          marginBottom: '40px',
        }}
      >
        Control, monitor, and direct autonomous AI coding agents from a single unified workstation plane. Isolated environments, real-time AST command security, and zero cloud dependency.
      </p>

      {/* Terminal Block */}
      <div style={{ marginBottom: '40px', width: '100%', display: 'flex', justifyContent: 'center' }}>
        <TerminalCopyBlock command="npm install -g asterim" />
      </div>

      {/* CTA Button Group */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <button
          onClick={() => navigate('/download')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            background: 'linear-gradient(135deg, #34d399, #10b981)',
            color: '#042114',
            padding: '14px 28px',
            borderRadius: '10px',
            fontWeight: 700,
            fontSize: '1rem',
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(16, 185, 129, 0.25)',
            transition: 'all 0.15s ease',
          }}
        >
          <Download size={18} />
          Download Desktop App
        </button>

        <button
          onClick={() => navigate('/docs')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#f8fafc',
            padding: '14px 24px',
            borderRadius: '10px',
            fontWeight: 600,
            fontSize: '1rem',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <BookOpen size={18} />
          Explore Documentation
          <ArrowRight size={16} style={{ color: '#94a3b8' }} />
        </button>
      </div>
    </section>
  );
};
