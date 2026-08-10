import React from 'react';
import { Cpu, ShieldCheck, Layers, Server, GitBranch } from 'lucide-react';

export const CapabilitiesGrid: React.FC = () => {
  const capabilities = [
    {
      icon: Cpu,
      title: 'Subprocess Lifecycle & Recovery',
      desc: 'Process tree tracking, SIGTERM -> SIGKILL cascading shutdown, zombie process cleanup, and exponential backoff crash recovery.',
      status: 'AVAILABLE NOW',
    },
    {
      icon: ShieldCheck,
      title: 'Hardened Shell AST Safety',
      desc: 'Real-time AST command syntax scanner blocking destructive patterns (rm -rf /) and sandbox path traversal bounds check.',
      status: 'AVAILABLE NOW',
    },
    {
      icon: Layers,
      title: 'Multi-Environment Isolation',
      desc: 'Isolate agent profiles, credentials, MCP servers, skills, and attached projects across Personal, Company, and Client presets.',
      status: 'AVAILABLE NOW',
    },
    {
      icon: Server,
      title: 'MCP & Skills Ecosystem',
      desc: 'Model Context Protocol server configuration, Stdio/SSE transport layer, and reusable task skills with schema-validated forms.',
      status: 'AVAILABLE NOW',
    },
    {
      icon: GitBranch,
      title: 'Real-Time Git & AI Commit',
      desc: 'Instant repository status tracking, branch management, staged diff inspector, and one-click conventional commit generator.',
      status: 'AVAILABLE NOW',
    },
  ];

  return (
    <section className="marketing-section">
      <div className="section-header">
        <span className="section-tag">Core Architecture</span>
        <h2 className="section-title">The 5 Pillars of Asterim</h2>
        <p className="section-lead">
          Engineered from the ground up for maximum local execution reliability, safety, and power user ergonomics.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '24px',
        }}
      >
        {capabilities.map((cap, idx) => {
          const Icon = cap.icon;
          return (
            <div key={idx} className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--accent-green-bg)',
                    border: '1px solid var(--border-accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent-green)',
                  }}
                >
                  <Icon size={20} />
                </div>
                <span className="status-badge available" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>
                  {cap.status}
                </span>
              </div>

              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {cap.title}
              </h3>

              <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.6, margin: 0 }}>
                {cap.desc}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
};
