/**
 * Demand Forecaster (self-contained frontend port).
 *
 * Faithful, pure-computation port of
 * modules/forward-intelligence/demand-forecaster.ts. Output shapes are
 * byte-compatible with the backend `ReorderAlert` / `DemandForecastResult`.
 *
 * KNOWN LIMITATION (same as backend): the /products endpoint exposes no true
 * sales velocity, so `lastModifiedDateUTC` (catalog modification) is the only
 * available staleness proxy for days-on-hand.
 */

import type { DutchieProduct } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ReorderAlert {
  readonly productId: string;
  readonly name: string;
  readonly vendorName: string;
  readonly quantityAvailable: number;
  readonly daysOnHand: number;
  readonly unitCost: number;
  readonly triggerType: 'REORDER' | 'OVERSTOCK';
}

export interface DemandForecastResult {
  readonly scannedAt: string;
  readonly nodeId: string;
  readonly totalSKUs: number;
  readonly reorderAlerts: ReorderAlert[];
  readonly overstockAlerts: ReorderAlert[];
}

export function daysOnHandProxy(
  lastModifiedDateUTC: string | undefined,
  now: Date = new Date(),
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

export function runDemandForecast(
  products: DutchieProduct[],
  nodeId: string,
  parDays = 7,
  ceilingDays = 45,
  now: Date = new Date(),
): DemandForecastResult {
  const reorderAlerts: ReorderAlert[] = [];
  const overstockAlerts: ReorderAlert[] = [];

  for (const product of products) {
    const unitCost = Number(product.unitCost ?? 0);
    // COGS guard: cannot reason without a real cost — skip.
    if (unitCost <= 0) {
      continue;
    }

    const quantityAvailable =
      typeof product.quantityAvailable === 'number'
        ? product.quantityAvailable
        : 0;

    const rawDays = daysOnHandProxy(product.lastModifiedDateUTC, now);
    const daysOnHand = rawDays === null ? ceilingDays : rawDays;

    const base = {
      productId: product.id,
      name: product.name,
      vendorName: product.vendorName ?? '(unknown vendor)',
      quantityAvailable,
      daysOnHand,
      unitCost,
    };

    if (daysOnHand <= parDays) {
      reorderAlerts.push({ ...base, triggerType: 'REORDER' });
    } else if (rawDays === null || daysOnHand >= ceilingDays) {
      overstockAlerts.push({ ...base, triggerType: 'OVERSTOCK' });
    }
  }

  return {
    scannedAt: now.toISOString(),
    nodeId,
    totalSKUs: products.length,
    reorderAlerts,
    overstockAlerts,
  };
}
