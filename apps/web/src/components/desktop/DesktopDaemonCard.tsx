import React, { useEffect } from 'react';
import type { DesktopPlatform, DesktopStatus, DesktopVaultState } from '@asterim/shared';
import { useDesktopStore, type DesktopQuickAction } from '../../stores/useDesktopStore';
import { IconActivity, IconAlertTriangle, IconCheck, IconRefresh } from '../icons/Icons';

/**
 * The workstation desktop daemon, rendered (P10-02).
 *
 * The tray icon and this card answer the same question — is the Core up, what
 * is it holding, and will it come back after a reboot — so neither of them
 * computes that answer. `DesktopTrayStatus` is the Core's verdict and both
 * surfaces render it; a second opinion here is how the tray tooltip and the
 * dashboard end up disagreeing about what ONLINE means.
 *
 * Everything below the metrics grid does something to the operator's physical
 * desktop, and one of those things is invisible from inside the browser: a
 * notification that was skipped on a headless host produces nothing on screen.
 * That is why every action reports back in words rather than by the effect
 * being visible.
 */

export interface DesktopTrayVerdict {
  label: string;
  detail: string;
  color: string;
  background: string;
}

/**
 * How the daemon state reads.
 *
 * Pure, so the wording of each state can be asserted without rendering, and so
 * `PAUSED` and `OFFLINE` stay distinguishable: a Core that is deliberately not
 * acting and a Core that cannot answer for itself are different situations with
 * different remedies, and collapsing them is the mistake the shared type was
 * written to prevent.
 */
export function trayVerdictOf(status: DesktopStatus | null): DesktopTrayVerdict {
  if (!status) {
    return {
      label: 'Daemon status unavailable',
      detail: 'The Core did not report a desktop daemon status.',
      color: 'var(--color-text-muted)',
      background: 'var(--color-surface-2)'
    };
  }

  switch (status.trayStatus.state) {
    case 'ONLINE':
      return {
        label: 'Daemon online',
        detail: status.trayStatus.label,
        color: 'var(--color-state-completed)',
        background: 'var(--color-state-completed-bg)'
      };
    case 'PAUSED':
      return {
        label: 'Daemon paused',
        detail: `${status.trayStatus.label} — the Core is running and deliberately not acting.`,
        color: 'var(--color-state-paused)',
        background: 'var(--color-state-paused-bg)'
      };
    default:
      return {
        label: 'Daemon offline',
        detail: `${status.trayStatus.label} — the Core cannot read its own database.`,
        color: 'var(--color-state-error)',
        background: 'var(--color-state-error-bg)'
      };
  }
}

/**
 * An uptime as a duration a human reads at a glance.
 *
 * Two units at most: "3d 4h" is the answer to "has it been up since I last
 * rebooted", and the minutes in it are noise.
 */
