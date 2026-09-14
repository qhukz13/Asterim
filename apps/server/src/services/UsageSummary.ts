import type { DatabaseSync } from 'node:sqlite';
import type { UsageBreakdown, UsageSummary } from '@asterim/shared';

/**
 * The local usage summary (task P0-11).
 *
 * WHAT: reads the local database once and returns counts and durations
 * describing how this installation has actually been used.
 *
 * WHY: the soft launch ships no telemetry (`docs/product/metrics.md`,
 * decision 2026-09-09). The numbers Phase 2 needs still have to come from
 * somewhere, so they come from the user: they can see this, and they can choose
 * to paste it into a conversation. That makes it a feature they get rather than
 * instrumentation they tolerate, and it keeps `SECURITY.md`'s promise that
 * Asterim makes no outbound connections literally true.
 *
 * CONTRACT: every query here is read-only, and nothing it returns identifies
 * anything. Not a project name, not a path, not a prompt, not a command, not a
 * file name, not a tool input. If you add a counter, add it to
 * `UsageSummary.test.ts`'s leak assertion too — that test seeds a database
 * whose project name and path are distinctive strings and fails if either
 * appears anywhere in the formatted output.
 *
 * DO NOT: add a network call, a write, or an identifier. Any of the three
 * turns this from a feature into the thing it was written to avoid.
 */

/** Providers report themselves through the event source, `adapter:<name>`. */
const ADAPTER_SOURCE_PREFIX = 'adapter:';

