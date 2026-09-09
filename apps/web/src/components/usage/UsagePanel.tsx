import React, { useCallback, useEffect, useState } from 'react';
import type { UsageSummary } from '@asterim/shared';
import { getAuthHeaders } from '../../utils/auth';
import { IconRefresh } from '../icons/Icons';

/**
 * "How much have I actually used this, and what happened at the gate?"
 *
 * The same numbers `asterim stats` prints, rendered from the same formatter, so
 * the panel and the terminal can never disagree. Everything is computed on
 * demand from the local database; Asterim transmits none of it (task P0-11,
 * `docs/product/metrics.md`). The copy button exists because sharing it is a
 * choice the user makes, not one the product makes for them.
 */

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <li className="usage-row">
      <span className="usage-label">{label}</span>
      <span className="usage-value">{value}</span>
      {hint && <span className="usage-hint">{hint}</span>}
    </li>
  );
}

/** `4m12s`, `18s`, `2h05m` — mirrors the server's `formatDuration`. */
function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`;
}

export function UsagePanel({ activeBackendUrl }: { activeBackendUrl?: string }) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = activeBackendUrl || window.location.origin;
      const res = await fetch(`${base}/api/v1/system/usage`, {
        headers: getAuthHeaders({ backendUrl: activeBackendUrl })
      });
      if (!res.ok) throw new Error(`The server answered ${res.status}`);
      const data = await res.json();
      setSummary(data.summary);
      setText(data.text || '');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeBackendUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('The clipboard is blocked. Select the text below and copy it manually.');
    }
  };

  const empty = summary !== null && summary.firstActivityAt === null;

  return (
    <div className="settings-card glass-panel usage-panel">
      <div className="usage-head">
        <div>
          <h3>Usage on this machine</h3>
          <p className="usage-sub">
            Counted from your own database. No names, paths, prompts or commands. Asterim never
            sends it anywhere — sharing it is your choice.
          </p>
        </div>
        <button className="btn-secondary usage-refresh" onClick={() => void load()} disabled={loading}>
          <IconRefresh size={13} /> {loading ? 'Reading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="usage-error">{error}</div>}

      {empty && (
        <div className="usage-empty">
          Nothing recorded yet. Add a project and give an agent a task; the numbers appear here.
        </div>
      )}

      {summary && !empty && (
        <>
          <div className="usage-period">
            Since {new Date(summary.firstActivityAt as number).toLocaleDateString()} ·{' '}
            {summary.days} {summary.days === 1 ? 'day' : 'days'}
          </div>

          <ul className="usage-list">
            <Row
              label="Sessions"
              value={String(summary.sessions)}
              hint={`across ${summary.activeDays} ${summary.activeDays === 1 ? 'day' : 'days'}`}
            />
            <Row label="Projects" value={String(summary.projects)} />
            <Row label="Threads" value={String(summary.threads)} />
            <Row
              label="Agent turns"
              value={String(summary.turns)}
              hint={
                summary.turnsByProvider.length
                  ? summary.turnsByProvider.map(p => `${p.label} ${p.count}`).join(' · ')
                  : undefined
              }
            />
            <Row label="Tool calls" value={String(summary.toolCalls)} />
            <Row
              label="Approvals"
              value={String(summary.approvals.total)}
              hint={`approved ${summary.approvals.approved} · denied ${summary.approvals.denied} · expired ${summary.approvals.expired} · withdrawn ${summary.approvals.withdrawn}`}
            />
            <Row
              label="First approval"
              value={
                summary.msToFirstApproval === null
                  ? 'none yet'
                  : duration(summary.msToFirstApproval)
              }
              hint={summary.msToFirstApproval === null ? undefined : 'after first launch'}
            />
            <Row
              label="Start failures"
              value={String(summary.startFailureTotal)}
              hint={
                summary.startFailures.length
                  ? summary.startFailures.map(f => `${f.label.toLowerCase()} ${f.count}`).join(' · ')
                  : undefined
              }
            />
          </ul>

          {summary.unavailable.length > 0 && (
            <div className="usage-note">
              Not recorded on this database: {summary.unavailable.join(', ')}.
            </div>
          )}

          <div className="usage-actions">
            <button className="btn-primary" onClick={copy}>
              {copied ? 'Copied' : 'Copy summary'}
            </button>
            <span className="usage-hint-inline">
              Withdrawn means your own Claude Code hooks or rules answered before you did.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
