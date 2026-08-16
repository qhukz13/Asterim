import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_CONCURRENT_DELEGATIONS } from '@asterim/shared';
import type { AgentProfile, DelegationKind, ParallelDelegationItem } from '@asterim/shared';
import { useProfileStore } from '../../stores/useProfileStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useThreadStore } from '../../stores/useThreadStore';
import { getAuthHeaders, resolveBackendUrl } from '../../utils/auth';

/**
 * Handing a thread's work to another role by hand (P7-02).
 *
 * The same two things an agent can ask for through its meta-tools, offered to
 * the operator: delegate a task, or request a review. It posts to the same
 * endpoint the agent's calls end up at, so the depth bound, the role lookup and
 * the parent's waiting state are enforced once, in the Core, rather than
 * re-implemented for the person driving.
 *
 * The request is deliberately long-lived — `POST /delegate` holds open until the
 * child finishes — so the modal does not wait on it. It closes when the socket
 * says a child has started, and what happens after that is the waiting banner
 * and the outcome card, not this form.
 *
 * The third mode is a fan-out (P7-05): the same form repeated, two to four
 * times, posted to `POST /delegate/parallel`. It is bounded here as well as in
 * the Core — the Core is what enforces it, and the form refusing to compose a
 * fifth row is what stops the operator from finding that out after typing it.
 */

/** Which of the three things the operator is asking for. */
export type DelegateModalMode = DelegationKind | 'PARALLEL';

/** The fewest subagents a batch can be. One of them is an ordinary delegation. */
export const MIN_PARALLEL_DELEGATIONS = 2;

/** One row of the batch builder, as the form holds it. */
export interface ParallelItemState {
  /** Stable across re-renders and row removals, so React keys and labels hold. */
  id: string;
  profileId: string;
  task: string;
  context: string;
}

let parallelItemSequence = 0;

/** A blank row with an id nothing else in this session will reuse. */
export function newParallelItem(): ParallelItemState {
  parallelItemSequence += 1;
  return { id: `subagent-${parallelItemSequence}`, profileId: '', task: '', context: '' };
}

/** The rows a freshly opened batch starts with: the smallest fan-out there is. */
export function defaultParallelItems(): ParallelItemState[] {
  return Array.from({ length: MIN_PARALLEL_DELEGATIONS }, () => newParallelItem());
}

/** Whether another subagent may be composed. */
export function canAddParallelItem(items: ParallelItemState[]): boolean {
  return items.length < MAX_CONCURRENT_DELEGATIONS;
}

/** Whether a subagent may be dropped without taking the batch below a batch. */
export function canRemoveParallelItem(items: ParallelItemState[]): boolean {
  return items.length > MIN_PARALLEL_DELEGATIONS;
}

/** The list with one more blank row, or unchanged when it is already full. */
export function addParallelItem(items: ParallelItemState[]): ParallelItemState[] {
  if (!canAddParallelItem(items)) return items;
  return [...items, newParallelItem()];
}

/** The list without one row, or unchanged when removing would undo the batch. */
export function removeParallelItem(items: ParallelItemState[], id: string): ParallelItemState[] {
  if (!canRemoveParallelItem(items)) return items;
  const next = items.filter(item => item.id !== id);
  return next.length === items.length ? items : next;
}

/** The list with one row's field replaced. */
export function updateParallelItem(
  items: ParallelItemState[],
  id: string,
  patch: Partial<Omit<ParallelItemState, 'id'>>
): ParallelItemState[] {
  return items.map(item => (item.id === id ? { ...item, ...patch } : item));
}

/**
 * Whether a batch can be dispatched.
 *
 * The count bound is checked here rather than trusted from the buttons: a row
 * removed while the form was mid-edit, or a state restored from anywhere else,
 * has to fail the same way an empty task does rather than reach the Core.
 */
export function canSubmitParallelDelegation(items: ParallelItemState[]): boolean {
  if (items.length < MIN_PARALLEL_DELEGATIONS) return false;
  if (items.length > MAX_CONCURRENT_DELEGATIONS) return false;
  return items.every(item => item.task.trim().length > 0);
}

