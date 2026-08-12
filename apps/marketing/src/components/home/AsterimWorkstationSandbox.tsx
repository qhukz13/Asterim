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
  IconRefreshCw,
  IconSend
} from '../common/MarketingIcons';

/*
 * Faithful reproduction of the Asterim workstation UI (`apps/web`).
 * Structure, copy and state names are taken from the real components:
 *   TopBar.tsx · NavigationSidebar.tsx · SessionSidebar.tsx · App.tsx (tab strip
 *   + thread header) · InspectorPanel.tsx · ChatInput.tsx · ChangesView.tsx ·
 *   AISettings.tsx · environment/EnvironmentSettingsView.tsx
 * Do not invent controls here — if it is not in apps/web, it does not belong.
 */

export type SandboxTab = 'chat' | 'terminal' | 'changes' | 'settings' | 'environment';

type ThreadStatus = 'idle' | 'working' | 'approval';

interface ThreadData {
  id: string;
  shortId: string;
  name: string;
  status: ThreadStatus;
  runtime: string;
  terminal: string[];
  approvalCmd?: string;
}

const THREADS: ThreadData[] = [
  {
    id: 'main',
    shortId: '6ae1794d',
    name: 'Main Session',
    status: 'idle',
    runtime: 'antigravity',
    terminal: [
      'qhukz@fedora:~/Documents/Projects/Asterim$ asterim start',
      'asterim: workstation daemon listening on 127.0.0.1:3000',
      'asterim: adapter antigravity ready',
      'qhukz@fedora:~/Documents/Projects/Asterim$ '
    ]
  },
  {
    id: 'ast-security-gate',
    shortId: 'b12f77e0',
    name: 'ast-security-gate',
    status: 'approval',
    runtime: 'antigravity',
    approvalCmd: 'rm -rf ./build && pnpm deploy',
    terminal: [
      'qhukz@fedora:~/Documents/Projects/Asterim$ pnpm release',
      'agent: proposed command → rm -rf ./build && pnpm deploy',
      'ast_guard: recursive delete + network publish detected',
      'ast_guard: execution PAUSED · awaiting human clearance'
    ]
  },
  {
    id: 'auth-feature',
    shortId: '3c9de510',
    name: 'auth-feature',
    status: 'working',
    runtime: 'antigravity',
    terminal: [
      'qhukz@fedora:~/Documents/Projects/Asterim$ asterim run --thread auth-feature',
      'agent: read_file packages/adapters/src/ClaudeCodeAdapter.ts',
      'agent: 412 lines · 6.1 KB into context',
      'agent: streaming patch for PKCE verifier exchange'
    ]
  }
];

const DIFF = [
  '@@ -1,4 +1,4 @@',
  '-482913',
  '+771904',
  ' '
].join('\n');

