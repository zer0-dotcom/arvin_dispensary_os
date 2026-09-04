/**
 * Inbound SMS webhook (Twilio TwiML handler).
 *
 * Twilio POSTs `application/x-www-form-urlencoded` bodies to this route when an
 * SMS arrives at the configured number. We parse `From` / `Body`, optionally
 * gate on an allow-list, run keyword routing against the LATEST weekly dossier
 * (read-only, via the existing data-loader), and ALWAYS reply with valid TwiML.
 *
 * Design guarantees:
 *   - Read-only: never mutates data, never sends anything outbound itself.
 *   - Self-contained inside `frontend/` (Railway build root = frontend/).
 *   - Never 500s the webhook — any error still returns valid TwiML so Twilio
 *     does not retry-storm or surface an error to the sender.
 *
 * Twilio config: set the messaging webhook to POST <app>/api/sms.
 * Optional allow-list: ARVIN_ALLOWED_NUMBERS = comma-separated E.164 numbers.
 */

import { loadLatestDossier } from '@/lib/data-loader';
import type { WeeklyDossier } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Escape the five XML special characters so the TwiML stays valid. */
function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Wrap a plain-text message in a valid TwiML <Response><Message> envelope. */
function twiml(message: string): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(
    message,
  )}</Message></Response>`;
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

/** Parse the comma-separated allow-list env var into a normalized set. */
function allowedNumbers(): string[] {
  const raw = process.env['ARVIN_ALLOWED_NUMBERS'];
  if (!raw || raw.trim().length === 0) {
    return [];
  }
  return raw
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
}

/** Normalize a phone number for tolerant comparison (strip spaces/dashes). */
function normalizePhone(n: string): string {
  return n.replace(/[\s()-]/g, '');
}

const KEYWORDS = ['margin', 'inventory', 'vendor', 'compare', 'help', 'status'];

function helpMessage(): string {
  return (
    'MiK SMS commands: ' +
    KEYWORDS.join(', ') +
    '. Text a keyword for a quick read-only summary.'
  );
}

/** One-line overall status line from the dossier. */
function statusSummary(d: WeeklyDossier): string {
  const h = d.inventoryHealth;
  return (
    `Dossier ${d.generatedAt}: ${h.skusAnalyzed} SKUs analyzed, ` +
    `${h.marginCriticalCount} critical margin, ${h.deadStockCount} dead-stock, ` +
    `${d.reorderWatch.totalReorder} reorder / ${d.reorderWatch.totalOverstock} overstock.`
  );
}

function marginSummary(d: WeeklyDossier): string {
  const h = d.inventoryHealth;
  const total = h.marginWarningCount + h.marginCriticalCount;
  if (total === 0) {
    return `No margin alerts in latest dossier (${h.skusAnalyzed} SKUs analyzed).`;
  }
  return (
    `Margin alerts: ${h.marginCriticalCount} critical, ${h.marginWarningCount} warning ` +
    `across ${h.skusAnalyzed} SKUs. Dead stock: ${h.deadStockCount}.`
  );
}

function inventorySummary(d: WeeklyDossier): string {
  const h = d.inventoryHealth;
  return (
    `Inventory: ${h.skusAnalyzed} SKUs analyzed (${h.skusSkippedNoCost} skipped, no cost). ` +
    `Reorder watch: ${d.reorderWatch.totalReorder} reorder, ${d.reorderWatch.totalOverstock} overstock.`
  );
}

function vendorSummary(d: WeeklyDossier): string {
  const v = d.vendorRankings;
  if (v.totalVendors === 0) {
    return 'No vendor scorecards in latest dossier.';
  }
  const top = v.top3[0];
  const topStr = top
    ? ` Top: ${top.vendorName} (score ${top.compositeScore}).`
    : '';
  return `Vendors ranked: ${v.totalVendors}.${topStr}`;
}

function compareSummary(d: WeeklyDossier): string {
  const rows = d.nodeComparison;
  if (!rows || rows.length === 0) {
    return 'No per-node comparison data in latest dossier.';
  }
  const parts = rows.map(
    (r) =>
      `${r.nodeId}: ${r.totalSKUs} SKUs, ${r.reorderCount} reorder / ${r.overstockCount} overstock`,
  );
  return `Node comparison — ${parts.join('; ')}.`;
}

/** Pick the first supported keyword found in the body (case-insensitive). */
function routeKeyword(body: string): string {
  const lower = body.toLowerCase();
  for (const kw of KEYWORDS) {
    if (lower.includes(kw)) {
      return kw;
    }
  }
  return 'status';
}

export async function POST(request: Request): Promise<Response> {
  try {
    // Twilio sends application/x-www-form-urlencoded.
    let from = '';
    let body = '';
    try {
      const form = await request.formData();
      from = String(form.get('From') ?? '');
      body = String(form.get('Body') ?? '');
    } catch {
      // Fallback: parse raw text as URL-encoded if formData() is unavailable.
      const raw = await request.text();
      const params = new URLSearchParams(raw);
      from = params.get('From') ?? '';
      body = params.get('Body') ?? '';
    }

    // Authorization gate (only enforced when an allow-list is configured).
    const allow = allowedNumbers();
    if (allow.length > 0) {
      const normFrom = normalizePhone(from);
      const permitted = allow.some((n) => normalizePhone(n) === normFrom);
      if (!permitted) {
        return twiml('Unauthorized.');
      }
    }

    // Load the latest dossier (read-only). Degrade gracefully if absent.
    const res = await loadLatestDossier();
    if (res.status !== 'ok') {
      const keyword = routeKeyword(body);
      if (keyword === 'help') {
        return twiml(helpMessage());
      }
      return twiml(
        'No dossier data is available yet. Try again after the next refresh, or text "help" for options.',
      );
    }

    const d = res.data;
    const keyword = routeKeyword(body);

    let reply: string;
    switch (keyword) {
      case 'margin':
        reply = marginSummary(d);
        break;
      case 'inventory':
        reply = inventorySummary(d);
        break;
      case 'vendor':
        reply = vendorSummary(d);
        break;
      case 'compare':
        reply = compareSummary(d);
        break;
      case 'help':
        reply = helpMessage();
        break;
      case 'status':
      default:
        reply = statusSummary(d);
        break;
    }

    return twiml(reply);
  } catch {
    // Never crash the webhook — Twilio requires valid TwiML back.
    return twiml('Something went wrong, please try again later.');
  }
}
