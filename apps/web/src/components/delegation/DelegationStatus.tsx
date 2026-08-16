import React from 'react';
import { worktreeBranchName } from '@asterim/shared';
import type {
  BatchDelegationResult,
  DelegationChildState,
  DelegationResult,
  VerificationPipelineReport,
  VerificationStepResult,
  WorktreeInfo
} from '@asterim/shared';
import {
  ThreadDiffView,
  WorktreeAction,
  batchStatusTone,
  delegationStatusTone,
  latestOutcomeFor,
  parseDelegationContext,
  useProjectStore,
  verificationStatusTone,
  verificationStepTone
} from '../../stores/useProjectStore';
import { useThreadStore } from '../../stores/useThreadStore';
import {
  IconAlertTriangle,
  IconCheck,
  IconFileCode,
  IconGitBranch,
  IconRefresh
} from '../icons/Icons';

/**
 * What the chat view says while another agent is doing the work (P7-02).
 *
 * Two states, one after the other. While a thread is parked behind a child it
 * shows who is working and on what, with a way into that child's transcript —
 * the thing a person actually wants when a session goes quiet is not a spinner
 * but somewhere to look. Once the child is done the banner is replaced by the
 * outcome, which is a card rather than a line of chat because a review verdict
 * and a list of touched files are things to scan, not to read.
 *
 * Both views are props-only. zustand v5 serves initial state as the server
 * snapshot, so a store-reading component renders empty under `react-dom/server`
 * and could not be tested at all; the container at the bottom is the only part
 * that touches a store.
 */

const pill: React.CSSProperties = {
  padding: '1px 7px',
  borderRadius: 'var(--radius-full, 999px)',
  fontSize: 'var(--font-size-xs, 11px)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  fontFamily: 'var(--font-family-mono)'
};

/** The same record without one key, for the panel state the container holds. */
function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const copy = { ...record };
  delete copy[key];
  return copy;
}

/** How a child's live state reads while the parent waits. */
export function childStateLabel(state: DelegationChildState | undefined): string {
  switch (state) {
    case 'STARTING':
      return 'Starting up';
    case 'ACTIVE':
      return 'Working';
    case 'COMPLETED':
      return 'Finished';
    case 'FAILED':
      return 'Failed';
    case 'TIMEOUT':
      return 'Timed out';
    default:
      return 'Working';
  }
}

/** One paragraph, cut to something that fits on a banner. */
export function summarySnippet(text: string | undefined, max = 180): string {
  if (!text) return '';
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/** The shared shape of the two buttons on the waiting banner. */
const bannerButton: React.CSSProperties = {
  flexShrink: 0,
  padding: '4px 10px',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-semibold)',
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
  transition: 'background 0.15s, color 0.15s'
};

/** One child a thread is currently parked behind. */
export interface PendingDelegationView {
  childThreadId: string;
  /** The role the child runs under, when it has one. */
  role?: string;
  state?: DelegationChildState;
  taskDescription?: string;
}

/** How many of a batch's children are still working. */
export function pendingProgress(children: PendingDelegationView[]): string {
  const finished = children.filter(
    child => child.state === 'COMPLETED' || child.state === 'FAILED' || child.state === 'TIMEOUT'
  ).length;
  return `${finished} of ${children.length} finished`;
}

/** The danger-tinted variant of the banner button, for the stop controls. */
const stopButton = (busy: boolean): React.CSSProperties => ({
  ...bannerButton,
  borderColor: 'var(--color-state-error)',
  color: 'var(--color-state-error)',
  cursor: busy ? 'default' : 'pointer',
  opacity: busy ? 0.6 : 1
});

export interface DelegationWaitingBannerProps {
  /** Every child this thread is waiting on. One of them is the common case. */
  children: PendingDelegationView[];
  onInspectChild: (childThreadId: string) => void;
  /**
   * Stops one child and, once it is the last one, gives this thread back
   * (P7-03). Omitted when there is nothing that could carry the request — the
   * banner then reads as before.
   */
  onCancel?: (childThreadId: string) => void;
  /**
   * Stops every child at once (P7-04). Only offered for a fan-out: with one
   * child running it would be the same button twice.
   */
  onCancelAll?: () => void;
  /** Child thread ids with a cancellation already in flight. */
  cancellingChildren?: Record<string, boolean>;
  /** Why the last cancellation was refused, when one was. */
  cancelError?: string | null;
}

/**
 * What the chat view says while other agents are doing the work.
 *
 * One child reads as a sentence — who is working, on what. Several read as a
 * list, because the question a person has during a fan-out is not "is it
 * working" but "which of them is still going", and that is four states to scan
 * rather than one to read. Each row carries its own way in and its own way out,
 * so stopping the one agent that has gone wrong does not mean stopping the
 * three that have not.
 */
