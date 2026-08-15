/**
 * Margin & Dead Stock Scanner — persistence.
 *
 * Writes scan results to disk as JSON. Per the hard rules, results MUST be
 * persisted to disk BEFORE any summary is printed/returned. This module has no
 * side effects other than local file writes.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { MarginScanResult } from './scanner';

/** Default output dir (relative to project root), overridable via env. */
export function resolveOutputDir(): string {
  const fromEnv = process.env['MARGIN_SCAN_OUTPUT_DIR'];
  const dir =
    fromEnv && fromEnv.trim().length > 0 ? fromEnv.trim() : 'data/margin-scans';
  return resolve(process.cwd(), dir);
}

/**
 * Persist a scan result to `<outputDir>/<scanId>.json`. The scanId already
 * carries the timestamp (margin-scan-{timestamp}). Returns the absolute path.
 */
export async function persistScan(result: MarginScanResult): Promise<string> {
  const outputDir = resolveOutputDir();
  await mkdir(outputDir, { recursive: true });
  const filePath = join(outputDir, `${result.scanId}.json`);
  await writeFile(filePath, JSON.stringify(result, null, 2), 'utf8');
  return filePath;
}
