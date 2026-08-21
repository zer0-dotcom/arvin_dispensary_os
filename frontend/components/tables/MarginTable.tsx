import type { MarginFlag, DeadStockFlag } from '@/lib/types';
import { fmtPct, fmtCurrency, fmtNumber, fmtDays } from '@/lib/format';
import { TierBadge, type Tier } from '@/components/AlertBanner';

/** Margin warnings / critical table. */
export function MarginFlagTable({
  rows,
  emptyLabel = 'No flagged SKUs.',
}: {
  rows: MarginFlag[];
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-sm text-mik-muted">
        {emptyLabel}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="mik-th">Node</th>
            <th className="mik-th">Product</th>
            <th className="mik-th">Category</th>
            <th className="mik-th text-right">Qty</th>
            <th className="mik-th text-right">Unit Cost</th>
            <th className="mik-th text-right">Rec Price</th>
            <th className="mik-th text-right">Gross Margin</th>
            <th className="mik-th">Tier</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={`${m.node}-${m.productName}-${i}`} className="mik-row">
              <td className="mik-td text-mik-muted">{m.node}</td>
              <td className="mik-td font-medium">{m.productName}</td>
              <td className="mik-td text-mik-muted">{m.category ?? '—'}</td>
              <td className="mik-td text-right">
                {fmtNumber(m.quantityAvailable)}
              </td>
              <td className="mik-td text-right">{fmtCurrency(m.unitCost)}</td>
              <td className="mik-td text-right">{fmtCurrency(m.recPrice)}</td>
              <td
                className={[
                  'mik-td text-right font-semibold',
                  m.label === 'MARGIN_CRITICAL'
                    ? 'text-tier-t3'
                    : 'text-tier-t2',
                ].join(' ')}
              >
                {fmtPct(m.grossMarginPct)}
              </td>
              <td className="mik-td">
                <TierBadge tier={m.alertTier as Tier} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Dead-stock candidate table. Carries the KNOWN LIMITATION caveat tooltip. */
export function DeadStockTable({
  rows,
  emptyLabel = 'No dead-stock candidates.',
}: {
  rows: DeadStockFlag[];
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-sm text-mik-muted">
        {emptyLabel}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="mik-th">Node</th>
            <th className="mik-th">Product</th>
            <th className="mik-th">Category</th>
            <th className="mik-th text-right">Qty</th>
            <th className="mik-th text-right">
              <span
                title="PROXY METRIC: derived from lastModifiedDateUTC (last catalog modification), NOT true last-sale date. The /products endpoint exposes no sales-velocity data. Treat as an approximation."
                className="cursor-help border-b border-dotted border-mik-faint"
              >
                Days Since Modified*
              </span>
            </th>
            <th className="mik-th">Tier</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d, i) => (
            <tr key={`${d.node}-${d.productName}-${i}`} className="mik-row">
              <td className="mik-td text-mik-muted">{d.node}</td>
              <td className="mik-td font-medium">{d.productName}</td>
              <td className="mik-td text-mik-muted">{d.category ?? '—'}</td>
              <td className="mik-td text-right">
                {fmtNumber(d.quantityAvailable)}
              </td>
              <td className="mik-td text-right">
                {d.daysSinceLastModified === null
                  ? 'never modified'
                  : fmtDays(d.daysSinceLastModified)}
              </td>
              <td className="mik-td">
                <TierBadge tier={d.alertTier as Tier} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 pt-2 text-[11px] text-mik-faint">
        * Proxy metric — derived from <code>lastModifiedDateUTC</code> (catalog
        modification), not true last-sale. A dedicated sales-velocity endpoint
        would provide true days-since-sold.
      </p>
    </div>
  );
}
