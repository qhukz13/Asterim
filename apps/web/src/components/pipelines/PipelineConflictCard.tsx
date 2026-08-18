import React from 'react';
import type { PipelineConflictAnalysis } from '@asterim/shared';
import { conflictSummary } from '../../stores/usePipelineStore';

/**
 * Whether a run's step branches can be combined, and where they cannot (P9-03).
 *
 * Shown before anything is merged, because that is the entire point of the
 * analysis: the Core answers it by merging the branches in a throwaway checkout
 * that is deleted afterwards, so an operator can find out whether a
 * consolidation *would* work without the repository having been changed to find
 * out. A card that only said "conflicts: yes" would send them to a terminal;
 * the paths and the pair of steps that disagree are the answer.
 */

export interface PipelineConflictCardProps {
  analysis: PipelineConflictAnalysis | null;
  isChecking?: boolean;
  onCheck?: () => void;
}

export function PipelineConflictCard({
  analysis,
  isChecking = false,
  onCheck
}: PipelineConflictCardProps) {
  const clean = !!analysis && !analysis.hasConflicts;

  return (
    <section
      aria-label="Conflict analysis"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: 'var(--spacing-3)',
        background: 'var(--color-surface-1)',
        border: `1px solid ${
          analysis?.hasConflicts ? 'var(--color-state-error)' : 'var(--color-border-subtle)'
        }`,
        borderRadius: 'var(--radius-lg)'
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-primary)' }}>
          Conflict analysis
        </h3>
        {onCheck && (
          <button
            type="button"
            onClick={onCheck}
            disabled={isChecking}
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border-default)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              cursor: isChecking ? 'progress' : 'pointer',
              fontSize: '0.78rem'
            }}
          >
            {isChecking ? 'Checking…' : analysis ? 'Check again' : 'Check conflicts'}
          </button>
        )}
      </header>

      <p
        aria-live="polite"
        style={{
          margin: 0,
          fontSize: '0.82rem',
          color: analysis?.hasConflicts
            ? 'var(--color-state-error)'
            : clean
              ? 'var(--color-state-completed)'
              : 'var(--color-text-secondary)'
        }}
      >
        {conflictSummary(analysis)}
      </p>

      {analysis?.hasConflicts && (
        <ul
          aria-label="Conflicting steps"
          style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}
        >
          {analysis.conflicts.map(conflict => (
            <li
              key={conflict.stepIds.join('~')}
              style={{
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-state-error-bg)',
                fontSize: '0.78rem',
                color: 'var(--color-text-secondary)'
              }}
            >
              <strong style={{ color: 'var(--color-text-primary)' }}>
                {conflict.stepIds[0]} ↔ {conflict.stepIds[1]}
              </strong>
              <div style={{ fontFamily: 'var(--font-family-mono)', marginTop: '2px', overflowWrap: 'anywhere' }}>
                {conflict.files.join(', ')}
              </div>
            </li>
          ))}
        </ul>
      )}

      {analysis && analysis.missingStepIds.length > 0 && (
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          No branch exists for {analysis.missingStepIds.join(', ')}, so nothing could be said about
          {analysis.missingStepIds.length === 1 ? ' it' : ' them'}.
        </p>
      )}
    </section>
  );
}