/**
 * How the two Phase 8 switches start out, for the mode being composed.
 *
 * The same defaults the Core applies when the operator says nothing (P8-01,
 * P8-02): a task that is going to edit files gets a sandbox and is verified in
 * it; a review reads changes rather than making them, so it gets neither. The
 * form states them rather than leaving them implicit so the operator can see
 * what is about to happen and turn it off.
 */
export function defaultSandboxOptions(mode: DelegateModalMode): {
  isolateWorktree: boolean;
  verifyPipeline: boolean;
} {
  const isolateWorktree = mode !== 'REVIEW';
  return { isolateWorktree, verifyPipeline: isolateWorktree };
}

/**
 * The switches after one of them has been moved.
 *
 * Turning isolation off takes verification with it: without a sandbox the
 * pipeline would run in the operator's own checkout, which is not what anyone
 * clicking a checkbox on a delegation form is asking for.
 */
export function applySandboxOption(
  current: { isolateWorktree: boolean; verifyPipeline: boolean },
  patch: Partial<{ isolateWorktree: boolean; verifyPipeline: boolean }>
): { isolateWorktree: boolean; verifyPipeline: boolean } {
  const next = { ...current, ...patch };
  if (!next.isolateWorktree) next.verifyPipeline = false;
  return next;
}

/** The body `POST /api/v1/threads/:id/delegate/parallel` expects. */
export function buildParallelDelegationBody(
  items: ParallelItemState[],
  options?: { isolateWorktree?: boolean; verifyPipeline?: boolean }
): Record<string, unknown> {
  const delegations: ParallelDelegationItem[] = items.map(item => ({
    profileId: item.profileId || undefined,
    taskDescription: item.task.trim(),
    inputContext: item.context.trim() || undefined,
    kind: 'TASK',
    isolateWorktree: options?.isolateWorktree,
    verifyPipeline: options?.verifyPipeline
  }));
  return { delegations };
}

/** The roles offered, newest-looking first: the profile's role, then its name. */
export function roleOptionsFrom(profiles: AgentProfile[]): { id: string; label: string; role: string }[] {
  return profiles.map(profile => ({
    id: profile.id,
    label: profile.role && profile.role !== profile.name ? `${profile.name} — ${profile.role}` : profile.name,
    role: profile.role || profile.name
  }));
}

/**
 * Whether the form can be submitted.
 *
 * A review needs the changes; a task needs the task. Neither needs a role — the
 * Core defaults a review to its reviewer role, and refuses a task without one
 * with a message worth showing.
 *
 * A batch is not decided from these fields at all — it has its own rows, and
 * `canSubmitParallelDelegation` is what reads them.
 */
export function canSubmitDelegation(mode: DelegateModalMode, task: string, context: string): boolean {
  if (mode === 'PARALLEL') return false;
  if (mode === 'REVIEW') return context.trim().length > 0;
  return task.trim().length > 0;
}

/** The body `POST /api/v1/threads/:id/delegate` expects. */
export function buildDelegationBody(
  mode: DelegateModalMode,
  fields: {
    profileId?: string;
    role?: string;
    task: string;
    context: string;
    /** Left off entirely when the operator did not touch the switches. */
    isolateWorktree?: boolean;
    verifyPipeline?: boolean;
  }
): Record<string, unknown> {
  if (mode === 'REVIEW') {
    return {
      kind: 'REVIEW',
      profileId: fields.profileId || undefined,
      role: fields.role || undefined,
      diff: fields.context.trim(),
      criteria: fields.task
        .split('\n')
        .map(line => line.replace(/^[-*]\s*/, '').trim())
        .filter(line => line.length > 0),
      isolateWorktree: fields.isolateWorktree,
      verifyPipeline: fields.verifyPipeline
    };
  }
  return {
    kind: 'TASK',
    profileId: fields.profileId || undefined,
    role: fields.role || undefined,
    task: fields.task.trim(),
    context: fields.context.trim() || undefined,
    isolateWorktree: fields.isolateWorktree,
    verifyPipeline: fields.verifyPipeline
  };
}

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-muted)',
  fontWeight: 'var(--font-weight-semibold)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em'
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 'var(--font-size-sm)',
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit'
};

