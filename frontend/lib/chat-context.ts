/**
 * MiK copilot — grounding context builder (server-only).
 *
 * Loads the latest persisted artifacts via the EXISTING data-loader
 * (loadLatestDossier / loadLatestMarginScan / loadLatestSweep) and distills
 * them into a compact, token-bounded text context the chat route feeds to the
 * LLM. It NEVER fabricates values: every number here traces to a loaded
 * artifact, and missing/empty artifacts are reported as explicitly unavailable
 * so the model can say so instead of guessing.
 */

import 'server-only';
import {
  loadLatestDossier,
  loadLatestMarginScan,
  loadLatestSweep,
} from './data-loader';
import type {
  WeeklyDossier,
  MarginScanResult,
  SweepResult,
  MarginFlag,
  DeadStockFlag,
} from './types';

/** How many example rows to include per list to keep the prompt bounded. */
const SAMPLE_LIMIT = 12;

export interface ChatGroundingContext {
  readonly text: string;
  readonly sources: string[];
  readonly hasAnyData: boolean;
}

function dossierSection(d: WeeklyDossier): string {
  const ih = d.inventoryHealth;
  const rw = d.reorderWatch;
  const vr = d.vendorRankings;
  const lines: string[] = [];
  lines.push(`Weekly dossier generated at: ${d.generatedAt}`);
  lines.push(
    `Inventory health: skusAnalyzed=${ih.skusAnalyzed}, skippedNoCost=${ih.skusSkippedNoCost}, ` +
      `marginWarnings=${ih.marginWarningCount}, marginCritical=${ih.marginCriticalCount}, ` +
      `deadStock=${ih.deadStockCount}`,
  );
  lines.push(
    `Reorder watch: totalReorder=${rw.totalReorder}, totalOverstock=${rw.totalOverstock}`,
  );
  if (rw.topReorder.length > 0) {
    lines.push('Top reorder (most urgent, fewest days-on-hand):');
    for (const a of rw.topReorder.slice(0, SAMPLE_LIMIT)) {
      lines.push(
        `  - ${a.name} [${a.vendorName}] qty=${a.quantityAvailable}, daysOnHand=${a.daysOnHand.toFixed(0)}`,
      );
    }
  }
  if (rw.topOverstock.length > 0) {
    lines.push('Top overstock (most stale, highest days-on-hand):');
    for (const a of rw.topOverstock.slice(0, SAMPLE_LIMIT)) {
      lines.push(
        `  - ${a.name} [${a.vendorName}] qty=${a.quantityAvailable}, daysOnHand=${a.daysOnHand.toFixed(0)}`,
      );
    }
  }
  lines.push(`Vendors ranked: totalVendors=${vr.totalVendors}`);
  if (vr.top3.length > 0) {
    lines.push('Top vendors:');
    for (const sc of vr.top3) {
      lines.push(
        `  - #${sc.rank} ${sc.vendorName} score=${sc.compositeScore.toFixed(1)} avgMargin=${sc.avgGrossMarginPct.toFixed(1)}%`,
      );
    }
  }
  if (vr.bottom3.length > 0) {
    lines.push('Bottom vendors:');
    for (const sc of vr.bottom3) {
      lines.push(
        `  - #${sc.rank} ${sc.vendorName} score=${sc.compositeScore.toFixed(1)} avgMargin=${sc.avgGrossMarginPct.toFixed(1)}%`,
      );
    }
  }
  if (d.nodeComparison.length > 0) {
    lines.push('Per-store comparison:');
    for (const row of d.nodeComparison) {
      lines.push(
        `  - ${row.nodeId}: totalSKUs=${row.totalSKUs}, reorder=${row.reorderCount}, overstock=${row.overstockCount}`,
      );
    }
  }
  return lines.join('\n');
}

function marginFlagLine(f: MarginFlag): string {
  return (
    `  - ${f.productName} [${f.node}]${f.category ? ` (${f.category})` : ''}: ` +
    `margin=${f.grossMarginPct.toFixed(1)}%, rec=${f.recPrice}, cost=${f.unitCost}, qty=${f.quantityAvailable} [${f.label}]`
  );
}

