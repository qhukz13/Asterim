import React, { useState } from 'react';
import {
  IconTerminal,
  IconShield,
  IconLock,
  IconZap,
  IconCheck,
  IconX,
  IconCopy
} from '../common/MarketingIcons';

export type SandboxTab = 'stream' | 'ast-guard' | 'environment' | 'swarm';
export type EnvironmentScope = 'personal' | 'company' | 'client';

interface AsterimWorkstationSandboxProps {
  initialTab?: SandboxTab;
}

export const AsterimWorkstationSandbox: React.FC<AsterimWorkstationSandboxProps> = ({
  initialTab = 'stream'
}) => {
  const [activeTab, setActiveTab] = useState<SandboxTab>(initialTab);
  const [astState, setAstState] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [envScope, setEnvScope] = useState<EnvironmentScope>('company');
  const [copied, setCopied] = useState(false);

  const handleCopyCmd = () => {
    navigator.clipboard.writeText('npm install -g asterim');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="workstation-frame"
      style={{
        background: '#070a10',
        borderRadius: '14px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 32px 96px rgba(0, 0, 0, 0.85)',
        overflow: 'hidden',
        width: '100%'
      }}
    >
      {/* Workstation Chrome Header */}
      <div
        style={{
          height: '42px',
          background: '#0d1424',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          userSelect: 'none'
        }}
      >
        {/* Window Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
          <span style={{ marginLeft: '12px', fontSize: '0.8rem', color: '#64748b', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
            asterim-workstation v2.4 // thread-id: #tr-8942
          </span>
        </div>

        {/* Status Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            style={{
              fontSize: '0.72rem',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: '4px',
              background: 'rgba(16, 185, 129, 0.12)',
              color: '#10b981',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
            LOCAL PTY ACTIVE (4ms)
          </span>
        </div>
      </div>

      {/* Tab Navigation Toolbar */}
      <div
        style={{
          background: '#0a0f1d',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          overflowX: 'auto'
        }}
      >
        <button
          onClick={() => setActiveTab('stream')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 16px',
            background: activeTab === 'stream' ? '#0d1424' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'stream' ? '2px solid #10b981' : '2px solid transparent',
            color: activeTab === 'stream' ? '#f8fafc' : '#94a3b8',
            fontSize: '0.85rem',
            fontWeight: activeTab === 'stream' ? 600 : 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          <IconTerminal size={14} color={activeTab === 'stream' ? '#10b981' : '#64748b'} />
          Agent Stream
        </button>

        <button
          onClick={() => setActiveTab('ast-guard')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 16px',
            background: activeTab === 'ast-guard' ? '#0d1424' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'ast-guard' ? '2px solid #10b981' : '2px solid transparent',
            color: activeTab === 'ast-guard' ? '#f8fafc' : '#94a3b8',
            fontSize: '0.85rem',
            fontWeight: activeTab === 'ast-guard' ? 600 : 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          <IconShield size={14} color={activeTab === 'ast-guard' ? '#10b981' : '#64748b'} />
          AST Security Guard
          {astState === 'pending' && (
            <span
              style={{
                fontSize: '0.68rem',
                padding: '1px 6px',
                borderRadius: '4px',
                background: 'rgba(239, 68, 68, 0.2)',
                color: '#ef4444',
                fontWeight: 700,
                border: '1px solid rgba(239, 68, 68, 0.4)'
              }}
            >
              1 HAZARD
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('environment')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 16px',
            background: activeTab === 'environment' ? '#0d1424' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'environment' ? '2px solid #10b981' : '2px solid transparent',
            color: activeTab === 'environment' ? '#f8fafc' : '#94a3b8',
            fontSize: '0.85rem',
            fontWeight: activeTab === 'environment' ? 600 : 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          <IconLock size={14} color={activeTab === 'environment' ? '#10b981' : '#64748b'} />
          Scoped Environment
        </button>

        <button
          onClick={() => setActiveTab('swarm')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 16px',
            background: activeTab === 'swarm' ? '#0d1424' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'swarm' ? '2px solid #10b981' : '2px solid transparent',
            color: activeTab === 'swarm' ? '#f8fafc' : '#94a3b8',
            fontSize: '0.85rem',
            fontWeight: activeTab === 'swarm' ? 600 : 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          <IconZap size={14} color={activeTab === 'swarm' ? '#10b981' : '#64748b'} />
          Swarm Telemetry
          <span
            style={{
              fontSize: '0.68rem',
              padding: '1px 6px',
              borderRadius: '4px',
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#10b981',
              fontWeight: 700
            }}
          >
            4 ACTIVE
          </span>
        </button>
      </div>

      {/* Viewport Content Area */}
      <div style={{ padding: '20px', minHeight: '340px', background: '#04070d' }}>
        {/* STATE A: AGENT STREAM */}
        {activeTab === 'stream' && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', lineHeight: '1.65' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span>PROCESSED BY @asterim/core v2.4.0</span>
              <span style={{ color: '#10b981' }}>PTY BACKPRESSURE: 16ms (0 DROPPED FRAMES)</span>
            </div>

            <div style={{ color: '#94a3b8', marginBottom: '6px' }}>
              <span style={{ color: '#38bdf8' }}>[10:18:04]</span> <span style={{ color: '#10b981' }}>info:</span> Dispatching agent thread #tr-8942 on local workstation...
            </div>
            <div style={{ color: '#94a3b8', marginBottom: '6px' }}>
              <span style={{ color: '#38bdf8' }}>[10:18:05]</span> <span style={{ color: '#10b981' }}>tool:</span> <span style={{ color: '#f8fafc' }}>graphify_query(&quot;AST security intercept rules&quot;)</span>
            </div>
            <div style={{ color: '#cbd5e1', marginBottom: '6px', paddingLeft: '16px', borderLeft: '2px solid rgba(16,185,129,0.3)' }}>
              Found 14 related symbols in <span style={{ color: '#38bdf8' }}>/packages/core/src/security/ast_parser.ts</span>
            </div>
            <div style={{ color: '#94a3b8', marginBottom: '6px' }}>
              <span style={{ color: '#38bdf8' }}>[10:18:06]</span> <span style={{ color: '#fbbf24' }}>exec:</span> <span style={{ color: '#f8fafc' }}>pnpm --filter @asterim/core test -- --watch=false</span>
            </div>
            <div style={{ color: '#10b981', marginBottom: '6px' }}>
              ✓ 42 tests passed in 1.18s (100% assertion coverage)
            </div>
            <div style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
              <span style={{ color: '#10b981' }}>❯</span>
              <span style={{ color: '#f8fafc' }}>Agent streaming log... awaiting approval response or user input</span>
              <span className="blinking-cursor" style={{ width: '8px', height: '16px', background: '#10b981', display: 'inline-block' }} />
            </div>
          </div>
        )}

        {/* STATE B: AST SECURITY GUARD */}
        {activeTab === 'ast-guard' && (
          <div>
            <div
              style={{
                background: astState === 'pending' ? 'rgba(239, 68, 68, 0.08)' : astState === 'approved' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                border: astState === 'pending' ? '1px solid rgba(239, 68, 68, 0.3)' : astState === 'approved' ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '16px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IconShield size={18} color={astState === 'pending' ? '#ef4444' : astState === 'approved' ? '#10b981' : '#64748b'} />
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#f8fafc' }}>
                    {astState === 'pending' ? 'AST Command Intercept Hazard Detected' : astState === 'approved' ? 'Security Clearance Granted' : 'Execution Intercept Rejected'}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: astState === 'pending' ? 'rgba(239, 68, 68, 0.2)' : astState === 'approved' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                    color: astState === 'pending' ? '#ef4444' : astState === 'approved' ? '#10b981' : '#94a3b8'
                  }}
                >
                  {astState === 'pending' ? 'HAZARD LEVEL 4' : astState === 'approved' ? 'CLEARED' : 'BLOCKED'}
                </span>
              </div>

              <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '12px' }}>
                Agent attempted to execute a potentially destructive system CLI payload:
              </p>

              <div
                style={{
                  background: '#000000',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.84rem',
                  color: '#f8fafc',
                  border: '1px solid rgba(255,255,255,0.08)',
                  marginBottom: '16px'
                }}
              >
                <span style={{ color: '#ef4444' }}>rm -rf /var/log/app.log</span> <span style={{ color: '#94a3b8' }}>&amp;&amp;</span> <span style={{ color: '#fbbf24' }}>sudo systemctl restart nginx</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <span style={{ fontSize: '0.8rem', color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                  Interception Promise ID: #pr-98214
                </span>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={() => setAstState('rejected')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      color: '#ef4444',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      cursor: 'pointer'
                    }}
                  >
                    <IconX size={14} color="#ef4444" />
                    Reject Action
                  </button>

                  <button
                    onClick={() => setAstState('approved')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      background: '#10b981',
                      border: 'none',
                      color: '#042114',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: 'pointer'
                    }}
                  >
                    <IconCheck size={14} color="#042114" />
                    Approve &amp; Continue
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STATE C: SCOPED ENVIRONMENT */}
        {activeTab === 'environment' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#f8fafc' }}>
                Select Active Workspace Environment Scope:
              </span>

              <div style={{ display: 'inline-flex', background: '#0d1424', padding: '3px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
                {(['personal', 'company', 'client'] as EnvironmentScope[]).map((scope) => (
                  <button
                    key={scope}
                    onClick={() => setEnvScope(scope)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '4px',
                      border: 'none',
                      background: envScope === scope ? '#10b981' : 'transparent',
                      color: envScope === scope ? '#042114' : '#94a3b8',
                      fontWeight: envScope === scope ? 700 : 500,
                      fontSize: '0.8rem',
                      textTransform: 'capitalize',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {scope}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: '#090e1a', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', padding: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '10px', fontSize: '0.84rem', fontFamily: 'var(--font-mono)', marginBottom: '12px' }}>
                <span style={{ color: '#64748b' }}>ROOT PATH:</span>
                <span style={{ color: '#38bdf8' }}>
                  {envScope === 'personal' && '~/projects/personal/asterim-cli'}
                  {envScope === 'company' && '~/work/acme-corp/backend-api'}
                  {envScope === 'client' && '~/clients/fintech-app/mobile'}
                </span>

                <span style={{ color: '#64748b' }}>SECRETS SCOPE:</span>
                <span style={{ color: '#10b981' }}>
                  {envScope === 'personal' && 'AWS_ACCESS_KEY: (Masked ••••8912)'}
                  {envScope === 'company' && 'PROD_DATABASE_URL: (Hardware Enclave Scoped)'}
                  {envScope === 'client' && 'STRIPE_SECRET_KEY: (Isolated Client Vault)'}
                </span>

                <span style={{ color: '#64748b' }}>SECURITY RULE:</span>
                <span style={{ color: '#f8fafc' }}>
                  {envScope === 'personal' && 'Local Filesystem Access Only (Read/Write)'}
                  {envScope === 'company' && 'RBAC Level 2 + Mandatory AST Clearance Gate'}
                  {envScope === 'client' && 'Zero-Trust Audit Log + Read-Only Git Tree'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* STATE D: SWARM TELEMETRY */}
        {activeTab === 'swarm' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              {[
                { name: 'Claude Code 3.7', task: 'Refactoring GraphQL AST parser', status: 'STREAMING', pct: '84%', mem: '142MB', pty: '/dev/pts/2' },
                { name: 'Aider v0.72', task: 'Updating unit test coverage', status: 'EXECUTING', pct: '92%', mem: '98MB', pty: '/dev/pts/3' },
                { name: 'Codex CLI', task: 'Generating TypeScript types', status: 'WAITING GATE', pct: '45%', mem: '76MB', pty: '/dev/pts/4' },
                { name: 'Antigravity Core', task: 'Knowledge tree extraction', status: 'INDEXING', pct: '60%', mem: '210MB', pty: '/dev/pts/5' }
              ].map((agent, i) => (
                <div key={i} style={{ background: '#090e1a', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', padding: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc' }}>{agent.name}</span>
                    <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '1px 5px', borderRadius: '3px' }}>
                      {agent.status}
                    </span>
                  </div>

                  <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '10px', height: '36px', overflow: 'hidden' }}>
                    {agent.task}
                  </p>

                  <div style={{ background: 'rgba(255,255,255,0.06)', height: '4px', borderRadius: '2px', overflow: 'hidden', marginBottom: '8px' }}>
                    <div style={{ background: '#10b981', width: agent.pct, height: '100%' }} />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                    <span>RAM: {agent.mem}</span>
                    <span>PTY: {agent.pty}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quickstart Command Bar Anchor */}
      <div
        style={{
          height: '42px',
          background: '#070a10',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.82rem',
          fontFamily: 'var(--font-mono)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#10b981' }}>$</span>
          <span style={{ color: '#f8fafc' }}>npm install -g asterim</span>
        </div>

        <button
          onClick={handleCopyCmd}
          style={{
            background: 'transparent',
            border: 'none',
            color: copied ? '#10b981' : '#94a3b8',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.78rem',
            fontFamily: 'var(--font-mono)'
          }}
        >
          {copied ? <IconCheck size={12} color="#10b981" /> : <IconCopy size={12} color="#94a3b8" />}
          {copied ? 'Copied to clipboard!' : 'Copy Quickstart'}
        </button>
      </div>
    </div>
  );
};
