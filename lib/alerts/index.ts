/**
 * Tiered alerting system.
 *
 * SAFETY MODEL
 * ------------
 * Every external API / network call in this codebase must be routed through
 * `triggerAlert()` (directly, or via the `guard()` wrapper) when it fails or
 * behaves anomalously.
 *
 * Tiers:
 *   TIER_1  — informational / low severity. Logged. Processing continues.
 *   TIER_2  — degraded / recoverable. Logged prominently. Processing continues
 *             (the caller decides whether to retry / skip the affected item).
 *   TIER_3  — highest severity. This module NEVER auto-remediates, auto-sends,
 *             or takes any real-world action for a TIER_3. It records the alert
 *             and throws `Tier3HaltError` so the current operation HALTS and a
 *             human must review. Surfacing only — no side effects.
 *
 * HARD RULES enforced here:
 *   - No outbound notifications / emails / webhooks / SMS of any kind.
 *   - No financial or marketing side effects.
 *   - TIER_3 halts + surfaces; it must never trigger automated action.
 */

export enum AlertTier {
  TIER_1 = 'TIER_1',
  TIER_2 = 'TIER_2',
  TIER_3 = 'TIER_3',
}

export interface AlertContext {
  /** Logical source of the alert, e.g. "dutchie.client" or "competitor.radar". */
  readonly source: string;
  /** Optional structured metadata (node id, target url, http status, etc.). */
  readonly meta?: Readonly<Record<string, unknown>>;
  /** The underlying error, if any. */
  readonly cause?: unknown;
}

export interface AlertRecord {
  readonly tier: AlertTier;
  readonly message: string;
  readonly source: string;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
  readonly causeMessage?: string;
}

/**
 * Thrown for every TIER_3 alert. Callers of multi-node/multi-target batches
 * should let this propagate (or capture it via Promise.allSettled) so the
 * offending operation halts and a human is surfaced the alert. It must never
 * be swallowed silently.
 */
export class Tier3HaltError extends Error {
  public readonly record: AlertRecord;

  constructor(record: AlertRecord) {
    super(`[TIER_3 HALT] ${record.source}: ${record.message}`);
    this.name = 'Tier3HaltError';
    this.record = record;
    // Maintain a proper prototype chain when compiled down to ES5/ES2020.
    Object.setPrototypeOf(this, Tier3HaltError.prototype);
  }
}

/** In-memory audit trail of every alert raised during a process run. */
const alertLog: AlertRecord[] = [];

/** Returns a shallow copy of all alerts raised so far (for scripts/reporting). */
export function getAlertLog(): readonly AlertRecord[] {
  return [...alertLog];
}

function extractCauseMessage(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) {
    return undefined;
  }
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

/**
 * Record and surface an alert.
 *
 * For TIER_1 / TIER_2 this logs and returns normally.
 * For TIER_3 this logs, records, and THROWS `Tier3HaltError` — halting the
 * current operation. It performs NO other action (no auto-remediation, no
 * outbound send). Surfacing only.
 */
export function triggerAlert(
  tier: AlertTier,
  message: string,
  context: AlertContext,
): AlertRecord {
  const causeMessage = extractCauseMessage(context.cause);
  const record: AlertRecord = {
    tier,
    message,
    source: context.source,
    meta: context.meta ?? {},
    timestamp: new Date().toISOString(),
    ...(causeMessage !== undefined ? { causeMessage } : {}),
  };

  alertLog.push(record);

  const line = `[ALERT][${record.tier}] (${record.source}) ${record.message}` +
    (causeMessage ? ` :: cause=${causeMessage}` : '');

  switch (tier) {
    case AlertTier.TIER_1:
      // Informational. Continue.
      console.info(line);
      return record;

    case AlertTier.TIER_2:
      // Degraded but recoverable. Continue; caller decides on retry/skip.
      console.warn(line);
      return record;

    case AlertTier.TIER_3:
      // Highest severity: surface ONLY, take no automated action, and HALT.
      console.error(line);
      console.error(
        '[ALERT][TIER_3] Halting operation. Human review required. ' +
          'No automated action has been or will be taken.',
      );
      throw new Tier3HaltError(record);

    default: {
      // Exhaustiveness guard — unreachable if tiers stay in sync.
      const _exhaustive: never = tier;
      throw new Error(`Unknown alert tier: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Wrap an external API / network call so any thrown error is routed through
 * the alert system at the supplied tier.
 *
 * - For TIER_1 / TIER_2, on failure the alert is recorded and the error is
 *   re-thrown so the caller can decide how to proceed (or capture it via
 *   Promise.allSettled).
 * - For TIER_3, on failure `triggerAlert` throws `Tier3HaltError`, halting.
 *
 * A `Tier3HaltError` raised anywhere inside `fn` is always propagated as-is.
 */
export async function guard<T>(
  context: AlertContext,
  fn: () => Promise<T>,
  failureTier: AlertTier = AlertTier.TIER_2,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Tier3HaltError) {
      throw err;
    }
    const message =
      err instanceof Error ? err.message : `Non-error thrown: ${String(err)}`;
    // triggerAlert will throw for TIER_3; for lower tiers it returns.
    triggerAlert(failureTier, `External call failed: ${message}`, {
      ...context,
      cause: err,
    });
    throw err;
  }
}
