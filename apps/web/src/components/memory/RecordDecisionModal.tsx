import React, { useState } from 'react';
import { useMemoryStore } from '../../stores/useMemoryStore';

/**
 * Splits a textarea's contents into a list.
 *
 * Accepts newlines or commas because both are natural to type, and drops blanks so
 * a trailing separator does not become an empty constraint.
 */
export function parseList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

export interface RecordDecisionModalProps {
  projectId: string;
  onClose: () => void;
  /** Called with the created decision once the write succeeds. */
  onRecorded?: (decisionId: string) => void;
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

export function RecordDecisionModal({ projectId, onClose, onRecorded }: RecordDecisionModalProps) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [rationale, setRationale] = useState('');
  const [constraints, setConstraints] = useState('');
  const [relatedFiles, setRelatedFiles] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    title.trim().length > 0 && summary.trim().length > 0 && rationale.trim().length > 0 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      // A decision typed by a person in this form is exactly what
      // HUMAN_CONFIRMED means (DEC-024), which is why it is set here rather
      // than offered as a field the user could contradict.
      const decision = await useMemoryStore.getState().createDecision(projectId, {
        title: title.trim(),
        summary: summary.trim(),
        rationale: rationale.trim(),
        constraints: parseList(constraints),
        relatedFiles: parseList(relatedFiles),
        provenance: 'HUMAN_CONFIRMED',
        confidence: 1.0
      });
      onRecorded?.(decision.id);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Could not record the decision');
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
        aria-label="Record a decision"
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
          Record a decision
        </h2>
        <p style={{ margin: '4px 0 var(--spacing-5)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          Every later agent session reads this before it starts work.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
          <div>
            <label style={labelStyle} htmlFor="decision-title">
              Title
            </label>
            <input
              id="decision-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Hash passwords with Argon2id"
              autoFocus
              style={fieldStyle}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="decision-summary">
              What was decided
            </label>
            <textarea
              id="decision-summary"
              value={summary}
              onChange={e => setSummary(e.target.value)}
              rows={2}
              placeholder="Argon2id, 64 MiB memory cost, 3 iterations."
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="decision-rationale">
              Why — including what was rejected
            </label>
            <textarea
              id="decision-rationale"
              value={rationale}
              onChange={e => setRationale(e.target.value)}
              rows={3}
              placeholder="Memory-hard; resists GPU attack in a way bcrypt does not."
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="decision-constraints">
              Constraints — one per line
            </label>
            <textarea
              id="decision-constraints"
              value={constraints}
              onChange={e => setConstraints(e.target.value)}
              rows={2}
              placeholder={'Never log the derived key\nRe-hash on login when parameters change'}
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="decision-files">
              Files this governs — one per line
            </label>
            <textarea
              id="decision-files"
              value={relatedFiles}
              onChange={e => setRelatedFiles(e.target.value)}
              rows={2}
              placeholder={'src/auth.ts\nsrc/session.ts'}
              style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'var(--font-family-mono)', fontSize: 'var(--font-size-xs)' }}
            />
            <p style={{ margin: '6px 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              An anchored decision surfaces automatically when an agent asks about that file.
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
              {submitting ? 'Recording…' : 'Record decision'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
