/**
 * Competitor radar — scraper.
 *
 * Scrapes PUBLICLY ACCESSIBLE Dutchie-hosted dispensary storefront menu pages
 * (no login walls) for the operator's competitor set, extracting publicly
 * visible product / price / category data.
 *
 * HARD RULES enforced here:
 *   - Read-only, public data only. No authentication, no login flows.
 *   - Every HTTP call is wrapped through the alert system (`guard`).
 *   - Multiple targets are fetched with `Promise.allSettled` so one failure
 *     never aborts the whole batch.
 *   - No outbound sends / notifications / financial or marketing side effects.
 */

import { AlertTier, Tier3HaltError, guard, triggerAlert } from '../../lib/alerts';

/** Public competitor storefronts to monitor (all publicly accessible). */
export const COMPETITOR_TARGETS: readonly string[] = [
  'https://dutchie.com/dispensary/culture-house',
  'https://dutchie.com/dispensary/medmen-new-york',
  'https://dutchie.com/dispensary/gotham-buds',
  'https://dutchie.com/dispensary/the-travel-agency',
  'https://dutchie.com/dispensary/verdi-cannabis',
];

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * User-Agent rotation pool.
 *
 * A pool of realistic, current desktop browser User-Agent strings. One is
 * selected per outbound request (round-robin via `nextUserAgent`) so requests
 * do not all present an identical UA. Rotation advances PER REQUEST, not per
 * sweep.
 */
const USER_AGENT_POOL: readonly string[] = [
  // Chrome on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  // Firefox on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  // Safari on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  // Chrome on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  // Edge on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
];

/** Round-robin cursor for User-Agent selection. */
let userAgentCursor = 0;

/** Returns the next User-Agent from the pool, advancing per call (per request). */
export function nextUserAgent(): string {
  const ua = USER_AGENT_POOL[userAgentCursor % USER_AGENT_POOL.length]!;
  userAgentCursor += 1;
  return ua;
}

/**
 * Retry policy for competitor scrape HTTP calls.
 *   - RETRY_ATTEMPTS retries (so up to RETRY_ATTEMPTS + 1 total attempts).
 *   - Delay before a retry = RETRY_BASE_DELAY_MS * attemptNumber
 *     (attempt 1 -> 3s, attempt 2 -> 6s).
 * A TIER_2 alert is only raised AFTER all retries are exhausted (the retry
 * loop runs INSIDE `guard`). A Tier3HaltError is never retried.
 */
const RETRY_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 3_000;

