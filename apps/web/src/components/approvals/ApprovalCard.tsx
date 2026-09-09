import React, { useEffect, useRef, useState } from 'react';
import type { ApprovalConsequence, ApprovalPreview, ApprovalRequestPayload } from '@asterim/shared';
import { IconAlertTriangle, IconFileCode, IconTerminal, IconCheck } from '../icons/Icons';

/**
 * The approval card.
 *
 * This is the control the product exists for, so it answers three questions
 * before it offers a button: what is about to happen, to what, and what
 * exactly will change. A card that says `Write: file.txt` and nothing else asks
 * someone to authorise something they cannot see.
 *
 * Everything rendered here comes from the agent's real permission request
 * (`ApprovalConsequence`, built by the Core). When a request arrives without
 * one — a PTY provider, or an approval recovered from the database after a
 * restart — the card falls back to the description and command it does have,
 * rather than inventing detail.
 */

export interface ApprovalCardProps {
  request: ApprovalRequestPayload & { timestamp?: number };
  onApprove: (actionId: string) => void;
  onDeny: (actionId: string) => void;
  /** Antigravity's "answer in the terminal" variant. */
  onSwitchToTerminal?: (actionId: string) => void;
  /** Seconds the Core will wait before treating silence as a denial. */
  timeoutSeconds?: number;
}

const KIND_LABEL: Record<ApprovalConsequence['kind'], string> = {
  shell: 'Runs a command',
  create: 'Creates a file',
  overwrite: 'Overwrites a file',
  edit: 'Edits a file',
  delete: 'Deletes',
  fetch: 'Network request',
  read: 'Reads only',
  other: 'Unrecognised tool'
};

function Preview({ preview, label }: { preview: ApprovalPreview; label: string }) {
  const shown = preview.omittedLines > 0;
  return (
    <div className="approval-preview">
      <div className="approval-preview-head">
        <span>{label}</span>
        <span className="approval-preview-meta">
          {shown
            ? `${preview.lines} of ${preview.lines + preview.omittedLines} lines`
            : `${preview.lines} line${preview.lines === 1 ? '' : 's'}`}
        </span>
      </div>
      <pre className="approval-preview-body">{preview.text || '(empty)'}</pre>
      {shown && (
        <div className="approval-preview-foot">
          {preview.omittedLines} more line{preview.omittedLines === 1 ? '' : 's'} not shown
        </div>
      )}
    </div>
  );
}

/** True when the agent's description only repeats what the card already shows. */
export function isRedundantIntent(consequence: ApprovalConsequence): boolean {
  const intent = (consequence.intent ?? '').trim().toLowerCase();
  if (!intent) return true;
  const path = (consequence.path ?? '').toLowerCase();
  if (path && (intent === path || path.endsWith(intent) || intent.endsWith(path))) return true;
  return intent === (consequence.command ?? '').trim().toLowerCase();
}

/** What the agent will do, rendered by the kind of action it is. */
function Consequence({ consequence }: { consequence: ApprovalConsequence }) {
  const { kind } = consequence;

  return (
    <>
      <div className="approval-headline">{consequence.headline}</div>

      {consequence.path && (
        <div className="approval-target">
          <IconFileCode size={13} />
          <code>{consequence.path}</code>
          {consequence.pathExists === false && <span className="approval-tag">new file</span>}
          {consequence.pathExists === true && kind !== 'read' && (
            <span className="approval-tag approval-tag-warn">file exists</span>
          )}
        </div>
      )}

      {consequence.url && (
        <div className="approval-target">
          <code>{consequence.url}</code>
        </div>
      )}

      {/* The agent's own description, but only when it adds something. For an
          edit Claude Code often sets it to the file name, which is already
          above it in larger type. */}
      {consequence.intent && !isRedundantIntent(consequence) && (
        <p className="approval-intent">“{consequence.intent}”</p>
      )}

      {consequence.command && (
        <div className="approval-preview">
          <div className="approval-preview-head">
            <span>
              <IconTerminal size={12} /> Command
            </span>
          </div>
          <pre className="approval-preview-body approval-command">{consequence.command}</pre>
        </div>
      )}

      {consequence.content && (
        <Preview
          preview={consequence.content}
          label={kind === 'overwrite' ? 'Replaces the file with' : 'Content to write'}
        />
      )}

      {consequence.edit && (
        <div className="approval-edit">
          <div className="approval-edit-side approval-edit-before">
            <Preview preview={consequence.edit.before} label="Replaces" />
          </div>
          <div className="approval-edit-side approval-edit-after">
            <Preview preview={consequence.edit.after} label="With" />
          </div>
        </div>
      )}

      {consequence.raw && <Preview preview={consequence.raw} label="Arguments" />}
    </>
  );
}

