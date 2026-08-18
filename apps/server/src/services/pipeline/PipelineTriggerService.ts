/**
 * Event-driven pipeline triggers (P9-02).
 *
 * A pipeline definition already declares what starts it — `MANUAL`,
 * `GIT_COMMIT`, `FILE_CHANGE` or `SCHEDULE` — and until now only the first of
 * those was implemented, because only a REST call ever started a run. This is
 * the other three: one subscriber per event kind, one timer, and a matching rule
 * that decides which definitions a given commit or file change belongs to.
 *
 * Four things about it are deliberate.
 *
 * **It is off until it is started.** `start()` is called once by `server.ts`,
 * and nothing subscribes at import time. A service that hooked itself onto the
 * bus as a side effect of being imported would fire during every test that
 * happens to touch the pipeline module.
 *
 * **A burst is one run, not a hundred.** A single editor save produces several
 * `file.changed` events and a `pnpm install` produces thousands; each one
 * starting a run would mean one run and a long line of `ALREADY_RUNNING`
 * refusals. File changes are collected for `PIPELINE_FILE_CHANGE_DEBOUNCE_MS`
 * and start one run carrying the paths that accumulated.
 *
 * **A pipeline already running is not started again.** `runPipeline` refuses a
 * second concurrent run of the same pipeline, and that refusal is the correct
 * outcome here rather than an error worth logging loudly: the commit that
 * arrived while the previous run was going will be in the working tree the next
 * run reads anyway.
 *
 * **Nothing it starts can take the Core down.** Every listener is a subscriber
 * on a Node EventEmitter, so an unhandled rejection inside one would be an
 * unhandled rejection in the process; every run is started detached with its
 * failure caught and logged.
 */

import crypto from 'crypto';
import {
  AsterimEvent,
  MIN_PIPELINE_SCHEDULE_MS,
  PIPELINE_FILE_CHANGE_DEBOUNCE_MS,
  PIPELINE_FILE_CHANGE_EVENT,
  PIPELINE_GIT_COMMIT_EVENT,
  PIPELINE_TRIGGERED_EVENT,
  Pipeline,
  PipelineTriggerEvent,
  PipelineTriggerType
} from '@asterim/shared';
import { EventBus, eventBus } from '../EventBus';
import { PipelineEngine, PipelineError, pipelineEngine } from './PipelineEngine';

/**
 * The bus events a `FILE_CHANGE` listener treats as a file change.
 *
 * `file.changed` is what `WorkspaceMonitor` has published since long before
 * pipelines existed; `workspace:file_change` is the name the pipeline contract
 * uses. Both are accepted rather than one being renamed, because renaming the
 * monitor's event would change what every existing subscriber sees.
 */
const FILE_CHANGE_EVENTS: readonly string[] = [PIPELINE_FILE_CHANGE_EVENT, 'file.changed'];

/** The bus events a `GIT_COMMIT` listener treats as a commit. */
const GIT_COMMIT_EVENTS: readonly string[] = [PIPELINE_GIT_COMMIT_EVENT, 'git.commit'];

/** How many changed paths one triggered run is told about. */
const MAX_TRIGGER_FILES = 50;

/** How often the schedule timer looks for pipelines that are due. */
export const PIPELINE_SCHEDULE_TICK_MS = 30000;

/**
 * How often a `SCHEDULE` pipeline runs, from its parameters.
 *
 * `intervalMs:` for a plain number, or `schedule:`/`every:` for the durations a
 * person actually writes — `30m`, `2h`, `90s`. Not cron syntax: a five-field
 * expression needs a parser and a timezone policy, and every schedule a local
 * pipeline has wanted so far is "every so often".
 */
export function parseScheduleInterval(
  parameters: Record<string, string> | undefined
): number | null {
  const raw = (
    parameters?.intervalMs ??
    parameters?.schedule ??
    parameters?.every ??
    ''
  ).toString().trim();
  if (!raw) return null;

  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i.exec(raw);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = (match[2] ?? 'ms').toLowerCase();
  const scale =
    unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : unit === 'm' ? 60000 : unit === 's' ? 1000 : 1;
  // Below the floor is run at the floor rather than refused: a definition asking
  // for a run every second is asking for a workstation with no cycles left, and
  // failing the whole pipeline over it would be worse than slowing it down.
  return Math.max(MIN_PIPELINE_SCHEDULE_MS, Math.round(amount * scale));
}

