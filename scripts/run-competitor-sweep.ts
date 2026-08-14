/**
 * scripts/run-competitor-sweep.ts
 *
 * Runs ONE competitor-radar sweep end-to-end:
 *   1. Sweep all public competitor targets (Promise.allSettled).
 *   2. PERSIST the sweep JSON to disk BEFORE printing any summary.
 *   3. Print a human-readable summary.
 *
 * Read-only, public data only. No outbound sends / financial / marketing
 * actions. Fails gracefully via the alert system.
 */

import { runSweep } from '../modules/competitor-radar/scraper';
import { persistSweep } from '../modules/competitor-radar/persistence';
import { Tier3HaltError, getAlertLog } from '../lib/alerts';

async function main(): Promise<void> {
  console.info('[competitor-sweep] Starting one-off competitor sweep...');

  const result = await runSweep();

  // Persist FIRST — before any summary output (hard rule).
  const persistedPath = await persistSweep(result);
  console.info(`[competitor-sweep] Persisted results -> ${persistedPath}`);

  // Summary only after persistence.
  console.info(
    `\n[competitor-sweep] Sweep ${result.sweepId}: ` +
      `${result.successCount}/${result.targetCount} targets ok, ` +
      `${result.failureCount} failed.`,
  );
  for (const snap of result.snapshots) {
    const status = snap.ok ? 'OK  ' : 'FAIL';
    const extra = snap.ok
      ? `${snap.products.length} products`
      : snap.note ?? 'unknown error';
    console.info(`  [${status}] ${snap.dispensarySlug} — ${extra}`);
  }

  const alerts = getAlertLog();
  if (alerts.length > 0) {
    console.info(`\n[competitor-sweep] ${alerts.length} alert(s) raised during run.`);
  }

  process.exitCode = result.failureCount === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  if (err instanceof Tier3HaltError) {
    console.error('[competitor-sweep] TIER_3 halt — human review required.');
    process.exitCode = 2;
    return;
  }
  console.error(
    `[competitor-sweep] Unexpected fatal error: ${
      err instanceof Error ? err.stack ?? err.message : String(err)
    }`,
  );
  process.exitCode = 1;
});
