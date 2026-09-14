/**
 * The local usage summary (task P0-11).
 *
 * Counts and durations only. No project name, path, prompt, command, file name
 * or tool input ever enters this shape — that is the whole reason it can be
 * copied into a support conversation without the user having to read it line by
 * line first. The type lives in `@asterim/shared` because the dashboard renders
 * exactly what `asterim stats` prints.
 *
 * Nothing here is transmitted. It is computed on demand from the local database
 * and handed to whoever asked: the terminal, or the Settings panel in the
 * browser the user paired.
 */

/** One `label: count` row, used wherever a breakdown is open-ended. */
export interface UsageBreakdown {
  label: string;
  count: number;
}

export interface UsageSummary {
  /** Milliseconds since the epoch of the earliest activity found, or null when the database is empty. */
  firstActivityAt: number | null;
  /** When the summary was computed. */
  generatedAt: number;
  /** Whole days spanned by the record, 1 for a database used only today. */
  days: number;

  sessions: number;
  /** Distinct calendar days on which a session started, in local time. */
  activeDays: number;
  projects: number;
  threads: number;

  /** Agent replies, by the provider that produced them. */
  turns: number;
  turnsByProvider: UsageBreakdown[];
  /** Tool calls the agent made, across every provider. */
  toolCalls: number;

  approvals: {
    total: number;
    approved: number;
    denied: number;
    expired: number;
    /** Cancelled by the agent's own hooks or rules before the person answered. */
    withdrawn: number;
    /** Any status the Core did not expect, kept so a count is never silently lost. */
    other: number;
  };

  /** Milliseconds from the first recorded activity to the first approval request, or null. */
  msToFirstApproval: number | null;

  /** Agent starts that failed, by diagnosis code. Empty when nothing failed. */
  startFailures: UsageBreakdown[];
  startFailureTotal: number;

  /**
   * Counters the schema cannot answer on this database — an older installation
   * missing a table, say. Named so the summary says "not recorded" instead of
   * printing a zero that reads like a fact.
   */
  unavailable: string[];
}
