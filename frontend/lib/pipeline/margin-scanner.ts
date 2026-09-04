/**
 * Margin & Dead Stock Scanner (self-contained frontend port).
 *
 * Faithful, pure-computation port of modules/margin-scanner/scanner.ts. The
 * only intentional difference: the repo-root `triggerAlert` side effect is
 * omitted (the deployed cron route has no alert bus). Output JSON is
 * byte-compatible with the backend `MarginScanResult` schema.
 *
 * HARD RULES preserved:
 *   - Read-only, pure computation. No price changes, no auto-actions.
 *   - COGS guard: unitCost <= 0 SKUs are skipped, never flagged.
 */

import { StoreNode, type DutchieProduct, type PipelineAlertTier } from './types';

export const MARGIN_WARNING_THRESHOLD = 35;
export const MARGIN_CRITICAL_THRESHOLD = 20;
export const DEAD_STOCK_MIN_QTY = 20;
export const DEAD_STOCK_STALE_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface MarginFlag {
  readonly node: StoreNode;
  readonly productName: string;
  readonly category?: string;
  readonly quantityAvailable: number;
  readonly unitCost: number;
  readonly recPrice: number;
  readonly grossMarginPct: number;
  readonly label: 'MARGIN_WARNING' | 'MARGIN_CRITICAL';
  readonly alertTier: PipelineAlertTier;
}

export interface DeadStockFlag {
  readonly node: StoreNode;
  readonly productName: string;
  readonly category?: string;
  readonly quantityAvailable: number;
  readonly lastModifiedDateUTC: string | null;
  readonly daysSinceLastModified: number | null;
  readonly label: 'DEAD_STOCK_CANDIDATE';
  readonly alertTier: PipelineAlertTier;
}

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

export interface NodeInventoryItem {
  readonly node: StoreNode;
  readonly product: DutchieProduct;
}

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
          alertTier: 'TIER_2',
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
          alertTier: 'TIER_1',
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
        alertTier: 'TIER_2',
      });
    }
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
