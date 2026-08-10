import React, { useState } from 'react';
import { Terminal, ShieldCheck, Layers, Smartphone } from 'lucide-react';
import { AgentStreamTab } from './demo/AgentStreamTab';
import { SecurityGuardTab } from './demo/SecurityGuardTab';
import { EnvironmentTab } from './demo/EnvironmentTab';
import { MobileTunnelTab } from './demo/MobileTunnelTab';

export const InteractiveProductDemo: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'stream' | 'security' | 'env' | 'mobile'>('stream');

  const tabs = [
    {
      id: 'stream',
      label: 'Agent PTY Streaming',
      icon: Terminal,
      badge: 'AVAILABLE NOW',
      statusClass: 'available',
      description: 'Zero-lag PTY output log stream with 16ms backpressure throttling',
    },
    {
      id: 'security',
      label: 'AST Command Guard',
      icon: ShieldCheck,
      badge: 'AVAILABLE NOW',
      statusClass: 'available',
      description: 'Real-time AST hazard parsing, diff inspector, and approval controls',
    },
    {
      id: 'env',
      label: 'Isolated Environments',
      icon: Layers,
      badge: 'AVAILABLE NOW',
      statusClass: 'available',
      description: 'Scoped workspace profiles, secrets, and project path boundaries',
    },
    {
      id: 'mobile',
      label: 'Remote & Mobile Control',
      icon: Smartphone,
      badge: 'PHASE 5 BETA',
      statusClass: 'planned',
      description: 'E2E encrypted cloud relay tunnel and remote push approval prompts',
    },
  ];

  return (
    <section className="marketing-section">
      {/* Section Header */}
      <div className="section-header">
        <span className="section-tag">Interactive Preview</span>
        <h2 className="section-title">Experience the Workstation Control Plane</h2>
        <p className="section-lead">
          Explore real Asterim application states, security evaluations, and environment controls in real time.
        </p>
      </div>

      {/* Tab Selector Bar with ARIA roles */}
      <div
        role="tablist"
        aria-label="Interactive workstation product feature tabs"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '12px',
          marginBottom: '24px',
        }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                background: isActive ? 'var(--bg-surface)' : 'var(--bg-dark)',
                border: isActive ? '1px solid var(--border-accent)' : '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '16px 20px',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: isActive ? 'var(--accent-green-hover)' : 'var(--text-primary)', fontWeight: 600, fontSize: '0.92rem' }}>
                  <Icon size={16} style={{ color: isActive ? 'var(--accent-green)' : 'var(--text-muted)' }} />
                  {tab.label}
                </div>
                <span className={`status-badge ${tab.statusClass}`} style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                  {tab.badge}
                </span>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.4 }}>
                {tab.description}
              </div>
            </button>
          );
        })}
      </div>

      {/* Browser Window Wrapper */}
      <div
        style={{
          background: 'var(--bg-dark)',
          border: '1px solid var(--border-hover)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          boxShadow: '0 30px 60px rgba(0, 0, 0, 0.8), 0 0 30px rgba(16, 185, 129, 0.04)',
        }}
      >
        {/* Window Chrome Header */}
        <div
          style={{
            padding: '12px 20px',
            background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }} />
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b' }} />
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }} />
          </div>

          <div
            style={{
              background: '#04070d',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '4px 16px',
              fontSize: '0.78rem',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              width: '100%',
              maxWidth: '360px',
              textAlign: 'center',
            }}
          >
            asterim://workstation/control-plane/{activeTab}
          </div>

          <div style={{ width: '48px' }} />
        </div>

        {/* Dynamic Tab Body */}
        <div
          role="tabpanel"
          id={`panel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
          style={{ padding: '24px' }}
        >
          {activeTab === 'stream' && <AgentStreamTab />}
          {activeTab === 'security' && <SecurityGuardTab />}
          {activeTab === 'env' && <EnvironmentTab />}
          {activeTab === 'mobile' && <MobileTunnelTab />}
        </div>
      </div>
    </section>
  );
};
