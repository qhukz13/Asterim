import React, { useState } from 'react';
import type { ProjectDecision } from '@asterim/shared';
import { useMemoryStore } from '../../stores/useMemoryStore';
import { parseList } from './RecordDecisionModal';
import { anchorLabels } from './DecisionExplorer';

/**
 * The related-file list a supersede dialog should start from.
 *
 * `relatedFiles` is derived from file-only code refs, so it misses paths that
 * carry a symbol. Falling back to the decision's anchors — minus the symbol part,
 * which is not a file — keeps a decision anchored to `src/auth.ts#hashPassword`
 * from losing its anchor when it is replaced.
 */
export function initialRelatedFiles(decision: ProjectDecision): string[] {
  const files = new Set<string>(decision.relatedFiles ?? []);
  for (const label of anchorLabels(decision)) {
    const [filePath] = label.split('#');
    // A symbol-only anchor has no path; `anchorLabels` renders it as the bare
    // symbol, which must not be mistaken for a file.
    const isSymbolOnly = !label.includes('#') && !label.includes('/') && !label.includes('.');
    if (filePath && !isSymbolOnly) files.add(filePath);
  }
  return Array.from(files);
}

export interface SupersedeDecisionModalProps {
  projectId: string;
  /** The decision being replaced. */
  decision: ProjectDecision;
  onClose: () => void;
  onSuperseded?: (replacementId: string) => void;
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

export function SupersedeDecisionModal({
  projectId,
  decision,
  onClose,
  onSuperseded
}: SupersedeDecisionModalProps) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [rationale, setRationale] = useState('');
  // Pre-populated: a replacement usually inherits most of what it replaces, and
  // retyping constraints from memory is how they quietly get dropped.
  const [constraints, setConstraints] = useState((decision.constraints ?? []).join('\n'));
  const [relatedFiles, setRelatedFiles] = useState(initialRelatedFiles(decision).join('\n'));
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
      const replacement = await useMemoryStore.getState().supersedeDecision(projectId, decision.id, {
        title: title.trim(),
        summary: summary.trim(),
        rationale: rationale.trim(),
        constraints: parseList(constraints),
        relatedFiles: parseList(relatedFiles),
        provenance: 'HUMAN_CONFIRMED',
        confidence: 1.0
      });
      onSuperseded?.(replacement.id);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Could not supersede the decision');
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
        aria-label="Supersede decision"
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
          Supersede decision
        </h2>
        <p style={{ margin: '4px 0 var(--spacing-5)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          Replacing{' '}
          <span style={{ color: 'var(--color-text-primary)' }}>{decision.title}</span>. The old decision stays in
          the timeline, marked superseded and linked to this one.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
          <div>
            <label style={labelStyle} htmlFor="supersede-title">
              New title
            </label>
            <input
              id="supersede-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Hash passwords with Argon2id"
              autoFocus
              style={fieldStyle}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="supersede-summary">
              What is decided now
            </label>
            <textarea
              id="supersede-summary"
              value={summary}
              onChange={e => setSummary(e.target.value)}
              rows={2}
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="supersede-rationale">
              Why the previous decision no longer holds
            </label>
            <textarea
              id="supersede-rationale"
              value={rationale}
              onChange={e => setRationale(e.target.value)}
              rows={3}
              placeholder="What changed since it was made."
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="supersede-constraints">
              Constraints — carried over, edit as needed
            </label>
            <textarea
              id="supersede-constraints"
              value={constraints}
              onChange={e => setConstraints(e.target.value)}
              rows={2}
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="supersede-files">
              Files this governs — carried over, edit as needed
            </label>
            <textarea
              id="supersede-files"
              value={relatedFiles}
              onChange={e => setRelatedFiles(e.target.value)}
              rows={2}
              style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'var(--font-family-mono)', fontSize: 'var(--font-size-xs)' }}
            />
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
              {submitting ? 'Replacing…' : 'Replace decision'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
