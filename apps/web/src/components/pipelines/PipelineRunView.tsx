import React from 'react';
import type { Pipeline, PipelineConflictAnalysis, PipelineRun } from '@asterim/shared';
import {
  formatPipelineDuration,
  isRunFinished,
  pipelineRunTone,
  retriesByStepId,
  runDurationMs,
  runProgress,
  shortSha
} from '../../stores/usePipelineStore';
import { PipelineConflictCard } from './PipelineConflictCard';
import { PipelineDagGraph } from './PipelineDagGraph';

/**
 * One run, from its header down to its graph (P9-03).
 *
 * The header carries the four facts that are true of the run as a whole rather
 * than of any step: what it settled as, how long it took, the commit every step
 * branched from, and the branch a synthesis produced if one has. The base commit
 * is there because it is what makes a run reproducible — every step of the run
 * is measured against it, even if the operator's HEAD moved while the pipeline
 * was going.
 *
 * The three actions are separated by what they need. Cancel is only offered
 * while the run is live; conflicts and synthesis only once it is over, because
 * consolidating a pipeline mid-flight would produce a branch claiming to be the
 * run's result and not being it — which is what the Core refuses with a 409.
 */

export interface PipelineRunViewProps {
  run: PipelineRun;
  /** The definition the run was planned from, for the graph and the briefs. */
  pipeline?: Pipeline | null;
  selectedStepId?: string | null;
  onSelectStep?: (stepId: string) => void;
  onCancel?: () => void;
  onCheckConflicts?: () => void;
  onSynthesize?: () => void;
  conflictAnalysis?: PipelineConflictAnalysis | null;
  isCheckingConflicts?: boolean;
  /** The step inspector, rendered beside the graph when a node is selected. */
  inspector?: React.ReactNode;
  now?: number;
}

const metric: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px'
};

const metricLabel: React.CSSProperties = {
  fontSize: '0.68rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--color-text-muted)'
};

const metricValue: React.CSSProperties = {
  fontSize: '0.82rem',
  fontFamily: 'var(--font-family-mono)',
  color: 'var(--color-text-primary)'
};

const action: React.CSSProperties = {
  padding: '5px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-border-default)',
  background: 'var(--color-surface-2)',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  fontSize: '0.78rem'
};

export function PipelineRunView({
  run,
  pipeline = null,
  selectedStepId = null,
  onSelectStep,
  onCancel,
  onCheckConflicts,
  onSynthesize,
  conflictAnalysis = null,
  isCheckingConflicts = false,
  inspector,
  // Not defaulted here: a component may not call `Date.now()` during a render,
  // and the helpers that format a duration default it themselves.
  now
}: PipelineRunViewProps) {
  const tone = pipelineRunTone(run.status);
  const finished = isRunFinished(run);
  // The definition is the graph. A run adopted from a `pipeline:started` event
  // before its definition was fetched still has to draw, so its own step rows
  // stand in — as a row of independent nodes, which is what is actually known
  // about them until the definition arrives.
  const steps =
    pipeline?.definition.steps ??
    run.steps.map(step => ({
      id: step.stepId,
      name: step.stepName,
      roleProfileId: step.roleProfileId,
      task: '',
      dependsOn: [] as string[]
    }));
  const progress = runProgress(run);

  return (
    <section
      aria-label="Pipeline run"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)', minHeight: 0 }}
    >
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '12px',
          padding: 'var(--spacing-3)',
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-lg)'
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-text-primary)' }}>
            {pipeline?.name || 'Pipeline run'}
          </h2>
          <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-family-mono)', color: 'var(--color-text-muted)' }}>
            {run.id}
          </span>
        </div>

        <span
          style={{
            fontSize: '0.72rem',
            fontWeight: 600,
            color: tone.color,
            background: tone.background,
            borderRadius: 'var(--radius-full)',
            padding: '3px 10px'
          }}
        >
          {tone.label}
        </span>

        <div style={metric}>
          <span style={metricLabel}>Duration</span>
          <span style={metricValue}>{formatPipelineDuration(runDurationMs(run, now))}</span>
        </div>
        <div style={metric}>
          <span style={metricLabel}>Base commit</span>
          <span style={metricValue}>{shortSha(run.baseCommit)}</span>
        </div>
        <div style={metric}>
          <span style={metricLabel}>Steps</span>
          <span style={metricValue}>
            {run.steps.filter(step => step.status === 'PASSED').length}/{run.steps.length} passed
          </span>
        </div>
        {run.synthesisBranch && (
          <div style={metric}>
            <span style={metricLabel}>PR branch</span>
            <span style={metricValue}>{run.synthesisBranch}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {!finished && onCancel && (
            <button type="button" onClick={onCancel} style={action}>
              Cancel run
            </button>
          )}
          {finished && onCheckConflicts && (
            <button type="button" onClick={onCheckConflicts} disabled={isCheckingConflicts} style={action}>
              {isCheckingConflicts ? 'Checking…' : 'Check conflicts'}
            </button>
          )}
          {finished && onSynthesize && (
            <button
              type="button"
              onClick={onSynthesize}
              style={{
                ...action,
                border: '1px solid var(--color-accent-primary)',
                background: 'var(--color-accent-subtle)',
                color: 'var(--color-accent-primary)',
                fontWeight: 'var(--font-weight-semibold)'
              }}
            >
              Synthesize PR
            </button>
          )}
        </div>
      </header>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-label="Run progress"
        style={{
          height: '3px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--color-surface-2)',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            width: `${Math.round(progress * 100)}%`,
            height: '100%',
            background: tone.color,
            transition: 'width 0.2s ease'
          }}
        />
      </div>

      {run.errorMessage && (
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
          {run.errorMessage}
        </p>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: selectedStepId ? 'minmax(0, 1fr) minmax(280px, 380px)' : '1fr',
          gap: 'var(--spacing-3)',
          alignItems: 'start',
          minHeight: 0
        }}
      >
        <div
          style={{
            padding: 'var(--spacing-3)',
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-lg)',
            minWidth: 0
          }}
        >
          <PipelineDagGraph
            steps={steps}
            stepRuns={run.steps}
            selectedStepId={selectedStepId}
            onSelectStep={onSelectStep}
            retriesByStepId={retriesByStepId(steps)}
          />
        </div>
        {selectedStepId && inspector}
      </div>

      {finished && (
        <PipelineConflictCard
          analysis={conflictAnalysis}
          isChecking={isCheckingConflicts}
          onCheck={onCheckConflicts}
        />
      )}
    </section>
  );
}
