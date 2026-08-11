import React, { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, ShieldCheck, Terminal } from 'lucide-react';

export const AgentStreamTab: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [userApproval, setUserApproval] = useState<'pending' | 'approved' | 'rejected'>('pending');

  const workflowSequence = [
    {
      step: 1,
      title: 'AGENT INITIATED',
      log: '[00:01.02] agent: Subprocess PID 4912 initialized (Claude Code v0.4.5)',
      action: 'Inspecting workspace context at /home/dev/projects/asterim-monorepo',
      status: 'RUNNING',
    },
    {
      step: 2,
      title: 'TOOL EXECUTED',
      log: '[00:01.08] agent: Executing tool call -> Edit apps/server/src/ApprovalManager.ts',
      action: 'Generated code diff patch adding real-time AST bash parser bounds',
      status: 'TOOL CALL',
    },
    {
      step: 3,
      title: 'AST SECURITY INTERCEPTION',
      log: '[00:01.15] security-guard: Intercepted bash shell execution request',
      action: 'Evaluating command AST syntax tree against workspace sandbox root',
      status: 'SECURITY CHECK',
    },
    {
      step: 4,
      title: 'APPROVAL REQUIRED',
      log: '[00:01.22] workstation: Execution held pending user clearance',
      action: 'Target: git commit -m "feat: add AST security guard"',
      status: 'APPROVAL PENDING',
    },
    {
      step: 5,
      title: 'TASK COMPLETED',
      log: '[00:01.35] agent: Execution resumed. Task completed with zero orphaned PID processes.',
      action: 'Changes committed to git repository cleanly',
      status: 'COMPLETED',
    },
  ];

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev === 3 && userApproval === 'pending') {
          // Pause auto-advance on step 4 until approved or auto-advanced after timeout
          return 3;
        }
        return (prev + 1) % workflowSequence.length;
      });
    }, 3500);
    return () => clearInterval(timer);
  }, [isPlaying, userApproval]);

  const active = workflowSequence[currentStep];

  const handleApprove = () => {
    setUserApproval('approved');
    setCurrentStep(4);
  };

  const handleReset = () => {
    setCurrentStep(0);
    setUserApproval('pending');
    setIsPlaying(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Step Progress Tracker */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
        {workflowSequence.map((wf, idx) => {
          const isDone = currentStep > idx;
          const isCurrent = currentStep === idx;
          return (
            <div
              key={idx}
              onClick={() => {
                setCurrentStep(idx);
                setIsPlaying(false);
              }}
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius-sm)',
                background: isCurrent ? 'var(--accent-green-bg)' : isDone ? 'rgba(16, 185, 129, 0.08)' : '#04070d',
                border: `1px solid ${isCurrent ? 'var(--border-accent)' : isDone ? 'rgba(16, 185, 129, 0.2)' : 'var(--border-subtle)'}`,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: isCurrent ? 'var(--accent-green-hover)' : 'var(--text-muted)', textTransform: 'uppercase' }}>
                STEP 0{wf.step}
              </div>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: isCurrent ? 'var(--text-primary)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {wf.title}
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Workflow Scene Window */}
      <div
        style={{
          background: '#04070d',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.95rem' }}>
            <Terminal size={18} style={{ color: 'var(--accent-green)' }} />
            <span>Agent Workflow Scene: {active.title}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="btn-secondary"
              style={{ padding: '4px 10px', fontSize: '0.78rem', gap: '4px' }}
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} />}
              <span>{isPlaying ? 'Pause' : 'Play'}</span>
            </button>

            <button
              onClick={handleReset}
              className="btn-secondary"
              style={{ padding: '4px 10px', fontSize: '0.78rem', gap: '4px' }}
            >
              <RotateCcw size={13} />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* Terminal Log Output Stream Line */}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--accent-green-hover)', background: '#080c14', padding: '12px 16px', borderRadius: '4px' }}>
          {active.log}
        </div>

        {/* Action Detail Box */}
        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {active.action}
        </div>

        {/* Step 4 Interception Interactive Prompt (When active on Step 4) */}
        {currentStep === 3 && (
          <div
            style={{
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid var(--border-accent)',
              borderRadius: 'var(--radius-sm)',
              padding: '16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ShieldCheck size={20} style={{ color: 'var(--accent-green)' }} />
              <div>
                <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.9rem' }}>
                  Asterim Command Security Clearance
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                  Target: <code>git commit -m "feat: add AST security guard"</code>
                </div>
              </div>
            </div>

            <button onClick={handleApprove} className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
              Authorize Command
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
