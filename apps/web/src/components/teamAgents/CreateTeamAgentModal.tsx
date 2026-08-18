import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_TEAM_APPROVAL_POLICY, TEAM_APPROVAL_POLICIES } from '@asterim/shared';
import type {
  CreateTeamAgentInput,
  TeamAgent,
  TeamApprovalPolicy,
  UpdateTeamAgentInput
} from '@asterim/shared';
import { approvalPolicyLabel, approvalPolicyRequirement } from '../../stores/useTeamAgentStore';
import { listModeOf, type ListMode } from '../profiles/ProfileManagerModal';
import { useMcpStore } from '../../stores/useMcpStore';
import { useSkillsStore } from '../../stores/useSkillsStore';
import { useTeamAgentStore } from '../../stores/useTeamAgentStore';

/**
 * Composing a shared team role (P8-02, DEC-031).
 *
 * The same fields an agent profile has, with one difference that changes how
 * the form should be read: this one is not personal. A team agent belongs to
 * the team, so its system prompt is what every member's conversation is
 * conducted under, and editing it changes what a colleague's next turn does.
 * The form says so rather than presenting itself as a private setting.
 *
 * The two capability lists keep the contract's three-way distinction — unset
 * means "whatever the workstation allows", an empty list means "deliberately
 * nothing", and neither may decay into the other — so they are edited with the
 * same All / None / Selected control the profile catalogue uses, over the
 * servers and skills the Core actually found rather than a free-text field
 * where a typo silently disables a tool.
 */

/** The editable shape of a team agent, as the form holds it. */
export interface TeamAgentDraft {
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  model: string;
  /** Text, not a number, so a half-typed value is not coerced to zero. */
  temperature: string;
  mcpMode: ListMode;
  mcpSelection: string[];
  skillMode: ListMode;
  skillSelection: string[];
  /** Who may answer this role's approval prompts (DEC-031 § 3). */
  approvalPolicy: TeamApprovalPolicy;
}

export function emptyTeamAgentDraft(): TeamAgentDraft {
  return {
    name: '',
    role: '',
    description: '',
    systemPrompt: '',
    model: '',
    temperature: '',
    mcpMode: 'all',
    mcpSelection: [],
    skillMode: 'all',
    skillSelection: [],
    approvalPolicy: DEFAULT_TEAM_APPROVAL_POLICY
  };
}

/** An existing agent as a draft, for editing. */
export function draftFromTeamAgent(agent: TeamAgent): TeamAgentDraft {
  const mcpMode = listModeOf(agent.enabledMcpServers);
  const skillMode = listModeOf(agent.enabledSkills);
  return {
    name: agent.name,
    role: agent.role,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    model: agent.model ?? '',
    temperature: agent.temperature === undefined ? '' : String(agent.temperature),
    mcpMode,
    mcpSelection: mcpMode === 'list' ? [...(agent.enabledMcpServers || [])] : [],
    skillMode,
    skillSelection: skillMode === 'list' ? [...(agent.enabledSkills || [])] : [],
    approvalPolicy: agent.approvalPolicy ?? DEFAULT_TEAM_APPROVAL_POLICY
  };
}

/** One entry added to or removed from a selection, order preserved. */
export function toggleSelection(selection: string[], entry: string): string[] {
  return selection.includes(entry)
    ? selection.filter(current => current !== entry)
    : [...selection, entry];
}

/**
 * The first thing wrong with a draft, or null.
 *
 * Checked here as well as on the Core, because a round trip to be told the
 * role is empty is a worse way to learn it. The Core's copy is the one that
 * counts; this one only saves the trip.
 */
export function validateTeamAgentDraft(draft: TeamAgentDraft): string | null {
  if (!draft.name.trim()) return 'A name is required.';
  if (!draft.role.trim()) return 'A role is required.';
  if (!draft.systemPrompt.trim()) return 'A system prompt is required — it is the role itself.';
  if (draft.temperature.trim()) {
    const value = Number(draft.temperature);
    if (!Number.isFinite(value)) return 'Temperature must be a number.';
    if (value < 0 || value > 2) return 'Temperature must be between 0 and 2.';
  }
  if (draft.mcpMode === 'list' && draft.mcpSelection.length === 0) {
    return 'Select at least one MCP server, or choose None.';
  }
  if (draft.skillMode === 'list' && draft.skillSelection.length === 0) {
    return 'Select at least one skill, or choose None.';
  }
  return null;
}

/**
 * The list value the contract expects, for one of the two capability fields.
 *
 * `undefined` and `[]` are different answers — "whatever the workstation
 * allows" and "deliberately nothing" — and the mode is the only thing that
 * decides which one is meant.
 */
export function capabilityListValue(mode: ListMode, selection: string[]): string[] | undefined {
  if (mode === 'all') return undefined;
  if (mode === 'none') return [];
  return selection.map(entry => entry.trim()).filter(Boolean);
}