/** Approval statuses the Core writes, mapped onto the summary's vocabulary. */
const APPROVAL_STATUS: Record<string, keyof UsageSummary['approvals']> = {
  approved: 'approved',
  denied: 'denied',
  expired: 'expired',
  cancelled: 'withdrawn',
  canceled: 'withdrawn',
  withdrawn: 'withdrawn'
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Runs `fn`, and on any database error records `label` as unavailable instead of throwing. */
function attempt<T>(unavailable: string[], label: string, fallback: T, fn: () => T): T {
  try {
    return fn();
  } catch {
    if (!unavailable.includes(label)) unavailable.push(label);
    return fallback;
  }
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Computes the summary from `db`.
 *
 * Every aggregate is guarded separately: a database migrated from a version
 * that predates a table answers "not recorded" for that one line and still
 * produces the rest. A summary that refuses to print because one counter is
 * missing would be useless in exactly the situation where someone is asking
 * for help.
 */
export function computeUsageSummary(db: DatabaseSync, now: number = Date.now()): UsageSummary {
  const unavailable: string[] = [];

  const sessions = attempt(unavailable, 'sessions', 0, () =>
    toNumber((db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c?: number })?.c)
  );

  const projects = attempt(unavailable, 'projects', 0, () =>
    toNumber((db.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c?: number })?.c)
  );

  const threads = attempt(unavailable, 'threads', 0, () =>
    toNumber((db.prepare('SELECT COUNT(*) AS c FROM threads').get() as { c?: number })?.c)
  );

  // Distinct local days. `started_at` is milliseconds, and SQLite's `date()`
  // wants seconds, hence the division; `localtime` so that "days used" means
  // days as the person experienced them rather than days in UTC.
  const activeDays = attempt(unavailable, 'sessions', 0, () =>
    toNumber(
      (
        db
          .prepare(
            "SELECT COUNT(DISTINCT date(started_at / 1000, 'unixepoch', 'localtime')) AS c FROM sessions"
          )
          .get() as { c?: number }
      )?.c
    )
  );

  // An agent reply is a `chat.message` written by an adapter. Messages the
  // person sent come from the server or from a remote client, so the source
  // prefix is the whole distinction and no payload has to be parsed.
  const turnRows = attempt<{ source?: string; c?: number }[]>(unavailable, 'turns', [], () =>
    db
      .prepare(
        `SELECT source, COUNT(*) AS c FROM events
          WHERE type = 'chat.message' AND source LIKE '${ADAPTER_SOURCE_PREFIX}%'
          GROUP BY source`
      )
      .all() as { source?: string; c?: number }[]
  );

  const turnsByProvider: UsageBreakdown[] = turnRows
    .map(row => ({
      label: String(row.source ?? '').slice(ADAPTER_SOURCE_PREFIX.length) || 'unknown',
      count: toNumber(row.c)
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const turns = turnsByProvider.reduce((sum, row) => sum + row.count, 0);

  const toolCalls = attempt(unavailable, 'tool calls', 0, () =>
    toNumber(
      (db.prepare("SELECT COUNT(*) AS c FROM events WHERE type = 'agent.tool_call'").get() as { c?: number })?.c
    )
  );

  const approvals: UsageSummary['approvals'] = {
    total: 0,
    approved: 0,
    denied: 0,
    expired: 0,
    withdrawn: 0,
    other: 0
  };
  const approvalRows = attempt<{ status?: string; c?: number }[]>(unavailable, 'approvals', [], () =>
    db.prepare('SELECT status, COUNT(*) AS c FROM approvals GROUP BY status').all() as {
      status?: string;
      c?: number;
    }[]
  );
  for (const row of approvalRows) {
    const count = toNumber(row.c);
    approvals.total += count;
    const bucket = APPROVAL_STATUS[String(row.status ?? '').toLowerCase()];
    if (bucket && bucket !== 'total') approvals[bucket] += count;
    else approvals.other += count;
  }

  // The earliest thing that happened, across the three tables that carry a
  // millisecond timestamp. `projects.created_at` is a SQL datetime string and
  // is deliberately left out rather than parsed into a different unit.
  const firstOf = (sql: string): number | null =>
    attempt<number | null>(unavailable, 'first activity', null, () => {
      const row = db.prepare(sql).get() as { t?: number | null } | undefined;
      const value = row?.t;
      return typeof value === 'number' && value > 0 ? value : null;
    });

  const candidates = [
    firstOf('SELECT MIN(started_at) AS t FROM sessions'),
    firstOf('SELECT MIN(timestamp) AS t FROM events'),
    firstOf('SELECT MIN(created_at) AS t FROM approvals')
  ].filter((value): value is number => value !== null);
  const firstActivityAt = candidates.length ? Math.min(...candidates) : null;

  const firstApprovalAt = firstOf('SELECT MIN(created_at) AS t FROM approvals');
  const msToFirstApproval =
    firstActivityAt !== null && firstApprovalAt !== null && firstApprovalAt >= firstActivityAt
      ? firstApprovalAt - firstActivityAt
      : null;

  // Start failures carry the diagnosis the dashboard showed. Grouping by the
  // code rather than the message is what keeps this free of paths: the code is
  // a fixed vocabulary (`DiagnosisCode`), the message is not.
  const failureRows = attempt<{ code?: string | null; c?: number }[]>(
    unavailable,
    'start failures',
    [],
    () =>
      db
        .prepare(
          `SELECT json_extract(payload_json, '$.diagnosis.code') AS code, COUNT(*) AS c
             FROM events
            WHERE type = 'agent.status'
              AND json_extract(payload_json, '$.status') = 'error'
            GROUP BY code`
        )
        .all() as { code?: string | null; c?: number }[]
  );
  const startFailures: UsageBreakdown[] = failureRows
    .map(row => ({ label: row.code ? String(row.code) : 'UNKNOWN', count: toNumber(row.c) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const startFailureTotal = startFailures.reduce((sum, row) => sum + row.count, 0);

  const days =
    firstActivityAt === null ? 0 : Math.max(1, Math.ceil((now - firstActivityAt) / DAY_MS));

  return {
    firstActivityAt,
    generatedAt: now,
    days,
    sessions,
    activeDays,
    projects,
    threads,
    turns,
    turnsByProvider,
    toolCalls,
    approvals,
    msToFirstApproval,
    startFailures,
    startFailureTotal,
    unavailable
  };
}

/** `4m12s`, `18s`, `2h05m`. Short enough to sit at the end of a line. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The summary as the text `asterim stats` prints and the Settings panel copies.
 *
 * One function so the two surfaces can never drift, and so the leak test has a
 * single string to search.
 */
export function formatUsageSummary(summary: UsageSummary): string {
  const lines: string[] = [];

  if (summary.firstActivityAt === null) {
    lines.push('Asterim usage — nothing recorded yet');
    lines.push('');
    lines.push('Pair a browser, add a project and give the agent a task; the numbers appear here.');
    return lines.join('\n');
  }

  const label = (text: string) => text.padEnd(20, ' ');
  const dayWord = summary.days === 1 ? 'day' : 'days';

  lines.push(`Asterim usage — since ${isoDay(summary.firstActivityAt)} (${summary.days} ${dayWord})`);
  lines.push('');
  lines.push(
    `${label('Sessions')}${summary.sessions} across ${summary.activeDays} ${
      summary.activeDays === 1 ? 'day' : 'days'
    }`
  );
  lines.push(`${label('Projects')}${summary.projects}`);
  lines.push(`${label('Threads')}${summary.threads}`);

  const providers = summary.turnsByProvider.length
    ? `  (${summary.turnsByProvider.map(p => `${p.label} ${p.count}`).join(', ')})`
    : '';
  lines.push(`${label('Agent turns')}${summary.turns}${providers}`);
  lines.push(`${label('Tool calls')}${summary.toolCalls}`);

  const a = summary.approvals;
  const parts = [`approved ${a.approved}`, `denied ${a.denied}`, `expired ${a.expired}`, `withdrawn ${a.withdrawn}`];
  if (a.other > 0) parts.push(`other ${a.other}`);
  lines.push(`${label('Approvals')}${a.total}  ${parts.join(' · ')}`);

  lines.push(
    `${label('First approval')}${
      summary.msToFirstApproval === null
        ? 'none yet'
        : `${formatDuration(summary.msToFirstApproval)} after first launch`
    }`
  );

  if (summary.startFailureTotal > 0) {
    lines.push(
      `${label('Start failures')}${summary.startFailureTotal}  (${summary.startFailures
        .map(f => `${f.label.toLowerCase()} ${f.count}`)
        .join(', ')})`
    );
  } else {
    lines.push(`${label('Start failures')}0`);
  }

  if (summary.unavailable.length) {
    lines.push('');
    lines.push(`Not recorded on this database: ${summary.unavailable.join(', ')}.`);
  }

  lines.push('');
  lines.push('Counts only — no names, paths, prompts or commands. Local to this machine;');
  lines.push('Asterim never sends it anywhere. Sharing it is your choice.');

  return lines.join('\n');
}
