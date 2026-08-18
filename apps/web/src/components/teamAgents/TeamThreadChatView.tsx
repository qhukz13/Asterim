import React, { useState } from 'react';
import { DEFAULT_TEAM_APPROVAL_POLICY } from '@asterim/shared';
import type {
  TeamAgent,
  TeamAgentMessage,
  TeamApprovalDecision,
  TeamApprovalPolicy,
  TeamThread,
  TeamThreadViewer,
  TeamTurnQueueItem,
  TeamTurnQueueState
} from '@asterim/shared';
import {
  authorInitials,
  awaitingApprovalTurn,
  canSubmitTurn,
  effectiveApprovalPolicy,
  formatRelativeTime,
  messageAuthorLabel,
  queueWaitNotice,
  threadStateTone,
  useTeamAgentStore
} from '../../stores/useTeamAgentStore';
import { ActiveTurnQueueInspectorView, TurnApprovalCard } from './ActiveTurnQueueInspector';
import { IconArrowLeft } from '../icons/Icons';

/**
 * One collaborative thread, read by everyone on the team at once (P8-02).
 *
 * The difference from the single-developer transcript is not the layout, it is
 * that a line here belongs to a person as well as to the thread. So every user
 * line is attributed — initials, name, and when it was said — because "who
 * asked for this" is the first thing a member scrolling into a conversation
 * already in progress needs, and an unattributed shared transcript reads as
 * one person contradicting themselves.
 *
 * Sending does not send. It queues: the instruction joins the thread's turn
 * queue and the Core answers 202, so the composer clears and the queue panel
 * beside it is where the instruction can be watched. That is why the queue
 * inspector is part of this view rather than a drawer somewhere else — a member
 * about to type needs to see that four people are ahead of them *before* they
 * type, not after.
 *
 * The composer is never disabled on a busy thread. Queueing behind a running
 * turn is the designed path (DEC-031 § 2); refusing input while the agent works
 * would put the team back to taking turns by hand, which is the problem the
 * queue exists to solve.
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
  width: '26px',
  height: '26px',
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

/** How a transcript line is toned: the agent gets the accent, people do not. */
export function messageTone(role: TeamAgentMessage['role']): {
  background: string;
  border: string;
  color: string;
} {
  if (role === 'assistant') {
    return {
      background: 'var(--color-surface-2)',
      border: 'var(--color-accent-subtle)',
      color: 'var(--color-accent-primary)'
    };
  }
  if (role === 'system') {
    return {
      background: 'transparent',
      border: 'var(--color-border-subtle)',
      color: 'var(--color-text-muted)'
    };
  }
  return {
    background: 'var(--color-surface-1)',
    border: 'var(--color-border-subtle)',
    color: 'var(--color-text-secondary)'
  };
}

export interface TeamThreadChatViewProps {
  thread: TeamThread;
  agent?: TeamAgent | null;
  transcript: TeamAgentMessage[];
  queue: TeamTurnQueueState | null;
  instruction: string;
  onInstructionChange: (instruction: string) => void;
  onSubmit: () => void;
  onCancelTurn?: (turn: TeamTurnQueueItem) => void;
  /** Answer the prompt a parked turn is waiting on (DEC-031 § 3). */
  onResolveApproval?: (turn: TeamTurnQueueItem, decision: TeamApprovalDecision) => void;
  resolvingApprovalTurnId?: string | null;
  /** The policy in force on this thread. */
  approvalPolicy?: TeamApprovalPolicy;
  /** Who is reading, as the Core reported them on this thread. */
  viewer?: TeamThreadViewer | null;
  onBack?: () => void;
  isSubmitting?: boolean;
  cancellingTurnId?: string | null;
  error?: string | null;
  notice?: string | null;
  /**
   * Fixed clock, so the rendered wording can be asserted. Left undefined in the
   * app, where `formatRelativeTime` reads the clock — the read stays outside
   * the render, which must stay pure.
   */
  now?: number;
}

