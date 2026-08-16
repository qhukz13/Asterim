import React, { useState } from 'react';
import type { AgentProfile, CreateProfileInput } from '@asterim/shared';
import { capabilitySummary, filterProfiles, useProfileStore } from '../../stores/useProfileStore';
import { originTone } from './ProfileSelector';
import { IconSearch } from '../icons/Icons';

/**
 * The profile catalogue, in full.
 *
 * Two panes: every profile on the left, and on the right either the selected
 * one or a form. A built-in opens read-only with its whole system prompt
 * visible and a Clone button — reading the prompt is the point, since the
 * difference between the six roles is entirely in that text, and a user
 * choosing between them has nothing else to go on.
 *
 * A custom profile opens as a form over the same fields. Deleting is here
 * rather than on the list so it cannot be hit while scanning.
 */

/** Which of the three states a capability list is in. */
export type ListMode = 'all' | 'none' | 'list';

/** The mode a stored list corresponds to. */
export function listModeOf(list: string[] | undefined): ListMode {
  if (list === undefined) return 'all';
  if (list.some(entry => entry === '*')) return 'all';
  if (list.length === 0) return 'none';
  return 'list';
}

/** A mode and its text back into the value the contract expects. */
export function parseListInput(mode: ListMode, text: string): string[] | undefined {
  if (mode === 'all') return undefined;
  if (mode === 'none') return [];
  return text
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

/** The editable shape of a profile, as the form holds it. */
export interface ProfileDraft {
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  model: string;
  temperature: string;
  mcpMode: ListMode;
  mcpText: string;
  skillMode: ListMode;
  skillText: string;
  approvalText: string;
}

export function emptyDraft(): ProfileDraft {
  return {
    name: '',
    role: '',
    description: '',
    systemPrompt: '',
    model: '',
    temperature: '',
    mcpMode: 'all',
    mcpText: '',
    skillMode: 'all',
    skillText: '',
    approvalText: ''
  };
}

/** A profile as a draft, for editing or for pre-filling a clone. */
export function draftFromProfile(profile: AgentProfile): ProfileDraft {
  const mcpMode = listModeOf(profile.enabledMcpServers);
  const skillMode = listModeOf(profile.enabledSkills);
  return {
    name: profile.name,
    role: profile.role,
    description: profile.description,
    systemPrompt: profile.systemPrompt,
    model: profile.model ?? '',
    temperature: profile.temperature === undefined ? '' : String(profile.temperature),
    mcpMode,
    mcpText: mcpMode === 'list' ? (profile.enabledMcpServers || []).join(', ') : '',
    skillMode,
    skillText: skillMode === 'list' ? (profile.enabledSkills || []).join(', ') : '',
    approvalText: (profile.autoApprovalRules || []).join(', ')
  };
}

/**
 * The first thing wrong with a draft, or null.
 *
 * Checked here as well as on the Core, because a round trip to be told the name
 * is empty is a worse way to learn it. The Core's copy is the one that counts;
 * this one only saves the trip.
 */
export function validateDraft(draft: ProfileDraft): string | null {
  if (!draft.name.trim()) return 'A name is required.';
  if (!draft.role.trim()) return 'A role is required.';
  if (!draft.description.trim()) return 'A description is required.';
  if (!draft.systemPrompt.trim()) return 'A system prompt is required.';
  if (draft.temperature.trim()) {
    const value = Number(draft.temperature);
    if (!Number.isFinite(value)) return 'Temperature must be a number.';
    if (value < 0 || value > 2) return 'Temperature must be between 0 and 2.';
  }
  return null;
}

/** A validated draft as the payload the Core accepts. */
export function draftToInput(draft: ProfileDraft): CreateProfileInput {
  const temperature = draft.temperature.trim() ? Number(draft.temperature) : undefined;
  return {
    name: draft.name.trim(),
    role: draft.role.trim(),
    description: draft.description.trim(),
    systemPrompt: draft.systemPrompt.trim(),
    model: draft.model.trim() || undefined,
    temperature,
    enabledMcpServers: parseListInput(draft.mcpMode, draft.mcpText),
    enabledSkills: parseListInput(draft.skillMode, draft.skillText),
    autoApprovalRules: draft.approvalText
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean)
  };
}

