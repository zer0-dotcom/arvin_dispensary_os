/**
 * Read-only telemetry API — GET /api/v1/intel
 *
 * ROUTE PATH / CONVENTION
 * -----------------------
 * This repo's App Router routes all live at `frontend/app/api/<segment>/route.ts`
 * (e.g. app/api/cron/dossier/route.ts, app/api/sms/route.ts, app/api/margins/route.ts).
 * Following that exact convention, this new nested "v1/intel" segment is placed
 * at `frontend/app/api/v1/intel/route.ts` — NOT a stray "app/app/..." path.
 *
 * WHAT IT DOES
 * ------------
 * Surfaces the latest persisted margin-scan artifact as a compact, read-only
 * telemetry payload. It performs NO Dutchie/AWS/network calls and never writes.
 *
 * DATA SOURCE / RESOLUTION
 * ------------------------
 * Reuses the EXISTING latest-file resolver `loadLatestArtifact('margin-scans',
 * 'margin-scan-')` from frontend/lib/data-loader.ts — the same generic that
 * powers loadLatestMarginScan(). That resolver already implements this repo's
 * dual-path convention (cwd `frontend/data/margin-scans` first, then the
 * repo-root `../data/margin-scans` fallback for local/monorepo dev, with an
 * optional DATA_ROOT override). No absolute container path is hardcoded here.
 *
 * SHAPE NOTE (verified against frontend/lib/pipeline/margin-scanner.ts)
 * --------------------------------------------------------------------
 * The real persisted MarginScanResult is:
 *   { scanId, startedAt, finishedAt, skusAnalyzed, skusSkippedNoCost,
 *     marginWarnings[], marginCritical[], deadStockCandidates[] }
 * Each marginCritical item (MarginFlag) is:
 *   { node, productName, category?, quantityAvailable, unitCost, recPrice,
 *     grossMarginPct, label, alertTier }
 * It does NOT contain a `summary` object, a `catalogPulls` array, nor
 * reorder/overstock/vendor counts (those live in the weekly dossier, a
 * different artifact). This handler therefore reads the real fields it can and
 * falls back defensively (summary.* -> real field -> computed length -> 0/[])
 * so it stays correct whether or not a future artifact adds those fields.
 *
 * CROSS-ARTIFACT JOIN (v1.2) — dossier telemetry
 * ----------------------------------------------
 * reorder/overstock/vendor counts are NOT in the margin-scan artifact; they
 * live in the latest weekly dossier. So this handler ALSO resolves the latest
 * `weekly-dossier-*.json` (via the same dual-path loadLatestArtifact resolver,
 * subdir `forward-intel`, prefix `weekly-dossier-`) and sources these live from
 * it (verified real fields, against frontend/lib/pipeline/dossier-synthesizer.ts):
 *   reorderWatchCount  <- dossier.reorderWatch.totalReorder
 *   overstockCount     <- dossier.reorderWatch.totalOverstock
 *   activeVendorsCount <- dossier.vendorRankings.totalVendors
 *   nodes[]            <- dossier.nodeComparison[]
 *                         ({ nodeId, totalSKUs, reorderCount, overstockCount })
 * The dossier read is strictly NON-BLOCKING: if it is missing/errored, these
 * fields gracefully fall back to 0 / [] and `dossierFile` is null. Only a
 * MISSING MARGIN-SCAN artifact yields a 404 (unchanged behavior).
 *
 * AUTH: `Authorization: Bearer <token>` where <token> matches
 *       process.env.MIK_API_KEY OR process.env.CRON_SECRET (env-only).
 */

import { NextResponse } from 'next/server';
import { loadLatestArtifact } from '@/lib/data-loader';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Service name comes from the frontend package.json ("mik-frontend"). */
const SERVICE_NAME = 'mik-frontend';

/**
 * Permissive view over the on-disk margin-scan artifact. Real fields are typed;
 * the spec-assumed `summary`/`catalogPulls` are optional (absent in the real
 * artifact today) so defensive fallbacks compile under strict mode.
 */