/** The collaborative thread's presentation, driven entirely by props. */
export function TeamThreadChatView({
  thread,
  agent,
  transcript,
  queue,
  instruction,
  onInstructionChange,
  onSubmit,
  onCancelTurn,
  onResolveApproval,
  resolvingApprovalTurnId = null,
  approvalPolicy = DEFAULT_TEAM_APPROVAL_POLICY,
  viewer = null,
  onBack,
  isSubmitting = false,
  cancellingTurnId = null,
  error = null,
  notice = null,
  now
}: TeamThreadChatViewProps) {
  const state = queue?.state ?? thread.status;
  const tone = threadStateTone(state);
  const waitNotice = queueWaitNotice(queue);
  const canSubmit = canSubmitTurn(instruction, isSubmitting);
  const parked = awaitingApprovalTurn(queue);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        gap: 'var(--spacing-3)',
        padding: 'var(--spacing-4)'
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back to team agents"
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.8rem'
            }}
          >
            <IconArrowLeft size={12} color="var(--color-text-secondary)" /> Agents
          </button>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1
            style={{
              margin: 0,
              fontSize: '1.05rem',
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {thread.title}
          </h1>
          <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
            {agent ? `${agent.name} · ${agent.role}` : 'Shared team thread'}
            {thread.projectId ? '' : ' · not bound to a project'}
          </p>
        </div>
        <span style={{ ...chip, background: tone.background, color: tone.color, fontWeight: 600 }}>
          {tone.label}
        </span>
      </header>

      <div style={{ display: 'flex', gap: 'var(--spacing-4)', flex: 1, minHeight: 0, flexWrap: 'wrap' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-3)',
            flex: '2 1 380px',
            minWidth: 0,
            minHeight: 0
          }}
        >
          <div
            aria-label="Shared transcript"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              paddingRight: '4px'
            }}
          >
            {transcript.length === 0 ? (
              <div
                style={{
                  border: '1px dashed var(--color-border-default)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--spacing-6)',
                  textAlign: 'center',
                  color: 'var(--color-text-secondary)'
                }}
              >
                <p style={{ margin: 0 }}>Nothing has been asked of this agent yet.</p>
                <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                  Whatever anyone on the team asks appears here, attributed to them.
                </p>
              </div>
            ) : (
              transcript.map(message => {
                const messageStyle = messageTone(message.role);
                return (
                  <article
                    key={message.id}
                    style={{
                      display: 'flex',
                      gap: '8px',
                      padding: 'var(--spacing-2) var(--spacing-3)',
                      borderRadius: 'var(--radius-md)',
                      background: messageStyle.background,
                      border: `1px solid ${messageStyle.border}`
                    }}
                  >
                    <span style={{ ...avatar, color: messageStyle.color }} aria-hidden="true">
                      {message.role === 'assistant'
                        ? 'AI'
                        : authorInitials(messageAuthorLabel(message, agent?.name))}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 'var(--font-size-sm)',
                            fontWeight: 'var(--font-weight-semibold)',
                            color: messageStyle.color
                          }}
                        >
                          {messageAuthorLabel(message, agent?.name)}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                          {formatRelativeTime(message.createdAt, now)}
                        </span>
                      </div>
                      <p
                        style={{
                          margin: '4px 0 0',
                          fontSize: '0.86rem',
                          color: 'var(--color-text-primary)',
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere'
                        }}
                      >
                        {message.content}
                      </p>
                    </div>
                  </article>
                );
              })
            )}

            {state !== 'IDLE' && (
              <p
                aria-live="polite"
                style={{
                  margin: 0,
                  fontSize: '0.82rem',
                  color: tone.color,
                  fontFamily: 'var(--font-family-mono)'
                }}
              >
                {state === 'AWAITING_APPROVAL'
                  ? `Waiting on an approval for ${queue?.activeTurn?.userName || 'the running turn'}…`
                  : `${queue?.activeTurn?.userName || 'A team member'} is being served…`}
              </p>
            )}
          </div>

          {/*
            Beneath the transcript rather than beside it: a prompt that blocks
            the whole team belongs where the conversation is being read, not
            only in a side panel a narrow window may have wrapped away.
          */}
          {parked && (
            <TurnApprovalCard
              turn={parked}
              policy={approvalPolicy}
              viewer={viewer}
              onResolve={onResolveApproval}
              isResolving={resolvingApprovalTurnId === parked.id}
              now={now}
            />
          )}

          {error && (
            <p role="alert" style={{ margin: 0, color: 'var(--color-state-error)', fontSize: '0.85rem' }}>
              {error}
            </p>
          )}
          {notice && !error && (
            <p aria-live="polite" style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
              {notice}
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {waitNotice && (
              <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{waitNotice}</span>
            )}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
              <textarea
                value={instruction}
                onChange={event => onInstructionChange(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSubmit) {
                    event.preventDefault();
                    onSubmit();
                  }
                }}
                rows={3}
                aria-label="Instruction for the team agent"
                placeholder="Ask the shared agent — your instruction joins the queue…"
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '8px 10px',
                  fontSize: 'var(--font-size-sm)',
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-primary)',
                  outline: 'none',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  fontFamily: 'inherit'
                }}
              />
              <button
                onClick={onSubmit}
                disabled={!canSubmit}
                style={{
                  padding: '8px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-accent-primary)',
                  background: canSubmit ? 'var(--color-accent-subtle)' : 'transparent',
                  color: canSubmit ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--font-weight-semibold)'
                }}
              >
                {isSubmitting ? 'Queueing…' : 'Queue turn'}
              </button>
            </div>
          </div>
        </div>

        <div style={{ flex: '1 1 260px', minWidth: 0, overflowY: 'auto' }}>
          <ActiveTurnQueueInspectorView
            queue={queue}
            onCancelTurn={onCancelTurn}
            cancellingTurnId={cancellingTurnId}
            approvalPolicy={approvalPolicy}
            viewer={viewer}
            resolvingApprovalTurnId={resolvingApprovalTurnId}
            onResolveApproval={onResolveApproval}
            now={now}
          />
        </div>
      </div>
    </div>
  );
}

