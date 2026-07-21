import React, { useState } from 'react';

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
            <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>🚀</div>
            <h1
              style={{
                marginBottom: '16px',
                fontSize: '2rem',
                background:
                  'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-hover))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
              }}
            >
              Welcome to Asterim
            </h1>
            <p
              style={{
                color: 'var(--color-text-secondary)',
                lineHeight: '1.6',
                marginBottom: '32px'
              }}
            >
              Your local-first control plane for AI coding agents is ready. Let's customize your
              environment in just two quick steps.
            </p>
            <button
              onClick={() => setWizardStep(2)}
              className="btn-primary"
              style={{ padding: '14px 28px', width: '100%', fontSize: '1rem' }}
            >
              Get Started
            </button>
          </div>
        )}

        {wizardStep === 2 && (
          <div>
            <div style={{ fontSize: '3.5rem', marginBottom: '16px', textAlign: 'center' }}>⚙️</div>
            <h2 style={{ marginBottom: '12px', textAlign: 'center' }}>Choose Default Agent</h2>
            <p
              style={{
                color: 'var(--color-text-secondary)',
                fontSize: '0.9rem',
                marginBottom: '24px',
                textAlign: 'center'
              }}
            >
              Select the AI engine you'd like to use by default. You can change this anytime.
            </p>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '32px' }}>
              <div
                onClick={() => setSelectedDefaultAgent('claude')}
                style={{
                  flex: 1,
                  padding: '16px 8px',
                  background:
                    selectedDefaultAgent === 'claude'
                      ? 'var(--color-accent-transparent)'
                      : 'rgba(0,0,0,0.2)',
                  border:
                    selectedDefaultAgent === 'claude'
                      ? '2px solid var(--color-accent-primary)'
                      : '1px solid var(--color-border-default)',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  textAlign: 'center'
                }}
              >
                <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>🤖</div>
                <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '0.9rem' }}>
                  Claude Code
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
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
                      ? 'var(--color-accent-transparent)'
                      : 'rgba(0,0,0,0.2)',
                  border:
                    selectedDefaultAgent === 'aider'
                      ? '2px solid var(--color-accent-primary)'
                      : '1px solid var(--color-border-default)',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  textAlign: 'center'
                }}
              >
                <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>🐍</div>
                <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '0.9rem' }}>
                  Aider
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
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
                      ? 'var(--color-accent-transparent)'
                      : 'rgba(0,0,0,0.2)',
                  border:
                    selectedDefaultAgent === 'antigravity'
                      ? '2px solid var(--color-accent-primary)'
                      : '1px solid var(--color-border-default)',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  textAlign: 'center'
                }}
              >
                <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>🛸</div>
                <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '0.9rem' }}>
                  Antigravity
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
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
            <div style={{ fontSize: '3.5rem', marginBottom: '16px', textAlign: 'center' }}>✨</div>
            <h2 style={{ marginBottom: '16px', textAlign: 'center' }}>Ready to Launch</h2>
            <div
              style={{
                color: 'var(--color-text-secondary)',
                fontSize: '0.95rem',
                lineHeight: '1.6',
                marginBottom: '28px',
                textAlign: 'left',
                background: 'rgba(0,0,0,0.2)',
                padding: '20px',
                borderRadius: '12px',
                border: '1px solid var(--color-border-default)'
              }}
            >
              Here are a few quick tips to get started:
              <br />
              <br />• 💻 <strong>Real-time Telemetry</strong>: Watch command execution streams in
              the terminal dashboard.
              <br />
              <br />• 🛡️ <strong>Interactive Approvals</strong>: Review high-impact commands and
              local workspace diffs before execution.
              <br />
              <br />• 📱 <strong>Mobile Control</strong>: Scan the console QR code to control code
              edits directly from your phone.
            </div>

            {error && (
              <div
                style={{
                  color: 'var(--color-error-primary)',
                  marginBottom: '16px',
                  textAlign: 'center'
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
                width: '100%',
                background: 'var(--color-success-primary)'
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
