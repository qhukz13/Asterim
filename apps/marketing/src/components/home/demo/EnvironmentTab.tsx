import React, { useState } from 'react';
import { Layers, FolderGit2, Key, Server, Check } from 'lucide-react';

export const EnvironmentTab: React.FC = () => {
  const [activeEnv, setActiveEnv] = useState<'personal' | 'company' | 'client'>('company');

  const envs = [
    {
      id: 'personal',
      name: 'Personal (Local)',
      preset: 'personal',
      badge: 'Local Machine',
      projects: 3,
      mcp: 'Stdio MCP Servers',
      secrets: 'Local Keychain',
      ui: 'Streamlined (No Governance Overhead)',
    },
    {
      id: 'company',
      name: 'Acme Corp (Company)',
      preset: 'company',
      badge: 'Enterprise Preset',
      projects: 12,
      mcp: 'Team MCP Server Fleet',
      secrets: 'Encrypted SSO Vault',
      ui: 'Full Governance, Audit Stream & RBAC',
    },
    {
      id: 'client',
      name: 'Client Portal (Isolated)',
      preset: 'client',
      badge: 'Client Sandbox',
      projects: 2,
      mcp: 'Restricted Stdio Only',
      secrets: 'Scoped Client Credentials',
      ui: 'Strict Audit Logging',
    },
  ];

  const current = envs.find((e) => e.id === activeEnv)!;

  return (
    <div
      style={{
        background: '#0f172a',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      {/* Environment Selector Bar */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {envs.map((env) => (
          <button
            key={env.id}
            onClick={() => setActiveEnv(env.id as any)}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              background: activeEnv === env.id ? 'rgba(16, 185, 129, 0.15)' : '#04070d',
              border: activeEnv === env.id ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
              color: activeEnv === env.id ? '#34d399' : '#94a3b8',
              fontWeight: activeEnv === env.id ? 600 : 500,
              fontSize: '0.88rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Layers size={16} />
            {env.name}
            {activeEnv === env.id && <Check size={14} style={{ color: '#10b981' }} />}
          </button>
        ))}
      </div>

      {/* Selected Environment Details Card */}
      <div
        style={{
          background: '#04070d',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          padding: '20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '20px',
        }}
      >
        <div>
          <div style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <FolderGit2 size={14} /> Attached Projects
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>
            {current.projects} Workspace Repositories
          </div>
        </div>

        <div>
          <div style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Server size={14} /> MCP Server Integration
          </div>
          <div style={{ fontSize: '1rem', fontWeight: 600, color: '#38bdf8' }}>
            {current.mcp}
          </div>
        </div>

        <div>
          <div style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Key size={14} /> Credential Isolation
          </div>
          <div style={{ fontSize: '1rem', fontWeight: 600, color: '#a855f7' }}>
            {current.secrets}
          </div>
        </div>
      </div>

      <div style={{ color: '#94a3b8', fontSize: '0.85rem', lineHeight: 1.5, background: 'rgba(255, 255, 255, 0.02)', padding: '12px 16px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
        💡 <strong style={{ color: '#f8fafc' }}>Environment Isolation Guarantee:</strong> Switching to <em>{current.name}</em> instantly swaps API keys, agent profiles, MCP tools, and project contexts without cross-environment secret leakage.
      </div>
    </div>
  );
};
