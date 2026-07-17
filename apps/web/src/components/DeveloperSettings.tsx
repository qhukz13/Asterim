import React, { useState } from 'react';
import { useWorkstations } from '../hooks/useWorkstations';

export function DeveloperSettings() {
  const {
    config,
    discovered,
    activeWorkstation,
    setActiveWorkstation,
    setDeveloperMode,
    forgetWorkstation,
    addManualWorkstation
  } = useWorkstations();

  const connectWorkstation = (id: string) => {
    setActiveWorkstation(id);
    const container = document.querySelector('.project-selector-container');
    if (container) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState('3000');

  const handleAddManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualIp && manualPort) {
      addManualWorkstation(manualIp, parseInt(manualPort, 10));
      setManualIp('');
    }
  };

  return (
    <div className="settings-card glass-panel" style={{ padding: '20px', marginTop: '20px' }}>
      <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        🛠️ Developer Settings
      </h3>
      
      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '8px' }}>
          <input 
            type="checkbox" 
            checked={config.developerMode}
            onChange={(e) => setDeveloperMode(e.target.checked)}
            style={{ width: '18px', height: '18px' }}
          />
          <span style={{ fontWeight: 500 }}>Enable Developer Mode (Multi-Device)</span>
        </label>
      </div>

      {config.developerMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div>
            <h4 style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>Discovered Workstations (LAN)</h4>
            {discovered.length === 0 ? (
              <div style={{ fontSize: '0.9rem', opacity: 0.7, fontStyle: 'italic' }}>Scanning for workstations...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {discovered.map(w => (
                  <div key={w.id} style={{ 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px',
                    border: config.preferredWorkstationId === w.id ? '2px solid var(--accent-color)' : '1px solid var(--panel-border)'
                  }}>
                    <div>
                      <div style={{ fontWeight: 'bold' }}>{w.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{w.ip}:{w.port}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {config.preferredWorkstationId === w.id ? (
                        <span style={{ color: 'var(--success-color)', fontSize: '0.85rem', fontWeight: 'bold' }}>Active</span>
                      ) : (
                        <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => setActiveWorkstation(w.id)}>
                          Connect
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>Known Workstations</h4>
            {Object.keys(config.knownWorkstations).length === 0 ? (
              <div style={{ fontSize: '0.9rem', opacity: 0.7, fontStyle: 'italic' }}>No known workstations.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {(Object.values(config.knownWorkstations) as any[]).map(w => (
                  <div key={w.id} style={{ 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px',
                    border: '1px solid var(--panel-border)'
                  }}>
                    <div>
                      <div style={{ fontWeight: 'bold' }}>{w.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{w.ip}:{w.port}</div>
                      <div style={{ fontSize: '0.75rem', color: w.isOnline ? 'var(--success-color)' : 'var(--error-color)' }}>
                        {w.isOnline ? 'Online' : 'Offline'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {config.preferredWorkstationId !== w.id && (
                        <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => setActiveWorkstation(w.id)}>
                          Connect
                        </button>
                      )}
                      <button className="btn-deny" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => forgetWorkstation(w.id)}>
                        Forget
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>Manual Address (Fallback)</h4>
            <form onSubmit={handleAddManual} style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" 
                className="input-box" 
                placeholder="IP Address (e.g. 192.168.1.5)" 
                style={{ flex: 1 }}
                value={manualIp}
                onChange={e => setManualIp(e.target.value)}
              />
              <input 
                type="text" 
                className="input-box" 
                placeholder="Port" 
                style={{ width: '80px' }}
                value={manualPort}
                onChange={e => setManualPort(e.target.value)}
              />
              <button type="submit" className="btn-primary" style={{ padding: '8px 16px' }}>Add</button>
            </form>
          </div>

          {config.preferredWorkstationId && (
            <div style={{ marginTop: '12px' }}>
              <button className="btn-deny" style={{ width: '100%', padding: '10px' }} onClick={() => setActiveWorkstation(undefined)}>
                Disconnect from Active Workstation (Revert to Local)
              </button>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
