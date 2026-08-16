import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentProfile, DelegationKind } from '@asterim/shared';
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
 */

/** Which of the two things the operator is asking for. */
export type DelegateModalMode = DelegationKind;

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
 */
export function canSubmitDelegation(mode: DelegateModalMode, task: string, context: string): boolean {
  if (mode === 'REVIEW') return context.trim().length > 0;
  return task.trim().length > 0;
}

/** The body `POST /api/v1/threads/:id/delegate` expects. */
export function buildDelegationBody(
  mode: DelegateModalMode,
  fields: { profileId?: string; role?: string; task: string; context: string }
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
        .filter(line => line.length > 0)
    };
  }
  return {
    kind: 'TASK',
    profileId: fields.profileId || undefined,
    role: fields.role || undefined,
    task: fields.task.trim(),
    context: fields.context.trim() || undefined
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
  isDelegating = false
}: DelegateModalViewProps) {
  const isReview = mode === 'REVIEW';
  const canSubmit = !isSubmitting && !isDelegating && canSubmitDelegation(mode, task, context);

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
        style={{ maxWidth: '520px', width: '100%' }}
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
            {isReview ? 'Request Review' : 'Delegate Work'}
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
        </div>

        <p
          style={{
            margin: '0 0 var(--spacing-3) 0',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-secondary)'
          }}
        >
          {isReview
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
              {isSubmitting ? 'Dispatching…' : isReview ? 'Request Review' : 'Delegate'}
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
  const pendingChild = useProjectStore(state =>
    activeThreadId ? state.pendingChildren[activeThreadId] : undefined
  );

  const [mode, setMode] = useState<DelegateModalMode>('TASK');
  const [profileId, setProfileId] = useState('');
  const [task, setTask] = useState('');
  const [context, setContext] = useState('');
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
    const body = buildDelegationBody(mode, { profileId, task, context });

    try {
      const res = await fetch(
        `${base}/api/v1/threads/${encodeURIComponent(activeThreadId)}/delegate`,
        {
          method: 'POST',
          headers: getAuthHeaders({ backendUrl: activeBackendUrl, json: true }),
          body: JSON.stringify(body)
        }
      );

      if (!res.ok) {
        const failure = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(failure?.error || `The delegation was refused (${res.status}).`);
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
      onModeChange={setMode}
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
    />,
    document.body
  );
}
