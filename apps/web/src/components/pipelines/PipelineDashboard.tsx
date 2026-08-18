import React, { useEffect, useState } from 'react';
import type { Pipeline, PipelineConflictAnalysis, PipelineRun, PipelineSynthesisResult } from '@asterim/shared';
import {
  formatPipelineDuration,
  passingStepIds,
  pipelineRunTone,
  runDurationMs,
  usePipelineStore
} from '../../stores/usePipelineStore';
import { IconPlus } from '../icons/Icons';
import { PipelineEditorModal } from './PipelineEditorModal';
import { PipelineRunView } from './PipelineRunView';
import { PipelineStepInspector } from './PipelineStepInspector';
import { PipelineSynthesisModal } from './PipelineSynthesisModal';

/**
 * The pipeline control plane (P9-03).
 *
 * Master-detail, because the two things an operator does here are different
 * sizes: choosing which pipeline and which of its runs to look at is a list, and
 * reading a run is a graph that needs the whole panel. The run history sits
 * under the definition it belongs to rather than in a list of its own — a run
 * has no meaning apart from the pipeline that produced it, and the question
 * being asked of the history is almost always "does this pipeline work", which
 * is a question about one definition's runs in sequence.
 */

export interface PipelineDashboardViewProps {
  pipelines: Pipeline[];
  activePipelineId: string | null;
  onSelectPipeline: (id: string) => void;
  /** The active pipeline's runs, newest first. */
  runs: PipelineRun[];
  activeRunId: string | null;
  onSelectRun: (id: string) => void;
  onRun?: (pipeline: Pipeline) => void;
  onCreate?: () => void;
  onEdit?: (pipeline: Pipeline) => void;
  selectedStepId?: string | null;
  onSelectStep?: (stepId: string) => void;
  onCancelRun?: (run: PipelineRun) => void;
  onCheckConflicts?: (run: PipelineRun) => void;
  onSynthesize?: (run: PipelineRun) => void;
  conflictAnalysis?: PipelineConflictAnalysis | null;
  inspector?: React.ReactNode;
  loading?: boolean;
  isRunning?: boolean;
  isCheckingConflicts?: boolean;
  error?: string | null;
  notice?: string | null;
  now?: number;
}

