import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { EnvironmentSecretSummary } from '@asterim/shared';
import { SECRET_MASK } from '@asterim/shared';
import { useSecretStore, secretsFor, validateSecretKey } from '../../stores/useSecretStore';
import { SecurityStatusCard } from '../security/SecurityStatusCard';

/**
 * Environment secrets, as an operator manages them (P9-03).
 *
 * The panel is built around what the API can and cannot do. `GET` never returns
 * a value, so there is no reveal control and no "copy secret" button — the list
 * shows key names, a mask and when the credential was introduced, and that is
 * the whole of what exists to show. A credential travels one way only: in.
 *
 * The value field is deliberately **uncontrolled**. A controlled password input
 * would put the credential in React state and, through it, into the rendered
 * tree as a `value` attribute — visible to anything that serialises the DOM.
 * Here the plaintext exists only in the DOM node the operator typed it into;
 * React tracks whether the field is non-empty, nothing more. On submit the value
 * is read once, the field is cleared before the request is awaited, and the
 * dashboard holds no copy of it at any point.
 *
 * Rotation is the same POST as creation — the Core upserts — so the form does
 * not need a second mode; typing an existing key replaces its value and keeps
 * its original timestamp.
 *
 * Deletion asks first. Removing a credential an agent session depends on is not
 * undoable from here (the value is gone, not archived), so the row's Remove
 * button arms a confirmation in place rather than acting on the first click.
 */

/** `YYYY-MM-DD`, in UTC. Stable wherever it renders, unlike a locale string. */
export function formatSecretDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'unknown';
  try {
    return new Date(timestamp).toISOString().slice(0, 10);
  } catch {
    return 'unknown';
  }
}

const monoStyle: React.CSSProperties = {
  fontFamily: 'var(--font-family-mono)',
  letterSpacing: '0.02em'
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: '6px',
  background: 'var(--color-surface-0)',
  border: '1px solid var(--color-border-default)',
  color: 'var(--color-text-primary)',
  fontSize: '0.85rem',
  outline: 'none',
  boxSizing: 'border-box'
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  color: 'var(--color-text-secondary)',
  fontSize: '0.78rem',
  fontWeight: 600,
  marginBottom: '6px'
};

