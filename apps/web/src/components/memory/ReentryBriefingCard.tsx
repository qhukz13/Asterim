import React, { useState } from 'react';
import type { AgentWorkSummary, ApprovalSummary, ProjectBriefing } from '@asterim/shared';
import { IconActivity, IconShield, IconTarget, IconCheck, IconAlert } from '../icons/Icons';
import { CreateRuleModal } from './CreateRuleModal';
import { UpdateIntentModal } from './UpdateIntentModal';

/**
 * Formats a timestamp as a short relative age.
 *
 * Relative rather than absolute because this card answers "where did we leave
 * off" — "2 hours ago" carries that; "Aug 14, 09:41" makes the reader do the
 * subtraction. `now` is injectable so the output is testable.
 */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (!Number.isFinite(diff)) return '';
  if (diff < 0) return 'just now';

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Approval outcomes that mean the gate is still open. */
export function isPendingApproval(approval: ApprovalSummary): boolean {
  return approval.status === 'pending';
}

const panelStyle: React.CSSProperties = {
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--spacing-4)'
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-semibold)' as any,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em'
};

/** The quiet control that sits in a briefing section header. */
const briefingActionStyle: React.CSSProperties = {
  height: '24px',
  padding: '0 10px',
  background: 'transparent',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-medium)' as any,
  cursor: 'pointer',
  transition: 'all var(--transition-fast)'
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 'var(--spacing-2)',
  padding: '5px 0',
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-secondary)',
  borderTop: '1px solid var(--color-border-subtle)'
};

