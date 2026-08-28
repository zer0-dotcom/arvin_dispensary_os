/**
 * scripts/verify-nodes.ts
 *
 * Authenticates (read-only) against the Dutchie API for BOTH store nodes and
 * reports success/failure per node.
 *
 * Uses Promise.allSettled so one node's failure never aborts the other.
 * Fails GRACEFULLY: missing credentials / auth failures are surfaced through
 * the alert system rather than crashing uncleanly.
 */

import 'dotenv/config';
import {
  ALL_STORE_NODES,
  DutchieReadOnlyClient,
  type NodeVerificationResult,
} from '../lib/dutchie/client';
import { Tier3HaltError, getAlertLog } from '../lib/alerts';

async function main(): Promise<void> {
  console.info('[verify-nodes] Verifying Dutchie read-only access for both store nodes...');

  let client: DutchieReadOnlyClient;
  try {
    client = await DutchieReadOnlyClient.create();
  } catch (err) {
    if (err instanceof Tier3HaltError) {
      // No credentials available anywhere — surfaced by the alert system.
      console.error(
        '[verify-nodes] Halted: credentials unavailable. Human review required.',
      );
      process.exitCode = 2;
      return;
    }
    console.error(
      `[verify-nodes] Failed to initialize client: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exitCode = 1;
    return;
  }

  const settled = await Promise.allSettled(
    ALL_STORE_NODES.map((node) => client.verifyNode(node)),
  );

  const results: NodeVerificationResult[] = settled.map((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }
    const node = ALL_STORE_NODES[index]!;
    return {
      node,
      displayName: node,
      ok: false,
      detail:
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason),
    };
  });

  console.info('\n[verify-nodes] Results:');
  for (const r of results) {
    const status = r.ok ? 'OK   ' : 'FAIL ';
    console.info(`  [${status}] ${r.node} (${r.displayName}) — ${r.detail}`);
  }

  const okCount = results.filter((r) => r.ok).length;
  console.info(`\n[verify-nodes] ${okCount}/${results.length} nodes verified.`);

  const alerts = getAlertLog();
  if (alerts.length > 0) {
    console.info(`[verify-nodes] ${alerts.length} alert(s) raised during run.`);
  }

  // Non-zero exit if any node failed, so CI / operators notice.
  process.exitCode = okCount === results.length ? 0 : 1;
}

main().catch((err: unknown) => {
  if (err instanceof Tier3HaltError) {
    console.error('[verify-nodes] TIER_3 halt — human review required.');
    process.exitCode = 2;
    return;
  }
  console.error(
    `[verify-nodes] Unexpected fatal error: ${
      err instanceof Error ? err.stack ?? err.message : String(err)
    }`,
  );
  process.exitCode = 1;
});
