/**
 * Weekly Dossier Synthesizer (self-contained frontend port).
 *
 * Faithful, pure-computation port of
 * modules/forward-intelligence/dossier-synthesizer.ts. Output is
 * byte-compatible with the backend `WeeklyDossier` schema that
 * frontend/lib/data-loader.ts (loadLatestDossier) already reads.
 */

import type { MarginScanResult } from './margin-scanner';
import type { DemandForecastResult, ReorderAlert } from './demand-forecaster';
import type { VendorScorecard } from './vendor-scorecard';

export interface InventoryHealthSection {
  readonly skusAnalyzed: number;
  readonly skusSkippedNoCost: number;
  readonly marginWarningCount: number;
  readonly marginCriticalCount: number;
  readonly deadStockCount: number;
}

export interface ReorderWatchSection {
  readonly totalReorder: number;
  readonly totalOverstock: number;
  readonly topReorder: ReorderAlert[];
  readonly topOverstock: ReorderAlert[];
}

export interface VendorRankingsSection {
  readonly totalVendors: number;
  readonly top3: VendorScorecard[];
  readonly bottom3: VendorScorecard[];
}

export interface NodeComparisonRow {
  readonly nodeId: string;
  readonly totalSKUs: number;
  readonly reorderCount: number;
  readonly overstockCount: number;
}

export interface WeeklyDossier {
  readonly generatedAt: string;
  readonly inventoryHealth: InventoryHealthSection;
  readonly reorderWatch: ReorderWatchSection;
  readonly vendorRankings: VendorRankingsSection;
  readonly nodeComparison: NodeComparisonRow[];
}

const HIGHLIGHT_LIMIT = 5;

export function synthesizeDossier(
  marginScan: MarginScanResult,
  forecasts: DemandForecastResult[],
  scorecards: VendorScorecard[],
  now: Date = new Date(),
): WeeklyDossier {
  const inventoryHealth: InventoryHealthSection = {
    skusAnalyzed: marginScan.skusAnalyzed,
    skusSkippedNoCost: marginScan.skusSkippedNoCost,
    marginWarningCount: marginScan.marginWarnings.length,
    marginCriticalCount: marginScan.marginCritical.length,
    deadStockCount: marginScan.deadStockCandidates.length,
  };

  const allReorder = forecasts.flatMap((f) => f.reorderAlerts);
  const allOverstock = forecasts.flatMap((f) => f.overstockAlerts);
  const topReorder = [...allReorder]
    .sort((a, b) => a.daysOnHand - b.daysOnHand)
    .slice(0, HIGHLIGHT_LIMIT);
  const topOverstock = [...allOverstock]
    .sort((a, b) => b.daysOnHand - a.daysOnHand)
    .slice(0, HIGHLIGHT_LIMIT);

  const reorderWatch: ReorderWatchSection = {
    totalReorder: allReorder.length,
    totalOverstock: allOverstock.length,
    topReorder,
    topOverstock,
  };

  const top3 = scorecards.slice(0, 3);
  const bottom3 =
    scorecards.length <= 3 ? [] : [...scorecards].slice(-3).reverse();

  const vendorRankings: VendorRankingsSection = {
    totalVendors: scorecards.length,
    top3,
    bottom3,
  };

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
