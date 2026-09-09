'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { fmtCurrency } from '@/lib/format';

/**
 * One margin-anomaly row, exactly as emitted by GET /api/v1/intel
 * (`marginCriticalSample[]`). All fields are defensively nullable; `marginPct`
 * arrives as a formatted STRING (e.g. "10%", "-2624.27%").
 */
export interface MarginLedgerRow {
  node: string | null;
  product: string | null;
  category: string | null;
  cost: number | null;
  price: number | null;
  marginPct: string | null;
  status: string | null;
}

const PAGE_SIZE = 12;

/** Parse the "NN%" margin string to a number; null when unparseable. */
function parseMargin(raw: string | null): number | null {
  if (!raw) {
    return null;
  }
  const n = parseFloat(raw.replace('%', '').trim());
  return Number.isNaN(n) ? null : n;
}

/**
 * Searchable, paginated Margin Anomaly Ledger. Client component: the parent
 * server page passes the already-fetched sample down as a prop, so the bearer
 * token is NEVER shipped to the browser.
 */
export default function MarginLedgerTable({
  rows,
}: {
  rows: MarginLedgerRow[];
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return rows;
    }
    return rows.filter((r) =>
      [r.node, r.product, r.category, r.status]
        .map((v) => (v ?? '').toLowerCase())
        .some((v) => v.includes(q)),
    );
  }, [rows, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  if (rows.length === 0) {
    return (
      <div className="mik-card text-sm text-mik-muted">
        No margin-critical SKUs in the latest scan.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mik-faint"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Search node, product, category…"
            className="w-full rounded-md border border-mik-border bg-mik-panel2 py-2 pl-9 pr-3 text-sm text-mik-text placeholder:text-mik-faint focus:border-mik-accent focus:outline-none"
          />
        </div>
        <span className="shrink-0 text-xs text-mik-faint">
          {filtered.length} of {rows.length}
        </span>
      </div>

      <div className="mik-card overflow-x-auto p-0">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="mik-th text-left">Node</th>
              <th className="mik-th text-left">Product</th>
              <th className="mik-th text-left">Category</th>
              <th className="mik-th text-right">Cost</th>
              <th className="mik-th text-right">Price</th>
              <th className="mik-th text-right">Margin %</th>
              <th className="mik-th text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => {
              const margin = parseMargin(r.marginPct);
              const negative = margin !== null && margin < 0;
              return (
                <tr key={`${r.node ?? '—'}-${r.product ?? i}-${i}`} className="mik-row">
                  <td className="mik-td">{r.node ?? '—'}</td>
                  <td className="mik-td font-medium text-mik-text">
                    {r.product ?? 'Unnamed Product'}
                  </td>
                  <td className="mik-td text-mik-muted">{r.category ?? '—'}</td>
                  <td className="mik-td text-right">{fmtCurrency(r.cost)}</td>
                  <td className="mik-td text-right">{fmtCurrency(r.price)}</td>
                  <td className="mik-td text-right">
                    {negative ? (
                      <span className="inline-flex items-center rounded border border-tier-t3/50 bg-tier-t3bg px-1.5 py-0.5 text-xs font-bold text-tier-t3">
                        {r.marginPct}
                      </span>
                    ) : (
                      <span className="text-mik-text">{r.marginPct ?? '—'}</span>
                    )}
                  </td>
                  <td className="mik-td text-mik-muted">{r.status ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-3 text-xs text-mik-muted">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="rounded-md border border-mik-border px-3 py-1.5 text-mik-text transition-colors hover:bg-mik-panel2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            className="rounded-md border border-mik-border px-3 py-1.5 text-mik-text transition-colors hover:bg-mik-panel2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