export function DelegationWaitingBanner({
  children,
  onInspectChild,
  onCancel,
  onCancelAll,
  cancellingChildren = {},
  cancelError = null
}: DelegationWaitingBannerProps) {
  const pending = children || [];
  if (pending.length === 0) return null;
  const single = pending.length === 1 ? pending[0] : null;

  const frame: React.CSSProperties = {
    display: 'flex',
    alignItems: single ? 'center' : 'stretch',
    flexDirection: single ? 'row' : 'column',
    gap: 'var(--spacing-2)',
    padding: 'var(--spacing-2) var(--spacing-4)',
    background: 'var(--color-state-paused-bg)',
    borderBottom: '1px solid var(--color-border-subtle)',
    borderLeft: '2px solid var(--color-state-paused)',
    color: 'var(--color-text-primary)',
    fontSize: 'var(--font-size-xs)'
  };

  const dot = (
    <span
      className="delegation-pulse"
      style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: 'var(--color-state-paused)',
        flexShrink: 0
      }}
    />
  );

  const statePill = (state: DelegationChildState | undefined) => (
    <span
      style={{
        ...pill,
        color: 'var(--color-state-paused)',
        background: 'rgba(245, 158, 11, 0.18)'
      }}
    >
      {childStateLabel(state)}
    </span>
  );

  if (single) {
    const busy = !!cancellingChildren[single.childThreadId];
    return (
      <div role="status" style={{ ...frame, gap: 'var(--spacing-3)' }}>
        {dot}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-2)',
              fontWeight: 'var(--font-weight-semibold)'
            }}
          >
            <span>Delegated — waiting on {single.role || 'another agent'}</span>
            {statePill(single.state)}
          </div>
          {single.taskDescription && (
            <div
              style={{
                color: 'var(--color-text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {summarySnippet(single.taskDescription)}
            </div>
          )}
          {cancelError && (
            <div role="alert" style={{ color: 'var(--color-state-error)' }}>
              {cancelError}
            </div>
          )}
        </div>
        <button onClick={() => onInspectChild(single.childThreadId)} style={bannerButton}>
          Inspect Child Thread
        </button>
        {onCancel && (
          <button
            onClick={() => onCancel(single.childThreadId)}
            disabled={busy}
            aria-label="Cancel delegation"
            title="Stop the delegated agent and continue in this thread"
            style={stopButton(busy)}
          >
            {busy ? 'Cancelling…' : 'Cancel Delegation'}
          </button>
        )}
      </div>
    );
  }

  const allBusy = pending.every(child => cancellingChildren[child.childThreadId]);

  return (
    <div role="status" style={frame}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
        {dot}
        <span style={{ fontWeight: 'var(--font-weight-semibold)' }}>
          Delegated — waiting on {pending.length} subagents
        </span>
        <span style={{ color: 'var(--color-text-secondary)' }}>{pendingProgress(pending)}</span>
        <div style={{ flex: 1 }} />
        {onCancelAll && (
          <button
            onClick={onCancelAll}
            disabled={allBusy}
            aria-label="Cancel all delegations"
            title="Stop every delegated agent and continue in this thread"
            style={stopButton(allBusy)}
          >
            {allBusy ? 'Cancelling…' : 'Cancel All'}
          </button>
        )}
      </div>

      {cancelError && (
        <div role="alert" style={{ color: 'var(--color-state-error)' }}>
          {cancelError}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)' }}>
        {pending.map(child => {
          const busy = !!cancellingChildren[child.childThreadId];
          return (
            <div
              key={child.childThreadId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-2)',
                minWidth: 0,
                paddingLeft: 'var(--spacing-4)'
              }}
            >
              <span
                style={{
                  fontWeight: 'var(--font-weight-semibold)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                }}
              >
                {child.role || 'Delegated agent'}
              </span>
              {statePill(child.state)}
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: 'var(--color-text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {summarySnippet(child.taskDescription, 90)}
              </span>
              <button
                onClick={() => onInspectChild(child.childThreadId)}
                aria-label={`Inspect ${child.role || child.childThreadId}`}
                style={bannerButton}
              >
                Inspect
              </button>
              {onCancel && (
                <button
                  onClick={() => onCancel(child.childThreadId)}
                  disabled={busy}
                  aria-label={`Stop ${child.role || child.childThreadId}`}
                  title="Stop this delegated agent; the others keep running"
                  style={stopButton(busy)}
                >
                  {busy ? '…' : 'Stop'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Sandbox and verification evidence (P8-03) --------------------------------

/**
 * What a delegation's evidence looks like on the card.
 *
 * A subagent that says the tests pass has made a claim; the diff and the
 * pipeline report are the evidence, and this is the part of the card that shows
 * them. It is one component used by both the single and the batch card, because
 * a fan-out's children are each owed the same three things: what they changed,
 * whether it still builds, and the two buttons that decide what happens to it.
 *
 * Props-only like everything else in this file. Every piece of interaction
 * state — which panels are open, which action is in flight, which one is
 * awaiting confirmation — is keyed by child thread id and handed down, so a
 * batch of four renders four independent panels from one flat set of maps.
 */
export interface SandboxEvidenceProps {
  /** Reports read on demand, which win over what the result carried. */
  reports?: Record<string, VerificationPipelineReport | null>;
  /** Diffs read on demand, same precedence. */
  diffs?: Record<string, ThreadDiffView | null>;
  /** Sandboxes as the Core last described them. */
  worktrees?: Record<string, WorktreeInfo | null>;
  /** Child thread ids whose step breakdown is open. */
  expandedSteps?: Record<string, boolean>;
  /** Child thread ids whose diff preview is open. */
  expandedDiffs?: Record<string, boolean>;
  /** Child thread id → the lifecycle action in flight for it. */
  busy?: Record<string, WorktreeAction>;
  /** Child thread id → an action that has been asked for once and wants a second click. */
  confirming?: Record<string, 'MERGE' | 'DISCARD'>;
  /** Child thread id → what the last action came back with. */
  notices?: Record<string, { tone: 'error' | 'success'; message: string }>;
  onToggleSteps?: (childThreadId: string) => void;
  onToggleDiff?: (childThreadId: string) => void;
  onReverify?: (childThreadId: string) => void;
  onMerge?: (childThreadId: string) => void;
  onDiscard?: (childThreadId: string) => void;
  /** Copies a failing step's output. Omitted when nothing can reach a clipboard. */
  onCopy?: (text: string) => void;
}

/** How many lines of a sandbox diff the preview draws before it stops. */
export const MAX_DIFF_PREVIEW_LINES = 400;

/** How a diff line is tinted. */
export type DiffLineTone = 'meta' | 'added' | 'removed' | 'context';

/**
 * What one line of a unified diff is.
 *
 * `---` and `+++` are checked before `-` and `+` on purpose: a file header is
 * not a deletion of three characters, and tinting it rose is the one mistake
 * that makes an otherwise readable patch look like carnage.
 */
export function diffLineTone(line: string): DiffLineTone {
  if (
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('@@') ||
    line.startsWith('new file mode') ||
    line.startsWith('deleted file mode') ||
    line.startsWith('similarity index') ||
    line.startsWith('rename ')
  ) {
    return 'meta';
  }
  if (line.startsWith('+')) return 'added';
  if (line.startsWith('-')) return 'removed';
  return 'context';
}

/** The colour a diff line is drawn in, always from a token. */
export function diffLineColor(tone: DiffLineTone): string {
  switch (tone) {
    case 'added':
      return 'var(--color-state-completed)';
    case 'removed':
      return 'var(--color-state-error)';
    case 'meta':
      return 'var(--color-text-muted)';
    default:
      return 'var(--color-text-secondary)';
  }
}

/** The preview of a patch, bounded, and how much of it was left out. */
export function diffPreview(diff: string | undefined): { lines: string[]; hidden: number } {
  if (!diff) return { lines: [], hidden: 0 };
  const all = diff.split('\n');
  if (all.length <= MAX_DIFF_PREVIEW_LINES) return { lines: all, hidden: 0 };
  return {
    lines: all.slice(0, MAX_DIFF_PREVIEW_LINES),
    hidden: all.length - MAX_DIFF_PREVIEW_LINES
  };
}

/** The branch a thread's sandbox sits on, named the way `git worktree list` does. */
export function sandboxBranchLabel(
  childThreadId: string,
  branch?: string | null
): string {
  return branch || worktreeBranchName(childThreadId);
}

/** One step's command, how long it took, and what it exited as. */
export function verificationStepDetail(step: VerificationStepResult): string {
  const seconds = (step.durationMs / 1000).toFixed(1);
  const ending = step.error ? step.error : `exit ${step.exitCode ?? 'none'}`;
  return `${step.command} · ${seconds}s · ${ending}`;
}

/** Everything a failing step printed, as one block to copy. */
export function stepOutput(step: VerificationStepResult): string {
  return [step.stdoutSummary, step.stderrSummary].filter(Boolean).join('\n').trim();
}

/** The shared shape of the small buttons on the evidence panel. */
const evidenceButton = (busy = false, danger = false): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '3px 8px',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-semibold)',
  background: 'transparent',
  border: `1px solid ${danger ? 'var(--color-state-error)' : 'var(--color-border-default)'}`,
  borderRadius: 'var(--radius-sm)',
  color: danger ? 'var(--color-state-error)' : 'var(--color-text-secondary)',
  cursor: busy ? 'default' : 'pointer',
  opacity: busy ? 0.6 : 1,
  transition: 'background 0.15s, color 0.15s'
});

const sectionLabel: React.CSSProperties = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em'
};

/** The bounded, scrollable box a failing step's output is shown in. */
const outputBox: React.CSSProperties = {
  margin: 0,
  padding: 'var(--spacing-2)',
  maxHeight: '180px',
  overflow: 'auto',
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-xs)',
  fontFamily: 'var(--font-family-mono)',
  fontSize: 'var(--font-size-xs)',
  lineHeight: 'var(--line-height-normal)',
  color: 'var(--color-text-secondary)',
  whiteSpace: 'pre-wrap'
};

/**
 * What the project's own checks said, and the steps behind it.
 *
 * The badge is the answer and the accordion is the working, in that order, for
 * the same reason the batch card puts its verdict at the top: the first thing
 * an operator decides is whether anything needs their attention. A failing step
 * is the one row that carries its output with it — a red pipeline that will not
 * say *why* is a reason to go and run it by hand, which is exactly the work
 * this subsystem exists to save.
 */
export function VerificationEvidence({
  childThreadId,
  report,
  evidence = {}
}: {
  childThreadId: string;
  report: VerificationPipelineReport | null | undefined;
  evidence?: SandboxEvidenceProps;
}) {
  const status = verificationStatusTone(report);
  const expanded = !!evidence.expandedSteps?.[childThreadId];
  const verifying = evidence.busy?.[childThreadId] === 'VERIFYING';
  const steps = report?.steps || [];

  return (
    <div
      aria-label="Verification evidence"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-2)',
        padding: 'var(--spacing-2) var(--spacing-3)',
        borderTop: '1px solid var(--color-border-subtle)'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--spacing-2)',
          fontSize: 'var(--font-size-xs)'
        }}
      >
        <span style={sectionLabel}>Verification</span>
        <span
          role="status"
          style={{
            ...pill,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            color: status.color,
            background: status.background
          }}
        >
          {status.tone === 'completed' ? '✓' : status.tone === 'failed' ? '✗' : '•'} {status.label}
        </span>
        <div style={{ flex: 1 }} />
        {steps.length > 0 && evidence.onToggleSteps && (
          <button
            onClick={() => evidence.onToggleSteps?.(childThreadId)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide verification steps' : 'Show verification steps'}
            style={evidenceButton()}
          >
            {expanded ? 'Hide Steps' : `Show Steps (${steps.length})`}
          </button>
        )}
        {evidence.onReverify && (
          <button
            onClick={() => evidence.onReverify?.(childThreadId)}
            disabled={verifying}
            aria-label="Re-run verification"
            title="Run the project’s own typecheck, lint, test and build over this work again"
            style={evidenceButton(verifying)}
          >
            <IconRefresh size={11} />
            {verifying ? 'Verifying…' : 'Re-run Verification'}
          </button>
        )}
      </div>

      {expanded && steps.length > 0 && (
        <div
          aria-label="Verification steps"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}
        >
          {steps.map(step => {
            const stepStatus = verificationStepTone(step.passed);
            const output = stepOutput(step);
            return (
              <div
                key={step.name}
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)' }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--spacing-2)',
                    fontSize: 'var(--font-size-xs)'
                  }}
                >
                  <span style={{ ...pill, color: stepStatus.color, background: stepStatus.background }}>
                    {step.passed ? '✓' : '✗'} {step.name}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-family-mono)',
                      color: 'var(--color-text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {verificationStepDetail(step)}
                  </span>
                </div>

                {!step.passed && output && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)' }}>
                    {evidence.onCopy && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => evidence.onCopy?.(output)}
                          aria-label={`Copy ${step.name} output`}
                          title="Copy this step’s output"
                          style={evidenceButton()}
                        >
                          Copy
                        </button>
                      </div>
                    )}
                    <pre aria-label={`${step.name} output`} style={outputBox}>
                      {output}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The sandbox a delegated agent worked in, and what happens to it now.
 *
 * The two buttons are the decision at the end of a delegation, and both ask
 * twice. Merging writes to the operator's real checkout and discarding throws
 * work away; neither is something to do by brushing past a card, and a second
 * click costs nothing next to either mistake.
 */
export function SandboxEvidence({
  childThreadId,
  worktreePath,
  branch,
  changes,
  evidence = {}
}: {
  childThreadId: string;
  worktreePath?: string;
  branch?: string;
  changes?: ThreadDiffView | null;
  evidence?: SandboxEvidenceProps;
}) {
  const changedFiles = changes?.changedFiles || [];
  const diff = changes?.diff || '';
  const expanded = !!evidence.expandedDiffs?.[childThreadId];
  const action = evidence.busy?.[childThreadId];
  const confirming = evidence.confirming?.[childThreadId];
  const notice = evidence.notices?.[childThreadId];
  const preview = expanded ? diffPreview(diff) : { lines: [], hidden: 0 };

  return (
    <div
      aria-label="Sandbox"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-2)',
        padding: 'var(--spacing-2) var(--spacing-3)',
        borderTop: '1px solid var(--color-border-subtle)'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--spacing-2)',
          fontSize: 'var(--font-size-xs)'
        }}
      >
        <span
          title={worktreePath}
          style={{
            ...pill,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            color: 'var(--color-state-waiting)',
            background: 'var(--color-state-waiting-bg)',
            maxWidth: '320px',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          <IconGitBranch size={11} />
          Sandbox: {sandboxBranchLabel(childThreadId, branch)}
        </span>
        <span style={{ ...pill, color: 'var(--color-text-secondary)', background: 'var(--color-surface-2)' }}>
          {changedFiles.length} {changedFiles.length === 1 ? 'file changed' : 'files changed'}
        </span>
        <div style={{ flex: 1 }} />
        {diff && evidence.onToggleDiff && (
          <button
            onClick={() => evidence.onToggleDiff?.(childThreadId)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide diff' : 'View diff'}
            style={evidenceButton()}
          >
            {expanded ? 'Hide Diff' : 'View Diff'}
          </button>
        )}
        {evidence.onMerge && (
          <button
            onClick={() => evidence.onMerge?.(childThreadId)}
            disabled={action === 'MERGING'}
            aria-label="Merge changes"
            title="Merge this sandbox back into the working branch"
            style={evidenceButton(action === 'MERGING')}
          >
            {action === 'MERGING'
              ? 'Merging…'
              : confirming === 'MERGE'
                ? 'Confirm Merge'
                : 'Merge Changes'}
          </button>
        )}
        {evidence.onDiscard && (
          <button
            onClick={() => evidence.onDiscard?.(childThreadId)}
            disabled={action === 'DISCARDING'}
            aria-label="Discard sandbox"
            title="Throw this sandbox away, branch and directory both"
            style={evidenceButton(action === 'DISCARDING', true)}
          >
            {action === 'DISCARDING'
              ? 'Discarding…'
              : confirming === 'DISCARD'
                ? 'Confirm Discard'
                : 'Discard Sandbox'}
          </button>
        )}
      </div>

      {changedFiles.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-1)' }}>
          {changedFiles.map(path => (
            <span
              key={path}
              title={path}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 7px',
                fontFamily: 'var(--font-family-mono)',
                fontSize: 'var(--font-size-xs)',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-xs)',
                color: 'var(--color-text-secondary)',
                maxWidth: '260px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              <IconFileCode size={11} />
              {path}
            </span>
          ))}
        </div>
      )}

      {notice && (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          style={{
            fontSize: 'var(--font-size-xs)',
            color:
              notice.tone === 'error' ? 'var(--color-state-error)' : 'var(--color-state-completed)'
          }}
        >
          {notice.message}
        </div>
      )}

      {expanded && (
        <pre
          aria-label="Sandbox diff"
          style={{ ...outputBox, maxHeight: '320px' }}
        >
          {preview.lines.map((line, index) => (
            <div key={index} style={{ color: diffLineColor(diffLineTone(line)) }}>
              {line || ' '}
            </div>
          ))}
          {preview.hidden > 0 && (
            <div style={{ color: 'var(--color-text-muted)' }}>
              … {preview.hidden} more lines. Open the sandbox to read the rest.
            </div>
          )}
        </pre>
      )}
    </div>
  );
}

