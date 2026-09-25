import React from 'react';
import type { ViewType } from '../stores/useViewStore';
import {
  IconMessage,
  IconTerminal,
  IconGitBranch,
  IconSettings,
  IconStar,
  IconAlertTriangle
} from '../components/icons/Icons';
import { CustomDropdown } from '../components/CustomDropdown';
import { ThreadSandboxStatus } from '../components/delegation/DelegationStatus';

/**
 * The views a thread opens with. Five, on purpose: everything a first session
 * needs is here, and the rest lives under "More" so the strip never overflows
 * at laptop widths. Team and pipeline views are frozen prototypes and are not
 * offered at all; their routes still resolve for anyone who has a URL.
 */
const PRIMARY_VIEWS: { id: ViewType; label: string; icon: typeof IconMessage }[] = [
  { id: 'chat', label: 'Chat', icon: IconMessage },
  { id: 'terminal', label: 'Terminal', icon: IconTerminal },
  { id: 'changes', label: 'Changes', icon: IconGitBranch },
  { id: 'memory', label: 'Memory', icon: IconStar },
  { id: 'settings', label: 'Settings', icon: IconSettings }
];

const MORE_VIEWS: { id: ViewType; label: string }[] = [
  { id: 'mcp', label: 'MCP servers' },
  { id: 'skills', label: 'Skills' },
  { id: 'environment', label: 'Environment' }
];

export interface ViewTabsProps {
  activeTab: ViewType;
  onSelectTab: (view: ViewType) => void;
  activeThreadId: string | null;
  connected: boolean;
  hasMessages: boolean;
  onOpenDelegateModal?: () => void;
  onClearChat?: () => void;
}

export function ViewTabs({
  activeTab,
  onSelectTab,
  activeThreadId,
  connected,
  hasMessages,
  onOpenDelegateModal,
  onClearChat
}: ViewTabsProps) {
  return (
    <>
      <div className="view-navigation">
        <div className="view-navigation-tabs">
          {PRIMARY_VIEWS.map(view => {
            const Icon = view.icon;
            return (
              <button
                key={view.id}
                className={`view-tab ${activeTab === view.id ? 'active' : ''}`}
                onClick={() => onSelectTab(view.id)}
              >
                <Icon size={15} />
                <span>{view.label}</span>
              </button>
            );
          })}
          <div className="view-tab-more">
            <CustomDropdown
              value={MORE_VIEWS.some(v => v.id === activeTab) ? activeTab : '__more'}
              onChange={(val: string) => {
                if (val !== '__more') onSelectTab(val as ViewType);
              }}
              options={[
                { value: '__more', label: 'More' },
                ...MORE_VIEWS.map(v => ({ value: v.id, label: v.label }))
              ]}
            />
          </div>
        </div>

        <div className="view-navigation-actions">
          {/* Whether this thread's work is going into a sandbox rather than the
              operator's checkout, and what the project's own checks last said
              about it (P8-03). */}
          {activeTab === 'chat' && activeThreadId && <ThreadSandboxStatus />}
          {activeTab === 'chat' && activeThreadId && onOpenDelegateModal && (
            <button
              onClick={onOpenDelegateModal}
              title="Hand this thread's work to another role, or ask for a review"
              className="view-delegate-btn"
            >
              <IconGitBranch size={13} /> Delegate
            </button>
          )}
          {activeTab === 'chat' && hasMessages && onClearChat && (
            <button className="clear-chat-btn" onClick={onClearChat} title="Clear Chat History">
              Clear chat
            </button>
          )}
        </div>
      </div>

      {!connected && (
        <div className="offline-banner">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <IconAlertTriangle size={16} /> Disconnected from Workstation. Operating in offline mode.
          </span>
        </div>
      )}
    </>
  );
}
