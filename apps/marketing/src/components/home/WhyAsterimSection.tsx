import React from 'react';
import { Cpu, CheckCircle2, XCircle } from 'lucide-react';

export const WhyAsterimSection: React.FC = () => {
  return (
    <section
      style={{
        padding: '80px 24px',
        maxWidth: '1240px',
        margin: '0 auto',
        width: '100%',
      }}
    >
      {/* Section Header */}
      <div style={{ textAlign: 'center', marginBottom: '64px' }}>
        <div
          style={{
            fontSize: '0.85rem',
            fontWeight: 700,
            color: '#10b981',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: '12px',
          }}
        >
          Product Positioning
        </div>
        <h2
          style={{
            fontSize: 'clamp(2rem, 3.5vw, 3rem)',
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '-0.02em',
            marginBottom: '16px',
          }}
        >
          Why Asterim?
        </h2>
        <p
          style={{
            color: '#94a3b8',
            fontSize: '1.15rem',
            maxWidth: '680px',
            margin: '0 auto',
            lineHeight: 1.6,
          }}
        >
          Asterim is not another IDE plugin or chat widget. It is the dedicated control plane engineered for developers who run autonomous AI coding agents.
        </p>
      </div>

      {/* Comparison Grid: Chaotic Agent Sprawl vs Asterim Control Plane */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '32px',
          marginBottom: '64px',
        }}
      >
        {/* Card 1: The Chaos */}
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.04)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '16px',
            padding: '36px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#f87171' }}>
            <XCircle size={24} />
            <h3 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#f8fafc' }}>
              The Chaos of Loose Agents
            </h3>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '14px', color: '#cbd5e1', fontSize: '0.95rem' }}>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ color: '#f87171', fontWeight: 700 }}>✕</span>
              <span><strong>Terminal Window Sprawl:</strong> Juggling detached PTY subprocesses across terminals with zero central visibility.</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ color: '#f87171', fontWeight: 700 }}>✕</span>
              <span><strong>Unsafe Shell Execution:</strong> Agents executing unvetted `rm -rf` or file mutations without real-time AST parsing.</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ color: '#f87171', fontWeight: 700 }}>✕</span>
              <span><strong>Credential & Secret Leaks:</strong> Sharing global API keys and env vars across unrelated client projects.</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ color: '#f87171', fontWeight: 700 }}>✕</span>
              <span><strong>Tethered to the Desk:</strong> Unable to monitor long-running agent missions or approve commands remotely.</span>
            </li>
          </ul>
        </div>

        {/* Card 2: The Asterim Way */}
        <div
          style={{
            background: 'rgba(16, 185, 129, 0.05)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '16px',
            padding: '36px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            boxShadow: '0 0 30px rgba(16, 185, 129, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#10b981' }}>
            <CheckCircle2 size={24} />
            <h3 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#f8fafc' }}>
              The Asterim Workstation Plane
            </h3>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '14px', color: '#cbd5e1', fontSize: '0.95rem' }}>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span>
              <span><strong>Subprocess Life Management:</strong> PID tree tracking, auto-recovery with backoff, and 16ms throttled PTY streaming.</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span>
              <span><strong>Hardened AST Safety Guard:</strong> Real-time command hazard detection, path traversal sandbox, and visual diff previews.</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span>
              <span><strong>Isolated Environments:</strong> Scoped agent profiles, secrets, MCP tools, and skills per project preset.</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span>
              <span><strong>Cross-Surface Monitoring:</strong> Single-pane control plane on Desktop, Web, and Mobile over E2E encrypted tunnels.</span>
            </li>
          </ul>
        </div>
      </div>

      {/* 30-Second Elevator Pitch Box */}
      <div
        style={{
          background: '#0f172a',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '32px 40px',
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#10b981',
            flexShrink: 0,
          }}
        >
          <Cpu size={24} />
        </div>
        <div style={{ flex: 1, minWidth: '280px' }}>
          <h4 style={{ color: '#f8fafc', fontSize: '1.1rem', fontWeight: 700, marginBottom: '6px' }}>
            IDE vs. Asterim Control Plane
          </h4>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', lineHeight: 1.6, margin: 0 }}>
            IDEs are built for manual keystrokes. Asterim is built for <strong>agent orchestration</strong> — giving software engineers complete governance, context isolation, and safety when running multiple autonomous AI agents simultaneously.
          </p>
        </div>
      </div>
    </section>
  );
};
