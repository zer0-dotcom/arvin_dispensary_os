/**
 * Server-only data loader.
 *
 * Reads the persisted JSON artifacts written by the backend modules from the
 * sibling `data/**` directory. This module is imported ONLY by Server
 * Components / Route Handlers — never shipped to the browser (enforced by the
 * `server-only` import below). No Dutchie calls, no AWS calls, no writes.
 */

import 'server-only';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type {
  LoadResult,
  WeeklyDossier,
  MarginScanResult,
  SweepResult,
} from './types';

/**
 * Project root that contains `data/`. When Next runs from `/frontend`,
 * `process.cwd()` is the frontend dir, so the default DATA_ROOT is `..`.
 */
function dataRoot(): string {
  const fromEnv = process.env['DATA_ROOT'];
  const root = fromEnv && fromEnv.trim().length > 0 ? fromEnv.trim() : '..';
  return resolve(process.cwd(), root);
}

function dataDir(subdir: string): string {
  return join(dataRoot(), 'data', subdir);
}

/** Pull the trailing numeric timestamp out of a filename, if present. */
function timestampFromName(name: string): number | null {
  const match = name.match(/(\d{10,})/);
  if (!match || match[1] === undefined) {
    return null;
  }
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Locate the newest `<prefix>*.json` file in `data/<subdir>` and parse it.
 * Ordering: by embedded filename timestamp (desc), then mtime (desc).
 * NEVER throws to the caller — returns a discriminated LoadResult instead.
 */
export async function loadLatestArtifact<T>(
  subdir: string,
  prefix: string,
): Promise<LoadResult<T>> {
  const dir = dataDir(subdir);

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { status: 'missing' };
  }

  const candidates = entries.filter(
    (f) => f.startsWith(prefix) && f.endsWith('.json'),
  );
  if (candidates.length === 0) {
    return { status: 'missing' };
  }

  // Decorate with sort keys.
  const decorated = await Promise.all(
    candidates.map(async (name) => {
      const full = join(dir, name);
      let mtimeMs = 0;
      try {
        mtimeMs = (await stat(full)).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      return { name, full, ts: timestampFromName(name), mtimeMs };
    }),
  );

  decorated.sort((a, b) => {
    if (a.ts !== null && b.ts !== null && a.ts !== b.ts) {
      return b.ts - a.ts;
    }
    return b.mtimeMs - a.mtimeMs;
  });

  const chosen = decorated[0];
  if (!chosen) {
    return { status: 'missing' };
  }

  try {
    const raw = await readFile(chosen.full, 'utf8');
    const data = JSON.parse(raw) as T;
    return {
      status: 'ok',
      data,
      sourceFile: chosen.name,
      loadedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: 'error',
      message: `Failed to parse ${chosen.name}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

export function loadLatestDossier(): Promise<LoadResult<WeeklyDossier>> {
  return loadLatestArtifact<WeeklyDossier>('forward-intel', 'weekly-dossier-');
}

export function loadLatestMarginScan(): Promise<LoadResult<MarginScanResult>> {
  return loadLatestArtifact<MarginScanResult>('margin-scans', 'margin-scan-');
}

export function loadLatestSweep(): Promise<LoadResult<SweepResult>> {
  // Competitor sweeps are named `<sweepId>.json` (no fixed prefix), so match all.
  return loadLatestArtifact<SweepResult>('competitor-sweeps', '');
}