function deadStockLine(f: DeadStockFlag): string {
  const staleness =
    f.daysSinceLastModified === null
      ? 'never modified'
      : `${f.daysSinceLastModified.toFixed(0)}d since modified`;
  return (
    `  - ${f.productName} [${f.node}]${f.category ? ` (${f.category})` : ''}: ` +
    `qty=${f.quantityAvailable}, ${staleness}`
  );
}

function marginSection(m: MarginScanResult): string {
  const lines: string[] = [];
  lines.push(`Margin scan ${m.scanId} (finished ${m.finishedAt})`);
  lines.push(
    `skusAnalyzed=${m.skusAnalyzed}, skippedNoCost=${m.skusSkippedNoCost}, ` +
      `marginWarnings=${m.marginWarnings.length}, marginCritical=${m.marginCritical.length}, ` +
      `deadStockCandidates=${m.deadStockCandidates.length}`,
  );
  if (m.marginCritical.length > 0) {
    lines.push('Critical-margin SKUs (sample):');
    for (const f of m.marginCritical.slice(0, SAMPLE_LIMIT)) {
      lines.push(marginFlagLine(f));
    }
  }
  if (m.marginWarnings.length > 0) {
    lines.push('Warning-margin SKUs (sample):');
    for (const f of m.marginWarnings.slice(0, SAMPLE_LIMIT)) {
      lines.push(marginFlagLine(f));
    }
  }
  if (m.deadStockCandidates.length > 0) {
    lines.push('Dead-stock candidates (sample):');
    for (const f of m.deadStockCandidates.slice(0, SAMPLE_LIMIT)) {
      lines.push(deadStockLine(f));
    }
  }
  return lines.join('\n');
}

function sweepSection(s: SweepResult): string {
  const lines: string[] = [];
  lines.push(
    `Competitor sweep ${s.sweepId}: ${s.successCount}/${s.targetCount} targets ok (finished ${s.finishedAt})`,
  );
  for (const snap of s.snapshots.slice(0, SAMPLE_LIMIT)) {
    const status = snap.ok ? 'ok' : 'FAILED';
    lines.push(
      `  - ${snap.dispensarySlug}: ${status}, ${snap.products.length} products` +
        (snap.note ? ` (${snap.note})` : ''),
    );
  }
  return lines.join('\n');
}

/**
 * Build the grounding context by loading all three artifacts in parallel.
 * Each section reports "unavailable" explicitly when its artifact is missing,
 * empty, or errored — never fabricated.
 */
export async function buildGroundingContext(): Promise<ChatGroundingContext> {
  const [dossier, margin, sweep] = await Promise.all([
    loadLatestDossier(),
    loadLatestMarginScan(),
    loadLatestSweep(),
  ]);

  const parts: string[] = [];
  const sources: string[] = [];
  let hasAnyData = false;

  parts.push('=== FORWARD INTELLIGENCE DOSSIER ===');
  if (dossier.status === 'ok') {
    parts.push(dossierSection(dossier.data));
    sources.push(`dossier:${dossier.sourceFile}`);
    hasAnyData = true;
  } else if (dossier.status === 'missing') {
    parts.push('No weekly dossier available yet.');
  } else {
    parts.push(`Dossier could not be read: ${dossier.message}`);
  }

  parts.push('\n=== MARGIN & DEAD STOCK SCAN ===');
  if (margin.status === 'ok') {
    parts.push(marginSection(margin.data));
    sources.push(`margin-scan:${margin.sourceFile}`);
    hasAnyData = true;
  } else if (margin.status === 'missing') {
    parts.push('No margin scan available yet.');
  } else {
    parts.push(`Margin scan could not be read: ${margin.message}`);
  }

  parts.push('\n=== COMPETITOR RADAR ===');
  if (sweep.status === 'ok') {
    parts.push(sweepSection(sweep.data));
    sources.push(`competitor-sweep:${sweep.sourceFile}`);
    hasAnyData = true;
  } else if (sweep.status === 'missing') {
    parts.push('No competitor sweep available yet.');
  } else {
    parts.push(`Competitor sweep could not be read: ${sweep.message}`);
  }

  return { text: parts.join('\n'), sources, hasAnyData };
}
