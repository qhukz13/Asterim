import React, { useEffect } from 'react';
import { summarizeVerificationReport } from '@asterim/shared';
import type {
  PipelineStep,
  PipelineStepRun,
  VerificationPipelineReport
} from '@asterim/shared';
import {
  attemptLabel,
  formatPipelineDuration,
  pipelineStepTone,
  shortSha,
  stepDurationMs,
  usePipelineStore
} from '../../stores/usePipelineStore';

/**
 * One step of a run, in as much detail as the Core kept (P9-03).
 *
 * A DAG node can say that a step failed. What an operator needs next is why, and
 * that is four separate pieces of evidence which are deliberately not summarized
 * into one: the brief the step was handed, what its agent said, what it changed
 * in its own checkout, and what the project's own commands said about the
 * result. The last of those is the one that cannot be argued with — an agent
 * reporting "tests pass" and a `pnpm test` that exited non-zero disagree, and
 * only one of them ran the tests.
 *
 * The branch is shown as a branch name rather than as a path. The checkout under
 * `.asterim/worktrees/pipeline/` is where the work happened, but the branch is
 * what survives it and what a synthesis consolidates, so it is what a person
 * needs to be able to copy.
 */

const label: React.CSSProperties = {
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--color-text-muted)'
};

const mono: React.CSSProperties = {
  fontFamily: 'var(--font-family-mono)',
  fontSize: '0.75rem',
  color: 'var(--color-text-primary)',
  overflowWrap: 'anywhere'
};

const block: React.CSSProperties = {
  margin: 0,
  padding: '8px 10px',
  maxHeight: '220px',
  overflow: 'auto',
  background: 'var(--color-surface-0)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'var(--font-family-mono)',
  fontSize: '0.72rem',
  lineHeight: 1.5,
  color: 'var(--color-text-secondary)',
  whiteSpace: 'pre-wrap'
};

function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
      <span style={label}>{name}</span>
      <span style={mono}>{children}</span>
    </div>
  );
}

export interface PipelineStepInspectorViewProps {
  /** The row for this step of this run, or null when the run has not reached it. */
  step: PipelineStepRun | null;
  /** What the definition asked this step to do. */
  definition?: PipelineStep | null;
  /** What the project's own checks said about the thread the step ran in. */
  verification?: VerificationPipelineReport | null;
  onClose?: () => void;
  /** Opens the step's own transcript, which outlives the run. */
  onOpenThread?: (threadId: string) => void;
  now?: number;
}

