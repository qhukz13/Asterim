import React, { useState } from 'react';
import { Zap, SkipForward, RotateCcw, Cpu, HardDrive } from 'lucide-react';

export const AgentStreamTab: React.FC = () => {
  const [executionState, setExecutionState] = useState<'IDLE' | 'RUNNING' | 'TOOL_CALL' | 'SECURITY_CHECK' | 'COMPLETED'>('RUNNING');
  const [logs, setLogs] = useState<string[]>([
    '[00:01.02] asterim-daemon: PTY session initialized (PID 4912 / Claude Code v0.4.5)',
    '[00:01.05] agent: Inspecting active workspace context at /home/dev/projects/asterim',
    '[00:01.12] mcp: Loading tools from PostgreSQL MCP & GitHub MCP servers',
    '[00:01.20] agent: Executing tool call: git status --porcelain',
  ]);

  const stateSteps: Array<'IDLE' | 'RUNNING' | 'TOOL_CALL' | 'SECURITY_CHECK' | 'COMPLETED'> = [
    'IDLE',
    'RUNNING',
    'TOOL_CALL',
    'SECURITY_CHECK',
    'COMPLETED',
  ];

  const advanceState = () => {
    const nextIdx = (stateSteps.indexOf(executionState) + 1) % stateSteps.length;
    const nextState = stateSteps[nextIdx];
    setExecutionState(nextState);

    const timestamp = `[00:0${nextIdx + 2}.${Math.floor(Math.random() * 80 + 10)}]`;
    if (nextState === 'TOOL_CALL') {
      setLogs((prev) => [...prev, `${timestamp} agent: Executing tool call -> AST Syntax Scanner Request`]);
    } else if (nextState === 'SECURITY_CHECK') {
      setLogs((prev) => [...prev, `${timestamp} security-guard: Intercepted bash command. Verifying path bounds...`]);
    } else if (nextState === 'COMPLETED') {
      setLogs((prev) => [...prev, `${timestamp} agent: Task execution completed with zero orphaned processes.`]);
    } else if (nextState === 'IDLE') {
      setLogs(['[00:01.00] asterim-daemon: Session reset to IDLE state. Ready for agent prompt.']);
    } else if (nextState === 'RUNNING') {
      setLogs((prev) => [...prev, `${timestamp} agent: Starting new execution stream...`]);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Control Header & State Indicator */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: executionState === 'RUNNING' ? 'var(--accent-green)' : '#f59e0b' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 700 }}>
              STATE: {executionState}
            </span>
          </div>

          <span style={{ color: 'var(--border-subtle)' }}>|</span>

          <div style={{ fontSize: '0.8rem', color: 'var(--accent-green-hover)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Zap size={14} /> 60 FPS / 16ms Throttled
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={advanceState}
            className="btn-secondary"
            style={{ padding: '6px 12px', fontSize: '0.8rem', gap: '6px' }}
          >
            <SkipForward size={14} />
            <span>Step Execution</span>
          </button>

          <button
            onClick={() => {
              setExecutionState('IDLE');
              setLogs(['[00:01.00] asterim-daemon: Reset session state.']);
            }}
            className="btn-secondary"
            style={{ padding: '6px 12px', fontSize: '0.8rem', gap: '6px' }}
          >
            <RotateCcw size={14} />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Live PTY Output Terminal View */}
      <div
        style={{
          background: '#04070d',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: '16px',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          color: '#e2e8f0',
          minHeight: '180px',
          maxHeight: '260px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {logs.map((log, idx) => (
          <div key={idx} style={{ display: 'flex', gap: '12px', opacity: idx === logs.length - 1 ? 1 : 0.85 }}>
            <span style={{ color: 'var(--text-muted)', userSelect: 'none', width: '20px' }}>{idx + 1}</span>
            <span style={{ color: log.includes('security-guard') ? '#f59e0b' : log.includes('completed') ? 'var(--accent-green-hover)' : '#e2e8f0' }}>
              {log}
            </span>
          </div>
        ))}
      </div>

      {/* Process Metrics Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
        <div style={{ display: 'flex', gap: '16px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Cpu size={14} /> PID 4912 (Claude Code Subprocess)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <HardDrive size={14} /> RAM: 42 MB / CPU: 0.4%
          </span>
        </div>
        <span className="status-badge available" style={{ fontSize: '0.65rem' }}>
          SIGTERM CASCADING ACTIVE
        </span>
      </div>
    </div>
  );
};
