import React from 'react';

interface TopBarProps {
  activeWorkstationName?: string;
  onConnectWorkstation?: () => void;
}

export function TopBar({ activeWorkstationName, onConnectWorkstation }: TopBarProps) {
  return (
    <header className="workspace-topbar">
      <div className="topbar-left">
        <div className="workspace-logo">Asterim</div>
      </div>
      <div className="topbar-center">
        {/* Placeholder for Future Global Search / Command Palette */}
        <div className="global-search-placeholder">
          <span className="search-icon">🔍</span>
          <span className="search-text">Search Workspace...</span>
          <span className="search-shortcut">⌘K</span>
        </div>
      </div>
      <div className="topbar-right">
        <button className="workstation-status-btn" onClick={onConnectWorkstation}>
          <span className={`status-dot ${activeWorkstationName ? 'connected' : 'disconnected'}`}></span>
          <span className="workstation-name">{activeWorkstationName || 'Local Machine'}</span>
        </button>
        <div className="user-profile">
          <div className="avatar">AD</div>
        </div>
      </div>
    </header>
  );
}
