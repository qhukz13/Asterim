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
  IconPlus,
  IconChevronRight,
  IconChevronDown,
  IconFileCode,
  IconUser,
  IconBot,
  IconSend
} from '../common/MarketingIcons';

export type SandboxTab = 'chat' | 'terminal' | 'changes' | 'settings' | 'environment';

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
  terminalLog?: string[];
  pidInfo?: string;
  diffCode?: string;
  agentResponseText?: string;
  commitBadge?: string;
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
    diffCode: `- log.info("legacy process start", pid);\n+ ProcessTreeManager.trackSubprocess(pid, { isolateEnv: true });`,
    approvalCmd: 'rm -rf /src/legacy && git commit -m "refactor: ast parser"',
    riskScore: '8.4 / 10',
    attachedFiles: ['packages/core/src/security/ast_parser.ts', 'apps/web/src/components/TopBar.tsx', 'AGENTS.md']
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
    pidInfo: 'PID 88301 | CPU 8% | RAM 98MB'
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
    agentResponseText: 'Completed Noise protocol handshake implementation. All E2E push tests passed successfully.',
    commitBadge: '✓ Commit 7a7eb7f "feat: add Noise protocol relay"',
    attachedFiles: ['apps/mobile/src/push.ts', 'packages/shared/src/types.ts']
  }
};

