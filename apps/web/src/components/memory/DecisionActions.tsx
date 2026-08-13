import React, { useState } from 'react';
import type { ProjectDecision } from '@asterim/shared';
import { useMemoryStore } from '../../stores/useMemoryStore';
import { SupersedeDecisionModal } from './SupersedeDecisionModal';
import { ArchiveDecisionModal } from './ArchiveDecisionModal';

/** A lifecycle action a user can take on a decision. */
export type DecisionAction = 'supersede' | 'stale' | 'reactivate' | 'archive';

/**
 * Which lifecycle actions apply to a decision in its current state.
 *
 * `SUPERSEDED` and `ARCHIVED` are terminal *in the UI*: the record stays in the
 * timeline and the REST surface can still move it, but offering "reactivate" on a
 * decision that another decision has already replaced would let a user create two
 * live decisions contradicting each other with one click. Reviving one is a
 * deliberate act that should go through recording a fresh decision.
 */
export function availableActions(decision: ProjectDecision): DecisionAction[] {
  switch (decision.status) {
    case 'ACTIVE':
      return ['supersede', 'stale', 'archive'];
    case 'STALE':
      return ['reactivate', 'supersede', 'archive'];
    default:
      return [];
  }
}

/** The label shown on each action's control. */
export const ACTION_LABELS: Record<DecisionAction, string> = {
  supersede: 'Supersede',
  stale: 'Mark stale',
  reactivate: 'Reactivate',
  archive: 'Archive'
};

/** Actions that open a dialog rather than applying immediately. */
export function actionNeedsConfirmation(action: DecisionAction): boolean {
  // Archiving retires a decision from every future agent briefing — it changes
  // what the next session is told, silently, and nothing in the running system
  // will announce it. Stale is reversible in one click, so it applies directly.
  return action === 'archive' || action === 'supersede';
}

function buttonStyle(tone: 'neutral' | 'warning'): React.CSSProperties {
  return {
    height: '26px',
    padding: '0 10px',
    background: 'transparent',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: 'var(--radius-sm)',
    color: tone === 'warning' ? 'var(--color-state-paused)' : 'var(--color-text-secondary)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-medium)' as any,
    cursor: 'pointer',
    transition: 'all var(--transition-fast)'
  };
}

const TONES: Record<DecisionAction, 'neutral' | 'warning'> = {
  supersede: 'neutral',
  reactivate: 'neutral',
  stale: 'warning',
  archive: 'warning'
};

export interface DecisionActionsProps {
  projectId: string | null;
  decision: ProjectDecision;
}

/**
 * The lifecycle controls attached to a decision.
 *
 * Owns its own dialog state and talks to the store directly, so the Explorer card
 * and the Timeline entry get identical behaviour by rendering the same element —
 * two copies of this logic would drift the moment one view gained an action.
 */
export function DecisionActions({ projectId, decision }: DecisionActionsProps) {
  const [dialog, setDialog] = useState<'supersede' | 'archive' | null>(null);
  const [pending, setPending] = useState<DecisionAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actions = availableActions(decision);
  if (!projectId || actions.length === 0) return null;

  const applyStatus = async (action: DecisionAction, status: 'STALE' | 'ACTIVE') => {
    setPending(action);
    setError(null);
    try {
      await useMemoryStore.getState().updateDecisionStatus(projectId, decision.id, status);
    } catch (err) {
      setError((err as Error).message || 'Could not update the decision');
    } finally {
      setPending(null);
    }
  };

  const onAction = (action: DecisionAction) => {
    if (action === 'supersede') return setDialog('supersede');
    if (action === 'archive') return setDialog('archive');
    if (action === 'stale') return void applyStatus('stale', 'STALE');
    return void applyStatus('reactivate', 'ACTIVE');
  };

  return (
    <div style={{ marginTop: 'var(--spacing-3)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {actions.map(action => (
          <button
            key={action}
            type="button"
            disabled={pending !== null}
            aria-label={`${ACTION_LABELS[action]}: ${decision.title}`}
            onClick={() => onAction(action)}
            style={{ ...buttonStyle(TONES[action]), opacity: pending !== null ? 0.6 : 1 }}
          >
            {pending === action ? '…' : ACTION_LABELS[action]}
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 'var(--spacing-2)',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-state-error)'
          }}
        >
          {error}
        </div>
      )}

      {dialog === 'supersede' && (
        <SupersedeDecisionModal
          projectId={projectId}
          decision={decision}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'archive' && (
        <ArchiveDecisionModal
          projectId={projectId}
          decision={decision}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
