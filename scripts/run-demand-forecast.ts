/**
 * scripts/run-demand-forecast.ts
 *
 * Runs the demand forecaster across BOTH nodes:
 *   1. Pull each node's catalog (Promise.allSettled). A failed pull is logged
 *      TIER_2 and skipped — partial is better than none.
 *   2. Run runDemandForecast() per node.
 *   3. PERSIST results BEFORE printing any summary.
 *   4. Print a per-node summary of reorder / overstock counts.
 *
 * Read-only. No auto-actions, no outbound sends. TIER_3 halt on credential
 * failure (missing Dutchie secrets).
 */

import {
  runDemandForecast,
  type DemandForecastResult,
} from '../modules/forward-intelligence/demand-forecaster';
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

/** Pull each node's catalog independently, tagged by node. */
async function loadPerNodeCatalog(
  client: DutchieReadOnlyClient,
): Promise<Array<{ node: StoreNode; products: DutchieProduct[] }>> {
  const settled = await Promise.allSettled(
    ALL_STORE_NODES.map((node) => client.getProducts(node)),
  );

  const out: Array<{ node: StoreNode; products: DutchieProduct[] }> = [];
  settled.forEach((outcome, index) => {
    const node = ALL_STORE_NODES[index] ?? StoreNode.NODE_5TH_AVE;
    const displayName = STORE_NODE_INFO[node].displayName;
    if (outcome.status === 'fulfilled') {
      out.push({ node, products: outcome.value });
      console.info(
        `[demand-forecast] Catalog pull OK for ${displayName}: ${outcome.value.length} products.`,
      );
    } else {
      triggerAlert(
        AlertTier.TIER_2,
        `Catalog pull failed for ${displayName}; skipping node.`,
        { source: 'demand-forecast.catalog', meta: { node }, cause: outcome.reason },
      );
    }
  });
  return out;
}

async function main(): Promise<void> {
  console.info('[demand-forecast] Starting demand forecast across both nodes...');

  const client = await DutchieReadOnlyClient.create();
  const perNode = await loadPerNodeCatalog(client);

  const forecasts: DemandForecastResult[] = perNode.map(({ node, products }) =>
    runDemandForecast(products, node),
  );

  // Persist FIRST — before any summary output (hard rule).
  const persistedPath = await persistForwardIntel('demand-forecast', forecasts);
  console.info(`[demand-forecast] Persisted results -> ${persistedPath}`);

  // Summary after persistence.
  for (const f of forecasts) {
    console.info(
      `\n[demand-forecast] ${f.nodeId}: ${f.totalSKUs} SKU(s), ` +
        `${f.reorderAlerts.length} REORDER, ${f.overstockAlerts.length} OVERSTOCK.`,
    );
    for (const a of f.reorderAlerts.slice(0, 10)) {
      console.info(
        `  [REORDER] ${a.name} — qty ${a.quantityAvailable}, ${a.daysOnHand.toFixed(0)}d on hand [${a.vendorName}]`,
      );
    }
    for (const a of f.overstockAlerts.slice(0, 10)) {
      console.info(
        `  [OVERSTOCK] ${a.name} — qty ${a.quantityAvailable}, ${a.daysOnHand.toFixed(0)}d on hand [${a.vendorName}]`,
      );
    }
  }

  const alerts = getAlertLog();
  if (alerts.length > 0) {
    console.info(`\n[demand-forecast] ${alerts.length} alert(s) raised during run.`);
  }

  process.exitCode = 0;
}

main().catch((err: unknown) => {
  if (err instanceof Tier3HaltError) {
    console.error('[demand-forecast] TIER_3 halt — human review required.');
    process.exitCode = 2;
    return;
  }
  console.error(
    `[demand-forecast] Unexpected fatal error: ${
      err instanceof Error ? err.stack ?? err.message : String(err)
    }`,
  );
  process.exitCode = 1;
});
