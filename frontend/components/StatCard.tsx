import type { ReactNode } from 'react';

type Accent = 'default' | 'green' | 'amber' | 'red' | 'blue';

const ACCENTS: Record<Accent, string> = {
  default: 'text-mik-text',
  green: 'text-mik-accent',
  amber: 'text-tier-t2',
  red: 'text-tier-t3',
  blue: 'text-tier-t1',
};

/** Compact KPI card. `value` renders a dash upstream when data is absent. */
export default function StatCard({
  label,
  value,
  hint,
  accent = 'default',
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: Accent;
  icon?: ReactNode;
}) {
  return (
    <div className="mik-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-mik-muted">
          {label}
        </span>
        {icon ? <span className="text-mik-faint">{icon}</span> : null}
      </div>
      <div className={['mt-2 text-2xl font-semibold', ACCENTS[accent]].join(' ')}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-mik-faint">{hint}</div> : null}
    </div>
  );
}
