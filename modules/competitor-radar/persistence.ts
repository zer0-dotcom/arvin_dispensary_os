/**
 * Competitor radar — persistence.
 *
 * Writes sweep results to disk as JSON. Per the hard rules, sweep results MUST
 * be persisted to disk BEFORE any summary is printed/returned. This module has
 * no side effects other than local file writes.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SweepResult } from './scraper';

/** Default output dir (relative to project root), overridable via env. */
export function resolveOutputDir(): string {
  const fromEnv = process.env['COMPETITOR_SWEEP_OUTPUT_DIR'];
  const dir =
    fromEnv && fromEnv.trim().length > 0
      ? fromEnv.trim()
      : 'data/competitor-sweeps';
  return resolve(process.cwd(), dir);
}

/**
 * Persist a sweep result to `<outputDir>/<sweepId>.json`.
 * Returns the absolute path written.
 */
export async function persistSweep(result: SweepResult): Promise<string> {
  const outputDir = resolveOutputDir();
  await mkdir(outputDir, { recursive: true });
  const filePath = join(outputDir, `${result.sweepId}.json`);
  await writeFile(filePath, JSON.stringify(result, null, 2), 'utf8');
  return filePath;
}