export class PipelineTriggerService {
  private started = false;
  private readonly subscriptions: Array<{
    type: string;
    handler: (event: AsterimEvent) => void;
  }> = [];
  private scheduleTimer: NodeJS.Timeout | null = null;
  /** Project id → the pending file-change burst for it. */
  private readonly pending = new Map<string, { timer: NodeJS.Timeout; files: Set<string> }>();
  /** Pipeline id → when its schedule last fired. */
  private readonly lastScheduled = new Map<string, number>();

  /** How long a burst of file changes is collected before it starts a run. */
  private readonly debounceMs: number;
  /** How often the schedule timer looks for pipelines that are due. */
  private readonly tickMs: number;

  constructor(
    private readonly engine: PipelineEngine = pipelineEngine,
    private readonly bus: EventBus = eventBus,
    // Both are constructor arguments so a test can run the same code without
    // waiting out the production quiet period; nothing else overrides them.
    options: { fileChangeDebounceMs?: number; scheduleTickMs?: number } = {}
  ) {
    this.debounceMs = Math.max(0, options.fileChangeDebounceMs ?? PIPELINE_FILE_CHANGE_DEBOUNCE_MS);
    this.tickMs = Math.max(1000, options.scheduleTickMs ?? PIPELINE_SCHEDULE_TICK_MS);
  }

  /** Subscribes the listeners and starts the schedule timer. Idempotent. */
  public start(): void {
    if (this.started) return;
    this.started = true;

    for (const type of GIT_COMMIT_EVENTS) {
      this.subscribe(type, event => this.onGitCommit(event));
    }
    for (const type of FILE_CHANGE_EVENTS) {
      this.subscribe(type, event => this.onFileChange(event));
    }

    this.scheduleTimer = setInterval(() => {
      void this.onScheduleTick().catch(err =>
        console.warn('[PipelineTrigger] Schedule tick failed:', (err as Error).message)
      );
    }, this.tickMs);
    // A timer nothing is waiting on must not be the reason the process stays up.
    this.scheduleTimer.unref?.();

    console.log('[PipelineTrigger] Listening for GIT_COMMIT, FILE_CHANGE and SCHEDULE triggers.');
  }

  /** Unsubscribes everything and cancels what is pending. Idempotent. */
  public stop(): void {
    if (!this.started) return;
    this.started = false;

    for (const entry of this.subscriptions) this.bus.unsubscribe(entry.type, entry.handler);
    this.subscriptions.length = 0;

    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = null;

    for (const burst of this.pending.values()) clearTimeout(burst.timer);
    this.pending.clear();
    this.lastScheduled.clear();
  }

  // --- Listeners ------------------------------------------------------------

  /** A commit landed: every `GIT_COMMIT` pipeline of that project runs. */
  public onGitCommit(event: AsterimEvent): void {
    const payload = payloadOf(event);
    const projectId = text(payload.projectId);
    if (!projectId) return;

    for (const pipeline of this.match('GIT_COMMIT', projectId)) {
      this.fire(pipeline, {
        trigger: 'GIT_COMMIT',
        pipelineId: pipeline.id,
        projectId,
        commitSha: text(payload.commitSha ?? payload.commit ?? payload.sha) || undefined,
        triggeredAt: Date.now()
      });
    }
  }

  /**
   * A file changed: collected, then one run per project once the burst stops.
   *
   * The burst is per project rather than per pipeline because it is the
   * *editing* that comes in bursts; two pipelines watching the same project
   * both want the same quiet period, and both are started from the same one.
   */
  public onFileChange(event: AsterimEvent): void {
    const payload = payloadOf(event);
    const projectId = text(payload.projectId);
    if (!projectId) return;
    if (this.match('FILE_CHANGE', projectId).length === 0) return;

    const filePath = text(payload.filePath ?? payload.path ?? payload.file);
    const burst = this.pending.get(projectId);
    if (burst) {
      if (filePath) burst.files.add(filePath);
      // Restart the quiet period: the burst is not over while events keep
      // arriving, and a run started mid-save reads a half-written file.
      clearTimeout(burst.timer);
      burst.timer = setTimeout(() => this.flushFileChanges(projectId), this.debounceMs);
      burst.timer.unref?.();
      return;
    }

    const timer = setTimeout(() => this.flushFileChanges(projectId), this.debounceMs);
    timer.unref?.();
    this.pending.set(projectId, { timer, files: new Set(filePath ? [filePath] : []) });
  }