/** Promise-based async delay. */
function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Run `fn` with retries and linear-per-attempt backoff. Retries on any thrown
 * error EXCEPT `Tier3HaltError`, which is re-thrown immediately (never retried).
 * If all attempts fail, the final error is thrown to the caller (which, when
 * called inside `guard`, becomes a single TIER_2 alert).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number = RETRY_ATTEMPTS,
  baseDelayMs: number = RETRY_BASE_DELAY_MS,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Tier3HaltError) {
        throw err; // TIER_3 halts must never be retried.
      }
      lastErr = err;
      if (attempt < attempts) {
        // Linear-per-attempt backoff: 3s, then 6s, ...
        await delay(baseDelayMs * (attempt + 1));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface CompetitorProduct {
  readonly name: string;
  readonly category?: string;
  readonly price?: number;
}

export interface CompetitorSnapshot {
  readonly target: string;
  readonly dispensarySlug: string;
  readonly fetchedAt: string;
  readonly ok: boolean;
  readonly products: CompetitorProduct[];
  readonly note?: string;
}

export interface SweepResult {
  readonly sweepId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly targetCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly snapshots: CompetitorSnapshot[];
}

function slugFromUrl(url: string): string {
  const parts = url.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? url;
}

/**
 * Extract product data from raw storefront HTML.
 *
 * Dutchie storefronts are client-rendered, so pricing is typically delivered
 * inside an embedded JSON payload (e.g. Next.js `__NEXT_DATA__` /
 * `window.__APOLLO_STATE__`) rather than static markup. We best-effort parse
 * any embedded JSON blobs for product-like records and fall back gracefully.
 *
 * This function performs NO network calls and has no side effects.
 */
export function extractProducts(html: string): CompetitorProduct[] {
  const products: CompetitorProduct[] = [];
  const seen = new Set<string>();

  // Collect candidate JSON blobs embedded in the page.
  const jsonBlobs: string[] = [];
  const nextData = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (nextData && nextData[1]) {
    jsonBlobs.push(nextData[1]);
  }
  const apolloState = html.match(
    /window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});?/i,
  );
  if (apolloState && apolloState[1]) {
    jsonBlobs.push(apolloState[1]);
  }

  const pushProduct = (name: string, category?: string, price?: number) => {
    const key = `${name}::${category ?? ''}::${price ?? ''}`;
    if (name.length === 0 || seen.has(key)) {
      return;
    }
    seen.add(key);
    products.push({
      name,
      ...(category !== undefined ? { category } : {}),
      ...(price !== undefined ? { price } : {}),
    });
  };

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        walk(entry);
      }
      return;
    }
    if (typeof value !== 'object' || value === null) {
      return;
    }
    const obj = value as Record<string, unknown>;
    const name = obj['name'] ?? obj['productName'] ?? obj['Name'];
    const looksLikeProduct =
      typeof name === 'string' &&
      ('price' in obj ||
        'Price' in obj ||
        'recPrice' in obj ||
        'medPrice' in obj ||
        'category' in obj ||
        'Category' in obj ||
        'type' in obj);

    if (looksLikeProduct && typeof name === 'string') {
      const rawCategory = obj['category'] ?? obj['Category'] ?? obj['type'];
      const rawPrice =
        obj['price'] ?? obj['Price'] ?? obj['recPrice'] ?? obj['medPrice'];
      const category =
        typeof rawCategory === 'string' ? rawCategory : undefined;
      const price =
        typeof rawPrice === 'number'
          ? rawPrice
          : typeof rawPrice === 'string' && rawPrice.trim().length > 0
            ? Number.parseFloat(rawPrice.replace(/[^0-9.]/g, ''))
            : undefined;
      pushProduct(
        name,
        category,
        typeof price === 'number' && !Number.isNaN(price) ? price : undefined,
      );
    }

    for (const nested of Object.values(obj)) {
      walk(nested);
    }
  };

  for (const blob of jsonBlobs) {
    try {
      walk(JSON.parse(blob));
    } catch {
      // Ignore un-parseable blobs; this is best-effort extraction.
    }
  }

  return products;
}

/**
 * Fetch and parse a single competitor target. Never throws for an ordinary
 * fetch/parse failure — returns a snapshot with `ok: false` so the batch can
 * continue. TIER_3 halts still propagate.
 */
