import React from 'react';
import type { DecisionDriftInfo, DriftType } from '@asterim/shared';
import { IconAlertTriangle } from '../icons/Icons';

/** What a drift type says to someone reading a decision. */
export const DRIFT_LABELS: Record<DriftType, string> = {
  FILE_DELETED: 'File missing',
  FILE_MODIFIED: 'Code anchor modified',
  SYMBOL_NOT_FOUND: 'Symbol not found'
};

/**
 * A caution badge for a decision whose code has moved underneath it.
 *
 * Amber, not red, and it never touches the status badge beside it. Per DEC-027
 * drift is an observation about the *code*, not a judgement on the decision: the
 * decision is still in force, and the point of the badge is to prompt a human to
 * look — not to imply the record is wrong.
 */
export function DriftBadge({ drift }: { drift?: DecisionDriftInfo }) {
  if (!drift?.drifted || !drift.worst) return null;

  const detail = drift.refs.map(ref => ref.detail).join('\n');

  return (
    <div
      title={detail}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        marginTop: 'var(--spacing-2)',
        padding: '3px 8px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-state-paused-bg)',
        border: '1px solid var(--color-border-subtle)',
        color: 'var(--color-state-paused)',
        fontSize: 'var(--font-size-xs)',
        fontWeight: 'var(--font-weight-medium)' as any
      }}
    >
      <IconAlertTriangle size={11} />
      {DRIFT_LABELS[drift.worst]}
      {drift.refs.length > 1 && <span style={{ opacity: 0.8 }}>· {drift.refs.length} anchors</span>}
    </div>
  );
}
