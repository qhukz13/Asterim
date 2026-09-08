import React, { useState } from 'react';
import { IconBot, IconTerminal, IconShield, IconCheck, IconAlertTriangle } from '../icons/Icons';
import { getAuthHeaders } from '../../utils/auth';

type EngineId = 'claude' | 'antigravity';

interface FirstRunWizardProps {
  activeBackendUrl?: string;
  /** Which agent CLIs the Core found on this machine, from `/api/v1/system`. */
  binaries?: { claude?: boolean; antigravity?: boolean } | null;
  onComplete: () => void;
}

const ENGINES: { id: EngineId; name: string; detail: string; install: string }[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    detail: "Anthropic's CLI agent. Asterim drives it headlessly and answers its permission prompts.",
    install: 'npm install -g @anthropic-ai/claude-code'
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    detail: "Google's CLI agent, driven through its terminal interface. Best effort.",
    install: 'Install the Antigravity CLI (agy) from Google.'
  }
];

/**
 * Three screens: what this is, which agent to use, what will happen next.
 * The engine list is honest about what is installed: a missing CLI is shown
 * with its install command instead of being offered as if it worked.
 */
export function FirstRunWizard({ activeBackendUrl, binaries, onComplete }: FirstRunWizardProps) {
  const detected = (id: EngineId) => Boolean(binaries?.[id]);
  const firstDetected = ENGINES.find(e => detected(e.id))?.id ?? 'claude';

  const [step, setStep] = useState(1);
  const [engine, setEngine] = useState<EngineId>(firstDetected);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const finish = async () => {
    try {
      setSaving(true);
      setError(null);
      const baseUrl = activeBackendUrl || window.location.origin;
      const res = await fetch(`${baseUrl}/api/v1/system/first-run-complete`, {
        method: 'POST',
        headers: getAuthHeaders({ backendUrl: activeBackendUrl })
      });
      if (!res.ok) throw new Error(`Server answered ${res.status}`);
      localStorage.setItem('asterim_default_agent', engine);
      onComplete();
    } catch (err) {
      setError(`Could not save your choice: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-box glass-panel" style={{ maxWidth: '560px', width: '100%', padding: '32px' }}>
        {step === 1 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <IconBot size={40} color="var(--color-accent-primary)" />
            </div>
            <h1 style={{ margin: '0 0 12px', fontSize: '1.5rem', fontWeight: 600, textAlign: 'center' }}>
              Asterim is running on this machine
            </h1>
            <p style={{ color: 'var(--color-text-secondary)', margin: '0 0 24px', lineHeight: 1.6, textAlign: 'center' }}>
              It runs a coding agent inside a project folder you choose, shows you what the agent
              is doing, and stops it every time it wants to run a command or change a file until
              you say yes. Nothing leaves this machine except the agent's own API calls.
            </p>
            <button onClick={() => setStep(2)} className="btn-primary" style={{ width: '100%', padding: '12px' }}>
              Choose an agent
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 style={{ margin: '0 0 6px', fontSize: '1.2rem', fontWeight: 600 }}>Which agent should new threads use?</h2>
            <p style={{ color: 'var(--color-text-secondary)', margin: '0 0 20px', fontSize: '0.9rem' }}>
              Asterim looked for each CLI on this machine. You can change this per thread later.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
              {ENGINES.map(option => {
                const found = detected(option.id);
                const selected = engine === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setEngine(option.id)}
                    style={{
                      textAlign: 'left',
                      padding: '14px 16px',
                      background: selected ? 'var(--color-surface-2)' : 'var(--color-surface-1)',
                      border: selected
                        ? '1px solid var(--color-accent-primary)'
                        : '1px solid var(--color-border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      color: 'var(--color-text-primary)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                      <span style={{ fontWeight: 600 }}>{option.name}</span>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '0.75rem',
                          color: found ? 'var(--color-accent-primary)' : 'var(--color-text-muted)'
                        }}
                      >
                        {found ? <IconCheck size={13} /> : <IconAlertTriangle size={13} />}
                        {found ? 'Detected' : 'Not found'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                      {option.detail}
                    </div>
                    {!found && (
                      <code
                        style={{
                          display: 'block',
                          marginTop: '8px',
                          fontSize: '0.78rem',
                          color: 'var(--color-text-secondary)',
                          fontFamily: 'var(--font-family-mono)'
                        }}
                      >
                        {option.install}
                      </code>
                    )}
                  </button>
                );
              })}
            </div>

            {!detected(engine) && (
              <p style={{ fontSize: '0.85rem', color: 'var(--color-state-paused, #f59e0b)', margin: '0 0 16px' }}>
                {ENGINES.find(e => e.id === engine)?.name} was not found. Install it, then restart
                Asterim, or pick an engine that was detected.
              </p>
            )}

            <button onClick={() => setStep(3)} className="btn-primary" style={{ width: '100%', padding: '12px' }}>
              Continue
            </button>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 style={{ margin: '0 0 16px', fontSize: '1.2rem', fontWeight: 600, textAlign: 'center' }}>
              What happens next
            </h2>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '18px',
                marginBottom: '20px',
                fontSize: '0.9rem',
                color: 'var(--color-text-secondary)',
                lineHeight: 1.5
              }}
            >
              <div style={{ display: 'flex', gap: '10px' }}>
                <IconTerminal size={16} color="var(--color-accent-primary)" style={{ marginTop: '2px', flexShrink: 0 }} />
                <span>
                  <strong style={{ color: 'var(--color-text-primary)' }}>Add a project.</strong> Point Asterim at
                  a folder on this machine. The agent works there and only there.
                </span>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <IconShield size={16} color="var(--color-accent-primary)" style={{ marginTop: '2px', flexShrink: 0 }} />
                <span>
                  <strong style={{ color: 'var(--color-text-primary)' }}>Approve or deny.</strong> Every command
                  and file write the agent proposes appears as a card. Nothing runs until you decide.
                </span>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <IconBot size={16} color="var(--color-accent-primary)" style={{ marginTop: '2px', flexShrink: 0 }} />
                <span>
                  <strong style={{ color: 'var(--color-text-primary)' }}>Review the diff.</strong> The Changes
                  view shows what the agent touched. You commit; the agent never does.
                </span>
              </div>
            </div>

            {error && (
              <div style={{ color: 'var(--color-state-error)', marginBottom: '12px', fontSize: '0.85rem', textAlign: 'center' }}>
                {error}
              </div>
            )}

            <button onClick={finish} disabled={saving} className="btn-primary" style={{ width: '100%', padding: '12px' }}>
              {saving ? 'Saving…' : 'Open the workspace'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