export async function scrapeTarget(
  target: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<CompetitorSnapshot> {
  const dispensarySlug = slugFromUrl(target);
  const fetchedAt = new Date().toISOString();

  try {
    // Retry loop runs INSIDE guard, so a single TIER_2 alert is raised only
    // after all retries are exhausted. Each attempt gets a fresh, rotated
    // User-Agent and its own AbortController timeout.
    const html = await guard<string>(
      { source: 'competitor.radar', meta: { target } },
      () =>
        withRetry(async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const response = await fetch(target, {
              method: 'GET',
              headers: {
                Accept: 'text/html,application/xhtml+xml',
                'User-Agent': nextUserAgent(),
              },
              signal: controller.signal,
            });
            if (!response.ok) {
              throw new Error(
                `Competitor page responded ${response.status} ${response.statusText}`,
              );
            }
            return await response.text();
          } finally {
            clearTimeout(timer);
          }
        }),
      AlertTier.TIER_2,
    );

    const products = extractProducts(html);
    return {
      target,
      dispensarySlug,
      fetchedAt,
      ok: true,
      products,
      ...(products.length === 0
        ? {
            note:
              'Fetched successfully but no products parsed (page likely fully client-rendered).',
          }
        : {}),
    };
  } catch (err) {
    return {
      target,
      dispensarySlug,
      fetchedAt,
      ok: false,
      products: [],
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run a full competitor sweep across ALL targets using Promise.allSettled so a
 * single target failure never aborts the batch.
 */
export async function runSweep(
  targets: readonly string[] = COMPETITOR_TARGETS,
): Promise<SweepResult> {
  const startedAt = new Date().toISOString();
  const sweepId = `sweep-${Date.now()}`;

  const settled = await Promise.allSettled(
    targets.map((target) => scrapeTarget(target)),
  );

  const snapshots: CompetitorSnapshot[] = settled.map((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }
    // A rejection here is unexpected (scrapeTarget catches its own errors),
    // so surface it as a TIER_2 and record a failed snapshot.
    const target = targets[index] ?? 'unknown';
    triggerAlert(
      AlertTier.TIER_2,
      'Unexpected rejection while scraping competitor target.',
      { source: 'competitor.radar', meta: { target }, cause: outcome.reason },
    );
    return {
      target,
      dispensarySlug: slugFromUrl(target),
      fetchedAt: new Date().toISOString(),
      ok: false,
      products: [],
      note:
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason),
    };
  });

  const successCount = snapshots.filter((s) => s.ok).length;

  return {
    sweepId,
    startedAt,
    finishedAt: new Date().toISOString(),
    targetCount: targets.length,
    successCount,
    failureCount: targets.length - successCount,
    snapshots,
  };
}


// ---------------------------------------------------------------------------
// Price classification + sweep correlation pass
// ---------------------------------------------------------------------------

/** Pricing recommendation produced by `classifyAlert`. */
export type PriceRecommendation = 'HOLD' | 'PRICE_MATCH' | 'MARGIN_PROTECT';

/** Inputs to `classifyAlert`. All monetary values are in the same currency. */
export interface PriceClassificationInput {
  /** Arvin's own catalog price for the matched product (internal Dutchie). */
  readonly arvinPrice: number;
  /** Internal unit cost / COGS for the product (internal product data). */
  readonly unitCost: number;
  /** Competitor's scraped price for the matched product. */
  readonly competitorPrice: number;
}

/** Result of a price classification. */
export interface PriceClassification {
  readonly recommendation: PriceRecommendation;
  readonly alertTier: AlertTier.TIER_1 | AlertTier.TIER_2;
}

/**
 * Classify a competitor price against Arvin's price and unit cost.
 *
 * Safety / correctness guards:
 *   - COGS guard: if `unitCost <= 0` we cannot reason about margin, so we HOLD
 *     (TIER_1) and never recommend a price move.
 *   - Divide-by-zero guard: if `arvinPrice <= 0` (or `competitorPrice <= 0`)
 *     the delta / margin math is undefined, so we HOLD (TIER_1).
 *
 * Logic (per spec):
 *   deltaPct              = ((competitorPrice - arvinPrice) / arvinPrice) * 100
 *   targetMarginIfMatched = ((competitorPrice - unitCost) / competitorPrice) * 100
 *   if competitorPrice < arvinPrice AND |deltaPct| > 10:
 *     targetMarginIfMatched >= 40 -> PRICE_MATCH   (TIER_2)
 *     else                        -> MARGIN_PROTECT (TIER_1)
 *   else                          -> HOLD           (TIER_1)
 */