/** What one delegation's evidence resolves to, result and store both. */
export function resolveEvidence(
  result: DelegationResult,
  evidence: SandboxEvidenceProps = {}
): {
  report: VerificationPipelineReport | null;
  worktreePath?: string;
  branch?: string;
  changes: ThreadDiffView | null;
  hasSandbox: boolean;
  hasVerification: boolean;
} {
  const childThreadId = result.childThreadId;
  // `in` rather than `??`: a map that holds an explicit null has been read and
  // there is nothing there, which must not fall back to a stale result.
  const report =
    childThreadId && evidence.reports && childThreadId in evidence.reports
      ? evidence.reports[childThreadId]
      : (result.verificationReport ?? null);
  const changes =
    childThreadId && evidence.diffs && childThreadId in evidence.diffs
      ? evidence.diffs[childThreadId]
      : result.worktreePath !== undefined || result.diff !== undefined
        ? { diff: result.diff ?? '', changedFiles: result.changedFiles ?? [] }
        : null;

  const worktree = childThreadId ? evidence.worktrees?.[childThreadId] : null;
  const worktreePath = worktree?.path ?? result.worktreePath;

  return {
    report,
    worktreePath,
    branch: worktree?.branch,
    changes,
    hasSandbox: !!worktreePath,
    hasVerification: !!report
  };
}

