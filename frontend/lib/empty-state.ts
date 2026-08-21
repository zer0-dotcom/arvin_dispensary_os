/**
 * Semantic emptiness detection.
 *
 * A successfully-parsed artifact can still be semantically empty — e.g. the
 * current verified dossier has skusAnalyzed:0 / totalVendors:0 because the live
 * catalog pull 403'd during that run. In that case the UI shows an explicit
 * "upstream unavailable" empty state (never fabricated numbers) while STILL
 * showing the DataStamp so the operator can see the run happened.
 */

import type { WeeklyDossier, MarginScanResult, SweepResult } from './types';

export const EMPTY_REASON =
  'Upstream catalog unavailable during this run — no records returned.';

export function isDossierEmpty(d: WeeklyDossier): boolean {
  return (
    d.inventoryHealth.skusAnalyzed === 0 &&
    d.reorderWatch.totalReorder === 0 &&
    d.reorderWatch.totalOverstock === 0 &&
    d.vendorRankings.totalVendors === 0 &&
    d.nodeComparison.length === 0
  );
}

export function isMarginScanEmpty(m: MarginScanResult): boolean {
  return (
    m.skusAnalyzed === 0 &&
    m.marginWarnings.length === 0 &&
    m.marginCritical.length === 0 &&
    m.deadStockCandidates.length === 0
  );
}

export function isSweepEmpty(s: SweepResult): boolean {
  const anyProducts = s.snapshots.some((snap) => snap.products.length > 0);
  return s.targetCount === 0 || (!anyProducts && s.successCount === 0);
}
