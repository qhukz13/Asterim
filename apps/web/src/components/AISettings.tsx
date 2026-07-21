import React, { useState, useEffect } from 'react';

interface AISettingsProps {
  activeBackendUrl?: string;
}

export function AISettings({ activeBackendUrl }: AISettingsProps) {
  const [provider, setProvider] = useState('agent');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

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
          if (data.settings.ai_api_key) setApiKey(data.settings.ai_api_key);
        }
      })
      .catch(console.error);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveMessage('');

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
            ai_api_key: apiKey
          }
        })
      });

      if (res.ok) {
        setSaveMessage('✅ Settings saved successfully');
      } else {
        setSaveMessage('❌ Failed to save settings');
      }
    } catch (err) {
      setSaveMessage('❌ Error connecting to server');
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(''), 3000);
    }
  };

  return (
    <div className="settings-card glass-panel" style={{ padding: '20px' }}>
      <h3 style={{ marginBottom: '16px' }}>Workspace AI</h3>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
        Configure the AI provider used for UI features like Generate Commit, Explain Diff, and Suggest Files.
      </p>
      
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            AI Provider
          </label>
          <div style={{ position: 'relative' }}>
            <div 
              className="input-box"
              style={{ width: '100%', padding: '10px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
              <span>{providerOptions.find(o => o.value === provider)?.label || 'Select Provider'}</span>
              <span style={{ opacity: 0.5, fontSize: '0.8rem' }}>▼</span>
            </div>
            
            {isDropdownOpen && (
              <div style={{ 
                position: 'absolute', top: '100%', left: 0, right: 0, 
                backgroundColor: 'var(--bg-secondary, #252526)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                marginTop: '4px',
                zIndex: 10,
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                overflow: 'hidden'
              }}>
                {providerOptions.map(option => (
                  <div 
                    key={option.value}
                    style={{ 
                      padding: '10px', 
                      cursor: option.disabled ? 'not-allowed' : 'pointer',
                      opacity: option.disabled ? 0.5 : 1,
                      backgroundColor: option.value === provider ? 'var(--accent-color)' : 'transparent',
                      color: option.value === provider ? 'white' : 'inherit',
                      transition: 'background-color 0.1s'
                    }}
                    onClick={() => {
                      if (!option.disabled) {
                        setProvider(option.value);
                        setIsDropdownOpen(false);
                      }
                    }}
                    onMouseEnter={(e) => {
                      if (!option.disabled && option.value !== provider) {
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!option.disabled && option.value !== provider) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }
                    }}
                  >
                    {option.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {provider !== 'agent' && (
          <>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Model (e.g. gemini-2.0-flash)
              </label>
              <input
                type="text"
                className="input-box"
                style={{ width: '100%', padding: '10px' }}
                placeholder="Leave blank for default"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                API Key
              </label>
              <input
                type="password"
                className="input-box"
                style={{ width: '100%', padding: '10px' }}
                placeholder="Enter API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save AI Settings'}
          </button>
          {saveMessage && (
            <span style={{ fontSize: '0.85rem', color: saveMessage.includes('✅') ? 'var(--success-color)' : 'var(--error-color)' }}>
              {saveMessage}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
