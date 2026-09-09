/**
 * Competitor radar — self-contained sweep pipeline (Railway-safe).
 *
 * This is a PORT of the repo-root modules/competitor-radar/{scraper,persistence}.ts
 * into `frontend/lib/pipeline/` so it runs inside Railway's frontend-only deploy
 * (no repo-root modules/ or scripts/ are reachable at runtime there). It mirrors
 * how margin-scanner / demand-forecaster / vendor-scorecard / dossier-synthesizer
 * were already ported.
 *
 * WHAT IT DOES
 * ------------
 * Scrapes PUBLICLY ACCESSIBLE Dutchie-hosted dispensary storefront menu pages
 * for the operator's competitor set and extracts publicly-visible product /
 * price / category data, then persists the result as a SweepResult JSON that
 * `frontend/lib/data-loader.ts#loadLatestSweep` reads and the /competitors page
 * renders.
 *
 * HARD RULES (unchanged from the original):
 *   - Read-only, PUBLIC data only. No auth, no login flows, no write-backs.
 *   - Multiple targets fetched with Promise.allSettled so one failure never
 *     aborts the batch.
 *   - Each target self-catches: a fetch/parse failure yields a snapshot with
 *     ok:false + a `note`, never a thrown batch abort and never fabricated data.
 *   - No outbound sends / notifications / financial side effects.
 *
 * SELF-CONTAINMENT NOTE
 * ---------------------
 * The original depended on repo-root `lib/alerts` (guard/triggerAlert). That
 * dependency is intentionally dropped here (as in the other ported pipeline
 * modules): failures are handled with plain try/catch + bounded retry and are
 * surfaced in the persisted snapshot `note` and the sweep success/failure
 * counts, which is exactly what the UI already renders.
 *
 * SHAPE
 * -----
 * The emitted JSON is byte-compatible with the SweepResult contract in
 * frontend/lib/types.ts (re-exported from the backend scraper), so the existing
 * loader / page / CompetitorTable render it without changes:
 *   { sweepId, startedAt, finishedAt, targetCount, successCount, failureCount,
 *     snapshots: [{ target, dispensarySlug, fetchedAt, ok, products[], note? }] }
 *   product: { name, category?, price? }
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Public competitor storefronts to monitor (all publicly accessible). */
export const COMPETITOR_TARGETS: readonly string[] = [
  'https://dutchie.com/dispensary/culture-house',
  'https://dutchie.com/dispensary/medmen-new-york',
  'https://dutchie.com/dispensary/gotham-buds',
  'https://dutchie.com/dispensary/the-travel-agency',
  'https://dutchie.com/dispensary/verdi-cannabis',
];

const DEFAULT_TIMEOUT_MS = 20_000;

/** Realistic desktop User-Agent pool; one is chosen (round-robin) per request. */
const USER_AGENT_POOL: readonly string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
];

let userAgentCursor = 0;

/** Next User-Agent from the pool, advancing per call (per request). */
export function nextUserAgent(): string {
  const ua = USER_AGENT_POOL[userAgentCursor % USER_AGENT_POOL.length];
  userAgentCursor += 1;
  return ua ?? USER_AGENT_POOL[0]!;
}

const RETRY_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 3_000;

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Run `fn` with linear-per-attempt backoff. Throws the final error if all fail. */
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
      lastErr = err;
      if (attempt < attempts) {
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
 * Best-effort extraction of product data from raw storefront HTML. Dutchie
 * storefronts are client-rendered, so pricing usually lives in an embedded JSON
 * payload (Next.js `__NEXT_DATA__` / `window.__APOLLO_STATE__`). No network
 * calls, no side effects.
 */
export function extractProducts(html: string): CompetitorProduct[] {
  const products: CompetitorProduct[] = [];
  const seen = new Set<string>();

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
      // Ignore un-parseable blobs; extraction is best-effort.
    }
  }

  return products;
}

/**
 * Fetch and parse a single competitor target. Never throws for an ordinary
 * fetch/parse failure — returns a snapshot with `ok:false` so the batch can
 * continue.
 */
