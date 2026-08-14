/**
 * Competitor radar — scheduler.
 *
 * Runs the competitor sweep on a schedule (node-cron). Each run:
 *   1. Executes a full sweep (Promise.allSettled across targets).
 *   2. PERSISTS the sweep JSON to disk BEFORE any summary is produced.
 *   3. Prints a short summary to the console.
 *
 * HARD RULES:
 *   - No outbound sends / notifications / financial or marketing side effects.
 *     The scheduler only reads public data, writes JSON locally, and logs.
 *   - A TIER_3 halt during a run is surfaced and stops THAT run only; the cron
 *     schedule itself keeps the process alive for human review.
 */

import cron, { type ScheduledTask } from 'node-cron';
import { AlertTier, Tier3HaltError, triggerAlert } from '../../lib/alerts';
import { runSweep, type SweepResult } from './scraper';
import { persistSweep } from './persistence';

/** Default cron expression: every 6 hours. Overridable via env. */
export function resolveCronExpression(): string {
  const fromEnv = process.env['COMPETITOR_SWEEP_CRON'];
  return fromEnv && fromEnv.trim().length > 0 ? fromEnv.trim() : '0 */6 * * *';
}

export interface SweepRunOutcome {
  readonly result: SweepResult;
  readonly persistedPath: string;
}

/**
 * Execute a single scheduled sweep: run -> persist -> summarize.
 * Persistence always happens before the summary is returned/printed.
 */
export async function runScheduledSweep(): Promise<SweepRunOutcome> {
  const result = await runSweep();

  // Persist FIRST — before any summary output.
  const persistedPath = await persistSweep(result);

  // Summary only after persistence succeeded.
  console.info(
    `[competitor-radar] sweep ${result.sweepId} complete: ` +
      `${result.successCount}/${result.targetCount} targets ok, ` +
      `persisted -> ${persistedPath}`,
  );

  return { result, persistedPath };
}

/**
 * Start the recurring schedule. Returns the ScheduledTask so callers can stop
 * it. Each tick is guarded: a TIER_3 halt is surfaced for human review and the
 * schedule continues to run (it does not auto-remediate).
 */
export function startScheduler(
  cronExpression: string = resolveCronExpression(),
): ScheduledTask {
  console.info(
    `[competitor-radar] scheduler starting with cron "${cronExpression}"`,
  );

  const task = cron.schedule(cronExpression, () => {
    void runScheduledSweep().catch((err: unknown) => {
      if (err instanceof Tier3HaltError) {
        // Already surfaced by the alert system; this run halted. Human review.
        return;
      }
      triggerAlert(AlertTier.TIER_2, 'Scheduled sweep run failed.', {
        source: 'competitor.radar.scheduler',
        cause: err,
      });
    });
  });

  return task;
}

// Allow running the scheduler directly: `ts-node modules/competitor-radar/scheduler.ts`
if (require.main === module) {
  const task = startScheduler();
  task.start();
  console.info('[competitor-radar] scheduler is running. Press Ctrl+C to exit.');
}
