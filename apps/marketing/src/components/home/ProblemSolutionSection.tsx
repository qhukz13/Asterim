import React from 'react';
import { ArrowRight, ShieldCheck, Zap, Layers } from 'lucide-react';

export const ProblemSolutionSection: React.FC = () => {
  const workflows = [
    {
      problem: 'Juggling detached agent processes across multiple terminal tabs',
      solution: 'Unified process tree manager with PID tracking and zombie process sweepers',
      result: '0 orphaned processes and 100% agent lifecycle visibility',
      icon: Zap,
    },
    {
      problem: 'Agents executing destructive commands or escaping workspace directories',
      solution: 'Real-time AST syntax scanner and sandbox path traversal protection',
      result: 'Unvetted commands intercepted before touching file system',
      icon: ShieldCheck,
    },
    {
      problem: 'Leaking client API keys or mixing configurations between projects',
      solution: 'Isolated environment presets (Personal, Company, Client) with scoped secrets',
      result: 'Zero secret leakage and strict project boundary isolation',
      icon: Layers,
    },
  ];

  return (
    <section
      style={{
        padding: '80px 24px',
        maxWidth: '1240px',
        margin: '0 auto',
        width: '100%',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: '56px' }}>
        <div
          style={{
            fontSize: '0.85rem',
            fontWeight: 700,
            color: '#10b981',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: '12px',
          }}
        >
          Workflow Engineering
        </div>
        <h2
          style={{
            fontSize: 'clamp(2rem, 3.5vw, 2.75rem)',
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '-0.02em',
            marginBottom: '16px',
          }}
        >
          Built to Solve Agent Friction
        </h2>
        <p style={{ color: '#94a3b8', fontSize: '1.1rem', maxWidth: '620px', margin: '0 auto' }}>
          Every feature in Asterim directly transforms an operational agent risk into a hardened engineering advantage.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {workflows.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div
              key={idx}
              style={{
                background: '#0f172a',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '28px 32px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                alignItems: 'center',
                gap: '24px',
                transition: 'border-color 0.2s ease',
              }}
            >
              {/* Problem Column */}
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '10px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#f87171',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    flexShrink: 0,
                  }}
                >
                  ERR
                </div>
                <div>
                  <div style={{ color: '#f87171', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>
                    The Problem
                  </div>
                  <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '1rem', lineHeight: 1.5 }}>
                    {item.problem}
                  </div>
                </div>
              </div>

              {/* Arrow Indicator */}
              <div style={{ display: 'flex', justifyContent: 'center', color: '#10b981' }}>
                <ArrowRight size={20} />
              </div>

              {/* Solution & Result Column */}
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '10px',
                    background: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#10b981',
                    flexShrink: 0,
                  }}
                >
                  <Icon size={18} />
                </div>
                <div>
                  <div style={{ color: '#34d399', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>
                    Asterim Solution
                  </div>
                  <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '0.98rem', marginBottom: '4px' }}>
                    {item.solution}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
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