export async function scrapeTarget(
  target: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<CompetitorSnapshot> {
  const dispensarySlug = slugFromUrl(target);
  const fetchedAt = new Date().toISOString();

  try {
    const html = await withRetry(async () => {
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
    });

    const products = extractProducts(html);
    return {
      target,
      dispensarySlug,
      fetchedAt,
      ok: true,
      products,
      ...(products.length === 0
        ? {
            note: 'Fetched successfully but no products parsed (page likely fully client-rendered).',
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
    const target = targets[index] ?? 'unknown';
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

/**
 * Candidate `data/` roots to write into, mirroring data-loader.ts read order.
 * `.` (cwd = frontend/ on Railway) is authoritative; `..` (repo root) is a
 * best-effort mirror that only exists in a local/monorepo checkout.
 */
function dataRootCandidates(): string[] {
  const fromEnv = process.env['DATA_ROOT'];
  if (fromEnv && fromEnv.trim().length > 0) {
    return [resolve(process.cwd(), fromEnv.trim())];
  }
  return [resolve(process.cwd(), '.'), resolve(process.cwd(), '..')];
}

/**
 * Persist a sweep as `data/competitor-sweeps/<sweepId>.json` under every
 * writable data root. The filename embeds the sweep's millisecond timestamp so
 * loadLatestArtifact('competitor-sweeps', '') sorts newest-first correctly. The
 * cwd write is required; parent-root mirroring is best-effort. Returns the paths
 * actually written.
 */
export async function persistSweep(sweep: SweepResult): Promise<string[]> {
  const written: string[] = [];
  const json = JSON.stringify(sweep, null, 2);

  for (const root of dataRootCandidates()) {
    const dir = join(root, 'data', 'competitor-sweeps');
    try {
      await mkdir(dir, { recursive: true });
      const filePath = join(dir, `${sweep.sweepId}.json`);
      await writeFile(filePath, json, 'utf8');
      written.push(filePath);
    } catch {
      // Best-effort: a non-writable parent root in production is expected.
    }
  }
  return written;
}

export interface RefreshSweepResult {
  readonly ok: boolean;
  readonly timestamp: string;
  readonly sweep: SweepResult;
  readonly sweepPaths: string[];
}

/**
 * Run a full sweep and PERSIST it before returning any summary (hard rule).
 * `ok` reflects whether every target succeeded; a partial failure still
 * persists a valid sweep and returns ok:false with the details in `sweep`.
 */
export async function refreshCompetitorSweep(): Promise<RefreshSweepResult> {
  const sweep = await runSweep();
  const sweepPaths = await persistSweep(sweep);
  return {
    ok: sweep.failureCount === 0,
    timestamp: sweep.finishedAt,
    sweep,
    sweepPaths,
  };
}

/**
 * CLI entry point: `tsx lib/pipeline/competitor-sweep.ts` (or via the
 * "competitor-sweep" npm script). Runs one sweep, persists it, prints a concise
 * summary, and exits 0 (sweep persisted) or 1 (hard failure before persist).
 */
async function main(): Promise<void> {
  try {
    const result = await refreshCompetitorSweep();
    const { sweep } = result;
    // eslint-disable-next-line no-console
    console.log(
      `[competitor-sweep] ${sweep.sweepId}: ${sweep.successCount}/${sweep.targetCount} targets ok, ` +
        `${sweep.snapshots.reduce((n, s) => n + s.products.length, 0)} products; ` +
        `written to: ${result.sweepPaths.join(', ') || '(no writable data root)'}`,
    );
    for (const snap of sweep.snapshots) {
      // eslint-disable-next-line no-console
      console.log(
        `  - ${snap.dispensarySlug}: ${snap.ok ? 'OK' : 'FAILED'} ` +
          `(${snap.products.length} products)${snap.note ? ` — ${snap.note}` : ''}`,
      );
    }
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[competitor-sweep] Hard failure: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exit(1);
  }
}

// Run only when executed directly (not when imported by the cron route).
const invokedPath = process.argv[1] ?? '';
if (
  invokedPath.endsWith('competitor-sweep.ts') ||
  invokedPath.endsWith('competitor-sweep.js')
) {
  void main();
}
