import React, { useEffect, useMemo, useState } from 'react';
import type { ArchitecturalRule, ProjectDecision, ProjectIntent, DecisionStatus } from '@asterim/shared';
import { useMemoryStore } from '../../stores/useMemoryStore';
import { RecordDecisionModal } from './RecordDecisionModal';
import { IconFileCode, IconPlus, IconSearch, IconShield, IconTarget, IconUser, IconBot } from '../icons/Icons';

/** Status pills offered in the filter bar. `all` is the default. */
export const STATUS_FILTERS = ['all', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED', 'STALE'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export interface DecisionFilters {
  /** Free text, matched against title, summary, rationale and constraints. */
  query?: string;
  status?: StatusFilter;
  /** Substring match against related files and code-ref paths. */
  filePath?: string;
}

/**
 * Applies the explorer's filters to a decision list.
 *
 * Exported separately from the component because it is the part with behaviour
 * worth testing: the repository has no DOM test environment, so a pure function is
 * the difference between this logic being verified and merely being rendered.
 */
export function filterDecisions(decisions: ProjectDecision[], filters: DecisionFilters): ProjectDecision[] {
  const query = filters.query?.trim().toLowerCase() ?? '';
  const filePath = filters.filePath?.trim().toLowerCase() ?? '';
  const status = filters.status ?? 'all';

  return decisions.filter(decision => {
    if (status !== 'all' && decision.status !== status) return false;

    if (query) {
      const haystack = [
        decision.title,
        decision.summary,
        decision.rationale,
        ...(decision.constraints ?? [])
      ]
        .join('\n')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    if (filePath) {
      const paths = [
        ...(decision.relatedFiles ?? []),
        ...(decision.codeRefs ?? []).map(ref => ref.filePath ?? '')
      ]
        .filter(Boolean)
        .map(p => p.toLowerCase());
      if (!paths.some(p => p.includes(filePath))) return false;
    }

    return true;
  });
}

/** Splits a decision's anchors into displayable `path#symbol` labels, deduplicated. */
export function anchorLabels(decision: ProjectDecision): string[] {
  const labels = (decision.codeRefs ?? [])
    .map(ref => {
      if (ref.filePath && ref.symbolName) return `${ref.filePath}#${ref.symbolName}`;
      return ref.filePath || ref.symbolName || '';
    })
    .filter(Boolean);

  // relatedFiles are derived from file-only code refs, so they are usually already
  // covered above. Include any that are not, without duplicating a path.
  for (const file of decision.relatedFiles ?? []) {
    if (!labels.some(l => l === file || l.startsWith(`${file}#`))) labels.push(file);
  }
  return labels;
}

/**
 * How a decision entered memory, rendered so a reviewer can weigh it at a glance.
 *
 * DEC-024 exists precisely so an agent's unprompted assertion is distinguishable
 * from something a human approved. That distinction is worth nothing if the UI
 * renders both identically, so human-confirmed decisions carry the accent and
 * agent statements stay neutral — the accent means "a person stood behind this".
 */
export function provenanceLabel(decision: ProjectDecision): { text: string; isHuman: boolean } {
  const percent = Math.round((decision.confidence ?? 0) * 100);
  switch (decision.provenance) {
    case 'HUMAN_CONFIRMED':
      return { text: `Human · ${percent}%`, isHuman: true };
    case 'REPOSITORY_EVIDENCE':
      return { text: `Repository · ${percent}%`, isHuman: false };
    case 'INFERRED':
      return { text: `Inferred · ${percent}%`, isHuman: false };
    default:
      return { text: `Agent · ${percent}%`, isHuman: false };
  }
}

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return '';
  }
}

const panelStyle: React.CSSProperties = {
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)'
};

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-semibold)' as any,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em'
};

// --- Sub-components ---

function StatusBadge({ status }: { status: DecisionStatus }) {
  const isActive = status === 'ACTIVE';
  return (
    <span
      style={{
        fontSize: 'var(--font-size-xs)',
        fontWeight: 'var(--font-weight-semibold)' as any,
        letterSpacing: '0.04em',
        padding: '2px 8px',
        borderRadius: 'var(--radius-full)',
        color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
        background: isActive ? 'var(--color-accent-subtle)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${isActive ? 'var(--color-accent-subtle)' : 'var(--color-border-subtle)'}`
      }}
    >
      {status}
    </span>
  );
}

