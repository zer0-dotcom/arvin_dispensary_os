import { loadLatestSweep } from '@/lib/data-loader';
import { isSweepEmpty } from '@/lib/empty-state';
import EmptyState from '@/components/EmptyState';
import DataStamp from '@/components/DataStamp';
import { AlertBanner } from '@/components/AlertBanner';
import StatCard from '@/components/StatCard';
import CompetitorTable from '@/components/tables/CompetitorTable';

export const dynamic = 'force-dynamic';

export default async function CompetitorsPage() {
  const res = await loadLatestSweep();

  if (res.status === 'missing') {
    return (
      <div>
        <h1 className="mb-5 text-lg font-semibold">Competitor Radar</h1>
        <EmptyState
          variant="missing"
          title="No competitor sweep yet"
          detail="Run `npm run competitor-sweep` in the backend to populate this view."
        />
      </div>
    );
  }

  if (res.status === 'error') {
    return (
      <div>
        <h1 className="mb-5 text-lg font-semibold">Competitor Radar</h1>
        <AlertBanner tier="TIER_2" message={res.message} />
        <EmptyState variant="error" title="Sweep could not be parsed" detail={res.message} />
      </div>
    );
  }

  const s = res.data;
  const empty = isSweepEmpty(s);

  return (
    <div>
      <h1 className="mb-5 text-lg font-semibold">Competitor Radar</h1>

      {s.failureCount > 0 ? (
        <AlertBanner
          tier="TIER_2"
          message={`${s.failureCount} of ${s.targetCount} targets failed during the last sweep.`}
        />
      ) : null}

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Targets" value={s.targetCount} />
        <StatCard
          label="Succeeded"
          value={s.successCount}
          accent={s.successCount > 0 ? 'green' : 'default'}
        />
        <StatCard
          label="Failed"
          value={s.failureCount}
          accent={s.failureCount > 0 ? 'amber' : 'default'}
        />
      </div>

      {empty ? (
        <div className="mt-6">
          <EmptyState
            variant="empty"
            title="Sweep completed, but no products were extracted"
            detail="All targets were unreachable or returned no menu data during this run."
          />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {s.snapshots.map((snap) => (
            <CompetitorTable key={snap.dispensarySlug} snapshot={snap} />
          ))}
        </div>
      )}

      <DataStamp
        generatedAt={s.finishedAt}
        sourceFile={res.sourceFile}
        loadedAt={res.loadedAt}
      />
    </div>
  );
}
