/**
 * scripts/probe-inventory-endpoint.ts
 *
 * One-off probe of the /reporting/inventory endpoint to surface available
 * field names. Used to verify if true sales velocity / lastSoldAt data
 * exists at this endpoint (vs. the /products endpoint which only has
 * lastModifiedDateUTC).
 *
 * Run: npx ts-node scripts/probe-inventory-endpoint.ts
 */

import { DutchieReadOnlyClient, StoreNode } from '../lib/dutchie/client';
import { Tier3HaltError } from '../lib/alerts';

async function probeInventoryEndpoint(): Promise<void> {
  console.info('[probe] Probing /reporting/inventory endpoint...');

  try {
    const client = await DutchieReadOnlyClient.create();

    // Access the private getJson method via type-unsafe workaround.
    // This is a one-off probe script, not production code.
    const clientAny = client as any;
    const raw = await clientAny.getJson(
      StoreNode.NODE_5TH_AVE,
      '/reporting/inventory',
      { retailerId: 1482 },
    );

    console.info('\n=== /reporting/inventory field names ===\n');
    if (Array.isArray(raw)) {
      if (raw.length > 0) {
        console.info('Response is an array. First item field names:');
        const fields = Object.keys(raw[0]).sort();
        fields.forEach((field) => console.info(`  - ${field}`));
        console.info(`\nTotal fields: ${fields.length}`);
        console.info(`Total items in response: ${raw.length}`);
      } else {
        console.info('Response is an empty array (no inventory records).');
      }
    } else if (typeof raw === 'object' && raw !== null) {
      console.info('Response is an object. Top-level field names:');
      const fields = Object.keys(raw).sort();
      fields.forEach((field) => console.info(`  - ${field}`));
      console.info(`\nTotal fields: ${fields.length}`);
    } else {
      console.warn('Unexpected response type:', typeof raw);
      console.info(JSON.stringify(raw, null, 2).slice(0, 500));
    }
  } catch (err) {
    if (err instanceof Tier3HaltError) {
      console.error('[probe] TIER_3 halt — credentials missing.');
      process.exitCode = 2;
      return;
    }
    console.error(
      `[probe] Probe failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exitCode = 1;
  }
}

probeInventoryEndpoint();
