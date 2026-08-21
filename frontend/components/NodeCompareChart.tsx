'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { NodeComparisonRow } from '@/lib/types';

/**
 * Per-node comparison bar chart (reorder vs overstock counts per node).
 * Client component — recharts renders in the browser. Falls back to a table
 * in the parent when there is no data (this component assumes rows.length > 0).
 */
export default function NodeCompareChart({
  rows,
}: {
  rows: NodeComparisonRow[];
}) {
  const data = rows.map((r) => ({
    node: r.nodeId,
    Reorder: r.reorderCount,
    Overstock: r.overstockCount,
    SKUs: r.totalSKUs,
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
          <XAxis dataKey="node" stroke="#a3a3a3" fontSize={12} />
          <YAxis stroke="#a3a3a3" fontSize={12} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#111111',
              border: '1px solid #262626',
              borderRadius: 8,
              color: '#e5e5e5',
              fontSize: 12,
            }}
            cursor={{ fill: '#ffffff08' }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#a3a3a3' }} />
          <Bar dataKey="Reorder" fill="#16a34a" radius={[3, 3, 0, 0]} />
          <Bar dataKey="Overstock" fill="#f59e0b" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