/** A validated draft as the body `POST /api/v1/team-agents` accepts. */
export function buildCreateTeamAgentInput(
  teamId: string,
  draft: TeamAgentDraft
): CreateTeamAgentInput {
  return {
    teamId,
    name: draft.name.trim(),
    role: draft.role.trim(),
    description: draft.description.trim(),
    systemPrompt: draft.systemPrompt.trim(),
    model: draft.model.trim() || undefined,
    temperature: draft.temperature.trim() ? Number(draft.temperature) : undefined,
    enabledMcpServers: capabilityListValue(draft.mcpMode, draft.mcpSelection),
    enabledSkills: capabilityListValue(draft.skillMode, draft.skillSelection),
    approvalPolicy: draft.approvalPolicy
  };
}

/** The same draft as the body `PATCH /api/v1/team-agents/:id` accepts. */
export function buildUpdateTeamAgentInput(draft: TeamAgentDraft): UpdateTeamAgentInput {
  const { teamId: _teamId, ...rest } = buildCreateTeamAgentInput('unused', draft);
  return rest;
}

const label: React.CSSProperties = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-muted)',
  fontWeight: 'var(--font-weight-semibold)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em'
};

const field: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 'var(--font-size-sm)',
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit'
};

const LIST_MODES: { value: ListMode; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'none', label: 'None' },
  { value: 'list', label: 'Selected' }
];

export interface TeamAgentCapabilityOption {
  id: string;
  name: string;
}

export interface CreateTeamAgentModalViewProps {
  draft: TeamAgentDraft;
  onDraftChange: (patch: Partial<TeamAgentDraft>) => void;
  onSubmit: () => void;
  onClose: () => void;
  /** Present when an existing agent is being edited rather than created. */
  editingAgent?: TeamAgent | null;
  mcpServers?: TeamAgentCapabilityOption[];
  skills?: TeamAgentCapabilityOption[];
  isSaving?: boolean;
  error?: string | null;
}

