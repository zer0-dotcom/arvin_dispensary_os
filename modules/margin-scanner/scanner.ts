/**
 * Margin & Dead Stock Scanner — analysis.
 *
 * Surfaces underperforming SKUs before they become dead weight:
 *   - MARGIN analysis: gross margin per SKU, flagging low / critical margin.
 *   - DEAD STOCK detection: high quantity that has not sold recently.
 *
 * HARD RULES enforced here:
 *   - Read-only. No price changes, no auto-actions.
 *   - COGS guard: unitCost <= 0 SKUs are skipped, never flagged.
 *   - TIER_2 items are surfaced for HUMAN review only — no outbound sends,
 *     no marketing triggers.
 *
 * This module is pure computation over already-fetched inventory data. The
 * only side effect is optional alert logging via `triggerAlert`.
 */

import { AlertTier, triggerAlert } from '../../lib/alerts';
import type { DutchieProduct, StoreNode } from '../../lib/dutchie/client';

/** Thresholds for margin classification (percentages). */
export const MARGIN_WARNING_THRESHOLD = 35;
export const MARGIN_CRITICAL_THRESHOLD = 20;

/** Dead-stock thresholds. */
export const DEAD_STOCK_MIN_QTY = 20;
export const DEAD_STOCK_STALE_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A SKU flagged for a margin concern. */
export interface MarginFlag {
  readonly node: StoreNode;
  readonly productName: string;
  readonly category?: string;
  readonly quantityAvailable: number;
  readonly unitCost: number;
  readonly recPrice: number;
  readonly grossMarginPct: number;
  readonly label: 'MARGIN_WARNING' | 'MARGIN_CRITICAL';
  readonly alertTier: AlertTier.TIER_1 | AlertTier.TIER_2;
}

/** A SKU flagged as a dead-stock candidate. */
export interface DeadStockFlag {
  readonly node: StoreNode;
  readonly productName: string;
  readonly category?: string;
  readonly quantityAvailable: number;
  readonly lastModifiedDateUTC: string | null;
  readonly daysSinceLastModified: number | null;
  readonly label: 'DEAD_STOCK_CANDIDATE';
  readonly alertTier: AlertTier.TIER_2;
}

/** Full scan result (persisted schema). */
export interface MarginScanResult {
  readonly scanId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly skusAnalyzed: number;
  readonly skusSkippedNoCost: number;
  readonly marginWarnings: MarginFlag[];
  readonly marginCritical: MarginFlag[];
  readonly deadStockCandidates: DeadStockFlag[];
}

/** An inventory item tagged with the node it came from. */
export interface NodeInventoryItem {
  readonly node: StoreNode;
  readonly product: DutchieProduct;
}

/**
 * Compute days since a lastModifiedDateUTC ISO timestamp. Returns null when the
 * timestamp is missing or unparseable (treated as "never modified" by callers).
 */
