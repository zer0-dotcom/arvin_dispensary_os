/**
 * Competitor radar — biweekly cadence state.
 *
 * node-cron fires on a weekly cron (every Sunday 06:00 America/New_York), but
 * cron cannot natively express "every other week". We enforce the biweekly gap
 * with anchor-date tracking: a small JSON state file records the last successful
 * run timestamp, and each fire only proceeds if at least `BIWEEKLY_GAP_DAYS`
 * have elapsed since then.
 *
 * Only local file reads/writes — no other side effects.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { resolveOutputDir } from './persistence';

/** Minimum gap (in days) between biweekly runs. */
export const BIWEEKLY_GAP_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface BiweeklyState {
  lastRunISO: string | null;
}

/** Path to the biweekly state file (alongside sweep output by default). */
export function resolveStatePath(): string {
  return resolve(resolveOutputDir(), '..', 'competitor-radar-state.json');
}

/**
 * Pure predicate: should a biweekly run proceed given the last-run timestamp
 * and the current time? Returns true when there is no prior run, or when at
 * least BIWEEKLY_GAP_DAYS have elapsed since the last run.
 */
export function shouldRunBiweekly(
  lastRunISO: string | null,
  now: Date = new Date(),
): boolean {
  if (!lastRunISO) {
    return true;
  }
  const last = new Date(lastRunISO).getTime();
  if (Number.isNaN(last)) {
    return true; // Corrupt/unknown state — allow the run.
  }
  const elapsedDays = (now.getTime() - last) / MS_PER_DAY;
  return elapsedDays >= BIWEEKLY_GAP_DAYS;
}

/** Read the last successful run timestamp, or null if none / unreadable. */
export async function readLastRun(): Promise<string | null> {
  try {
    const raw = await readFile(resolveStatePath(), 'utf8');
    const parsed = JSON.parse(raw) as BiweeklyState;
    return typeof parsed.lastRunISO === 'string' ? parsed.lastRunISO : null;
  } catch {
    return null; // Missing/unreadable state is treated as "never run".
  }
}

/** Persist the last successful run timestamp. */
export async function writeLastRun(nowISO: string): Promise<void> {
  const statePath = resolveStatePath();
  await mkdir(dirname(statePath), { recursive: true });
  const state: BiweeklyState = { lastRunISO: nowISO };
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}