/** The form's presentation, driven entirely by props. */
export function CreateTeamAgentModalView({
  draft,
  onDraftChange,
  onSubmit,
  onClose,
  editingAgent = null,
  mcpServers = [],
  skills = [],
  isSaving = false,
  error = null
}: CreateTeamAgentModalViewProps) {
  const validation = validateTeamAgentDraft(draft);

  const capabilityGroup = (
    name: 'mcp' | 'skill',
    heading: string,
    options: TeamAgentCapabilityOption[],
    mode: ListMode,
    selection: string[]
  ) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <span style={label}>{heading}</span>
      <div style={{ display: 'flex', gap: '6px' }} role="group" aria-label={`${heading} access`}>
        {LIST_MODES.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() =>
              onDraftChange(name === 'mcp' ? { mcpMode: option.value } : { skillMode: option.value })
            }
            aria-pressed={mode === option.value}
            style={{
              padding: '4px 10px',
              fontSize: 'var(--font-size-xs)',
              background: mode === option.value ? 'var(--color-surface-3)' : 'transparent',
              color:
                mode === option.value ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-default)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer'
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      {mode === 'list' && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            maxHeight: '96px',
            overflowY: 'auto',
            padding: '6px',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)'
          }}
        >
          {options.length === 0 ? (
            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              This workstation has none configured yet.
            </span>
          ) : (
            options.map(option => {
              const checked = selection.includes(option.name);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() =>
                    onDraftChange(
                      name === 'mcp'
                        ? { mcpSelection: toggleSelection(selection, option.name) }
                        : { skillSelection: toggleSelection(selection, option.name) }
                    )
                  }
                  aria-pressed={checked}
                  style={{
                    padding: '3px 9px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: 'var(--font-size-xs)',
                    fontFamily: 'var(--font-family-mono)',
                    background: checked ? 'var(--color-accent-subtle)' : 'transparent',
                    color: checked ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                    border: `1px solid ${checked ? 'var(--color-accent-primary)' : 'var(--color-border-default)'}`,
                    cursor: 'pointer'
                  }}
                >
                  {option.name}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box glass-panel"
        role="dialog"
        aria-label={editingAgent ? 'Edit team agent' : 'New team agent'}
        style={{ maxWidth: '560px', width: '100%' }}
        onClick={event => event.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--spacing-3)'
          }}
        >
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text-primary)' }}>
            {editingAgent ? `Edit ${editingAgent.name}` : 'New Team Agent'}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: '1.2rem'
            }}
          >
            ×
          </button>
        </div>

        <p style={{ margin: '0 0 var(--spacing-3)', fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
          This role is shared. Everyone on the team talks to it, into one transcript, and the system
          prompt below is what every one of their turns runs under.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
          <div style={{ display: 'flex', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={label}>Name</span>
              <input
                type="text"
                value={draft.name}
                onChange={event => onDraftChange({ name: event.target.value })}
                aria-label="Team agent name"
                placeholder="Security Reviewer"
                style={field}
              />
            </div>
            <div style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={label}>Role</span>
              <input
                type="text"
                value={draft.role}
                onChange={event => onDraftChange({ role: event.target.value })}
                aria-label="Team agent role"
                placeholder="security-reviewer"
                style={{ ...field, fontFamily: 'var(--font-family-mono)' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={label}>Description</span>
            <input
              type="text"
              value={draft.description}
              onChange={event => onDraftChange({ description: event.target.value })}
              aria-label="Team agent description"
              placeholder="What the team uses this role for."
              style={field}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={label}>System Prompt</span>
            <textarea
              value={draft.systemPrompt}
              onChange={event => onDraftChange({ systemPrompt: event.target.value })}
              aria-label="Team agent system prompt"
              rows={6}
              placeholder="You review changes for security defects before they are merged…"
              style={{ ...field, resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={label}>Model</span>
              <input
                type="text"
                value={draft.model}
                onChange={event => onDraftChange({ model: event.target.value })}
                aria-label="Team agent model"
                placeholder="Workstation default"
                style={{ ...field, fontFamily: 'var(--font-family-mono)' }}
              />
            </div>
            <div style={{ flex: '0 1 140px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={label}>Temperature</span>
              <input
                type="text"
                value={draft.temperature}
                onChange={event => onDraftChange({ temperature: event.target.value })}
                aria-label="Team agent temperature"
                placeholder="0 – 2"
                style={{ ...field, fontFamily: 'var(--font-family-mono)' }}
              />
            </div>
          </div>

          {capabilityGroup('mcp', 'MCP Servers', mcpServers, draft.mcpMode, draft.mcpSelection)}
          {capabilityGroup('skill', 'Skills', skills, draft.skillMode, draft.skillSelection)}

          {/*
            Who may let this role go ahead with an action it has paused on. It
            belongs on the role rather than on each conversation because it is a
            property of what the role is allowed to do, and a team that set it
            once should not have to set it again per thread.
          */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={label}>Approvals</span>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }} role="group" aria-label="Approval policy">
              {TEAM_APPROVAL_POLICIES.map(policy => (
                <button
                  key={policy}
                  type="button"
                  onClick={() => onDraftChange({ approvalPolicy: policy })}
                  aria-pressed={draft.approvalPolicy === policy}
                  style={{
                    padding: '4px 10px',
                    fontSize: 'var(--font-size-xs)',
                    background:
                      draft.approvalPolicy === policy ? 'var(--color-surface-3)' : 'transparent',
                    color:
                      draft.approvalPolicy === policy
                        ? 'var(--color-text-primary)'
                        : 'var(--color-text-secondary)',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer'
                  }}
                >
                  {approvalPolicyLabel(policy)}
                </button>
              ))}
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              {approvalPolicyRequirement(draft.approvalPolicy)}
            </span>
          </div>

          {(error || validation) && (
            <p role="alert" style={{ margin: 0, color: 'var(--color-state-error)', fontSize: '0.82rem' }}>
              {error || validation}
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              onClick={onClose}
              style={{
                padding: '7px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border-default)',
                background: 'transparent',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
                fontSize: 'var(--font-size-sm)'
              }}
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={!!validation || isSaving}
              style={{
                padding: '7px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-accent-primary)',
                background: validation || isSaving ? 'transparent' : 'var(--color-accent-subtle)',
                color:
                  validation || isSaving ? 'var(--color-text-muted)' : 'var(--color-accent-primary)',
                cursor: validation || isSaving ? 'not-allowed' : 'pointer',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--font-weight-semibold)'
              }}
            >
              {isSaving ? 'Saving…' : editingAgent ? 'Save for the team' : 'Create team agent'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Store-connected modal, over the team the explorer is showing. */
export function CreateTeamAgentModal({
  teamId,
  editingAgent = null,
  onClose
}: {
  teamId: string;
  editingAgent?: TeamAgent | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TeamAgentDraft>(() =>
    editingAgent ? draftFromTeamAgent(editingAgent) : emptyTeamAgentDraft()
  );

  const isSaving = useTeamAgentStore(state => state.isSaving);
  const error = useTeamAgentStore(state => state.error);
  const createTeamAgent = useTeamAgentStore(state => state.createTeamAgent);
  const updateTeamAgent = useTeamAgentStore(state => state.updateTeamAgent);

  const mcpServers = useMcpStore(state => state.servers);
  const skills = useSkillsStore(state => state.skills);

  return createPortal(
    <CreateTeamAgentModalView
      draft={draft}
      onDraftChange={patch => setDraft(current => ({ ...current, ...patch }))}
      onSubmit={() => {
        if (validateTeamAgentDraft(draft)) return;
        const saved = editingAgent
          ? updateTeamAgent(editingAgent.id, buildUpdateTeamAgentInput(draft))
          : createTeamAgent(buildCreateTeamAgentInput(teamId, draft));
        void saved.then(agent => {
          if (agent) onClose();
        });
      }}
      onClose={onClose}
      editingAgent={editingAgent}
      mcpServers={mcpServers.map(server => ({ id: server.id, name: server.name }))}
      skills={skills.map(skill => ({ id: skill.id, name: skill.name }))}
      isSaving={isSaving}
      error={error}
    />,
    document.body
  );
}
