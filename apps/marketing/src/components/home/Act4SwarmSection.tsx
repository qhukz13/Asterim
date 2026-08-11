import React from 'react';

export const Act4SwarmSection: React.FC = () => {
  return (
    <section className="marketing-section" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="section-header">
        <span className="section-tag">ACT 4 // MULTI-AGENT SWARM ORCHESTRATION</span>
        <h2 className="section-title">Run Specialized Swarms Parallelized.</h2>
        <p className="section-lead">
          Delegate distinct engineering tasks to specialized AI runtimes simultaneously. Asterim manages thread lifecycle, PTY process isolation, and event streams without context collisions.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        {[
          {
            title: 'Claude Code 3.7',
            badge: 'DEEP REASONING',
            desc: 'Handles complex architectural refactorings, multi-file code modifications, and AST transformations.'
          },
          {
            title: 'Aider v0.72',
            badge: 'GIT INTEGRATED',
            desc: 'Executes rapid file edits, auto-commits changes with detailed messages, and manages local branch state.'
          },
          {
            title: 'Codex CLI',
            badge: 'API & SCHEMAS',
            desc: 'Generates TypeScript definitions, OpenAPI client SDKs, and SQL schema migration scripts.'
          },
          {
            title: 'Antigravity Core',
            badge: 'GRAPH KNOWLEDGE',
            desc: 'Indexes repository symbols, builds graphify dependency trees, and validates architectural boundaries.'
          }
        ].map((agent, index) => (
          <div
            key={index}
            style={{
              background: '#0d1424',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              borderRadius: '10px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc' }}>{agent.title}</span>
                <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.12)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  {agent.badge}
                </span>
              </div>
              <p style={{ fontSize: '0.88rem', color: '#94a3b8', lineHeight: '1.55' }}>
                {agent.desc}
              </p>
            </div>

            <div style={{ marginTop: '20px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '0.78rem', color: '#64748b', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
              Isolated PTY Process Attached
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
