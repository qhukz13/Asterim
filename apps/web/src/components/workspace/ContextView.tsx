import React from 'react';

export function ContextView() {
  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '32px', height: '100%', boxSizing: 'border-box', overflowY: 'auto' }}>
      
      {/* Top Header / Mission */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Current Mission</h2>
        <div className="glass-panel" style={{ padding: '16px', background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '6px' }}>
          <div style={{ color: '#60a5fa', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>✨</span>
            <span style={{ fontWeight: 500 }}>Active task: Implement Git subsystem and redesign Context/Changes UI.</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', flex: 1, minHeight: 0 }}>
        {/* Main Context Column */}
        <div style={{ flex: '0 0 65%', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', margin: 0 }}>
                Pinned & Active Context
              </h3>
              <button 
                style={{ background: 'transparent', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '4px', cursor: 'pointer', padding: '4px 12px', fontSize: '0.8rem', color: '#60a5fa' }}
                onClick={() => alert("AI Context Suggestion will be available soon.")}
              >
                ✨ Suggest Files
              </button>
            </div>
            
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                <span style={{ fontSize: '1.1rem' }}>📄</span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>App.tsx</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>apps/web/src/</span>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--warning-color)', padding: '2px 6px', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '4px' }}>Modified</span>
                  <button style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>×</button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px', borderRadius: '4px' }}>
                <span style={{ fontSize: '1.1rem' }}>📄</span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>WORKSPACE.md</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>blueprint/</span>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>Read-only</span>
                  <button style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>×</button>
                </div>
              </div>
            </div>
          </div>
          
        </div>

        {/* Sidebar Context Column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', margin: 0, marginBottom: '4px' }}>
              Actions
            </h3>
            <button 
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--panel-border)', borderRadius: '6px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '10px 12px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}
              onClick={() => alert("Browse Project modal will open here.")}
            >
              <span style={{ opacity: 0.7, fontSize: '1rem' }}>🔍</span> Browse Project... <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: '0.75rem' }}>Cmd+K</span>
            </button>
            <button 
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--panel-border)', borderRadius: '6px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '10px 12px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}
              onClick={() => alert("Manual context addition will open here.")}
            >
              <span style={{ opacity: 0.7, fontSize: '1rem' }}>➕</span> Add File to Context
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
              Related Knowledge
            </h3>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '12px', border: '1px dashed var(--panel-border)', borderRadius: '6px', textAlign: 'center' }}>
              No related PRs or documentation found for this context.
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