/**
 * The evidence block under one delegation's summary, or nothing.
 *
 * Nothing is the common case and deliberately silent: a delegation that ran in
 * the operator's own checkout with no pipeline configured has no diff to show
 * and nothing to merge, and an empty panel saying so on every card would be
 * noise on the state that is already the default.
 */
export function DelegationEvidence({
  result,
  evidence
}: {
  result: DelegationResult;
  evidence?: SandboxEvidenceProps;
}) {
  const childThreadId = result.childThreadId;
  const resolved = resolveEvidence(result, evidence);
  if (!childThreadId || (!resolved.hasSandbox && !resolved.hasVerification)) return null;

  return (
    <>
      {resolved.hasVerification && (
        <VerificationEvidence
          childThreadId={childThreadId}
          report={resolved.report}
          evidence={evidence}
        />
      )}
      {resolved.hasSandbox && (
        <SandboxEvidence
          childThreadId={childThreadId}
          worktreePath={resolved.worktreePath}
          branch={resolved.branch}
          changes={resolved.changes}
          evidence={evidence}
        />
      )}
    </>
  );
}

export interface DelegationOutcomeCardProps {
  result: DelegationResult;
  onInspectChild: (childThreadId: string) => void;
  /** Opens an artifact the child named. Omitted when nothing can open it. */
  onOpenArtifact?: (path: string) => void;
  onDismiss?: () => void;
  /** The sandbox and verification evidence, and what may be done about it (P8-03). */
  evidence?: SandboxEvidenceProps;
}

