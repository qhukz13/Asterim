import React from 'react';
import { Laptop, Globe, Smartphone } from 'lucide-react';

export const PlatformMatrixSection: React.FC = () => {
  const surfaces = [
    {
      role: 'EXECUTE',
      title: 'Desktop Workstation Engine',
      subtitle: 'Local PTY & Process Tree Management',
      status: 'AVAILABLE NOW',
      statusClass: 'available',
      icon: Laptop,
      desc: 'The primary local workstation control plane. Runs 100% offline, manages agent subprocesses, enforces AST command safety, and isolates environment profiles.',
    },
    {
      role: 'MONITOR',
      title: 'Web Identity & Remote View',
      subtitle: 'Session Control & Workspace Inspection',
      status: 'AVAILABLE NOW (BETA)',
      statusClass: 'beta',
      icon: Globe,
      desc: 'Browser-based account portal. Inspect active sessions, manage machine-to-machine API keys, and monitor remote workstation threads.',
    },
    {
      role: 'APPROVE',
      title: 'Mobile Relay & Push Approvals',
      subtitle: 'Single-Thumb Remote Clearance',
      status: 'PHASE 5 BETA',
      statusClass: 'planned',
      icon: Smartphone,
      desc: 'E2E Noise-encrypted cloud relay tunnel connecting workstation security gates to mobile push notifications for instant command clearance.',
    },
  ];

  return (
    <section className="marketing-section">
      <div className="section-header">
        <span className="section-tag">Ecosystem Architecture</span>
        <h2 className="section-title">Control Across Every Surface</h2>
        <p className="section-lead">
          Execute locally on Desktop, monitor via Web, and clear approvals from Mobile over E2EE relay tunnels.
        </p>
      </div>

      {/* Surface Pipeline Flow Container */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '24px',
          maxWidth: '1140px',
          margin: '0 auto',
        }}
      >
        {surfaces.map((surf, idx) => {
          const Icon = surf.icon;
          return (
            <div
              key={idx}
              className="surface-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '24px',
                padding: '28px',
              }}
            >
              <div>
                {/* Surface Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--accent-green-bg)',
                        border: '1px solid var(--border-accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--accent-green)',
                      }}
                    >
                      <Icon size={18} />
                    </div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--accent-green-hover)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      ROLE: {surf.role}
                    </span>
                  </div>

                  <span className={`status-badge ${surf.statusClass}`} style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                    {surf.status}
                  </span>
                </div>

                {/* Surface Title & Subtitle */}
                <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  {surf.title}
                </h3>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                  {surf.subtitle}
                </div>

                <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.6, margin: 0 }}>
                  {surf.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
