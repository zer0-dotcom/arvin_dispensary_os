/**
 * scripts/run-vendor-scorecard.ts
 *
 * Builds ranked vendor scorecards from the COMBINED dual-node catalog:
 *   1. Pull both nodes' catalogs (Promise.allSettled). Failed pull => TIER_2,
 *      proceed with partial.
 *   2. Combine and run buildVendorScorecards().
 *   3. PERSIST results BEFORE printing any summary.
 *   4. Print the ranked vendor table.
 *
 * Read-only. No auto-actions, no outbound sends. TIER_3 halt on credential
 * failure.
 */

import {
  buildVendorScorecards,
  type VendorScorecard,
} from '../modules/forward-intelligence/vendor-scorecard';
import { persistForwardIntel } from '../modules/forward-intelligence/persistence';
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

/** Pull both nodes' catalogs and merge into one array (partial-tolerant). */
async function loadCombinedCatalog(
  client: DutchieReadOnlyClient,
): Promise<DutchieProduct[]> {
  const settled = await Promise.allSettled(
    ALL_STORE_NODES.map((node) => client.getProducts(node)),
  );

  const catalog: DutchieProduct[] = [];
  settled.forEach((outcome, index) => {
    const node = ALL_STORE_NODES[index] ?? StoreNode.NODE_5TH_AVE;
    const displayName = STORE_NODE_INFO[node].displayName;
    if (outcome.status === 'fulfilled') {
      catalog.push(...outcome.value);
      console.info(
        `[vendor-scorecard] Catalog pull OK for ${displayName}: ${outcome.value.length} products.`,
      );
    } else {
      triggerAlert(
        AlertTier.TIER_2,
        `Catalog pull failed for ${displayName}; proceeding with partial catalog.`,
        { source: 'vendor-scorecard.catalog', meta: { node }, cause: outcome.reason },
      );
    }
  });
  return catalog;
}

function printScorecards(scorecards: VendorScorecard[]): void {
  console.info(`\n[vendor-scorecard] ${scorecards.length} vendor(s) ranked:`);
  for (const sc of scorecards) {
    console.info(
      `  #${sc.rank} ${sc.vendorName} — score ${sc.compositeScore.toFixed(1)} ` +
        `(margin ${sc.avgGrossMarginPct.toFixed(1)}%, ` +
        `${sc.avgDaysOnHand.toFixed(0)}d avg on hand, ` +
        `${sc.skuCount} SKU, ${sc.deadStockCount} dead)`,
    );
  }
}

async function main(): Promise<void> {
  console.info('[vendor-scorecard] Building vendor scorecards from both nodes...');

  const client = await DutchieReadOnlyClient.create();
  const catalog = await loadCombinedCatalog(client);

  const scorecards = buildVendorScorecards(catalog);

  // Persist FIRST — before any summary output (hard rule).
  const persistedPath = await persistForwardIntel('vendor-scorecard', scorecards);
  console.info(`[vendor-scorecard] Persisted results -> ${persistedPath}`);

  printScorecards(scorecards);

  const alerts = getAlertLog();
  if (alerts.length > 0) {
    console.info(`\n[vendor-scorecard] ${alerts.length} alert(s) raised during run.`);
  }

  process.exitCode = 0;
}

main().catch((err: unknown) => {
  if (err instanceof Tier3HaltError) {
    console.error('[vendor-scorecard] TIER_3 halt — human review required.');
    process.exitCode = 2;
    return;
  }
  console.error(
    `[vendor-scorecard] Unexpected fatal error: ${
      err instanceof Error ? err.stack ?? err.message : String(err)
    }`,
  );
  process.exitCode = 1;
});