export function DelegationOutcomeCard({
  result,
  onInspectChild,
  onOpenArtifact,
  onDismiss,
  evidence
}: DelegationOutcomeCardProps) {
  const status = delegationStatusTone(result.status);
  const isPass = result.verdict === 'PASS';

  return (
    <div
      role="region"
      aria-label="Delegation outcome"
      style={{
        margin: 'var(--spacing-2) var(--spacing-4)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--color-border-subtle)',
        borderLeft: `2px solid ${status.color}`,
        background: 'var(--color-surface-1)',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-2)',
          padding: 'var(--spacing-2) var(--spacing-3)',
          background: 'var(--color-surface-2)',
          borderBottom: '1px solid var(--color-border-subtle)',
          fontSize: 'var(--font-size-xs)'
        }}
      >
        {status.tone === 'completed' ? (
          <IconCheck size={13} color={status.color} />
        ) : (
          <IconAlertTriangle size={13} color={status.color} />
        )}
        <span
          style={{
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--color-text-primary)'
          }}
        >
          {result.role ? `${result.role} — delegation result` : 'Delegation result'}
        </span>
        <span style={{ ...pill, color: status.color, background: status.background }}>
          {result.status}
        </span>
        {result.verdict && (
          <span
            style={{
              ...pill,
              color: isPass ? 'var(--color-state-completed)' : 'var(--color-state-error)',
              background: isPass
                ? 'var(--color-state-completed-bg)'
                : 'var(--color-state-error-bg)'
            }}
          >
            {result.verdict}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => onInspectChild(result.childThreadId)}
          style={{
            padding: '3px 8px',
            fontSize: 'var(--font-size-xs)',
            background: 'transparent',
            border: '1px solid var(--color-border-default)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer'
          }}
        >
          Open Transcript
        </button>
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss delegation outcome"
            style={{
              padding: '3px 8px',
              fontSize: 'var(--font-size-xs)',
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer'
            }}
          >
            ×
          </button>
        )}
      </div>

      <div
        style={{
          padding: 'var(--spacing-3)',
          fontSize: 'var(--font-size-sm)',
          lineHeight: 'var(--line-height-normal)',
          color: 'var(--color-text-primary)',
          whiteSpace: 'pre-wrap'
        }}
      >
        {result.summary || 'The delegated agent returned no summary.'}
      </div>

      {result.artifacts && result.artifacts.length > 0 && (
        <div
          style={{
            padding: 'var(--spacing-2) var(--spacing-3)',
            borderTop: '1px solid var(--color-border-subtle)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 'var(--spacing-2)'
          }}
        >
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em'
            }}
          >
            Artifacts
          </span>
          {result.artifacts.map(path => (
            <button
              key={path}
              onClick={() => onOpenArtifact?.(path)}
              title={path}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 7px',
                fontFamily: 'var(--font-family-mono)',
                fontSize: 'var(--font-size-xs)',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-xs)',
                color: 'var(--color-accent-hover)',
                cursor: onOpenArtifact ? 'pointer' : 'default',
                maxWidth: '260px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              <IconFileCode size={11} />
              {path}
            </button>
          ))}
        </div>
      )}

      <DelegationEvidence result={result} evidence={evidence} />
    </div>
  );
}

export interface DelegationBatchOutcomeCardProps {
  batch: BatchDelegationResult;
  onInspectChild: (childThreadId: string) => void;
  onOpenArtifact?: (path: string) => void;
  onDismiss?: () => void;
  /** The evidence for every child in the batch, keyed by child thread id (P8-03). */
  evidence?: SandboxEvidenceProps;
}

/**
 * What a fan-out came back with (P7-04).
 *
 * The header is the answer — how many finished, and one verdict over every
 * review in the batch — and the rows below it are the working. That order is
 * deliberate: after four agents have run, the first thing the operator has to
 * decide is whether anything needs their attention, and only then which one.
 *
 * A child that failed is not collapsed away. The one that did not finish is the
 * row most likely to be worth opening, so every child gets the same treatment:
 * its status, its summary, its files, and a way into its transcript.
 */
