import { useEffect, useState } from 'react';
import type { ChannelInfo } from '@asterim/shared';
import { getAuthHeaders } from '../utils/auth';

/**
 * Which Core this dashboard is talking to (DEC-029).
 *
 * One read, on mount and whenever the backend changes. The channel of a running
 * process cannot change under it, so there is nothing to poll — and a Core too
 * old to know the endpoint answers 404, which is read as "stable" rather than as
 * an error, because that is what every Asterim before this was.
 *
 * With no explicit workstation the request is same-origin, not
 * `resolveBackendUrl()`. That helper hardcodes port 3000, which is the stable
 * Core — asking it which channel it is would answer about a different process
 * than the one serving this page, and the dashboard of a development Core would
 * never badge itself.
 */
export function useChannel(backendUrl?: string | null): ChannelInfo | null {
  const [channel, setChannel] = useState<ChannelInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    const baseUrl = backendUrl || '';

    fetch(`${baseUrl}/api/v1/system/channel`, { headers: getAuthHeaders({ backendUrl }) })
      .then(res => (res.ok ? res.json() : null))
      .then((data: ChannelInfo | null) => {
        if (cancelled) return;
        setChannel(data && typeof data.channel === 'string' ? data : null);
      })
      .catch(() => {
        // A Core that is down or unreachable is not a development Core; leaving
        // the badge off is the honest state.
        if (!cancelled) setChannel(null);
      });

    return () => {
      cancelled = true;
    };
  }, [backendUrl]);

  return channel;
}
