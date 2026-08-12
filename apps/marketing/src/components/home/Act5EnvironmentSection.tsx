import React, { useState } from 'react';
import { IconLock, IconCheck } from '../common/MarketingIcons';

interface EnvironmentScope {
  id: string;
  label: string;
  preset: string;
  workspaceRoot: string;
  projects: number;
  enclave: string;
  mcpTools: string[];
  pathPolicy: string;
}

const SCOPES: EnvironmentScope[] = [
  {
    id: 'personal',
    label: 'Personal',
    preset: 'personal',
    workspaceRoot: '~/dev/personal',
    projects: 3,
    enclave: 'Local keychain · 1 key attached',
    mcpTools: ['git-mcp', 'fs-mcp'],
    pathPolicy: 'Read + write within workspace root'
  },
  {
    id: 'company',
    label: 'Company (Acme Corp)',
    preset: 'company',
    workspaceRoot: '~/work/acme',
    projects: 12,
    enclave: 'Org enclave · SSO-issued, rotates every 12h',
    mcpTools: ['git-mcp', 'docker-mcp', 'security-mcp'],
    pathPolicy: 'Write requires approval outside src/'
  },
  {
    id: 'client',
    label: 'Client Work',
    preset: 'client',
    workspaceRoot: '~/clients/northwind',
    projects: 5,
    enclave: 'Per-client enclave · isolated, never shared',
    mcpTools: ['git-mcp'],
    pathPolicy: 'Strict jail · traversal blocked'
  }
];

export const Act5EnvironmentSection: React.FC = () => {
  const [active, setActive] = useState<EnvironmentScope>(SCOPES[1]);

  return (
    <section className="marketing-section" style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <div className="split-panel">
        {/* Left — narrative */}
        <div>
          <span className="section-tag">ENVIRONMENTS</span>
          <h2 className="section-title" style={{ marginBottom: '20px' }}>
            Strict Isolation Between Work &amp; Personal Contexts.
          </h2>
          <p className="section-lead" style={{ marginBottom: '20px' }}>
            An environment is the boundary an agent runs inside. Switching it swaps the workspace
            root, the credential enclave, and the tools an agent is allowed to reach — together, in
            one move.
          </p>
          <p className="text-body" style={{ maxWidth: '520px', marginBottom: '28px' }}>
            Credentials are decrypted in memory inside the workstation process and handed to agents
            as masked references, so a key never lands in a transcript. File access is bounded to the
            active workspace root, and traversal past it is intercepted before the shell sees it.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <IconLock size={15} color="var(--accent-emerald)" />
            Secrets never cross an environment boundary.
          </div>
        </div>

        {/* Right — live scope switcher */}
        <div className="workstation-frame" style={{ alignSelf: 'start' }}>
          <div className="workstation-header">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              ACTIVE ENVIRONMENT
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--accent-emerald)' }}>
              ● SCOPED
            </span>
          </div>

          {/* Scope selector */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
            {SCOPES.map((scope) => {
              const isActive = scope.id === active.id;
              return (
                <button
                  key={scope.id}
                  onClick={() => setActive(scope)}
                  aria-pressed={isActive}
                  style={{
                    flex: 1,
                    padding: '12px 10px',
                    background: isActive ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                    border: 'none',
                    borderBottom: isActive ? '2px solid var(--accent-emerald)' : '2px solid transparent',
                    color: isActive ? 'var(--accent-emerald-hover)' : 'var(--text-secondary)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '0.82rem',
                    fontWeight: isActive ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'color 0.15s ease, background 0.15s ease'
                  }}
                >
                  {scope.label}
                </button>
              );
            })}
          </div>

          {/* Live state readout — hairline rows, no nested cards */}
          <dl style={{ margin: 0, padding: '4px 20px 20px' }}>
            {[
              ['Workspace root', <code key="r" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--text-primary)' }}>{active.workspaceRoot}</code>],
              ['Attached projects', `${active.projects}`],
              ['Credential enclave', active.enclave],
              ['Path policy', active.pathPolicy]
            ].map(([term, value]) => (
              <div
                key={String(term)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: '20px',
                  padding: '13px 0',
                  borderBottom: '1px solid var(--border-subtle)'
                }}
              >
                <dt style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{term}</dt>
                <dd style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'right' }}>
                  {value}
                </dd>
              </div>
            ))}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '20px', padding: '13px 0' }}>
              <dt style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>MCP tools</dt>
              <dd style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'flex-end' }}>
                {active.mcpTools.map((tool) => (
                  <span
                    key={tool}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.72rem',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '4px',
                      padding: '2px 7px'
                    }}
                  >
                    {tool}
                  </span>
                ))}
              </dd>
            </div>
          </dl>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 20px',
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--bg-terminal)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.76rem',
              color: 'var(--text-muted)'
            }}
          >
            <IconCheck size={14} color="var(--accent-emerald)" />
            preset “{active.preset}” loaded · previous enclave unmounted
          </div>
        </div>
      </div>
    </section>
  );
};
