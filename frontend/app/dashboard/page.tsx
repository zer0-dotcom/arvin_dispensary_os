/**
 * Executive Intelligence Dashboard — /dashboard  (v1.3)
 *
 * Server component. Consumes the read-only telemetry contract at
 * GET /api/v1/intel (margin-scan + weekly-dossier join) over an internal HTTP
 * fetch, authenticating with the SAME env-only bearer the route accepts
 * (MIK_API_KEY or CRON_SECRET). The secret is read on the server and used only
 * in the fetch header — it is NEVER passed to a client component or the browser.
 * Only the already-resolved, non-sensitive JSON is handed down to the client
 * table/selector.
 *
 * If the API is unreachable, unauthorized, or has no artifact yet, the page
 * renders the canonical EmptyState fallback (Rule §1.3 — no fabricated numbers).
 */

import { headers } from 'next/headers';
import {
  Boxes,
  AlertOctagon,
  RefreshCw,
  PackageX,
  Truck,
} from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import DataStamp from '@/components/DataStamp';
import { AlertBanner } from '@/components/AlertBanner';
import StatCard from '@/components/StatCard';
import NodeSplitView, { type NodeRow } from '@/components/NodeSplitView';
import MarginLedgerTable, {
  type MarginLedgerRow,
} from '@/components/tables/MarginLedgerTable';
import { fmtNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Shape of the successful GET /api/v1/intel payload (see route.ts). */
interface IntelTelemetry {
  totalSkusAnalyzed: number;
  marginCriticalCount: number;
  reorderWatchCount: number;
  overstockCount: number;
  activeVendorsCount: number;
}

interface IntelResponse {
  ok: boolean;
  service?: string;
  timestamp?: string;
  artifactFile?: string;
  dossierFile?: string | null;
  telemetry?: IntelTelemetry;
  nodes?: NodeRow[];
  marginCriticalSample?: MarginLedgerRow[];
  error?: string;
}

type IntelFetch =
  | { ok: true; data: IntelResponse }
  | { ok: false; status: number; error: string };

/** Resolve the internal base URL from the incoming request headers. */
function resolveBaseUrl(): string {
  const h = headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto =
    h.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1')
      ? 'http'
      : 'https');
  return `${proto}://${host}`;
}

/** Server-side fetch of the telemetry endpoint with env-only bearer auth. */
async function fetchIntel(): Promise<IntelFetch> {
  const token = process.env['MIK_API_KEY'] ?? process.env['CRON_SECRET'];
  if (!token) {
    return {
      ok: false,
      status: 0,
      error:
        'Telemetry credential not configured (MIK_API_KEY / CRON_SECRET unset on the server).',
    };
  }

  try {
    const res = await fetch(`${resolveBaseUrl()}/api/v1/intel`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => null)) as IntelResponse | null;
    if (!res.ok || !data || data.ok === false) {
      return {
        ok: false,
        status: res.status,
        error: data?.error ?? `Telemetry endpoint returned HTTP ${res.status}.`,
      };
    }
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: message };
  }
}

export default async function DashboardPage() {
  const result = await fetchIntel();

  const heading = (
    <div className="mb-5">
      <h1 className="text-lg font-semibold">Executive Intelligence Dashboard</h1>
      <p className="mt-1 text-xs text-mik-muted">
        Live retail telemetry — margin scan &amp; forward-intel dossier join.
      </p>
    </div>
  );

  if (!result.ok) {
    const isAuth = result.status === 401 || result.status === 0;
    return (
      <div>
        {heading}
        <AlertBanner tier="TIER_2" message={`Telemetry unavailable — ${result.error}`} />
        <EmptyState
          variant={result.status === 404 ? 'missing' : 'error'}
          title={
            result.status === 404
              ? 'No telemetry artifact yet'
              : isAuth
                ? 'Telemetry endpoint unauthorized'
                : 'Telemetry endpoint unreachable'
          }
          detail={
            result.status === 404
              ? 'No margin-scan artifact has been generated yet. Trigger the dossier/scan pipeline (POST /api/cron/dossier with the CRON_SECRET bearer) and reload.'
              : isAuth
                ? 'The server-side telemetry credential (MIK_API_KEY or CRON_SECRET) is missing or does not match. Configure it in the deployment environment and reload.'
                : result.error
          }
        />
      </div>
    );
  }

  const { data } = result;
  const t: IntelTelemetry = data.telemetry ?? {
    totalSkusAnalyzed: 0,
    marginCriticalCount: 0,
    reorderWatchCount: 0,
    overstockCount: 0,
    activeVendorsCount: 0,
  };
  const nodes: NodeRow[] = Array.isArray(data.nodes) ? data.nodes : [];
  const ledger: MarginLedgerRow[] = Array.isArray(data.marginCriticalSample)
    ? data.marginCriticalSample
    : [];

  return (
    <div>
      {heading}

      {/* Executive Metric Ribbon */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Total SKUs Analyzed"
          value={fmtNumber(t.totalSkusAnalyzed)}
          accent="blue"
          icon={<Boxes size={16} />}
        />
        <StatCard
          label="Margin-Critical SKUs"
          value={fmtNumber(t.marginCriticalCount)}
          accent={t.marginCriticalCount > 0 ? 'red' : 'default'}
          icon={<AlertOctagon size={16} />}
          hint="< 20% gross margin"
        />
        <StatCard
          label="Reorder Watch"
          value={fmtNumber(t.reorderWatchCount)}
          accent={t.reorderWatchCount > 0 ? 'green' : 'default'}
          icon={<RefreshCw size={16} />}
        />
        <StatCard
          label="Overstock Backlog"
          value={fmtNumber(t.overstockCount)}
          accent={t.overstockCount > 0 ? 'amber' : 'default'}
          icon={<PackageX size={16} />}
        />
        <StatCard
          label="Active Vendor Network"
          value={fmtNumber(t.activeVendorsCount)}
          icon={<Truck size={16} />}
        />
      </div>

      {/* Multi-Node Selector / Split View */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-mik-text">
          Retail Node Comparison
        </h2>
        <NodeSplitView nodes={nodes} />
      </section>

      {/* Margin Anomaly Ledger */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-tier-t3">
          Margin Anomaly Ledger
        </h2>
        <MarginLedgerTable rows={ledger} />
      </section>

      <DataStamp
        generatedAt={data.timestamp}
        sourceFile={data.dossierFile ? `${data.artifactFile} + ${data.dossierFile}` : data.artifactFile}
      />
    </div>
  );
}
