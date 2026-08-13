import React from 'react';
import type { ProjectDecision } from '@asterim/shared';
import { anchorLabels, provenanceLabel } from './DecisionExplorer';

/** One day's worth of decisions, newest day first, newest decision first within it. */
export interface TimelineGroup {
  /** `YYYY-MM-DD` in local time — stable, unlike a localised label. */
  key: string;
  /** Human label for the day heading. */
  label: string;
  decisions: ProjectDecision[];
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function dayLabel(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return dayKey(ms);
  }
}

/**
 * Groups decisions into days, newest first.
 *
 * The grouping key is computed in local time rather than from an ISO string: a
 * decision recorded at 23:00 local is the same working day to the person reading
 * it, whatever UTC calls it.
 */
export function groupDecisionsByDay(decisions: ProjectDecision[]): TimelineGroup[] {
  const groups = new Map<string, TimelineGroup>();

  for (const decision of decisions) {
    const key = dayKey(decision.createdAt);
    const existing = groups.get(key);
    if (existing) {
      existing.decisions.push(decision);
    } else {
      groups.set(key, { key, label: dayLabel(decision.createdAt), decisions: [decision] });
    }
  }

  const ordered = Array.from(groups.values()).sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  for (const group of ordered) {
    group.decisions.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }
  return ordered;
}

/** One end of a supersession link, resolved to a title where the counterpart is loaded. */
export interface LineageLink {
  id: string;
  title: string;
  /** False when only the id is known, because the other decision is not in view. */
  resolved: boolean;
}

export interface Lineage {
  /** The decision that replaced this one. */
  replacedBy?: LineageLink;
  /** The decision this one replaced. */
  replaces?: LineageLink;
}

/**
 * Resolves each decision's supersession links.
 *
 * `supersededBy` carries two opposite meanings depending on `status`: on a
 * SUPERSEDED decision it names the replacement, and on the ACTIVE replacement it
 * names what was replaced. That is recorded as drift in
 * `blueprint/audit/IMPLEMENTATION_DRIFT.md` § 4; until it is split into two fields,
 * a consumer has to read `status` to know which way the link points, and this is
 * the one place in the UI that does so.
 */
export function buildLineage(decisions: ProjectDecision[]): Map<string, Lineage> {
  const byId = new Map(decisions.map(d => [d.id, d]));
  const link = (id: string): LineageLink => {
    const target = byId.get(id);
    return target ? { id, title: target.title, resolved: true } : { id, title: id, resolved: false };
  };

  const lineage = new Map<string, Lineage>();
  for (const decision of decisions) {
    if (!decision.supersededBy) continue;
    lineage.set(
      decision.id,
      decision.status === 'SUPERSEDED'
        ? { replacedBy: link(decision.supersededBy) }
        : { replaces: link(decision.supersededBy) }
    );
  }
  return lineage;
}

// --- Rendering ---

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-semibold)' as any,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em'
};

function LineageNote({ lineage }: { lineage: Lineage }) {
  const link = lineage.replacedBy ?? lineage.replaces;
  if (!link) return null;
  const verb = lineage.replacedBy ? 'Replaced by' : 'Replaces';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '6px',
        marginTop: 'var(--spacing-2)',
        paddingTop: 'var(--spacing-2)',
        borderTop: '1px solid var(--color-border-subtle)',
        fontSize: 'var(--font-size-xs)',
        color: 'var(--color-text-muted)'
      }}
    >
      <span aria-hidden="true">{lineage.replacedBy ? '↳' : '↰'}</span>
      <span>{verb}</span>
      <span
        title={link.id}
        style={{
          color: link.resolved ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
          fontFamily: link.resolved ? undefined : 'var(--font-family-mono)'
        }}
      >
        {link.title}
      </span>
    </div>
  );
}

function TimelineEntry({ decision, lineage }: { decision: ProjectDecision; lineage?: Lineage }) {
  const { text, isHuman } = provenanceLabel(decision);
  const anchors = anchorLabels(decision);
  const isActive = decision.status === 'ACTIVE';

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-3)' }}>
      {/* Rail: a filled node for what is in force, hollow for what no longer is. */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: '5px' }}>
        <span
          aria-hidden="true"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: 'var(--radius-full)',
            background: isActive ? 'var(--color-accent-primary)' : 'transparent',
            border: `1px solid ${isActive ? 'var(--color-accent-primary)' : 'var(--color-border-strong)'}`
          }}
        />
        <span aria-hidden="true" style={{ flex: 1, width: '1px', background: 'var(--color-border-subtle)', marginTop: '4px' }} />
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          paddingBottom: 'var(--spacing-5)',
          opacity: isActive ? 1 : 0.72
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 'var(--font-size-md)',
              fontWeight: 'var(--font-weight-semibold)' as any,
              color: 'var(--color-text-primary)',
              textDecoration: decision.status === 'SUPERSEDED' ? 'line-through' : undefined,
              textDecorationColor: 'var(--color-border-strong)'
            }}
          >
            {decision.title}
          </span>
          <span style={{ fontSize: 'var(--font-size-xs)', color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)' }}>
            {decision.status}
          </span>
          <span style={{ fontSize: 'var(--font-size-xs)', color: isHuman ? 'var(--color-accent-primary)' : 'var(--color-text-muted)' }}>
            {text}
          </span>
        </div>

        <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-sm)', lineHeight: 'var(--line-height-normal)', color: 'var(--color-text-secondary)' }}>
          {decision.summary}
        </p>

        {anchors.length > 0 && (
          <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {anchors.map(anchor => (
              <span
                key={anchor}
                style={{
                  fontFamily: 'var(--font-family-mono)',
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-text-muted)'
                }}
              >
                {anchor}
              </span>
            ))}
          </div>
        )}

        {lineage && <LineageNote lineage={lineage} />}
      </div>
    </div>
  );
}

export interface MemoryTimelineViewProps {
  decisions: ProjectDecision[];
}

/**
 * The chronological view of a project's memory.
 *
 * The Explorer answers "what governs this file". This answers "how did this project
 * change its mind" — which is why supersession is the primary structure here rather
 * than a footnote on a card.
 */
export function MemoryTimelineView({ decisions }: MemoryTimelineViewProps) {
  const groups = groupDecisionsByDay(decisions);
  const lineage = buildLineage(decisions);

  if (groups.length === 0) {
    return (
      <div
        style={{
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--spacing-8)',
          textAlign: 'center',
          color: 'var(--color-text-secondary)'
        }}
      >
        <div style={{ fontSize: 'var(--font-size-lg)', color: 'var(--color-text-primary)' }}>
          No history yet
        </div>
        <p style={{ margin: 'var(--spacing-2) 0 0', fontSize: 'var(--font-size-sm)' }}>
          Once decisions are recorded, this shows how the project changed its mind over time.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
      {groups.map(group => (
        <section key={group.key}>
          <div style={{ ...labelStyle, marginBottom: 'var(--spacing-3)' }}>{group.label}</div>
          {group.decisions.map(decision => (
            <TimelineEntry key={decision.id} decision={decision} lineage={lineage.get(decision.id)} />
          ))}
        </section>
      ))}
    </div>
  );
}