/** The inspector's presentation, driven entirely by props. */
export function PipelineStepInspectorView({
  step,
  definition = null,
  verification = null,
  onClose,
  onOpenThread,
  // Not defaulted here: a component may not call `Date.now()` during a render,
  // and `stepDurationMs` defaults it itself.
  now
}: PipelineStepInspectorViewProps) {
  if (!step && !definition) {
    return (
      <aside
        aria-label="Step inspector"
        style={{
          padding: 'var(--spacing-3)',
          color: 'var(--color-text-secondary)',
          fontSize: '0.85rem'
        }}
      >
        Select a step in the graph to inspect it.
      </aside>
    );
  }

  const status = step?.status ?? 'PENDING';
  const tone = pipelineStepTone(status);
  const attempts = step ? attemptLabel(step, definition?.retries) : null;
  const duration = step ? stepDurationMs(step, now) : null;

  return (
    <aside
      aria-label="Step inspector"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-3)',
        padding: 'var(--spacing-3)',
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        minHeight: 0,
        overflowY: 'auto'
      }}
    >
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3
            style={{
              margin: 0,
              fontSize: '0.95rem',
              color: 'var(--color-text-primary)',
              overflowWrap: 'anywhere'
            }}
          >
            {step?.stepName || definition?.name || step?.stepId || definition?.id}
          </h3>
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                color: tone.color,
                background: tone.background,
                borderRadius: 'var(--radius-full)',
                padding: '2px 8px'
              }}
            >
              {tone.label}
            </span>
            <span
              style={{
                fontSize: '0.7rem',
                fontFamily: 'var(--font-family-mono)',
                color: 'var(--color-accent-primary)',
                background: 'var(--color-accent-subtle)',
                borderRadius: 'var(--radius-full)',
                padding: '2px 8px'
              }}
            >
              {step?.roleProfileId || definition?.roleProfileId || 'unassigned role'}
            </span>
            {attempts && (
              <span
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--color-state-paused)',
                  background: 'var(--color-state-paused-bg)',
                  borderRadius: 'var(--radius-full)',
                  padding: '2px 8px'
                }}
              >
                {attempts}
              </span>
            )}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close step inspector"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: '0.8rem'
            }}
          >
            Close
          </button>
        )}
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: '10px'
        }}
      >
        <Field name="Step id">{step?.stepId || definition?.id}</Field>
        <Field name="Duration">{formatPipelineDuration(duration)}</Field>
        <Field name="Branch">{step?.worktreeBranch || 'no fleet branch'}</Field>
        <Field name="Commit">{shortSha(step?.commitSha)}</Field>
      </div>

      {step?.worktreePath && <Field name="Checkout">{step.worktreePath}</Field>}

      {step?.errorMessage && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: '8px 10px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-state-error-bg)',
            color: 'var(--color-state-error)',
            fontSize: '0.8rem'
          }}
        >
          {step.errorMessage}
        </p>
      )}

      {definition?.task && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={label}>Task brief</span>
          <p style={block}>{definition.task}</p>
        </section>
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={label}>Agent transcript</span>
        {step?.output ? (
          <pre style={block}>{step.output}</pre>
        ) : (
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            This step has said nothing yet.
          </p>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={label}>Diff</span>
        {step?.diff ? (
          <pre style={block}>{step.diff}</pre>
        ) : (
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            This step changed nothing in its checkout.
          </p>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={label}>Verification</span>
        {verification ? (
          <>
            <p
              style={{
                margin: 0,
                fontSize: '0.78rem',
                color: verification.passed
                  ? 'var(--color-state-completed)'
                  : 'var(--color-state-error)'
              }}
            >
              {summarizeVerificationReport(verification)}
            </p>
            <ul
              aria-label="Verification steps"
              style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}
            >
              {verification.steps.map(entry => (
                <li
                  key={entry.name}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '8px',
                    fontSize: '0.75rem',
                    fontFamily: 'var(--font-family-mono)',
                    color: entry.passed
                      ? 'var(--color-state-completed)'
                      : 'var(--color-state-error)'
                  }}
                >
                  <span>{entry.name}</span>
                  <span>{entry.passed ? 'passed' : `failed (${entry.exitCode ?? 'killed'})`}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            Nothing was verified for this step.
          </p>
        )}
      </section>

      {step?.threadId && onOpenThread && (
        <button
          type="button"
          onClick={() => onOpenThread(step.threadId as string)}
          style={{
            alignSelf: 'flex-start',
            padding: '5px 12px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border-default)',
            background: 'transparent',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            fontSize: '0.78rem'
          }}
        >
          Open this step&rsquo;s thread
        </button>
      )}
    </aside>
  );
}

/**
 * Store-connected inspector.
 *
 * Holds a step id and reads the step out of the run, per
 * `blueprint/STORE_ARCHITECTURE.md`: a copy taken when the node was clicked
 * would stop moving the moment the step did.
 */
export function PipelineStepInspector({
  run,
  steps,
  onOpenThread,
  activeBackendUrl
}: {
  run: { steps: PipelineStepRun[] } | null;
  steps: PipelineStep[];
  onOpenThread?: (threadId: string) => void;
  activeBackendUrl?: string | null;
}) {
  const selectedStepId = usePipelineStore(state => state.selectedStepId);
  const selectStep = usePipelineStore(state => state.selectStep);
  const verificationByThreadId = usePipelineStore(state => state.verificationByThreadId);
  const fetchStepVerification = usePipelineStore(state => state.fetchStepVerification);

  const step = run?.steps.find(entry => entry.stepId === selectedStepId) ?? null;
  const definition = steps.find(entry => entry.id === selectedStepId) ?? null;
  const threadId = step?.threadId;

  useEffect(() => {
    // Asked for once per thread: the report is written when the step settles and
    // does not change afterwards.
    if (threadId && !(threadId in verificationByThreadId)) {
      void fetchStepVerification(threadId, activeBackendUrl);
    }
  }, [threadId, verificationByThreadId, fetchStepVerification, activeBackendUrl]);

  if (!selectedStepId) return <PipelineStepInspectorView step={null} />;

  return (
    <PipelineStepInspectorView
      step={step}
      definition={definition}
      verification={threadId ? (verificationByThreadId[threadId] ?? null) : null}
      onClose={() => selectStep(null)}
      onOpenThread={onOpenThread}
    />
  );
}
