/**
import 'dotenv/config';
 * scripts/run-weekly-dossier.ts
 *
 * Assembles the full weekly Forward Intelligence dossier:
 *   1. Pull each node's catalog (Promise.allSettled). Failed pull => TIER_2,
 *      proceed with partial.
 *   2. Run the margin scanner (combined), the demand forecaster (per node),
 *      and the vendor scorecards (combined).
 *   3. Synthesize the dossier.
 *   4. PERSIST the dossier BEFORE printing any summary.
 *   5. Print the dossier summary for human review.
 *
 * Read-only. No auto-actions, no outbound sends. TIER_3 halt on credential
 * failure.
 */

import {
  analyzeInventory,
  type NodeInventoryItem,
} from '../modules/margin-scanner/scanner';
import { runDemandForecast } from '../modules/forward-intelligence/demand-forecaster';
import { buildVendorScorecards } from '../modules/forward-intelligence/vendor-scorecard';
import {
  synthesizeDossier,
  type WeeklyDossier,
} from '../modules/forward-intelligence/dossier-synthesizer';
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

/** Pull each node's catalog independently, tagged by node (partial-tolerant). */
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
        `[weekly-dossier] Catalog pull OK for ${displayName}: ${outcome.value.length} products.`,
      );
    } else {
      triggerAlert(
        AlertTier.TIER_2,
        `Catalog pull failed for ${displayName}; skipping node.`,
        { source: 'weekly-dossier.catalog', meta: { node }, cause: outcome.reason },
      );
    }
  });
  return out;
}

function printDossier(dossier: WeeklyDossier): void {
  const { inventoryHealth: ih, reorderWatch: rw, vendorRankings: vr, nodeComparison } =
    dossier;

  console.info(`\n===== WEEKLY DOSSIER (${dossier.generatedAt}) =====`);

  console.info('\n-- Inventory Health --');
  console.info(
    `  analyzed=${ih.skusAnalyzed}, skippedNoCost=${ih.skusSkippedNoCost}, ` +
      `warnings=${ih.marginWarningCount}, critical=${ih.marginCriticalCount}, ` +
      `deadStock=${ih.deadStockCount}`,
  );

  console.info('\n-- Reorder Watch --');
  console.info(`  REORDER total=${rw.totalReorder}, OVERSTOCK total=${rw.totalOverstock}`);
  for (const a of rw.topReorder) {
    console.info(`    [REORDER] ${a.name} — ${a.daysOnHand.toFixed(0)}d [${a.vendorName}]`);
  }
  for (const a of rw.topOverstock) {
    console.info(`    [OVERSTOCK] ${a.name} — ${a.daysOnHand.toFixed(0)}d [${a.vendorName}]`);
  }

  console.info('\n-- Vendor Rankings --');
  console.info(`  total vendors=${vr.totalVendors}`);
  console.info('  TOP 3:');
  for (const sc of vr.top3) {
    console.info(`    #${sc.rank} ${sc.vendorName} — ${sc.compositeScore.toFixed(1)}`);
  }
  console.info('  BOTTOM 3:');
  for (const sc of vr.bottom3) {
    console.info(`    #${sc.rank} ${sc.vendorName} — ${sc.compositeScore.toFixed(1)}`);
  }

  console.info('\n-- Node Comparison --');
  for (const row of nodeComparison) {
    console.info(
      `  ${row.nodeId}: ${row.totalSKUs} SKU, ${row.reorderCount} reorder, ${row.overstockCount} overstock`,
    );
  }
}

async function main(): Promise<void> {
  console.info('[weekly-dossier] Assembling weekly Forward Intelligence dossier...');

  const client = await DutchieReadOnlyClient.create();
  const perNode = await loadPerNodeCatalog(client);

  // Combined inventory for margin scan + vendor scorecards.
  const combinedInventory: NodeInventoryItem[] = perNode.flatMap(({ node, products }) =>
    products.map((product) => ({ node, product })),
  );
  const combinedCatalog: DutchieProduct[] = perNode.flatMap(({ products }) => products);

  const marginScan = analyzeInventory(combinedInventory);
  const forecasts = perNode.map(({ node, products }) =>
    runDemandForecast(products, node),
  );
  const scorecards = buildVendorScorecards(combinedCatalog);

  const dossier = synthesizeDossier(marginScan, forecasts, scorecards);

  // Persist FIRST — before any summary output (hard rule).
  const persistedPath = await persistForwardIntel('weekly-dossier', dossier);
  console.info(`[weekly-dossier] Persisted results -> ${persistedPath}`);

  printDossier(dossier);

  const alerts = getAlertLog();
  if (alerts.length > 0) {
    console.info(`\n[weekly-dossier] ${alerts.length} alert(s) raised during run.`);
  }

  process.exitCode = 0;
}

main().catch((err: unknown) => {
  if (err instanceof Tier3HaltError) {
    console.error('[weekly-dossier] TIER_3 halt — human review required.');
    process.exitCode = 2;
    return;
  }
  console.error(
    `[weekly-dossier] Unexpected fatal error: ${
      err instanceof Error ? err.stack ?? err.message : String(err)
    }`,
  );
  process.exitCode = 1;
});
