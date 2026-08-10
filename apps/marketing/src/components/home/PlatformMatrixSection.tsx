import React from 'react';
import { Laptop, Globe, Smartphone, Check } from 'lucide-react';

export const PlatformMatrixSection: React.FC = () => {
  const platforms = [
    {
      icon: Laptop,
      name: 'Desktop Workstation',
      status: 'AVAILABLE NOW',
      statusColor: '#10b981',
      badgeBg: 'rgba(16, 185, 129, 0.15)',
      badgeBorder: 'rgba(16, 185, 129, 0.3)',
      desc: 'The primary local execution engine. Direct integration with local git repositories, PTY terminals, subprocess lifecycle managers, and AST symbol parsers.',
      capabilities: [
        'Full offline execution support',
        'Local PTY terminal with 16ms throttler',
        'AST command safety scanner',
        'Multi-environment workspace profiles',
      ],
    },
    {
      icon: Globe,
      name: 'Web Interface',
      status: 'AVAILABLE NOW / BETA',
      statusColor: '#38bdf8',
      badgeBg: 'rgba(56, 189, 248, 0.15)',
      badgeBorder: 'rgba(56, 189, 248, 0.3)',
      desc: 'Browser-based workspace management, remote agent monitoring, documentation, and SaaS account portal identity control.',
      capabilities: [
        'Central account identity creation',
        'Session control & active device management',
        'Machine-to-machine API key management',
        'Remote workspace thread inspection',
      ],
    },
    {
      icon: Smartphone,
      name: 'Mobile Tunnel',
      status: 'PHASE 5 BETA',
      statusColor: '#fbbf24',
      badgeBg: 'rgba(251, 191, 36, 0.15)',
      badgeBorder: 'rgba(251, 191, 36, 0.3)',
      desc: 'Remote agent monitoring and push approval notifications over E2E encrypted cloud relay tunnels.',
      capabilities: [
        'E2E encrypted relay connection',
        'Push notification approval prompts',
        'Mobile-optimized PWA thread viewer',
        'Single-thumb command clearance',
      ],
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
          Ecosystem Surfaces
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
          Control Across Every Device
        </h2>
        <p style={{ color: '#94a3b8', fontSize: '1.1rem', maxWidth: '640px', margin: '0 auto' }}>
          Transparent platform availability status across local workstations, web interfaces, and mobile control.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '24px',
        }}
      >
        {platforms.map((plat, idx) => {
          const Icon = plat.icon;
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
                gap: '20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '10px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: plat.statusColor,
                  }}
                >
                  <Icon size={22} />
                </div>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: plat.statusColor,
                    background: plat.badgeBg,
                    border: `1px solid ${plat.badgeBorder}`,
                    padding: '4px 10px',
                    borderRadius: '12px',
                  }}
                >
                  {plat.status}
                </span>
              </div>

              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
                  {plat.name}
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '0.92rem', lineHeight: 1.6, margin: 0 }}>
                  {plat.desc}
                </p>
              </div>

              <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '16px' }}>
                <div style={{ color: '#64748b', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '12px' }}>
                  Platform Capabilities:
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {plat.capabilities.map((cap, cIdx) => (
                    <li key={cIdx} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#cbd5e1', fontSize: '0.88rem' }}>
                      <Check size={14} style={{ color: plat.statusColor }} />
                      {cap}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
