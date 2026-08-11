import React, { useState } from 'react';
import { IconCheck, IconCopy, IconArrowRight, IconTerminal, IconShield, IconCpu, IconLayers } from '../common/MarketingIcons';

export const Act1Hero: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'stream' | 'ast' | 'env'>('stream');

  const handleCopy = () => {
    navigator.clipboard.writeText('npm install -g asterim');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="marketing-section" style={{ paddingTop: '72px', paddingBottom: '96px', maxWidth: '1280px' }}>
      {/* Top Value Prop */}
      <div style={{ textAlign: 'center', maxWidth: '900px', margin: '0 auto 64px auto' }}>
        {/* Status Pill Header */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '5px 16px',
            borderRadius: '100px',
            background: 'rgba(16, 185, 129, 0.06)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            marginBottom: '28px'
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#34d399', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}>
            ASTERIM v2.4 — LOCAL-FIRST AI AGENT CONTROL PLANE
          </span>
        </div>

        {/* Hero Title */}
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(3.0rem, 6vw, 5.25rem)',
            fontWeight: 800,
            letterSpacing: '-0.04em',
            lineHeight: 1.02,
            color: '#f8fafc',
            marginBottom: '28px'
          }}
        >
          The Control Plane for the AI Coding Agents You Already Use.
        </h1>

        {/* Lead Subtitle */}
        <p
          style={{
            fontSize: 'clamp(1.1rem, 2.2vw, 1.3rem)',
            color: '#94a3b8',
            lineHeight: 1.6,
            marginBottom: '40px',
            maxWidth: '740px',
            margin: '0 auto 40px auto'
          }}
        >
          Stop managing loose terminal tabs. Orchestrate Claude Code, Aider, and custom agent swarms in one local-first workstation with AST-level security clearance.
        </p>

        {/* Quickstart Command Bar + Action CTAs */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px'
          }}
        >
          {/* Terminal Command Pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 20px',
              background: '#04070d',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '8px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.92rem',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
            }}
          >
            <span style={{ color: '#10b981', fontWeight: 700 }}>$</span>
            <span style={{ color: '#f8fafc' }}>npm install -g asterim</span>
            <button
              onClick={handleCopy}
              title="Copy Quickstart Command"
              style={{
                background: 'transparent',
                border: 'none',
                color: copied ? '#10b981' : '#64748b',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px',
                marginLeft: '4px',
                transition: 'color 0.15s ease'
              }}
            >
              {copied ? <IconCheck size={16} color="#10b981" /> : <IconCopy size={16} color="#94a3b8" />}
            </button>
          </div>

          <a href="#workstation-sandbox" className="btn-primary" style={{ padding: '14px 28px', fontSize: '1.0rem' }}>
            Explore Interactive Workstation
            <IconArrowRight size={18} />
          </a>
        </div>
      </div>

      {/* Hero Visual Anchor: Full Workstation Frame */}
      <div
        style={{
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          background: '#070a10',
          boxShadow: '0 40px 120px rgba(0, 0, 0, 0.85), 0 0 1px 1px rgba(255,255,255,0.05)',
          overflow: 'hidden'
        }}
      >
        {/* Workstation Titlebar Header */}
        <div
          style={{
            height: '44px',
            background: '#0d1424',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ef4444', opacity: 0.8 }} />
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#eab308', opacity: 0.8 }} />
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#22c55e', opacity: 0.8 }} />
            <span style={{ marginLeft: '12px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: '#64748b' }}>
              asterim-workstation v2.4 // thread: #tr-8942 // workspace: /projects/asterim
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
              LOCAL PTY ACTIVE
            </span>
          </div>
        </div>

        {/* Workstation Body Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '220px 1fr 280px',
            minHeight: '440px',
            background: '#04070d'
          }}
        >
          {/* Left Sidebar: Projects & Active Agents */}
          <div
            style={{
              borderRight: '1px solid rgba(255, 255, 255, 0.06)',
              background: '#070a10',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px'
            }}
          >
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
                Active Workspace
              </div>
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <IconLayers size={14} color="#10b981" />
                Asterim Core
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
                Attached Agents (3)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ padding: '8px 10px', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.25)', fontSize: '0.82rem', color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Claude Code 3.7</span>
                  <span style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: '#10b981' }}>RUNNING</span>
                </div>
                <div style={{ padding: '8px 10px', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', fontSize: '0.82rem', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Aider v0.72</span>
                  <span style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: '#64748b' }}>IDLE</span>
                </div>
                <div style={{ padding: '8px 10px', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', fontSize: '0.82rem', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Antigravity Core</span>
                  <span style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: '#64748b' }}>INDEXING</span>
                </div>
              </div>
            </div>
          </div>

          {/* Center Column: Live Terminal Execution Stream */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Viewport Nav Tabs */}
            <div style={{ height: '38px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: '#070a10', display: 'flex', alignItems: 'center', padding: '0 16px', gap: '16px' }}>
              <button
                onClick={() => setActiveTab('stream')}
                style={{ background: 'none', border: 'none', color: activeTab === 'stream' ? '#10b981' : '#64748b', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <IconTerminal size={14} /> Live Stream
              </button>
              <button
                onClick={() => setActiveTab('ast')}
                style={{ background: 'none', border: 'none', color: activeTab === 'ast' ? '#10b981' : '#64748b', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <IconShield size={14} /> AST Guard
              </button>
            </div>

            {/* Terminal Log Output */}
            <div style={{ padding: '20px', fontFamily: 'var(--font-mono)', fontSize: '0.84rem', lineHeight: 1.6, flex: 1, overflowY: 'auto' }}>
              <div style={{ color: '#64748b', marginBottom: '8px' }}>[10:14:02] info: Initializing PTY session #tr-8942 on local daemon...</div>
              <div style={{ color: '#38bdf8', marginBottom: '8px' }}>[10:14:03] agent: Claude Code 3.7 analyzing AST symbol graph...</div>
              <div style={{ color: '#cbd5e1', marginBottom: '8px' }}>
                <span style={{ color: '#10b981' }}>✓</span> Identified 14 workspace modules in <span style={{ color: '#f43f5e' }}>packages/core</span>
              </div>
              <div style={{ color: '#eab308', marginBottom: '8px' }}>
                [10:14:05] AST Guard: Intercepting dangerous command <span style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', padding: '2px 6px', borderRadius: '4px' }}>rm -rf /var/log/asterim</span>
              </div>
              <div style={{ color: '#10b981', fontWeight: 600 }}>
                [10:14:06] Promise Intercept: Clearance GRANTED by user (Rule #402). Continuing execution...
              </div>
              <div style={{ color: '#94a3b8', marginTop: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '8px', height: '14px', background: '#10b981', display: 'inline-block' }} />
                <span>Agent streaming log...</span>
              </div>
            </div>
          </div>

          {/* Right Sidebar: Security & Context Enclave */}
          <div
            style={{
              borderLeft: '1px solid rgba(255, 255, 255, 0.06)',
              background: '#070a10',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Security Clearance
            </div>

            <div style={{ padding: '12px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#34d399', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <IconShield size={14} color="#10b981" />
                AST GUARD ACTIVE
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.4 }}>
                0-Trust clearance rules active. Terminal mutations intercepted before execution.
              </div>
            </div>

            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '8px' }}>
              Scoped Enclave
            </div>
            <div style={{ fontSize: '0.8rem', color: '#cbd5e1', fontFamily: 'var(--font-mono)' }}>
              <div>Scope: <span style={{ color: '#10b981' }}>Company</span></div>
              <div>Secrets: <span style={{ color: '#f8fafc' }}>Enclave Masked</span></div>
              <div>Local-First: <span style={{ color: '#10b981' }}>100% Offline</span></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
