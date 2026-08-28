/**
import 'dotenv/config';
 * scripts/run-competitor-sweep.ts
 *
 * Runs ONE competitor-radar sweep end-to-end:
 *   1. Sweep all public competitor targets (Promise.allSettled).
 *   2. Pull Arvin's internal catalog from BOTH nodes (Promise.allSettled),
 *      map into ArvinCatalogEntry[], and correlate against the sweep.
 *   3. PERSIST the sweep JSON (with correlation records) to disk BEFORE
 *      printing any summary.
 *   4. Print a human-readable summary, including the TIER_2 correlation count.
 *
 * Read-only, public data only for the scrape; read-only Dutchie access for the
 * catalog. No outbound sends / financial / marketing actions. Fails gracefully
 * via the alert system. Partial catalog data is better than none: if one node's
 * catalog pull fails, we log TIER_2 and proceed with whatever is available.
 */

import {
  runSweep,
  correlateSweep,
  type ArvinCatalogEntry,
  type CorrelationRecord,
  type SweepResult,
} from '../modules/competitor-radar/scraper';
import { persistSweep } from '../modules/competitor-radar/persistence';
import {
  AlertTier,
  Tier3HaltError,
  getAlertLog,
  triggerAlert,
} from '../lib/alerts';
import {
  ALL_STORE_NODES,
  DutchieReadOnlyClient,
  STORE_NODE_INFO,
  StoreNode,
  type DutchieProduct,
} from '../lib/dutchie/client';

/** Persisted snapshot shape: the sweep plus the correlation records. */
interface CorrelatedSweep extends SweepResult {
  readonly correlations: CorrelationRecord[];
}

/**
 * Map a Dutchie product into an ArvinCatalogEntry.
 *   matchKey   = product name
 *   arvinPrice = recPrice ?? price (Number)
 *   unitCost   = unitCost (Number, default 0 if missing)
 */
function toCatalogEntry(product: DutchieProduct): ArvinCatalogEntry {
  const arvinPrice = Number(product.recPrice ?? product.price ?? 0);
  const unitCost = Number(product.unitCost ?? 0);
  return {
    matchKey: product.name,
    arvinPrice,
    unitCost,
  };
}

/**
 * Pull the internal catalog from BOTH nodes using Promise.allSettled and merge
 * into a single ArvinCatalogEntry[]. A failed node pull is logged TIER_2 and
 * skipped — we proceed with whatever catalog data is available (partial is
 * better than none).
 */
async function loadCombinedCatalog(
  client: DutchieReadOnlyClient,
): Promise<ArvinCatalogEntry[]> {
  const settled = await Promise.allSettled(
    ALL_STORE_NODES.map((node) => client.getProducts(node)),
  );

  const catalog: ArvinCatalogEntry[] = [];
  settled.forEach((outcome, index) => {
    const node = ALL_STORE_NODES[index] ?? StoreNode.NODE_5TH_AVE;
    const displayName = STORE_NODE_INFO[node].displayName;
    if (outcome.status === 'fulfilled') {
      const entries = outcome.value.map(toCatalogEntry);
      catalog.push(...entries);
      console.info(
        `[competitor-sweep] Catalog pull OK for ${displayName}: ${entries.length} products.`,
      );
    } else {
      // Partial is better than none: log TIER_2 and continue.
      triggerAlert(
        AlertTier.TIER_2,
        `Catalog pull failed for ${displayName}; proceeding with partial catalog.`,
        { source: 'competitor-sweep.catalog', meta: { node }, cause: outcome.reason },
      );
    }
  });

  return catalog;
}

async function main(): Promise<void> {
  console.info('[competitor-sweep] Starting one-off competitor sweep...');

  const result = await runSweep();

  // Pull internal catalog from both nodes (read-only), then correlate.
  // If the Dutchie client itself cannot be created (e.g. missing credentials),
  // a Tier3HaltError propagates and is handled by the outer catch.
  let catalog: ArvinCatalogEntry[] = [];
  try {
    const client = await DutchieReadOnlyClient.create();
    catalog = await loadCombinedCatalog(client);
  } catch (err) {
    if (err instanceof Tier3HaltError) {
      throw err; // Missing credentials, etc. — surface and halt.
    }
    // Any other failure building the client: log TIER_2, proceed with no catalog.
    triggerAlert(
      AlertTier.TIER_2,
      'Could not initialize Dutchie client for catalog pull; correlating against empty catalog.',
      { source: 'competitor-sweep.catalog', cause: err },
    );
  }

  const correlations = correlateSweep(result, catalog);

  // Persist FIRST — before any summary output (hard rule). The persisted
  // snapshot includes the correlation records under "correlations".
  const correlatedSnapshot: CorrelatedSweep = { ...result, correlations };
  const persistedPath = await persistSweep(correlatedSnapshot);
  console.info(`[competitor-sweep] Persisted results -> ${persistedPath}`);

  // Count TIER_2 correlation recommendations for the summary block.
  const tier2Correlations = correlations.filter(
    (c) => c.classification.alertTier === AlertTier.TIER_2,
  );

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

  console.info(
    `\n[competitor-sweep] Correlation: ${correlations.length} matched product(s) vs. Arvin catalog ` +
      `(${catalog.length} catalog entries).`,
  );
  console.info(
    `[competitor-sweep] TIER_2 correlation alerts: ${tier2Correlations.length}` +
      (tier2Correlations.length > 0 ? ' (PRICE_MATCH candidates — human review).' : '.'),
  );
  for (const c of tier2Correlations) {
    console.info(
      `  [TIER_2] ${c.competitorProduct} @ ${c.competitorPrice} ` +
        `(Arvin ${c.arvinPrice}) -> ${c.classification.recommendation} ` +
        `[${c.dispensarySlug}]`,
    );
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
