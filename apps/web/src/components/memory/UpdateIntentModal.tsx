import React, { useState } from 'react';
import type { ProjectIntent } from '@asterim/shared';
import { useMemoryStore } from '../../stores/useMemoryStore';
import { parseList } from './RecordDecisionModal';

export interface UpdateIntentModalProps {
  projectId: string;
  /** The intent in force, or null when the project has none yet. */
  currentIntent: ProjectIntent | null;
  onClose: () => void;
  onSaved?: (intentId: string) => void;
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: 'var(--spacing-2) var(--spacing-3)',
  background: 'var(--color-surface-1)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-primary)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'var(--font-family-sans)',
  lineHeight: 'var(--line-height-normal)',
  boxSizing: 'border-box'
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-semibold)' as any,
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em'
};

/**
 * Sets the project's current intent.
 *
 * There is no "edit" underneath this: `createIntent` archives whatever was active
 * and writes a new row, so a correction and a change of direction are the same
 * operation. Pre-populating the fields is what makes a correction practical, and
 * the dialog says plainly that the previous intent is being retired rather than
 * amended — the archived one stays readable in history either way.
 */
export function UpdateIntentModal({ projectId, currentIntent, onClose, onSaved }: UpdateIntentModalProps) {
  const [goal, setGoal] = useState(currentIntent?.goal ?? '');
  const [constraints, setConstraints] = useState((currentIntent?.constraints ?? []).join('\n'));
  const [nonGoals, setNonGoals] = useState((currentIntent?.nonGoals ?? []).join('\n'));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFirst = currentIntent === null;
  const canSubmit = goal.trim().length > 0 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const intent = await useMemoryStore.getState().createIntent(projectId, {
        goal: goal.trim(),
        constraints: parseList(constraints),
        nonGoals: parseList(nonGoals)
      });
      onSaved?.(intent.id);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Could not save the intent');
      setSubmitting(false);
    }
  };

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-bg-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--spacing-6)',
        zIndex: 'var(--z-index-modal)' as any
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isFirst ? 'Set project intent' : 'Update project intent'}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose();
        }}
        style={{
          width: '100%',
          maxWidth: '560px',
          maxHeight: '100%',
          overflowY: 'auto',
          background: 'var(--color-surface-3)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          padding: 'var(--spacing-6)',
          boxSizing: 'border-box'
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 'var(--font-size-lg)',
            fontWeight: 'var(--font-weight-semibold)' as any,
            color: 'var(--color-text-primary)'
          }}
        >
          {isFirst ? 'Set project intent' : 'Update project intent'}
        </h2>
        <p style={{ margin: '4px 0 var(--spacing-5)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          {isFirst
            ? 'What this project is currently trying to achieve. Every agent session reads it before starting work.'
            : 'Saving archives the current intent and makes this the active one. The old intent stays in history.'}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
          <div>
            <label style={labelStyle} htmlFor="intent-goal">
              Goal
            </label>
            <textarea
              id="intent-goal"
              value={goal}
              onChange={e => setGoal(e.target.value)}
              rows={2}
              placeholder="Migrate authentication to Argon2id across the server and relay"
              autoFocus
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="intent-constraints">
              Constraints — one per line
            </label>
            <textarea
              id="intent-constraints"
              value={constraints}
              onChange={e => setConstraints(e.target.value)}
              rows={2}
              placeholder={'No downtime\nExisting sessions stay valid'}
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="intent-nongoals">
              Not doing — one per line
            </label>
            <textarea
              id="intent-nongoals"
              value={nonGoals}
              onChange={e => setNonGoals(e.target.value)}
              rows={2}
              placeholder={'Changing the session token format'}
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
            <p style={{ margin: '6px 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Naming what is out of scope is the part that stops an agent widening the work.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              style={{
                padding: 'var(--spacing-3)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-state-error-bg)',
                color: 'var(--color-state-error)',
                fontSize: 'var(--font-size-sm)'
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-2)' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                height: 'var(--control-height-md)',
                padding: '0 var(--spacing-4)',
                background: 'transparent',
                border: '1px solid var(--color-border-default)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-secondary)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--font-weight-medium)' as any,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                height: 'var(--control-height-md)',
                padding: '0 var(--spacing-4)',
                background: canSubmit ? 'var(--color-accent-primary)' : 'var(--color-surface-2)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                color: canSubmit ? '#042114' : 'var(--color-text-muted)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--font-weight-semibold)' as any,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                transition: 'background var(--transition-fast)'
              }}
            >
              {submitting ? 'Saving…' : isFirst ? 'Set intent' : 'Replace intent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
