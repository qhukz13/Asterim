import React from 'react';
import type {
  BatchDelegationResult,
  DelegationChildState,
  DelegationResult
} from '@asterim/shared';
import {
  batchStatusTone,
  delegationStatusTone,
  latestOutcomeFor,
  useProjectStore
} from '../../stores/useProjectStore';
import { useThreadStore } from '../../stores/useThreadStore';
import { IconAlertTriangle, IconCheck, IconFileCode } from '../icons/Icons';

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

export interface DelegationOutcomeCardProps {
  result: DelegationResult;
  onInspectChild: (childThreadId: string) => void;
  /** Opens an artifact the child named. Omitted when nothing can open it. */
  onOpenArtifact?: (path: string) => void;
  onDismiss?: () => void;
}

export function DelegationOutcomeCard({
  result,
  onInspectChild,
  onOpenArtifact,
  onDismiss
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
    </div>
  );
}

export interface DelegationBatchOutcomeCardProps {
  batch: BatchDelegationResult;
  onInspectChild: (childThreadId: string) => void;
  onOpenArtifact?: (path: string) => void;
  onDismiss?: () => void;
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
  onDismiss
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
          </div>
        );
      })}
    </div>
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
  cancelError
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

  const [dismissed, setDismissed] = React.useState<string | null>(null);
  const [cancelError, setCancelError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (activeThreadId) void syncDelegations(activeThreadId, activeBackendUrl);
  }, [activeThreadId, activeBackendUrl, syncDelegations]);

  // A refusal belongs to the delegation it was refused for, not to the thread.
  React.useEffect(() => setCancelError(null), [activeThreadId]);

  if (!activeThreadId) return null;

  const pending: PendingDelegationView[] = (pendingChildren[activeThreadId] || []).map(
    childThreadId => ({
      childThreadId,
      role: childRoles[childThreadId],
      state: childStates[childThreadId],
      taskDescription: childTasks[childThreadId]
    })
  );
  const outcome = latestOutcomeFor(activeThreadId, outcomes, children);
  const batch = batches[activeThreadId] ?? null;
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
    />
  );
}
