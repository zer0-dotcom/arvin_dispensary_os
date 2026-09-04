/**
 * Dossier refresh orchestrator (self-contained, Railway-safe).
 *
 * This is the runtime the CRON_SECRET-protected route invokes. It reproduces
 * the essential pipeline of scripts/run-weekly-dossier.ts entirely inside
 * `frontend/lib/` so it works in Railway's frontend-only deploy (no repo-root
 * modules/ or scripts/ are reachable there):
 *
 *   1. Pull each node's catalog (Promise.allSettled — partial-tolerant).
 *   2. Margin scan (combined), demand forecast (per node), vendor scorecards.
 *   3. Synthesize the weekly dossier.
 *   4. PERSIST BEFORE returning any summary — dual-write:
 *        - frontend/data/forward-intel/   (cwd; what Railway serves)
 *        - ../data/forward-intel/          (repo-root; best-effort, local dev)
 *      The margin scan is ALSO persisted to data/margin-scans/ so the /margins
 *      page and the MiK copilot stay fresh off the same run.
 *
 * Read-only end to end. No price changes, no auto-actions, no outbound sends.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  ALL_STORE_NODES,
  STORE_NODE_INFO,
  StoreNode,
  type DutchieProduct,
} from './types';
import { FrontendDutchieReadOnlyClient } from './dutchie-client';
import {
  analyzeInventory,
  type MarginScanResult,
  type NodeInventoryItem,
} from './margin-scanner';
import { runDemandForecast } from './demand-forecaster';
import { buildVendorScorecards } from './vendor-scorecard';
import { synthesizeDossier, type WeeklyDossier } from './dossier-synthesizer';

export interface CatalogPullNote {
  readonly node: StoreNode;
  readonly displayName: string;
  readonly ok: boolean;
  readonly productCount: number;
  readonly detail?: string;
}

export interface RefreshDossierResult {
  readonly ok: boolean;
  readonly timestamp: string;
  readonly dossier: WeeklyDossier;
  readonly dossierPaths: string[];
  readonly marginScanPaths: string[];
  readonly catalogPulls: CatalogPullNote[];
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
 * Write `payload` as `<subdir>/<name>-<ts>.json` under every data root that we
 * can successfully write to. The first (cwd) write is required; parent-root
 * mirroring is best-effort and never fatal. Returns the paths actually written.
 */
async function dualWrite(
  subdir: string,
  name: string,
  ts: number,
  payload: unknown,
): Promise<string[]> {
  const written: string[] = [];
  const json = JSON.stringify(payload, null, 2);

  for (const root of dataRootCandidates()) {
    const dir = join(root, 'data', subdir);
    try {
      await mkdir(dir, { recursive: true });
      const filePath = join(dir, `${name}-${ts}.json`);
      await writeFile(filePath, json, 'utf8');
      written.push(filePath);
    } catch {
      // Best-effort: a non-writable parent root in production is expected.
    }
  }
  return written;
}

async function loadPerNodeCatalog(
  client: FrontendDutchieReadOnlyClient,
): Promise<{
  perNode: Array<{ node: StoreNode; products: DutchieProduct[] }>;
  notes: CatalogPullNote[];
}> {
  const settled = await Promise.allSettled(
    ALL_STORE_NODES.map((node) => client.getProducts(node)),
  );

  const perNode: Array<{ node: StoreNode; products: DutchieProduct[] }> = [];
  const notes: CatalogPullNote[] = [];

  settled.forEach((outcome, index) => {
    const node = ALL_STORE_NODES[index] ?? StoreNode.NODE_5TH_AVE;
    const displayName = STORE_NODE_INFO[node].displayName;
    if (outcome.status === 'fulfilled') {
      perNode.push({ node, products: outcome.value });
      notes.push({
        node,
        displayName,
        ok: true,
        productCount: outcome.value.length,
      });
    } else {
      notes.push({
        node,
        displayName,
        ok: false,
        productCount: 0,
        detail:
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason),
      });
    }
  });

  return { perNode, notes };
}

/**
 * Run the full inventory audit + dossier refresh. Throws only for a hard
 * failure that prevents producing a dossier (e.g. missing credentials); the
 * route maps that to a 500. Individual node pull failures are tolerated and
 * reported in `catalogPulls`.
 */
export async function refreshDossier(now: Date = new Date()): Promise<RefreshDossierResult> {
  // Credentials resolved from env (throws with a clear, secret-free message).
  const client = FrontendDutchieReadOnlyClient.fromEnv();

  const { perNode, notes } = await loadPerNodeCatalog(client);

  const combinedInventory: NodeInventoryItem[] = perNode.flatMap(
    ({ node, products }) => products.map((product) => ({ node, product })),
  );
  const combinedCatalog: DutchieProduct[] = perNode.flatMap(
    ({ products }) => products,
  );

  const marginScan: MarginScanResult = analyzeInventory(combinedInventory, now);
  const forecasts = perNode.map(({ node, products }) =>
    runDemandForecast(products, node, 7, 45, now),
  );
  const scorecards = buildVendorScorecards(combinedCatalog, now);
  const dossier = synthesizeDossier(marginScan, forecasts, scorecards, now);

  const ts = now.getTime();
  // Persist FIRST — before returning any summary (hard rule).
  const dossierPaths = await dualWrite('forward-intel', 'weekly-dossier', ts, dossier);
  const marginScanPaths = await dualWrite('margin-scans', 'margin-scan', ts, marginScan);

  const allNodesOk = notes.every((n) => n.ok);

  return {
    ok: allNodesOk,
    timestamp: now.toISOString(),
    dossier,
    dossierPaths,
    marginScanPaths,
    catalogPulls: notes,
  };
}
