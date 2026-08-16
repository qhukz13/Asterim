import React from 'react';
import type { DelegationChildState, DelegationResult } from '@asterim/shared';
import {
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

export interface DelegationWaitingBannerProps {
  /** The role the child runs under, when it has one. */
  role?: string;
  childThreadId: string;
  childState?: DelegationChildState;
  taskDescription?: string;
  onInspectChild: (childThreadId: string) => void;
}

export function DelegationWaitingBanner({
  role,
  childThreadId,
  childState,
  taskDescription,
  onInspectChild
}: DelegationWaitingBannerProps) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-3)',
        padding: 'var(--spacing-2) var(--spacing-4)',
        background: 'var(--color-state-paused-bg)',
        borderBottom: '1px solid var(--color-border-subtle)',
        borderLeft: '2px solid var(--color-state-paused)',
        color: 'var(--color-text-primary)',
        fontSize: 'var(--font-size-xs)'
      }}
    >
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-2)',
            fontWeight: 'var(--font-weight-semibold)'
          }}
        >
          <span>Delegated — waiting on {role || 'another agent'}</span>
          <span
            style={{
              ...pill,
              color: 'var(--color-state-paused)',
              background: 'rgba(245, 158, 11, 0.18)'
            }}
          >
            {childStateLabel(childState)}
          </span>
        </div>
        {taskDescription && (
          <div
            style={{
              color: 'var(--color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {summarySnippet(taskDescription)}
          </div>
        )}
      </div>
      <button
        onClick={() => onInspectChild(childThreadId)}
        style={{
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
        }}
      >
        Inspect Child Thread
      </button>
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

export interface DelegationStatusViewProps {
  parentState: 'ACTIVE' | 'WAITING_FOR_CHILD';
  pendingChildThreadId?: string;
  pendingChildRole?: string;
  pendingChildState?: DelegationChildState;
  pendingChildTask?: string;
  outcome: DelegationResult | null;
  onInspectChild: (childThreadId: string) => void;
  onOpenArtifact?: (path: string) => void;
  onDismissOutcome?: () => void;
}

/** The waiting banner, the outcome card, or nothing — in that order. */
export function DelegationStatusView({
  parentState,
  pendingChildThreadId,
  pendingChildRole,
  pendingChildState,
  pendingChildTask,
  outcome,
  onInspectChild,
  onOpenArtifact,
  onDismissOutcome
}: DelegationStatusViewProps) {
  if (parentState === 'WAITING_FOR_CHILD' && pendingChildThreadId) {
    return (
      <DelegationWaitingBanner
        role={pendingChildRole}
        childThreadId={pendingChildThreadId}
        childState={pendingChildState}
        taskDescription={pendingChildTask}
        onInspectChild={onInspectChild}
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
  const children = useProjectStore(state => state.delegationChildren);
  const syncDelegations = useProjectStore(state => state.syncDelegations);

  const [dismissed, setDismissed] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (activeThreadId) void syncDelegations(activeThreadId, activeBackendUrl);
  }, [activeThreadId, activeBackendUrl, syncDelegations]);

  if (!activeThreadId) return null;

  const pendingChildThreadId = pendingChildren[activeThreadId];
  const outcome = latestOutcomeFor(activeThreadId, outcomes, children);

  return (
    <DelegationStatusView
      parentState={parentStates[activeThreadId] || 'ACTIVE'}
      pendingChildThreadId={pendingChildThreadId}
      pendingChildRole={pendingChildThreadId ? childRoles[pendingChildThreadId] : undefined}
      pendingChildState={pendingChildThreadId ? childStates[pendingChildThreadId] : undefined}
      pendingChildTask={pendingChildThreadId ? childTasks[pendingChildThreadId] : undefined}
      outcome={outcome && outcome.childThreadId !== dismissed ? outcome : null}
      onInspectChild={onInspectChild}
      onOpenArtifact={onOpenArtifact}
      onDismissOutcome={() => setDismissed(outcome?.childThreadId ?? null)}
    />
  );
}
