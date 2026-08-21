import { loadLatestMarginScan } from '@/lib/data-loader';
import { isMarginScanEmpty, EMPTY_REASON } from '@/lib/empty-state';
import EmptyState from '@/components/EmptyState';
import DataStamp from '@/components/DataStamp';
import { AlertBanner } from '@/components/AlertBanner';
import StatCard from '@/components/StatCard';
import { MarginFlagTable, DeadStockTable } from '@/components/tables/MarginTable';

export const dynamic = 'force-dynamic';

export default async function MarginsPage() {
  const res = await loadLatestMarginScan();

  if (res.status === 'missing') {
    return (
      <div>
        <h1 className="mb-5 text-lg font-semibold">Margins &amp; Dead Stock</h1>
        <EmptyState
          variant="missing"
          title="No margin scan yet"
          detail="Run `npm run margin-scan` in the backend to populate this view."
        />
      </div>
    );
  }

  if (res.status === 'error') {
    return (
      <div>
        <h1 className="mb-5 text-lg font-semibold">Margins &amp; Dead Stock</h1>
        <AlertBanner tier="TIER_2" message={res.message} />
        <EmptyState variant="error" title="Margin scan could not be parsed" detail={res.message} />
      </div>
    );
  }

  const m = res.data;
  const empty = isMarginScanEmpty(m);

  return (
    <div>
      <h1 className="mb-5 text-lg font-semibold">Margins &amp; Dead Stock</h1>

      {empty ? (
        <AlertBanner tier="TIER_2" message={`Degraded — ${EMPTY_REASON}`} />
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="SKUs Analyzed" value={m.skusAnalyzed} accent="green" />
        <StatCard label="Skipped (no cost)" value={m.skusSkippedNoCost} hint="COGS guard" />
        <StatCard
          label="Warnings"
          value={m.marginWarnings.length}
          accent={m.marginWarnings.length > 0 ? 'amber' : 'default'}
        />
        <StatCard
          label="Critical"
          value={m.marginCritical.length}
          accent={m.marginCritical.length > 0 ? 'red' : 'default'}
        />
      </div>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-tier-t3">
          Margin Critical (&lt; 20%)
        </h2>
        <div className="mik-card">
          <MarginFlagTable rows={m.marginCritical} emptyLabel="No critical-margin SKUs." />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-tier-t2">
          Margin Warnings (&lt; 35%)
        </h2>
        <div className="mik-card">
          <MarginFlagTable rows={m.marginWarnings} emptyLabel="No margin-warning SKUs." />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-mik-muted">
          Dead-Stock Candidates
        </h2>
        <div className="mik-card">
          <DeadStockTable rows={m.deadStockCandidates} />
        </div>
      </section>

      <DataStamp
        generatedAt={m.finishedAt}
        sourceFile={res.sourceFile}
        loadedAt={res.loadedAt}
      />
    </div>
  );
}
