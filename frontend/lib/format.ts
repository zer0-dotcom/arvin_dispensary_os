/**
 * Presentation formatting helpers. Pure, no side effects.
 * These NEVER invent values — a nullish input renders an explicit dash.
 */

const DASH = '—';

export function fmtCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return DASH;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return DASH;
  }
  return `${value.toFixed(digits)}%`;
}

export function fmtNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return DASH;
  }
  return new Intl.NumberFormat('en-US').format(value);
}

export function fmtScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return DASH;
  }
  return value.toFixed(1);
}

/** Render days-on-hand / days-since-modified as a compact "Nd" or a dash. */
export function fmtDays(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return DASH;
  }
  return `${Math.round(value)}d`;
}

/** Human-readable timestamp from an ISO string. Falls back to the raw string. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return DASH;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}
