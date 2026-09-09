'use client';

import { useState } from 'react';
import { fmtNumber } from '@/lib/format';

/**
 * Per-node roll-up as emitted by GET /api/v1/intel (`nodes[]`, sourced from the
 * weekly dossier's nodeComparison). `nodeId` may be null in defensive cases.
 */
export interface NodeRow {
  nodeId: string | null;
  totalSKUs: number;
  reorderCount: number;
  overstockCount: number;
}

/**
 * Multi-node selector + split comparison. Operators pick which retail nodes to
 * compare; selected nodes render as side-by-side metric panels above the full
 * comparison table. Pure client interactivity — data is passed in as a prop.
 */
export default function NodeSplitView({ nodes }: { nodes: NodeRow[] }) {
  const labelFor = (n: NodeRow, i: number) => n.nodeId ?? `Node ${i + 1}`;

  const [selected, setSelected] = useState<number[]>(() =>
    nodes.slice(0, Math.min(2, nodes.length)).map((_, i) => i),
  );

  if (nodes.length === 0) {
    return (
      <div className="mik-card text-sm text-mik-muted">
        No per-node breakdown available in the latest dossier.
      </div>
    );
  }

  const toggle = (i: number) => {
    setSelected((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i],
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {nodes.map((n, i) => {
          const active = selected.includes(i);
          return (
            <button
              key={`${labelFor(n, i)}-${i}`}
              type="button"
              onClick={() => toggle(i)}
              className={[
                'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'border-mik-accent bg-mik-accentSoft text-mik-accent'
                  : 'border-mik-border text-mik-muted hover:bg-mik-panel2 hover:text-mik-text',
              ].join(' ')}
            >
              {labelFor(n, i)}
            </button>
          );
        })}
      </div>

      {selected.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {selected.map((idx) => {
            const n = nodes[idx];
            if (!n) {
              return null;
            }
            return (
              <div key={`panel-${idx}`} className="mik-card">
                <div className="text-xs font-semibold uppercase tracking-wider text-mik-accent">
                  {labelFor(n, idx)}
                </div>
                <dl className="mt-3 flex flex-col gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-mik-muted">Total SKUs</dt>
                    <dd className="font-semibold text-mik-text">
                      {fmtNumber(n.totalSKUs)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-mik-muted">Reorder</dt>
                    <dd className="font-semibold text-mik-accent">
                      {fmtNumber(n.reorderCount)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-mik-muted">Overstock</dt>
                    <dd className="font-semibold text-tier-t2">
                      {fmtNumber(n.overstockCount)}
                    </dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mik-card text-sm text-mik-muted">
          Select one or more nodes to compare.
        </div>
      )}

      <div className="mik-card overflow-x-auto p-0">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="mik-th text-left">Node</th>
              <th className="mik-th text-right">Total SKUs</th>
              <th className="mik-th text-right">Reorder</th>
              <th className="mik-th text-right">Overstock</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n, i) => (
              <tr key={`row-${labelFor(n, i)}-${i}`} className="mik-row">
                <td className="mik-td font-medium text-mik-text">
                  {labelFor(n, i)}
                </td>
                <td className="mik-td text-right">{fmtNumber(n.totalSKUs)}</td>
                <td className="mik-td text-right text-mik-accent">
                  {fmtNumber(n.reorderCount)}
                </td>
                <td className="mik-td text-right text-tier-t2">
                  {fmtNumber(n.overstockCount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
