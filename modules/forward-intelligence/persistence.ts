/**
 * Forward Intelligence — persistence.
 *
 * Writes forward-intelligence outputs (demand forecasts, vendor scorecards,
 * weekly dossiers) to disk as JSON. Per the hard rules, results MUST be
 * persisted to disk BEFORE any summary is printed/returned. Mirrors the pattern
 * of modules/margin-scanner/persistence.ts. Local file writes only.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Default output dir (relative to project root), overridable via env. */
export function resolveOutputDir(): string {
  const fromEnv = process.env['FORWARD_INTEL_OUTPUT_DIR'];
  const dir =
    fromEnv && fromEnv.trim().length > 0 ? fromEnv.trim() : 'data/forward-intel';
  return resolve(process.cwd(), dir);
}

/**
 * Persist an arbitrary forward-intelligence artifact to
 * `<outputDir>/<name>-<timestamp>.json`. Returns the absolute path written.
 */
export async function persistForwardIntel(
  name: string,
  payload: unknown,
  timestamp: number = Date.now(),
): Promise<string> {
  const outputDir = resolveOutputDir();
  await mkdir(outputDir, { recursive: true });
  const filePath = join(outputDir, `${name}-${timestamp}.json`);
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}
