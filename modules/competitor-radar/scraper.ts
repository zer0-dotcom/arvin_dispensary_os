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

import { AlertTier, guard, triggerAlert } from '../../lib/alerts';

/** Public competitor storefronts to monitor (all publicly accessible). */
export const COMPETITOR_TARGETS: readonly string[] = [
  'https://dutchie.com/dispensary/culture-house',
  'https://dutchie.com/dispensary/medmen-new-york',
  'https://dutchie.com/dispensary/gotham-buds',
  'https://dutchie.com/dispensary/the-travel-agency',
  'https://dutchie.com/dispensary/verdi-cannabis',
];

const DEFAULT_TIMEOUT_MS = 20_000;
const USER_AGENT =
  'ArvinDispensaryOS-CompetitorRadar/1.0 (+read-only public menu monitor)';

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
    const html = await guard<string>(
      { source: 'competitor.radar', meta: { target } },
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(target, {
            method: 'GET',
            headers: {
              Accept: 'text/html,application/xhtml+xml',
              'User-Agent': USER_AGENT,
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
      },
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