function ToolAccordion({
  title,
  children,
  defaultOpen = false,
  type = 'tool',
  status = 'success'
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  type?: 'thought' | 'tool' | 'diff';
  status?: 'success' | 'running' | 'failed';
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        margin: '8px 0',
        borderRadius: '6px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: '#070a10',
        overflow: 'hidden'
      }}
    >
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          background: '#0d1424',
          fontSize: '0.78rem',
          fontFamily: 'var(--font-mono)',
          color: '#94a3b8'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {type === 'diff' ? (
            <IconFileCode size={13} color="#10b981" />
          ) : (
            <IconTerminal size={13} color="#10b981" />
          )}
          <span style={{ fontWeight: 600, color: '#f8fafc' }}>{title}</span>
          <span
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: '100px',
              background: status === 'running' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              color: status === 'running' ? '#38bdf8' : '#10b981',
              border: status === 'running' ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)'
            }}
          >
            {status === 'running' ? 'Running' : 'Success'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: '#64748b' }}>
          {isOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          <span>{isOpen ? 'Collapse' : 'Expand Log'}</span>
        </div>
      </div>
      {isOpen && (
        <div
          style={{
            padding: '10px 14px',
            background: '#04070d',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.78rem',
            lineHeight: 1.6,
            color: '#cbd5e1',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)'
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function DiffBlock({ code }: { code: string }) {
  const lines = code.split('\n');
  return (
    <div
      style={{
        borderRadius: '6px',
        overflow: 'hidden',
        margin: '10px 0',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: '#04070d',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.78rem',
        lineHeight: 1.6
      }}
    >
      <div
        style={{
          background: '#0d1424',
          padding: '4px 12px',
          fontSize: '0.7rem',
          color: '#64748b',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          letterSpacing: '0.05em'
        }}
      >
        <span>DIFF EXCERPT</span>
        <span style={{ color: '#10b981' }}>+1 -1 lines</span>
      </div>
      <div style={{ padding: '6px 0' }}>
        {lines.map((line, idx) => {
          let bg = 'transparent';
          let color = '#94a3b8';
          if (line.startsWith('+')) {
            bg = 'rgba(16, 185, 129, 0.12)';
            color = '#34d399';
          } else if (line.startsWith('-')) {
            bg = 'rgba(239, 68, 68, 0.12)';
            color = '#f87171';
          }
          return (
            <div key={idx} style={{ padding: '2px 12px', background: bg, color }}>
              <span style={{ display: 'inline-block', width: '24px', opacity: 0.5, userSelect: 'none' }}>{idx + 1}</span>
              <span>{line}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const AsterimWorkstationSandbox: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SandboxTab>('chat');
  const [activeThreadId, setActiveThreadId] = useState<string>('tr-104');
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [chatInputText, setChatInputText] = useState('');

  const [threadStatuses, setThreadStatuses] = useState<Record<string, 'approval' | 'working' | 'completed'>>({
    'tr-104': 'approval',
    'tr-105': 'working',
    'tr-106': 'completed'
  });

  const [approvalActionState, setApprovalActionState] = useState<Record<string, 'pending' | 'approved' | 'denied'>>({
    'tr-104': 'pending'
  });

  const [extraChatMessages, setExtraChatMessages] = useState<Record<string, Array<{ role: 'user' | 'agent'; text: string; time: string }>>>({});

  const currentThread = THREADS_DATA[activeThreadId] || THREADS_DATA['tr-104'];
  const currentStatus = threadStatuses[activeThreadId] || currentThread.status;
  const currentApprovalState = approvalActionState[activeThreadId] || 'pending';

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
    setApprovalActionState((prev) => ({ ...prev, [activeThreadId]: 'approved' }));
    setThreadStatuses((prev) => ({ ...prev, [activeThreadId]: 'working' }));

    setTimeout(() => {
      setThreadStatuses((prev) => ({ ...prev, [activeThreadId]: 'completed' }));
      setExtraChatMessages((prev) => ({
        ...prev,
        [activeThreadId]: [
          ...(prev[activeThreadId] || []),
          {
            role: 'agent',
            text: 'Successfully refactored ApprovalManager.ts and cleaned up legacy process logs.',
            time: '11:49 AM'
          }
        ]
      }));
    }, 1500);
  };

  const handleDenyAction = () => {
    setApprovalActionState((prev) => ({ ...prev, [activeThreadId]: 'denied' }));
    setExtraChatMessages((prev) => ({
      ...prev,
      [activeThreadId]: [
        ...(prev[activeThreadId] || []),
        {
          role: 'agent',
          text: 'Understood. Command execution canceled. Awaiting revised instructions.',
          time: '11:49 AM'
        }
      ]
    }));
  };

  const handleSendMessage = () => {
    if (!chatInputText.trim()) return;

    const userText = chatInputText;
    setChatInputText('');

    setExtraChatMessages((prev) => ({
      ...prev,
      [activeThreadId]: [
        ...(prev[activeThreadId] || []),
        { role: 'user', text: userText, time: '11:52 AM' }
      ]
    }));

    setTimeout(() => {
      setExtraChatMessages((prev) => ({
        ...prev,
        [activeThreadId]: [
          ...(prev[activeThreadId] || []),
          {
            role: 'agent',
            text: `Analyzing request "${userText}" and scanning workspace context for ${currentThread.projectPath}...`,
            time: '11:52 AM'
          }
        ]
      }));
    }, 1000);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSendMessage();
    }
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
            <span>Company Workspace (Acme Corp)</span>
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '230px 1fr 250px',
          minHeight: '520px',
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
              { id: 'chat', label: 'Chat', icon: <IconZap size={13} /> },
              { id: 'terminal', label: 'Terminal', icon: <IconTerminal size={13} /> },
              { id: 'changes', label: 'Changes', icon: <IconFileCode size={13} /> },
              { id: 'settings', label: 'Settings', icon: <IconLock size={13} /> },
              { id: 'environment', label: 'Environment', icon: <IconShield size={13} /> }
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

          <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 38px)', justifyContent: 'space-between' }}>
            <div style={{ padding: '16px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#94a3b8' }}>
                  <IconUser size={13} color="#38bdf8" />
                  <span style={{ fontWeight: 700, color: '#f8fafc' }}>Developer</span>
                  <span style={{ fontSize: '0.68rem', color: '#64748b' }}>11:48 AM</span>
                </div>
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: '#0d1424',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    fontSize: '0.84rem',
                    color: '#f8fafc',
                    lineHeight: 1.5,
                    maxWidth: '85%'
                  }}
                >
                  {currentThread.userPrompt}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#94a3b8' }}>
                  <IconBot size={14} color="#10b981" />
                  <span style={{ fontWeight: 700, color: '#10b981' }}>Agent Assistant ({currentThread.agent})</span>
                  <span style={{ fontSize: '0.68rem', color: '#64748b' }}>11:48 AM</span>
                </div>

                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    background: '#070a10',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    fontSize: '0.84rem',
                    color: '#cbd5e1',
                    lineHeight: 1.6
                  }}
                >
                  <ToolAccordion title={`Agent Reasoning (${currentThread.mission})`} defaultOpen={true}>
                    {currentThread.transcriptSteps.map((step, idx) => (
                      <div key={idx} style={{ marginBottom: '4px', color: step.type === 'tool' ? '#38bdf8' : step.type === 'security' ? '#f59e0b' : '#94a3b8' }}>
                        {step.text}
                      </div>
                    ))}
                  </ToolAccordion>

                  {currentThread.diffCode && <DiffBlock code={currentThread.diffCode} />}

                  {currentThread.terminalLog && (
                    <div style={{ margin: '10px 0', padding: '10px 12px', background: '#000000', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                      <div style={{ color: '#64748b', fontSize: '0.7rem', marginBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '4px' }}>
                        {currentThread.pidInfo}
                      </div>
                      {currentThread.terminalLog.map((log, i) => (
                        <div key={i} style={{ color: log.startsWith('✓') ? '#10b981' : log.startsWith('[') ? '#38bdf8' : '#cbd5e1' }}>
                          {log}
                        </div>
                      ))}
                    </div>
                  )}

                  {currentThread.commitBadge && (
                    <div style={{ marginTop: '8px', padding: '8px 12px', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.25)', color: '#34d399', fontWeight: 600, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <IconCheck size={14} color="#34d399" />
                      <span>{currentThread.commitBadge}</span>
                    </div>
                  )}

                  {currentThread.agentResponseText && (
                    <div style={{ marginTop: '8px', color: '#f8fafc' }}>
                      {currentThread.agentResponseText}
                    </div>
                  )}

                  {currentThread.approvalCmd && (
                    <div
                      style={{
                        marginTop: '12px',
                        padding: '14px',
                        borderRadius: '8px',
                        background: currentApprovalState === 'approved' ? 'rgba(16, 185, 129, 0.08)' : currentApprovalState === 'denied' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                        border: currentApprovalState === 'approved' ? '1px solid rgba(16, 185, 129, 0.35)' : currentApprovalState === 'denied' ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid rgba(245, 158, 11, 0.35)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.82rem', color: '#f8fafc' }}>
                          <IconAlertTriangle size={15} color={currentApprovalState === 'approved' ? '#10b981' : currentApprovalState === 'denied' ? '#ef4444' : '#f59e0b'} />
                          <span>
                            {currentApprovalState === 'approved' ? '✓ Command Approved & Executed (Clearance Granted)' : currentApprovalState === 'denied' ? '❌ Command Intercepted & Denied by Developer' : '⚠️ Human Approval Required · Intercept #AST-402'}
                          </span>
                        </div>
                        <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: '#ef4444', background: 'rgba(239, 68, 68, 0.2)', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                          RISK SCORE: {currentThread.riskScore || '8.4 / 10'}
                        </span>
                      </div>

                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', background: '#000000', padding: '8px 12px', borderRadius: '6px', color: '#f8fafc', marginBottom: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                        {currentThread.approvalCmd}
                      </div>

                      {currentApprovalState === 'pending' ? (
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
                              fontSize: '0.78rem',
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
                              fontSize: '0.78rem',
                              cursor: 'pointer'
                            }}
                          >
                            <IconCheck size={14} color="#042114" /> Approve Command
                          </button>
                        </div>
                      ) : (
                        <div style={{ color: currentApprovalState === 'approved' ? '#10b981' : '#ef4444', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {currentApprovalState === 'approved' ? <IconCheck size={14} color="#10b981" /> : <IconX size={14} color="#ef4444" />}
                          <span>
                            {currentApprovalState === 'approved' ? 'Clearance Granted by Developer. Execution proceeding...' : 'Command Execution Canceled by Developer.'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {(extraChatMessages[activeThreadId] || []).map((msg, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#94a3b8' }}>
                    {msg.role === 'user' ? <IconUser size={13} color="#38bdf8" /> : <IconBot size={14} color="#10b981" />}
                    <span style={{ fontWeight: 700, color: msg.role === 'user' ? '#f8fafc' : '#10b981' }}>
                      {msg.role === 'user' ? 'Developer' : `Agent Assistant (${currentThread.agent})`}
                    </span>
                    <span style={{ fontSize: '0.68rem', color: '#64748b' }}>{msg.time}</span>
                  </div>
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: msg.role === 'user' ? '#0d1424' : '#070a10',
                      border: msg.role === 'user' ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(16, 185, 129, 0.2)',
                      fontSize: '0.84rem',
                      color: '#f8fafc',
                      lineHeight: 1.5,
                      maxWidth: msg.role === 'user' ? '85%' : '100%'
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                padding: '10px 14px',
                background: '#070a10',
                borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                display: 'flex',
                gap: '8px',
                alignItems: 'center'
              }}
            >
              <input
                type="text"
                value={chatInputText}
                onChange={(e) => setChatInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Asterim agent or type / command..."
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: '6px',
                  background: '#0d1424',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#f8fafc',
                  fontSize: '0.82rem',
                  outline: 'none'
                }}
              />
              <button
                onClick={handleSendMessage}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 16px',
                  borderRadius: '6px',
                  background: '#10b981',
                  border: 'none',
                  color: '#042114',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer'
                }}
              >
                <IconSend size={14} color="#042114" />
                Send
              </button>
            </div>
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
