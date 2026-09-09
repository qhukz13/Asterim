import { computeUsageSummary, formatUsageSummary } from '../services/UsageSummary';
import type { ParsedArgs } from './args';
import type { CliIo } from './context';
import { describeTarget, resolveCommandChannel } from './context';
import { openDatabaseForReading } from './sqlite';

/**
 * `asterim stats` — the local usage summary, printed (task P0-11).
 *
 * WHAT: opens the channel's database read-only, computes the summary and
 * prints it. No server is started, no port is opened, nothing is written and
 * nothing is sent.
 *
 * WHY here rather than only in the dashboard: the person most likely to want
 * these numbers during the soft launch is the one already in a terminal because
 * something did not work, and asking them to pair a browser first to answer
 * "how much have you actually used it" is the wrong order.
 *
 * CONTRACT: exit 0 on success, including for a database that does not exist yet
 * — "you have not used it" is an answer, not an error.
 */
export function commandStats(args: ParsedArgs, io: CliIo): number {
  const target = describeTarget(resolveCommandChannel(args));

  if (!target.exists) {
    io.out('Asterim usage — nothing recorded yet');
    io.out('');
    io.out(`No database at ${target.dbPath}.`);
    io.out('Start Asterim, pair a browser and give an agent a task; the numbers appear here.');
    return 0;
  }

  const db = openDatabaseForReading(target.dbPath);
  try {
    io.out(formatUsageSummary(computeUsageSummary(db)));
    return 0;
  } finally {
    try {
      db.close();
    } catch {
      /* Closing a read-only handle cannot fail in a way that changes the answer. */
    }
  }
}
