import React from 'react';
import { CustomDropdown } from '../components/CustomDropdown';
import { IconRefresh } from '../components/icons/Icons';

export interface ThreadHeaderProps {
  activeThreadId: string | null;
  threadName?: string;
  lastActivityLabel: string;
  agentStatus: string;
  agentType: 'claude' | 'antigravity';
  onAgentTypeChange: (type: 'claude' | 'antigravity') => void;
  onRestartAgent: () => void;
  isControlsDisabled?: boolean;
}

export function ThreadHeader({
  activeThreadId,
  threadName,
  lastActivityLabel,
  agentStatus,
  agentType,
  onAgentTypeChange,
  onRestartAgent,
  isControlsDisabled
}: ThreadHeaderProps) {
  const statusLabel =
    agentStatus === 'working'
      ? 'Executing'
      : agentStatus === 'waiting_approval'
        ? 'Paused for review'
        : agentStatus === 'error'
          ? 'Error'
          : 'Idle';

  const statusClass =
    agentStatus === 'working'
      ? 'working'
      : agentStatus === 'waiting_approval'
        ? 'waiting_approval'
        : agentStatus === 'error'
          ? 'error'
          : 'idle';

  return (
    <div className="thread-header">
      <div className="thread-header-meta-group">
        <div className="thread-header-title-col">
          <div className="thread-header-title">
            {activeThreadId
              ? threadName || `Thread ${activeThreadId.slice(0, 8)}`
              : 'No Active Mission'}
          </div>
          <div className="thread-header-meta">
            <span>
              {activeThreadId ? `Thread: ${activeThreadId.slice(0, 8)}` : 'Idle Workspace'}
            </span>
            {activeThreadId && lastActivityLabel && (
              <span>Last activity: {lastActivityLabel}</span>
            )}
            {agentStatus === 'waiting_approval' && (
              <span style={{ color: '#fbbf24' }}>1 Pending Approval</span>
            )}
          </div>
        </div>

        {activeThreadId && (
          <div className={`thread-status-pill ${statusClass}`}>
            {statusLabel}
          </div>
        )}
      </div>

      <div className="thread-header-controls">
        <div style={{ width: '220px' }}>
          <CustomDropdown
            value={agentType}
            onChange={(val: string) => onAgentTypeChange(val as 'claude' | 'antigravity')}
            options={[
              { value: 'claude', label: 'Claude Code' },
              { value: 'antigravity', label: 'Antigravity — preview' }
            ]}
            disabled={isControlsDisabled}
          />
        </div>
        <button
          onClick={onRestartAgent}
          className="thread-restart-btn"
          title="Restart Agent"
        >
          <IconRefresh size={14} />
        </button>
      </div>
    </div>
  );
}
