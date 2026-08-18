import React from 'react';
import { DEFAULT_TEAM_APPROVAL_POLICY } from '@asterim/shared';
import type {
  TeamApprovalDecision,
  TeamApprovalPolicy,
  TeamThreadViewer,
  TeamTurnQueueItem,
  TeamTurnQueueState
} from '@asterim/shared';
import {
  activeOperator,
  approvalPolicyLabel,
  approvalPolicyRequirement,
  authorInitials,
  awaitingApprovalTurn,
  canCancelTurn,
  canResolveApproval,
  effectiveApprovalPolicy,
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

export interface TurnApprovalCardProps {
  /** The turn parked on a prompt. */
  turn: TeamTurnQueueItem;
  policy: TeamApprovalPolicy;
  viewer?: TeamThreadViewer | null;
  /** Absent for a read-only surface; then the card explains without offering. */
  onResolve?: (turn: TeamTurnQueueItem, decision: TeamApprovalDecision) => void;
  isResolving?: boolean;
  now?: number;
}

/**
 * The prompt a parked turn is waiting on, and who may answer it (DEC-031 § 3).
 *
 * Three things, and all three are needed for the card to be actionable rather
 * than merely informative: whose turn is blocked and what it asked for; which
 * policy is in force, so a member who cannot answer knows who to go and find;
 * and the two answers, offered only to somebody the policy admits. Showing
 * Approve to a viewer would be offering a button whose only outcome is a 403,
 * and a shared thread stalled on a prompt nobody realises they must answer is
 * exactly the failure the queue was built to make visible.
 */
export function TurnApprovalCard({
  turn,
  policy,
  viewer = null,
  onResolve,
  isResolving = false,
  now
}: TurnApprovalCardProps) {
  const tone = threadStateTone('AWAITING_APPROVAL');
  const mayAnswer = canResolveApproval(policy, turn, viewer);

  const action = (decision: TeamApprovalDecision, text: string, accent: string) => (
    <button
      onClick={() => onResolve?.(turn, decision)}
      disabled={isResolving}
      aria-label={`${text} the pending action on ${turn.userName}'s turn`}
      style={{
        padding: '5px 12px',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${accent}`,
        background: 'transparent',
        color: accent,
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--font-weight-semibold)',
        cursor: isResolving ? 'default' : 'pointer',
        opacity: isResolving ? 0.5 : 1
      }}
    >
      {isResolving ? `${text}…` : text}
    </button>
  );

  return (
    <section
      aria-label="Approval required"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: 'var(--spacing-3)',
        borderRadius: 'var(--radius-md)',
        background: tone.background,
        border: `1px solid ${tone.color}`
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ ...avatar, color: tone.color }} aria-hidden="true">
          {authorInitials(turn.userName)}
        </span>
        <span
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--font-weight-semibold)',
            color: tone.color
          }}
        >
          {turn.userName}’s turn needs approval
        </span>
        <span style={{ ...chip, background: 'var(--color-surface-2)', color: tone.color }}>
          {approvalPolicyLabel(policy)}
        </span>
        {turn.startedAt && (
          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
            parked {formatRelativeTime(turn.startedAt, now)}
          </span>
        )}
      </div>

      <p
        style={{
          margin: 0,
          fontSize: '0.82rem',
          color: 'var(--color-text-secondary)',
          lineHeight: 1.4,
          overflowWrap: 'anywhere'
        }}
      >
        {turn.instruction}
      </p>

      <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
        {approvalPolicyRequirement(policy)}
      </p>

      {onResolve && mayAnswer ? (
        <div style={{ display: 'flex', gap: '8px' }}>
          {action('APPROVED', 'Approve', 'var(--color-accent-primary)')}
          {action('REJECTED', 'Reject', 'var(--color-state-error)')}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
          Your role cannot answer this one — the thread stays parked until somebody who can does.
        </p>
      )}
    </section>
  );
}

export interface ActiveTurnQueueInspectorViewProps {
  queue: TeamTurnQueueState | null;
  /** Withdraw a queued turn. Absent for a read-only inspector. */
  onCancelTurn?: (turn: TeamTurnQueueItem) => void;
  /** Which withdrawal is in flight, so only its own row shows it. */
  cancellingTurnId?: string | null;
  /** Answer the prompt a parked turn is waiting on. Absent when read-only. */
  onResolveApproval?: (turn: TeamTurnQueueItem, decision: TeamApprovalDecision) => void;
  /** Which approval answer is in flight. */
  resolvingApprovalTurnId?: string | null;
  /** The policy in force on this thread, which decides who may answer. */
  approvalPolicy?: TeamApprovalPolicy;
  /** Who is reading, as the Core reported them on this thread. */
  viewer?: TeamThreadViewer | null;
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
  onResolveApproval,
  resolvingApprovalTurnId = null,
  approvalPolicy = DEFAULT_TEAM_APPROVAL_POLICY,
  viewer = null,
  now
}: ActiveTurnQueueInspectorViewProps) {
  const state = queue?.state ?? 'IDLE';
  const tone = threadStateTone(state);
  const operator = activeOperator(queue);
  const waiting = queue?.queuedTurns ?? [];
  const parked = awaitingApprovalTurn(queue);

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

      {parked ? (
        // The instruction is inside the card in this case, so it is not also
        // repeated above it.
        <TurnApprovalCard
          turn={parked}
          policy={approvalPolicy}
          viewer={viewer}
          onResolve={onResolveApproval}
          isResolving={resolvingApprovalTurnId === parked.id}
          now={now}
        />
      ) : (
        queue?.activeTurn && (
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
        )
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
  const viewer = useTeamAgentStore(state => state.viewer);
  const resolvingApprovalTurnId = useTeamAgentStore(state => state.resolvingApprovalTurnId);
  const resolveApproval = useTeamAgentStore(state => state.resolveApproval);
  const agents = useTeamAgentStore(state => state.teamAgents);

  const agent = activeThread
    ? agents.find(entry => entry.id === activeThread.teamAgentId) ?? null
    : null;

  return (
    <ActiveTurnQueueInspectorView
      queue={queue}
      cancellingTurnId={cancellingTurnId}
      onCancelTurn={
        activeThread ? turn => void cancelTurn(activeThread.id, turn.id) : undefined
      }
      approvalPolicy={effectiveApprovalPolicy(activeThread, agent)}
      viewer={viewer}
      resolvingApprovalTurnId={resolvingApprovalTurnId}
      onResolveApproval={
        activeThread
          ? (turn, decision) => void resolveApproval(activeThread.id, turn.id, decision)
          : undefined
      }
    />
  );
}