export function daysSince(
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
 * Analyze a combined multi-node inventory list into margin + dead-stock flags.
 *
 * Margin:
 *   grossMarginPct = ((recPrice - unitCost) / recPrice) * 100
 *   < MARGIN_CRITICAL_THRESHOLD -> MARGIN_CRITICAL (TIER_2)
 *   else < MARGIN_WARNING_THRESHOLD -> MARGIN_WARNING (TIER_1)
 *   unitCost <= 0 -> skip (COGS guard); recPrice <= 0 -> skip (no valid margin).
 *
 * Dead stock:
 *   quantityAvailable > DEAD_STOCK_MIN_QTY AND
 *   (lastModifiedDateUTC is null OR lastModifiedDateUTC older than DEAD_STOCK_STALE_DAYS)
 *   -> DEAD_STOCK_CANDIDATE (TIER_2)
 *
 *   KNOWN LIMITATION: lastModifiedDateUTC is the last catalog modification date,
 *   NOT the last sale date. It is the best available proxy from the /products
 *   endpoint. A dedicated sales velocity endpoint would provide true last-sale data.
 *
 * TIER_2 flags are surfaced via triggerAlert for human review. No auto-actions.
 */
export function analyzeInventory(
  inventory: readonly NodeInventoryItem[],
  now: Date = new Date(),
): MarginScanResult {
  const startedAt = now.toISOString();
  const scanId = `margin-scan-${now.getTime()}`;

  const marginWarnings: MarginFlag[] = [];
  const marginCritical: MarginFlag[] = [];
  const deadStockCandidates: DeadStockFlag[] = [];

  let skusAnalyzed = 0;
  let skusSkippedNoCost = 0;

  for (const { node, product } of inventory) {
    const productName = product.name;
    const category = product.category;
    const quantityAvailable =
      typeof product.quantityAvailable === 'number'
        ? product.quantityAvailable
        : 0;
    const unitCost = Number(product.unitCost ?? 0);
    const recPrice = Number(product.recPrice ?? product.price ?? 0);

    // --- Margin analysis (COGS guard first) ---
    if (unitCost <= 0) {
      // COGS guard: cannot reason about margin — skip, do not flag.
      skusSkippedNoCost += 1;
    } else if (recPrice > 0) {
      skusAnalyzed += 1;
      const grossMarginPct = ((recPrice - unitCost) / recPrice) * 100;

      if (grossMarginPct < MARGIN_CRITICAL_THRESHOLD) {
        marginCritical.push({
          node,
          productName,
          ...(category !== undefined ? { category } : {}),
          quantityAvailable,
          unitCost,
          recPrice,
          grossMarginPct,
          label: 'MARGIN_CRITICAL',
          alertTier: AlertTier.TIER_2,
        });
      } else if (grossMarginPct < MARGIN_WARNING_THRESHOLD) {
        marginWarnings.push({
          node,
          productName,
          ...(category !== undefined ? { category } : {}),
          quantityAvailable,
          unitCost,
          recPrice,
          grossMarginPct,
          label: 'MARGIN_WARNING',
          alertTier: AlertTier.TIER_1,
        });
      }
    }

    // --- Dead stock detection (independent of margin) ---
    const days = daysSince(product.lastModifiedDateUTC, now);
    const isStale = days === null || days > DEAD_STOCK_STALE_DAYS;
    if (quantityAvailable > DEAD_STOCK_MIN_QTY && isStale) {
      deadStockCandidates.push({
        node,
        productName,
        ...(category !== undefined ? { category } : {}),
        quantityAvailable,
        lastModifiedDateUTC: product.lastModifiedDateUTC ?? null,
        daysSinceLastModified: days,
        label: 'DEAD_STOCK_CANDIDATE',
        alertTier: AlertTier.TIER_2,
      });
    }
  }

  // Surface TIER_2 items for human review (no auto-actions).
  for (const flag of marginCritical) {
    triggerAlert(
      AlertTier.TIER_2,
      `MARGIN_CRITICAL: ${flag.productName} @ ${flag.grossMarginPct.toFixed(1)}% ` +
        `(rec ${flag.recPrice}, cost ${flag.unitCost})`,
      {
        source: 'margin-scanner',
        meta: {
          node: flag.node,
          productName: flag.productName,
          grossMarginPct: flag.grossMarginPct,
        },
      },
    );
  }
  for (const flag of deadStockCandidates) {
    triggerAlert(
      AlertTier.TIER_2,
      `DEAD_STOCK_CANDIDATE: ${flag.productName} (qty ${flag.quantityAvailable}, ` +
        `${flag.daysSinceLastModified === null ? 'never modified' : `${flag.daysSinceLastModified.toFixed(0)}d since modified`})`,
      {
        source: 'margin-scanner',
        meta: {
          node: flag.node,
          productName: flag.productName,
          quantityAvailable: flag.quantityAvailable,
          daysSinceLastModified: flag.daysSinceLastModified,
        },
      },
    );
  }

  return {
    scanId,
    startedAt,
    finishedAt: new Date().toISOString(),
    skusAnalyzed,
    skusSkippedNoCost,
    marginWarnings,
    marginCritical,
    deadStockCandidates,
  };
}
