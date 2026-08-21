import type { VendorScorecard } from '@/lib/types';
import { fmtPct, fmtDays, fmtNumber, fmtScore } from '@/lib/format';

/** Vendor leaderboard table. Composite = 60% margin + 40% inverted velocity. */
export default function VendorTable({ rows }: { rows: VendorScorecard[] }) {
  if (rows.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-sm text-mik-muted">
        No vendors in this bracket.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="mik-th">#</th>
            <th className="mik-th">Vendor</th>
            <th className="mik-th text-right">Composite</th>
            <th className="mik-th text-right">Avg Margin</th>
            <th className="mik-th text-right">Avg Days-on-Hand</th>
            <th className="mik-th text-right">SKUs</th>
            <th className="mik-th text-right">Dead</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.vendorId} className="mik-row">
              <td className="mik-td text-mik-faint">{v.rank}</td>
              <td className="mik-td font-medium">{v.vendorName}</td>
              <td className="mik-td text-right font-semibold text-mik-accent">
                {fmtScore(v.compositeScore)}
              </td>
              <td className="mik-td text-right">{fmtPct(v.avgGrossMarginPct)}</td>
              <td className="mik-td text-right">{fmtDays(v.avgDaysOnHand)}</td>
              <td className="mik-td text-right">{fmtNumber(v.skuCount)}</td>
              <td className="mik-td text-right">
                {v.deadStockCount > 0 ? (
                  <span className="text-tier-t2">{v.deadStockCount}</span>
                ) : (
                  fmtNumber(v.deadStockCount)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
