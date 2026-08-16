import React, { useEffect } from 'react';
import type { SkillDefinition, SkillScope } from '@asterim/shared';
import {
  filterSkills,
  parameterNames,
  requiredParameters,
  useSkillsStore
} from '../../stores/useSkillsStore';
import { SkillDetailModal } from './SkillDetailModal';
import { IconSearch } from '../icons/Icons';

/**
 * The Skills Explorer.
 *
 * A card grid over the skills the Core found, with a search box and a scope
 * filter. Read-only by design: a skill is a directory in the developer's own
 * repository, so the panel's job is to answer "what can my agent already do,
 * and what exactly does it say" — not to become a second editor for files the
 * developer already has open.
 *
 * The scope badge is the part that carries the most information per pixel.
 * `Workspace` means the skill travels with the repository and everyone who
 * clones it gets it; `Global` means it exists on this workstation alone, and an
 * agent relying on it will behave differently on a colleague's machine.
 */

/** The scope filters offered, in the order they are shown. */
export const SCOPE_FILTERS = ['all', 'workspace', 'global'] as const;
export type ScopeFilter = (typeof SCOPE_FILTERS)[number];

export interface ScopeTone {
  color: string;
  background: string;
  label: string;
}

/** How a scope is shown. Workspace is the accent; global is neutral. */
export function scopeTone(scope: SkillScope): ScopeTone {
  return scope === 'workspace'
    ? {
        color: 'var(--color-state-working)',
        background: 'var(--color-state-working-bg)',
        label: 'Workspace'
      }
    : {
        color: 'var(--color-text-secondary)',
        background: 'rgba(148, 163, 184, 0.12)',
        label: 'Global'
      };
}

/**
 * The card's one-line summary of a skill's inputs.
 *
 * Required parameters are marked with `*`, the same convention the MCP drawer
 * uses for prompt arguments, so the two panels read the same way.
 */
export function parameterPreview(skill: SkillDefinition): string {
  const names = parameterNames(skill);
  if (names.length === 0) return 'No parameters';
  const required = new Set(requiredParameters(skill));
  return names.map(name => (required.has(name) ? `${name}*` : name)).join(', ');
}

const chip: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: 'var(--font-size-xs, 12px)',
  background: 'var(--color-surface-3)',
  color: 'var(--color-text-secondary)',
  whiteSpace: 'nowrap'
};

const filterButton = (active: boolean): React.CSSProperties => ({
  padding: '5px 12px',
  background: active ? 'var(--color-surface-2)' : 'transparent',
  border: `1px solid ${active ? 'var(--color-border-default)' : 'rgba(255,255,255,0.12)'}`,
  borderRadius: '6px',
  color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
  cursor: 'pointer',
  fontSize: '0.8rem'
});

const FILTER_LABELS: Record<ScopeFilter, string> = {
  all: 'All',
  workspace: 'Workspace',
  global: 'Global'
};

export interface SkillsExplorerViewProps {
  skills: SkillDefinition[];
  isLoading: boolean;
  error: string | null;
  search: string;
  onSearch: (search: string) => void;
  scopeFilter: ScopeFilter;
  onScopeFilter: (scope: ScopeFilter) => void;
  /** Which skill's modal is open. Exposed so a render test can reach it. */
  openSkillId?: string | null;
  onOpenSkill?: (id: string | null) => void;
}

/**
 * The explorer's presentation, driven entirely by props.
 *
 * Separated from the store-connected container for the same reason as the MCP
 * registry: zustand v5 serves its initial state as the server snapshot, so a
 * store-reading component renders empty under `react-dom/server` and could not
 * be tested at all.
 */
