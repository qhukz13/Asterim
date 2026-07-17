import React, { useState } from 'react';
import { useAuth } from './hooks/useAuth';

export function PinScreen({ activeBackendUrl }: { activeBackendUrl?: string }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth(activeBackendUrl);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlPin = params.get('pin');
    if (urlPin && urlPin.length === 6) {
      setPin(urlPin);
      
      const autoPair = async () => {
        setLoading(true);
        setError('');
        const result = await login(urlPin, activeBackendUrl);
        if (!result.success) {
          setError(result.error || 'Invalid PIN. Check the server console.');
        } else {
          // Clear query params from URL so refresh doesn't trigger pairing loop
          window.history.replaceState({}, document.title, window.location.pathname);
          window.location.reload();
        }
        setLoading(false);
      };
      autoPair();
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin) return;
    setLoading(true);
    setError('');
    const result = await login(pin, activeBackendUrl);
    if (!result.success) {
      setError(result.error || 'Invalid PIN. Check the server console.');
    } else {
      window.location.reload();
    }
    setLoading(false);
  };

  return (
    <div className="project-selector-container">
      <div className="glass-panel project-selector-panel" style={{ maxWidth: '400px', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '8px' }}>Device Pairing</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
          Enter the 6-digit PIN displayed in your AgentDeck server console to authorize this device.
        </p>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <input
            type="text"
            className="input-box"
            placeholder="Enter PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            style={{ fontSize: '1.5rem', textAlign: 'center', letterSpacing: '4px' }}
            maxLength={6}
            autoFocus
          />
          {error && <div style={{ color: 'var(--error-color)', fontSize: '0.9rem' }}>{error}</div>}
          <button type="submit" className="btn-primary" disabled={loading || pin.length < 4}>
            {loading ? 'Verifying...' : 'Pair Device'}
          </button>
        </form>
      </div>
    </div>
  );
}
