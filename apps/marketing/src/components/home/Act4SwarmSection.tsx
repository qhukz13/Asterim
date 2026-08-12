import React, { useState } from 'react';
import { IconCpu } from '../common/MarketingIcons';

interface AgentProcess {
  id: string;
  name: string;
  version: string;
  role: string;
  threadId: string;
  status: 'ACTIVE' | 'IDLE' | 'INTERCEPTED';
  cpu: string;
  memory: string;
  currentTask: string;
  details: string;
}

export const Act4SwarmSection: React.FC = () => {
  const agents: AgentProcess[] = [
    {
      id: 'claude-code',
      name: 'Claude Code',
      version: 'v3.7',
      role: 'Deep Reasoning & AST',
      threadId: '#tr-8942',
      status: 'ACTIVE',
      cpu: '1.4%',
      memory: '142 MB',
      currentTask: 'Refactoring auth middleware AST AST node trees',
      details: 'Executing multi-file code modifications across packages/core and packages/auth with strict AST validation.'
    },
    {
      id: 'aider',
      name: 'Aider',
      version: 'v0.72',
      role: 'Git & Fast Edits',
      threadId: '#tr-8943',
      status: 'ACTIVE',
      cpu: '0.8%',
      memory: '98 MB',
      currentTask: 'Auto-committing atomic test fix patch',
      details: 'Managing local git branch state and creating atomic git commits with detailed commit telemetry.'
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      version: 'v1.2',
      role: 'Schema & SDK Gen',
      threadId: '#tr-8944',
      status: 'IDLE',
      cpu: '0.0%',
      memory: '64 MB',
      currentTask: 'Waiting for OpenAPI spec update',
      details: 'Generates TypeScript definitions, OpenAPI client SDKs, and SQL schema migration scripts.'
    },
    {
      id: 'antigravity',
      name: 'Antigravity Core',
      version: 'v2.0',
      role: 'Graph Knowledge Indexer',
      threadId: '#tr-8945',
      status: 'ACTIVE',
      cpu: '2.1%',
      memory: '210 MB',
      currentTask: 'Indexing graphify symbol dependency tree',
      details: 'Indexes repository symbols, builds graphify dependency trees, and validates architectural boundaries.'
    }
  ];

  const [selectedAgent, setSelectedAgent] = useState<AgentProcess>(agents[0]);

  return (
    <section className="marketing-section" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '104px 24px', maxWidth: '1280px' }}>
      <div className="section-header" style={{ marginBottom: '48px' }}>
        <span className="section-tag">MULTI-AGENT TELEMETRY</span>
        <h2 className="section-title">Run Specialized Swarms Parallelized.</h2>
        <p className="section-lead">
          Delegate distinct engineering tasks to specialized AI runtimes simultaneously. Asterim manages thread lifecycle, PTY process isolation, and event streams without context collisions.
        </p>
      </div>

      {/* Interactive Process Table (Htop Style) */}
      <div
        style={{
          background: '#04070d',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)'
        }}
      >
        {/* Table Header */}
        <div style={{ padding: '12px 20px', background: '#070a10', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: '#64748b' }}>
            <IconCpu size={14} color="#10b981" />
            ASTERIM PTY PROCESS TELEMETRY MATRIX // 4 THREADS ATTACHED
          </div>
          <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: '#10b981' }}>
            ● ISOLATION: 100% SECURE
          </span>
        </div>

        {/* Process Table Grid */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: '#090d16', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', color: '#64748b' }}>
                <th style={{ padding: '12px 20px' }}>AGENT</th>
                <th style={{ padding: '12px 20px' }}>THREAD ID</th>
                <th style={{ padding: '12px 20px' }}>STATUS</th>
                <th style={{ padding: '12px 20px' }}>CPU</th>
                <th style={{ padding: '12px 20px' }}>CURRENT TASK</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const isSelected = selectedAgent.id === agent.id;
                return (
                  <tr
                    key={agent.id}
                    onClick={() => setSelectedAgent(agent)}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      background: isSelected ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease'
                    }}
                  >
                    <td style={{ padding: '14px 20px', color: '#f8fafc', fontWeight: 600 }}>
                      {agent.name} <span style={{ color: '#64748b', fontSize: '0.75rem' }}>{agent.version}</span>
                    </td>
                    <td style={{ padding: '14px 20px', color: '#94a3b8' }}>{agent.threadId}</td>
                    <td style={{ padding: '14px 20px' }}>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: agent.status === 'ACTIVE' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                          color: agent.status === 'ACTIVE' ? '#10b981' : '#64748b',
                          border: agent.status === 'ACTIVE' ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(255, 255, 255, 0.06)'
                        }}
                      >
                        {agent.status}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px', color: '#cbd5e1' }}>{agent.cpu}</td>
                    <td style={{ padding: '14px 20px', color: '#94a3b8', maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {agent.currentTask}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Selected Agent Detailed Telemetry Bar */}
        <div style={{ padding: '16px 20px', background: '#090d16', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', marginBottom: '2px' }}>
              Selected Thread: <span style={{ color: '#10b981' }}>{selectedAgent.name}</span> ({selectedAgent.role})
            </div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              {selectedAgent.details}
            </div>
          </div>
          <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '4px 10px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.06)' }}>
            PTY BACKPRESSURE: 16ms
          </span>
        </div>
      </div>
    </section>
  );
};
