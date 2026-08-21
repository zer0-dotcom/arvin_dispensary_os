import type { CompetitorSnapshot } from '@/lib/types';
import { fmtCurrency, fmtDateTime } from '@/lib/format';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

/**
 * One card per competitor target. A failed target (ok:false) renders a degraded
 * card surfacing `note` — never an empty/misleading product grid.
 */
export default function CompetitorTable({
  snapshot,
}: {
  snapshot: CompetitorSnapshot;
}) {
  return (
    <div className="mik-card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-mik-text">
            {snapshot.dispensarySlug}
          </div>
          <div className="truncate text-xs text-mik-faint">
            {snapshot.target}
          </div>
        </div>
        {snapshot.ok ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded border border-mik-accent/40 bg-mik-accentSoft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-mik-accent">
            <CheckCircle2 size={12} /> OK
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded border border-tier-t2/40 bg-tier-t2bg px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-tier-t2">
            <AlertTriangle size={12} /> Failed
          </span>
        )}
      </div>

      {!snapshot.ok ? (
        <div className="rounded-md border border-tier-t2/30 bg-tier-t2bg/40 px-3 py-2 text-xs text-tier-t2">
          {snapshot.note ?? 'Target unreachable during this sweep.'}
        </div>
      ) : snapshot.products.length === 0 ? (
        <div className="px-1 py-2 text-xs text-mik-muted">
          No products extracted{snapshot.note ? ` — ${snapshot.note}` : '.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="mik-th">Product</th>
                <th className="mik-th">Category</th>
                <th className="mik-th text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.products.slice(0, 50).map((p, i) => (
                <tr key={`${p.name}-${i}`} className="mik-row">
                  <td className="mik-td font-medium">{p.name}</td>
                  <td className="mik-td text-mik-muted">{p.category ?? '—'}</td>
                  <td className="mik-td text-right">{fmtCurrency(p.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {snapshot.products.length > 50 ? (
            <p className="px-3 pt-2 text-[11px] text-mik-faint">
              Showing first 50 of {snapshot.products.length} products.
            </p>
          ) : null}
        </div>
      )}

      <div className="mt-3 text-[11px] text-mik-faint">
        Fetched: {fmtDateTime(snapshot.fetchedAt)}
      </div>
    </div>
  );
}
