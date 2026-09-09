/**
 * CRON_SECRET-protected competitor-sweep route.
 *
 * ARCHITECTURAL DECISION (Railway frontend-only build root) — APPROACH (a):
 * -----------------------------------------------------------------------
 * Railway's build/deploy root for this project is `frontend/` ONLY. The
 * repo-root `modules/` and `scripts/` directories do NOT exist in the deployed
 * container. Therefore this route does NOT shell out to
 * scripts/run-competitor-sweep.ts and does NOT import repo-root modules.
 *
 * Instead, the competitor-sweep pipeline (public storefront fetch + product
 * extraction + persistence) has been ported into
 * `frontend/lib/pipeline/competitor-sweep.ts` so the route is FULLY
 * SELF-CONTAINED within `frontend/`. The sweep JSON is written into
 * `frontend/data/competitor-sweeps/` (what Railway serves and what
 * frontend/lib/data-loader.ts#loadLatestSweep reads first), and best-effort
 * mirrored to the repo-root `data/competitor-sweeps/` for local dev.
 *
 * This mirrors the existing /api/cron/dossier route exactly.
 *
 * SECURITY:
 *   - Requires a secret via `Authorization: Bearer <CRON_SECRET>` or the
 *     `x-cron-secret: <CRON_SECRET>` header, compared against
 *     process.env.CRON_SECRET using a constant-time comparison.
 *   - FAILS CLOSED: if CRON_SECRET is not configured, every request is
 *     rejected (500) — never open access. No secret is ever hardcoded/logged.
 *
 * TRIGGERING (configure a scheduler to hit this endpoint):
 *   GET  or  POST   /api/cron/competitor-sweep
 *   Header:  Authorization: Bearer $CRON_SECRET   (or  x-cron-secret: $CRON_SECRET)
 */

import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { refreshCompetitorSweep } from '@/lib/pipeline/competitor-sweep';

// Never statically cached — this performs a live sweep.
export const dynamic = 'force-dynamic';
// Pipeline does network I/O + file writes; ensure the Node.js runtime.
export const runtime = 'nodejs';
// Allow a generous window for several target fetches + retries.
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
    const result = await refreshCompetitorSweep();
    const { sweep } = result;
    return NextResponse.json(
      {
        ok: result.ok,
        timestamp: result.timestamp,
        sweepPath: result.sweepPaths[0] ?? null,
        sweepPaths: result.sweepPaths,
        summary: {
          sweepId: sweep.sweepId,
          targetCount: sweep.targetCount,
          successCount: sweep.successCount,
          failureCount: sweep.failureCount,
          productCount: sweep.snapshots.reduce(
            (n, s) => n + s.products.length,
            0,
          ),
        },
      },
      // 200 even when a target partially failed (result.ok=false) — the sweep
      // completed and was persisted; the body reports the degradation.
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Competitor sweep failed: ${
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
