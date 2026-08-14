import React, { useState } from 'react';
import type { CandidateDecision } from '@asterim/shared';
import { useMemoryStore } from '../../stores/useMemoryStore';
import { IconFileCode, IconSparkles } from '../icons/Icons';

/**
 * The review queue for extracted decisions (DEC-027).
 *
 * Presented as a banner that opens rather than an always-expanded list: a
 * candidate is a *suggestion*, and suggestions should not sit at the same visual
 * weight as decisions a person actually made. Collapsed it is a count; opened it
 * is a queue with two one-click outcomes and nothing else to learn.
 */
export interface CandidateReviewDrawerProps {
  projectId: string | null;
  candidates: CandidateDecision[];
  /** Open on first render. Exposed so a render test can reach the expanded state. */
  initiallyOpen?: boolean;
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

function actionStyle(tone: 'accept' | 'discard'): React.CSSProperties {
  return {
    height: '26px',
    padding: '0 12px',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-semibold)' as any,
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
    background: tone === 'accept' ? 'var(--color-accent-primary)' : 'transparent',
    border: tone === 'accept' ? 'none' : '1px solid var(--color-border-default)',
    color: tone === 'accept' ? '#042114' : 'var(--color-text-secondary)'
  };
}

function CandidateCard({ projectId, candidate }: { projectId: string; candidate: CandidateDecision }) {
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: 'approve' | 'reject') => {
    setPending(action);
    setError(null);
    try {
      const store = useMemoryStore.getState();
      if (action === 'approve') await store.approveCandidate(projectId, candidate.id);
      else await store.rejectCandidate(projectId, candidate.id);
      // On success the store removes the candidate, so this component unmounts.
    } catch (err) {
      setError((err as Error).message || 'Could not review the candidate');
      setPending(null);
    }
  };

  const percent = Math.round((candidate.confidence ?? 0) * 100);

  return (
    <article style={{ ...panelStyle, background: 'var(--color-surface-1)', padding: 'var(--spacing-3)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-3)' }}>
        <h4
          style={{
            margin: 0,
            flex: 1,
            minWidth: 0,
            fontSize: 'var(--font-size-md)',
            fontWeight: 'var(--font-weight-semibold)' as any,
            color: 'var(--color-text-primary)'
          }}
        >
          {candidate.title}
        </h4>
        <span
          title="How strongly the extractor believes this is a decision. Approving makes it human-confirmed."
          style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}
        >
          suggested · {percent}%
        </span>
      </div>

      <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', lineHeight: 'var(--line-height-normal)' }}>
        {candidate.rationale}
      </p>

      {candidate.constraints.length > 0 && (
        <ul style={{ margin: 'var(--spacing-2) 0 0', paddingLeft: 'var(--spacing-4)' }}>
          {candidate.constraints.map((constraint: string, i: number) => (
            <li key={i} style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
              {constraint}
            </li>
          ))}
        </ul>
      )}

      {candidate.relatedFiles.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: 'var(--spacing-2)' }}>
          {candidate.relatedFiles.map((file: string) => (
            <span
              key={file}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontFamily: 'var(--font-family-mono)',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-muted)'
              }}
            >
              <IconFileCode size={10} />
              {file}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" style={{ marginTop: 'var(--spacing-2)', fontSize: 'var(--font-size-xs)', color: 'var(--color-state-error)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '6px', marginTop: 'var(--spacing-3)' }}>
        <button
          type="button"
          disabled={pending !== null}
          aria-label={`Approve: ${candidate.title}`}
          onClick={() => void run('approve')}
          style={{ ...actionStyle('accept'), opacity: pending ? 0.6 : 1 }}
        >
          {pending === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          disabled={pending !== null}
          aria-label={`Discard: ${candidate.title}`}
          onClick={() => void run('reject')}
          style={{ ...actionStyle('discard'), opacity: pending ? 0.6 : 1 }}
        >
          {pending === 'reject' ? 'Discarding…' : 'Discard'}
        </button>
      </div>
    </article>
  );
}

export function CandidateReviewDrawer({ projectId, candidates, initiallyOpen = false }: CandidateReviewDrawerProps) {
  const [open, setOpen] = useState(initiallyOpen);

  // Nothing suggested is the ordinary state; an empty banner would be noise.
  if (!projectId || candidates.length === 0) return null;

  return (
    <div style={{ ...panelStyle, padding: 'var(--spacing-3) var(--spacing-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', ...labelStyle }}>
          <IconSparkles size={12} />
          Suggested from your sessions
          <span
            style={{
              padding: '1px 7px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-accent-subtle)',
              color: 'var(--color-accent-primary)',
              letterSpacing: 0
            }}
          >
            {candidates.length}
          </span>
        </span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
          style={{
            height: '24px',
            padding: '0 10px',
            background: 'transparent',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-secondary)',
            fontSize: 'var(--font-size-xs)',
            fontWeight: 'var(--font-weight-medium)' as any,
            cursor: 'pointer'
          }}
        >
          {open ? 'Hide' : 'Review'}
        </button>
      </div>

      {!open && (
        <p style={{ margin: 'var(--spacing-2) 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          Nothing is recorded until you approve it.
        </p>
      )}

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)', marginTop: 'var(--spacing-3)' }}>
          {candidates.map(candidate => (
            <CandidateCard key={candidate.id} projectId={projectId} candidate={candidate} />
          ))}
        </div>
      )}
    </div>
  );
}