export function SkillsExplorerView({
  skills,
  isLoading,
  error,
  search,
  onSearch,
  scopeFilter,
  onScopeFilter,
  openSkillId = null,
  onOpenSkill
}: SkillsExplorerViewProps) {
  const visible = filterSkills(skills, search, scopeFilter);
  const open = skills.find(skill => skill.id === openSkillId) || null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: '16px',
        gap: '14px'
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text-primary)' }}>Skills</h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            Reusable procedures your agents can follow, read from .agents/skills and this
            workstation&rsquo;s skills directory.
          </p>
        </div>
        <span style={chip}>
          {visible.length} of {skills.length}
        </span>
      </header>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: '180px' }}>
          <input
            id="skill-search"
            type="text"
            value={search}
            onChange={event => onSearch(event.target.value)}
            placeholder="Search skills…"
            aria-label="Search skills"
            style={{
              width: '100%',
              padding: '7px 10px 7px 28px',
              borderRadius: '6px',
              background: 'var(--color-surface-1)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--color-text-primary)',
              fontSize: '0.85rem',
              outline: 'none',
              boxSizing: 'border-box'
            }}
          />
          <div style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>
            <IconSearch size={12} color="var(--color-text-muted)" />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px' }} role="group" aria-label="Filter by scope">
          {SCOPE_FILTERS.map(scope => (
            <button
              key={scope}
              onClick={() => onScopeFilter(scope)}
              style={filterButton(scopeFilter === scope)}
              aria-pressed={scopeFilter === scope}
            >
              {FILTER_LABELS[scope]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--color-state-error)', fontSize: '0.85rem' }}>
          {error}
        </p>
      )}

      {isLoading && skills.length === 0 && (
        <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>Loading skills…</p>
      )}

      {!isLoading && skills.length === 0 && (
        <div
          style={{
            border: '1px dashed rgba(255,255,255,0.12)',
            borderRadius: '8px',
            padding: '28px',
            textAlign: 'center',
            color: 'var(--color-text-secondary)'
          }}
        >
          <p style={{ margin: 0 }}>No skills found.</p>
          <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Add a directory with a SKILL.md under .agents/skills in this project, and your agents can
            call it.
          </p>
        </div>
      )}

      {!isLoading && skills.length > 0 && visible.length === 0 && (
        <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
          No skill matches this filter.
        </p>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: '12px',
          overflowY: 'auto',
          minHeight: 0,
          alignContent: 'start'
        }}
      >
        {visible.map(skill => {
          const tone = scopeTone(skill.scope);
          return (
            <article
              key={skill.id}
              style={{
                background: 'var(--color-surface-1)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '8px',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => onOpenSkill?.(skill.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    color: 'var(--color-text-primary)',
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    fontFamily: 'var(--font-family-mono)',
                    cursor: 'pointer'
                  }}
                >
                  {skill.name}
                </button>
                <span style={{ ...chip, background: tone.background, color: tone.color, fontWeight: 600 }}>
                  {tone.label}
                </span>
              </div>

              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                {skill.description}
              </p>

              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={chip}>{parameterPreview(skill)}</span>
                {!!skill.scripts?.length && <span style={chip}>{skill.scripts.length} scripts</span>}
                {!!skill.references?.length && <span style={chip}>{skill.references.length} references</span>}
              </div>

              <span
                style={{
                  fontFamily: 'var(--font-family-mono)',
                  fontSize: 'var(--font-size-xs, 12px)',
                  color: 'var(--color-text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {skill.path}
              </span>
            </article>
          );
        })}
      </div>

      {open && <SkillDetailModal skill={open} onClose={() => onOpenSkill?.(null)} />}
    </div>
  );
}

/** Store-connected explorer. */
export function SkillsExplorer({ workspacePath }: { workspacePath?: string | null }) {
  const skills = useSkillsStore(state => state.skills);
  const isLoading = useSkillsStore(state => state.isLoading);
  const error = useSkillsStore(state => state.error);
  const search = useSkillsStore(state => state.search);
  const scopeFilter = useSkillsStore(state => state.scopeFilter);
  const activeSkillId = useSkillsStore(state => state.activeSkillId);

  const loadSkills = useSkillsStore(state => state.loadSkills);
  const setActiveSkill = useSkillsStore(state => state.setActiveSkill);
  const setSearch = useSkillsStore(state => state.setSearch);
  const setScopeFilter = useSkillsStore(state => state.setScopeFilter);

  useEffect(() => {
    void loadSkills(workspacePath || undefined);
  }, [workspacePath, loadSkills]);

  return (
    <SkillsExplorerView
      skills={skills}
      isLoading={isLoading}
      error={error}
      search={search}
      onSearch={setSearch}
      scopeFilter={scopeFilter}
      onScopeFilter={setScopeFilter}
      openSkillId={activeSkillId}
      onOpenSkill={setActiveSkill}
    />
  );
}
