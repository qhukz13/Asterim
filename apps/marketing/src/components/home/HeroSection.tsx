import React from 'react';
import { ArrowRight, BookOpen, ShieldCheck, Terminal, FileCode2, Layers } from 'lucide-react';
import { TerminalCopyBlock } from '../common/TerminalCopyBlock';

interface HeroSectionProps {
  navigate: (path: string) => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ navigate }) => {
  return (
    <section className="marketing-section" style={{ paddingTop: '64px', paddingBottom: '72px' }}>
      {/* Asymmetric Hero Header Grid: Left Text Thesis + Right Quickstart */}
      <div className="hero-header-grid">
        <div>
          {/* Technical Version Status Badge */}
          <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--accent-green-bg)',
                border: '1px solid var(--border-accent)',
                fontSize: '0.8rem',
                color: 'var(--accent-green-hover)',
                fontWeight: 600,
              }}
            >
              <ShieldCheck size={14} />
              <span>Asterim v0.4.5 — Local Control Plane</span>
              <span style={{ color: '#64748b' }}>•</span>
              <span className="status-badge available" style={{ fontSize: '0.65rem', padding: '1px 5px' }}>
                AVAILABLE NOW
              </span>
            </div>
          </div>

          {/* Main Headline — Restrained Display Typography */}
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(2.5rem, 4.8vw, 4.25rem)',
              fontWeight: 800,
              color: 'var(--text-primary)',
              letterSpacing: '-0.035em',
              lineHeight: 1.08,
              marginBottom: '20px',
            }}
          >
            The Local Control Plane for Autonomous AI Coding Agents
          </h1>

          {/* Subhead */}
          <p
            style={{
              fontSize: '1.12rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.65,
              marginBottom: '32px',
              maxWidth: '640px',
            }}
          >
            You already have AI agents. Asterim gives you the engineering system to supervise, isolate, and control them—from local desktop workstations to mobile push approvals.
          </p>

          {/* Primary CTAs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <button onClick={() => navigate('/download')} className="btn-primary" style={{ padding: '12px 24px', fontSize: '0.95rem' }}>
              <span>Download Workstation</span>
              <ArrowRight size={16} />
            </button>

            <button onClick={() => navigate('/docs')} className="btn-secondary" style={{ padding: '12px 24px', fontSize: '0.95rem' }}>
              <BookOpen size={16} />
              <span>Documentation</span>
            </button>
          </div>
        </div>

        {/* Right Column: Universal NPM Installation Block */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', justifyContent: 'center' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Quick CLI Install
          </div>
          <TerminalCopyBlock command="npm install -g asterim" />
        </div>
      </div>

      {/* HERO VISUAL CENTERPIECE: Realistic Asterim Workstation UI Composition */}
      <div style={{ width: '100%', margin: '0 auto', textAlign: 'left' }}>
        <div
          style={{
            background: 'var(--bg-dark)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            boxShadow: '0 40px 100px rgba(0, 0, 0, 0.9), 0 0 40px rgba(16, 185, 129, 0.04)',
          }}
        >
          {/* Workstation Top Navigation Bar (based on apps/web TopBar.tsx) */}
          <div
            style={{
              background: 'var(--bg-surface)',
              borderBottom: '1px solid var(--border-subtle)',
              padding: '12px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
            }}
          >
            {/* Left: Window Controls & Active Environment Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }} />
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b' }} />
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }} />
              </div>

              {/* Active Environment Pill */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(56, 189, 248, 0.12)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  fontSize: '0.78rem',
                  color: '#38bdf8',
                  fontWeight: 600,
                }}
              >
                <Layers size={13} />
                <span>Company (Enterprise)</span>
              </div>
            </div>

            {/* Center: Active Project Breadcrumb */}
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              asterim / <strong style={{ color: 'var(--text-primary)' }}>apps/server/src/ApprovalManager.ts</strong>
            </div>

            {/* Right: Active Agent Session Tag */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="status-badge available" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>
                Claude Code v0.4.5
              </span>
            </div>
          </div>

          {/* Workstation Main Body Split: File Tree + Agent Terminal Stream + Diff Inspector */}
          <div className="workstation-body-grid">
            {/* Left Sidebar: Workspace Project File Tree */}
            <div
              style={{
                borderRight: '1px solid var(--border-subtle)',
                padding: '16px',
                background: 'var(--bg-surface)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Workspace Projects
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.84rem' }}>
                <div style={{ color: 'var(--accent-green-hover)', fontWeight: 600, padding: '4px 8px', borderRadius: '4px', background: 'var(--accent-green-bg)' }}>
                  📁 asterim-monorepo
                </div>
                <div style={{ color: 'var(--text-secondary)', padding: '4px 16px' }}>└ 📁 apps/server</div>
                <div style={{ color: 'var(--text-primary)', fontWeight: 600, padding: '4px 24px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '4px' }}>
                  📄 ApprovalManager.ts
                </div>
                <div style={{ color: 'var(--text-secondary)', padding: '4px 16px' }}>└ 📁 apps/web</div>
                <div style={{ color: 'var(--text-secondary)', padding: '4px 16px' }}>└ 📁 packages/adapters</div>
              </div>
            </div>

            {/* Center View: Agent Terminal & PTY Output Stream */}
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', borderRight: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '0.88rem', fontWeight: 700 }}>
                  <Terminal size={16} style={{ color: 'var(--accent-green)' }} />
                  <span>Agent PTY Terminal Output Stream</span>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--accent-green-hover)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  ● RUNNING
                </span>
              </div>

              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.84rem',
                  lineHeight: 1.6,
                  color: '#cbd5e1',
                  background: '#070a10',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '16px',
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ color: 'var(--text-muted)' }}>[00:01.02] asterim-daemon: Attached to agent subprocess</div>
                <div style={{ color: '#e2e8f0' }}>[00:01.05] agent: Scanning bash AST command syntax for hazardous patterns...</div>
                <div style={{ color: 'var(--accent-green-hover)', fontWeight: 600 }}>[00:01.12] security-guard: AST Analysis &rarr; SAFE (0 path traversal risk)</div>
                <div style={{ color: '#38bdf8' }}>[00:01.20] agent: Generating git diff patch for ApprovalManager.ts</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-green)', marginTop: '8px' }}>
                  <span className="pulse-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-green)' }} />
                  <span>Waiting for execution clearance...</span>
                </div>
              </div>
            </div>

            {/* Right Pane: Code Diff & Security Inspector */}
            <div style={{ padding: '20px', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '0.88rem', fontWeight: 700 }}>
                <FileCode2 size={16} style={{ color: '#38bdf8' }} />
                <span>Staged Code Patch</span>
              </div>

              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.78rem',
                  lineHeight: 1.5,
                  background: '#04070d',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px',
                  flex: 1,
                }}
              >
                <div style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>diff --git a/ApprovalManager.ts</div>
                <div style={{ color: '#f87171' }}>- return evaluateRawCommand(cmd);</div>
                <div style={{ color: 'var(--accent-green-hover)', fontWeight: 600 }}>+ return parseASTAndEnforceBounds(cmd, rootPath);</div>
                <div style={{ color: 'var(--accent-green-hover)', fontWeight: 600 }}>+ emitSecurityEvent('CLEARANCE_GRANTED');</div>
              </div>

              <div style={{ background: 'var(--accent-green-bg)', border: '1px solid var(--border-accent)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', fontSize: '0.8rem', color: 'var(--accent-green-hover)', fontWeight: 600, textAlign: 'center' }}>
                ✓ Command Clear to Execute
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