  /** Starts the runs a finished burst of file changes calls for. */
  private flushFileChanges(projectId: string): void {
    const burst = this.pending.get(projectId);
    this.pending.delete(projectId);
    if (!burst) return;
    clearTimeout(burst.timer);

    const changedFiles = [...burst.files].slice(0, MAX_TRIGGER_FILES);
    for (const pipeline of this.match('FILE_CHANGE', projectId)) {
      this.fire(pipeline, {
        trigger: 'FILE_CHANGE',
        pipelineId: pipeline.id,
        projectId,
        changedFiles,
        triggeredAt: Date.now()
      });
    }
  }

  /**
   * The schedule timer: starts every `SCHEDULE` pipeline that is due.
   *
   * Due is measured from the last time this process fired it, not from the last
   * run in storage: a restart should not replay a day of missed schedules, and
   * the first tick after one deliberately starts nothing.
   */
  public async onScheduleTick(now = Date.now()): Promise<number> {
    let started = 0;
    for (const pipeline of this.enabled('SCHEDULE')) {
      const interval = parseScheduleInterval(pipeline.definition.parameters);
      if (!interval) continue;

      const last = this.lastScheduled.get(pipeline.id);
      if (last === undefined) {
        // First sighting: the clock starts now rather than at the epoch.
        this.lastScheduled.set(pipeline.id, now);
        continue;
      }
      if (now - last < interval) continue;

      const projectId = this.projectOf(pipeline);
      if (!projectId) continue;

      this.lastScheduled.set(pipeline.id, now);
      this.fire(pipeline, {
        trigger: 'SCHEDULE',
        pipelineId: pipeline.id,
        projectId,
        triggeredAt: now
      });
      started++;
    }
    return started;
  }

  // --- Matching and dispatch ------------------------------------------------

  /** Every stored pipeline that declares this trigger. */
  private enabled(trigger: PipelineTriggerType): Pipeline[] {
    try {
      return this.engine.listPipelines().filter(entry => entry.definition.trigger === trigger);
    } catch (err) {
      console.warn(`[PipelineTrigger] Could not read pipelines: ${(err as Error).message}`);
      return [];
    }
  }

  /** Every pipeline that declares this trigger *and* names this project. */
  private match(trigger: PipelineTriggerType, projectId: string): Pipeline[] {
    return this.enabled(trigger).filter(entry => this.projectOf(entry) === projectId);
  }

  /** Which project a definition runs against, when it names one. */
  private projectOf(pipeline: Pipeline): string {
    return pipeline.definition.projectId?.trim() ?? '';
  }

  /**
   * Starts one run, detached, and says on the bus that it did.
   *
   * The event is published before the run rather than after it: the run holds
   * until every step has settled, and a dashboard that only learned about
   * automation once it was over could not show that anything was happening.
   */
  private fire(pipeline: Pipeline, trigger: PipelineTriggerEvent): void {
    this.bus.publish({
      id: crypto.randomUUID(),
      timestamp: trigger.triggeredAt,
      source: 'server:pipeline',
      type: PIPELINE_TRIGGERED_EVENT,
      payload: { ...trigger, threadId: undefined, name: pipeline.name }
    });

    void this.engine
      .runPipeline(pipeline.id, {
        projectId: trigger.projectId,
        triggeredBy: trigger.trigger,
        ...(trigger.commitSha ? { commitSha: trigger.commitSha } : {}),
        ...(trigger.changedFiles?.length ? { changedFiles: trigger.changedFiles.join(', ') } : {})
      })
      .catch(err => {
        // A pipeline already running is the expected answer for a second commit
        // arriving mid-run, not a fault worth a stack trace.
        if (err instanceof PipelineError && err.code === 'ALREADY_RUNNING') {
          console.log(
            `[PipelineTrigger] ${pipeline.name} is already running; the ${trigger.trigger} trigger was not started again.`
          );
          return;
        }
        console.warn(
          `[PipelineTrigger] ${pipeline.name} could not be started by ${trigger.trigger}: ${(err as Error).message}`
        );
      });
  }

  private subscribe(type: string, handler: (event: AsterimEvent) => void): void {
    const wrapped = (event: AsterimEvent): void => {
      try {
        handler(event);
      } catch (err) {
        // A throw here would be a throw inside an EventEmitter's dispatch, which
        // takes the Core down with it.
        console.warn(`[PipelineTrigger] ${type} listener failed: ${(err as Error).message}`);
      }
    };
    this.bus.subscribe(type, wrapped);
    this.subscriptions.push({ type, handler: wrapped });
  }
}

export const pipelineTriggerService = new PipelineTriggerService();

// --- Payload reading ---------------------------------------------------------

function payloadOf(event: AsterimEvent): Record<string, unknown> {
  const payload = (event as { payload?: unknown } | undefined)?.payload;
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
