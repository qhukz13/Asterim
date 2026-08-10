import React from 'react';
import { Laptop, Globe, Smartphone, Check } from 'lucide-react';

export const PlatformMatrixSection: React.FC = () => {
  const platforms = [
    {
      icon: Laptop,
      name: 'Desktop Workstation',
      status: 'AVAILABLE NOW',
      statusClass: 'available',
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
      status: 'AVAILABLE NOW (BETA)',
      statusClass: 'beta',
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
      statusClass: 'planned',
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
    <section className="marketing-section">
      <div className="section-header">
        <span className="section-tag">Ecosystem Availability</span>
        <h2 className="section-title">Control Across Every Surface</h2>
        <p className="section-lead">
          Transparent platform status across local desktop workstations, web interfaces, and mobile control.
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
            <div key={idx} className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-primary)',
                  }}
                >
                  <Icon size={20} />
                </div>
                <span className={`status-badge ${plat.statusClass}`}>
                  {plat.status}
                </span>
              </div>

              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  {plat.name}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.6, margin: 0 }}>
                  {plat.desc}
                </p>
              </div>

              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '12px' }}>
                  Platform Capabilities:
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {plat.capabilities.map((cap, cIdx) => (
                    <li key={cIdx} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#cbd5e1', fontSize: '0.88rem' }}>
                      <Check size={14} style={{ color: 'var(--accent-green)' }} />
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
