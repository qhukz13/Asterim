import React from 'react';
import { Cpu, ShieldCheck, Layers, Server, GitBranch } from 'lucide-react';

export const CapabilitiesGrid: React.FC = () => {
  const capabilities = [
    {
      icon: Cpu,
      title: 'Subprocess Lifecycle & Recovery',
      desc: 'Process tree tracking, SIGTERM -> SIGKILL cascading shutdown, zombie process cleanup, and exponential backoff crash recovery.',
      badge: 'Engine Hardened',
    },
    {
      icon: ShieldCheck,
      title: 'Hardened Shell AST Safety',
      desc: 'Real-time AST command syntax scanner blocking destructive patterns (rm -rf /) and sandbox path traversal bounds check.',
      badge: 'Security Parser',
    },
    {
      icon: Layers,
      title: 'Multi-Environment Isolation',
      desc: 'Isolate agent profiles, credentials, MCP servers, skills, and attached projects across Personal, Company, and Client presets.',
      badge: 'Preset Scoping',
    },
    {
      icon: Server,
      title: 'MCP & Skills Ecosystem',
      desc: 'Model Context Protocol server configuration, Stdio/SSE transport layer, and reusable task skills with schema-validated forms.',
      badge: 'Extensible Primitives',
    },
    {
      icon: GitBranch,
      title: 'Real-Time Git & AI Commit',
      desc: 'Instant repository status tracking, branch management, staged diff inspector, and one-click conventional commit generator.',
      badge: 'Git Engine',
    },
  ];

  return (
    <section
      style={{
        padding: '80px 24px',
        maxWidth: '1240px',
        margin: '0 auto',
        width: '100%',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: '56px' }}>
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
          Core Architecture
        </div>
        <h2
          style={{
            fontSize: 'clamp(2rem, 3.5vw, 2.75rem)',
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '-0.02em',
            marginBottom: '16px',
          }}
        >
          The 5 Pillars of Asterim
        </h2>
        <p style={{ color: '#94a3b8', fontSize: '1.1rem', maxWidth: '640px', margin: '0 auto' }}>
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
            <div
              key={idx}
              style={{
                background: '#0f172a',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '32px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '10px',
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#10b981',
                  }}
                >
                  <Icon size={22} />
                </div>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#34d399',
                    background: 'rgba(16, 185, 129, 0.1)',
                    padding: '4px 10px',
                    borderRadius: '12px',
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                  }}
                >
                  {cap.badge}
                </span>
              </div>

              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc' }}>
                {cap.title}
              </h3>

              <p style={{ color: '#94a3b8', fontSize: '0.95rem', lineHeight: 1.6, margin: 0 }}>
                {cap.desc}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
};
