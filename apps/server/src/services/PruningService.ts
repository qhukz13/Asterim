import { dbService } from './DatabaseService';

/** 7-day retention window in milliseconds */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum events stored per project before a targeted trim runs */
const MAX_EVENTS_PER_PROJECT = 50_000;

/** How many events to remove when a project hits the cap */
const TRIM_TO_PER_PROJECT = 25_000;

/** How often the periodic pruning job runs (1 hour) */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export class PruningService {
  private intervalHandle: NodeJS.Timeout | null = null;

  /**
   * Runs an immediate startup prune, then schedules hourly pruning.
   */
  public start(): void {
    this.prune();
    this.intervalHandle = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
    // Allow the process to exit even if this interval is still active
    this.intervalHandle.unref();
    console.log('[PruningService] Scheduled — runs every 1 hour');
  }

  public stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Main pruning routine:
   * 1. Delete events older than RETENTION_MS globally.
   * 2. For each project exceeding MAX_EVENTS_PER_PROJECT, trim the oldest
   *    down to TRIM_TO_PER_PROJECT.
   */
  public prune(): void {
    const db = dbService.getDb();
    const cutoff = Date.now() - RETENTION_MS;

    try {
      // ── Step 1: Time-based prune (all projects) ──────────────────────────
      const timeResult = db.prepare('DELETE FROM events WHERE timestamp < ?').run(cutoff) as {
        changes: number;
      };

      if (timeResult.changes > 0) {
        console.log(
          `[PruningService] Time prune: removed ${timeResult.changes} events older than 7 days`
        );
      }

      // ── Step 2: Per-project cap prune ────────────────────────────────────
      const projects = db.prepare('SELECT id FROM projects').all() as { id: string }[];

      for (const { id: projectId } of projects) {
        const countRow = db
          .prepare('SELECT COUNT(*) as count FROM events WHERE project_id = ?')
          .get(projectId) as { count: number };

        if (countRow.count > MAX_EVENTS_PER_PROJECT) {
          const excess = countRow.count - TRIM_TO_PER_PROJECT;
          // Delete the OLDEST `excess` events for this project
          const capResult = db
            .prepare(
              `
            DELETE FROM events
            WHERE id IN (
              SELECT id FROM events
              WHERE project_id = ?
              ORDER BY timestamp ASC
              LIMIT ?
            )
          `
            )
            .run(projectId, excess) as { changes: number };

          console.log(
            `[PruningService] Cap prune project ${projectId}: removed ${capResult.changes} events ` +
              `(was ${countRow.count}, now ~${TRIM_TO_PER_PROJECT})`
          );
        }
      }
    } catch (err) {
      console.error('[PruningService] Prune failed:', err);
    }
  }
}

export const pruningService = new PruningService();
