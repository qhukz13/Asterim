import React, { useState } from 'react';
import { IconBot, IconTerminal, IconSparkles, IconShield } from '../icons/Icons';

interface FirstRunWizardProps {
  activeBackendUrl?: string;
  onComplete: () => void;
}

export function FirstRunWizard({ activeBackendUrl, onComplete }: FirstRunWizardProps) {
  const [wizardStep, setWizardStep] = useState(1);
  const [selectedDefaultAgent, setSelectedDefaultAgent] = useState<
    'aider' | 'claude' | 'antigravity'
  >('claude');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleWizardComplete = async () => {
    try {
      setIsSaving(true);
      setError(null);
      const baseUrl =
        activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;
      const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';

      const res = await fetch(`${baseUrl}/api/v1/system/first-run-complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        localStorage.setItem('asterim_default_agent', selectedDefaultAgent);
        onComplete();
      } else {
        setError('Failed to record wizard completion. Please try again.');
      }
    } catch (err) {
      console.error('Wizard complete error', err);
      setError('Failed to save settings. Connection error.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="dialog-overlay">
      <div
        className="dialog-box glass-panel"
        style={{ maxWidth: '600px', width: '100%', padding: '32px' }}
      >
        {wizardStep === 1 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <IconBot size={48} color="var(--color-accent-primary)" />
            </div>
            <h1
              style={{
                marginBottom: '16px',
                fontSize: '1.75rem',
                color: 'var(--color-text-primary)',
                fontWeight: 600
              }}
            >
              Welcome to Asterim
            </h1>
            <p
              style={{
                color: 'var(--color-text-secondary)',
                marginBottom: '28px',
                fontSize: '0.95rem',
                lineHeight: '1.6'
              }}
            >
              Asterim is a professional Mission Control for Autonomous AI Coding Agents. Let&apos;s configure your workspace defaults in 2 simple steps.
            </p>
            <button
              onClick={() => setWizardStep(2)}
              className="btn-primary"
              style={{ padding: '14px 28px', width: '100%' }}
            >
              Get Started
            </button>
          </div>
        )}

        {wizardStep === 2 && (
          <div>
            <h2 style={{ marginBottom: '8px', fontSize: '1.25rem', fontWeight: 600 }}>Choose Default Agent Engine</h2>
            <p style={{ color: 'var(--color-text-secondary)', marginBottom: '24px', fontSize: '0.875rem' }}>
              Select which CLI agent driver will start by default for new sessions.
            </p>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
              <div
                onClick={() => setSelectedDefaultAgent('claude')}
                style={{
                  flex: 1,
                  padding: '16px 8px',
                  background:
                    selectedDefaultAgent === 'claude'
                      ? 'var(--color-surface-2)'
                      : 'var(--color-surface-1)',
                  border:
                    selectedDefaultAgent === 'claude'
                      ? '2px solid var(--color-accent-primary)'
                      : '1px solid var(--color-border-subtle)',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  textAlign: 'center'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                  <IconBot size={28} color={selectedDefaultAgent === 'claude' ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)'} />
                </div>
                <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '0.9rem' }}>
                  Claude Code
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                  Anthropic CLI agent
                </div>
              </div>

              <div
                onClick={() => setSelectedDefaultAgent('aider')}
                style={{
                  flex: 1,
                  padding: '16px 8px',
                  background:
                    selectedDefaultAgent === 'aider'
                      ? 'var(--color-surface-2)'
                      : 'var(--color-surface-1)',
                  border:
                    selectedDefaultAgent === 'aider'
                      ? '2px solid var(--color-accent-primary)'
                      : '1px solid var(--color-border-subtle)',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  textAlign: 'center'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                  <IconTerminal size={28} color={selectedDefaultAgent === 'aider' ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)'} />
                </div>
                <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '0.9rem' }}>
                  Aider
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                  Python Git agent
                </div>
              </div>

              <div
                onClick={() => setSelectedDefaultAgent('antigravity')}
                style={{
                  flex: 1,
                  padding: '16px 8px',
                  background:
                    selectedDefaultAgent === 'antigravity'
                      ? 'var(--color-surface-2)'
                      : 'var(--color-surface-1)',
                  border:
                    selectedDefaultAgent === 'antigravity'
                      ? '2px solid var(--color-accent-primary)'
                      : '1px solid var(--color-border-subtle)',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  textAlign: 'center'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                  <IconSparkles size={28} color={selectedDefaultAgent === 'antigravity' ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)'} />
                </div>
                <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '0.9rem' }}>
                  Antigravity
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                  Google AI agent
                </div>
              </div>
            </div>

            <button
              onClick={() => setWizardStep(3)}
              className="btn-primary"
              style={{ padding: '14px 28px', width: '100%' }}
            >
              Next Step
            </button>
          </div>
        )}

        {wizardStep === 3 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <IconSparkles size={40} color="var(--color-accent-primary)" />
            </div>
            <h2 style={{ marginBottom: '16px', textAlign: 'center', fontSize: '1.25rem', fontWeight: 600 }}>Ready to Launch</h2>
            <div
              style={{
                color: 'var(--color-text-secondary)',
                fontSize: '0.9rem',
                lineHeight: '1.6',
                marginBottom: '28px',
                textAlign: 'left',
                background: 'var(--color-surface-2)',
                padding: '20px',
                borderRadius: '12px',
                border: '1px solid var(--color-border-subtle)'
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '12px' }}>Workspace Tips:</div>
              
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
                <IconTerminal size={16} color="var(--color-accent-primary)" style={{ marginTop: '2px' }} />
                <span><strong>Real-time Telemetry</strong>: Monitor live execution streams and ANSI output in the terminal panel.</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
                <IconShield size={16} color="var(--color-accent-primary)" style={{ marginTop: '2px' }} />
                <span><strong>Interactive Approvals</strong>: Review file edits, system commands, and git diffs before execution.</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <IconBot size={16} color="var(--color-accent-primary)" style={{ marginTop: '2px' }} />
                <span><strong>Multi-Device Control</strong>: Connect remote workstations and monitor session progress from any device.</span>
              </div>
            </div>

            {error && (
              <div
                style={{
                  color: 'var(--color-state-error)',
                  marginBottom: '16px',
                  textAlign: 'center',
                  fontSize: '0.85rem'
                }}
              >
                {error}
              </div>
            )}

            <button
              onClick={handleWizardComplete}
              disabled={isSaving}
              className="btn-primary"
              style={{
                padding: '14px 28px',
                width: '100%'
              }}
            >
              {isSaving ? 'Saving...' : 'Go to Dashboard'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