/**
 * How long after the card appears before its buttons will act.
 *
 * A decision must be one a person actually made. A click that was already in
 * flight when the card appeared — a queued event, a double dispatch, a button
 * element React reused between two consecutive requests — is not that. During
 * the 2026-09-09 card work one approval was recorded that no one clicked and
 * that has not reproduced since; this window, together with the `key` on the
 * call site that forces fresh DOM per request, closes that class of bug rather
 * than leaving it to chance. It is below the threshold anyone can perceive.
 */
const ARM_DELAY_MS = 300;

export function ApprovalCard({
  request,
  onApprove,
  onDeny,
  onSwitchToTerminal,
  timeoutSeconds = 300
}: ApprovalCardProps) {
  const [timeLeft, setTimeLeft] = useState(timeoutSeconds);
  const [armed, setArmed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setArmed(false);
    const t = setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => clearTimeout(t);
  }, [request.actionId]);

  const decide = (approved: boolean) => {
    if (!armed) return;
    (approved ? onApprove : onDeny)(request.actionId);
  };

  useEffect(() => {
    const tick = () => {
      const started = request.timestamp || Date.now();
      setTimeLeft(Math.max(0, timeoutSeconds - Math.floor((Date.now() - started) / 1000)));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [request, timeoutSeconds]);

  // The card takes focus, but neither button is pre-selected: a stray Enter
  // must not approve anything. Escape denies, which is the safe direction.
  useEffect(() => {
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDeny(request.actionId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `onDeny` is deliberately not a dependency: it is a new closure on every
    // render of the parent, and re-running this effect each time would move
    // focus back to the card while someone is tabbing through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.actionId]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const urgent = timeLeft < 60;
  const consequence = request.consequence;
  const warnings = request.securityAnalysis?.warnings ?? [];
  const risk = request.securityAnalysis?.riskLevel;
  const critical = risk === 'critical' || risk === 'high';
  const terminalVariant = request.command === 'TERMINAL_ACTION_REQUIRED' && onSwitchToTerminal;

  return (
    <div className="dialog-overlay">
      <div
        ref={cardRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-label="Approve this action"
        className={`dialog-box approval-card ${critical ? 'approval-card-critical' : ''}`}
      >
        <div className="approval-head">
          <span className="approval-title">
            <IconAlertTriangle size={16} />
            Approve this action?
          </span>
          <span className="approval-meta">
            {consequence && <span className="approval-kind">{KIND_LABEL[consequence.kind]}</span>}
            <span className={`approval-timer ${urgent ? 'urgent' : ''}`}>
              {minutes}:{seconds.toString().padStart(2, '0')}
            </span>
          </span>
        </div>

        <div className="approval-body">
          {consequence ? (
            <Consequence consequence={consequence} />
          ) : (
            <>
              <div className="approval-headline">{request.description}</div>
              {!terminalVariant && (
                <div className="approval-preview">
                  <div className="approval-preview-head">
                    <span>Command</span>
                  </div>
                  <pre className="approval-preview-body approval-command">{request.command}</pre>
                </div>
              )}
            </>
          )}

          {consequence?.escalationReason && (
            <p className="approval-note">Claude Code escalated this: {consequence.escalationReason}</p>
          )}

          {warnings.length > 0 && (
            <ul className="approval-warnings">
              {warnings.map(w => (
                <li key={w}>
                  <IconAlertTriangle size={12} /> {w}
                </li>
              ))}
            </ul>
          )}

          {consequence?.mutates === false && (
            <p className="approval-note approval-note-calm">
              <IconCheck size={12} /> This changes nothing on your machine.
            </p>
          )}
        </div>

        <div className="approval-foot">
          <span className="approval-hint">
            Nothing runs until you decide. Denying tells the agent why, and it continues.
          </span>
          <div className="approval-actions">
            {terminalVariant ? (
              <button
                className="btn-approve"
                onClick={() => onSwitchToTerminal!(request.actionId)}
              >
                Switch to the terminal
              </button>
            ) : (
              <>
                <button className="btn-deny" onClick={() => decide(false)}>
                  Deny
                </button>
                <button className="btn-approve" onClick={() => decide(true)}>
                  Approve
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
