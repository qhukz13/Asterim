import React, { useState } from 'react';
import {
  IconTerminal,
  IconShield,
  IconLock,
  IconZap,
  IconCheck,
  IconX,
  IconLayers,
  IconFolder,
  IconTarget,
  IconAlertTriangle,
  IconSearch,
  IconPlus
} from '../common/MarketingIcons';

export type SandboxTab = 'chat' | 'terminal' | 'ast-guard' | 'environment';
export type EnvironmentScope = 'personal' | 'company' | 'client';

export interface TranscriptStep {
  type: 'log' | 'tool' | 'security';
  text: string;
}

export interface ThreadData {
  id: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  name: string;
  agent: string;
  status: 'approval' | 'working' | 'completed';
  mission: string;
  userPrompt: string;
  transcriptSteps: TranscriptStep[];
  approvalCmd?: string;
  riskScore?: string;
  attachedFiles: string[];
  terminalLog: string[];
  pidInfo: string;
}

export const THREADS_DATA: Record<string, ThreadData> = {
  'tr-104': {
    id: 'tr-104',
    projectId: 'asterim-core',
    projectName: 'asterim-core',
    projectPath: 'packages/core',
    name: 'Thread #104: AST Parser',
    agent: 'Claude Code 3.7',
    status: 'approval',
    mission: 'Refactor AST Command Intercept & Audit Logging Engine',
    userPrompt: 'Refactor process lifecycle logging in ApprovalManager.ts and clean up legacy logs.',
    transcriptSteps: [
      { type: 'log', text: '[11:48:01] agent: Analyzing AST symbol graph for packages/core...' },
      { type: 'tool', text: 'read_file("packages/core/src/security/ast_parser.ts")' },
      { type: 'security', text: 'AST Security Guard Intercepted payload: rm -rf /src/legacy' }
    ],
    approvalCmd: 'rm -rf /src/legacy && git commit -m "refactor: ast parser"',
    riskScore: '8.4 / 10',
    attachedFiles: ['packages/core/src/security/ast_parser.ts', 'apps/web/src/components/TopBar.tsx', 'AGENTS.md'],
    terminalLog: [
      '[11:48:00] pty_init: Spawning local bash process #42109',
      '[11:48:01] asterim: Attached Claude Code agent to PTY stream',
      '✓ PASS packages/core/src/security/ast_parser.test.ts',
      'Test Suites: 1 passed, 1 total'
    ],
    pidInfo: 'PID: 42109 | CPU: 12% | RAM: 142MB'
  },
  'tr-105': {
    id: 'tr-105',
    projectId: 'analytics-service',
    projectName: 'analytics-service',
    projectPath: 'services/telemetry',
    name: 'Thread #105: Process Tree',
    agent: 'Aider v0.72',
    status: 'working',
    mission: 'Optimize PTY Terminal 16ms Frame-Chunking Buffer',
    userPrompt: 'Fix terminal output stutter when streaming 10,000+ lines/sec.',
    transcriptSteps: [
      { type: 'log', text: '[11:50:12] agent: Inspecting TerminalService.ts frame buffer chunking...' },
      { type: 'tool', text: 'write_file("services/telemetry/TerminalService.ts")' },
      { type: 'log', text: '[11:50:15] agent: Benchmarking xterm.js render throughput...' }
    ],
    attachedFiles: ['services/telemetry/TerminalService.ts', 'services/telemetry/buffer.ts'],
    terminalLog: [
      '[11:50:10] pty_init: Spawning local zsh process #88301',
      '[11:50:12] asterim: Streaming 12,500 lines/sec throughput test',
      'Frame chunk buffer: 16ms steady state',
      '✓ PASS services/telemetry/TerminalService.test.ts'
    ],
    pidInfo: 'PID: 88301 | CPU: 8% | RAM: 98MB'
  },
  'tr-106': {
    id: 'tr-106',
    projectId: 'mobile-relay',
    projectName: 'mobile-relay',
    projectPath: 'apps/mobile',
    name: 'Thread #106: Runner Pool',
    agent: 'Antigravity',
    status: 'completed',
    mission: 'Implement Mobile Push Relay & E2E Noise Tunnel',
    userPrompt: 'Add Noise protocol handshake to mobile websocket relay.',
    transcriptSteps: [
      { type: 'log', text: '[11:40:00] agent: Initialized Noise protocol handshake generator.' },
      { type: 'tool', text: 'exec("pnpm test apps/mobile")' },
      { type: 'log', text: '[11:42:10] agent: All E2E mobile push tests passed successfully.' }
    ],
    attachedFiles: ['apps/mobile/src/push.ts', 'packages/shared/src/types.ts'],
    terminalLog: [
      '[11:40:00] pty_init: Spawning mobile relay daemon #10492',
      '✓ PASS apps/mobile/push.test.ts',
      'Commit created: 7a7eb7f "feat: add Noise protocol relay"'
    ],
    pidInfo: 'PID: 10492 | CPU: 0% | RAM: 45MB'
  }
};

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
  const [activeThreadId, setActiveThreadId] = useState<string>('tr-104');
  const [projectSearchQuery, setProjectSearchQuery] = useState('');

  const [threadStatuses, setThreadStatuses] = useState<Record<string, 'approval' | 'working' | 'completed'>>({
    'tr-104': 'approval',
    'tr-105': 'working',
    'tr-106': 'completed'
  });

  const [selectedSampleCmd, setSelectedSampleCmd] = useState<'rm' | 'test' | 'push'>('rm');
  const [sampleCmdStatus, setSampleCmdStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');

  const currentThread = THREADS_DATA[activeThreadId] || THREADS_DATA['tr-104'];
  const currentStatus = threadStatuses[activeThreadId] || currentThread.status;

  const handleSelectThread = (threadId: string) => {
    setActiveThreadId(threadId);
  };

  const handleSelectProject = (projectId: string) => {
    const matchingThread = Object.values(THREADS_DATA).find((t) => t.projectId === projectId);
    if (matchingThread) {
      setActiveThreadId(matchingThread.id);
    }
  };

  const handleApproveAction = () => {
    setThreadStatuses((prev) => ({ ...prev, [activeThreadId]: 'working' }));
    setTimeout(() => {
      setThreadStatuses((prev) => ({ ...prev, [activeThreadId]: 'completed' }));
    }, 2000);
  };

  const handleDenyAction = () => {
    setThreadStatuses((prev) => ({ ...prev, [activeThreadId]: 'approval' }));
  };

  const projectsList = [
    { id: 'asterim-core', name: 'asterim-core', path: 'packages/core' },
    { id: 'analytics-service', name: 'analytics-service', path: 'services/telemetry' },
    { id: 'mobile-relay', name: 'mobile-relay', path: 'apps/mobile' }
  ].filter(
    (p) =>
      p.name.toLowerCase().includes(projectSearchQuery.toLowerCase()) ||
      p.path.toLowerCase().includes(projectSearchQuery.toLowerCase())
  );

  return (
    <div className="workstation-frame" id="workstation-sandbox">
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
            <span>/</span>
            <span style={{ color: '#f8fafc', fontWeight: 600 }}>{currentThread.projectName}</span>
            <span>/</span>
            <span style={{ color: '#64748b' }}>#{currentThread.id}</span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 12px',
            background: '#070a10',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '100px',
            fontSize: '0.75rem',
            color: '#94a3b8',
            maxWidth: '380px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          <IconTarget size={12} color="#10b981" />
          <span style={{ color: '#f8fafc', fontWeight: 600, flexShrink: 0 }}>Mission:</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentThread.mission}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {currentStatus === 'approval' ? (
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
          ) : currentStatus === 'working' ? (
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
              <span>Working ({currentThread.agent})</span>
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
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '230px 1fr 260px',
          minHeight: '480px',
          background: '#04070d'
        }}
      >
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
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={projectSearchQuery}
              onChange={(e) => setProjectSearchQuery(e.target.value)}
              placeholder="Filter projects..."
              style={{
                width: '100%',
                padding: '6px 8px 6px 26px',
                borderRadius: '6px',
                background: '#0d1424',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#f8fafc',
                fontSize: '0.78rem',
                outline: 'none'
              }}
            />
            <div style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>
              <IconSearch size={12} color="#94a3b8" />
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
              Projects ({projectsList.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {projectsList.map((p) => {
                const isProjectActive = currentThread.projectId === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => handleSelectProject(p.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      background: isProjectActive ? '#0d1424' : 'transparent',
                      border: isProjectActive ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid transparent',
                      color: isProjectActive ? '#f8fafc' : '#94a3b8',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <IconFolder size={14} color={isProjectActive ? '#10b981' : '#64748b'} />
                    <div style={{ overflow: 'hidden' }}>
                      <div style={{ fontWeight: isProjectActive ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                      <div style={{ fontSize: '0.68rem', color: '#64748b', fontFamily: 'var(--font-mono)' }}>{p.path}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Active Threads
              </span>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#10b981', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '2px' }}>
                <IconPlus size={10} color="#10b981" /> New Agent
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {Object.values(THREADS_DATA).map((t) => {
                const isSelected = activeThreadId === t.id;
                const status = threadStatuses[t.id] || t.status;
                const statusColor = status === 'approval' ? '#f59e0b' : status === 'working' ? '#10b981' : '#34d399';
                const statusLabel = status === 'approval' ? 'Action Req' : status === 'working' ? 'Working' : 'Done';

                return (
                  <button
                    key={t.id}
                    onClick={() => handleSelectThread(t.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      padding: '8px',
                      borderRadius: '6px',
                      background: isSelected ? '#0d1424' : 'transparent',
                      border: isSelected ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid transparent',
                      borderLeft: isSelected ? '3px solid #10b981' : '1px solid transparent',
                      color: isSelected ? '#f8fafc' : '#94a3b8',
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: isSelected ? 700 : 500, color: isSelected ? '#f8fafc' : '#cbd5e1' }}>{t.name}</span>
                      <span style={{ fontSize: '0.65rem', color: statusColor, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                        {statusLabel}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Agent: {t.agent}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', background: '#04070d' }}>
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

          <div style={{ padding: '16px', flex: 1, overflowY: 'auto' }}>
            {activeTab === 'chat' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#090e1a', border: '1px solid rgba(255,255,255,0.06)', fontSize: '0.84rem' }}>
                  <div style={{ fontWeight: 700, color: '#38bdf8', marginBottom: '4px' }}>User Request</div>
                  <div style={{ color: '#cbd5e1' }}>
                    &quot;{currentThread.userPrompt}&quot;
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                  {currentThread.transcriptSteps.map((step, idx) => (
                    <div key={idx} style={{ color: step.type === 'tool' ? '#38bdf8' : step.type === 'security' ? '#f59e0b' : '#94a3b8' }}>
                      {step.type === 'security' ? (
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>{step.text}</span>
                      ) : (
                        <span>{step.text}</span>
                      )}
                    </div>
                  ))}
                </div>

                {currentThread.approvalCmd && (
                  <div
                    style={{
                      marginTop: '8px',
                      padding: '14px',
                      borderRadius: '8px',
                      background: currentStatus === 'approval' ? 'rgba(245, 158, 11, 0.08)' : currentStatus === 'working' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                      border: currentStatus === 'approval' ? '1px solid rgba(245, 158, 11, 0.35)' : currentStatus === 'working' ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.85rem', color: '#f8fafc' }}>
                        <IconAlertTriangle size={16} color={currentStatus === 'approval' ? '#f59e0b' : '#10b981'} />
                        <span>
                          {currentStatus === 'approval' ? 'Human Approval Required · Intercept #AST-402' : currentStatus === 'working' ? 'Command Executing...' : 'Command Approved & Executed'}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: '#ef4444', background: 'rgba(239, 68, 68, 0.2)', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                        RISK SCORE: {currentThread.riskScore || '7.5 / 10'}
                      </span>
                    </div>

                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', background: '#000000', padding: '8px 12px', borderRadius: '6px', color: '#f8fafc', marginBottom: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
                      {currentThread.approvalCmd}
                    </div>

                    {currentStatus === 'approval' ? (
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
                )}
              </div>
            )}

            {activeTab === 'terminal' && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', lineHeight: '1.6' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '0.75rem', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span>{currentThread.pidInfo}</span>
                  <span style={{ color: '#10b981' }}>PTY BACKPRESSURE: 16ms (0 DROPPED FRAMES)</span>
                </div>

                {currentThread.terminalLog.map((logLine, idx) => (
                  <div key={idx} style={{ color: logLine.startsWith('✓') ? '#10b981' : logLine.startsWith('[') ? '#38bdf8' : '#cbd5e1', marginBottom: '4px' }}>
                    {logLine}
                  </div>
                ))}

                <div style={{ color: '#10b981', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>❯</span>
                  <span>Agent process active. Streaming PTY logs...</span>
                  <span className="blinking-cursor" style={{ width: '8px', height: '14px', background: '#10b981', display: 'inline-block' }} />
                </div>
              </div>
            )}

            {activeTab === 'ast-guard' && (
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc', marginBottom: '10px' }}>
                  Test Real-Time AST Security Command Interception:
                </div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                  <button
                    onClick={() => { setSelectedSampleCmd('rm'); setSampleCmdStatus('pending'); }}
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
                    onClick={() => { setSelectedSampleCmd('test'); setSampleCmdStatus('approved'); }}
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
                    onClick={() => { setSelectedSampleCmd('push'); setSampleCmdStatus('pending'); }}
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

                <div style={{ background: '#090e1a', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc' }}>
                      {selectedSampleCmd === 'rm' && 'CRITICAL HAZARD: Destructive Path Traversal'}
                      {selectedSampleCmd === 'test' && 'LOW RISK: Read-Only Test Suite Execution'}
                      {selectedSampleCmd === 'push' && 'HIGH HAZARD: Non-Fast-Forward Force Push'}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: sampleCmdStatus === 'approved' ? '#10b981' : sampleCmdStatus === 'rejected' ? '#ef4444' : '#f59e0b', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                      {sampleCmdStatus === 'approved' ? 'PASSED / APPROVED' : sampleCmdStatus === 'rejected' ? 'REJECTED' : 'INTERCEPTED'}
                    </span>
                  </div>

                  <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '10px' }}>
                    {selectedSampleCmd === 'rm' && 'AST Guard detected an unconstrained recursive removal command targeting source directories.'}
                    {selectedSampleCmd === 'test' && 'AST Guard verified command is safe to execute automatically without developer interruption.'}
                    {selectedSampleCmd === 'push' && 'AST Guard detected a force overwrite to protected branch main.'}
                  </p>

                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => setSampleCmdStatus('rejected')}
                      style={{ padding: '6px 12px', borderRadius: '4px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Deny Command
                    </button>
                    <button
                      onClick={() => setSampleCmdStatus('approved')}
                      style={{ padding: '6px 12px', borderRadius: '4px', background: '#10b981', border: 'none', color: '#042114', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                    >
                      Approve Execution
                    </button>
                  </div>
                </div>
              </div>
            )}

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
                      {envScope === 'company' && `~/${currentThread.projectPath}`}
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
            AI CONTEXT &amp; STATE
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
            ATTACHED CONTEXT
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: '#cbd5e1' }}>
            {currentThread.attachedFiles.map((file, i) => (
              <div key={i} style={{ padding: '4px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.03)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                📄 {file}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
