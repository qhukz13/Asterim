import React from 'react';
import { DEV_CHANNEL_BADGE_LABEL, type ChannelInfo } from '@asterim/shared';

/**
 * "This is not your real Asterim" (DEC-029).
 *
 * A development Core is served from the same kind of URL as the stable one and
 * looks identical once it is open. The only visible difference is this badge, so
 * it is deliberately not subtle about which instance the operator is in — amber,
 * monospace, and the data directory in the tooltip so the answer to "which
 * database am I about to write to" is one hover away.
 *
 * Renders nothing on the stable channel. A badge that appeared on every run
 * would stop being read within a day.
 */

export interface ChannelBadgeProps {
  /** The Core's answer to `GET /api/v1/system/channel`, or null before it lands. */
  channel: ChannelInfo | null;
}

/** Whether the badge belongs on screen at all. */
export function shouldShowChannelBadge(channel: ChannelInfo | null | undefined): boolean {
  return !!channel && channel.channel === 'dev';
}

/** What a hover explains: which directory and port this instance owns. */
export function channelBadgeTitle(channel: ChannelInfo): string {
  return `Development channel — data directory ${channel.dataDir}, port ${channel.port} (Asterim ${channel.version}). Your stable Asterim data is untouched.`;
}

export function ChannelBadge({ channel }: ChannelBadgeProps) {
  if (!shouldShowChannelBadge(channel) || !channel) return null;

  return (
    <div
      data-testid="channel-badge"
      title={channelBadgeTitle(channel)}
      style={{
        padding: 'var(--spacing-1) var(--spacing-2)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--font-size-xs)',
        fontFamily: 'var(--font-family-mono)',
        fontWeight: 'var(--font-weight-semibold)',
        letterSpacing: '0.04em',
        background: 'var(--color-state-paused-bg)',
        color: 'var(--color-state-paused)',
        border: '1px solid rgba(245, 158, 11, 0.3)',
        whiteSpace: 'nowrap',
        flexShrink: 0
      }}
    >
      [{DEV_CHANNEL_BADGE_LABEL}]
    </div>
  );
}