export function DelegationBatchOutcomeCard({
  batch,
  onInspectChild,
  onOpenArtifact,
  onDismiss,
  evidence
}: DelegationBatchOutcomeCardProps) {
  const overall = batchStatusTone(batch.overallStatus);
  const passed = batch.aggregatedVerdict === 'PASS';

  return (
    <div
      role="region"
      aria-label="Parallel delegation outcome"
      style={{
        margin: 'var(--spacing-2) var(--spacing-4)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--color-border-subtle)',
        borderLeft: `2px solid ${overall.color}`,
        background: 'var(--color-surface-1)',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-2)',
          padding: 'var(--spacing-2) var(--spacing-3)',
          background: 'var(--color-surface-2)',
          borderBottom: '1px solid var(--color-border-subtle)',
          fontSize: 'var(--font-size-xs)'
        }}
      >
        {overall.tone === 'completed' ? (
          <IconCheck size={13} color={overall.color} />
        ) : (
          <IconAlertTriangle size={13} color={overall.color} />
        )}
        <span
          style={{
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--color-text-primary)'
          }}
        >
          {batch.results.length} agents — parallel delegation
        </span>
        <span style={{ ...pill, color: overall.color, background: overall.background }}>
          {batch.overallStatus}
        </span>
        {batch.aggregatedVerdict && (
          <span
            style={{
              ...pill,
              color: passed ? 'var(--color-state-completed)' : 'var(--color-state-error)',
              background: passed
                ? 'var(--color-state-completed-bg)'
                : 'var(--color-state-error-bg)'
            }}
          >
            {batch.aggregatedVerdict}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss delegation outcome"
            style={{
              padding: '3px 8px',
              fontSize: 'var(--font-size-xs)',
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer'
            }}
          >
            ×
          </button>
        )}
      </div>

      <div
        style={{
          padding: 'var(--spacing-2) var(--spacing-3)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-primary)'
        }}
      >
        {batch.summary}
      </div>

      {batch.results.map((result, index) => {
        const status = delegationStatusTone(result.status);
        const childPassed = result.verdict === 'PASS';
        return (
          <div
            key={result.childThreadId || `unstarted-${index}`}
            style={{
              padding: 'var(--spacing-2) var(--spacing-3)',
              borderTop: '1px solid var(--color-border-subtle)'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-2)',
                fontSize: 'var(--font-size-xs)'
              }}
            >
              <span
                style={{
                  fontWeight: 'var(--font-weight-semibold)',
                  color: 'var(--color-text-primary)'
                }}
              >
                {result.role || 'Delegated agent'}
              </span>
              <span style={{ ...pill, color: status.color, background: status.background }}>
                {result.status}
              </span>
              {result.verdict && (
                <span
                  style={{
                    ...pill,
                    color: childPassed ? 'var(--color-state-completed)' : 'var(--color-state-error)',
                    background: childPassed
                      ? 'var(--color-state-completed-bg)'
                      : 'var(--color-state-error-bg)'
                  }}
                >
                  {result.verdict}
                </span>
              )}
              <div style={{ flex: 1 }} />
              {result.childThreadId && (
                <button
                  onClick={() => onInspectChild(result.childThreadId)}
                  aria-label={`Open transcript for ${result.role || result.childThreadId}`}
                  style={{
                    padding: '3px 8px',
                    fontSize: 'var(--font-size-xs)',
                    background: 'transparent',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer'
                  }}
                >
                  Open Transcript
                </button>
              )}
            </div>

            <div
              style={{
                paddingTop: 'var(--spacing-1)',
                fontSize: 'var(--font-size-sm)',
                lineHeight: 'var(--line-height-normal)',
                color: 'var(--color-text-secondary)',
                whiteSpace: 'pre-wrap'
              }}
            >
              {result.summary || 'The delegated agent returned no summary.'}
            </div>

            {result.artifacts && result.artifacts.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 'var(--spacing-2)',
                  paddingTop: 'var(--spacing-1)'
                }}
              >
                {result.artifacts.map(path => (
                  <button
                    key={path}
                    onClick={() => onOpenArtifact?.(path)}
                    title={path}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 7px',
                      fontFamily: 'var(--font-family-mono)',
                      fontSize: 'var(--font-size-xs)',
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: 'var(--radius-xs)',
                      color: 'var(--color-accent-hover)',
                      cursor: onOpenArtifact ? 'pointer' : 'default',
                      maxWidth: '260px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <IconFileCode size={11} />
                    {path}
                  </button>
                ))}
              </div>
            )}

            {/* Each child of a fan-out gets its own evidence and its own two
                buttons: four subagents produce four sandboxes, and merging one
                of them says nothing about the other three. */}
            <DelegationEvidence result={result} evidence={evidence} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * What the thread header says about where this session's work is going.
 *
 * A thread running in a sandbox is not editing the operator's checkout, and
 * that is a fact about the session rather than about any one message in it —
 * so it belongs next to the thread's own controls, where it is visible without
 * scrolling to the outcome card.
 */
export function ThreadSandboxIndicator({
  branch,
  worktreePath,
  report
}: {
  branch?: string;
  worktreePath?: string;
  report?: VerificationPipelineReport | null;
}) {
  if (!branch && !worktreePath && !report) return null;
  const verification = report ? verificationStatusTone(report) : null;

  return (
    <div
      aria-label="Thread sandbox"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-2)' }}
    >
      {(branch || worktreePath) && (
        <span
          title={worktreePath || branch}
          style={{
            ...pill,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            color: 'var(--color-state-waiting)',
            background: 'var(--color-state-waiting-bg)'
          }}
        >
          <IconGitBranch size={11} />
          {branch || 'sandboxed'}
        </span>
      )}
      {verification && (
        <span
          title={verification.label}
          style={{ ...pill, color: verification.color, background: verification.background }}
        >
          {verification.tone === 'completed' ? '✓' : verification.tone === 'failed' ? '✗' : '•'}{' '}
          {verification.label}
        </span>
      )}
    </div>
  );
}