function ProvenanceBadge({ decision }: { decision: ProjectDecision }) {
  const { text, isHuman } = provenanceLabel(decision);
  const percent = Math.max(0, Math.min(100, Math.round((decision.confidence ?? 0) * 100)));

  return (
    <span
      title={`Provenance: ${decision.provenance} · Confidence: ${percent}%`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: 'var(--font-size-xs)',
        fontWeight: 'var(--font-weight-medium)' as any,
        padding: '2px 8px',
        borderRadius: 'var(--radius-full)',
        color: isHuman ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
        background: isHuman ? 'var(--color-accent-subtle)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${isHuman ? 'var(--color-accent-subtle)' : 'var(--color-border-subtle)'}`
      }}
    >
      {isHuman ? <IconUser size={11} /> : <IconBot size={11} />}
      {text}
      {/* A 32px meter, not a gauge. Enough to compare two cards at a glance. */}
      <span
        aria-hidden="true"
        style={{
          width: '32px',
          height: '2px',
          borderRadius: '1px',
          background: 'rgba(255,255,255,0.10)',
          overflow: 'hidden'
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${percent}%`,
            height: '100%',
            background: isHuman ? 'var(--color-accent-primary)' : 'var(--color-text-muted)'
          }}
        />
      </span>
    </span>
  );
}

function DecisionCard({ decision }: { decision: ProjectDecision }) {
  const [showRationale, setShowRationale] = useState(false);
  const anchors = anchorLabels(decision);
  const constraints = decision.constraints ?? [];

  return (
    <article style={{ ...panelStyle, padding: 'var(--spacing-4)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-3)' }}>
        <h3
          style={{
            margin: 0,
            flex: 1,
            minWidth: 0,
            fontSize: 'var(--font-size-lg)',
            fontWeight: 'var(--font-weight-semibold)' as any,
            color: 'var(--color-text-primary)',
            lineHeight: 'var(--line-height-tight)'
          }}
        >
          {decision.title}
        </h3>
        <StatusBadge status={decision.status} />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--spacing-2)',
          marginTop: 'var(--spacing-2)'
        }}
      >
        <ProvenanceBadge decision={decision} />
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {formatDate(decision.createdAt)}
        </span>
      </div>

      <p
        style={{
          margin: 'var(--spacing-3) 0 0',
          fontSize: 'var(--font-size-md)',
          lineHeight: 'var(--line-height-normal)',
          color: 'var(--color-text-primary)'
        }}
      >
        {decision.summary}
      </p>

      {decision.rationale && (
        <div style={{ marginTop: 'var(--spacing-3)' }}>
          <button
            type="button"
            aria-expanded={showRationale}
            onClick={() => setShowRationale(v => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-medium)' as any
            }}
          >
            {showRationale ? '− Hide rationale' : '+ Why this was decided'}
          </button>
          {showRationale && (
            <p
              style={{
                margin: 'var(--spacing-2) 0 0',
                paddingLeft: 'var(--spacing-3)',
                borderLeft: '1px solid var(--color-border-subtle)',
                fontSize: 'var(--font-size-sm)',
                lineHeight: 'var(--line-height-normal)',
                color: 'var(--color-text-secondary)'
              }}
            >
              {decision.rationale}
            </p>
          )}
        </div>
      )}

      {constraints.length > 0 && (
        <div style={{ marginTop: 'var(--spacing-4)' }}>
          <div style={labelStyle}>Constraints</div>
          <ul style={{ margin: 'var(--spacing-2) 0 0', paddingLeft: 'var(--spacing-4)' }}>
            {constraints.map((constraint, i) => (
              <li
                key={i}
                style={{
                  fontSize: 'var(--font-size-sm)',
                  lineHeight: 'var(--line-height-normal)',
                  color: 'var(--color-text-secondary)'
                }}
              >
                {constraint}
              </li>
            ))}
          </ul>
        </div>
      )}

      {anchors.length > 0 && (
        <div style={{ marginTop: 'var(--spacing-4)' }}>
          <div style={labelStyle}>Anchored to</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)', marginTop: 'var(--spacing-2)' }}>
            {anchors.map(anchor => (
              <span
                key={anchor}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '3px 8px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--color-border-subtle)',
                  fontFamily: 'var(--font-family-mono)',
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-text-secondary)'
                }}
              >
                <IconFileCode size={11} />
                {anchor}
              </span>
            ))}
          </div>
        </div>
      )}

      {decision.supersededBy && (
        <div
          style={{
            marginTop: 'var(--spacing-4)',
            paddingTop: 'var(--spacing-3)',
            borderTop: '1px solid var(--color-border-subtle)',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)'
          }}
        >
          {decision.status === 'SUPERSEDED' ? 'Superseded by' : 'Supersedes'}{' '}
          <span style={{ fontFamily: 'var(--font-family-mono)', color: 'var(--color-text-secondary)' }}>
            {decision.supersededBy}
          </span>
        </div>
      )}
    </article>
  );
}

function IntentCard({ goal, constraints, nonGoals }: { goal: string; constraints: string[]; nonGoals: string[] }) {
  return (
    <div style={{ ...panelStyle, padding: 'var(--spacing-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', ...labelStyle }}>
        <IconTarget size={12} /> Current intent
      </div>
      <p
        style={{
          margin: 'var(--spacing-2) 0 0',
          fontSize: 'var(--font-size-md)',
          color: 'var(--color-text-primary)',
          lineHeight: 'var(--line-height-normal)'
        }}
      >
        {goal}
      </p>
      {(constraints.length > 0 || nonGoals.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-6)', marginTop: 'var(--spacing-3)' }}>
          {constraints.length > 0 && (
            <div>
              <div style={labelStyle}>Constraints</div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 'var(--spacing-4)' }}>
                {constraints.map((c, i) => (
                  <li key={i} style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {nonGoals.length > 0 && (
            <div>
              <div style={labelStyle}>Not doing</div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 'var(--spacing-4)' }}>
                {nonGoals.map((c, i) => (
                  <li key={i} style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RuleList({ rules }: { rules: ArchitecturalRule[] }) {
  if (rules.length === 0) return null;
  return (
    <div style={{ ...panelStyle, padding: 'var(--spacing-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', ...labelStyle }}>
        <IconShield size={12} /> Standing rules ({rules.length})
      </div>
      <ul style={{ margin: 'var(--spacing-2) 0 0', paddingLeft: 'var(--spacing-4)' }}>
        {rules.map(rule => (
          <li key={rule.id} style={{ fontSize: 'var(--font-size-sm)', lineHeight: 'var(--line-height-normal)', color: 'var(--color-text-secondary)' }}>
            <span style={{ color: 'var(--color-text-primary)' }}>{rule.title}</span> — {rule.statement}
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Explorer ---

export interface DecisionExplorerProps {
  projectId: string | null;
}

export interface DecisionExplorerViewProps extends DecisionExplorerProps {
  decisions: ProjectDecision[];
  rules: ArchitecturalRule[];
  activeIntent: ProjectIntent | null;
  loading: boolean;
  error: string | null;
}

/**
 * The explorer's presentation, driven entirely by props.
 *
 * Separate from the store-connected container below for two reasons. It is what
 * `blueprint/UI_PRINCIPLES.md` asks for — views render, they do not own business
 * data — and it is the only way this component can be tested at all: zustand v5
 * serves `getInitialState` as the server snapshot, so a store-reading component
 * renders empty under `react-dom/server` no matter what state is set.
 *
 * Filter and modal state stay here: they are presentation, not project memory.
 */
export function DecisionExplorerView({
  projectId,
  decisions,
  rules,
  activeIntent,
  loading,
  error
}: DecisionExplorerViewProps) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [filePath, setFilePath] = useState('');
  const [recording, setRecording] = useState(false);

  const visible = useMemo(
    () => filterDecisions(decisions, { query, status, filePath }),
    [decisions, query, status, filePath]
  );

  const filtersActive = query.trim() !== '' || filePath.trim() !== '' || status !== 'all';

  if (!projectId) {
    return (
      <div style={{ padding: 'var(--spacing-8)', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-md)' }}>
        Select a project to see what it has already decided.
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-4)',
        padding: 'var(--spacing-6)',
        height: '100%',
        overflowY: 'auto',
        boxSizing: 'border-box'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--spacing-4)' }}>
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 'var(--font-size-xl)',
              fontWeight: 'var(--font-weight-semibold)' as any,
              color: 'var(--color-text-primary)'
            }}
          >
            Project Memory
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            {decisions.length} decision{decisions.length === 1 ? '' : 's'} · {rules.length} rule
            {rules.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRecording(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            height: 'var(--control-height-md)',
            padding: '0 var(--spacing-4)',
            background: 'var(--color-accent-primary)',
            color: '#042114',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--font-weight-semibold)' as any,
            cursor: 'pointer',
            transition: 'background var(--transition-fast)'
          }}
        >
          <IconPlus size={13} /> Record decision
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: 'var(--spacing-3)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-state-error-bg)',
            border: '1px solid var(--color-border-subtle)',
            color: 'var(--color-state-error)',
            fontSize: 'var(--font-size-sm)'
          }}
        >
          {error}
        </div>
      )}

      {activeIntent && (
        <IntentCard
          goal={activeIntent.goal}
          constraints={activeIntent.constraints ?? []}
          nonGoals={activeIntent.nonGoals ?? []}
        />
      )}

      <RuleList rules={rules} />

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)', alignItems: 'center' }}>
        <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flex: '1 1 240px' }}>
          <span style={{ position: 'absolute', left: '10px', display: 'inline-flex', color: 'var(--color-text-muted)' }}>
            <IconSearch size={13} />
          </span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search decisions"
            aria-label="Search decisions"
            style={{
              width: '100%',
              height: 'var(--control-height-sm)',
              padding: '0 var(--spacing-3) 0 30px',
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-border-default)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-primary)',
              fontSize: 'var(--font-size-sm)',
              boxSizing: 'border-box'
            }}
          />
        </label>

        <input
          type="text"
          value={filePath}
          onChange={e => setFilePath(e.target.value)}
          placeholder="Filter by file path"
          aria-label="Filter by file path"
          style={{
            flex: '1 1 200px',
            height: 'var(--control-height-sm)',
            padding: '0 var(--spacing-3)',
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-border-default)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-family-mono)',
            fontSize: 'var(--font-size-xs)',
            boxSizing: 'border-box'
          }}
        />

        <div style={{ display: 'flex', gap: '4px' }}>
          {STATUS_FILTERS.map(value => {
            const selected = status === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => setStatus(value)}
                style={{
                  height: 'var(--control-height-sm)',
                  padding: '0 var(--spacing-3)',
                  background: selected ? 'var(--color-surface-3)' : 'transparent',
                  border: `1px solid ${selected ? 'var(--color-border-strong)' : 'var(--color-border-subtle)'}`,
                  borderRadius: 'var(--radius-full)',
                  color: selected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 'var(--font-weight-medium)' as any,
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)'
                }}
              >
                {value === 'all' ? 'All' : value}
              </button>
            );
          })}
        </div>
      </div>

      {/* Results */}
      {loading && decisions.length === 0 ? (
        <div style={{ padding: 'var(--spacing-6)', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
          Loading project memory…
        </div>
      ) : visible.length === 0 ? (
        <div
          style={{
            ...panelStyle,
            padding: 'var(--spacing-8)',
            textAlign: 'center',
            color: 'var(--color-text-secondary)'
          }}
        >
          {decisions.length === 0 ? (
            <>
              <div style={{ fontSize: 'var(--font-size-lg)', color: 'var(--color-text-primary)' }}>
                Nothing has been decided here yet
              </div>
              <p style={{ margin: 'var(--spacing-2) 0 0', fontSize: 'var(--font-size-sm)' }}>
                Decisions recorded by you or by an agent appear here, and every later session reads them
                before it starts work.
              </p>
            </>
          ) : (
            <>
              <div style={{ fontSize: 'var(--font-size-lg)', color: 'var(--color-text-primary)' }}>
                No decisions match these filters
              </div>
              <p style={{ margin: 'var(--spacing-2) 0 0', fontSize: 'var(--font-size-sm)' }}>
                {decisions.length} decision{decisions.length === 1 ? '' : 's'} recorded in this project.
              </p>
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
          {filtersActive && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Showing {visible.length} of {decisions.length}
            </div>
          )}
          {visible.map(decision => (
            <DecisionCard key={decision.id} decision={decision} />
          ))}
        </div>
      )}

      {recording && projectId && (
        <RecordDecisionModal projectId={projectId} onClose={() => setRecording(false)} />
      )}
    </div>
  );
}

/**
 * Store-connected Decision Explorer.
 *
 * Owns exactly two things the view does not: reading `useMemoryStore`, and keeping
 * that store pointed at the active project.
 */
export function DecisionExplorer({ projectId }: DecisionExplorerProps) {
  const decisions = useMemoryStore(s => s.decisions);
  const rules = useMemoryStore(s => s.rules);
  const activeIntent = useMemoryStore(s => s.activeIntent);
  const loading = useMemoryStore(s => s.loading);
  const error = useMemoryStore(s => s.error);

  // The store holds one project at a time. Dropping the previous project's memory
  // before loading the new one keeps it from being read as this project's own.
  useEffect(() => {
    const store = useMemoryStore.getState();
    store.reset();
    if (!projectId) return;
    void store.fetchBriefing(projectId);
    void store.fetchDecisions(projectId);
  }, [projectId]);

  return (
    <DecisionExplorerView
      projectId={projectId}
      decisions={decisions}
      rules={rules}
      activeIntent={activeIntent}
      loading={loading}
      error={error}
    />
  );
}
