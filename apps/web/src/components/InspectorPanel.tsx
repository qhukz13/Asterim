import React, { useState } from 'react';
import { useInspectorStore } from '../stores/useInspectorStore';
import { usePanelStore } from '../stores/usePanelStore';
import { useThreadStore } from '../stores/useThreadStore';
import { ContextView } from './workspace/ContextView';
import { useDebugLifecycle } from '../utils/debug';

function InspectorSection({ title, subtitle, actions, children, defaultOpen = true }: { title: string, subtitle?: React.ReactNode, actions?: React.ReactNode, children: React.ReactNode, defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
      <div 
        style={{
          padding: '8px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} onClick={() => setIsOpen(!isOpen)}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', cursor: 'pointer' }}>{title}</span>
          {subtitle && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{subtitle}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {actions}
          <span onClick={() => setIsOpen(!isOpen)} style={{ fontSize: '0.65rem', color: 'var(--text-muted)', cursor: 'pointer' }}>{isOpen ? '▼' : '▶'}</span>
        </div>
      </div>
      {isOpen && (
        <div style={{ padding: '0 16px 16px 16px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function InspectorPanel({ socket, activeBackendUrl, projectId, activeTab }: any) {
  useDebugLifecycle('InspectorPanel', { projectId, activeTab });
  const currentSelection = useInspectorStore(s => s.currentSelection);
  const isCollapsed = usePanelStore(s => s.isInspectorCollapsed);
  const toggleCollapse = () => usePanelStore.getState().togglePanel('inspector');
  const width = usePanelStore(s => s.inspectorWidth);
  const setWidth = usePanelStore(s => s.setPanelWidth);
  const activeThreadId = useThreadStore(s => s.activeThreadId);

  const handleDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(200, Math.min(600, startWidth + delta));
      setWidth('inspector', newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <aside 
      className="workspace-inspector-panel" 
      style={{ 
        width: isCollapsed ? '48px' : `${width}px`, 
        borderLeft: '1px solid rgba(255, 255, 255, 0.05)', 
        background: 'var(--bg-app)', 
        display: 'flex', 
        flexDirection: 'column',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      {!isCollapsed && (
        <div 
          onMouseDown={handleDrag}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '4px',
            cursor: 'col-resize',
            zIndex: 10,
            background: 'transparent'
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        />
      )}
      <div style={{ 
        padding: '16px', 
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)', 
        display: 'flex',
        alignItems: 'center',
        justifyContent: isCollapsed ? 'center' : 'space-between'
      }}>
        {!isCollapsed && <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Inspector</span>}
        <button 
          onClick={toggleCollapse}
          style={{ 
            background: 'transparent', 
            border: 'none', 
            color: 'var(--text-secondary)', 
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '4px'
          }}
          title={isCollapsed ? "Expand Inspector" : "Collapse Inspector"}
        >
          {isCollapsed ? '◀' : '▶'}
        </button>
      </div>
      
      {!isCollapsed && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          
          {activeTab === 'chat' && (
            <>
              <InspectorSection title="Mission" defaultOpen={true}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500, lineHeight: 1.4 }}>
                  No mission extracted yet. Use the Working Set to extract one.
                </div>
              </InspectorSection>

              <InspectorSection 
                title="Working Set" 
                defaultOpen={false}
                subtitle={activeThreadId ? "(3 files pinned)" : ""}
                actions={
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem' }} title="Add File">➕</button>
                    <button style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem' }} title="Suggest Files">✨</button>
                  </div>
                }
              >
                {activeThreadId ? (
                  <div style={{ margin: '0 -16px -16px -16px', maxHeight: '400px', overflowY: 'auto' }}>
                    <ContextView 
                      socket={socket}
                      projectId={projectId} 
                      threadId={activeThreadId} 
                      activeBackendUrl={activeBackendUrl} 
                    />
                  </div>
                ) : (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    No active thread.
                  </div>
                )}
              </InspectorSection>

              <InspectorSection title="Active Execution" defaultOpen={false}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  (Execution status and AI Metadata will be displayed here)
                </div>
              </InspectorSection>
            </>
          )}

          {activeTab === 'changes' && (
            <>
              <InspectorSection title="Selected File" defaultOpen={currentSelection.type === 'file'}>
                {currentSelection.type === 'file' ? (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                    <div style={{ fontFamily: 'monospace' }}>{currentSelection.id}</div>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Select a file in the diff viewer.
                  </div>
                )}
              </InspectorSection>

              <InspectorSection title="Git Summary" defaultOpen={true}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  (Git metadata will be displayed here)
                </div>
              </InspectorSection>

              <InspectorSection title="AI Review" defaultOpen={true}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  (AI Review feedback will be displayed here)
                </div>
              </InspectorSection>
            </>
          )}

          {activeTab === 'terminal' && (
            <>
              <InspectorSection title="Active Execution" defaultOpen={true}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  (Execution status and AI Metadata will be displayed here)
                </div>
              </InspectorSection>

              <InspectorSection title="Process Information" defaultOpen={true}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  (Process tree and system resources)
                </div>
              </InspectorSection>

              <InspectorSection title="Logs" defaultOpen={false}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  (Background daemon logs)
                </div>
              </InspectorSection>
            </>
          )}

        </div>
      )}
    </aside>
  );
}
