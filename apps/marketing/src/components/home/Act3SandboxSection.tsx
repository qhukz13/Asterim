import React from 'react';

interface TelemetryEvent {
  time: string;
  type: string;
  kind: 'agent' | 'tool' | 'diff' | 'approval' | 'git';
  detail: string;
}

const STREAM: TelemetryEvent[] = [
  { time: '11:48:01', type: 'AgentStarted', kind: 'agent', detail: 'claude-code v3.7 attached' },
  { time: '11:48:04', type: 'ToolCallStarted', kind: 'tool', detail: 'read_file · apps/server/src/ApprovalManager.ts' },
  { time: '11:48:06', type: 'ToolCallFinished', kind: 'tool', detail: '412 lines · 6.1 KB read into context' },
  { time: '11:48:11', type: 'DiffCreated', kind: 'diff', detail: '2 files changed · +37 −12' },
  { time: '11:48:12', type: 'ApprovalRequested', kind: 'approval', detail: 'git commit -m "refactor: AST intercept"' },
  { time: '11:48:19', type: 'ApprovalGranted', kind: 'approval', detail: 'approved by developer · 7.1s to decision' },
  { time: '11:48:20', type: 'GitStatusChanged', kind: 'git', detail: 'main · 1 commit ahead of origin' },
  { time: '11:48:21', type: 'AgentIdle', kind: 'agent', detail: 'thread #tr-104 awaiting instruction' }
];

const KIND_COLOR: Record<TelemetryEvent['kind'], string> = {
  agent: 'var(--text-secondary)',
  tool: '#7dd3fc',
  diff: '#c4b5fd',
  approval: 'var(--accent-emerald)',
  git: '#fbbf24'
};

export const Act3SandboxSection: React.FC = () => {
  return (
    <section className="marketing-section" style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <div className="split-panel">
        {/* Left — narrative */}
        <div>
          <span className="section-tag">OBSERVABILITY</span>
          <h2 className="section-title" style={{ marginBottom: '20px' }}>
            Every Action Leaves a Record.
          </h2>
          <p className="section-lead" style={{ marginBottom: '20px' }}>
            Agents don't write to a terminal you have to babysit. Every step becomes a typed event on
            a single stream — tool calls, diffs, approvals, git state — recorded as it happens.
          </p>
          <p className="text-body" style={{ maxWidth: '520px' }}>
            That stream is what the workstation renders, what a second device replays on reconnect,
            and what remains afterwards as the audit trail. Nothing an agent did has to be
            reconstructed from scrollback.
          </p>
        </div>

        {/* Right — live event stream */}
        <div className="workstation-frame" style={{ alignSelf: 'start' }}>
          <div className="workstation-header">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              EVENT STREAM · thread #tr-104
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--accent-emerald)' }}>
              ● RECORDING
            </span>
          </div>

          <div style={{ background: 'var(--bg-terminal)' }}>
            {STREAM.map((event, i) => (
              <div
                key={`${event.time}-${event.type}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto minmax(0, 150px) minmax(0, 1fr)',
                  gap: '14px',
                  alignItems: 'baseline',
                  padding: '10px 20px',
                  borderBottom: i === STREAM.length - 1 ? 'none' : '1px solid var(--border-subtle)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.78rem'
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>{event.time}</span>
                <span style={{ color: KIND_COLOR[event.kind], fontWeight: 500 }}>{event.type}</span>
                <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {event.detail}
                </span>
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 20px',
              borderTop: '1px solid var(--border-subtle)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.74rem',
              color: 'var(--text-muted)'
            }}
          >
            <span>8 events · persisted to local store</span>
            <span style={{ color: 'var(--accent-emerald)' }}>time-to-approval 7.1s</span>
          </div>
        </div>
      </div>
    </section>
  );
};