function DiffBlock({ code, file }: { code: string; file: string }) {
  const rows = code.split('\n');
  let oldNo = 0;
  let newNo = 0;
  const numbered = rows.map((line) => {
    if (line.startsWith('@@')) {
      const m = line.match(/-(\d+)(?:,\d+)?\s+\+(\d+)/);
      if (m) {
        oldNo = parseInt(m[1], 10);
        newNo = parseInt(m[2], 10);
      }
      return { line, kind: 'hunk' as const, old: null, next: null };
    }
    if (line.startsWith('+')) return { line, kind: 'add' as const, old: null, next: newNo++ };
    if (line.startsWith('-')) return { line, kind: 'del' as const, old: oldNo++, next: null };
    return { line, kind: 'ctx' as const, old: oldNo++, next: newNo++ };
  });

  const gutter = (v: number | null) => (
    <span style={{ display: 'inline-block', width: '28px', textAlign: 'right', paddingRight: '10px', color: '#475569', userSelect: 'none', flexShrink: 0 }}>
      {v ?? ''}
    </span>
  );

  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', overflow: 'hidden', background: '#04070d', fontFamily: 'var(--font-mono)', fontSize: '0.76rem', lineHeight: 1.6 }}>
      <div style={{ padding: '6px 12px', background: '#0d1424', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#94a3b8', fontSize: '0.72rem' }}>
        {file}
      </div>
      <div style={{ padding: '6px 0', overflowX: 'auto' }}>
        {numbered.map((row, i) => {
          const s =
            row.kind === 'add'
              ? { bg: 'rgba(16, 185, 129, 0.12)', fg: '#34d399' }
              : row.kind === 'del'
                ? { bg: 'rgba(239, 68, 68, 0.12)', fg: '#f87171' }
                : row.kind === 'hunk'
                  ? { bg: 'rgba(255,255,255,0.03)', fg: '#64748b' }
                  : { bg: 'transparent', fg: '#94a3b8' };
          return (
            <div key={i} style={{ display: 'flex', padding: '1px 12px', background: s.bg, color: s.fg, whiteSpace: 'pre' }}>
              {gutter(row.old)}
              {gutter(row.next)}
              <span>{row.line}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TABS: Array<{ id: SandboxTab; label: string; icon: React.ReactNode }> = [
  { id: 'chat', label: 'Chat', icon: <IconZap size={14} /> },
  { id: 'terminal', label: 'Terminal', icon: <IconTerminal size={14} /> },
  { id: 'changes', label: 'Changes', icon: <IconFileCode size={14} /> },
  { id: 'settings', label: 'Settings', icon: <IconLock size={14} /> },
  { id: 'environment', label: 'Environment', icon: <IconShield size={14} /> }
];

const PRESETS = [
  { id: 'personal', title: 'Personal Environment', desc: '100% offline, solo developer mode with zero network dependencies.' },
  { id: 'company', title: 'Company Environment', desc: 'Shared team tools, centralized audit stream, and enterprise RBAC.' },
  { id: 'client', title: 'Client Sandbox', desc: 'Isolated secrets and custom MCP tools for freelance/contract projects.' },
  { id: 'experimental', title: 'Experimental Sandbox', desc: 'Relaxed execution policies for testing experimental LLM models.' }
];

const sectionLabel: React.CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.06em'
};

export const AsterimWorkstationSandbox: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SandboxTab>('chat');
  const [activeThreadId, setActiveThreadId] = useState('main');
  const [projectFilter, setProjectFilter] = useState('');
  const [approval, setApproval] = useState<'pending' | 'approved' | 'denied'>('pending');
  const [extraTerminal, setExtraTerminal] = useState<Record<string, string[]>>({});
  const [preset, setPreset] = useState('personal');

  const thread = THREADS.find((t) => t.id === activeThreadId) || THREADS[0];
  const status: ThreadStatus =
    thread.status === 'approval' && approval === 'approved'
      ? 'working'
      : thread.status === 'approval' && approval === 'denied'
        ? 'idle'
        : thread.status;

  const projects = [
    { name: 'Asterim', path: '/home/qhukz/Documents/Projects/Asterim', pinned: true },
    { name: 'test', path: '~/dev/test', pinned: false },
    { name: 'MainTest', path: '~/dev/MainTest', pinned: false }
  ].filter((p) => p.name.toLowerCase().includes(projectFilter.toLowerCase()));

  const pinned = projects.filter((p) => p.pinned);
  const rest = projects.filter((p) => !p.pinned);

  const decide = (verdict: 'approved' | 'denied') => {
    setApproval(verdict);
    setExtraTerminal((prev) => ({
      ...prev,
      [thread.id]: [
        ...(prev[thread.id] || []),
        verdict === 'approved'
          ? 'ast_guard: CLEARANCE GRANTED by developer'
          : 'ast_guard: COMMAND BLOCKED — never reached the shell'
      ]
    }));
  };

  const statePill = () => {
    if (status === 'working') return { text: '● Executing', fg: '#60a5fa', bg: 'rgba(59,130,246,0.1)', bd: 'rgba(59,130,246,0.3)' };
    if (status === 'approval') return { text: '⏸ Paused for Review', fg: '#fbbf24', bg: 'rgba(245,158,11,0.1)', bd: 'rgba(245,158,11,0.3)' };
    return { text: '○ Idle', fg: '#94a3b8', bg: 'rgba(255,255,255,0.05)', bd: 'rgba(255,255,255,0.1)' };
  };
  const pill = statePill();

  return (
    <div className="workstation-frame" id="workstation-sandbox">
      {/* ── Top chrome (TopBar.tsx) ─────────────────────────────── */}
      <div className="ws-header">
        <div className="ws-header-left">
          <div className="ws-chip">
            <span
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '4px',
                background: 'rgba(16,185,129,0.15)',
                color: '#10b981',
                fontSize: '0.62rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              P
            </span>
            <span className="ws-chip-label">Personal Environment</span>
            <IconChevronDown size={11} color="#64748b" />
          </div>

          <div className="ws-breadcrumb">
            <span>/</span>
            <span style={{ color: '#f8fafc', fontWeight: 600 }}>Asterim</span>
            <span>/</span>
            <span style={{ color: '#94a3b8' }}>{thread.name}</span>
          </div>
        </div>

        <div className="ws-mission">
          <IconTarget size={12} color="#10b981" />
          <span style={{ opacity: 0.8 }}>Mission:</span>
          <span style={{ color: '#f8fafc', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {thread.name}
          </span>
        </div>

        <div className="ws-header-right">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 10px',
              borderRadius: '100px',
              fontSize: '0.72rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              background: 'rgba(16,185,129,0.12)',
              color: '#10b981',
              border: '1px solid rgba(16,185,129,0.3)'
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
            <span className="ws-status-full">Agent Ready</span>
            <span className="ws-status-short">Ready</span>
          </div>

          <div
            className="ws-host"
            style={{
              alignItems: 'center',
              gap: '5px',
              padding: '3px 8px',
              borderRadius: '4px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              fontSize: '0.72rem',
              color: '#94a3b8',
              whiteSpace: 'nowrap'
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
            <span>Local Host</span>
          </div>

          <span className="ws-kbd" style={{ padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', fontSize: '0.7rem', color: '#64748b', fontFamily: 'var(--font-mono)' }}>
            ⌘K
          </span>
        </div>
      </div>

      <div className="ws-body">
        {/* ── Left nav (NavigationSidebar + SessionSidebar) ──────── */}
        <div className="ws-sidebar">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={sectionLabel}>Projects (3)</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#64748b', fontFamily: 'var(--font-mono)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', padding: '1px 5px' }}>
                STD
              </span>
              <IconPlus size={13} color="#64748b" />
            </div>
          </div>

          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
              <IconSearch size={12} color="#64748b" />
            </span>
            <input
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              placeholder="Filter projects..."
              style={{
                width: '100%',
                padding: '6px 8px 6px 26px',
                borderRadius: '6px',
                background: '#0d1424',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#f8fafc',
                fontSize: '0.76rem',
                outline: 'none'
              }}
            />
          </div>

          {pinned.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ ...sectionLabel, display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ color: '#fbbf24' }}>★</span> Pinned
              </span>
              {pinned.map((p) => (
                <div
                  key={p.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '7px 9px',
                    borderRadius: '6px',
                    background: 'rgba(16,185,129,0.06)',
                    border: '1px solid rgba(16,185,129,0.35)'
                  }}
                >
                  <IconFolder size={13} color="#10b981" />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc' }}>{p.name}</span>
                    <span style={{ display: 'block', fontSize: '0.66rem', color: '#64748b', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.path}
                    </span>
                  </span>
                  <span style={{ color: '#fbbf24', fontSize: '0.7rem' }}>★</span>
                </div>
              ))}
            </div>
          )}

          {rest.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={sectionLabel}>All Repositories</span>
              {rest.map((p) => (
                <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 9px', borderRadius: '6px' }}>
                  <IconFolder size={13} color="#64748b" />
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{p.name}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem', color: '#94a3b8' }}>
                <span style={{ transform: 'rotate(180deg)', display: 'flex' }}>
                  <IconChevronRight size={12} color="#94a3b8" />
                </span>
                Projects
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', fontWeight: 700, color: '#10b981' }}>
                <IconPlus size={11} color="#10b981" /> New Agent
              </span>
            </div>

            <span style={sectionLabel}>Active Threads</span>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {THREADS.map((t) => {
                const isActive = t.id === thread.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveThreadId(t.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      width: '100%',
                      textAlign: 'left',
                      padding: '7px 9px',
                      borderRadius: '6px',
                      background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
                      border: 'none',
                      borderLeft: isActive ? '2px solid #10b981' : '2px solid transparent',
                      color: isActive ? '#f8fafc' : '#94a3b8',
                      fontSize: '0.79rem',
                      fontWeight: isActive ? 600 : 500,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)'
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.name}
                    </span>
                    {t.status === 'approval' && <span style={{ fontSize: '0.62rem', color: '#fbbf24', whiteSpace: 'nowrap' }}>Action Req</span>}
                    {t.status === 'working' && <span style={{ fontSize: '0.62rem', color: '#10b981', whiteSpace: 'nowrap' }}>Working</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Center: thread header + tabs + view ────────────────── */}
        <div className="ws-main">
          {/* Thread header (App.tsx Layer 1) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '10px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.02)',
              flexWrap: 'wrap'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '1rem', fontWeight: 600, color: '#f8fafc' }}>{thread.name}</div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '3px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <span>Thread: {thread.shortId}</span>
                  <span>Last activity: just now</span>
                </div>
              </div>
              <span
                style={{
                  fontSize: '0.74rem',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  whiteSpace: 'nowrap',
                  background: pill.bg,
                  color: pill.fg,
                  border: `1px solid ${pill.bd}`
                }}
              >
                {pill.text}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  minWidth: '186px',
                  padding: '7px 10px',
                  borderRadius: '8px',
                  background: '#0d1424',
                  border: '1px solid rgba(255,255,255,0.12)',
                  fontSize: '0.78rem',
                  color: '#f8fafc'
                }}
              >
                Antigravity (Google)
                <IconChevronDown size={12} color="#64748b" />
              </div>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 10px',
                  height: '34px',
                  borderRadius: '8px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.12)'
                }}
              >
                <IconRefreshCw size={13} color="#94a3b8" />
              </span>
            </div>
          </div>

          {/* Tab strip (App.tsx Layer 2) */}
          <div className="ws-tabs">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                    background: isActive ? '#191c20' : 'transparent',
                    border: 'none',
                    borderBottom: isActive ? '2px solid #10b981' : '2px solid transparent',
                    borderRadius: '6px 6px 0 0',
                    color: isActive ? '#ffffff' : '#94a3b8',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-sans)'
                  }}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* ── Views ───────────────────────────────────────────── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {activeTab === 'chat' && (
              <>
                <div style={{ flex: 1, padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto', minHeight: '210px' }}>
                  {thread.status === 'approval' ? (
                    <div
                      style={{
                        border: '1px solid rgba(245,158,11,0.35)',
                        background: 'rgba(245,158,11,0.06)',
                        borderRadius: '8px',
                        padding: '14px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '0.82rem', fontWeight: 700, color: '#fbbf24' }}>
                        <IconAlertTriangle size={14} color="#fbbf24" />
                        {approval === 'pending'
                          ? 'Permission requested for shell action'
                          : approval === 'approved'
                            ? 'Clearance granted · command executing'
                            : 'Command blocked · never reached the shell'}
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: '#f8fafc', background: '#04070d', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: '9px 12px', overflowX: 'auto', whiteSpace: 'pre' }}>
                        {thread.approvalCmd}
                      </div>
                      {approval === 'pending' && (
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '12px' }}>
                          <button
                            onClick={() => decide('denied')}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '6px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer' }}
                          >
                            <IconX size={13} color="#ef4444" /> Deny
                          </button>
                          <button
                            onClick={() => decide('approved')}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '6px', background: '#10b981', border: 'none', color: '#042114', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}
                          >
                            <IconCheck size={13} color="#042114" /> Approve
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px', color: '#64748b', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
                      <IconTerminal size={14} color="#64748b" />
                      No messages in active thread
                    </div>
                  )}
                </div>

                {/* ChatInput.tsx */}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 12px', display: 'flex', gap: '8px', alignItems: 'center', background: '#070a10', flexWrap: 'wrap' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '9px 12px', borderRadius: '6px', background: '#0d1424', border: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                    Ask for Approval
                    <IconChevronDown size={11} color="#64748b" />
                  </div>
                  <input
                    readOnly
                    placeholder="Ask the agent to do something..."
                    style={{ flex: 1, minWidth: '120px', padding: '10px 12px', borderRadius: '6px', background: '#0d1424', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', fontSize: '0.8rem', outline: 'none' }}
                  />
                  <button style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 16px', borderRadius: '6px', background: '#10b981', border: 'none', color: '#042114', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                    <IconSend size={13} color="#042114" /> Send
                  </button>
                </div>
              </>
            )}

            {activeTab === 'terminal' && (
              <div style={{ flex: 1, padding: '14px 16px', background: '#04070d', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', lineHeight: 1.7, overflowX: 'auto', minHeight: '260px' }}>
                {[...thread.terminal, ...(extraTerminal[thread.id] || [])].map((line, i) => (
                  <div
                    key={i}
                    style={{
                      whiteSpace: 'pre',
                      color: line.startsWith('qhukz@')
                        ? '#10b981'
                        : line.includes('ast_guard')
                          ? '#fbbf24'
                          : line.startsWith('asterim:')
                            ? '#38bdf8'
                            : '#cbd5e1'
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'changes' && (
              <div className="ws-changes" style={{ flex: 1, minHeight: '260px' }}>
                <div style={{ borderRight: '1px solid rgba(255,255,255,0.06)', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
                  <div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#f8fafc' }}>Changes</div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>1 changed</div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 9px', borderRadius: '6px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <span style={{ color: '#fbbf24', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 700 }}>M</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      pairing_pin.txt
                    </span>
                  </div>

                  <textarea
                    readOnly
                    placeholder="Commit summary"
                    style={{ width: '100%', minHeight: '64px', resize: 'none', padding: '9px 11px', borderRadius: '6px', background: '#0d1424', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', fontSize: '0.78rem', outline: 'none', fontFamily: 'var(--font-sans)' }}
                  />

                  <button style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8', fontSize: '0.78rem', cursor: 'pointer' }}>
                    ✨ Auto-Generate Message
                  </button>

                  <button style={{ padding: '9px 12px', borderRadius: '6px', background: '#10b981', border: 'none', color: '#042114', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                    Commit Changes
                  </button>
                </div>

                <div style={{ padding: '14px', minWidth: 0, overflow: 'hidden' }}>
                  <DiffBlock code={DIFF} file="pairing_pin.txt" />
                </div>
              </div>
            )}

            {activeTab === 'settings' && (
              <div style={{ flex: 1, padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '18px', minHeight: '260px' }}>
                <div>
                  <div style={{ ...sectionLabel, marginBottom: '8px' }}>Agent Engine</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: '320px', padding: '9px 12px', borderRadius: '8px', background: '#0d1424', border: '1px solid rgba(255,255,255,0.12)', fontSize: '0.82rem', color: '#f8fafc' }}>
                    Antigravity (Google)
                    <IconChevronDown size={12} color="#64748b" />
                  </div>
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.95rem', fontWeight: 600, color: '#f8fafc', marginBottom: '12px' }}>
                    <IconShield size={15} color="#10b981" />
                    Workspace AI Settings
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.6, maxWidth: '440px', marginBottom: '14px' }}>
                    Model routing, context budget, and auto-approval rules apply to every agent
                    dispatched inside this environment.
                  </p>
                  <button style={{ padding: '9px 16px', borderRadius: '6px', background: '#10b981', border: 'none', color: '#042114', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                    Save AI Settings
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'environment' && (
              <div style={{ flex: 1, padding: '18px 16px', minHeight: '260px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '1rem', fontWeight: 600, color: '#f8fafc' }}>Personal Environment</span>
                  <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', padding: '3px 8px', borderRadius: '100px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', whiteSpace: 'nowrap' }}>
                    PERSONAL ENVIRONMENT
                  </span>
                </div>

                <div className="ws-preset-grid">
                  {PRESETS.map((p) => {
                    const isActive = preset === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setPreset(p.id)}
                        style={{
                          textAlign: 'left',
                          padding: '13px',
                          borderRadius: '8px',
                          background: isActive ? 'rgba(16,185,129,0.06)' : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${isActive ? 'rgba(16,185,129,0.45)' : 'rgba(255,255,255,0.08)'}`,
                          cursor: 'pointer',
                          fontFamily: 'var(--font-sans)'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '5px' }}>
                          <IconLayers size={13} color={isActive ? '#10b981' : '#64748b'} />
                          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: isActive ? '#f8fafc' : '#94a3b8' }}>{p.title}</span>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b', lineHeight: 1.5 }}>{p.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Inspector (InspectorPanel.tsx) ─────────────────────── */}
        <div className="ws-inspector">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={sectionLabel}>AI Context &amp; State</span>
            <IconChevronRight size={12} color="#64748b" />
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
            <span style={sectionLabel}>Agent Activity</span>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Runtime:</span>
              <span style={{ fontSize: '0.78rem', color: '#f8fafc', fontWeight: 500 }}>{thread.runtime}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Execution State:</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 600, color: status === 'working' ? '#10b981' : status === 'approval' ? '#f59e0b' : '#10b981', whiteSpace: 'nowrap' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: status === 'working' ? '#10b981' : status === 'approval' ? '#f59e0b' : '#10b981' }} />
                {status === 'working' ? 'Computing' : status === 'approval' ? 'Action Required' : 'Ready / Idle'}
              </span>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
            <span style={sectionLabel}>
              Attached Context <span style={{ color: '#64748b', textTransform: 'none', fontWeight: 400 }}>(Working Set)</span>
            </span>
            <span style={sectionLabel}>Active Context Files (0)</span>
            <div style={{ fontSize: '0.74rem', color: '#64748b' }}>No files pinned yet.</div>
          </div>
        </div>
      </div>
    </div>
  );
};