const field: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '0.82rem',
  background: 'var(--color-surface-1)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-primary)',
  outline: 'none',
  boxSizing: 'border-box'
};

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 'var(--font-size-xs, 11px)',
  color: 'var(--color-text-muted)',
  marginBottom: '3px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em'
};

const badge: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: '999px',
  fontSize: 'var(--font-size-xs, 11px)',
  fontWeight: 600,
  whiteSpace: 'nowrap'
};

const button = (primary: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  fontSize: '0.8rem',
  fontWeight: 600,
  background: primary ? 'var(--color-accent-primary)' : 'var(--color-surface-2)',
  color: primary ? 'var(--color-text-contrast)' : 'var(--color-text-secondary)',
  border: primary ? 'none' : '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer'
});

function Labelled({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div>
      <span style={label}>{text}</span>
      {children}
    </div>
  );
}

/** The tri-state control for one capability list. */
function CapabilityField({
  text,
  mode,
  onMode,
  value,
  onValue,
  placeholder
}: {
  text: string;
  mode: ListMode;
  onMode: (mode: ListMode) => void;
  value: string;
  onValue: (value: string) => void;
  placeholder: string;
}) {
  return (
    <Labelled text={text}>
      <div style={{ display: 'flex', gap: '6px' }}>
        <select
          aria-label={`${text} access`}
          value={mode}
          onChange={event => onMode(event.target.value as ListMode)}
          style={{ ...field, width: '110px', flexShrink: 0 }}
        >
          <option value="all">All</option>
          <option value="none">None</option>
          <option value="list">Only these</option>
        </select>
        {mode === 'list' && (
          <input
            aria-label={`${text} names`}
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={event => onValue(event.target.value)}
            style={field}
          />
        )}
      </div>
    </Labelled>
  );
}

export interface ProfileManagerModalViewProps {
  profiles: AgentProfile[];
  search: string;
  onSearch: (search: string) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
  /** The draft being edited or created, if the right pane is a form. */
  draft?: ProfileDraft | null;
  onDraftChange?: (draft: ProfileDraft) => void;
  onStartCreate?: () => void;
  onClone?: (id: string) => void;
  onSave?: () => void;
  onDelete?: (id: string) => void;
  onCancelDraft?: () => void;
  isLoading?: boolean;
  isSaving?: boolean;
  error?: string | null;
}

