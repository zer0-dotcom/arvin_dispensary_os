import {
  Boxes,
  PackageX,
  TrendingDown,
  AlertTriangle,
  Skull,
} from 'lucide-react';
import { loadLatestDossier } from '@/lib/data-loader';
import { isDossierEmpty, EMPTY_REASON } from '@/lib/empty-state';
import StatCard from '@/components/StatCard';
import EmptyState from '@/components/EmptyState';
import DataStamp from '@/components/DataStamp';
import { AlertBanner } from '@/components/AlertBanner';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const res = await loadLatestDossier();

  if (res.status === 'missing') {
    return (
      <div>
        <h1 className="mb-5 text-lg font-semibold">Overview</h1>
        <EmptyState
          variant="missing"
          title="No weekly dossier yet"
          detail="Run `npm run weekly-dossier` in the backend to populate the data layer."
        />
      </div>
    );
  }

  if (res.status === 'error') {
    return (
      <div>
        <h1 className="mb-5 text-lg font-semibold">Overview</h1>
        <AlertBanner tier="TIER_2" message={res.message} />
        <EmptyState
          variant="error"
          title="Latest dossier could not be parsed"
          detail={res.message}
        />
      </div>
    );
  }

  const d = res.data;
  const empty = isDossierEmpty(d);
  const ih = d.inventoryHealth;
  const topVendor = d.vendorRankings.top3[0];

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Overview</h1>
      </div>

      {empty ? (
        <AlertBanner tier="TIER_2" message={`Degraded — ${EMPTY_REASON}`} />
      ) : null}

      {/* Inventory health KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="SKUs Analyzed"
          value={ih.skusAnalyzed}
          accent="green"
          icon={<Boxes size={16} />}
        />
        <StatCard
          label="Skipped (no cost)"
          value={ih.skusSkippedNoCost}
          hint="COGS guard"
          icon={<PackageX size={16} />}
        />
        <StatCard
          label="Margin Warnings"
          value={ih.marginWarningCount}
          accent={ih.marginWarningCount > 0 ? 'amber' : 'default'}
          icon={<TrendingDown size={16} />}
        />
        <StatCard
          label="Margin Critical"
          value={ih.marginCriticalCount}
          accent={ih.marginCriticalCount > 0 ? 'red' : 'default'}
          icon={<AlertTriangle size={16} />}
        />
        <StatCard
          label="Dead Stock"
          value={ih.deadStockCount}
          accent={ih.deadStockCount > 0 ? 'amber' : 'default'}
          icon={<Skull size={16} />}
        />
      </div>

      {/* Reorder + vendor snapshot */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="mik-card">
          <h2 className="mb-3 text-sm font-semibold text-mik-muted">
            Reorder Watch
          </h2>
          <div className="flex gap-8">
            <div>
              <div className="text-2xl font-semibold text-mik-accent">
                {d.reorderWatch.totalReorder}
              </div>
              <div className="text-xs text-mik-faint">Reorder</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-tier-t2">
                {d.reorderWatch.totalOverstock}
              </div>
              <div className="text-xs text-mik-faint">Overstock</div>
            </div>
          </div>
        </div>

        <div className="mik-card">
          <h2 className="mb-3 text-sm font-semibold text-mik-muted">
            Top Vendor
          </h2>
          {topVendor ? (
            <div>
              <div className="text-lg font-semibold">{topVendor.vendorName}</div>
              <div className="text-xs text-mik-faint">
                Composite {topVendor.compositeScore.toFixed(1)} ·{' '}
                {topVendor.avgGrossMarginPct.toFixed(1)}% margin ·{' '}
                {topVendor.skuCount} SKUs
              </div>
            </div>
          ) : (
            <div className="text-sm text-mik-muted">No vendor data.</div>
          )}
        </div>
      </div>

      {/* Node comparison */}
      <div className="mt-4 mik-card">
        <h2 className="mb-3 text-sm font-semibold text-mik-muted">
          Node Comparison
        </h2>
        {d.nodeComparison.length === 0 ? (
          <div className="py-4 text-sm text-mik-muted">
            No per-node data in this run.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="mik-th">Node</th>
                  <th className="mik-th text-right">Total SKUs</th>
                  <th className="mik-th text-right">Reorder</th>
                  <th className="mik-th text-right">Overstock</th>
                </tr>
              </thead>
              <tbody>
                {d.nodeComparison.map((n) => (
                  <tr key={n.nodeId} className="mik-row">
                    <td className="mik-td font-medium">{n.nodeId}</td>
                    <td className="mik-td text-right">{n.totalSKUs}</td>
                    <td className="mik-td text-right text-mik-accent">
                      {n.reorderCount}
                    </td>
                    <td className="mik-td text-right text-tier-t2">
                      {n.overstockCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DataStamp
        generatedAt={d.generatedAt}
        sourceFile={res.sourceFile}
        loadedAt={res.loadedAt}
      />
    </div>
  );
}