interface ScanArtifact {
  readonly skusAnalyzed?: number;
  readonly skusSkippedNoCost?: number;
  readonly marginWarnings?: unknown;
  readonly marginCritical?: unknown;
  readonly deadStockCandidates?: unknown;
  readonly summary?: {
    readonly skusAnalyzed?: number;
    readonly marginCritical?: number;
    readonly deadStock?: number;
    readonly totalReorder?: number;
    readonly totalOverstock?: number;
    readonly totalVendors?: number;
  };
  readonly catalogPulls?: unknown;
}

/**
 * Permissive view over the on-disk weekly-dossier artifact. Only the fields
 * this endpoint reads are declared. Verified real shape lives in
 * frontend/lib/pipeline/dossier-synthesizer.ts (WeeklyDossier).
 */
interface DossierArtifact {
  readonly reorderWatch?: {
    readonly totalReorder?: number;
    readonly totalOverstock?: number;
  };
  readonly vendorRankings?: {
    readonly totalVendors?: number;
  };
  readonly nodeComparison?: unknown;
}

/** First argument that is a non-empty (trimmed) string, else undefined. */
function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

/** Read a value as a plain object record, else undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Coerce to a finite number, else the provided fallback. */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Product-name fallback chain — the SAME order established elsewhere in this
 * repo (see frontend/lib/pipeline/dutchie-client.ts / ReorderTable.tsx):
 * name -> productName -> product?.name -> title -> productTitle -> brand.
 */
function productLabel(item: Record<string, unknown>): string {
  const nested = asRecord(item['product']);
  return (
    firstNonEmptyString(
      item['name'],
      item['productName'],
      nested?.['name'],
      item['title'],
      item['productTitle'],
      item['brand'],
    ) ?? 'Unnamed Product'
  );
}

