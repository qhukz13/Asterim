import React from 'react';
import type { TeamTurnQueueItem, TeamTurnQueueState } from '@asterim/shared';
import {
  activeOperator,
  authorInitials,
  canCancelTurn,
  formatRelativeTime,
  pendingTurnCount,
  queuePositionLabel,
  threadStateTone,
  turnStatusLabel,
  useTeamAgentStore
} from '../../stores/useTeamAgentStore';

/**
 * The live turn queue of one collaborative thread (P8-02, DEC-031 § 2).
 *
 * A shared agent serves one instruction at a time, so the question this panel
 * answers is not "what did the agent say" — the transcript is for that — but
 * "why is nothing happening yet, and where am I in the line". Three things,
 * in the order a waiting member looks for them:
 *
 *   1. **What the thread is doing.** `IDLE`, `PROCESSING_TURN` or
 *      `AWAITING_APPROVAL`. The third is the one worth its own badge: the lock
 *      is held and nothing behind it can start, but what it is waiting for is a
 *      person in the room rather than the agent.
 *   2. **Who has it.** The turn holding the lock, whose it is, and how long it
 *      has been running — which is what makes a stuck turn visible as a stuck
 *      turn rather than as a queue that has quietly stopped moving.
 *   3. **Who is next.** The waiting turns in service order, each with its
 *      position, so nobody has to re-derive the order from timestamps.
 *
 * Withdrawing is offered only for turns that have not started. Cancelling the
 * active one would mean interrupting an agent mid-generation, which the Core
 * refuses; showing a button whose only outcome is that refusal would be worse
 * than showing none.
 */

const chip: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: 'var(--radius-full)',
  fontSize: 'var(--font-size-xs, 12px)',
  background: 'var(--color-surface-3)',
  color: 'var(--color-text-secondary)',
  whiteSpace: 'nowrap'
};

const avatar: React.CSSProperties = {
  width: '24px',
  height: '24px',
  flexShrink: 0,
  borderRadius: 'var(--radius-full)',
  background: 'var(--color-surface-3)',
  color: 'var(--color-text-secondary)',
  fontSize: '10px',
  fontWeight: 700,
  fontFamily: 'var(--font-family-mono)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

export interface ActiveTurnQueueInspectorViewProps {
  queue: TeamTurnQueueState | null;
  /** Withdraw a queued turn. Absent for a read-only inspector. */
  onCancelTurn?: (turn: TeamTurnQueueItem) => void;
  /** Which withdrawal is in flight, so only its own row shows it. */
  cancellingTurnId?: string | null;
  /**
   * Fixed clock, so the rendered wording can be asserted. Left undefined in the
   * app, where `formatRelativeTime` reads the clock — the read stays outside
   * the render, which must stay pure.
   */
  now?: number;
}

/**
 * The inspector's presentation, driven entirely by props.
 *
 * Split from the connected wrapper for the reason the MCP and skills panels
 * are: zustand v5 serves its initial state as the server snapshot, so a
 * store-reading component renders empty under `react-dom/server` and could not
 * be covered by a render test at all.
 */
export function ActiveTurnQueueInspectorView({
  queue,
  onCancelTurn,
  cancellingTurnId = null,
  now
}: ActiveTurnQueueInspectorViewProps) {
  const state = queue?.state ?? 'IDLE';
  const tone = threadStateTone(state);
  const operator = activeOperator(queue);
  const waiting = queue?.queuedTurns ?? [];

  return (
    <section
      aria-label="Turn queue"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-3)',
        padding: 'var(--spacing-3)',
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        minWidth: 0
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <h3
          style={{
            margin: 0,
            fontSize: 'var(--font-size-xs)',
            fontWeight: 'var(--font-weight-semibold)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--color-text-muted)'
          }}
        >
          Turn Queue
        </h3>
        <span
          aria-live="polite"
          style={{ ...chip, background: tone.background, color: tone.color, fontWeight: 600 }}
        >
          {tone.label}
        </span>
      </header>

      {operator ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: 'var(--spacing-2)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface-2)',
            border: `1px solid ${tone.color}`
          }}
        >
          <span style={{ ...avatar, color: tone.color }} aria-hidden="true">
            {authorInitials(operator.userName)}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-primary)',
                fontWeight: 'var(--font-weight-medium)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {operator.userName}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
              {queue?.activeTurn ? turnStatusLabel(queue.activeTurn.status) : 'Running'}
              {operator.startedAt ? ` · started ${formatRelativeTime(operator.startedAt, now)}` : ''}
            </div>
          </div>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          Nobody holds this thread right now. The next instruction runs immediately.
        </p>
      )}

      {queue?.activeTurn && (
        <p
          style={{
            margin: 0,
            fontSize: '0.82rem',
            color: 'var(--color-text-secondary)',
            lineHeight: 1.4,
            overflowWrap: 'anywhere'
          }}
        >
          {queue.activeTurn.instruction}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Waiting</span>
          <span style={chip}>{pendingTurnCount(queue)}</span>
        </div>

        {waiting.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            No instructions are waiting behind this one.
          </p>
        ) : (
          <ol
            aria-label="Queued turns"
            style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}
          >
            {waiting.map((turn, index) => (
              <li
                key={turn.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  padding: 'var(--spacing-2)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border-subtle)'
                }}
              >
                <span style={avatar} aria-hidden="true">
                  {authorInitials(turn.userName)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span
                      style={{
                        ...chip,
                        fontFamily: 'var(--font-family-mono)',
                        color: 'var(--color-accent-primary)',
                        background: 'var(--color-accent-subtle)'
                      }}
                    >
                      {queuePositionLabel(index)}
                    </span>
                    <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>
                      {turn.userName}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      submitted {formatRelativeTime(turn.queuedAt, now)}
                    </span>
                  </div>
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontSize: '0.8rem',
                      color: 'var(--color-text-secondary)',
                      lineHeight: 1.4,
                      overflowWrap: 'anywhere'
                    }}
                  >
                    {turn.instruction}
                  </p>
                </div>
                {onCancelTurn && canCancelTurn(turn) && (
                  <button
                    onClick={() => onCancelTurn(turn)}
                    disabled={cancellingTurnId === turn.id}
                    aria-label={`Withdraw the turn ${turn.userName} queued`}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-border-default)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-secondary)',
                      fontSize: '11px',
                      padding: '3px 8px',
                      cursor: cancellingTurnId === turn.id ? 'default' : 'pointer',
                      opacity: cancellingTurnId === turn.id ? 0.5 : 1
                    }}
                  >
                    {cancellingTurnId === turn.id ? 'Withdrawing…' : 'Withdraw'}
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/** Store-connected inspector for the open collaborative thread. */
export function ActiveTurnQueueInspector() {
  const queue = useTeamAgentStore(state => state.activeQueueState);
  const activeThread = useTeamAgentStore(state => state.activeThread);
  const cancellingTurnId = useTeamAgentStore(state => state.cancellingTurnId);
  const cancelTurn = useTeamAgentStore(state => state.cancelTurn);

  return (
    <ActiveTurnQueueInspectorView
      queue={queue}
      cancellingTurnId={cancellingTurnId}
      onCancelTurn={
        activeThread ? turn => void cancelTurn(activeThread.id, turn.id) : undefined
      }
    />
  );
}
