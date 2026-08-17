import React, { useEffect } from 'react';
import type { VaultStatusResponse } from '@asterim/shared';
import { useSecretStore } from '../../stores/useSecretStore';
import { IconShield, IconAlertTriangle, IconRefresh } from '../icons/Icons';

/**
 * Workstation vault health (P9-03).
 *
 * One question, asked by an operator or an enterprise audit: is anything on this
 * workstation still readable on disk? `GET /api/v1/security/vault-status`
 * answers it in a shape that cannot carry a credential — algorithm names, the
 * key names the vault manages, and a count per state — and this card is that
 * answer rendered, nothing more. It computes no health of its own: `healthy` is
 * the Core's verdict, because the Core is the only thing that can open an
 * envelope to find out whether it still opens.
 *
 * The amber case matters more than the green one. An unreadable envelope means
 * a credential encrypted under a key this machine can no longer derive — a
 * restored backup, a copied database, a deleted salt — and it is invisible
 * everywhere else in the product until an agent session fails to authenticate.
 */

export type VaultHealth = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

export interface VaultHealthVerdict {
  health: VaultHealth;
  label: string;
  detail: string;
  color: string;
  background: string;
}

/**
 * How the status reads. Pure, so the wording for each state can be asserted
 * without rendering, and so the amber cases stay distinguishable: "the vault
 * cannot derive its key" and "two envelopes will not open" are different
 * failures with different remedies.
 */
export function vaultHealthOf(status: VaultStatusResponse | null): VaultHealthVerdict {
  if (!status || !status.vault) {
    return {
      health: 'unknown',
      label: 'Vault status unavailable',
      detail: 'The Core did not report a vault status.',
      color: 'var(--color-text-muted)',
      background: 'var(--color-surface-2)'
    };
  }

  const vault = status.vault;
  const env = vault.environmentSecrets;

  if (!vault.ready) {
    return {
      health: 'unavailable',
      label: 'Vault key unavailable',
      detail:
        'The vault could not derive its key on this machine. Stored credentials cannot be read until it can.',
      color: 'var(--color-state-error)',
      background: 'var(--color-state-error-bg)'
    };
  }

  const unreadable = (vault.unreadableKeys || 0) + (env?.unreadable || 0);
  if (unreadable > 0) {
    return {
      health: 'degraded',
      label: 'Unreadable envelopes detected',
      detail: `${unreadable} stored credential${unreadable === 1 ? '' : 's'} cannot be opened with this machine's vault key — usually a database copied from another workstation.`,
      color: 'var(--color-state-paused)',
      background: 'var(--color-state-paused-bg)'
    };
  }

  const plaintext = (vault.plaintextKeys || 0) + (env?.plaintext || 0);
  if (plaintext > 0) {
    return {
      health: 'degraded',
      label: 'Plaintext credentials on disk',
      detail: `${plaintext} credential${plaintext === 1 ? ' is' : 's are'} still stored unencrypted. They are encrypted on the next Core start.`,
      color: 'var(--color-state-paused)',
      background: 'var(--color-state-paused-bg)'
    };
  }

  if (!status.healthy) {
    return {
      health: 'degraded',
      label: 'Vault reports a problem',
      detail: 'The Core did not report this workstation as healthy.',
      color: 'var(--color-state-paused)',
      background: 'var(--color-state-paused-bg)'
    };
  }

  return {
    health: 'healthy',
    label: 'Vault active & healthy',
    detail: 'Every managed credential on this workstation is encrypted at rest and readable by this machine only.',
    color: 'var(--color-state-completed)',
    background: 'var(--color-state-completed-bg)'
  };
}

interface MetricProps {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'good' | 'warn';
}

