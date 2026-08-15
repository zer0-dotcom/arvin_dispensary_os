/**
 * Forward Intelligence — Demand Forecaster.
 *
 * Classifies SKUs into REORDER (moving fast / needs restock) and OVERSTOCK
 * (sitting too long) buckets so Arvin can act before stockouts or dead weight.
 *
 * HARD RULES enforced here:
 *   - Read-only. No price changes, no auto-actions, no outbound sends.
 *   - COGS guard: unitCost <= 0 SKUs are skipped, never flagged.
 *   - Pure computation over already-fetched product data.
 *
 * KNOWN LIMITATION
 * ----------------
 * The /products endpoint does NOT expose true sales velocity or last-sale
 * timestamps. `lastModifiedDateUTC` (last catalog modification) is used as the
 * ONLY available staleness proxy for "days on hand". This is an approximation:
 * a recently modified SKU is treated as active/fast-moving, while a long-stale
 * SKU is treated as slow/overstock. A dedicated sales-velocity endpoint would
 * provide true days-on-hand and demand data. See scripts/audit-inventory-endpoint.ts.
 */

import type { DutchieProduct } from '../../lib/dutchie/client';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A reorder / overstock recommendation for a single SKU. */
export interface ReorderAlert {
  readonly productId: string;
  readonly name: string;
  readonly vendorName: string;
  readonly quantityAvailable: number;
  readonly daysOnHand: number;
  readonly unitCost: number;
  readonly triggerType: 'REORDER' | 'OVERSTOCK';
}

/** Result of a demand-forecast pass over one node's catalog. */
export interface DemandForecastResult {
  readonly scannedAt: string;
  readonly nodeId: string;
  readonly totalSKUs: number;
  readonly reorderAlerts: ReorderAlert[];
  readonly overstockAlerts: ReorderAlert[];
}

/**
 * Compute days-on-hand proxy = days since lastModifiedDateUTC.
 * Returns a large sentinel (Number.MAX_SAFE-ish via ceiling handling) when the
 * timestamp is missing — treated as maximally stale (overstock candidate).
 */
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

/**
 * Run a demand forecast over a node's catalog.
 *
 *   parDays     — at/below this days-on-hand => fast mover => REORDER.
 *   ceilingDays — at/above this days-on-hand (or null/unknown) => OVERSTOCK.
 *
 * COGS guard: products with unitCost <= 0 are skipped entirely.
 */
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

    // Staleness proxy for days-on-hand (KNOWN LIMITATION — see file header).
    const rawDays = daysOnHandProxy(product.lastModifiedDateUTC, now);
    // Missing timestamp => treat as maximally stale (>= ceiling) => overstock.
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
