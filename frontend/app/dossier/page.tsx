import { loadLatestDossier } from '@/lib/data-loader';
import { isDossierEmpty, EMPTY_REASON } from '@/lib/empty-state';
import EmptyState from '@/components/EmptyState';
import DataStamp from '@/components/DataStamp';
import { AlertBanner } from '@/components/AlertBanner';
import ReorderTable from '@/components/tables/ReorderTable';
import VendorTable from '@/components/tables/VendorTable';
import NodeCompareChart from '@/components/NodeCompareChart';

export const dynamic = 'force-dynamic';

export default async function DossierPage() {
  const res = await loadLatestDossier();

  if (res.status === 'missing') {
    return (
      <div>
        <h1 className="mb-5 text-lg font-semibold">Forward Intelligence</h1>
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
        <h1 className="mb-5 text-lg font-semibold">Forward Intelligence</h1>
        <AlertBanner tier="TIER_2" message={res.message} />
        <EmptyState variant="error" title="Dossier could not be parsed" detail={res.message} />
      </div>
    );
  }

  const d = res.data;
  const empty = isDossierEmpty(d);

  return (
    <div>
      <h1 className="mb-5 text-lg font-semibold">Forward Intelligence</h1>

      {empty ? (
        <>
          <AlertBanner tier="TIER_2" message={`Degraded — ${EMPTY_REASON}`} />
          <EmptyState
            variant="empty"
            title="Dossier generated, but returned no records"
            detail={EMPTY_REASON}
          />
          <DataStamp
            generatedAt={d.generatedAt}
            sourceFile={res.sourceFile}
            loadedAt={res.loadedAt}
          />
        </>
      ) : (
        <>
          {/* Reorder Watch */}
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-mik-muted">
              Reorder Watch — {d.reorderWatch.totalReorder} reorder /{' '}
              {d.reorderWatch.totalOverstock} overstock
            </h2>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="mik-card">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mik-accent">
                  Top Reorder
                </h3>
                <ReorderTable
                  rows={d.reorderWatch.topReorder}
                  emptyLabel="No reorder signals."
                />
              </div>
              <div className="mik-card">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-tier-t2">
                  Top Overstock
                </h3>
                <ReorderTable
                  rows={d.reorderWatch.topOverstock}
                  emptyLabel="No overstock signals."
                />
              </div>
            </div>
          </section>

          {/* Vendor Rankings */}
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-mik-muted">
              Vendor Rankings — {d.vendorRankings.totalVendors} vendor(s)
            </h2>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="mik-card">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mik-accent">
                  Top 3
                </h3>
                <VendorTable rows={d.vendorRankings.top3} />
              </div>
              <div className="mik-card">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-tier-t3">
                  Bottom 3
                </h3>
                {d.vendorRankings.totalVendors <= 3 ? (
                  <p className="px-3 py-6 text-center text-sm text-mik-muted">
                    Bottom 3 intentionally empty — {d.vendorRankings.totalVendors}{' '}
                    vendor(s) already shown in Top 3 (mirrors backend, no
                    duplicate listing).
                  </p>
                ) : (
                  <VendorTable rows={d.vendorRankings.bottom3} />
                )}
              </div>
            </div>
          </section>

          {/* Node comparison chart */}
          <section className="mb-2">
            <h2 className="mb-2 text-sm font-semibold text-mik-muted">
              Node Comparison
            </h2>
            <div className="mik-card">
              {d.nodeComparison.length === 0 ? (
                <div className="py-6 text-center text-sm text-mik-muted">
                  No per-node data in this run.
                </div>
              ) : (
                <NodeCompareChart rows={d.nodeComparison} />
              )}
            </div>
          </section>

          <DataStamp
            generatedAt={d.generatedAt}
            sourceFile={res.sourceFile}
            loadedAt={res.loadedAt}
          />
        </>
      )}
    </div>
  );
}