export interface DelegateModalViewProps {
  profiles: AgentProfile[];
  mode: DelegateModalMode;
  onModeChange: (mode: DelegateModalMode) => void;
  profileId: string;
  onProfileChange: (profileId: string) => void;
  task: string;
  onTaskChange: (task: string) => void;
  context: string;
  onContextChange: (context: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  isSubmitting?: boolean;
  error?: string | null;
  /** Refuses the form outright when the thread is already parked behind a child. */
  isDelegating?: boolean;
  /** The batch being composed. Only read in `PARALLEL` mode (P7-05). */
  parallelItems?: ParallelItemState[];
  onParallelItemChange?: (id: string, patch: Partial<Omit<ParallelItemState, 'id'>>) => void;
  onAddParallelItem?: () => void;
  onRemoveParallelItem?: (id: string) => void;
  /** Whether the subagent gets its own Git worktree (P8-01). */
  isolateWorktree?: boolean;
  onIsolateWorktreeChange?: (isolateWorktree: boolean) => void;
  /** Whether its work is verified before the result comes back (P8-02). */
  verifyPipeline?: boolean;
  onVerifyPipelineChange?: (verifyPipeline: boolean) => void;
}

/** The modal's presentation, driven entirely by props. */
export function DelegateModalView({
  profiles,
  mode,
  onModeChange,
  profileId,
  onProfileChange,
  task,
  onTaskChange,
  context,
  onContextChange,
  onSubmit,
  onClose,
  isSubmitting = false,
  error = null,
  isDelegating = false,
  parallelItems = [],
  onParallelItemChange,
  onAddParallelItem,
  onRemoveParallelItem,
  isolateWorktree = false,
  onIsolateWorktreeChange,
  verifyPipeline = false,
  onVerifyPipelineChange
}: DelegateModalViewProps) {
  const isReview = mode === 'REVIEW';
  const isParallel = mode === 'PARALLEL';
  const canSubmit =
    !isSubmitting &&
    !isDelegating &&
    (isParallel ? canSubmitParallelDelegation(parallelItems) : canSubmitDelegation(mode, task, context));

  const tab = (value: DelegateModalMode, label: string) => (
    <button
      type="button"
      onClick={() => onModeChange(value)}
      aria-pressed={mode === value}
      style={{
        flex: 1,
        padding: '6px 10px',
        fontSize: 'var(--font-size-xs)',
        fontWeight: 'var(--font-weight-semibold)',
        background: mode === value ? 'var(--color-surface-3)' : 'transparent',
        color: mode === value ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        border: 'none',
        borderRadius: 'var(--radius-xs)',
        cursor: 'pointer',
        transition: 'background 0.15s, color 0.15s'
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box glass-panel"
        style={{ maxWidth: isParallel ? '640px' : '520px', width: '100%' }}
        onClick={event => event.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--spacing-3)'
          }}
        >
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text-primary)' }}>
            {isParallel ? 'Parallel Batch' : isReview ? 'Request Review' : 'Delegate Work'}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: '1.2rem'
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '2px',
            padding: '2px',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 'var(--spacing-3)'
          }}
        >
          {tab('TASK', 'Delegate Task')}
          {tab('REVIEW', 'Request Review')}
          {tab('PARALLEL', 'Parallel Batch')}
        </div>

        <p
          style={{
            margin: '0 0 var(--spacing-3) 0',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-secondary)'
          }}
        >
          {isParallel
            ? `Dispatch up to ${MAX_CONCURRENT_DELEGATIONS} concurrent subagents under specialized roles. This thread will wait until all subagents finish and aggregate their outcomes.`
            : isReview
              ? 'A reviewer role reads the changes and returns a PASS or NEEDS_FIX verdict. This thread waits until it answers.'
              : 'A new agent session runs under the role you pick and hands its result back here. This thread waits until it finishes.'}
        </p>

        <form
          onSubmit={event => {
            event.preventDefault();
            if (canSubmit) onSubmit();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}
        >
          {isParallel && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--spacing-2)'
                }}
              >
                <span style={labelStyle}>
                  Subagents ({parallelItems.length}/{MAX_CONCURRENT_DELEGATIONS})
                </span>
                <button
                  type="button"
                  onClick={() => onAddParallelItem?.()}
                  aria-label="Add subagent"
                  title={
                    canAddParallelItem(parallelItems)
                      ? 'Add another subagent to this batch'
                      : `A batch runs at most ${MAX_CONCURRENT_DELEGATIONS} subagents at once`
                  }
                  disabled={!canAddParallelItem(parallelItems)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 'var(--font-weight-semibold)',
                    background: 'transparent',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-accent-primary)',
                    cursor: canAddParallelItem(parallelItems) ? 'pointer' : 'not-allowed',
                    opacity: canAddParallelItem(parallelItems) ? 1 : 0.5
                  }}
                >
                  + Add Subagent
                </button>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--spacing-3)',
                  maxHeight: '46vh',
                  overflowY: 'auto'
                }}
              >
                {parallelItems.map((item, index) => (
                  <div
                    key={item.id}
                    aria-label={`Subagent ${index + 1}`}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--spacing-2)',
                      padding: 'var(--spacing-3)',
                      background: 'var(--color-surface-1)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: 'var(--radius-md)'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 'var(--spacing-2)'
                      }}
                    >
                      <span
                        style={{
                          fontSize: 'var(--font-size-xs)',
                          fontWeight: 'var(--font-weight-semibold)',
                          color: 'var(--color-text-primary)'
                        }}
                      >
                        Subagent {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemoveParallelItem?.(item.id)}
                        aria-label={`Remove subagent ${index + 1}`}
                        title={
                          canRemoveParallelItem(parallelItems)
                            ? 'Drop this subagent from the batch'
                            : `A batch is at least ${MIN_PARALLEL_DELEGATIONS} subagents`
                        }
                        disabled={!canRemoveParallelItem(parallelItems)}
                        style={{
                          padding: '2px 8px',
                          fontSize: 'var(--font-size-xs)',
                          background: 'transparent',
                          border: '1px solid var(--color-border-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-text-secondary)',
                          cursor: canRemoveParallelItem(parallelItems) ? 'pointer' : 'not-allowed',
                          opacity: canRemoveParallelItem(parallelItems) ? 1 : 0.4
                        }}
                      >
                        Remove
                      </button>
                    </div>

                    <select
                      aria-label={`Subagent ${index + 1} role`}
                      value={item.profileId}
                      onChange={event =>
                        onParallelItemChange?.(item.id, { profileId: event.target.value })
                      }
                      style={{ ...fieldStyle, cursor: 'pointer' }}
                    >
                      <option value="">Let the Core match a role</option>
                      {roleOptionsFrom(profiles).map(option => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    <textarea
                      aria-label={`Subagent ${index + 1} task`}
                      value={item.task}
                      onChange={event => onParallelItemChange?.(item.id, { task: event.target.value })}
                      rows={3}
                      placeholder="What this subagent should do, stated as an outcome it can verify."
                      style={{ ...fieldStyle, resize: 'vertical' }}
                    />

                    <textarea
                      aria-label={`Subagent ${index + 1} context`}
                      value={item.context}
                      onChange={event =>
                        onParallelItemChange?.(item.id, { context: event.target.value })
                      }
                      rows={2}
                      placeholder="Context for this subagent (optional)."
                      style={{
                        ...fieldStyle,
                        resize: 'vertical',
                        fontFamily: 'var(--font-family-mono)'
                      }}
                    />
                  </div>
                ))}
              </div>

              {!canSubmitParallelDelegation(parallelItems) && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--color-state-paused)'
                  }}
                >
                  Every subagent needs a task before this batch can be dispatched.
                </p>
              )}
            </div>
          )}

          {!isParallel && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)' }}>
                <label htmlFor="delegation-role" style={labelStyle}>
                  Role
                </label>
                <select
                  id="delegation-role"
                  aria-label="Delegation role"
                  value={profileId}
                  onChange={event => onProfileChange(event.target.value)}
                  style={{ ...fieldStyle, cursor: 'pointer' }}
                >
                  <option value="">
                    {isReview ? 'Default reviewer role' : 'Let the Core match a role'}
                  </option>
                  {roleOptionsFrom(profiles).map(option => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)' }}>
                <label htmlFor="delegation-task" style={labelStyle}>
                  {isReview ? 'Review criteria (one per line)' : 'Task'}
                </label>
                <textarea
                  id="delegation-task"
                  aria-label={isReview ? 'Review criteria' : 'Task description'}
                  value={task}
                  onChange={event => onTaskChange(event.target.value)}
                  rows={isReview ? 3 : 4}
                  placeholder={
                    isReview
                      ? 'e.g. No secrets in the diff\nInput validation on every new route'
                      : 'What the delegated role should do, stated as an outcome it can verify.'
                  }
                  style={{ ...fieldStyle, resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)' }}>
                <label htmlFor="delegation-context" style={labelStyle}>
                  {isReview ? 'Changes to review' : 'Context (optional)'}
                </label>
                <textarea
                  id="delegation-context"
                  aria-label={isReview ? 'Changes to review' : 'Supporting context'}
                  value={context}
                  onChange={event => onContextChange(event.target.value)}
                  rows={isReview ? 6 : 3}
                  placeholder={
                    isReview
                      ? 'Paste the diff or the relevant excerpts.'
                      : 'Constraints, decisions already made, files to start from.'
                  }
                  style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'var(--font-family-mono)' }}
                />
              </div>
            </>
          )}

          {/* What the subagent runs in, and whether Asterim checks the result
              before handing it back (P8-01, P8-02). Stated on the form rather
              than left to the Core's defaults so the operator can see it and
              turn it off. */}
          <div
            aria-label="Sandbox options"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--spacing-2)',
              padding: 'var(--spacing-3)',
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)'
            }}
          >
            <label
              htmlFor="delegation-isolate-worktree"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--spacing-2)',
                cursor: 'pointer'
              }}
            >
              <input
                id="delegation-isolate-worktree"
                type="checkbox"
                aria-label="Isolate in Git worktree"
                checked={isolateWorktree}
                onChange={event => onIsolateWorktreeChange?.(event.target.checked)}
                style={{ marginTop: '2px', accentColor: 'var(--color-accent-primary)', cursor: 'pointer' }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-primary)',
                    fontWeight: 'var(--font-weight-semibold)'
                  }}
                >
                  Isolate in Git Worktree
                </span>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  The subagent edits its own checkout on a sandbox branch. Nothing touches your
                  working tree until you merge it.
                </span>
              </span>
            </label>

            <label
              htmlFor="delegation-verify-pipeline"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--spacing-2)',
                cursor: isolateWorktree ? 'pointer' : 'not-allowed',
                opacity: isolateWorktree ? 1 : 0.5
              }}
            >
              <input
                id="delegation-verify-pipeline"
                type="checkbox"
                aria-label="Run verification pipeline"
                checked={verifyPipeline}
                disabled={!isolateWorktree}
                onChange={event => onVerifyPipelineChange?.(event.target.checked)}
                style={{ marginTop: '2px', accentColor: 'var(--color-accent-primary)', cursor: 'inherit' }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-primary)',
                    fontWeight: 'var(--font-weight-semibold)'
                  }}
                >
                  Run Verification Pipeline
                </span>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  {isolateWorktree
                    ? 'Asterim runs this project’s own typecheck, lint, test and build in the sandbox and reports what they exited as.'
                    : 'Needs a sandbox: without one the checks would run in your own working tree.'}
                </span>
              </span>
            </label>
          </div>

          {isDelegating && (
            <p
              role="alert"
              style={{ margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-state-paused)' }}
            >
              This thread is already waiting on a delegated agent. Wait for it to finish first.
            </p>
          )}

          {error && (
            <p
              role="alert"
              style={{ margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-state-error)' }}
            >
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                border: '1px solid var(--color-border-default)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!canSubmit}
              style={{ padding: '8px 14px', opacity: canSubmit ? 1 : 0.5 }}
            >
              {isSubmitting
                ? 'Dispatching…'
                : isParallel
                  ? `Dispatch ${parallelItems.length} Subagents`
                  : isReview
                    ? 'Request Review'
                    : 'Delegate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Store-connected modal, scoped to the thread that is open. */
export function DelegateModal({
  onClose,
  activeBackendUrl,
  isDelegating = false
}: {
  onClose: () => void;
  activeBackendUrl?: string | null;
  isDelegating?: boolean;
}) {
  const activeThreadId = useThreadStore(state => state.activeThreadId);
  const profiles = useProfileStore(state => state.profiles);
  const loadProfiles = useProfileStore(state => state.loadProfiles);
  const pendingChildren = useProjectStore(state =>
    activeThreadId ? state.pendingChildren[activeThreadId] : undefined
  );
  const pendingChild = (pendingChildren || []).length > 0;

  const [mode, setMode] = useState<DelegateModalMode>('TASK');
  const [profileId, setProfileId] = useState('');
  const [task, setTask] = useState('');
  const [context, setContext] = useState('');
  const [parallelItems, setParallelItems] = useState<ParallelItemState[]>(defaultParallelItems);
  const [sandbox, setSandbox] = useState(() => defaultSandboxOptions('TASK'));
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (profiles.length === 0) void loadProfiles();
  }, [profiles.length, loadProfiles]);

  /**
   * The delegation was accepted, which is not the same as finished.
   *
   * `POST /delegate` is synchronous: it holds the request open until the child
   * settles, which may be ten minutes. Waiting for that response to close the
   * modal would leave the operator staring at a spinner for the length of the
   * delegation. So the socket decides instead — a child has been created and
   * this thread is parked behind it — and the request stays in flight, which is
   * still where a refusal comes back.
   */
  React.useEffect(() => {
    if (isSubmitting && pendingChild) onClose();
  }, [isSubmitting, pendingChild, onClose]);

  const submit = async () => {
    if (!activeThreadId) {
      setError('Open a thread before delegating.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const base = resolveBackendUrl(activeBackendUrl) || '';
    const isParallel = mode === 'PARALLEL';
    const body = isParallel
      ? buildParallelDelegationBody(parallelItems, sandbox)
      : buildDelegationBody(mode, { profileId, task, context, ...sandbox });
    // The batch endpoint, not the store action: `delegateParallel` reports a
    // refusal as `null`, and the refusal is the whole point of the banner —
    // 409 CONCURRENCY_LIMIT_EXCEEDED reads differently from 400, and the
    // operator is owed the Core's own words for it.
    const path = isParallel ? 'delegate/parallel' : 'delegate';

    try {
      const res = await fetch(
        `${base}/api/v1/threads/${encodeURIComponent(activeThreadId)}/${path}`,
        {
          method: 'POST',
          headers: getAuthHeaders({ backendUrl: activeBackendUrl, json: true }),
          body: JSON.stringify(body)
        }
      );

      if (!res.ok) {
        const failure = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(
          failure?.error ||
            `The ${isParallel ? 'parallel batch' : 'delegation'} was refused (${res.status}).`
        );
        setSubmitting(false);
        return;
      }

      // Reached only when the whole delegation finished before the socket got
      // here, which a fast refusal-free child can do. The outcome card is
      // already showing it by then.
      onClose();
    } catch {
      setError('Could not reach the workstation.');
      setSubmitting(false);
    }
  };

  return createPortal(
    <DelegateModalView
      profiles={profiles}
      mode={mode}
      onModeChange={next => {
        setMode(next);
        // A refusal belongs to the form that caused it; switching tabs is the
        // operator moving on from it.
        setError(null);
        // And the switches go back to what that mode's default is: a review
        // that inherited a task's sandbox would be given a checkout it has no
        // use for.
        setSandbox(defaultSandboxOptions(next));
      }}
      profileId={profileId}
      onProfileChange={setProfileId}
      task={task}
      onTaskChange={setTask}
      context={context}
      onContextChange={setContext}
      onSubmit={submit}
      onClose={onClose}
      isSubmitting={isSubmitting}
      error={error}
      isDelegating={isDelegating}
      parallelItems={parallelItems}
      onParallelItemChange={(id, patch) =>
        setParallelItems(items => updateParallelItem(items, id, patch))
      }
      onAddParallelItem={() => setParallelItems(items => addParallelItem(items))}
      onRemoveParallelItem={id => setParallelItems(items => removeParallelItem(items, id))}
      isolateWorktree={sandbox.isolateWorktree}
      onIsolateWorktreeChange={next =>
        setSandbox(current => applySandboxOption(current, { isolateWorktree: next }))
      }
      verifyPipeline={sandbox.verifyPipeline}
      onVerifyPipelineChange={next =>
        setSandbox(current => applySandboxOption(current, { verifyPipeline: next }))
      }
    />,
    document.body
  );
}
