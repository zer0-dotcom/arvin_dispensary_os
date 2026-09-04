/**
 * CRON_SECRET-protected dossier refresh route.
 *
 * ARCHITECTURAL DECISION (Railway frontend-only build root) — APPROACH (a):
 * -----------------------------------------------------------------------
 * Railway's build/deploy root for this project is `frontend/` ONLY. The
 * repo-root `modules/` and `scripts/` directories do NOT exist in the deployed
 * container, and `experimental.externalDir` only resolves them in local /
 * monorepo dev — never in the standalone Railway build. Therefore this route
 * does NOT shell out to scripts/run-weekly-dossier.ts and does NOT import
 * repo-root pipeline modules.
 *
 * Instead, the minimal necessary pipeline (read-only Dutchie fetch + margin
 * scan + demand forecast + vendor scorecards + dossier synthesis) has been
 * ported into `frontend/lib/pipeline/**` so the route is FULLY SELF-CONTAINED
 * within `frontend/` and works correctly when deployed standalone on Railway.
 * The refreshed dossier JSON is written into `frontend/data/forward-intel/`
 * (what Railway serves and what frontend/lib/data-loader.ts reads first), and
 * best-effort mirrored to the repo-root `data/forward-intel/` for local dev.
 *
 * SECURITY:
 *   - Requires a secret supplied via `Authorization: Bearer <CRON_SECRET>` or
 *     the `x-cron-secret: <CRON_SECRET>` header, compared against
 *     process.env.CRON_SECRET using a constant-time comparison.
 *   - FAILS CLOSED: if CRON_SECRET is not configured in the environment, every
 *     request is rejected (500) — never open access.
 *   - No secret value is ever hardcoded or logged.
 *
 * TRIGGERING (configure a scheduler — Railway cron, GitHub Actions,
 * cron-job.org, etc. — to hit this endpoint):
 *   GET  or  POST   /api/cron/dossier
 *   Header:  Authorization: Bearer $CRON_SECRET      (or  x-cron-secret: $CRON_SECRET)
 */

import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { refreshDossier } from '@/lib/pipeline/refresh-dossier';

// Never statically cached — this performs a live pipeline run.
export const dynamic = 'force-dynamic';
// Pipeline does network I/O + file writes; ensure the Node.js runtime.
export const runtime = 'nodejs';
// Allow a generous window for two catalog pulls + synthesis.
export const maxDuration = 60;

/** Constant-time string compare that never throws on length mismatch. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Extract the presented secret from either supported header. */
function extractProvidedSecret(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  const custom = req.headers.get('x-cron-secret');
  if (custom && custom.trim().length > 0) {
    return custom.trim();
  }
  return null;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const expected = process.env['CRON_SECRET'];

  // Fail closed if the secret is not configured at all.
  if (!expected || expected.trim().length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'CRON_SECRET is not configured on the server. Set it in the deployment environment.',
      },
      { status: 500 },
    );
  }

  const provided = extractProvidedSecret(req);
  if (!provided || !secretsMatch(provided, expected.trim())) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized: missing or invalid cron secret.' },
      { status: 401 },
    );
  }

  try {
    const result = await refreshDossier();
    return NextResponse.json(
      {
        ok: result.ok,
        timestamp: result.timestamp,
        dossierPath: result.dossierPaths[0] ?? null,
        dossierPaths: result.dossierPaths,
        marginScanPaths: result.marginScanPaths,
        catalogPulls: result.catalogPulls,
        summary: {
          skusAnalyzed: result.dossier.inventoryHealth.skusAnalyzed,
          marginCritical: result.dossier.inventoryHealth.marginCriticalCount,
          deadStock: result.dossier.inventoryHealth.deadStockCount,
          totalReorder: result.dossier.reorderWatch.totalReorder,
          totalOverstock: result.dossier.reorderWatch.totalOverstock,
          totalVendors: result.dossier.vendorRankings.totalVendors,
        },
      },
      // 200 even when a node pull partially failed (result.ok=false) — the run
      // completed and a dossier was persisted; the body reports the degradation.
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Dossier refresh failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 },
    );
  }
}

/** Many cron providers issue GET; support it as the primary verb. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

/** POST is also supported for providers that trigger actions via POST. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
