/**
 * scripts/audit-inventory-endpoint.ts
 *
 * One-off audit of the /reporting/inventory endpoint to discover available
 * field schema. Specifically checks for sales velocity / last-sale data fields.
 *
 * Makes a single read-only GET request to Node 1 (5th Ave, retailerId: 1482)
 * using credentials from AWS Secrets Manager.
 *
 * Run: npx ts-node scripts/audit-inventory-endpoint.ts
 */

import { DutchieReadOnlyClient, StoreNode } from '../lib/dutchie/client';
import { Tier3HaltError } from '../lib/alerts';

async function auditInventoryEndpoint(): Promise<void> {
  console.info('[audit] Read-only GET to /reporting/inventory endpoint');
  console.info('[audit] Node: NODE_5TH_AVE (5th Ave), retailerId: 1482\n');

  try {
    const client = await DutchieReadOnlyClient.create();

    // Access private getJson method for this one-off audit.
    // This is a diagnostic script, not production code.
    const clientAny = client as any;
    const raw = await clientAny.getJson(
      StoreNode.NODE_5TH_AVE,
      '/reporting/inventory',
      { retailerId: 1482 },
    );

    console.info('=== ENDPOINT AUDIT RESULTS ===\n');

    // Analyze response structure
    if (Array.isArray(raw)) {
      console.info(`✓ Response is an array with ${raw.length} items\n`);

      if (raw.length > 0) {
        const firstItem = raw[0];
        const fields = Object.keys(firstItem).sort();

        console.info('--- First product object fields (alphabetical) ---');
        fields.forEach((field) => console.info(`  ${field}`));
        console.info(`\nTotal fields: ${fields.length}\n`);

        // Flag specific sales-related fields
        const salesFields = [
          'lastSoldAt',
          'lastSaleDate',
          'soldAt',
          'salesVelocity',
          'daysSinceLastSale',
          'lastSold',
          'saleDate',
          'velocity',
          'turnover',
          'turnoverRate',
        ];

        const foundSalesFields = salesFields.filter((sf) =>
          fields.some((field) => field.toLowerCase().includes(sf.toLowerCase())),
        );

        console.info('--- Sales velocity / last-sale field check ---');
        if (foundSalesFields.length > 0) {
          console.info('✓ FOUND sales-related fields:');
          foundSalesFields.forEach((f) => console.info(`  ✓ ${f}`));
          console.info(
            '\n→ These fields may provide true sales data (vs. lastModifiedDateUTC proxy).',
          );
        } else {
          console.info('✗ NO sales velocity or last-sale fields detected.');
          console.info(
            '  Searched for: lastSoldAt, lastSaleDate, soldAt, salesVelocity, daysSinceLastSale',
          );
          console.info(
            '\n→ Dead-stock detection will continue using lastModifiedDateUTC as proxy.',
          );
        }
      } else {
        console.info('Response array is empty (no inventory records).');
      }
    } else if (typeof raw === 'object' && raw !== null) {
      const topFields = Object.keys(raw).sort();
      console.info('✓ Response is an object\n');
      console.info('--- Top-level fields (alphabetical) ---');
      topFields.forEach((field) => console.info(`  ${field}`));
      console.info(`\nTotal top-level fields: ${topFields.length}`);
    } else {
      console.warn('⚠ Unexpected response type:', typeof raw);
    }
  } catch (err) {
    if (err instanceof Tier3HaltError) {
      console.error(
        '\n[audit] TIER_3 HALT — credentials not available in this environment.',
      );
      console.error(
        '[audit] Run this script on infrastructure with AWS Secrets Manager access.',
      );
      process.exitCode = 2;
      return;
    }
    console.error(
      `\n[audit] Request failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exitCode = 1;
  }
}

auditInventoryEndpoint();
