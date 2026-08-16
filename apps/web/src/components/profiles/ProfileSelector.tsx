import React, { useEffect } from 'react';
import type { AgentProfile } from '@asterim/shared';
import { activeProfileFor, useProfileStore } from '../../stores/useProfileStore';
import { useThreadStore } from '../../stores/useThreadStore';
import { ProfileManagerModal } from './ProfileManagerModal';
import { IconChevronDown, IconSettings, IconShield } from '../icons/Icons';

/**
 * The active agent profile for a thread, and a way to change it.
 *
 * A pill rather than a settings page, because the choice is per thread and
 * changes often: the same project gets an implementer in one thread and a
 * reviewer in the next. It says which persona the next session will start
 * under, which is not always the one the running session started under — an
 * agent already mid-conversation keeps the prompt it was opened with, and
 * pretending otherwise would be the more confusing lie.
 *
 * "Default" is a real option, not an empty state. A thread with no profile runs
 * exactly as every thread did before profiles existed, and a user who tried one
 * and wants out needs a way back.
 */

/** How a built-in is distinguished from something the user wrote. */
export function originTone(profile: AgentProfile): { label: string; color: string; background: string } {
  return profile.isBuiltin
    ? {
        label: 'Built-in',
        color: 'var(--color-text-secondary)',
        background: 'rgba(148, 163, 184, 0.12)'
      }
    : {
        label: 'Custom',
        color: 'var(--color-state-working)',
        background: 'var(--color-state-working-bg)'
      };
}

/**
 * The line under the pill.
 *
 * Names the role rather than repeating the profile's name: the two are usually
 * the same for a built-in and usually different for a clone, and the role is
 * the half that says what the agent will actually do.
 */
export function selectorSummary(profile: AgentProfile | null): string {
  if (!profile) return 'No profile — the agent starts with its default instructions.';
  return profile.role;
}

const badge: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: '999px',
  fontSize: 'var(--font-size-xs, 11px)',
  fontWeight: 600,
  whiteSpace: 'nowrap'
};

export interface ProfileSelectorViewProps {
  profiles: AgentProfile[];
  activeProfile: AgentProfile | null;
  onSelect: (profileId: string | null) => void;
  onManage: () => void;
  isLoading?: boolean;
  error?: string | null;
  /** Whether the manager modal is open. Exposed so a render test can reach it. */
  isManagerOpen?: boolean;
  /** Disabled when there is no thread to configure. */
  disabled?: boolean;
}

/**
 * The selector's presentation, driven entirely by props.
 *
 * Separated from the store-connected container for the same reason as the MCP
 * registry and the Skills Explorer: zustand v5 serves its initial state as the
 * server snapshot, so a store-reading component renders empty under
 * `react-dom/server` and could not be tested at all.
 */
export function ProfileSelectorView({
  profiles,
  activeProfile,
  onSelect,
  onManage,
  isLoading = false,
  error = null,
  isManagerOpen = false,
  disabled = false
}: ProfileSelectorViewProps) {
  const tone = activeProfile ? originTone(activeProfile) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)' }}>
      <div
        style={{
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-text-muted)',
          fontWeight: 'var(--font-weight-semibold)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em'
        }}
      >
        Agent Profile
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-1)' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <select
            aria-label="Agent profile"
            value={activeProfile?.id ?? ''}
            disabled={disabled || isLoading}
            onChange={event => onSelect(event.target.value || null)}
            style={{
              width: '100%',
              appearance: 'none',
              padding: '6px 24px 6px 8px',
              fontSize: 'var(--font-size-xs)',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-primary)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              outline: 'none',
              boxSizing: 'border-box',
              textOverflow: 'ellipsis'
            }}
          >
            <option value="">Default (no profile)</option>
            {profiles.map(profile => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <div
            style={{
              position: 'absolute',
              right: '7px',
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
              opacity: 0.6
            }}
          >
            <IconChevronDown size={11} />
          </div>
        </div>

        <button
          onClick={onManage}
          aria-label="Manage agent profiles"
          title="Manage agent profiles"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            flexShrink: 0,
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            transition: 'background 0.15s, color 0.15s'
          }}
        >
          <IconSettings size={13} />
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-1)',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-text-secondary)',
          minWidth: 0
        }}
      >
        {activeProfile && (
          <IconShield size={11} style={{ flexShrink: 0, color: 'var(--color-accent-primary)' }} />
        )}
        <span
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
        >
          {selectorSummary(activeProfile)}
        </span>
        {tone && (
          <span style={{ ...badge, color: tone.color, background: tone.background }}>{tone.label}</span>
        )}
      </div>

      {activeProfile && (
        <p style={{ margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          Applies to the next session this thread starts.
        </p>
      )}

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-state-error)' }}>
          {error}
        </p>
      )}

      {isManagerOpen && <ProfileManagerModal onClose={onManage} />}
    </div>
  );
}

/** Store-connected selector, scoped to the thread that is open. */
export function ProfileSelector({ workspaceId }: { workspaceId?: string | null } = {}) {
  const activeThreadId = useThreadStore(state => state.activeThreadId);
  const profiles = useProfileStore(state => state.profiles);
  const activeByThread = useProfileStore(state => state.activeByThread);
  const isLoading = useProfileStore(state => state.isLoading);
  const error = useProfileStore(state => state.error);
  const loadProfiles = useProfileStore(state => state.loadProfiles);
  const setActiveProfile = useProfileStore(state => state.setActiveProfile);

  const [isManagerOpen, setManagerOpen] = React.useState(false);

  useEffect(() => {
    void loadProfiles(workspaceId || undefined);
  }, [workspaceId, loadProfiles]);

  return (
    <ProfileSelectorView
      profiles={profiles}
      activeProfile={activeProfileFor(profiles, activeByThread, activeThreadId)}
      onSelect={profileId => {
        if (activeThreadId) setActiveProfile(activeThreadId, profileId);
      }}
      onManage={() => setManagerOpen(open => !open)}
      isLoading={isLoading}
      error={error}
      isManagerOpen={isManagerOpen}
      disabled={!activeThreadId}
    />
  );
}
