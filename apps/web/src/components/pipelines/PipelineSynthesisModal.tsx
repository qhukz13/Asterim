import React, { useState } from 'react';
import { pipelineSynthesisBranchName } from '@asterim/shared';
import type { PipelineRun, PipelineSynthesisResult } from '@asterim/shared';
import { pipelineStepTone } from '../../stores/usePipelineStore';

/**
 * Consolidating a run's step branches into one an operator can open a PR from
 * (P9-03).
 *
 * The dialog exists rather than a single button because a synthesis is a choice
 * about which work to keep: the default is every step that passed, and the
 * reason it is only a default is that a run can pass a step whose work an
 * operator has looked at and does not want. Deselecting it here is the only
 * place that decision can be made without going to a terminal.
 *
 * Nothing here touches the operator's own branch. The Core builds
 * `asterim/pipeline/<runId>/pr` on the run's base commit in a throwaway
 * checkout, and a conflict aborts the whole consolidation rather than leaving
 * half of one behind — so the worst outcome of pressing the button is an error
 * message naming the files that disagree.
 */

export interface PipelineSynthesisModalViewProps {
  run: PipelineRun;
  /** Which steps the operator has chosen, by step id. */
  selectedStepIds: string[];
  onToggleStep: (stepId: string) => void;
  message: string;
  onMessageChange: (message: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  isSynthesizing?: boolean;
  error?: string | null;
  /** The branch a previous synthesis of this run produced, when there was one. */
  result?: PipelineSynthesisResult | null;
}

/** The dialog's presentation, driven entirely by props. */
export function PipelineSynthesisModalView({
  run,
  selectedStepIds,
  onToggleStep,
  message,
  onMessageChange,
  onSubmit,
  onClose,
  isSynthesizing = false,
  error = null,
  result = null
}: PipelineSynthesisModalViewProps) {
  const passing = run.steps.filter(step => step.status === 'PASSED');
  const chosen = new Set(selectedStepIds);
  const nothingChosen = chosen.size === 0;

  return (
    <div className="dialog-overlay" role="dialog" aria-label="Synthesize pull request">
      <div className="dialog-box glass-panel" style={{ maxWidth: '560px', width: '100%' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--color-text-primary)' }}>
          Synthesize pull request
        </h3>
        <p style={{ margin: '6px 0 12px', fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
          Merges the chosen step branches into{' '}
          <code style={{ fontFamily: 'var(--font-family-mono)' }}>
            {pipelineSynthesisBranchName(run.id)}
          </code>
          , on the commit the run started from. Your own branch is not touched.
        </p>

        {passing.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-state-error)' }}>
            No step of this run passed, so there is nothing to consolidate.
          </p>
        ) : (
          <ul
            aria-label="Steps to consolidate"
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              maxHeight: '220px',
              overflowY: 'auto'
            }}
          >
            {passing.map(step => {
              const tone = pipelineStepTone(step.status);
              return (
                <li key={step.stepId}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--color-surface-2)',
                      fontSize: '0.82rem',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={chosen.has(step.stepId)}
                      onChange={() => onToggleStep(step.stepId)}
                      aria-label={`Include ${step.stepName}`}
                    />
                    <span style={{ flex: 1, color: 'var(--color-text-primary)' }}>{step.stepName}</span>
                    <span
                      style={{
                        fontFamily: 'var(--font-family-mono)',
                        fontSize: '0.72rem',
                        color: tone.color
                      }}
                    >
                      {step.worktreeBranch || step.stepId}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <label style={{ display: 'block', marginTop: '12px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Summary commit message (optional)
          </span>
          <input
            type="text"
            value={message}
            onChange={event => onMessageChange(event.target.value)}
            aria-label="Synthesis commit message"
            placeholder="Asterim pipeline — what this run produced"
            style={{
              width: '100%',
              marginTop: '4px',
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-surface-0)',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-primary)',
              fontSize: '0.82rem',
              boxSizing: 'border-box'
            }}
          />
        </label>

        {error && (
          <p role="alert" style={{ margin: '10px 0 0', fontSize: '0.8rem', color: 'var(--color-state-error)' }}>
            {error}
          </p>
        )}

        {result && (
          <p
            aria-live="polite"
            style={{ margin: '10px 0 0', fontSize: '0.8rem', color: 'var(--color-state-completed)' }}
          >
            {result.branchName} carries {result.mergedStepIds.join(', ')} at{' '}
            {result.commitSha.slice(0, 7)}
            {result.skippedStepIds.length > 0
              ? `. ${result.skippedStepIds.join(', ')} had nothing to contribute.`
              : '.'}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border-default)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: '0.82rem'
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={nothingChosen || isSynthesizing}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-accent-primary)',
              background: nothingChosen ? 'transparent' : 'var(--color-accent-subtle)',
              color: nothingChosen ? 'var(--color-text-muted)' : 'var(--color-accent-primary)',
              cursor: nothingChosen || isSynthesizing ? 'not-allowed' : 'pointer',
              fontSize: '0.82rem',
              fontWeight: 'var(--font-weight-semibold)'
            }}
          >
            {isSynthesizing ? 'Consolidating…' : 'Synthesize'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The dialog with its own selection state, over a run and the store's actions. */
export function PipelineSynthesisModal({
  run,
  defaultStepIds,
  onSynthesize,
  onClose,
  isSynthesizing,
  error,
  result
}: {
  run: PipelineRun;
  defaultStepIds: string[];
  onSynthesize: (stepIds: string[], message: string) => void;
  onClose: () => void;
  isSynthesizing?: boolean;
  error?: string | null;
  result?: PipelineSynthesisResult | null;
}) {
  const [selected, setSelected] = useState<string[]>(defaultStepIds);
  const [message, setMessage] = useState('');

  return (
    <PipelineSynthesisModalView
      run={run}
      selectedStepIds={selected}
      onToggleStep={stepId =>
        setSelected(current =>
          current.includes(stepId)
            ? current.filter(entry => entry !== stepId)
            : [...current, stepId]
        )
      }
      message={message}
      onMessageChange={setMessage}
      onSubmit={() => onSynthesize(selected, message.trim())}
      onClose={onClose}
      isSynthesizing={isSynthesizing}
      error={error}
      result={result}
    />
  );
}
