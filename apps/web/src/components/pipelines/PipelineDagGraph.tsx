import React from 'react';
import { topologicalPipelineOrder } from '@asterim/shared';
import type { PipelineStep, PipelineStepRun, PipelineStepStatus } from '@asterim/shared';
import { attemptLabel, pipelineStepTone } from '../../stores/usePipelineStore';

/**
 * The execution graph of one pipeline run (P9-03).
 *
 * A pipeline's parallelism is not written down anywhere — two steps run together
 * exactly when neither can reach the other through `dependsOn` — so the only
 * honest way to show a run is to draw the dependency graph and let the columns
 * be the answer. A node's column is its longest path from a root, which is why a
 * step that waits on a slow ancestor sits to the right of one that does not even
 * though both were declared next to each other.
 *
 * Native SVG and absolutely positioned buttons rather than a graph library: the
 * layout is a topological rank and eighty lines of arithmetic, and a node has to
 * stay a real focusable button so the graph is navigable by keyboard like every
 * other surface in the dashboard.
 */

/** One node's box. Wide enough for a role pill and a two-line name. */
export const DAG_NODE_WIDTH = 196;
export const DAG_NODE_HEIGHT = 86;
/** The gap between columns, which is where the edges are drawn. */
export const DAG_COLUMN_GAP = 64;
export const DAG_ROW_GAP = 20;

export interface DagNode {
  id: string;
  /** Longest path from a root: the column this node is drawn in. */
  column: number;
  /** Its place within that column. */
  row: number;
  x: number;
  y: number;
}

export interface DagEdge {
  from: string;
  to: string;
  /** An SVG path from the source's right edge to the target's left edge. */
  path: string;
}

export interface DagLayout {
  nodes: DagNode[];
  edges: DagEdge[];
  width: number;
  height: number;
  /** Step ids by column, which is what "these run together" means. */
  columns: string[][];
}

/**
 * Each step's column, as the longest path from a step with no dependencies.
 *
 * Longest path rather than shortest: a step that depends on both a root and on
 * something three columns deep cannot start until the deeper one is done, and
 * drawing it next to the root would claim a parallelism the DAG does not have.
 *
 * A dependency on a step that does not exist is not an edge — the parser refuses
 * those, and a draft being previewed in the editor should still draw.
 */
export function dagColumns(steps: readonly PipelineStep[]): string[][] {
  const known = new Set(steps.map(step => step.id));
  // `null` means the graph has a cycle, which the parser refuses; falling back
  // to declaration order keeps a hand-edited draft drawable rather than blank.
  const order = topologicalPipelineOrder(steps) ?? steps.map(step => step.id);
  const byId = new Map(steps.map(step => [step.id, step]));

  const column = new Map<string, number>();
  for (const id of order) {
    const dependencies = (byId.get(id)?.dependsOn ?? []).filter(
      dependency => known.has(dependency) && dependency !== id && column.has(dependency)
    );
    const depth = dependencies.reduce(
      (deepest, dependency) => Math.max(deepest, (column.get(dependency) ?? 0) + 1),
      0
    );
    column.set(id, depth);
  }

  const columns: string[][] = [];
  // Iterated over the declaration order rather than the topological one so two
  // steps that run together are stacked in the order the file lists them.
  for (const step of steps) {
    const index = column.get(step.id) ?? 0;
    while (columns.length <= index) columns.push([]);
    columns[index].push(step.id);
  }
  return columns;
}

/** Where every node and every edge of a DAG is drawn. */
export function computeDagLayout(steps: readonly PipelineStep[]): DagLayout {
  const columns = dagColumns(steps);
  const nodes: DagNode[] = [];
  const byId = new Map<string, DagNode>();

  columns.forEach((ids, columnIndex) => {
    ids.forEach((id, rowIndex) => {
      const node: DagNode = {
        id,
        column: columnIndex,
        row: rowIndex,
        x: columnIndex * (DAG_NODE_WIDTH + DAG_COLUMN_GAP),
        y: rowIndex * (DAG_NODE_HEIGHT + DAG_ROW_GAP)
      };
      nodes.push(node);
      byId.set(id, node);
    });
  });

  const edges: DagEdge[] = [];
  for (const step of steps) {
    const target = byId.get(step.id);
    if (!target) continue;
    for (const dependency of step.dependsOn ?? []) {
      const source = byId.get(dependency);
      if (!source || source.id === target.id) continue;
      const x1 = source.x + DAG_NODE_WIDTH;
      const y1 = source.y + DAG_NODE_HEIGHT / 2;
      const x2 = target.x;
      const y2 = target.y + DAG_NODE_HEIGHT / 2;
      const bend = Math.max(24, (x2 - x1) / 2);
      edges.push({
        from: dependency,
        to: step.id,
        path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
      });
    }
  }

  const rows = columns.reduce((widest, ids) => Math.max(widest, ids.length), 0);
  return {
    nodes,
    edges,
    columns,
    width: Math.max(
      DAG_NODE_WIDTH,
      columns.length * DAG_NODE_WIDTH + Math.max(0, columns.length - 1) * DAG_COLUMN_GAP
    ),
    height: Math.max(DAG_NODE_HEIGHT, rows * DAG_NODE_HEIGHT + Math.max(0, rows - 1) * DAG_ROW_GAP)
  };
}

