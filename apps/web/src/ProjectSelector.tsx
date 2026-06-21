import React, { useEffect, useState } from 'react';
import { subscribeToPushNotifications } from './push';

interface Project {
  id: string;
  name: string;
  path: string;
  relayUrl?: string;
}

interface ProjectSelectorProps {
  onSelect: (project: Project) => void;
}

export function ProjectSelector({ onSelect }: ProjectSelectorProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [tunnelId, setTunnelId] = useState<string | null>(null);
  // P0-008: Store the relay URL from the server so remote connects use the correct host
  const [serverRelayUrl, setServerRelayUrl] = useState<string | undefined>(undefined);
  // P0-001: Remote connection PIN
  const [remotePin, setRemotePin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [selectedDefaultAgent, setSelectedDefaultAgent] = useState<'aider' | 'claude' | 'antigravity'>('claude');

  const fetchProjects = async () => {
    try {
      setError(null);
      const protocol = window.location.protocol;
      const hostname = window.location.hostname;
      const token = localStorage.getItem('agentdeck_token') || '';
      const headers = { 'Authorization': `Bearer ${token}` };

      const res = await fetch(`${protocol}//${hostname}:3000/api/v1/projects`, { headers });
      if (res.status === 401) {
        localStorage.removeItem('agentdeck_token');
        window.location.reload();
        return;
      }
      const data = await res.json();
      setProjects(data.projects || []);

      const sysRes = await fetch(`${protocol}//${hostname}:3000/api/v1/system`, { headers });
      if (sysRes.status === 401) {
        localStorage.removeItem('agentdeck_token');
        window.location.reload();
        return;
      }
      const sysData = await sysRes.json();
      setTunnelId(sysData.tunnelId);
      // P0-008: Store relay URL so remote connects can use the correct server
      if (sysData.relayUrl) setServerRelayUrl(sysData.relayUrl);
      if (sysData.isFirstRun) {
        setShowWizard(true);
      }
    } catch (err) {
      console.error('Failed to fetch data', err);
      setError('Failed to connect to the server. Check if the server is running on port 3000.');
    } finally {
      setLoading(false);
    }
  };

  const handleWizardComplete = async () => {
    try {
      setError(null);
      const protocol = window.location.protocol;
      const hostname = window.location.hostname;
      const token = localStorage.getItem('agentdeck_token') || '';
      
      const res = await fetch(`${protocol}//${hostname}:3000/api/v1/system/first-run-complete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        localStorage.setItem('agentdeck_default_agent', selectedDefaultAgent);
        setShowWizard(false);
      } else {
        setError('Failed to record wizard completion. Please try again.');
      }
    } catch (err) {
      console.error('Wizard complete error', err);
      setError('Failed to save settings. Connection error.');
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newPath) return;

    try {
      setIsCreating(true);
      const protocol = window.location.protocol;
      const hostname = window.location.hostname;
      const token = localStorage.getItem('agentdeck_token') || '';
      
      const res = await fetch(`${protocol}//${hostname}:3000/api/v1/projects`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ name: newName, path: newPath })
      });
      if (res.status === 401) {
        localStorage.removeItem('agentdeck_token');
        window.location.reload();
        return;
      }
      const data = await res.json();
      if (data.project) {
        setProjects([data.project, ...projects]);
        setNewName('');
        setNewPath('');
      }
    } catch (err) {
      console.error('Failed to create project', err);
    } finally {
      setIsCreating(false);
    }
  };

  if (loading) {
    return <div style={{ display: 'flex', height: '100dvh', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>;
  }

  if (showWizard) {
    return (
      <div className="project-selector-container">
        <div className="glass-panel project-selector-panel" style={{ maxWidth: '500px', textAlign: 'center', padding: '32px' }}>
          {wizardStep === 1 && (
            <div>
              <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>🚀</div>
              <h1 style={{ marginBottom: '16px', fontSize: '2rem', background: 'linear-gradient(135deg, var(--accent-color), var(--accent-hover))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Welcome to AgentDeck</h1>
              <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '32px' }}>
                Your local-first control plane for AI coding agents is ready. Let's customize your environment in just two quick steps.
              </p>
              <button onClick={() => setWizardStep(2)} className="btn-primary" style={{ padding: '14px 28px', width: '100%', fontSize: '1rem' }}>
                Get Started
              </button>
            </div>
          )}

          {wizardStep === 2 && (
            <div>
              <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>⚙️</div>
              <h2 style={{ marginBottom: '12px' }}>Choose Default Agent</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '24px' }}>
                Select the AI engine you'd like to use by default. You can change this anytime from the sidebar.
              </p>
              
              <div style={{ display: 'flex', gap: '12px', marginBottom: '32px' }}>
                <div 
                  onClick={() => setSelectedDefaultAgent('claude')}
                  style={{
                    flex: 1,
                    padding: '16px 8px',
                    background: selectedDefaultAgent === 'claude' ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(0,0,0,0.2)',
                    border: selectedDefaultAgent === 'claude' ? '2px solid var(--accent-color)' : '1px solid var(--panel-border)',
                    borderRadius: '16px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>🤖</div>
                  <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '0.9rem' }}>Claude Code</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Anthropic CLI agent</div>
                </div>
                
                <div 
                  onClick={() => setSelectedDefaultAgent('aider')}
                  style={{
                    flex: 1,
                    padding: '16px 8px',
                    background: selectedDefaultAgent === 'aider' ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(0,0,0,0.2)',
                    border: selectedDefaultAgent === 'aider' ? '2px solid var(--accent-color)' : '1px solid var(--panel-border)',
                    borderRadius: '16px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>🐍</div>
                  <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '0.9rem' }}>Aider</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Python Git agent</div>
                </div>

                <div 
                  onClick={() => setSelectedDefaultAgent('antigravity')}
                  style={{
                    flex: 1,
                    padding: '16px 8px',
                    background: selectedDefaultAgent === 'antigravity' ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(0,0,0,0.2)',
                    border: selectedDefaultAgent === 'antigravity' ? '2px solid var(--accent-color)' : '1px solid var(--panel-border)',
                    borderRadius: '16px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>🛸</div>
                  <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '0.9rem' }}>Antigravity</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Google AI agent</div>
                </div>
              </div>
              
              <button onClick={() => setWizardStep(3)} className="btn-primary" style={{ padding: '14px 28px', width: '100%' }}>
                Next Step
              </button>
            </div>
          )}

          {wizardStep === 3 && (
            <div>
              <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>✨</div>
              <h2 style={{ marginBottom: '16px' }}>Ready to Launch</h2>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.6', marginBottom: '28px', textAlign: 'left' }}>
                Here are a few quick tips to get started:
                <br /><br />
                • 💻 <strong>Real-time Telemetry</strong>: Watch command execution streams in the terminal dashboard.
                <br /><br />
                • 🛡️ <strong>Interactive Approvals</strong>: Review high-impact commands and local workspace diffs before execution.
                <br /><br />
                • 📱 <strong>Mobile Control</strong>: Scan the console QR code to control code edits directly from your phone.
              </div>
              
              <button onClick={handleWizardComplete} className="btn-primary" style={{ padding: '14px 28px', width: '100%', background: 'var(--success-color)' }}>
                Go to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="project-selector-container">
      <div className="glass-panel project-selector-panel">
        <div className="project-selector-header">
          <h1 style={{ margin: 0 }}>Select a Project</h1>
          <button onClick={() => subscribeToPushNotifications(localStorage.getItem('agentdeck_token') || '')} className="btn-primary" style={{ padding: '8px 12px', fontSize: '0.8rem', background: 'var(--success-color)' }}>
            🔔 Enable Push
          </button>
        </div>

        {error && (
          <div style={{ 
            padding: '16px', 
            background: 'rgba(239, 68, 68, 0.15)', 
            border: '1px solid var(--error-color)', 
            borderRadius: '8px', 
            color: 'var(--error-color)',
            marginBottom: '20px',
            fontSize: '0.9rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            <div>{error}</div>
            <button 
              onClick={() => {
                localStorage.removeItem('agentdeck_token');
                window.location.reload();
              }}
              className="btn-deny"
              style={{ padding: '8px 12px', fontSize: '0.8rem', alignSelf: 'flex-start' }}
            >
              Clear Session & Re-pair
            </button>
          </div>
        )}
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '40vh', overflowY: 'auto', paddingRight: '8px' }}>
          {projects.length === 0 ? (
            <div style={{ textAlign: 'center', opacity: 0.5, padding: '20px' }}>No projects found. Create one below.</div>
          ) : (
            projects.map(p => (
              <div 
                key={p.id} 
                onClick={() => onSelect(p)}
                style={{ 
                  padding: '16px', 
                  background: 'rgba(0,0,0,0.3)', 
                  borderRadius: '12px', 
                  cursor: 'pointer',
                  border: '1px solid var(--panel-border)',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => (e.currentTarget.style.borderColor = 'var(--accent-color)')}
                onMouseOut={(e) => (e.currentTarget.style.borderColor = 'var(--panel-border)')}
              >
                <div style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '4px' }}>{p.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{p.path}</div>
              </div>
            ))
          )}
        </div>

        <hr style={{ margin: '32px 0', borderColor: 'var(--panel-border)', opacity: 0.5 }} />

        <h3>Add New Project</h3>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
          <input 
            type="text" 
            placeholder="Project Name (e.g. NextJS App)" 
            className="input-box" 
            value={newName}
            onChange={e => setNewName(e.target.value)}
            required
          />
          <input 
            type="text" 
            placeholder="Absolute Path (e.g. C:\Projects\MyApp)" 
            className="input-box" 
            value={newPath}
            onChange={e => setNewPath(e.target.value)}
            required
          />
          <button type="submit" className="btn-primary" style={{ padding: '12px', width: '100%' }} disabled={isCreating}>
            {isCreating ? 'Adding...' : 'Add Project'}
          </button>
        </form>

        <hr style={{ margin: '32px 0', borderColor: 'var(--panel-border)', opacity: 0.5 }} />
        
        <h3>Connect Remotely</h3>
        <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
          <input 
            id="tunnelInput"
            type="text" 
            placeholder="Tunnel ID" 
            className="input-box" 
            style={{ flex: '1 1 120px' }}
          />
          <input 
            type="text" 
            placeholder="PIN" 
            className="input-box" 
            style={{ flex: '1 1 80px' }}
            value={remotePin}
            onChange={e => setRemotePin(e.target.value)}
            maxLength={6}
          />
          <button 
            className="btn-primary" 
            style={{ flex: '1 1 100px' }}
            onClick={() => {
              const val = (document.getElementById('tunnelInput') as HTMLInputElement).value.trim().toUpperCase();
              if (val) {
                // If entering via remote, they must provide the PIN here so we can authenticate over the tunnel
                if (remotePin) {
                  localStorage.setItem('agentdeck_remote_pin', remotePin);
                }
                onSelect({
                  id: val,
                  name: 'Remote Session',
                  path: 'Cloud Relay',
                  relayUrl: serverRelayUrl,
                });
              }
            }}
          >
            Connect
          </button>
        </div>

        {tunnelId && (
          <div style={{ marginTop: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: '0.85rem', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>Your Local Tunnel ID</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', letterSpacing: '2px', color: 'var(--accent-color)' }}>{tunnelId}</div>
            <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>Use this ID to connect from your mobile device.</div>
          </div>
        )}
      </div>
    </div>
  );
}