export function formatUptime(seconds: number | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return 'unknown';
  const whole = Math.floor(seconds);
  if (whole < 60) return `${whole}s`;

  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}m ${whole % 60}s`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;

  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** The resident set size badge. The Core already rounds to whole megabytes. */
export function formatMemory(memoryMb: number | undefined): string {
  if (typeof memoryMb !== 'number' || !Number.isFinite(memoryMb) || memoryMb < 0) return 'unknown';
  return `${Math.round(memoryMb)} MB`;
}

/** The vault badge, and whether it is the state an operator wants to see. */
export function vaultBadgeOf(vault: DesktopVaultState | undefined): {
  value: string;
  tone: 'good' | 'warn';
  hint: string;
} {
  switch (vault) {
    case 'ENCRYPTED':
      return {
        value: 'ENCRYPTED',
        tone: 'good',
        hint: 'Stored credentials are encrypted at rest'
      };
    case 'PLAINTEXT':
      return {
        value: 'PLAINTEXT',
        tone: 'warn',
        hint: 'Credentials are still readable on disk'
      };
    default:
      return {
        value: 'UNAVAILABLE',
        tone: 'warn',
        hint: 'The vault could not be read'
      };
  }
}

/** What the login entry is on this platform, named as the OS names it. */
export function autoStartMechanismOf(platform: DesktopPlatform | undefined): {
  label: string;
  available: boolean;
} {
  switch (platform) {
    case 'win32':
      return { label: 'Registry (HKCU Run key)', available: true };
    case 'darwin':
      return { label: 'LaunchAgent', available: true };
    case 'linux':
      return { label: 'XDG autostart entry', available: true };
    default:
      return { label: 'No login-item mechanism on this platform', available: false };
  }
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

interface ActionButtonProps {
  label: string;
  pendingLabel: string;
  onClick: () => void;
  isPending: boolean;
  disabled: boolean;
}

const ActionButton: React.FC<ActionButtonProps> = ({
  label,
  pendingLabel,
  onClick,
  isPending,
  disabled
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-busy={isPending || undefined}
    style={{
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-border-default)',
      color: disabled ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
      padding: '7px 12px',
      borderRadius: '6px',
      fontSize: '0.78rem',
      fontWeight: 600,
      cursor: disabled ? 'not-allowed' : isPending ? 'wait' : 'pointer',
      transition: 'border-color 150ms ease, color 150ms ease'
    }}
  >
    {isPending ? pendingLabel : label}
  </button>
);

export interface DesktopDaemonCardViewProps {
  status: DesktopStatus | null;
  isLoading: boolean;
  isTogglingAutoStart: boolean;
  pendingAction: DesktopQuickAction | null;
  error: string | null;
  notice: string | null;
  onRefresh?: () => void;
  onToggleAutoStart: (enabled: boolean) => void;
  onOpenDataDirectory: () => void;
  onOpenLogFile: () => void;
  onSendTestNotification: () => void;
}

export const DesktopDaemonCardView: React.FC<DesktopDaemonCardViewProps> = ({
  status,
  isLoading,
  isTogglingAutoStart,
  pendingAction,
  error,
  notice,
  onRefresh,
  onToggleAutoStart,
  onOpenDataDirectory,
  onOpenLogFile,
  onSendTestNotification
}) => {
  const verdict = trayVerdictOf(status);
  const tray = status?.trayStatus;
  const vault = vaultBadgeOf(tray?.vault);
  const mechanism = autoStartMechanismOf(status?.platform);
  const autoStartOn = status?.autoStartEnabled === true;
  // Nothing below the banner is actionable before a status has arrived: every
  // one of these endpoints acts on a Core this card has not heard from yet.
  const actionsDisabled = !status || isLoading || pendingAction !== null;

  return (
    <section
      aria-label="Workstation desktop daemon"
      style={{
        padding: '18px 20px',
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-border-default)',
        borderRadius: '10px',
        maxWidth: '720px'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap'
        }}
      >
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
          <IconActivity size={16} color="var(--color-accent-primary)" />
          Workstation Daemon
        </h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {status?.isHeadless && (
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                padding: '3px 8px',
                borderRadius: '10px',
                background: 'var(--color-surface-3)',
                border: '1px solid var(--color-border-default)',
                color: 'var(--color-text-muted)'
              }}
            >
              Headless / CI
            </span>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              aria-label="Refresh desktop daemon status"
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
        {tray?.state === 'ONLINE' ? (
          <IconCheck size={16} color={verdict.color} />
        ) : (
          <IconAlertTriangle size={16} color={verdict.color} />
        )}
        <div>
          <div style={{ color: verdict.color, fontWeight: 700, fontSize: '0.85rem' }}>{verdict.label}</div>
          <div
            style={{
              color: 'var(--color-text-secondary)',
              fontSize: '0.78rem',
              marginTop: '3px',
              lineHeight: 1.5
            }}
          >
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

      {notice && !error && (
        <div
          role="status"
          style={{
            marginTop: '12px',
            padding: '9px 12px',
            borderRadius: '6px',
            background: 'var(--color-accent-subtle)',
            border: '1px solid var(--color-accent-primary)',
            color: 'var(--color-accent-hover)',
            fontSize: '0.78rem'
          }}
        >
          {notice}
        </div>
      )}

      {status && (
        <div
          style={{
            marginTop: '14px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '10px'
          }}
        >
          <Metric label="Platform" value={status.platform} hint={mechanism.label} />
          <Metric
            label="Active threads"
            value={`${tray?.activeThreads ?? 0}`}
            hint="Agent sessions the Core is running"
          />
          <Metric
            label="Supervised MCP"
            value={`${tray?.activeMcpServers ?? 0} running`}
            hint="MCP servers under the Core's supervisor"
          />
          <Metric label="Workstation vault" value={vault.value} tone={vault.tone} hint={vault.hint} />
          <Metric label="Memory (RSS)" value={formatMemory(tray?.memoryMb)} hint="Resident set size of the Core process" />
          <Metric label="Uptime" value={formatUptime(tray?.uptimeSeconds)} hint="Since the Core last started" />
        </div>
      )}

      {status && (
        <div
          style={{
            marginTop: '14px',
            padding: '12px 14px',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: '8px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Start at login
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '3px', lineHeight: 1.4 }}>
              {mechanism.available
                ? `${mechanism.label} · ${autoStartOn ? 'registered' : 'not registered'}`
                : mechanism.label}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoStartOn}
            aria-label="Start Asterim at login"
            disabled={!mechanism.available || isTogglingAutoStart || isLoading}
            onClick={() => onToggleAutoStart(!autoStartOn)}
            style={{
              position: 'relative',
              width: '46px',
              height: '24px',
              flexShrink: 0,
              borderRadius: '12px',
              border: `1px solid ${autoStartOn ? 'var(--color-accent-primary)' : 'var(--color-border-default)'}`,
              background: autoStartOn ? 'var(--color-accent-subtle)' : 'var(--color-surface-3)',
              cursor: !mechanism.available ? 'not-allowed' : isTogglingAutoStart ? 'wait' : 'pointer',
              opacity: mechanism.available ? 1 : 0.5,
              transition: 'background 150ms ease, border-color 150ms ease'
            }}
          >
            <span
              style={{
                display: 'block',
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: autoStartOn ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                transform: `translateX(${autoStartOn ? '20px' : '2px'})`,
                transition: 'transform 150ms ease, background 150ms ease'
              }}
            />
          </button>
        </div>
      )}

      {status && (
        <div style={{ marginTop: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <ActionButton
            label="Reveal Data Directory"
            pendingLabel="Opening…"
            onClick={onOpenDataDirectory}
            isPending={pendingAction === 'open-data-dir'}
            disabled={actionsDisabled}
          />
          <ActionButton
            label="View Server Log"
            pendingLabel="Opening…"
            onClick={onOpenLogFile}
            isPending={pendingAction === 'open-log'}
            disabled={actionsDisabled}
          />
          <ActionButton
            label="Test OS Notification"
            pendingLabel="Sending…"
            onClick={onSendTestNotification}
            isPending={pendingAction === 'notify'}
            disabled={actionsDisabled || status.isHeadless}
          />
        </div>
      )}

      {status && (
        <div
          style={{
            marginTop: '10px',
            fontSize: '0.72rem',
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-family-mono)',
            wordBreak: 'break-all'
          }}
        >
          {status.dataDir}
        </div>
      )}

      {!status && !error && isLoading && (
        <div style={{ marginTop: '12px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          Reading daemon status…
        </div>
      )}
    </section>
  );
};

/** The connected card. Loads once on mount; every other call is a button press. */
export const DesktopDaemonCard: React.FC = () => {
  const status = useDesktopStore(state => state.status);
  const isLoading = useDesktopStore(state => state.isLoading);
  const isTogglingAutoStart = useDesktopStore(state => state.isTogglingAutoStart);
  const pendingAction = useDesktopStore(state => state.pendingAction);
  const error = useDesktopStore(state => state.error);
  const notice = useDesktopStore(state => state.actionNotice);
  const fetchStatus = useDesktopStore(state => state.fetchStatus);
  const toggleAutoStart = useDesktopStore(state => state.toggleAutoStart);
  const openDataDirectory = useDesktopStore(state => state.openDataDirectory);
  const openLogFile = useDesktopStore(state => state.openLogFile);
  const sendTestNotification = useDesktopStore(state => state.sendTestNotification);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return (
    <DesktopDaemonCardView
      status={status}
      isLoading={isLoading}
      isTogglingAutoStart={isTogglingAutoStart}
      pendingAction={pendingAction}
      error={error}
      notice={notice}
      onRefresh={fetchStatus}
      onToggleAutoStart={enabled => {
        // Re-read on success only: the Core's answer also moves the entry path
        // and the tray label, and a refresh clears `error`, which would erase
        // the reason a refused toggle just wrote there.
        void toggleAutoStart(enabled).then(ok => {
          if (ok) fetchStatus();
        });
      }}
      onOpenDataDirectory={() => void openDataDirectory()}
      onOpenLogFile={() => void openLogFile()}
      onSendTestNotification={() => void sendTestNotification('SYSTEM')}
    />
  );
};
