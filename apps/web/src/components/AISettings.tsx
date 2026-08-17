import React, { useState, useEffect } from 'react';
import { IconBot, IconCheck, IconAlert } from './icons/Icons';
import { CustomDropdown } from './CustomDropdown';

interface AISettingsProps {
  activeBackendUrl?: string;
}

export function AISettings({ activeBackendUrl }: AISettingsProps) {
  const [provider, setProvider] = useState('agent');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  // The server answers with a mask, never the key (P9-02), so the form tracks
  // whether one is stored instead of holding it. An empty field means "leave the
  // stored key alone", which is why it is not submitted below.
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const providerOptions = [
    { value: 'agent', label: 'Use Active Coding Agent' },
    { value: 'gemini', label: 'Google Gemini (@google/genai)', disabled: true },
    { value: 'openai', label: 'OpenAI (Coming Soon)', disabled: true },
    { value: 'anthropic', label: 'Anthropic (Coming Soon)', disabled: true },
  ];

  useEffect(() => {
    const baseUrl = activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;
    const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
    const token = localStorage.getItem(tokenKey) || '';

    fetch(`${baseUrl}/api/v1/system/settings`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
      .then(res => res.json())
      .then(data => {
        if (data.settings) {
          if (data.settings.ai_provider) setProvider(data.settings.ai_provider);
          if (data.settings.ai_model) setModel(data.settings.ai_model);
        }
        setHasStoredKey(Boolean(data.hasApiKey));
      })
      .catch(console.error);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const baseUrl = activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;
      const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';

      const res = await fetch(`${baseUrl}/api/v1/system/settings`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          settings: {
            ai_provider: provider,
            ai_model: model,
            // Sent only when the operator typed a new one. The server treats a
            // blank credential as "unchanged", so omitting it is the same
            // instruction stated once instead of twice.
            ...(apiKey.length > 0 ? { ai_api_key: apiKey } : {})
          }
        })
      });

      if (res.ok) {
        if (apiKey.length > 0) {
          setHasStoredKey(true);
          setApiKey('');
        }
        setSaveMessage({ text: 'Settings saved successfully', isError: false });
      } else {
        setSaveMessage({ text: 'Failed to save settings', isError: true });
      }
    } catch (err) {
      setSaveMessage({ text: 'Error connecting to server', isError: true });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  return (
    <div className="settings-card glass-panel" style={{ padding: '20px' }}>
      <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem', fontWeight: 600 }}>
        <IconBot size={18} color="var(--color-accent-primary)" />
        Workspace AI Settings
      </h3>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '20px', lineHeight: 1.5 }}>
        Configure the AI provider used for UI automation features like Generate Commit, Explain Diff, and Suggest Files.
      </p>
      
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.8rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
            AI Provider
          </label>
          <CustomDropdown
            value={provider}
            onChange={setProvider}
            options={providerOptions}
          />
        </div>

        {provider !== 'agent' && (
          <>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.8rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                Model (e.g. gemini-2.0-flash)
              </label>
              <input
                type="text"
                className="input-box"
                style={{ width: '100%', padding: '10px 12px' }}
                placeholder="Leave blank for default"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.8rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                API Key
              </label>
              <input
                type="password"
                className="input-box"
                style={{ width: '100%', padding: '10px 12px' }}
                placeholder={hasStoredKey ? '•••••••• stored' : 'Enter API Key'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                {hasStoredKey
                  ? 'A key is stored, encrypted on this workstation. Enter a new one to replace it.'
                  : 'Stored encrypted on this workstation and never returned by the API.'}
              </p>
            </div>
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save AI Settings'}
          </button>
          {saveMessage && (
            <span style={{ 
              fontSize: '0.85rem', 
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: saveMessage.isError ? 'var(--color-state-error)' : 'var(--color-state-completed)' 
            }}>
              {saveMessage.isError ? <IconAlert size={14} /> : <IconCheck size={14} />}
              {saveMessage.text}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