/** An edge is live when the step it feeds is running, which is where the eye goes. */
export function edgeIsActive(
  edge: DagEdge,
  statusByStepId: Readonly<Record<string, PipelineStepStatus>>
): boolean {
  return statusByStepId[edge.to] === 'RUNNING' && statusByStepId[edge.from] === 'PASSED';
}

export interface PipelineDagGraphProps {
  /** The definition's steps: the graph itself. */
  steps: PipelineStep[];
  /** What each step of the open run is doing, when there is a run. */
  stepRuns?: PipelineStepRun[];
  selectedStepId?: string | null;
  onSelectStep?: (stepId: string) => void;
  /** Extra attempts each step is allowed, by step id, for the retry badge. */
  retriesByStepId?: Record<string, number>;
}

/** The DAG, drawn. Driven entirely by props. */
export function PipelineDagGraph({
  steps,
  stepRuns = [],
  selectedStepId = null,
  onSelectStep,
  retriesByStepId = {}
}: PipelineDagGraphProps) {
  const layout = computeDagLayout(steps);
  const runByStepId = new Map(stepRuns.map(step => [step.stepId, step]));
  const statusByStepId: Record<string, PipelineStepStatus> = {};
  for (const step of steps) statusByStepId[step.id] = runByStepId.get(step.id)?.status ?? 'PENDING';

  if (steps.length === 0) {
    return (
      <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
        This pipeline declares no steps.
      </p>
    );
  }

  return (
    <div
      role="group"
      aria-label="Pipeline execution graph"
      style={{ overflow: 'auto', padding: '4px', minHeight: 0 }}
    >
      <div
        style={{
          position: 'relative',
          width: `${layout.width}px`,
          height: `${layout.height}px`,
          minWidth: `${layout.width}px`
        }}
      >
        <svg
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
        >
          <defs>
            <marker
              id="asterim-dag-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--color-border-strong)" />
            </marker>
          </defs>
          {layout.edges.map(edge => {
            const active = edgeIsActive(edge, statusByStepId);
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                d={edge.path}
                fill="none"
                stroke={active ? 'var(--color-accent-primary)' : 'var(--color-border-strong)'}
                strokeWidth={active ? 2 : 1.25}
                markerEnd="url(#asterim-dag-arrow)"
              />
            );
          })}
        </svg>

        {layout.nodes.map(node => {
          const step = steps.find(entry => entry.id === node.id);
          const run = runByStepId.get(node.id);
          const status = statusByStepId[node.id];
          const tone = pipelineStepTone(status);
          const selected = selectedStepId === node.id;
          const attempt = run ? attemptLabel(run, retriesByStepId[node.id]) : null;

          return (
            <button
              key={node.id}
              type="button"
              data-step-id={node.id}
              aria-pressed={selected}
              aria-label={`Step ${step?.name || node.id} — ${tone.label}`}
              onClick={() => onSelectStep?.(node.id)}
              style={{
                position: 'absolute',
                left: `${node.x}px`,
                top: `${node.y}px`,
                width: `${DAG_NODE_WIDTH}px`,
                height: `${DAG_NODE_HEIGHT}px`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'center',
                gap: '4px',
                padding: '8px 10px',
                textAlign: 'left',
                background: selected ? 'var(--color-surface-3)' : 'var(--color-surface-2)',
                border: `1px solid ${
                  selected
                    ? 'var(--color-accent-primary)'
                    : status === 'RUNNING'
                      ? 'var(--color-state-working)'
                      : 'var(--color-border-subtle)'
                }`,
                borderLeft: `3px solid ${tone.color}`,
                borderRadius: 'var(--radius-md, 8px)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
                // The design system caps animation at 200ms; a status change is
                // a colour change, not a movement.
                transition: 'background 0.15s ease, border-color 0.15s ease',
                boxSizing: 'border-box',
                overflow: 'hidden'
              }}
            >
              <span
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 'var(--font-weight-semibold)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '100%'
                }}
              >
                {step?.name || node.id}
              </span>

              <span
                style={{
                  fontSize: '0.7rem',
                  fontFamily: 'var(--font-family-mono)',
                  color: 'var(--color-accent-primary)',
                  background: 'var(--color-accent-subtle)',
                  borderRadius: 'var(--radius-full)',
                  padding: '1px 7px',
                  maxWidth: '100%',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {run?.roleProfileId || step?.roleProfileId || 'unassigned role'}
              </span>

              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    color: tone.color,
                    background: tone.background,
                    borderRadius: 'var(--radius-full)',
                    padding: '1px 7px'
                  }}
                >
                  {tone.label}
                </span>
                {attempt && (
                  <span
                    style={{
                      fontSize: '0.68rem',
                      color: 'var(--color-state-paused)',
                      background: 'var(--color-state-paused-bg)',
                      borderRadius: 'var(--radius-full)',
                      padding: '1px 7px'
                    }}
                  >
                    {attempt}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
