import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * The pattern for anything destructive.
 *
 * Three rules, from `docs/design/design-system.md`: say what will be removed by
 * name, say what will *not* be touched (so the person is not guessing), and
 * never let the dangerous button be the one a stray Enter presses — Cancel
 * takes focus, Escape cancels.
 */

export interface ConfirmDialogProps {
  title: string;
  /** What is about to happen, in plain words. */
  body: React.ReactNode;
  /** What this will not do. Shown quieter, below the body. */
  reassurance?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  destructive?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  reassurance,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = true,
  busy = false,
  error,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return createPortal(
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        className="dialog-box confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="confirm-title">{title}</h3>
        <div className="confirm-body">{body}</div>
        {reassurance && <p className="confirm-reassurance">{reassurance}</p>}
        {error && <p className="confirm-error">{error}</p>}
        <div className="confirm-actions">
          <button ref={cancelRef} className="btn-secondary confirm-cancel" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={destructive ? 'btn-deny' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
