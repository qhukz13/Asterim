import React, { useState, useEffect } from 'react';
import {
  IconTerminal,
  IconShield,
  IconLock,
  IconZap,
  IconCheck,
  IconX,
  IconCopy,
  IconLayers,
  IconFolder,
  IconTarget,
  IconAlertTriangle
} from '../common/MarketingIcons';

export type SandboxTab = 'chat' | 'terminal' | 'ast-guard' | 'environment';
export type EnvironmentScope = 'personal' | 'company' | 'client';

export interface AsterimWorkstationSandboxProps {
  initialTab?: SandboxTab;
}

export const AsterimWorkstationSandbox: React.FC<AsterimWorkstationSandboxProps> = ({ initialTab = 'chat' }) => {
  const getInitialTab = (): SandboxTab => {
    const hash = window.location.hash.replace('#', '') as SandboxTab;
    if (['chat', 'terminal', 'ast-guard', 'environment'].includes(hash)) {
      return hash;
    }
    return initialTab;
  };

  const [activeTab, setActiveTab] = useState<SandboxTab>(getInitialTab);
  const [envScope, setEnvScope] = useState<EnvironmentScope>('company');
  const [activeProject, setActiveProject] = useState('asterim-core');
  const [activeThreadId, setActiveThreadId] = useState('tr-104');
  
  // Interactive Agent Execution State
  const [agentStatus, setAgentStatus] = useState<'working' | 'approval' | 'completed'>('approval');
  const [astCommandState, setAstCommandState] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [selectedSampleCmd, setSelectedSampleCmd] = useState<'rm' | 'test' | 'push'>('rm');
  const [copied, setCopied] = useState(false);

  // Chat Streaming Simulation
  const [streamIndex, setStreamIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStreamIndex((prev) => (prev < 4 ? prev + 1 : prev));
    }, 1200);
    return () => clearInterval(timer);
  }, []);

  const handleCopyCmd = () => {
    navigator.clipboard.writeText('npm install -g asterim');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApproveAction = () => {
    setAgentStatus('working');
    setAstCommandState('approved');
    setTimeout(() => {
      setAgentStatus('completed');
    }, 2500);
  };

  const handleDenyAction = () => {
    setAgentStatus('approval');
    setAstCommandState('rejected');
  };

  return (
    <div className="workstation-frame" id="workstation-sandbox">
      {/* 1. Workstation TopBar Chrome (Exact match to apps/web TopBar) */}
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
        {/* Left: Window Controls + Workspace Switcher + Location Context */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
          </div>

          {/* Environment Scope Selector Pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 10px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              fontSize: '0.78rem',
              fontWeight: 600,
              color: '#f8fafc',
              cursor: 'pointer'
            }}
          >
            <IconLayers size={13} color="#10b981" />
            <span>
              {envScope === 'personal' && 'Personal Workspace'}
              {envScope === 'company' && 'Company Workspace (Acme Corp)'}
              {envScope === 'client' && 'Client Enclave Scope'}
            </span>
          </div>

          {/* Project & Thread Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
            <span>/</span>
            <span style={{ color: '#f8fafc', fontWeight: 600 }}>{activeProject}</span>
            <span>/</span>
            <span style={{ color: '#64748b' }}>#{activeThreadId}</span>
          </div>
        </div>

        {/* Center: Mission Target Focus */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 12px', background: '#070a10', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '100px', fontSize: '0.75rem', color: '#94a3b8' }}>
          <IconTarget size={12} color="#10b981" />
          <span style={{ color: '#f8fafc', fontWeight: 600 }}>Mission:</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '280px', whiteSpace: 'nowrap' }}>
            Refactor AST Command Intercept &amp; Audit Logging Engine
          </span>
        </div>

        {/* Right: Rich Agent State Pill + Workstation Status + Command Palette Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Agent State Pill */}
          {agentStatus === 'approval' ? (
            <div
              style={{
                padding: '3px 10px',
                borderRadius: '100px',
                fontSize: '0.72rem',
                fontWeight: 700,
                background: 'rgba(245, 158, 11, 0.12)',
                color: '#f59e0b',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <IconAlertTriangle size={12} color="#f59e0b" />
              <span>Action Required · Paused for Review</span>
            </div>
          ) : agentStatus === 'working' ? (
            <div
              style={{
                padding: '3px 10px',
                borderRadius: '100px',
                fontSize: '0.72rem',
                fontWeight: 700,
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
              <span>Working (Claude Code 3.7)</span>
            </div>
          ) : (
            <div
              style={{
                padding: '3px 10px',
                borderRadius: '100px',
                fontSize: '0.72rem',
                fontWeight: 700,
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <IconCheck size={12} color="#34d399" />
              <span>Mission Complete</span>
            </div>
          )}

          {/* Workstation Host Status */}
          <div
            style={{
              padding: '3px 8px',
              borderRadius: '4px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              fontSize: '0.72rem',
              color: '#94a3b8',
              fontFamily: 'var(--font-mono)',
              display: 'flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
            <span>Local Host</span>
          </div>

          <span style={{ padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', fontSize: '0.7rem', color: '#64748b', fontFamily: 'var(--font-mono)' }}>
            ⌘K
          </span>
        </div>
      </div>

      {/* 2. Main Workstation Body (Sidebar + Viewport + Inspector Panel) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '220px 1fr 260px',
          minHeight: '480px',
          background: '#04070d'
        }}
      >
        {/* Left Sidebar: Projects & Active Threads */}
        <div
          style={{
            borderRight: '1px solid rgba(255, 255, 255, 0.06)',
            background: '#070a10',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}
        >
          {/* Projects Section */}
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
              Workspace Projects
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {[
                { id: 'asterim-core', name: 'asterim-core', path: 'packages/core' },
                { id: 'analytics-service', name: 'analytics-service', path: 'services/telemetry' },
                { id: 'mobile-relay', name: 'mobile-relay', path: 'apps/mobile' }
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setActiveProject(p.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    background: activeProject === p.id ? '#0d1424' : 'transparent',
                    border: activeProject === p.id ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid transparent',
                    color: activeProject === p.id ? '#f8fafc' : '#94a3b8',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <IconFolder size={14} color={activeProject === p.id ? '#10b981' : '#64748b'} />
                  <div>
                    <div style={{ fontWeight: activeProject === p.id ? 700 : 500 }}>{p.name}</div>
                    <div style={{ fontSize: '0.68rem', color: '#64748b', fontFamily: 'var(--font-mono)' }}>{p.path}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Active Threads Section */}
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
              Active Threads
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {[
                { id: 'tr-104', name: 'Thread #104: AST Parser', agent: 'Claude Code', status: 'Action Req', color: '#f59e0b' },
                { id: 'tr-105', name: 'Thread #105: Process Tree', agent: 'Aider v0.72', status: 'Working', color: '#10b981' },
                { id: 'tr-106', name: 'Thread #106: Runner Pool', agent: 'Antigravity', status: 'Idle', color: '#64748b' }
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveThreadId(t.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    padding: '8px',
                    borderRadius: '6px',
                    background: activeThreadId === t.id ? '#0d1424' : 'transparent',
                    border: activeThreadId === t.id ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid transparent',
                    color: activeThreadId === t.id ? '#f8fafc' : '#94a3b8',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600 }}>{t.name}</span>
                    <span style={{ fontSize: '0.65rem', color: t.color, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                      {t.status}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Agent: {t.agent}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Center Main Viewport */}
        <div style={{ display: 'flex', flexDirection: 'column', background: '#04070d' }}>
          {/* Tab Navigation Bar */}
          <div
            style={{
              height: '38px',
              background: '#070a10',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              padding: '0 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            {[
              { id: 'chat', label: 'Agent Chat & Telemetry', icon: <IconZap size={13} /> },
              { id: 'terminal', label: 'Live Terminal Stream', icon: <IconTerminal size={13} /> },
              { id: 'ast-guard', label: 'AST Command Safety', icon: <IconShield size={13} /> },
              { id: 'environment', label: 'Environment Scopes', icon: <IconLock size={13} /> }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as SandboxTab)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  background: activeTab === tab.id ? '#0d1424' : 'transparent',
                  border: 'none',
                  borderBottom: activeTab === tab.id ? '2px solid #10b981' : '2px solid transparent',
                  color: activeTab === tab.id ? '#f8fafc' : '#94a3b8',
                  fontSize: '0.8rem',
                  fontWeight: activeTab === tab.id ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Viewport Content */}
          <div style={{ padding: '16px', flex: 1, overflowY: 'auto' }}>
            {/* TAB 1: AGENT CHAT & TELEMETRY */}
            {activeTab === 'chat' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#090e1a', border: '1px solid rgba(255,255,255,0.06)', fontSize: '0.84rem' }}>
                  <div style={{ fontWeight: 700, color: '#38bdf8', marginBottom: '4px' }}>User Request</div>
                  <div style={{ color: '#cbd5e1' }}>
                    &quot;Refactor process lifecycle logging in <span style={{ color: '#10b981', fontFamily: 'var(--font-mono)' }}>ApprovalManager.ts</span> and clean up legacy logs.&quot;
                  </div>
                </div>

                {/* Animated Agent Execution Log Steps */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                  {streamIndex >= 0 && (
                    <div style={{ color: '#94a3b8' }}>
                      <span style={{ color: '#10b981' }}>[11:48:01] agent:</span> Analyzing AST symbol graph for <span style={{ color: '#f8fafc' }}>packages/core</span>...
                    </div>
                  )}
                  {streamIndex >= 1 && (
                    <div style={{ color: '#cbd5e1', paddingLeft: '12px', borderLeft: '2px solid rgba(16, 185, 129, 0.4)' }}>
                      Found 14 related functions across 3 files. Reading file context...
                    </div>
                  )}
                  {streamIndex >= 2 && (
                    <div style={{ color: '#38bdf8' }}>
                      [11:48:03] tool execution: <span style={{ color: '#f8fafc' }}>read_file(&quot;packages/core/src/security/ast_parser.ts&quot;)</span>
                    </div>
                  )}
                  {streamIndex >= 3 && (
                    <div style={{ color: '#f59e0b', fontWeight: 600 }}>
                      [11:48:04] AST Security Guard: Intercepted payload <span style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.15)', padding: '2px 6px', borderRadius: '4px' }}>rm -rf /src/legacy</span>
                    </div>
                  )}
                </div>

                {/* Interactive Human Approval Box */}
                <div
                  style={{
                    marginTop: '8px',
                    padding: '14px',
                    borderRadius: '8px',
                    background: agentStatus === 'approval' ? 'rgba(245, 158, 11, 0.08)' : agentStatus === 'working' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                    border: agentStatus === 'approval' ? '1px solid rgba(245, 158, 11, 0.35)' : agentStatus === 'working' ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.85rem', color: '#f8fafc' }}>
                      <IconAlertTriangle size={16} color={agentStatus === 'approval' ? '#f59e0b' : '#10b981'} />
                      <span>
                        {agentStatus === 'approval' ? 'Human Approval Required · Intercept #AST-402' : agentStatus === 'working' ? 'Command Executing...' : 'Command Approved & Executed'}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: '#ef4444', background: 'rgba(239, 68, 68, 0.2)', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                      RISK SCORE: 8.4 / 10
                    </span>
                  </div>

                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', background: '#000000', padding: '8px 12px', borderRadius: '6px', color: '#f8fafc', marginBottom: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <span style={{ color: '#ef4444' }}>rm -rf /src/legacy</span> <span style={{ color: '#94a3b8' }}>&amp;&amp;</span> <span style={{ color: '#10b981' }}>git commit -m &quot;refactor: ast parser&quot;</span>
                  </div>

                  {agentStatus === 'approval' ? (
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                      <button
                        onClick={handleDenyAction}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 14px',
                          borderRadius: '6px',
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          color: '#ef4444',
                          fontWeight: 600,
                          fontSize: '0.8rem',
                          cursor: 'pointer'
                        }}
                      >
                        <IconX size={14} color="#ef4444" /> Deny Command
                      </button>
                      <button
                        onClick={handleApproveAction}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 14px',
                          borderRadius: '6px',
                          background: '#10b981',
                          border: 'none',
                          color: '#042114',
                          fontWeight: 700,
                          fontSize: '0.8rem',
                          cursor: 'pointer'
                        }}
                      >
                        <IconCheck size={14} color="#042114" /> Approve Command
                      </button>
                    </div>
                  ) : (
                    <div style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <IconCheck size={14} color="#10b981" />
                      <span>Security Clearance GRANTED by developer. Execution proceeding...</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: LIVE TERMINAL STREAM */}
            {activeTab === 'terminal' && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', lineHeight: '1.6' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '0.75rem', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span>PID: 42109 | PROCESS: node (asterim-daemon)</span>
                  <span style={{ color: '#10b981' }}>CPU: 12% | RAM: 142MB | PTY: /dev/pts/2</span>
                </div>
                <div style={{ color: '#64748b' }}>[11:48:00] pty_init: Spawning local bash process #42109</div>
                <div style={{ color: '#38bdf8' }}>[11:48:01] asterim: Attached Claude Code agent to PTY stream</div>
                <div style={{ color: '#f8fafc' }}>$ pnpm --filter @asterim/core test</div>
                <div style={{ color: '#10b981', marginTop: '6px' }}>✓ PASS packages/core/src/security/ast_parser.test.ts</div>
                <div style={{ color: '#10b981' }}>✓ PASS packages/core/src/security/command_interceptor.test.ts</div>
                <div style={{ color: '#94a3b8', marginTop: '8px' }}>Test Suites: 2 passed, 2 total</div>
                <div style={{ color: '#94a3b8' }}>Tests:       42 passed, 42 total</div>
                <div style={{ color: '#94a3b8' }}>Time:        1.14s</div>
                <div style={{ color: '#10b981', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>❯</span>
                  <span>Agent process ready. Listening to PTY input stream...</span>
                  <span className="blinking-cursor" style={{ width: '8px', height: '14px', background: '#10b981', display: 'inline-block' }} />
                </div>
              </div>
            )}

            {/* TAB 3: AST COMMAND SAFETY */}
            {activeTab === 'ast-guard' && (
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc', marginBottom: '10px' }}>
                  Test Real-Time AST Security Command Interception:
                </div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                  <button
                    onClick={() => { setSelectedSampleCmd('rm'); setAstCommandState('pending'); }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      background: selectedSampleCmd === 'rm' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.03)',
                      border: selectedSampleCmd === 'rm' ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255,255,255,0.08)',
                      color: selectedSampleCmd === 'rm' ? '#ef4444' : '#94a3b8',
                      fontSize: '0.8rem',
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer'
                    }}
                  >
                    rm -rf /src
                  </button>

                  <button
                    onClick={() => { setSelectedSampleCmd('test'); setAstCommandState('approved'); }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      background: selectedSampleCmd === 'test' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.03)',
                      border: selectedSampleCmd === 'test' ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255,255,255,0.08)',
                      color: selectedSampleCmd === 'test' ? '#10b981' : '#94a3b8',
                      fontSize: '0.8rem',
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer'
                    }}
                  >
                    npm test
                  </button>

                  <button
                    onClick={() => { setSelectedSampleCmd('push'); setAstCommandState('pending'); }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      background: selectedSampleCmd === 'push' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255,255,255,0.03)',
                      border: selectedSampleCmd === 'push' ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(255,255,255,0.08)',
                      color: selectedSampleCmd === 'push' ? '#f59e0b' : '#94a3b8',
                      fontSize: '0.8rem',
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer'
                    }}
                  >
                    git push --force origin main
                  </button>
                </div>

                {/* Inspector Drawer for selected command */}
                <div style={{ background: '#090e1a', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc' }}>
                      {selectedSampleCmd === 'rm' && 'CRITICAL HAZARD: Destructive Path Traversal'}
                      {selectedSampleCmd === 'test' && 'LOW RISK: Read-Only Test Suite Execution'}
                      {selectedSampleCmd === 'push' && 'HIGH HAZARD: Non-Fast-Forward Force Push'}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: astCommandState === 'approved' ? '#10b981' : astCommandState === 'rejected' ? '#ef4444' : '#f59e0b', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                      {astCommandState === 'approved' ? 'PASSED / APPROVED' : astCommandState === 'rejected' ? 'REJECTED' : 'INTERCEPTED'}
                    </span>
                  </div>

                  <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '10px' }}>
                    {selectedSampleCmd === 'rm' && 'AST Guard detected an unconstrained recursive removal command targeting source directories.'}
                    {selectedSampleCmd === 'test' && 'AST Guard verified command is safe to execute automatically without developer interruption.'}
                    {selectedSampleCmd === 'push' && 'AST Guard detected a force overwrite to protected branch main.'}
                  </p>

                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={handleDenyAction}
                      style={{ padding: '6px 12px', borderRadius: '4px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Deny Command
                    </button>
                    <button
                      onClick={handleApproveAction}
                      style={{ padding: '6px 12px', borderRadius: '4px', background: '#10b981', border: 'none', color: '#042114', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                    >
                      Approve Execution
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: ENVIRONMENT SCOPES */}
            {activeTab === 'environment' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc' }}>
                    Active Workspace Isolation Preset:
                  </span>

                  <div style={{ display: 'inline-flex', background: '#070a10', padding: '3px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    {(['personal', 'company', 'client'] as EnvironmentScope[]).map((scope) => (
                      <button
                        key={scope}
                        onClick={() => setEnvScope(scope)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '4px',
                          border: 'none',
                          background: envScope === scope ? '#10b981' : 'transparent',
                          color: envScope === scope ? '#042114' : '#94a3b8',
                          fontWeight: envScope === scope ? 700 : 500,
                          fontSize: '0.78rem',
                          textTransform: 'capitalize',
                          cursor: 'pointer'
                        }}
                      >
                        {scope}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ background: '#090e1a', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', padding: '14px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                    <span style={{ color: '#64748b' }}>ROOT PATH:</span>
                    <span style={{ color: '#38bdf8' }}>
                      {envScope === 'personal' && '~/projects/personal/asterim-cli'}
                      {envScope === 'company' && '~/work/acme-corp/backend-api'}
                      {envScope === 'client' && '~/clients/fintech-app/mobile'}
                    </span>

                    <span style={{ color: '#64748b' }}>SECRETS VAULT:</span>
                    <span style={{ color: '#10b981' }}>
                      {envScope === 'personal' && 'Local Secrets Only (Masked ••••8912)'}
                      {envScope === 'company' && 'Hardware Enclave Scoped (Prod DB Encrypted)'}
                      {envScope === 'client' && 'Isolated Client Vault (Zero Exposure)'}
                    </span>

                    <span style={{ color: '#64748b' }}>RBAC POLICY:</span>
                    <span style={{ color: '#f8fafc' }}>
                      {envScope === 'personal' && 'Full System Access (Local Filesystem Only)'}
                      {envScope === 'company' && 'Team Lead Approval Gate + Mandatory AST Scan'}
                      {envScope === 'client' && 'Zero-Trust Audit Scoped (Read-Only Git Tree)'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Inspector Panel (Matches apps/web InspectorPanel) */}
        <div
          style={{
            borderLeft: '1px solid rgba(255, 255, 255, 0.06)',
            background: '#070a10',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}
        >
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            AI Context &amp; State
          </div>

          <div style={{ padding: '10px', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#34d399', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <IconShield size={14} color="#10b981" />
              AST GUARD ACTIVE
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.4 }}>
              Zero-Trust clearance rules active. Dangerous CLI mutations intercepted before shell execution.
            </div>
          </div>

          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Attached Context
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: '#cbd5e1' }}>
            <div style={{ padding: '4px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.03)' }}>
              📄 packages/core/src/security/ast_parser.ts
            </div>
            <div style={{ padding: '4px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.03)' }}>
              📄 apps/web/src/components/TopBar.tsx
            </div>
            <div style={{ padding: '4px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.03)' }}>
              📄 AGENTS.md
            </div>
          </div>
        </div>
      </div>

      {/* 3. Bottom Quickstart Anchor Bar */}
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
          <span style={{ color: '#10b981', fontWeight: 700 }}>$</span>
          <span style={{ color: '#f8fafc' }}>npx asterim</span>
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
          {copied ? <IconCheck size={14} color="#10b981" /> : <IconCopy size={14} color="#94a3b8" />}
          {copied ? 'Copied to clipboard!' : 'Copy Shell Command'}
        </button>
      </div>
    </div>
  );
};



