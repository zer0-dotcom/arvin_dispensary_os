import {
  AlertTriangle,
  AlertOctagon,
  Info,
  type LucideIcon,
} from 'lucide-react';

export type Tier = 'TIER_1' | 'TIER_2' | 'TIER_3';

interface TierStyle {
  icon: LucideIcon;
  wrap: string;
  label: string;
}

const TIER_STYLES: Record<Tier, TierStyle> = {
  TIER_1: {
    icon: Info,
    wrap: 'border-tier-t1/40 bg-tier-t1bg text-tier-t1',
    label: 'INFO',
  },
  TIER_2: {
    icon: AlertTriangle,
    wrap: 'border-tier-t2/40 bg-tier-t2bg text-tier-t2',
    label: 'DEGRADED',
  },
  TIER_3: {
    icon: AlertOctagon,
    wrap: 'border-tier-t3/50 bg-tier-t3bg text-tier-t3',
    label: 'HALT',
  },
};

/** Full-width banner. TIER_3 renders the mandated human-review halt message. */
export function AlertBanner({
  tier,
  message,
}: {
  tier: Tier;
  message?: string;
}) {
  const s = TIER_STYLES[tier];
  const Icon = s.icon;
  const text =
    message ??
    (tier === 'TIER_3'
      ? 'HUMAN REVIEW REQUIRED — operation halted. No automated action has been or will be taken.'
      : tier === 'TIER_2'
        ? 'Degraded — some upstream data was unavailable during the last run.'
        : 'Informational.');

  return (
    <div
      role={tier === 'TIER_3' ? 'alert' : 'status'}
      className={[
        'mb-5 flex items-start gap-3 rounded-lg border px-4 py-3',
        s.wrap,
      ].join(' ')}
    >
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase tracking-wider">
          {s.label}
        </div>
        <div className="text-sm">{text}</div>
      </div>
    </div>
  );
}

/** Small inline tier badge for table rows / stat cards. */
export function TierBadge({ tier }: { tier: Tier }) {
  const s = TIER_STYLES[tier];
  return (
    <span
      className={[
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
        s.wrap,
      ].join(' ')}
    >
      {tier.replace('_', ' ')}
    </span>
  );
}