export interface EnvironmentSecretsPanelViewProps {
  environmentName: string;
  secrets: EnvironmentSecretSummary[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  notice: string | null;
  /**
   * The draft key. There is deliberately no `valueDraft` counterpart: the value
   * field is uncontrolled, so this view has no prop that could carry a
   * credential and no render of it can contain one.
   */
  keyDraft: string;
  /** Whether the value field currently holds anything, for the submit button. */
  hasValue: boolean;
  revealValue: boolean;
  /** Why the current key draft would be refused, or null. */
  keyWarning: string | null;
  pendingDelete: string | null;
  /** The uncontrolled value field, so the container can read and clear it. */
  valueInputRef?: React.Ref<HTMLInputElement>;
  onKeyChange: (key: string) => void;
  onValueInput: (hasValue: boolean) => void;
  onToggleReveal: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onRequestDelete: (key: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (key: string) => void;
}

export const EnvironmentSecretsPanelView: React.FC<EnvironmentSecretsPanelViewProps> = ({
  environmentName,
  secrets,
  isLoading,
  isSaving,
  error,
  notice,
  keyDraft,
  hasValue,
  revealValue,
  keyWarning,
  pendingDelete,
  valueInputRef,
  onKeyChange,
  onValueInput,
  onToggleReveal,
  onSubmit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete
}) => {
  const canSubmit = !isSaving && keyDraft.trim().length > 0 && hasValue && !keyWarning;

  return (
    <div style={{ maxWidth: '720px' }}>
      <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem', lineHeight: 1.5 }}>
        Credentials stored for <strong style={{ color: 'var(--color-text-primary)' }}>{environmentName}</strong> are
        encrypted at rest with the workstation vault and handed only to agent sessions started in this environment.
        They are never returned to this dashboard, so a stored value cannot be displayed again — only replaced.
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: '1rem',
            padding: '10px 14px',
            borderRadius: '8px',
            background: 'var(--color-state-error-bg)',
            border: '1px solid var(--color-state-error)',
            color: 'var(--color-state-error)',
            fontSize: '0.82rem'
          }}
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          style={{
            marginBottom: '1rem',
            padding: '10px 14px',
            borderRadius: '8px',
            background: 'var(--color-state-completed-bg)',
            border: '1px solid var(--color-state-completed)',
            color: 'var(--color-state-completed)',
            fontSize: '0.82rem'
          }}
        >
          {notice}
        </div>
      )}

      {/* --- The list ------------------------------------------------------- */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1.75rem' }}>
        {isLoading && secrets.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', padding: '1rem 0' }}>
            Loading secrets…
          </div>
        ) : secrets.length === 0 ? (
          <div
            style={{
              padding: '1.5rem',
              borderRadius: '10px',
              border: '1px dashed var(--color-border-default)',
              background: 'var(--color-surface-1)',
              color: 'var(--color-text-muted)',
              fontSize: '0.85rem',
              textAlign: 'center'
            }}
          >
            No secrets configured for this environment yet. Add one below and every agent session started here will
            receive it as an environment variable.
          </div>
        ) : (
          secrets.map(secret => (
            <div
              key={secret.key}
              style={{
                padding: '12px 16px',
                background: 'var(--color-surface-1)',
                borderRadius: '8px',
                border: '1px solid var(--color-border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap'
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ ...monoStyle, color: 'var(--color-text-primary)', fontWeight: 600, fontSize: '0.88rem' }}>
                  {secret.key}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '5px' }}>
                  <span
                    aria-label={`${secret.key} is stored and masked`}
                    style={{
                      ...monoStyle,
                      color: 'var(--color-text-muted)',
                      fontSize: '0.82rem',
                      background: 'var(--color-surface-0)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: '4px',
                      padding: '1px 8px'
                    }}
                  >
                    {secret.maskedValue || SECRET_MASK}
                  </span>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: secret.isSet ? 'var(--color-state-completed)' : 'var(--color-state-paused)'
                    }}
                  >
                    {secret.isSet ? 'Encrypted' : 'Not set'}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    Added {formatSecretDate(secret.createdAt)}
                  </span>
                </div>
              </div>

              {pendingDelete === secret.key ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--color-state-error)' }}>
                    Delete {secret.key}?
                  </span>
                  <button
                    type="button"
                    onClick={() => onConfirmDelete(secret.key)}
                    disabled={isSaving}
                    style={{
                      background: 'var(--color-state-error)',
                      border: 'none',
                      color: 'var(--color-text-contrast)',
                      padding: '5px 12px',
                      borderRadius: '6px',
                      fontWeight: 700,
                      fontSize: '0.78rem',
                      cursor: isSaving ? 'wait' : 'pointer'
                    }}
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    onClick={onCancelDelete}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-border-default)',
                      color: 'var(--color-text-secondary)',
                      padding: '5px 12px',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onRequestDelete(secret.key)}
                  aria-label={`Remove ${secret.key}`}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--color-border-default)',
                    color: 'var(--color-state-error)',
                    padding: '5px 12px',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* --- Add or rotate --------------------------------------------------- */}
      <form
        onSubmit={onSubmit}
        style={{
          padding: '16px 18px',
          background: 'var(--color-surface-1)',
          borderRadius: '10px',
          border: '1px solid var(--color-border-default)'
        }}
      >
        <h4
          style={{
            margin: '0 0 4px 0',
            fontSize: '0.95rem',
            fontWeight: 700,
            color: 'var(--color-text-primary)'
          }}
        >
          Add or rotate a secret
        </h4>
        <p style={{ margin: '0 0 14px 0', fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          Reusing an existing key rotates it in place. The new value takes effect for the next agent session.
        </p>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', minWidth: '200px' }}>
            <label htmlFor="secret-key-input" style={labelStyle}>
              Secret key
            </label>
            <input
              id="secret-key-input"
              name="secret-key"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={keyDraft}
              onChange={event => onKeyChange(event.target.value)}
              placeholder="DEPLOY_TOKEN"
              aria-invalid={keyWarning ? true : undefined}
              aria-describedby={keyWarning ? 'secret-key-warning' : undefined}
              style={{
                ...inputStyle,
                ...monoStyle,
                borderColor: keyWarning ? 'var(--color-state-error)' : 'var(--color-border-default)'
              }}
            />
          </div>

          <div style={{ flex: '1 1 260px', minWidth: '220px' }}>
            <label htmlFor="secret-value-input" style={labelStyle}>
              Secret value
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {/* Uncontrolled on purpose — see the note at the top of the file.
                  React never receives the credential, so it can never render it. */}
              <input
                id="secret-value-input"
                name="secret-value"
                ref={valueInputRef}
                type={revealValue ? 'text' : 'password'}
                autoComplete="new-password"
                spellCheck={false}
                onChange={event => onValueInput(event.target.value.length > 0)}
                placeholder="Paste the credential"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                type="button"
                onClick={onToggleReveal}
                aria-pressed={revealValue}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-border-default)',
                  color: 'var(--color-text-secondary)',
                  padding: '0 12px',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {revealValue ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
        </div>

        {keyWarning && (
          <div
            id="secret-key-warning"
            role="alert"
            style={{ marginTop: '10px', fontSize: '0.78rem', color: 'var(--color-state-error)' }}
          >
            {keyWarning}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '14px', flexWrap: 'wrap' }}>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              background: canSubmit ? 'var(--color-accent-primary)' : 'var(--color-surface-3)',
              border: 'none',
              color: canSubmit ? '#042114' : 'var(--color-text-muted)',
              padding: '9px 18px',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: canSubmit ? 'pointer' : 'not-allowed'
            }}
          >
            {isSaving ? 'Storing…' : 'Store secret'}
          </button>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            The value is cleared from this form the moment it is submitted and is never held by the dashboard.
          </span>
        </div>
      </form>
    </div>
  );
};

