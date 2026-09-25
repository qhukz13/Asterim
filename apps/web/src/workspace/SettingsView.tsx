import React from 'react';
import { IconAlertTriangle } from '../components/icons/Icons';
import { AISettings } from '../components/AISettings';
import { DiagnosticsPanel } from '../components/diagnostics/DiagnosticsPanel';
import { UsagePanel } from '../components/usage/UsagePanel';

export interface SettingsViewProps {
  agentType: 'claude' | 'antigravity';
  setAgentType: (type: 'claude' | 'antigravity') => void;
  agentStatus: string;
  isBinaryMissing?: boolean;
  activeBackendUrl: string;
}

export function SettingsView({
  agentType,
  setAgentType,
  agentStatus,
  isBinaryMissing,
  activeBackendUrl
}: SettingsViewProps) {
  const isSelectDisabled = agentStatus !== 'idle' && agentStatus !== 'error';

  return (
    <div className="settings-view">
      <div className="settings-card glass-panel">
        <h3 style={{ marginBottom: '16px' }}>Agent Engine</h3>
        <select
          value={agentType}
          onChange={e => setAgentType(e.target.value as 'claude' | 'antigravity')}
          className="settings-select"
          disabled={isSelectDisabled}
        >
          <option value="claude">Claude Code</option>
          <option value="antigravity">Antigravity — preview</option>
        </select>
        {isBinaryMissing && (
          <div className="settings-warning-box">
            <IconAlertTriangle size={16} /> Warning: <strong>{agentType}</strong> binary not found on server PATH. Starting this agent will fail.
          </div>
        )}
      </div>
      <AISettings activeBackendUrl={activeBackendUrl} />
      <DiagnosticsPanel activeBackendUrl={activeBackendUrl} />
      <UsagePanel activeBackendUrl={activeBackendUrl} />
    </div>
  );
}
