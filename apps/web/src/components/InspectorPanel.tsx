import React, { useState } from 'react';
import { useInspectorStore } from '../stores/useInspectorStore';
import { usePanelStore } from '../stores/usePanelStore';
import { useThreadStore } from '../stores/useThreadStore';
import { ContextView } from './workspace/ContextView';
import { useDebugLifecycle } from '../utils/debug';

interface InspectorSectionProps {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function InspectorSection({
  title,
  subtitle,
  actions,
  children,
  defaultOpen = true
}: InspectorSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
      <div
        style={{
          padding: 'var(--spacing-2) var(--spacing-3)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none',
          background: 'var(--color-surface-1)'
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', cursor: 'pointer' }}
          onClick={() => setIsOpen(!isOpen)}
        >
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}
          >
            {title}
          </span>
          {subtitle && (
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              {subtitle}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
          {actions}
          <span
            onClick={() => setIsOpen(!isOpen)}
            style={{ fontSize: '10px', color: 'var(--color-text-muted)', cursor: 'pointer' }}
          >
            {isOpen ? '▼' : '▶'}
          </span>
        </div>
      </div>
      {isOpen && <div style={{ padding: 'var(--spacing-3)', background: 'var(--color-surface-0)' }}>{children}</div>}
    </div>
  );
}

export function InspectorPanel({
  socket,
  activeBackendUrl,
  projectId,
  agentStatus = 'idle',
  agentType = 'Claude Code',
  approvalRequest
}: any) {
  useDebugLifecycle('InspectorPanel', { projectId, agentStatus });
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
      const newWidth = Math.max(200, Math.min(500, startWidth + delta));
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
        width: isCollapsed ? '40px' : `${width}px`,
        borderLeft: '1px solid var(--color-border-subtle)',
        background: 'var(--color-surface-0)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.15s ease',
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
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-border-subtle)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        />
      )}

      {/* Header */}
      <div
        style={{
          padding: 'var(--spacing-2) var(--spacing-3)',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          height: 'var(--nav-height)',
          background: 'var(--color-surface-1)'
        }}
      >
        {!isCollapsed && (
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}
          >
            AI Context & State
          </span>
        )}
        <button
          onClick={toggleCollapse}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            padding: '2px 4px',
            fontSize: 'var(--font-size-xs)',
            borderRadius: 'var(--radius-sm)'
          }}
          title={isCollapsed ? 'Expand Inspector' : 'Collapse Inspector'}
        >
          {isCollapsed ? '◀' : '▶'}
        </button>
      </div>

      {!isCollapsed && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* Section 1: What is the Agent Currently Doing? */}
          <InspectorSection title="Agent Activity" defaultOpen={true}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Runtime:</span>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-primary)', fontWeight: 'var(--font-weight-medium)' }}>
                  {agentType || 'Claude Code'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Execution State:</span>
                <span
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color:
                      agentStatus === 'working'
                        ? 'var(--color-state-working)'
                        : agentStatus === 'paused' || approvalRequest
                        ? 'var(--color-state-paused)'
                        : 'var(--color-state-completed)'
                  }}
                >
                  {approvalRequest
                    ? '⚠️ Action Required'
                    : agentStatus === 'working'
                    ? '⚡ Computing'
                    : '✓ Ready / Idle'}
                </span>
              </div>
            </div>
          </InspectorSection>

          {/* Section 2: Pending Approvals & Mutations (Renders ONLY when active) */}
          {approvalRequest && (
            <InspectorSection title="Pending Action Review" defaultOpen={true}>
              <div
                style={{
                  background: 'var(--color-state-paused-bg)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  padding: 'var(--spacing-3)',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--spacing-2)'
                }}
              >
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-state-paused)', fontWeight: 'var(--font-weight-semibold)' }}>
                  ⚠️ {approvalRequest.description || 'Permission requested for shell action'}
                </div>
                {approvalRequest.command && (
                  <div
                    style={{
                      fontFamily: 'var(--font-family-mono)',
                      fontSize: 'var(--font-size-xs)',
                      background: 'var(--color-surface-0)',
                      padding: 'var(--spacing-2)',
                      borderRadius: 'var(--radius-xs)',
                      color: 'var(--color-text-primary)',
                      overflowX: 'auto',
                      border: '1px solid var(--color-border-subtle)'
                    }}
                  >
                    {approvalRequest.command}
                  </div>
                )}
              </div>
            </InspectorSection>
          )}

          {/* Section 3: What does the agent know? (Attached Working Set & Pinned Files) */}
          <InspectorSection
            title="Attached Context"
            defaultOpen={true}
            subtitle={activeThreadId ? '(Working Set)' : ''}
          >
            {activeThreadId ? (
              <div style={{ margin: 'calc(var(--spacing-3) * -1)' }}>
                <ContextView
                  socket={socket}
                  projectId={projectId}
                  threadId={activeThreadId}
                  activeBackendUrl={activeBackendUrl}
                />
              </div>
            ) : (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                Select an active thread to inspect attached context files and workspace rules.
              </div>
            )}
          </InspectorSection>
        </div>
      )}
    </aside>
  );
}