export interface EnvironmentSecretsPanelProps {
  environmentId: string;
  environmentName: string;
}

/** The connected panel: store subscription, draft state and the vault card. */
export const EnvironmentSecretsPanel: React.FC<EnvironmentSecretsPanelProps> = ({
  environmentId,
  environmentName
}) => {
  const secrets = useSecretStore(state => secretsFor(state.secretsByEnvironment, environmentId));
  const isLoading = useSecretStore(state => state.isLoading);
  const isSaving = useSecretStore(state => state.isSaving);
  const error = useSecretStore(state => state.error);
  const fetchSecrets = useSecretStore(state => state.fetchSecrets);
  const setSecret = useSecretStore(state => state.setSecret);
  const deleteSecret = useSecretStore(state => state.deleteSecret);
  const fetchVaultStatus = useSecretStore(state => state.fetchVaultStatus);

  const [keyDraft, setKeyDraft] = useState('');
  const [hasValue, setHasValue] = useState(false);
  const [revealValue, setRevealValue] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const valueInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (environmentId) fetchSecrets(environmentId);
  }, [environmentId, fetchSecrets]);

  const keyWarning = keyDraft.trim().length > 0 ? validateSecretKey(keyDraft) : null;

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const key = keyDraft.trim();
      const field = valueInputRef.current;
      const value = field?.value || '';
      if (!key || !value) return;

      // Cleared before the request, not after it: the field is empty while the
      // POST is in flight and stays empty if it fails, so a credential is never
      // sitting in a form the operator has walked away from. A failed submission
      // costs a re-paste, which is the right side of that trade.
      if (field) field.value = '';
      setHasValue(false);
      setRevealValue(false);
      setNotice(null);

      const result = await setSecret(environmentId, key, value);
      if (result.ok) {
        setKeyDraft('');
        setNotice(`${key} stored, encrypted with the workstation vault.`);
        // The tallies on the card below just changed.
        fetchVaultStatus();
      }
    },
    [environmentId, keyDraft, setSecret, fetchVaultStatus]
  );

  const handleConfirmDelete = useCallback(
    async (key: string) => {
      setPendingDelete(null);
      setNotice(null);
      const result = await deleteSecret(environmentId, key);
      if (result.ok) {
        setNotice(`${key} removed from this environment.`);
        fetchVaultStatus();
      }
    },
    [environmentId, deleteSecret, fetchVaultStatus]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <EnvironmentSecretsPanelView
        environmentName={environmentName}
        secrets={secrets}
        isLoading={isLoading}
        isSaving={isSaving}
        error={error}
        notice={notice}
        keyDraft={keyDraft}
        hasValue={hasValue}
        revealValue={revealValue}
        keyWarning={keyWarning}
        pendingDelete={pendingDelete}
        valueInputRef={valueInputRef}
        onKeyChange={setKeyDraft}
        onValueInput={setHasValue}
        onToggleReveal={() => setRevealValue(current => !current)}
        onSubmit={handleSubmit}
        onRequestDelete={setPendingDelete}
        onCancelDelete={() => setPendingDelete(null)}
        onConfirmDelete={handleConfirmDelete}
      />
      <SecurityStatusCard />
    </div>
  );
};
