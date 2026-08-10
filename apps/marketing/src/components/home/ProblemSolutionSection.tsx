import React from 'react';
import { ArrowRight, ShieldCheck, Zap, Layers, AlertTriangle } from 'lucide-react';

export const ProblemSolutionSection: React.FC = () => {
  const workflows = [
    {
      problem: 'Juggling detached agent processes across multiple unmonitored terminal tabs',
      solution: 'Unified process tree manager with PID tracking, SIGTERM cascading shutdown, and zombie sweepers',
      result: '0 orphaned processes & 100% execution state visibility',
      status: 'AVAILABLE NOW',
      icon: Zap,
    },
    {
      problem: 'Agents executing destructive commands or escaping workspace directory boundaries',
      solution: 'Real-time AST syntax parser blocking hazardous patterns before shell execution',
      result: 'Destructive commands intercepted before touching file system',
      status: 'AVAILABLE NOW',
      icon: ShieldCheck,
    },
    {
      problem: 'Leaking client API keys or mixing environment credentials across projects',
      solution: 'Isolated workspace presets (Personal, Company, Client) with scoped credentials & MCP servers',
      result: 'Zero key leaks & strict client repository isolation',
      status: 'AVAILABLE NOW',
      icon: Layers,
    },
  ];

  return (
    <section className="marketing-section">
      <div className="section-header">
        <span className="section-tag">Workflow Engineering</span>
        <h2 className="section-title">Built to Solve Agent Friction</h2>
        <p className="section-lead">
          Every feature in Asterim directly transforms an operational agent hazard into a hardened engineering advantage.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '1080px', margin: '0 auto' }}>
        {workflows.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div
              key={idx}
              className="surface-card workflow-card"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(260px, 1fr) auto minmax(300px, 1.2fr)',
                alignItems: 'center',
                gap: '24px',
                padding: '20px 24px',
              }}
            >
              {/* Problem Column */}
              <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#f87171',
                    flexShrink: 0,
                    marginTop: '2px',
                  }}
                >
                  <AlertTriangle size={18} />
                </div>
                <div>
                  <div style={{ color: '#f87171', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.04em' }}>
                    The Agent Hazard
                  </div>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.92rem', lineHeight: 1.45 }}>
                    {item.problem}
                  </div>
                </div>
              </div>

              {/* Arrow Connector Circle */}
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <div
                  className="workflow-arrow-badge"
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '50%',
                    background: 'var(--accent-green-bg)',
                    border: '1px solid var(--border-accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent-green-hover)',
                    flexShrink: 0,
                    boxShadow: '0 0 16px rgba(16, 185, 129, 0.12)',
                  }}
                  title="Transforms into Asterim Solution"
                >
                  <ArrowRight size={22} />
                </div>
              </div>

              {/* Solution & Result Column */}
              <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--accent-green-bg)',
                    border: '1px solid var(--border-accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent-green)',
                    flexShrink: 0,
                    marginTop: '2px',
                  }}
                >
                  <Icon size={18} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--accent-green-hover)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Asterim Solution
                    </span>
                    <span className="status-badge available" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                      {item.status}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.92rem', lineHeight: 1.45, marginBottom: '4px' }}>
                    {item.solution}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.4 }}>
                    💡 Result: {item.result}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
