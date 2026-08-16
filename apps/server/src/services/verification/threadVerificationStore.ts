/**
 * Where a thread's last verification report is kept (P8-02).
 *
 * One row, one report, overwritten each pass — the same shape `worktree_path`
 * takes, and for the same reason: a thread has at most one sandbox and at most
 * one current answer about whether the work in it is sound. History is not kept
 * here because a superseded verification is not evidence of anything; the run
 * that matters is the last one.
 *
 * It lives beside the pipeline rather than inside it because the service itself
 * deals only in directories — it has no idea what a thread is, and giving it one
 * would make a subsystem that shells out to `tsc` also a subsystem that owns
 * storage. The delegation service writes through here after a child settles, and
 * the REST surface reads through here, so both agree on the column.
 */

import { VerificationPipelineReport } from '@asterim/shared';
import { dbService } from '../DatabaseService';

/** Records the latest verification for a thread. Never throws. */
export function saveThreadVerificationReport(
  threadId: string,
  report: VerificationPipelineReport
): void {
  if (!threadId || !report) return;
  try {
    dbService
      .getDb()
      .prepare('UPDATE threads SET verification_report_json = ? WHERE id = ?')
      .run(JSON.stringify(report), threadId);
  } catch (err) {
    console.warn(
      `[Verification] Could not record the report for thread ${threadId}: ${(err as Error).message}`
    );
  }
}

/** The latest verification for a thread, or null when it has never had one. */
export function loadThreadVerificationReport(
  threadId: string
): VerificationPipelineReport | null {
  if (!threadId) return null;
  try {
    const row = dbService
      .getDb()
      .prepare('SELECT verification_report_json FROM threads WHERE id = ?')
      .get(threadId) as { verification_report_json?: string | null } | undefined;
    if (!row?.verification_report_json) return null;
    const parsed = JSON.parse(row.verification_report_json);
    return parsed && typeof parsed === 'object' ? (parsed as VerificationPipelineReport) : null;
  } catch (err) {
    console.warn(
      `[Verification] Could not read the report for thread ${threadId}: ${(err as Error).message}`
    );
    return null;
  }
}
