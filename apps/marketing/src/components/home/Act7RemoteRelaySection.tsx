import React from 'react';
import { IconSmartphone, IconLock, IconTerminal } from '../common/MarketingIcons';

interface Tier {
  icon: React.ReactNode;
  label: string;
  role: string;
  detail: string;
  wire: string;
  accent?: boolean;
}

const TIERS: Tier[] = [
  {
    icon: <IconTerminal size={15} color="#10b981" />,
    label: 'Local Workstation',
    role: 'EXECUTE',
    detail: 'Source, git history, PTY sessions and agent processes never leave the machine.',
    wire: '127.0.0.1:4242 · pty + fs + git',
    accent: true
  },
  {
    icon: <IconLock size={15} color="#38bdf8" />,
    label: 'Encrypted Relay',
    role: 'TUNNEL',
    detail: 'A reverse tunnel carries events only — no code, no filesystem, no repository contents.',
    wire: 'relay.asterim.dev · E2E encrypted'
  },
  {
    icon: <IconSmartphone size={15} color="#94a3b8" />,
    label: 'Mobile & Web',
    role: 'APPROVE',
    detail: 'Watch a run and clear an approval gate from a phone while the work stays at your desk.',
    wire: 'push notification → approve / deny'
  }
];

export const Act7RemoteRelaySection: React.FC = () => {
  return (
    <section className="marketing-section" style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <div className="split-panel split-panel--flip">
        {/* Left — the three-tier stack */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {TIERS.map((tier, i) => (
            <React.Fragment key={tier.label}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                  gap: '14px',
                  alignItems: 'start',
                  padding: '18px 0'
                }}
              >
                <span
                  style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '7px',
                    border: `1px solid ${tier.accent ? 'var(--border-accent)' : 'var(--border-subtle)'}`,
                    background: tier.accent ? 'rgba(16, 185, 129, 0.07)' : 'rgba(255, 255, 255, 0.03)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  {tier.icon}
                </span>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {tier.label}
                  </div>
                  <p style={{ fontSize: '0.87rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: '4px 0 8px' }}>
                    {tier.detail}
                  </p>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {tier.wire}
                  </div>
                </div>

                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.64rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: tier.accent ? 'var(--accent-emerald)' : 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    paddingTop: '4px'
                  }}
                >
                  {tier.role}
                </span>
              </div>

              {i < TIERS.length - 1 && (
                <div
                  aria-hidden="true"
                  style={{
                    height: '18px',
                    marginLeft: '14px',
                    borderLeft: '1px dashed rgba(255, 255, 255, 0.14)'
                  }}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Right — narrative */}
        <div>
          <span className="section-tag">LOCAL-FIRST ARCHITECTURE</span>
          <h2 className="section-title" style={{ marginBottom: '20px' }}>
            Local Heavy Lift.
            <br />
            Remote Control.
          </h2>
          <p className="section-lead" style={{ marginBottom: '20px' }}>
            The expensive half — model calls, PTY sessions, file writes, git operations — stays on
            your machine. Only the event stream travels.
          </p>
          <p className="text-body" style={{ maxWidth: '480px', marginBottom: '24px' }}>
            That split is what makes remote approval safe. Your phone is not running the agent; it is
            watching a recorded stream and answering one question — approve or deny. Pull the tunnel
            down and the workstation keeps working, entirely offline.
          </p>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '9px',
              paddingTop: '18px',
              borderTop: '1px solid var(--border-subtle)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.74rem',
              color: 'var(--text-muted)'
            }}
          >
            <IconLock size={13} color="var(--accent-emerald)" />
            No source code is stored on Asterim servers.
          </div>
        </div>
      </div>
    </section>
  );
};