/** Store-connected sandbox indicator for the thread that is open. */
export function ThreadSandboxStatus() {
  const activeThreadId = useThreadStore(state => state.activeThreadId);
  const threads = useProjectStore(state => state.threads);
  const worktrees = useProjectStore(state => state.threadWorktrees);
  const reports = useProjectStore(state => state.threadVerificationReports);
  if (!activeThreadId) return null;

  const row = threads.find(thread => thread.id === activeThreadId);
  const context = parseDelegationContext(row?.delegation_context_json);
  const worktree = worktrees[activeThreadId];
  const branch =
    worktree?.branch ||
    context?.worktreeBranch ||
    (typeof row?.worktree_branch === 'string' ? row.worktree_branch : undefined);
  const worktreePath =
    worktree?.path ||
    context?.worktreePath ||
    (typeof row?.worktree_path === 'string' ? row.worktree_path : undefined);

  return (
    <ThreadSandboxIndicator
      branch={branch}
      worktreePath={worktreePath}
      report={reports[activeThreadId]}
    />
  );
}

export interface DelegationStatusViewProps {
  parentState: 'ACTIVE' | 'WAITING_FOR_CHILD';
  /** Every child this thread is parked behind, oldest first. */
  pendingChildren?: PendingDelegationView[];
  outcome: DelegationResult | null;
  /** The fan-out that just finished, when the last delegation was one. */
  batchOutcome?: BatchDelegationResult | null;
  onInspectChild: (childThreadId: string) => void;
  onOpenArtifact?: (path: string) => void;
  onDismissOutcome?: () => void;
  onCancel?: (childThreadId: string) => void;
  onCancelAll?: () => void;
  cancellingChildren?: Record<string, boolean>;
  cancelError?: string | null;
  /** Sandbox and verification evidence for whichever card is shown (P8-03). */
  evidence?: SandboxEvidenceProps;
}

/** The waiting banner, the outcome, or nothing — in that order. */
export function DelegationStatusView({
  parentState,
  pendingChildren,
  outcome,
  batchOutcome,
  onInspectChild,
  onOpenArtifact,
  onDismissOutcome,
  onCancel,
  onCancelAll,
  cancellingChildren,
  cancelError,
  evidence
}: DelegationStatusViewProps) {
  const pending = pendingChildren || [];

  if (parentState === 'WAITING_FOR_CHILD' && pending.length > 0) {
    return (
      <DelegationWaitingBanner
        // Offered only for a fan-out: with one child running, "Cancel All" and
        // "Cancel Delegation" would be the same button twice.
        onCancelAll={pending.length > 1 ? onCancelAll : undefined}
        {...{ children: pending, onInspectChild, onCancel, cancellingChildren, cancelError }}
      />
    );
  }

  // A batch wins over a single outcome: the last thing that finished under this
  // thread was a fan-out, and one of its children is not the answer to it.
  if (batchOutcome) {
    return (
      <DelegationBatchOutcomeCard
        batch={batchOutcome}
        onInspectChild={onInspectChild}
        onOpenArtifact={onOpenArtifact}
        onDismiss={onDismissOutcome}
        evidence={evidence}
      />
    );
  }

  if (outcome) {
    return (
      <DelegationOutcomeCard
        result={outcome}
        onInspectChild={onInspectChild}
        onOpenArtifact={onOpenArtifact}
        onDismiss={onDismissOutcome}
        evidence={evidence}
      />
    );
  }

  return null;
}

/**
 * Store-connected delegation status for the thread that is open.
 *
 * Syncs once per thread against `GET /threads/:id/children`, because the
 * parent's waiting state lives in the Core's memory and no event replays it to
 * a dashboard that connected after the delegation started.
 */
