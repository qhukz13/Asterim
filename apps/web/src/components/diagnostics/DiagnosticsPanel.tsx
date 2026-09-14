import React, { useCallback, useEffect, useState } from 'react';
import type { DiagnosticCheck, DiagnosticsReport } from '@asterim/shared';
import { getAuthHeaders } from '../../utils/auth';
import { IconCheck, IconAlertTriangle, IconRefresh } from '../icons/Icons';

/**
 * "Is my machine set up correctly, and if not, what do I do?"
 *
 * Everything shown comes from the Core's own checks and is computed on demand.
 * Nothing is transmitted: the copy button exists so a person can choose to
 * paste it into an issue, which is the whole support story for the first
 * release (`docs/product/metrics.md`).
 */

function StatusRow({ check }: { check: DiagnosticCheck }) {
  return (
    <li className={`diag-row diag-${check.status}`}>
      <span className="diag-icon">
        {check.status === 'ok' ? <IconCheck size={13} /> : <IconAlertTriangle size={13} />}
      </span>
      <span className="diag-body">
        <span className="diag-label">{check.label}</span>
        {check.detail && <span className="diag-detail">{check.detail}</span>}
        {check.remedy && check.status !== 'ok' && <span className="diag-remedy">{check.remedy}</span>}
      </span>
    </li>
  );
}

export function DiagnosticsPanel({ activeBackendUrl }: { activeBackendUrl?: string }) {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = activeBackendUrl || window.location.origin;
      const res = await fetch(`${base}/api/v1/system/diagnostics`, {
        headers: getAuthHeaders({ backendUrl: activeBackendUrl })
      });
      if (!res.ok) throw new Error(`The server answered ${res.status}`);
      const data = await res.json();
      setReport(data.report);
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

  const problems = report
    ? [...report.agents, ...report.environment].filter(c => c.status !== 'ok').length
    : 0;

  return (
    <div className="settings-card glass-panel diag-panel">
      <div className="diag-head">
        <div>
          <h3>Diagnostics</h3>
          <p className="diag-sub">
            What Asterim found on this machine. Nothing here is sent anywhere; copy it into an issue
            if you need help.
          </p>
        </div>
        <button className="btn-secondary diag-refresh" onClick={() => void load()} disabled={loading}>
          <IconRefresh size={13} /> {loading ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      {error && <div className="diag-error">{error}</div>}

      {report && (
        <>
          <div className="diag-summary">
            {problems === 0
              ? 'Everything Asterim needs is present.'
              : `${problems} thing${problems === 1 ? '' : 's'} need${problems === 1 ? 's' : ''} attention.`}
          </div>

          <div className="diag-group">
            <div className="diag-group-title">Agents</div>
            <ul className="diag-list">
              {report.agents.map(c => (
                <StatusRow key={c.id} check={c} />
              ))}
            </ul>
          </div>

          <div className="diag-group">
            <div className="diag-group-title">Environment</div>
            <ul className="diag-list">
              {report.environment.map(c => (
                <StatusRow key={c.id} check={c} />
              ))}
            </ul>
          </div>

          <div className="diag-meta">
            Asterim {report.asterim.version} · {report.asterim.channel} channel · Node{' '}
            {report.runtime.node} · {report.runtime.platform} {report.runtime.arch}
          </div>

          <div className="diag-actions">
            <button className="btn-primary" onClick={copy}>
              {copied ? 'Copied' : 'Copy diagnostics'}
            </button>
            <span className="diag-hint">
              Includes {report.logTail.length} recent log lines with paths and credentials removed.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