/** The dashboard's presentation, driven entirely by props. */
export function PipelineDashboardView({
  pipelines,
  activePipelineId,
  onSelectPipeline,
  runs,
  activeRunId,
  onSelectRun,
  onRun,
  onCreate,
  onEdit,
  selectedStepId = null,
  onSelectStep,
  onCancelRun,
  onCheckConflicts,
  onSynthesize,
  conflictAnalysis = null,
  inspector,
  loading = false,
  isRunning = false,
  isCheckingConflicts = false,
  error = null,
  notice = null,
  // Not defaulted here: a component may not call `Date.now()` during a render,
  // and the helpers that format a duration default it themselves.
  now
}: PipelineDashboardViewProps) {
  const activePipeline = pipelines.find(entry => entry.id === activePipelineId) ?? null;
  const activeRun = runs.find(entry => entry.id === activeRunId) ?? null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)',
        gap: 'var(--spacing-3)',
        height: '100%',
        minHeight: 0,
        padding: 'var(--spacing-4)',
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
    >
      <aside
        aria-label="Pipelines"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)', minHeight: 0 }}
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text-primary)' }}>Pipelines</h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
              Several agents, one graph, each in its own checkout.
            </p>
          </div>
          <button
            type="button"
            onClick={onCreate}
            aria-label="New pipeline"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-accent-primary)',
              background: 'var(--color-accent-subtle)',
              color: 'var(--color-accent-primary)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-semibold)'
            }}
          >
            <IconPlus size={12} color="currentColor" /> New
          </button>
        </header>

        {error && (
          <p role="alert" style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-state-error)' }}>
            {error}
          </p>
        )}
        {notice && !error && (
          <p aria-live="polite" style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
            {notice}
          </p>
        )}

        {loading && pipelines.length === 0 && (
          <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
            Loading pipelines…
          </p>
        )}

        {!loading && pipelines.length === 0 && (
          <div
            style={{
              border: '1px dashed var(--color-border-default)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--spacing-4)',
              color: 'var(--color-text-secondary)',
              fontSize: '0.82rem'
            }}
          >
            <p style={{ margin: 0 }}>No pipeline is defined yet.</p>
            <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
              A pipeline is a graph of delegated steps written down once and run many times.
            </p>
          </div>
        )}

        <ul
          aria-label="Pipeline definitions"
          style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto', minHeight: 0 }}
        >
          {pipelines.map(pipeline => {
            const selected = pipeline.id === activePipelineId;
            return (
              <li key={pipeline.id}>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${selected ? 'var(--color-accent-primary)' : 'var(--color-border-subtle)'}`,
                    background: selected ? 'var(--color-surface-2)' : 'var(--color-surface-1)'
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSelectPipeline(pipeline.id)}
                    aria-pressed={selected}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '2px',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'var(--color-text-primary)'
                    }}
                  >
                    <span style={{ fontSize: '0.85rem', fontWeight: 'var(--font-weight-semibold)' }}>
                      {pipeline.name}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                      {pipeline.definition.steps.length} step
                      {pipeline.definition.steps.length === 1 ? '' : 's'} · {pipeline.definition.trigger}
                    </span>
                  </button>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => onRun?.(pipeline)}
                      disabled={isRunning}
                      aria-label={`Run ${pipeline.name}`}
                      style={{
                        padding: '3px 10px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-accent-primary)',
                        background: 'transparent',
                        color: 'var(--color-accent-primary)',
                        cursor: isRunning ? 'progress' : 'pointer',
                        fontSize: '0.75rem'
                      }}
                    >
                      {isRunning ? 'Running…' : 'Run'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit?.(pipeline)}
                      aria-label={`Edit ${pipeline.name}`}
                      style={{
                        padding: '3px 10px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border-default)',
                        background: 'transparent',
                        color: 'var(--color-text-secondary)',
                        cursor: 'pointer',
                        fontSize: '0.75rem'
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {activePipeline && (
          <section aria-label="Run history" style={{ display: 'flex', flexDirection: 'column', gap: '4px', minHeight: 0 }}>
            <h2 style={{ margin: 0, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>
              Run history
            </h2>
            {runs.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                This pipeline has not run yet.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto', minHeight: 0 }}>
                {runs.map(run => {
                  const tone = pipelineRunTone(run.status);
                  return (
                    <li key={run.id}>
                      <button
                        type="button"
                        onClick={() => onSelectRun(run.id)}
                        aria-pressed={run.id === activeRunId}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          padding: '5px 8px',
                          borderRadius: 'var(--radius-sm)',
                          border: `1px solid ${run.id === activeRunId ? 'var(--color-border-strong)' : 'var(--color-border-subtle)'}`,
                          background: 'var(--color-surface-1)',
                          color: 'var(--color-text-secondary)',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          fontFamily: 'var(--font-family-mono)'
                        }}
                      >
                        <span>{formatPipelineDuration(runDurationMs(run, now))}</span>
                        <span style={{ color: tone.color }}>{tone.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </aside>

      <main style={{ minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
        {activeRun ? (
          <PipelineRunView
            run={activeRun}
            pipeline={activePipeline}
            selectedStepId={selectedStepId}
            onSelectStep={onSelectStep}
            onCancel={onCancelRun ? () => onCancelRun(activeRun) : undefined}
            onCheckConflicts={onCheckConflicts ? () => onCheckConflicts(activeRun) : undefined}
            onSynthesize={onSynthesize ? () => onSynthesize(activeRun) : undefined}
            conflictAnalysis={conflictAnalysis}
            isCheckingConflicts={isCheckingConflicts}
            inspector={inspector}
            now={now}
          />
        ) : (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-secondary)',
              fontSize: '0.85rem',
              textAlign: 'center',
              padding: 'var(--spacing-4)'
            }}
          >
            {activePipeline
              ? 'Run this pipeline, or pick a run from its history, to watch its graph.'
              : 'Select a pipeline to see its runs.'}
          </div>
        )}
      </main>
    </div>
  );
}

/** Store-connected dashboard. */
export function PipelineDashboard({
  projectId,
  workspaceId,
  activeBackendUrl,
  onOpenThread
}: {
  projectId: string | null;
  workspaceId?: string | null;
  activeBackendUrl?: string | null;
  onOpenThread?: (threadId: string) => void;
}) {
  const pipelines = usePipelineStore(state => state.pipelines);
  const activePipelineId = usePipelineStore(state => state.activePipelineId);
  const runs = usePipelineStore(state => state.runs);
  const activeRunId = usePipelineStore(state => state.activeRunId);
  const selectedStepId = usePipelineStore(state => state.selectedStepId);
  const conflictAnalysisByRunId = usePipelineStore(state => state.conflictAnalysisByRunId);
  const synthesisByRunId = usePipelineStore(state => state.synthesisByRunId);
  const loading = usePipelineStore(state => state.loading);
  const isRunning = usePipelineStore(state => state.isRunning);
  const isCheckingConflicts = usePipelineStore(state => state.isCheckingConflicts);
  const isSynthesizing = usePipelineStore(state => state.isSynthesizing);
  const error = usePipelineStore(state => state.error);
  const notice = usePipelineStore(state => state.notice);

  const fetchPipelines = usePipelineStore(state => state.fetchPipelines);
  const fetchPipeline = usePipelineStore(state => state.fetchPipeline);
  const runPipeline = usePipelineStore(state => state.runPipeline);
  const cancelRun = usePipelineStore(state => state.cancelRun);
  const checkConflicts = usePipelineStore(state => state.checkConflicts);
  const synthesizeRun = usePipelineStore(state => state.synthesizeRun);
  const selectPipeline = usePipelineStore(state => state.selectPipeline);
  const selectRun = usePipelineStore(state => state.selectRun);
  const selectStep = usePipelineStore(state => state.selectStep);
  const reset = usePipelineStore(state => state.reset);

  const [editing, setEditing] = useState<Pipeline | null>(null);
  const [isComposing, setComposing] = useState(false);
  const [synthesizing, setSynthesizing] = useState<PipelineRun | null>(null);

  useEffect(() => {
    // Another project's pipelines were never fetched, so a project change
    // reloads rather than filters — the rule the rest of the dashboard follows.
    reset();
    void fetchPipelines(projectId, workspaceId, activeBackendUrl);
  }, [projectId, workspaceId, activeBackendUrl, fetchPipelines, reset]);

  useEffect(() => {
    if (activePipelineId) void fetchPipeline(activePipelineId, activeBackendUrl);
  }, [activePipelineId, activeBackendUrl, fetchPipeline]);

  const activePipeline = pipelines.find(entry => entry.id === activePipelineId) ?? null;
  const visibleRuns = runs.filter(run => run.pipelineId === activePipelineId);
  const activeRun = runs.find(run => run.id === activeRunId) ?? null;
  const synthesis: PipelineSynthesisResult | null = activeRunId
    ? (synthesisByRunId[activeRunId] ?? null)
    : null;

  return (
    <>
      <PipelineDashboardView
        pipelines={pipelines}
        activePipelineId={activePipelineId}
        onSelectPipeline={selectPipeline}
        runs={visibleRuns}
        activeRunId={activeRunId}
        onSelectRun={selectRun}
        onRun={pipeline => {
          void runPipeline(pipeline.id, {}, activeBackendUrl);
        }}
        onCreate={() => {
          setEditing(null);
          setComposing(true);
        }}
        onEdit={pipeline => {
          setEditing(pipeline);
          setComposing(true);
        }}
        selectedStepId={selectedStepId}
        onSelectStep={selectStep}
        onCancelRun={run => {
          void cancelRun(run.id, undefined, activeBackendUrl);
        }}
        onCheckConflicts={run => {
          void checkConflicts(run.id, activeBackendUrl);
        }}
        onSynthesize={run => setSynthesizing(run)}
        conflictAnalysis={activeRunId ? (conflictAnalysisByRunId[activeRunId] ?? null) : null}
        isCheckingConflicts={isCheckingConflicts}
        inspector={
          <PipelineStepInspector
            run={activeRun}
            steps={activePipeline?.definition.steps ?? []}
            onOpenThread={onOpenThread}
            activeBackendUrl={activeBackendUrl}
          />
        }
        loading={loading}
        isRunning={isRunning}
        error={error}
        notice={notice}
      />

      {isComposing && (
        <PipelineEditorModal
          editing={editing}
          workspaceId={workspaceId}
          activeBackendUrl={activeBackendUrl}
          onClose={() => {
            setComposing(false);
            setEditing(null);
          }}
          onSaved={pipeline => selectPipeline(pipeline.id)}
        />
      )}

      {synthesizing && (
        <PipelineSynthesisModal
          run={synthesizing}
          defaultStepIds={passingStepIds(synthesizing)}
          isSynthesizing={isSynthesizing}
          error={error}
          result={synthesis}
          onSynthesize={(stepIds, message) => {
            void synthesizeRun(
              synthesizing.id,
              { stepIds, ...(message ? { message } : {}) },
              activeBackendUrl
            );
          }}
          onClose={() => setSynthesizing(null)}
        />
      )}
    </>
  );
}
