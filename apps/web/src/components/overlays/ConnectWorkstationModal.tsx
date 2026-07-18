import React, { useState } from 'react';

interface ConnectWorkstationModalProps {
  workstations: any; // ReturnType<typeof useWorkstations>
  onClose: () => void;
  onConnectRemote: (tunnelId: string, pin: string) => void;
}

export function ConnectWorkstationModal({ workstations, onClose, onConnectRemote }: ConnectWorkstationModalProps) {
  const { config, discovered, activeWorkstation, setActiveWorkstation, addManualWorkstation, forgetWorkstation } = workstations;
  
  const [tunnelId, setTunnelId] = useState('');
  const [remotePin, setRemotePin] = useState('');
  const [manualIp, setManualIp] = useState('');

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-box glass-panel" style={{ maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-text-primary)' }}>Connect Workstation</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h4 style={{ marginBottom: '12px', color: 'var(--color-text-secondary)' }}>Local Network</h4>
          <select 
            className="input-box"
            style={{ width: '100%', marginBottom: '12px', padding: '12px', cursor: 'pointer' }}
            value={config.preferredWorkstationId || 'local'}
            onChange={(e) => setActiveWorkstation(e.target.value === 'local' ? undefined : e.target.value)}
          >
            <option value="local">💻 Local Machine (Default)</option>
            {discovered.map((w: any) => (
              <option key={w.id} value={w.id}>
                🔍 Discovered: {w.name} ({w.ip}:{w.port})
              </option>
            ))}
            {Object.values(config.knownWorkstations).map((w: any) => (
              <option key={w.id} value={w.id}>
                💾 Saved: {w.name} ({w.ip}:{w.port})
              </option>
            ))}
          </select>

          {activeWorkstation && activeWorkstation.name.startsWith('Manual') && (
            <button 
              className="btn-deny" 
              style={{ padding: '6px 12px', fontSize: '0.8rem', marginBottom: '12px', background: 'transparent', border: '1px solid var(--color-error-primary)', color: 'var(--color-error-primary)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
              onClick={() => forgetWorkstation(activeWorkstation.id)}
            >
              Forget this saved workstation
            </button>
          )}

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px', borderTop: '1px solid var(--color-border-subtle)', paddingTop: '12px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>Add via IP:</span>
            <input 
              placeholder="e.g. 192.168.1.100" 
              className="input-box" 
              style={{ flex: 1, padding: '8px' }} 
              value={manualIp}
              onChange={e => setManualIp(e.target.value)}
            />
            <button 
              className="btn-primary"
              style={{ padding: '8px 12px' }}
              onClick={() => {
                const ipInput = manualIp.trim();
                if (ipInput) {
                  addManualWorkstation(ipInput, 3000);
                  setActiveWorkstation(`${ipInput}:3000`);
                  setManualIp('');
                }
              }}
            >
              Add
            </button>
          </div>
        </div>

        <hr style={{ margin: '24px 0', borderColor: 'var(--color-border-subtle)', opacity: 0.5 }} />
        
        <div>
          <h4 style={{ marginBottom: '12px', color: 'var(--color-text-secondary)' }}>Connect via Cloud Relay</h4>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '12px' }}>Enter the Tunnel ID and PIN from the target workstation.</p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <input 
              type="text" 
              placeholder="Tunnel ID" 
              className="input-box" 
              style={{ flex: '1 1 120px', padding: '12px' }}
              value={tunnelId}
              onChange={e => setTunnelId(e.target.value)}
            />
            <input 
              type="text" 
              placeholder="PIN" 
              className="input-box" 
              style={{ flex: '1 1 80px', padding: '12px' }}
              value={remotePin}
              onChange={e => setRemotePin(e.target.value)}
              maxLength={6}
            />
            <button 
              className="btn-primary" 
              style={{ flex: '1 1 100px', padding: '12px' }}
              onClick={() => {
                const val = tunnelId.trim().toUpperCase();
                if (val) {
                  onConnectRemote(val, remotePin);
                }
              }}
            >
              Connect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
