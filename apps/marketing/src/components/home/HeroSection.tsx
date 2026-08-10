import React, { useState, useEffect } from 'react';
import { ArrowRight, BookOpen, ShieldCheck, Layers, Cpu, CheckCircle2, Activity } from 'lucide-react';
import { TerminalCopyBlock } from '../common/TerminalCopyBlock';

interface HeroSectionProps {
  navigate: (path: string) => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ navigate }) => {
  const [activeNode, setActiveNode] = useState<number>(0);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);

  useEffect(() => {
    if (!autoRotate) return;
    const interval = setInterval(() => {
      setActiveNode((prev) => (prev + 1) % 4);
    }, 4000);
    return () => clearInterval(interval);
  }, [autoRotate]);

  const nodes = [
    {
      id: 0,
      title: '01 ENVIRONMENT SCOPE',
      subtitle: 'Isolated Credentials & MCP',
      icon: Layers,
      color: '#38bdf8',
      details: {
        preset: 'Company Workspace (Enterprise)',
        path: '/home/dev/projects/asterim-monorepo',
        secrets: 'OPENAI_KEY, CLAUDE_KEY (Scoped, 0 Leak Risk)',
        mcp: 'PostgreSQL MCP, GitHub MCP (Active)',
        status: 'ISOLATED & HARDENED',
      },
    },
    {
      id: 1,
      title: '02 AGENT SUBPROCESS',
      subtitle: 'PID Tree & 16ms Throttler',
      icon: Cpu,
      color: '#a855f7',
      details: {
        preset: 'Claude Code v0.4.5 (PID 4912)',
        path: 'PTY Stream: /dev/pts/3',
        secrets: 'Rate Limit: 60 FPS / 16ms Throttled',
        mcp: 'Subprocess Manager: SIGTERM Cascading Active',
        status: 'RUNNING (ACTIVE STREAM)',
      },
    },
    {
      id: 2,
      title: '03 AST SECURITY GUARD',
      subtitle: 'Real-Time Command Scanner',
      icon: ShieldCheck,
      color: '#10b981',
      details: {
        preset: 'AST Parser: Bash Shell Engine',
        path: 'Target: git commit -m "feat: security guard"',
        secrets: 'Risk Level: SAFE (0 Hazard Flags)',
        mcp: 'Sandbox Policy: Root Path Traversal Guard Active',
        status: 'CLEARANCE GRANTED',
      },
    },
    {
      id: 3,
      title: '04 CLEARANCE & EXECUTION',
      subtitle: 'Local PTY & Mobile E2E Relay',
      icon: CheckCircle2,
      color: '#f59e0b',
      details: {
        preset: 'Execution Target: Workstation Local Engine',
        path: 'Relay Tunnel: relay.asterim.dev:443 (E2EE Noise)',
        secrets: 'Push Approvals: Ready for Web & Mobile',
        mcp: 'Audit Event: Recorded in Local Ledger',
        status: 'EXECUTION COMPLETE',
      },
    },
  ];

  const current = nodes[activeNode];

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
          maxWidth: '920px',
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
          maxWidth: '740px',
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

      {/* Interactive Control Plane Topology Visualization */}
      <div style={{ maxWidth: '1100px', margin: '0 auto 40px', textAlign: 'left' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px' }}>
          Interactive Control Plane Architecture Topology:
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '16px',
            marginBottom: '20px',
          }}
        >
          {nodes.map((node, idx) => {
            const Icon = node.icon;
            const isActive = activeNode === idx;
            return (
              <div
                key={idx}
                onClick={() => {
                  setActiveNode(idx);
                  setAutoRotate(false);
                }}
                className="surface-card"
                style={{
                  cursor: 'pointer',
                  padding: '16px 20px',
                  borderColor: isActive ? 'var(--border-accent)' : 'var(--border-subtle)',
                  background: isActive ? 'radial-gradient(circle at 50% 0%, var(--accent-green-subtle), transparent 70%), var(--bg-surface)' : 'var(--bg-surface)',
                  textAlign: 'left',
                  transition: 'all 0.2s ease',
                  boxShadow: isActive ? '0 0 20px rgba(16, 185, 129, 0.15)' : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: 'var(--radius-sm)',
                      background: isActive ? 'var(--accent-green-bg)' : 'rgba(255, 255, 255, 0.05)',
                      border: `1px solid ${isActive ? 'var(--border-accent)' : 'var(--border-subtle)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isActive ? 'var(--accent-green)' : node.color,
                    }}
                  >
                    <Icon size={16} />
                  </div>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: isActive ? 'var(--accent-green-hover)' : 'var(--text-muted)' }}>
                    {isActive ? 'ACTIVE' : 'STEP 0' + (idx + 1)}
                  </span>
                </div>

                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: isActive ? 'var(--accent-green-hover)' : 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '2px' }}>
                  {node.title}
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {node.subtitle}
                </div>
              </div>
            );
          })}
        </div>

        {/* Node Inspector Panel */}
        <div
          style={{
            background: '#04070d',
            border: '1px solid var(--border-accent)',
            borderRadius: 'var(--radius-md)',
            padding: '20px 24px',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Activity size={18} style={{ color: 'var(--accent-green)' }} />
              <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.95rem' }}>
                Control Plane Node Inspector: {current.title}
              </span>
            </div>
            <span className="status-badge available" style={{ fontSize: '0.7rem' }}>
              {current.details.status}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', fontSize: '0.85rem' }}>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '2px' }}>CONFIG PRESET</div>
              <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{current.details.preset}</div>
            </div>

            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '2px' }}>EXECUTION PATH / BOUND</div>
              <div style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{current.details.path}</div>
            </div>

            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '2px' }}>SECURITY & METRICS</div>
              <div style={{ color: 'var(--accent-green-hover)', fontWeight: 600 }}>{current.details.secrets}</div>
            </div>

            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '2px' }}>SUBSYSTEM POLICY</div>
              <div style={{ color: '#cbd5e1' }}>{current.details.mcp}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Quickstart Terminal Command Snippet */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <TerminalCopyBlock command="npm install -g asterim" />
      </div>
    </section>
  );
};
