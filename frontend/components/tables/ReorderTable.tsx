import type { ReorderAlert } from '@/lib/types';
import { fmtDays, fmtNumber, fmtCurrency } from '@/lib/format';

/** Reorder / overstock table. `variant` only affects the trigger pill color. */
export default function ReorderTable({
  rows,
  emptyLabel = 'No items.',
}: {
  rows: ReorderAlert[];
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
            <th className="mik-th">Product</th>
            <th className="mik-th">Vendor</th>
            <th className="mik-th text-right">Qty</th>
            <th className="mik-th text-right">Days-on-Hand</th>
            <th className="mik-th text-right">Unit Cost</th>
            <th className="mik-th">Trigger</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.productId}-${r.triggerType}`} className="mik-row">
              <td className="mik-td font-medium">{r.name}</td>
              <td className="mik-td text-mik-muted">{r.vendorName}</td>
              <td className="mik-td text-right">
                {fmtNumber(r.quantityAvailable)}
              </td>
              <td className="mik-td text-right">{fmtDays(r.daysOnHand)}</td>
              <td className="mik-td text-right">{fmtCurrency(r.unitCost)}</td>
              <td className="mik-td">
                <span
                  className={[
                    'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                    r.triggerType === 'REORDER'
                      ? 'border-mik-accent/40 bg-mik-accentSoft text-mik-accent'
                      : 'border-tier-t2/40 bg-tier-t2bg text-tier-t2',
                  ].join(' ')}
                >
                  {r.triggerType}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
