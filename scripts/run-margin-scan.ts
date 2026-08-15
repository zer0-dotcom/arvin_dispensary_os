/**
 * scripts/run-margin-scan.ts
 *
 * Runs ONE margin & dead-stock scan end-to-end:
 *   1. Pull inventory from BOTH nodes (Promise.allSettled). A failed node pull
 *      is logged TIER_2 and skipped — partial is better than none.
 *   2. Analyze margins + dead stock (COGS guard, thresholds).
 *   3. PERSIST the scan JSON to disk BEFORE printing any summary.
 *   4. Print a human-readable summary: counts per category + TIER_2 items
 *      for human review.
 *
 * Read-only. No price changes, no auto-actions, no outbound sends / marketing.
 * Fails gracefully via the alert system.
 */

import {
  analyzeInventory,
  type MarginScanResult,
  type NodeInventoryItem,
} from '../modules/margin-scanner/scanner';
import { persistScan } from '../modules/margin-scanner/persistence';
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
} from '../lib/dutchie/client';

/**
 * Pull inventory from BOTH nodes using Promise.allSettled, tagging each product
 * with its node. A failed node pull is logged TIER_2 and skipped.
 */
async function loadCombinedInventory(
  client: DutchieReadOnlyClient,
): Promise<NodeInventoryItem[]> {
  const settled = await Promise.allSettled(
    ALL_STORE_NODES.map((node) => client.getProducts(node)),
  );

  const inventory: NodeInventoryItem[] = [];
  settled.forEach((outcome, index) => {
    const node = ALL_STORE_NODES[index] ?? StoreNode.NODE_5TH_AVE;
    const displayName = STORE_NODE_INFO[node].displayName;
    if (outcome.status === 'fulfilled') {
      for (const product of outcome.value) {
        inventory.push({ node, product });
      }
      console.info(
        `[margin-scan] Inventory pull OK for ${displayName}: ${outcome.value.length} products.`,
      );
    } else {
      triggerAlert(
        AlertTier.TIER_2,
        `Inventory pull failed for ${displayName}; proceeding with partial inventory.`,
        { source: 'margin-scan.inventory', meta: { node }, cause: outcome.reason },
      );
    }
  });

  return inventory;
}

/** Group flags by category and print counts. */
function printCategoryCounts(
  label: string,
  items: readonly { category?: string }[],
): void {
  if (items.length === 0) {
    console.info(`  ${label}: 0`);
    return;
  }
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.category ?? '(uncategorized)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  console.info(`  ${label}: ${items.length}`);
  for (const [category, count] of [...counts.entries()].sort()) {
    console.info(`      - ${category}: ${count}`);
  }
}

function printScanSummary(result: MarginScanResult): void {
  console.info(
    `\n[margin-scan] Scan ${result.scanId}: ` +
      `${result.skusAnalyzed} SKU(s) analyzed, ` +
      `${result.skusSkippedNoCost} skipped (no unit cost).`,
  );

  console.info('\n[margin-scan] Counts by category:');
  printCategoryCounts('MARGIN_WARNING (TIER_1)', result.marginWarnings);
  printCategoryCounts('MARGIN_CRITICAL (TIER_2)', result.marginCritical);
  printCategoryCounts('DEAD_STOCK_CANDIDATE (TIER_2)', result.deadStockCandidates);

  // TIER_2 items for human review: margin critical + dead stock.
  const tier2Total =
    result.marginCritical.length + result.deadStockCandidates.length;
  console.info(
    `\n[margin-scan] TIER_2 items for human review: ${tier2Total}`,
  );
  for (const f of result.marginCritical) {
    console.info(
      `  [MARGIN_CRITICAL] ${f.productName} — ${f.grossMarginPct.toFixed(1)}% ` +
        `(rec ${f.recPrice}, cost ${f.unitCost}) [${f.node}]`,
    );
  }
  for (const f of result.deadStockCandidates) {
    const staleness =
      f.daysSinceLastModified === null
        ? 'never modified'
        : `${f.daysSinceLastModified.toFixed(0)}d since modified`;
    console.info(
      `  [DEAD_STOCK_CANDIDATE] ${f.productName} — qty ${f.quantityAvailable}, ` +
        `${staleness} [${f.node}]`,
    );
  }
}

async function main(): Promise<void> {
  console.info('[margin-scan] Starting one-off margin & dead-stock scan...');

  // Client creation can throw Tier3HaltError (missing credentials) — handled
  // by the outer catch.
  const client = await DutchieReadOnlyClient.create();
  const inventory = await loadCombinedInventory(client);

  const result = analyzeInventory(inventory);

  // Persist FIRST — before any summary output (hard rule).
  const persistedPath = await persistScan(result);
  console.info(`[margin-scan] Persisted results -> ${persistedPath}`);

  // Summary only after persistence.
  printScanSummary(result);

  const alerts = getAlertLog();
  if (alerts.length > 0) {
    console.info(`\n[margin-scan] ${alerts.length} alert(s) raised during run.`);
  }

  const tier2Total =
    result.marginCritical.length + result.deadStockCandidates.length;
  process.exitCode = tier2Total === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  if (err instanceof Tier3HaltError) {
    console.error('[margin-scan] TIER_3 halt — human review required.');
    process.exitCode = 2;
    return;
  }
  console.error(
    `[margin-scan] Unexpected fatal error: ${
      err instanceof Error ? err.stack ?? err.message : String(err)
    }`,
  );
  process.exitCode = 1;
});