function AgentWorkRow({ work, now }: { work: AgentWorkSummary; now: number }) {
  const isRunning = work.status === 'running';
  return (
    <div style={rowStyle}>
      <span
        style={{
          color: isRunning ? 'var(--color-accent-primary)' : 'var(--color-text-primary)',
          fontWeight: 'var(--font-weight-medium)' as any,
          minWidth: '84px'
        }}
      >
        {work.agentType}
      </span>
      <span style={{ color: isRunning ? 'var(--color-accent-primary)' : 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>
        {work.status}
      </span>
      <span style={{ flex: 1 }} />
      <span
        title={work.sessionId}
        style={{ fontFamily: 'var(--font-family-mono)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}
      >
        {work.sessionId.slice(0, 8)}
      </span>
      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums', minWidth: '58px', textAlign: 'right' }}>
        {relativeTime(work.updatedAt, now)}
      </span>
    </div>
  );
}

function ApprovalRow({ approval, now }: { approval: ApprovalSummary; now: number }) {
  const pending = isPendingApproval(approval);
  return (
    <div style={rowStyle}>
      <span style={{ display: 'inline-flex', alignItems: 'center', paddingTop: '2px', color: pending ? 'var(--color-accent-primary)' : 'var(--color-text-muted)' }}>
        {pending ? <IconAlert size={11} /> : <IconCheck size={11} />}
      </span>
      <span style={{ flex: 1, minWidth: 0, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {approval.description}
      </span>
      <span
        style={{
          fontSize: 'var(--font-size-xs)',
          color: pending ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
          fontWeight: pending ? ('var(--font-weight-semibold)' as any) : undefined
        }}
      >
        {approval.status}
      </span>
      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums', minWidth: '58px', textAlign: 'right' }}>
        {relativeTime(approval.createdAt, now)}
      </span>
    </div>
  );
}

export interface ReentryBriefingCardProps {
  briefing: ProjectBriefing | null;
  /** Injectable clock, so relative ages are deterministic under test. */
  now?: number;
  /** Supplying a project turns the intent and rules sections into editable ones. */
  projectId?: string | null;
}

/**
 * The session handover card: what a person — or the next agent — needs to know to
 * pick this project back up.
 *
 * Deliberately not a second Decision Explorer. It answers "where did we leave off"
 * with the current intent, how many rules are in force, and what the last sessions
 * and approvals actually were. The decisions themselves live in the timeline below.
 */
export function ReentryBriefingCard({ briefing, now, projectId = null }: ReentryBriefingCardProps) {
  // Read the clock once per mount rather than on every render: calling Date.now()
  // in the render body is impure, and a value that shifts between renders would
  // make the relative ages flicker as unrelated state changes.
  const [mountedAt] = useState(() => Date.now());
  const clock = now ?? mountedAt;
  const [editingIntent, setEditingIntent] = useState(false);
  const [addingRule, setAddingRule] = useState(false);

  if (!briefing) {
    return (
      <div style={{ ...panelStyle, color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
        No briefing loaded for this project yet.
      </div>
    );
  }

  const { currentIntent, architecturalRules, activeDecisions, recentAgentWork, recentApprovals } = briefing;
  const pendingCount = recentApprovals.filter(isPendingApproval).length;

  return (
    <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)' }}>
          <span style={labelStyle}>
            <IconTarget size={12} /> Where this project stands
          </span>
          {projectId && (
            <button type="button" onClick={() => setEditingIntent(true)} style={briefingActionStyle}>
              {currentIntent ? 'Update intent' : 'Set intent'}
            </button>
          )}
        </div>
        <p
          style={{
            margin: 'var(--spacing-2) 0 0',
            fontSize: 'var(--font-size-md)',
            lineHeight: 'var(--line-height-normal)',
            color: currentIntent ? 'var(--color-text-primary)' : 'var(--color-text-muted)'
          }}
        >
          {currentIntent ? currentIntent.goal : 'No intent has been set for this project.'}
        </p>
        <p style={{ margin: 'var(--spacing-2) 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          {activeDecisions.length} active decision{activeDecisions.length === 1 ? '' : 's'} ·{' '}
          {architecturalRules.length} standing rule{architecturalRules.length === 1 ? '' : 's'} in force
        </p>
      </div>

      {(architecturalRules.length > 0 || projectId) && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)' }}>
            <span style={labelStyle}>
              <IconShield size={12} /> Rules you must not break
            </span>
            {projectId && (
              <button type="button" onClick={() => setAddingRule(true)} style={briefingActionStyle}>
                Add rule
              </button>
            )}
          </div>
          <ul style={{ margin: 'var(--spacing-2) 0 0', paddingLeft: 'var(--spacing-4)' }}>
            {architecturalRules.slice(0, 3).map(rule => (
              <li key={rule.id} style={{ fontSize: 'var(--font-size-sm)', lineHeight: 'var(--line-height-normal)', color: 'var(--color-text-secondary)' }}>
                {rule.statement}
              </li>
            ))}
          </ul>
          {architecturalRules.length > 3 && (
            <p style={{ margin: '6px 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              and {architecturalRules.length - 3} more
            </p>
          )}
          {architecturalRules.length === 0 && (
            <p style={{ margin: 'var(--spacing-2) 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              No standing rules yet.
            </p>
          )}
        </div>
      )}

      <div>
        <div style={labelStyle}>
          <IconActivity size={12} /> Recent agent work
        </div>
        {recentAgentWork.length === 0 ? (
          <p style={{ margin: 'var(--spacing-2) 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            No agent has run in this project yet.
          </p>
        ) : (
          <div style={{ marginTop: 'var(--spacing-2)' }}>
            {recentAgentWork.map(work => (
              <AgentWorkRow key={work.sessionId} work={work} now={clock} />
            ))}
          </div>
        )}
      </div>

      <div>
        <div style={labelStyle}>
          <IconCheck size={12} /> Recent approvals
          {pendingCount > 0 && (
            <span style={{ color: 'var(--color-accent-primary)', letterSpacing: 0, textTransform: 'none' }}>
              · {pendingCount} still waiting
            </span>
          )}
        </div>
        {recentApprovals.length === 0 ? (
          <p style={{ margin: 'var(--spacing-2) 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            Nothing has needed approval yet.
          </p>
        ) : (
          <div style={{ marginTop: 'var(--spacing-2)' }}>
            {recentApprovals.map(approval => (
              <ApprovalRow key={approval.actionId} approval={approval} now={clock} />
            ))}
          </div>
        )}
      </div>

      {editingIntent && projectId && (
        <UpdateIntentModal
          projectId={projectId}
          currentIntent={currentIntent}
          onClose={() => setEditingIntent(false)}
        />
      )}
      {addingRule && projectId && (
        <CreateRuleModal projectId={projectId} onClose={() => setAddingRule(false)} />
      )}
    </div>
  );
}
