/**
 * Forward Intelligence — Weekly Dossier Synthesizer.
 *
 * Combines the outputs of the margin scanner, the demand forecaster (per node),
 * and the vendor scorecards into a single human-review dossier. Read-only,
 * pure computation. No auto-actions, no outbound sends.
 */

import type { MarginScanResult } from '../margin-scanner/scanner';
import type { DemandForecastResult, ReorderAlert } from './demand-forecaster';
import type { VendorScorecard } from './vendor-scorecard';

/** Inventory-health rollup, sourced from the margin scanner. */
export interface InventoryHealthSection {
  readonly skusAnalyzed: number;
  readonly skusSkippedNoCost: number;
  readonly marginWarningCount: number;
  readonly marginCriticalCount: number;
  readonly deadStockCount: number;
}

/** Reorder / overstock rollup, sourced from the demand forecaster(s). */
export interface ReorderWatchSection {
  readonly totalReorder: number;
  readonly totalOverstock: number;
  readonly topReorder: ReorderAlert[];
  readonly topOverstock: ReorderAlert[];
}

/** Vendor ranking extremes, sourced from the vendor scorecards. */
export interface VendorRankingsSection {
  readonly totalVendors: number;
  readonly top3: VendorScorecard[];
  readonly bottom3: VendorScorecard[];
}

/** Per-node comparison row. */
export interface NodeComparisonRow {
  readonly nodeId: string;
  readonly totalSKUs: number;
  readonly reorderCount: number;
  readonly overstockCount: number;
}

/** The full assembled weekly dossier. */
export interface WeeklyDossier {
  readonly generatedAt: string;
  readonly inventoryHealth: InventoryHealthSection;
  readonly reorderWatch: ReorderWatchSection;
  readonly vendorRankings: VendorRankingsSection;
  readonly nodeComparison: NodeComparisonRow[];
}

/** How many items to surface in the reorder/overstock highlight lists. */
const HIGHLIGHT_LIMIT = 5;

/**
 * Synthesize a weekly dossier from the three upstream module outputs.
 *
 *   marginScan  — one MarginScanResult (combined across nodes).
 *   forecasts   — one DemandForecastResult PER node (used for nodeComparison
 *                 and the aggregated reorder watch).
 *   scorecards  — ranked vendor scorecards (already sorted desc by score).
 */
export function synthesizeDossier(
  marginScan: MarginScanResult,
  forecasts: DemandForecastResult[],
  scorecards: VendorScorecard[],
  now: Date = new Date(),
): WeeklyDossier {
  // --- Inventory health (from margin scanner) ---
  const inventoryHealth: InventoryHealthSection = {
    skusAnalyzed: marginScan.skusAnalyzed,
    skusSkippedNoCost: marginScan.skusSkippedNoCost,
    marginWarningCount: marginScan.marginWarnings.length,
    marginCriticalCount: marginScan.marginCritical.length,
    deadStockCount: marginScan.deadStockCandidates.length,
  };

  // --- Reorder watch (aggregate across all node forecasts) ---
  const allReorder = forecasts.flatMap((f) => f.reorderAlerts);
  const allOverstock = forecasts.flatMap((f) => f.overstockAlerts);
  // Reorder: most urgent = lowest days-on-hand first.
  const topReorder = [...allReorder]
    .sort((a, b) => a.daysOnHand - b.daysOnHand)
    .slice(0, HIGHLIGHT_LIMIT);
  // Overstock: worst = highest days-on-hand first.
  const topOverstock = [...allOverstock]
    .sort((a, b) => b.daysOnHand - a.daysOnHand)
    .slice(0, HIGHLIGHT_LIMIT);

  const reorderWatch: ReorderWatchSection = {
    totalReorder: allReorder.length,
    totalOverstock: allOverstock.length,
    topReorder,
    topOverstock,
  };

  // --- Vendor rankings (top 3 / bottom 3) ---
  const top3 = scorecards.slice(0, 3);
  // Bottom 3 = last three by score, presented worst-first.
  const bottom3 =
    scorecards.length <= 3
      ? []
      : [...scorecards].slice(-3).reverse();

  const vendorRankings: VendorRankingsSection = {
    totalVendors: scorecards.length,
    top3,
    bottom3,
  };

  // --- Node comparison ---
  const nodeComparison: NodeComparisonRow[] = forecasts.map((f) => ({
    nodeId: f.nodeId,
    totalSKUs: f.totalSKUs,
    reorderCount: f.reorderAlerts.length,
    overstockCount: f.overstockAlerts.length,
  }));

  return {
    generatedAt: now.toISOString(),
    inventoryHealth,
    reorderWatch,
    vendorRankings,
    nodeComparison,
  };
}