export function DelegationStatus({
  onInspectChild,
  onOpenArtifact,
  activeBackendUrl
}: {
  onInspectChild: (childThreadId: string) => void;
  onOpenArtifact?: (path: string) => void;
  activeBackendUrl?: string | null;
}) {
  const activeThreadId = useThreadStore(state => state.activeThreadId);
  const parentStates = useProjectStore(state => state.parentStates);
  const pendingChildren = useProjectStore(state => state.pendingChildren);
  const childStates = useProjectStore(state => state.childStates);
  const childTasks = useProjectStore(state => state.childTasks);
  const childRoles = useProjectStore(state => state.childRoles);
  const outcomes = useProjectStore(state => state.delegationOutcomes);
  const batches = useProjectStore(state => state.batchOutcomes);
  const children = useProjectStore(state => state.delegationChildren);
  const cancelling = useProjectStore(state => state.cancellingChildren);
  const syncDelegations = useProjectStore(state => state.syncDelegations);
  const cancelDelegation = useProjectStore(state => state.cancelDelegation);
  const cancelAllDelegations = useProjectStore(state => state.cancelAllDelegations);
  const worktrees = useProjectStore(state => state.threadWorktrees);
  const diffs = useProjectStore(state => state.threadDiffs);
  const reports = useProjectStore(state => state.threadVerificationReports);
  const worktreeActions = useProjectStore(state => state.worktreeActions);
  const mergeThreadWorktree = useProjectStore(state => state.mergeThreadWorktree);
  const discardThreadWorktree = useProjectStore(state => state.discardThreadWorktree);
  const verifyThreadWorktree = useProjectStore(state => state.verifyThreadWorktree);
  const fetchThreadWorktree = useProjectStore(state => state.fetchThreadWorktree);
  const fetchThreadVerification = useProjectStore(state => state.fetchThreadVerification);

  const [dismissed, setDismissed] = React.useState<string | null>(null);
  const [cancelError, setCancelError] = React.useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = React.useState<Record<string, boolean>>({});
  const [expandedDiffs, setExpandedDiffs] = React.useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = React.useState<Record<string, 'MERGE' | 'DISCARD'>>({});
  const [notices, setNotices] = React.useState<
    Record<string, { tone: 'error' | 'success'; message: string }>
  >({});

  React.useEffect(() => {
    if (activeThreadId) void syncDelegations(activeThreadId, activeBackendUrl);
  }, [activeThreadId, activeBackendUrl, syncDelegations]);

  // A refusal belongs to the delegation it was refused for, not to the thread.
  React.useEffect(() => setCancelError(null), [activeThreadId]);

  // Everything a sandbox panel was in the middle of belongs to the thread that
  // was open. Moving to another one starts from the same place a reload would.
  React.useEffect(() => {
    setConfirming({});
    setNotices({});
  }, [activeThreadId]);

  const outcome = latestOutcomeFor(activeThreadId, outcomes, children);
  const batch = activeThreadId ? (batches[activeThreadId] ?? null) : null;
  // Whose evidence this card would show: every child of a fan-out, or the one
  // child that produced a single outcome.
  const evidenceThreadIds = (
    batch ? batch.results.map(child => child.childThreadId) : [outcome?.childThreadId]
  )
    .filter((id): id is string => !!id)
    .join(',');

  /**
   * The evidence a reload does not have.
   *
   * The diff and the report travel on `delegation.completed`, so a dashboard
   * that was watching already has both. One that opened the thread afterwards
   * has neither — `latestOutcomeFor` rebuilds the outcome from the children
   * list, which carries no sandbox — and this is what fills them back in, once
   * per child rather than on every render.
   */
  const hydrated = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    for (const childThreadId of evidenceThreadIds.split(',').filter(Boolean)) {
      if (hydrated.current.has(childThreadId)) continue;
      hydrated.current.add(childThreadId);
      void fetchThreadWorktree(childThreadId, activeBackendUrl);
      void fetchThreadVerification(childThreadId, activeBackendUrl);
    }
  }, [evidenceThreadIds, activeBackendUrl, fetchThreadWorktree, fetchThreadVerification]);

  const toggle = (
    setter: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
    key: string
  ) => setter(current => ({ ...current, [key]: !current[key] }));

  const evidence: SandboxEvidenceProps = {
    reports,
    diffs,
    worktrees,
    expandedSteps,
    expandedDiffs,
    busy: worktreeActions,
    confirming,
    notices,
    onToggleSteps: childThreadId => toggle(setExpandedSteps, childThreadId),
    onToggleDiff: childThreadId => toggle(setExpandedDiffs, childThreadId),
    onReverify: async childThreadId => {
      setNotices(current => omit(current, childThreadId));
      const report = await verifyThreadWorktree(childThreadId, undefined, activeBackendUrl);
      if (!report) {
        setNotices(current => ({
          ...current,
          [childThreadId]: { tone: 'error', message: 'The workstation could not run verification.' }
        }));
        return;
      }
      // A fresh report is worth opening: the operator asked to see it run, and
      // the steps are the answer.
      setExpandedSteps(current => ({ ...current, [childThreadId]: true }));
    },
    // Both lifecycle actions ask twice. The first click arms the button and the
    // second one does it — merging writes to the operator's own checkout and
    // discarding destroys work, and neither belongs to a stray click.
    onMerge: async childThreadId => {
      if (confirming[childThreadId] !== 'MERGE') {
        setNotices(current => omit(current, childThreadId));
        setConfirming(current => ({ ...current, [childThreadId]: 'MERGE' }));
        return;
      }
      setConfirming(current => omit(current, childThreadId));
      const outcome = await mergeThreadWorktree(childThreadId, undefined, activeBackendUrl);
      setNotices(current => ({
        ...current,
        [childThreadId]: outcome.success
          ? { tone: 'success', message: 'Merged into the working branch.' }
          : { tone: 'error', message: outcome.error || 'The sandbox could not be merged.' }
      }));
    },
    onDiscard: async childThreadId => {
      if (confirming[childThreadId] !== 'DISCARD') {
        setNotices(current => omit(current, childThreadId));
        setConfirming(current => ({ ...current, [childThreadId]: 'DISCARD' }));
        return;
      }
      setConfirming(current => omit(current, childThreadId));
      const outcome = await discardThreadWorktree(childThreadId, activeBackendUrl);
      setNotices(current => ({
        ...current,
        [childThreadId]: outcome.success
          ? { tone: 'success', message: 'The sandbox was discarded.' }
          : { tone: 'error', message: outcome.error || 'The sandbox could not be discarded.' }
      }));
    },
    onCopy: text => {
      void navigator.clipboard?.writeText(text).catch(() => undefined);
    }
  };

  if (!activeThreadId) return null;

  const pending: PendingDelegationView[] = (pendingChildren[activeThreadId] || []).map(
    childThreadId => ({
      childThreadId,
      role: childRoles[childThreadId],
      state: childStates[childThreadId],
      taskDescription: childTasks[childThreadId]
    })
  );
  // One dismiss key for both cards: a batch is dismissed by the parent it ran
  // under, a single outcome by the child that produced it.
  const dismissKey = batch ? `batch:${activeThreadId}:${batch.finishedAt}` : outcome?.childThreadId;

  return (
    <DelegationStatusView
      parentState={parentStates[activeThreadId] || 'ACTIVE'}
      pendingChildren={pending}
      outcome={outcome && dismissKey !== dismissed ? outcome : null}
      batchOutcome={batch && dismissKey !== dismissed ? batch : null}
      onInspectChild={onInspectChild}
      onOpenArtifact={onOpenArtifact}
      onDismissOutcome={() => setDismissed(dismissKey ?? null)}
      onCancel={async childThreadId => {
        setCancelError(null);
        // A fan-out names the child that is being stopped; a single delegation
        // names the parent, which is the thread that is open, and lets the Core
        // resolve the child — doing that here would race the socket.
        const target = pending.length > 1 ? childThreadId : activeThreadId;
        const accepted = await cancelDelegation(target, undefined, activeBackendUrl);
        if (!accepted) setCancelError('The workstation would not stop this delegation.');
      }}
      onCancelAll={async () => {
        setCancelError(null);
        const accepted = await cancelAllDelegations(activeThreadId, undefined, activeBackendUrl);
        if (!accepted) setCancelError('The workstation would not stop these delegations.');
      }}
      cancellingChildren={cancelling}
      cancelError={cancelError}
      evidence={evidence}
    />
  );
}