const Metric: React.FC<MetricProps> = ({ label, value, hint, tone = 'default' }) => (
  <div
    style={{
      padding: '12px 14px',
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: '8px',
      minWidth: 0
    }}
  >
    <div
      style={{
        fontSize: '0.7rem',
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: 'var(--color-text-muted)'
      }}
    >
      {label}
    </div>
    <div
      style={{
        marginTop: '5px',
        fontFamily: 'var(--font-family-mono)',
        fontSize: '0.95rem',
        fontWeight: 700,
        color:
          tone === 'good'
            ? 'var(--color-state-completed)'
            : tone === 'warn'
              ? 'var(--color-state-paused)'
              : 'var(--color-text-primary)',
        wordBreak: 'break-word'
      }}
    >
      {value}
    </div>
    {hint && (
      <div style={{ marginTop: '4px', fontSize: '0.72rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
        {hint}
      </div>
    )}
  </div>
);

export interface SecurityStatusCardViewProps {
  status: VaultStatusResponse | null;
  isLoading: boolean;
  error: string | null;
  onRefresh?: () => void;
}

export const SecurityStatusCardView: React.FC<SecurityStatusCardViewProps> = ({
  status,
  isLoading,
  error,
  onRefresh
}) => {
  const verdict = vaultHealthOf(status);
  const vault = status?.vault;
  const env = vault?.environmentSecrets;

  return (
    <section
      aria-label="Workstation security status"
      style={{
        padding: '18px 20px',
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-border-default)',
        borderRadius: '10px',
        maxWidth: '720px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <h4
          style={{
            margin: 0,
            fontSize: '0.95rem',
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <IconShield size={16} color="var(--color-accent-primary)" />
          Workstation Security
        </h4>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh vault status"
            disabled={isLoading}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border-default)',
              color: 'var(--color-text-secondary)',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '0.75rem',
              cursor: isLoading ? 'wait' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <IconRefresh size={12} />
            {isLoading ? 'Checking…' : 'Refresh'}
          </button>
        )}
      </div>

      <div
        style={{
          marginTop: '14px',
          padding: '12px 14px',
          borderRadius: '8px',
          background: verdict.background,
          border: `1px solid ${verdict.color}`,
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px'
        }}
      >
        {verdict.health === 'healthy' ? (
          <IconShield size={16} color={verdict.color} />
        ) : (
          <IconAlertTriangle size={16} color={verdict.color} />
        )}
        <div>
          <div style={{ color: verdict.color, fontWeight: 700, fontSize: '0.85rem' }}>{verdict.label}</div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.78rem', marginTop: '3px', lineHeight: 1.5 }}>
            {verdict.detail}
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: '12px',
            padding: '9px 12px',
            borderRadius: '6px',
            background: 'var(--color-state-error-bg)',
            border: '1px solid var(--color-state-error)',
            color: 'var(--color-state-error)',
            fontSize: '0.78rem'
          }}
        >
          {error}
        </div>
      )}

      {vault && (
        <div
          style={{
            marginTop: '14px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '10px'
          }}
        >
          <Metric
            label="Cipher"
            value={vault.algorithm}
            hint={`${vault.keyDerivation}, ${vault.iterations.toLocaleString('en-US')} rounds`}
          />
          <Metric
            label="Key derivation salt"
            value={vault.saltPresent ? 'Present' : 'Missing'}
            tone={vault.saltPresent ? 'good' : 'warn'}
            hint={vault.saltPresent ? 'Bound to this machine and account' : 'Stored credentials cannot be opened'}
          />
          <Metric
            label="System credentials"
            value={`${vault.encryptedKeys} encrypted`}
            tone={vault.plaintextKeys > 0 || vault.unreadableKeys > 0 ? 'warn' : 'good'}
            hint={`${vault.plaintextKeys} plaintext · ${vault.unreadableKeys} unreadable · ${vault.managedKeys.length} managed keys`}
          />
          {env && (
            <Metric
              label="Environment secrets"
              value={`${env.encrypted} encrypted`}
              tone={env.plaintext > 0 || env.unreadable > 0 ? 'warn' : 'good'}
              hint={`${env.total} total across ${env.environments} environment${env.environments === 1 ? '' : 's'} · ${env.unreadable} unreadable`}
            />
          )}
          <Metric
            label="Migration"
            value={vault.migrationComplete && (!env || env.migrationComplete) ? 'Complete' : 'Pending'}
            tone={vault.migrationComplete && (!env || env.migrationComplete) ? 'good' : 'warn'}
            hint="Legacy plaintext rows are encrypted on Core start"
          />
          <Metric
            label="Output redaction"
            value={`${vault.redactedValues} value${vault.redactedValues === 1 ? '' : 's'}`}
            hint="Stripped from logs and the event stream"
          />
        </div>
      )}

      {!vault && !error && isLoading && (
        <div style={{ marginTop: '12px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          Reading vault status…
        </div>
      )}
    </section>
  );
};

/** The connected card. Loads once on mount; the panel refreshes it after writes. */
export const SecurityStatusCard: React.FC = () => {
  const status = useSecretStore(state => state.vaultStatus);
  const isLoading = useSecretStore(state => state.isVaultLoading);
  const error = useSecretStore(state => state.vaultError);
  const fetchVaultStatus = useSecretStore(state => state.fetchVaultStatus);

  useEffect(() => {
    fetchVaultStatus();
  }, [fetchVaultStatus]);

  return (
    <SecurityStatusCardView
      status={status}
      isLoading={isLoading}
      error={error}
      onRefresh={fetchVaultStatus}
    />
  );
};