/** Extract and validate the Bearer token against the accepted env secrets. */
function isAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token) {
    return false;
  }
  const accepted = [process.env['MIK_API_KEY'], process.env['CRON_SECRET']]
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  return accepted.some((secret) => secret === token);
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // --- Auth (Bearer: MIK_API_KEY or CRON_SECRET) ---
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized: Invalid or missing API key' },
        { status: 401 },
      );
    }

    // --- Resolve latest margin-scan artifact (reuse existing resolver) ---
    const result = await loadLatestArtifact<ScanArtifact>(
      'margin-scans',
      'margin-scan-',
    );

    if (result.status === 'missing') {
      return NextResponse.json(
        { ok: false, error: 'No scan telemetry artifacts found on disk.' },
        { status: 404 },
      );
    }
    if (result.status === 'error') {
      return NextResponse.json(
        {
          ok: false,
          error: `Internal Telemetry Ingestion Failure: ${result.message}`,
        },
        { status: 500 },
      );
    }

    const data = result.data;
    const summary = data.summary;

    // --- Resolve latest weekly dossier (NON-BLOCKING cross-artifact join) ---
    // reorder/overstock/vendor/node metrics live in the dossier, not the margin
    // scan. A missing/errored dossier must NOT 404 or throw — it degrades to
    // 0 / [] with dossierFile = null. Only a missing margin scan (above) 404s.
    let dossier: DossierArtifact | null = null;
    let dossierFile: string | null = null;
    try {
      const dossierResult = await loadLatestArtifact<DossierArtifact>(
        'forward-intel',
        'weekly-dossier-',
      );
      if (dossierResult.status === 'ok') {
        dossier = dossierResult.data;
        dossierFile = dossierResult.sourceFile;
      }
    } catch {
      // Best-effort join: any dossier read failure leaves telemetry at fallback.
      dossier = null;
      dossierFile = null;
    }

    // marginCritical -> array of records (defensive).
    const marginCriticalItems: Array<Record<string, unknown>> = Array.isArray(
    data.marginCritical,
  )
    ? (data.marginCritical.filter(
        (it: any) =>
          typeof it === 'object' &&
          it !== null &&
          Number(it.quantityAvailable ?? it.quantity ?? it.qty ?? it.stockOnHand ?? 0) > 0,
      ) as Array<Record<string, unknown>>)
    : [];

    // --- Dossier-derived counts (real fields -> summary -> 0) ---
    // Verified against frontend/lib/pipeline/dossier-synthesizer.ts:
    //   reorderWatch.totalReorder / reorderWatch.totalOverstock
    //   vendorRankings.totalVendors
    const reorderWatchCount = numberOr(
      dossier?.reorderWatch?.totalReorder,
      numberOr(summary?.totalReorder, 0),
    );
    const overstockCount = numberOr(
      dossier?.reorderWatch?.totalOverstock,
      numberOr(summary?.totalOverstock, 0),
    );
    const activeVendorsCount = numberOr(
      dossier?.vendorRankings?.totalVendors,
      numberOr(summary?.totalVendors, 0),
    );

    // --- Telemetry (margin scan for SKU/margin, dossier for reorder/vendor) ---
   const telemetry = {
  totalSkusAnalyzed: numberOr(
    summary?.skusAnalyzed,
    numberOr(data.skusAnalyzed, 0),
  ),
  marginCriticalCount: marginCriticalItems.length,
  reorderWatchCount,
  overstockCount,
  activeVendorsCount,
};
    // --- Nodes: prefer live dossier nodeComparison, else margin-scan
    // catalogPulls, else empty. Existing consumers saw [] here (catalogPulls is
    // absent from the margin scan), so surfacing the dossier breakdown is
    // additive and does not remove any previously-present field. ---
    const dossierNodes: Array<Record<string, unknown>> = Array.isArray(
      dossier?.nodeComparison,
    )
      ? (dossier?.nodeComparison as unknown[]).filter(
          (it): it is Record<string, unknown> =>
            typeof it === 'object' && it !== null,
        )
      : [];
    const nodes =
      dossierNodes.length > 0
        ? dossierNodes.map((n) => ({
            nodeId: n['nodeId'] ?? null,
            totalSKUs: numberOr(n['totalSKUs'], 0),
            reorderCount: numberOr(n['reorderCount'], 0),
            overstockCount: numberOr(n['overstockCount'], 0),
          }))
        : Array.isArray(data.catalogPulls)
          ? data.catalogPulls
          : [];

    // --- Optional query params: node filter + limit clamp ---
    const { searchParams } = new URL(request.url);
    const nodeFilter = searchParams.get('node');
    const limitRaw = searchParams.get('limit');
    const limit = Math.min(parseInt(limitRaw ?? '', 10) || 50, 200);

    let filtered = marginCriticalItems.filter(
      (it: any) => Number(it.quantityAvailable ?? it.quantity ?? it.qty ?? it.stockOnHand ?? 0) > 0
    );
    if (nodeFilter && nodeFilter.trim().length > 0) {
      filtered = filtered.filter(
        (it) => String(it['node'] ?? '') === nodeFilter,
      );
    }
    const limited = filtered.slice(0, limit);

    const marginCriticalSample = limited.map((it) => ({
      node: it['node'] ?? null,
      product: productLabel(it),
      category: it['category'] ?? null,
      cost: it['unitCost'] ?? null,
      price: it['recPrice'] ?? null,
      marginPct: `${it['grossMarginPct'] ?? ''}%`,
      status: it['label'] ?? null,
    }));

    return NextResponse.json(
      {
        ok: true,
        service: SERVICE_NAME,
        timestamp: new Date().toISOString(),
        artifactFile: result.sourceFile,
        dossierFile,
        telemetry,
        nodes,
        marginCriticalSample,
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `Internal Telemetry Ingestion Failure: ${message}` },
      { status: 500 },
    );
  }
}
