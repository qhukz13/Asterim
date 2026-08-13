import React, { useState } from 'react';
import type { ProjectDecision } from '@asterim/shared';
import { useMemoryStore } from '../../stores/useMemoryStore';
import { IconAlert } from '../icons/Icons';

export interface ArchiveDecisionModalProps {
  projectId: string;
  decision: ProjectDecision;
  onClose: () => void;
  onArchived?: (decisionId: string) => void;
}

/**
 * Confirmation for retiring a decision.
 *
 * Archiving is confirmed rather than applied directly because its effect is
 * invisible where it matters most: the decision leaves every future agent
 * briefing, so the next session is simply never told about it. Nothing in the
 * running system announces that absence. A user should have said so on purpose.
 */
export function ArchiveDecisionModal({ projectId, decision, onClose, onArchived }: ArchiveDecisionModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleArchive = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await useMemoryStore.getState().archiveDecision(projectId, decision.id);
      onArchived?.(decision.id);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Could not archive the decision');
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
        aria-label="Archive decision"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose();
        }}
        style={{
          width: '100%',
          maxWidth: '440px',
          background: 'var(--color-surface-3)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          padding: 'var(--spacing-6)',
          boxSizing: 'border-box'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-state-paused)' }}>
          <IconAlert size={15} />
          <h2
            style={{
              margin: 0,
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--font-weight-semibold)' as any,
              color: 'var(--color-text-primary)'
            }}
          >
            Archive this decision?
          </h2>
        </div>

        <p
          style={{
            margin: 'var(--spacing-4) 0 0',
            fontSize: 'var(--font-size-md)',
            color: 'var(--color-text-primary)',
            lineHeight: 'var(--line-height-normal)'
          }}
        >
          {decision.title}
        </p>

        <ul
          style={{
            margin: 'var(--spacing-4) 0 0',
            paddingLeft: 'var(--spacing-4)',
            fontSize: 'var(--font-size-sm)',
            lineHeight: 'var(--line-height-normal)',
            color: 'var(--color-text-secondary)'
          }}
        >
          <li>It is retired from agent briefings — future sessions will not be told about it.</li>
          <li>It stays in the timeline and remains searchable by status.</li>
          <li>Nothing is deleted, and it can be reactivated from the decision history.</li>
        </ul>

        {error && (
          <div
            role="alert"
            style={{
              marginTop: 'var(--spacing-4)',
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-2)', marginTop: 'var(--spacing-5)' }}>
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
            Keep it
          </button>
          <button
            type="button"
            onClick={handleArchive}
            disabled={submitting}
            style={{
              height: 'var(--control-height-md)',
              padding: '0 var(--spacing-4)',
              background: 'transparent',
              border: '1px solid var(--color-state-paused)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-state-paused)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-semibold)' as any,
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.6 : 1,
              transition: 'all var(--transition-fast)'
            }}
          >
            {submitting ? 'Archiving…' : 'Archive decision'}
          </button>
        </div>
      </div>
    </div>
  );
}
