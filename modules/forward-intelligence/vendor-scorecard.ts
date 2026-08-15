/**
 * Forward Intelligence — Vendor Scorecard.
 *
 * Ranks vendors/brands by a composite of margin yield and velocity so Arvin can
 * prioritize reorders and negotiate with underperforming suppliers.
 *
 * HARD RULES enforced here:
 *   - Read-only. No price changes, no auto-actions, no outbound sends.
 *   - COGS guard: products with unitCost <= 0 are excluded from margin math.
 *   - Pure computation over already-fetched product data.
 *
 * COMPOSITE SCORE
 * ---------------
 *   compositeScore = 60% margin yield + 40% velocity
 *     - margin yield : avg gross margin % (0-100), normalized to 0-1.
 *     - velocity     : inverted days-on-hand. Fewer days-on-hand == faster ==
 *                      higher score. Normalized against a velocity horizon.
 *
 * KNOWN LIMITATION
 * ----------------
 * days-on-hand uses `lastModifiedDateUTC` (catalog modification) as the only
 * available staleness proxy — the /products endpoint exposes no true sales
 * velocity. See modules/forward-intelligence/demand-forecaster.ts header.
 */

import type { DutchieProduct } from '../../lib/dutchie/client';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Horizon (days) used to normalize velocity. Stock older than this scores ~0. */
export const VELOCITY_HORIZON_DAYS = 60;

/** Days-on-hand threshold above which a SKU counts toward dead stock. */
export const DEAD_STOCK_DAYS = 45;

/** Composite weights. */
export const MARGIN_WEIGHT = 0.6;
export const VELOCITY_WEIGHT = 0.4;

/** Per-vendor aggregated scorecard. */
export interface VendorScorecard {
  readonly vendorId: string;
  readonly vendorName: string;
  readonly skuCount: number;
  readonly avgGrossMarginPct: number;
  readonly avgDaysOnHand: number;
  readonly deadStockCount: number;
  readonly compositeScore: number;
  readonly rank: number;
}

function daysOnHand(
  lastModifiedDateUTC: string | undefined,
  now: Date,
): number | null {
  if (!lastModifiedDateUTC) {
    return null;
  }
  const then = new Date(lastModifiedDateUTC).getTime();
  if (Number.isNaN(then)) {
    return null;
  }
  return (now.getTime() - then) / MS_PER_DAY;
}

interface VendorAccumulator {
  vendorId: string;
  vendorName: string;
  skuCount: number;
  marginSum: number;
  marginCount: number;
  daysSum: number;
  daysCount: number;
  deadStockCount: number;
}

/**
 * Build ranked vendor scorecards from a combined product list.
 * Sorted DESCENDING by compositeScore; rank is 1-based.
 */
export function buildVendorScorecards(
  products: DutchieProduct[],
  now: Date = new Date(),
): VendorScorecard[] {
  const byVendor = new Map<string, VendorAccumulator>();

  for (const product of products) {
    const vendorId = product.vendorId ?? product.vendorName ?? '(unknown)';
    const vendorName = product.vendorName ?? '(unknown vendor)';

    let acc = byVendor.get(vendorId);
    if (!acc) {
      acc = {
        vendorId,
        vendorName,
        skuCount: 0,
        marginSum: 0,
        marginCount: 0,
        daysSum: 0,
        daysCount: 0,
        deadStockCount: 0,
      };
      byVendor.set(vendorId, acc);
    }

    acc.skuCount += 1;

    // Margin yield (COGS guard: only when we have a real cost + price).
    const unitCost = Number(product.unitCost ?? 0);
    const recPrice = Number(product.recPrice ?? product.price ?? 0);
    if (unitCost > 0 && recPrice > 0) {
      acc.marginSum += ((recPrice - unitCost) / recPrice) * 100;
      acc.marginCount += 1;
    }

    // Velocity proxy via days-on-hand. Missing timestamp => treat as horizon.
    const rawDays = daysOnHand(product.lastModifiedDateUTC, now);
    const days = rawDays === null ? VELOCITY_HORIZON_DAYS : rawDays;
    acc.daysSum += days;
    acc.daysCount += 1;
    if (days >= DEAD_STOCK_DAYS) {
      acc.deadStockCount += 1;
    }
  }

  const scorecards: VendorScorecard[] = [];
  for (const acc of byVendor.values()) {
    const avgGrossMarginPct =
      acc.marginCount > 0 ? acc.marginSum / acc.marginCount : 0;
    const avgDaysOnHand = acc.daysCount > 0 ? acc.daysSum / acc.daysCount : 0;

    // Normalize margin (0-100 -> 0-1), clamped.
    const marginScore = Math.max(0, Math.min(1, avgGrossMarginPct / 100));
    // Velocity: invert days-on-hand against horizon. Fewer days => closer to 1.
    const velocityScore = Math.max(
      0,
      Math.min(1, 1 - avgDaysOnHand / VELOCITY_HORIZON_DAYS),
    );

    const compositeScore =
      (MARGIN_WEIGHT * marginScore + VELOCITY_WEIGHT * velocityScore) * 100;

    scorecards.push({
      vendorId: acc.vendorId,
      vendorName: acc.vendorName,
      skuCount: acc.skuCount,
      avgGrossMarginPct,
      avgDaysOnHand,
      deadStockCount: acc.deadStockCount,
      compositeScore,
      rank: 0, // assigned after sort
    });
  }

  // Sort DESCENDING by composite score, then assign 1-based rank.
  scorecards.sort((a, b) => b.compositeScore - a.compositeScore);
  return scorecards.map((sc, index) => ({ ...sc, rank: index + 1 }));
}
