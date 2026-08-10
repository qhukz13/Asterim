import React, { useState } from 'react';
import { Lock, Server } from 'lucide-react';

export const EnvironmentTab: React.FC = () => {
  const [selectedPreset, setSelectedPreset] = useState<'personal' | 'company' | 'client'>('company');

  const presets = [
    {
      id: 'personal',
      name: 'Personal (Local)',
      desc: 'Single developer side projects with local LLM models (Ollama, vLLM).',
      secrets: '2 Scoped Secrets',
      mcp: '1 Stdio MCP Server',
      paths: ['~/Projects/asterim', '~/Projects/personal-blog'],
    },
    {
      id: 'company',
      name: 'Company (Enterprise)',
      desc: 'Corporate repositories with SAML identity, attached team MCP servers, and audit streams.',
      secrets: '6 Encrypted Enterprise Secrets',
      mcp: '4 SSE/Stdio MCP Servers',
      paths: ['/work/corporate-monorepo', '/work/api-gateway'],
    },
    {
      id: 'client',
      name: 'Client (Sandbox)',
      desc: 'Strict client boundary with isolated workspace keys and restricted shell permissions.',
      secrets: '3 Sandboxed Client Secrets',
      mcp: '2 Restricted MCP Servers',
      paths: ['/clients/acme-corp/app'],
    },
  ];

  const current = presets.find((p) => p.id === selectedPreset)!;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Scope Switcher Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {presets.map((preset) => {
            const isActive = selectedPreset === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => setSelectedPreset(preset.id as any)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  background: isActive ? 'var(--accent-green-bg)' : '#04070d',
                  border: isActive ? '1px solid var(--border-accent)' : '1px solid var(--border-subtle)',
                  color: isActive ? 'var(--accent-green-hover)' : '#94a3b8',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                {preset.name}
              </button>
            );
          })}
        </div>

        <span className="status-badge available" style={{ fontSize: '0.7rem' }}>
          AVAILABLE NOW
        </span>
      </div>

      {/* Preset Details Surface Card */}
      <div
        style={{
          background: '#04070d',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '24px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '24px',
        }}
      >
        <div>
          <h4 style={{ color: '#f8fafc', fontWeight: 700, fontSize: '1.05rem', marginBottom: '8px' }}>
            {current.name} Context Scope
          </h4>
          <p style={{ color: '#94a3b8', fontSize: '0.88rem', lineHeight: 1.5, marginBottom: '16px' }}>
            {current.desc}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem', color: '#cbd5e1' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Lock size={14} style={{ color: 'var(--accent-green)' }} /> {current.secrets}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Server size={14} style={{ color: '#38bdf8' }} /> {current.mcp}
            </div>
          </div>
        </div>

        <div>
          <div style={{ color: '#64748b', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>
            Attached Workspace Paths:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: '#34d399' }}>
            {current.paths.map((path, idx) => (
              <div key={idx} style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                {path}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
