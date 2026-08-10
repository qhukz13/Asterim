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
      description: 'Zero-lag PTY output streaming with 16ms backpressure throttling',
    },
    {
      id: 'security',
      label: 'AST Command Security',
      icon: ShieldCheck,
      description: 'Real-time shell AST hazard parsing and sandbox diff inspector',
    },
    {
      id: 'env',
      label: 'Isolated Environments',
      icon: Layers,
      description: 'Scoped agent profiles, secrets, MCP tools, and projects per environment',
    },
    {
      id: 'mobile',
      label: 'Remote & Mobile Control',
      icon: Smartphone,
      description: 'E2E encrypted cloud relay tunnel and mobile approval notifications',
    },
  ];

  return (
    <section
      style={{
        padding: '64px 24px',
        maxWidth: '1240px',
        margin: '0 auto',
        width: '100%',
      }}
    >
      {/* Section Header */}
      <div style={{ textAlign: 'center', marginBottom: '48px' }}>
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
          Interactive Workstation Preview
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
          Experience the Asterim Control Plane
        </h2>
        <p style={{ color: '#94a3b8', fontSize: '1.1rem', maxWidth: '620px', margin: '0 auto' }}>
          Explore real Asterim application states, security evaluations, and environment controls in real time.
        </p>
      </div>

      {/* Tab Selector Bar */}
      <div
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
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                background: isActive ? 'rgba(15, 23, 42, 0.9)' : '#080c14',
                border: isActive ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '16px 20px',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: isActive ? '0 4px 20px rgba(16, 185, 129, 0.12)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: isActive ? '#34d399' : '#f8fafc', fontWeight: 600, fontSize: '0.95rem', marginBottom: '4px' }}>
                <Icon size={18} style={{ color: isActive ? '#10b981' : '#64748b' }} />
                {tab.label}
              </div>
              <div style={{ color: '#64748b', fontSize: '0.8rem', lineHeight: 1.4 }}>
                {tab.description}
              </div>
            </button>
          );
        })}
      </div>

      {/* Browser Window Wrapper */}
      <div
        style={{
          background: '#080c14',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 30px 60px rgba(0, 0, 0, 0.8), 0 0 30px rgba(16, 185, 129, 0.05)',
        }}
      >
        {/* Window Chrome Header */}
        <div
          style={{
            padding: '12px 20px',
            background: '#0f172a',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ef4444' }} />
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#f59e0b' }} />
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#10b981' }} />
          </div>

          <div
            style={{
              background: '#04070d',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '6px',
              padding: '4px 16px',
              fontSize: '0.8rem',
              color: '#64748b',
              fontFamily: 'var(--font-mono)',
              width: '100%',
              maxWidth: '360px',
              textAlign: 'center',
            }}
          >
            asterim://workstation/control-plane
          </div>

          <div style={{ width: '52px' }} />
        </div>

        {/* Dynamic Tab Body */}
        <div style={{ padding: '24px' }}>
          {activeTab === 'stream' && <AgentStreamTab />}
          {activeTab === 'security' && <SecurityGuardTab />}
          {activeTab === 'env' && <EnvironmentTab />}
          {activeTab === 'mobile' && <MobileTunnelTab />}
        </div>
      </div>
    </section>
  );
};
