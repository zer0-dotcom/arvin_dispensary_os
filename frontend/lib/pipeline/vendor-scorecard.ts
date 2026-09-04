/**
 * Vendor Scorecard (self-contained frontend port).
 *
 * Faithful, pure-computation port of
 * modules/forward-intelligence/vendor-scorecard.ts. Output shapes are
 * byte-compatible with the backend `VendorScorecard`.
 *
 *   compositeScore = 60% margin yield + 40% velocity (inverted days-on-hand).
 */

import type { DutchieProduct } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const VELOCITY_HORIZON_DAYS = 60;
export const DEAD_STOCK_DAYS = 45;
export const MARGIN_WEIGHT = 0.6;
export const VELOCITY_WEIGHT = 0.4;

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

    const unitCost = Number(product.unitCost ?? 0);
    const recPrice = Number(product.recPrice ?? product.price ?? 0);
    if (unitCost > 0 && recPrice > 0) {
      acc.marginSum += ((recPrice - unitCost) / recPrice) * 100;
      acc.marginCount += 1;
    }

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

    const marginScore = Math.max(0, Math.min(1, avgGrossMarginPct / 100));
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
      rank: 0,
    });
  }

  scorecards.sort((a, b) => b.compositeScore - a.compositeScore);
  return scorecards.map((sc, index) => ({ ...sc, rank: index + 1 }));
}
