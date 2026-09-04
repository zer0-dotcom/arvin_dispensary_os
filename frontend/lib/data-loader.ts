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
 * Candidate project roots that may contain `data/`.
 *
 * In this sandbox / a full monorepo checkout, `process.cwd()` is the
 * `frontend` dir and `data/` lives one level up (`..`). In production on
 * Railway, only the `frontend` directory is ever part of the build/deploy
 * context (Railway's configured root is `/frontend`) — there is no parent
 * directory to read from at runtime, so the persisted JSON artifacts are
 * mirrored into `frontend/data/**` and must be read from `.` (cwd itself).
 *
 * If `DATA_ROOT` is set, it is used exclusively (no fallback). Otherwise we
 * try `.` first (the Railway/production layout), then `..` (the monorepo
 * layout), and use whichever one actually contains matching files.
 */
function dataRootCandidates(): string[] {
  const fromEnv = process.env['DATA_ROOT'];
  if (fromEnv && fromEnv.trim().length > 0) {
    return [resolve(process.cwd(), fromEnv.trim())];
  }
  return [resolve(process.cwd(), '.'), resolve(process.cwd(), '..')];
}

function dataDirCandidates(subdir: string): string[] {
  return dataRootCandidates().map((root) => join(root, 'data', subdir));
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
  let dir: string | null = null;
  let candidates: string[] = [];

  for (const candidateDir of dataDirCandidates(subdir)) {
    let dirEntries: string[];
    try {
      dirEntries = await readdir(candidateDir);
    } catch {
      continue;
    }
    const matches = dirEntries.filter(
      (f) => f.startsWith(prefix) && f.endsWith('.json'),
    );
    if (matches.length > 0) {
      dir = candidateDir;
      candidates = matches;
      break;
    }
  }

  if (dir === null || candidates.length === 0) {
    return { status: 'missing' };
  }
  const resolvedDir: string = dir;

  // Decorate with sort keys.
  const decorated = await Promise.all(
    candidates.map(async (name) => {
      const full = join(resolvedDir, name);
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