/** The manager's presentation, driven entirely by props. */
export function ProfileManagerModalView({
  profiles,
  search,
  onSearch,
  selectedId,
  onSelect,
  onClose,
  draft = null,
  onDraftChange,
  onStartCreate,
  onClone,
  onSave,
  onDelete,
  onCancelDraft,
  isLoading = false,
  isSaving = false,
  error = null
}: ProfileManagerModalViewProps) {
  const visible = filterProfiles(profiles, search);
  const selected = profiles.find(profile => profile.id === selectedId) || null;
  const patch = (changes: Partial<ProfileDraft>) => {
    if (draft && onDraftChange) onDraftChange({ ...draft, ...changes });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Agent profiles"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '24px'
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: 'min(940px, 100%)',
          height: 'min(640px, 100%)',
          background: 'var(--color-surface-0, #101014)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 'var(--radius-md, 8px)',
          overflow: 'hidden'
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-border-subtle)'
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '1rem', color: 'var(--color-text-primary)' }}>
              Agent Profiles
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
              The persona a session starts under: its instructions, and which servers and skills it
              may reach.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => onStartCreate?.()} style={button(true)}>
              New profile
            </button>
            <button onClick={onClose} aria-label="Close agent profiles" style={button(false)}>
              Close
            </button>
          </div>
        </header>

        {error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: '8px 16px',
              fontSize: '0.82rem',
              color: 'var(--color-state-error)',
              borderBottom: '1px solid var(--color-border-subtle)'
            }}
          >
            {error}
          </p>
        )}

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Catalogue */}
          <div
            style={{
              width: '280px',
              flexShrink: 0,
              borderRight: '1px solid var(--color-border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0
            }}
          >
            <div style={{ position: 'relative', padding: '10px' }}>
              <input
                type="text"
                value={search}
                onChange={event => onSearch(event.target.value)}
                placeholder="Search profiles…"
                aria-label="Search profiles"
                style={{ ...field, paddingLeft: '26px' }}
              />
              <div style={{ position: 'absolute', left: '19px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>
                <IconSearch size={12} color="var(--color-text-muted)" />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0 10px 10px' }}>
              {isLoading && profiles.length === 0 && (
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                  Loading profiles…
                </p>
              )}
              {!isLoading && profiles.length === 0 && (
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                  No profiles found.
                </p>
              )}
              {profiles.length > 0 && visible.length === 0 && (
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                  No profile matches this filter.
                </p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {visible.map(profile => {
                  const tone = originTone(profile);
                  const isActive = profile.id === selectedId;
                  return (
                    <button
                      key={profile.id}
                      onClick={() => onSelect(profile.id)}
                      aria-pressed={isActive}
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        background: isActive ? 'var(--color-surface-2)' : 'transparent',
                        border: `1px solid ${isActive ? 'var(--color-border-default)' : 'transparent'}`,
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        color: 'var(--color-text-primary)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px'
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{profile.name}</span>
                        <span style={{ ...badge, color: tone.color, background: tone.background }}>
                          {tone.label}
                        </span>
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                        {profile.role}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Detail or form */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '14px 16px' }}>
            {draft ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-text-primary)' }}>
                  {selected && !selected.isBuiltin ? `Editing ${selected.name}` : 'New profile'}
                </h3>

                <Labelled text="Name">
                  <input
                    aria-label="Profile name"
                    type="text"
                    value={draft.name}
                    onChange={event => patch({ name: event.target.value })}
                    style={field}
                  />
                </Labelled>
                <Labelled text="Role">
                  <input
                    aria-label="Profile role"
                    type="text"
                    value={draft.role}
                    placeholder="e.g. Security Auditor"
                    onChange={event => patch({ role: event.target.value })}
                    style={field}
                  />
                </Labelled>
                <Labelled text="Description">
                  <input
                    aria-label="Profile description"
                    type="text"
                    value={draft.description}
                    onChange={event => patch({ description: event.target.value })}
                    style={field}
                  />
                </Labelled>
                <Labelled text="System prompt">
                  <textarea
                    aria-label="Profile system prompt"
                    value={draft.systemPrompt}
                    rows={10}
                    onChange={event => patch({ systemPrompt: event.target.value })}
                    style={{ ...field, resize: 'vertical', fontFamily: 'var(--font-family-mono)' }}
                  />
                </Labelled>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <Labelled text="Model">
                      <input
                        aria-label="Profile model"
                        type="text"
                        value={draft.model}
                        placeholder="Adapter default"
                        onChange={event => patch({ model: event.target.value })}
                        style={field}
                      />
                    </Labelled>
                  </div>
                  <div style={{ flex: 1 }}>
                    <Labelled text="Temperature">
                      <input
                        aria-label="Profile temperature"
                        type="text"
                        value={draft.temperature}
                        placeholder="0 – 2"
                        onChange={event => patch({ temperature: event.target.value })}
                        style={field}
                      />
                    </Labelled>
                  </div>
                </div>

                <CapabilityField
                  text="MCP servers"
                  mode={draft.mcpMode}
                  onMode={mcpMode => patch({ mcpMode })}
                  value={draft.mcpText}
                  onValue={mcpText => patch({ mcpText })}
                  placeholder="filesystem, memory"
                />
                <CapabilityField
                  text="Skills"
                  mode={draft.skillMode}
                  onMode={skillMode => patch({ skillMode })}
                  value={draft.skillText}
                  onValue={skillText => patch({ skillText })}
                  placeholder="review-diff, release-notes"
                />

                <Labelled text="Auto-approval rules">
                  <input
                    aria-label="Profile auto-approval rules"
                    type="text"
                    value={draft.approvalText}
                    placeholder="Comma-separated command patterns"
                    onChange={event => patch({ approvalText: event.target.value })}
                    style={field}
                  />
                </Labelled>

                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <button onClick={() => onSave?.()} disabled={isSaving} style={button(true)}>
                    {isSaving ? 'Saving…' : 'Save profile'}
                  </button>
                  <button onClick={() => onCancelDraft?.()} style={button(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : selected ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-text-primary)' }}>
                    {selected.name}
                  </h3>
                  <span
                    style={{
                      ...badge,
                      color: originTone(selected).color,
                      background: originTone(selected).background
                    }}
                  >
                    {originTone(selected).label}
                  </span>
                  <span style={{ ...badge, color: 'var(--color-text-secondary)', background: 'var(--color-surface-3)' }}>
                    {selected.role}
                  </span>
                </div>

                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  {selected.description}
                </p>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ ...badge, background: 'var(--color-surface-3)', color: 'var(--color-text-secondary)' }}>
                    MCP: {capabilitySummary(selected.enabledMcpServers, 'servers')}
                  </span>
                  <span style={{ ...badge, background: 'var(--color-surface-3)', color: 'var(--color-text-secondary)' }}>
                    Skills: {capabilitySummary(selected.enabledSkills, 'skills')}
                  </span>
                  {selected.model && (
                    <span style={{ ...badge, background: 'var(--color-surface-3)', color: 'var(--color-text-secondary)' }}>
                      Model: {selected.model}
                    </span>
                  )}
                </div>

                <div>
                  <span style={label}>System prompt</span>
                  <pre
                    style={{
                      margin: 0,
                      padding: '10px',
                      background: 'var(--color-surface-1)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.78rem',
                      lineHeight: 1.5,
                      color: 'var(--color-text-secondary)',
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'var(--font-family-mono)'
                    }}
                  >
                    {selected.systemPrompt}
                  </pre>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => onClone?.(selected.id)} style={button(true)}>
                    Clone
                  </button>
                  {selected.isBuiltin ? (
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', alignSelf: 'center' }}>
                      Built-in profiles cannot be edited or deleted. Clone one to make it yours.
                    </span>
                  ) : (
                    <>
                      <button onClick={() => onSelect(selected.id)} style={button(false)}>
                        Edit
                      </button>
                      <button
                        onClick={() => onDelete?.(selected.id)}
                        style={{ ...button(false), color: 'var(--color-state-error)' }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                Select a profile to read its instructions, or create one of your own.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Store-connected manager. */
export function ProfileManagerModal({ onClose }: { onClose: () => void }) {
  const profiles = useProfileStore(state => state.profiles);
  const search = useProfileStore(state => state.search);
  const setSearch = useProfileStore(state => state.setSearch);
  const inspectedProfileId = useProfileStore(state => state.inspectedProfileId);
  const setInspectedProfile = useProfileStore(state => state.setInspectedProfile);
  const isLoading = useProfileStore(state => state.isLoading);
  const isSaving = useProfileStore(state => state.isSaving);
  const storeError = useProfileStore(state => state.error);
  const createProfile = useProfileStore(state => state.createProfile);
  const cloneProfile = useProfileStore(state => state.cloneProfile);
  const updateProfile = useProfileStore(state => state.updateProfile);
  const deleteProfile = useProfileStore(state => state.deleteProfile);

  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  // Kept apart from the store's error so a local validation message is not
  // wiped by the next successful request, and vice versa.
  const [draftError, setDraftError] = useState<string | null>(null);

  const selected = profiles.find(profile => profile.id === inspectedProfileId) || null;

  const handleSave = async () => {
    if (!draft) return;
    const invalid = validateDraft(draft);
    setDraftError(invalid);
    if (invalid) return;

    const input = draftToInput(draft);
    const saved =
      selected && !selected.isBuiltin
        ? await updateProfile(selected.id, input)
        : await createProfile(input);
    if (saved) {
      setDraft(null);
      setInspectedProfile(saved.id);
    }
  };

  return (
    <ProfileManagerModalView
      profiles={profiles}
      search={search}
      onSearch={setSearch}
      selectedId={inspectedProfileId}
      onSelect={id => {
        const next = profiles.find(profile => profile.id === id) || null;
        setInspectedProfile(id);
        // Selecting a custom profile that is already open switches to editing
        // it; selecting a different one only shows it.
        setDraft(next && !next.isBuiltin && id === inspectedProfileId ? draftFromProfile(next) : null);
        setDraftError(null);
      }}
      onClose={onClose}
      draft={draft}
      onDraftChange={setDraft}
      onStartCreate={() => {
        setInspectedProfile(null);
        setDraft(emptyDraft());
        setDraftError(null);
      }}
      onClone={async id => {
        const cloned = await cloneProfile(id);
        if (cloned) {
          setInspectedProfile(cloned.id);
          setDraft(draftFromProfile(cloned));
        }
      }}
      onSave={handleSave}
      onDelete={async id => {
        await deleteProfile(id);
        setDraft(null);
      }}
      onCancelDraft={() => {
        setDraft(null);
        setDraftError(null);
      }}
      isLoading={isLoading}
      isSaving={isSaving}
      error={draftError || storeError}
    />
  );
}