/** Store-connected collaborative thread. */
export function TeamThreadChat({ agent, onBack }: { agent?: TeamAgent | null; onBack?: () => void }) {
  const thread = useTeamAgentStore(state => state.activeThread);
  const transcript = useTeamAgentStore(state => state.activeTranscript);
  const queue = useTeamAgentStore(state => state.activeQueueState);
  const isSubmitting = useTeamAgentStore(state => state.isSubmitting);
  const cancellingTurnId = useTeamAgentStore(state => state.cancellingTurnId);
  const error = useTeamAgentStore(state => state.error);
  const notice = useTeamAgentStore(state => state.notice);
  const submitTurn = useTeamAgentStore(state => state.submitTurn);
  const cancelTurn = useTeamAgentStore(state => state.cancelTurn);
  const viewer = useTeamAgentStore(state => state.viewer);
  const resolvingApprovalTurnId = useTeamAgentStore(state => state.resolvingApprovalTurnId);
  const resolveApproval = useTeamAgentStore(state => state.resolveApproval);

  const [instruction, setInstruction] = useState('');

  if (!thread) return null;

  return (
    <TeamThreadChatView
      thread={thread}
      agent={agent}
      transcript={transcript}
      queue={queue}
      instruction={instruction}
      onInstructionChange={setInstruction}
      onSubmit={() => {
        if (!canSubmitTurn(instruction, isSubmitting)) return;
        const pending = instruction.trim();
        // Cleared optimistically: the Core answers 202 and the instruction's
        // life continues in the queue panel, so leaving it in the composer
        // would invite it being sent twice.
        setInstruction('');
        void submitTurn(thread.id, pending).then(turn => {
          if (!turn) setInstruction(pending);
        });
      }}
      onCancelTurn={turn => void cancelTurn(thread.id, turn.id)}
      onResolveApproval={(turn, decision) =>
        void resolveApproval(thread.id, turn.id, decision)
      }
      resolvingApprovalTurnId={resolvingApprovalTurnId}
      approvalPolicy={effectiveApprovalPolicy(thread, agent)}
      viewer={viewer}
      onBack={onBack}
      isSubmitting={isSubmitting}
      cancellingTurnId={cancellingTurnId}
      error={error}
      notice={notice}
    />
  );
}