export function classifyAlert(
  input: PriceClassificationInput,
): PriceClassification {
  const { arvinPrice, unitCost, competitorPrice } = input;

  // COGS guard — no valid cost basis, so HOLD.
  if (unitCost <= 0) {
    return { recommendation: 'HOLD', alertTier: AlertTier.TIER_1 };
  }

  // Divide-by-zero / nonsensical-price guard — HOLD to avoid NaN/Infinity.
  if (arvinPrice <= 0 || competitorPrice <= 0) {
    return { recommendation: 'HOLD', alertTier: AlertTier.TIER_1 };
  }

  const deltaPct = ((competitorPrice - arvinPrice) / arvinPrice) * 100;
  const targetMarginIfMatched =
    ((competitorPrice - unitCost) / competitorPrice) * 100;

  if (competitorPrice < arvinPrice && Math.abs(deltaPct) > 10) {
    if (targetMarginIfMatched >= 40) {
      return { recommendation: 'PRICE_MATCH', alertTier: AlertTier.TIER_2 };
    }
    return { recommendation: 'MARGIN_PROTECT', alertTier: AlertTier.TIER_1 };
  }

  return { recommendation: 'HOLD', alertTier: AlertTier.TIER_1 };
}

/**
 * An entry from Arvin's internal catalog. Populated by the CALLER from the
 * internal Dutchie catalog (read-only) — this module never fabricates catalog
 * data. `matchKey` is the product name used to correlate against scraped
 * competitor product names.
 */
export interface ArvinCatalogEntry {
  readonly matchKey: string;
  readonly arvinPrice: number;
  readonly unitCost: number;
}

/** A single competitor-vs-Arvin correlation record with its classification. */
export interface CorrelationRecord {
  readonly target: string;
  readonly dispensarySlug: string;
  readonly competitorProduct: string;
  readonly competitorPrice: number;
  readonly matchedCatalogKey: string;
  readonly arvinPrice: number;
  readonly unitCost: number;
  readonly classification: PriceClassification;
}

/** Normalize a product name for correlation matching. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Correlation pass: match scraped competitor products against Arvin's internal
 * catalog (by normalized product name), run `classifyAlert` per match, and
 * surface any TIER_2 classifications through the alert system.
 *
 * Pure computation over already-fetched data (no network, no writes). TIER_1
 * results are returned but NOT alerted (informational). No auto-action is ever
 * taken — recommendations are surfaced only.
 */
export function correlateSweep(
  sweep: SweepResult,
  catalog: readonly ArvinCatalogEntry[],
): CorrelationRecord[] {
  const catalogByKey = new Map<string, ArvinCatalogEntry>();
  for (const entry of catalog) {
    catalogByKey.set(normalizeName(entry.matchKey), entry);
  }

  const records: CorrelationRecord[] = [];

  for (const snapshot of sweep.snapshots) {
    if (!snapshot.ok) {
      continue;
    }
    for (const product of snapshot.products) {
      if (typeof product.price !== 'number') {
        continue; // Cannot correlate without a competitor price.
      }
      const match = catalogByKey.get(normalizeName(product.name));
      if (!match) {
        continue; // No internal catalog match for this competitor product.
      }

      const classification = classifyAlert({
        arvinPrice: match.arvinPrice,
        unitCost: match.unitCost,
        competitorPrice: product.price,
      });

      const record: CorrelationRecord = {
        target: snapshot.target,
        dispensarySlug: snapshot.dispensarySlug,
        competitorProduct: product.name,
        competitorPrice: product.price,
        matchedCatalogKey: match.matchKey,
        arvinPrice: match.arvinPrice,
        unitCost: match.unitCost,
        classification,
      };
      records.push(record);

      // Surface TIER_2 recommendations (e.g. PRICE_MATCH) via the alert system.
      // TIER_1 results are informational and simply returned in the records.
      if (classification.alertTier === AlertTier.TIER_2) {
        triggerAlert(
          AlertTier.TIER_2,
          `Competitor undercut detected: ${product.name} @ ${product.price} ` +
            `(Arvin ${match.arvinPrice}) -> ${classification.recommendation}`,
          {
            source: 'competitor.radar.correlation',
            meta: {
              target: snapshot.target,
              competitorProduct: product.name,
              competitorPrice: product.price,
              arvinPrice: match.arvinPrice,
              recommendation: classification.recommendation,
            },
          },
        );
      }
    }
  }

  return records;
}
