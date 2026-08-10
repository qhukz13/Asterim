import React, { useState } from 'react';
import { Lock, Server, FolderCheck, Key } from 'lucide-react';

export const EnvironmentTab: React.FC = () => {
  const presets = [
    {
      id: 'personal',
      name: 'Personal (Local)',
      path: '~/Projects/side-apps',
      secrets: 'Local Ollama & Open-Source LLMs (Offline)',
      mcp: 'FileSystem MCP, SQLite MCP',
      access: 'Full Local File System Access',
      leakRisk: '0% (Offline Engine)',
    },
    {
      id: 'company',
      name: 'Company (Enterprise)',
      nameTag: 'ACTIVE DEMO',
      path: '/home/dev/work/asterim-monorepo',
      secrets: 'Enterprise Anthropic API Key (Vault Encrypted)',
      mcp: 'PostgreSQL MCP, GitHub MCP, Sentry MCP',
      access: 'Scoped Repository Boundary Only',
      leakRisk: 'Zero Key Leak Guarantee',
    },
    {
      id: 'client',
      name: 'Client (Sandbox)',
      path: '/mnt/sandboxes/client-audit',
      secrets: 'Ephemeral Client OAuth Token (Session-Scoped)',
      mcp: 'Read-Only Audit MCP',
      access: 'Read-Only Memory & Strict Container Boundary',
      leakRisk: 'Isolated Sandbox Container',
    },
    {
      id: 'experimental',
      name: 'Experimental',
      path: '/tmp/asterim-experiments',
      secrets: 'Local Test Keys Only',
      mcp: 'Custom Python Agent Skills MCP',
      access: 'Restricted Temp Workspace',
      leakRisk: 'Transient Storage Only',
    },
  ];

  const [selectedPresetId, setSelectedPresetId] = useState<string>('company');
  const activePreset = presets.find((p) => p.id === selectedPresetId) || presets[1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Scope Switcher Bar */}
      <div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>
          Select Environment Profile Preset:
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
          {presets.map((preset) => {
            const isSelected = selectedPresetId === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => setSelectedPresetId(preset.id)}
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  background: isSelected ? 'var(--accent-green-bg)' : '#04070d',
                  border: `1px solid ${isSelected ? 'var(--border-accent)' : 'var(--border-subtle)'}`,
                  color: isSelected ? 'var(--accent-green-hover)' : 'var(--text-secondary)',
                  fontSize: '0.85rem',
                  fontWeight: isSelected ? 700 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>{preset.name}</span>
                {isSelected && <span className="status-badge available" style={{ fontSize: '0.6rem' }}>ACTIVE</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Preset Details Grid */}
      <div
        style={{
          background: '#04070d',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: '20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '20px',
          fontSize: '0.88rem',
        }}
      >
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <FolderCheck size={14} style={{ color: 'var(--accent-green)' }} /> Workspace Root Boundary
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>
            {activePreset.path}
          </div>
        </div>

        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Key size={14} style={{ color: '#38bdf8' }} /> Scoped API Credentials
          </div>
          <div style={{ color: 'var(--accent-green-hover)', fontWeight: 600 }}>
            {activePreset.secrets}
          </div>
        </div>

        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Server size={14} style={{ color: '#a855f7' }} /> Attached MCP Tools
          </div>
          <div style={{ color: '#cbd5e1' }}>
            {activePreset.mcp}
          </div>
        </div>

        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Lock size={14} style={{ color: '#f59e0b' }} /> Security & Leak Risk
          </div>
          <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            {activePreset.leakRisk}
          </div>
        </div>
      </div>
    </div>
  );
};
