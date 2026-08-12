import React from 'react';
import { IconX } from '../common/MarketingIcons';

interface PipelineNode {
  badge: string;
  title: string;
  detail: string;
  accent?: boolean;
}

const PIPELINE: PipelineNode[] = [
  { badge: 'SPAWNED', title: 'AI Agents', detail: 'claude-code · aider · antigravity' },
  { badge: 'STREAMING', title: 'Event Bus Telemetry', detail: 'agent:stdout · tool.call · diff' },
  { badge: 'SCANNING', title: 'AST Guard Intercept', detail: 'parse → bounds → classify' },
  { badge: 'PAUSED', title: 'Human Approval Gate', detail: 'approve / deny · promise held', accent: true },
  { badge: 'LOCAL', title: 'Local Workstation', detail: 'pty · git · filesystem' }
];

const CHAOS = [
  '$ claude-code --dangerously-skip-permissions',
  '[bash] rm -rf ./config/secrets.env',
  '[warn] API_KEY exposed in plain-text shell history',
  '[bash] curl -X POST https://untrusted-analytics.io/telemetry'
];

export const Act2ControlPlane: React.FC = () => {
  return (
    <section
      className="marketing-section"
      style={{ borderTop: '1px solid var(--border-subtle)', padding: '104px 24px', maxWidth: '1280px' }}
    >
      <div className="section-header" style={{ marginBottom: '48px' }}>
        <span className="section-tag">CONTROL PLANE</span>
        <h2 className="section-title">Stop Managing Loose Terminal Windows.</h2>
        <p className="section-lead">
          Five unmonitored CLI sessions across five terminal tabs is not an architecture. Asterim
          puts one observable path between an agent and your machine.
        </p>
      </div>

      {/* Without Asterim — a single condensed strip, not a competing panel. */}
      <div style={{ marginBottom: '40px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'var(--hazard-red)'
          }}
        >
          <IconX size={13} color="#ef4444" />
          WITHOUT ASTERIM — NO PATH, NO RECORD
        </div>
        <div
          style={{
            borderLeft: '2px solid rgba(239, 68, 68, 0.35)',
            paddingLeft: '16px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.78rem',
            lineHeight: 1.75,
            color: '#64748b'
          }}
        >
          {CHAOS.map((line) => (
            <div key={line}>{line}</div>
          ))}
          <div style={{ color: 'var(--hazard-red)', marginTop: '6px' }}>
            3 parallel sessions mutated shared files · 0 approvals · 0 audit entries
          </div>
        </div>
      </div>

      {/* With Asterim — the pipeline. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '16px',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: 'var(--accent-emerald)'
        }}
      >
        WITH ASTERIM — ONE OBSERVABLE PATH
      </div>

      <div className="pipeline">
        {PIPELINE.map((node, i) => (
          <React.Fragment key={node.title}>
            <div className="pipeline-node" data-accent={node.accent ? 'true' : 'false'}>
              <span className="pipeline-badge">{node.badge}</span>
              <span className="pipeline-title">{node.title}</span>
              <span className="pipeline-detail">{node.detail}</span>
            </div>
            {i < PIPELINE.length - 1 && <span className="pipeline-link" aria-hidden="true" />}
          </React.Fragment>
        ))}
      </div>

      <p
        style={{
          marginTop: '20px',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.76rem',
          color: 'var(--text-muted)'
        }}
      >
        Nothing reaches the shell without passing the gate — and every step is recorded on the way
        through.
      </p>
    </section>
  );
};
