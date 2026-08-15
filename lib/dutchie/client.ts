/**
 * Read-only Dutchie POS API client.
 *
 * HARD RULES enforced here:
 *   - READ-ONLY. This client exposes ONLY GET-style read methods. There are no
 *     create/update/delete/mutation methods, and the low-level request helper
 *     is locked to the HTTP GET method — it cannot issue writes.
 *   - Every network call is wrapped through the alert system (`guard`).
 *   - Credentials come exclusively from the secrets vault; nothing hardcoded.
 *
 * The two physical store locations are modelled as "nodes":
 *   NODE_5TH_AVE — NY Canna Co 5th Ave
 *   NODE_9TH_AVE — NY Cannabis Co 9th Ave
 */

import { AlertTier, guard } from '../alerts';
import { DutchieSecrets, loadDutchieSecrets } from '../vault/secrets';

/** Stable identifiers for the operator's two retail locations. */
export enum StoreNode {
  NODE_5TH_AVE = 'NODE_5TH_AVE',
  NODE_9TH_AVE = 'NODE_9TH_AVE',
}

export const ALL_STORE_NODES: readonly StoreNode[] = [
  StoreNode.NODE_5TH_AVE,
  StoreNode.NODE_9TH_AVE,
];

export interface StoreNodeInfo {
  readonly node: StoreNode;
  readonly displayName: string;
}

export const STORE_NODE_INFO: Readonly<Record<StoreNode, StoreNodeInfo>> = {
  [StoreNode.NODE_5TH_AVE]: {
    node: StoreNode.NODE_5TH_AVE,
    displayName: 'NY Canna Co 5th Ave',
  },
  [StoreNode.NODE_9TH_AVE]: {
    node: StoreNode.NODE_9TH_AVE,
    displayName: 'NY Cannabis Co 9th Ave',
  },
};

/** Minimal typed shapes for the read responses this client consumes. */
export interface DutchieProduct {
  readonly id: string;
  readonly name: string;
  readonly category?: string;
  readonly price?: number;
  readonly quantityAvailable?: number;
  /** Recommended (retail) price, when the API provides it separately. */
  readonly recPrice?: number;
  /** Internal unit cost / COGS, when available. Used for margin math. */
  readonly unitCost?: number;
  /** ISO timestamp of the last catalog modification (NOT last sale). Used as a proxy for dead-stock detection. */
  readonly lastModifiedDateUTC?: string;
  /** Vendor / brand identifier, when available. Used for vendor scorecards. */
  readonly vendorId?: string;
  /** Vendor / brand display name, when available. Used for vendor scorecards. */
  readonly vendorName?: string;
}

export interface NodeVerificationResult {
  readonly node: StoreNode;
  readonly displayName: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** Default per-request timeout (ms). */
const DEFAULT_TIMEOUT_MS = 15_000;

export interface DutchieClientOptions {
  /** Override request timeout in milliseconds. */
  readonly timeoutMs?: number;
}

export class DutchieReadOnlyClient {
  private readonly secrets: DutchieSecrets;
  private readonly timeoutMs: number;

  private constructor(secrets: DutchieSecrets, options: DutchieClientOptions) {
    this.secrets = secrets;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Factory: builds a client with credentials resolved from the secrets vault
   * (AWS Secrets Manager, or process.env fallback).
   */
  public static async create(
    options: DutchieClientOptions = {},
  ): Promise<DutchieReadOnlyClient> {
    const { secrets } = await loadDutchieSecrets();
    return new DutchieReadOnlyClient(secrets, options);
  }

  private apiKeyFor(node: StoreNode): string {
    switch (node) {
      case StoreNode.NODE_5TH_AVE:
        return this.secrets.apiKey5thAve;
      case StoreNode.NODE_9TH_AVE:
        return this.secrets.apiKey9thAve;
      default: {
        const _exhaustive: never = node;
        throw new Error(`Unknown store node: ${String(_exhaustive)}`);
      }
    }
  }

  /**
   * Low-level READ request helper. Locked to HTTP GET — there is deliberately
   * no parameter to change the verb, so no write can ever be issued from here.
   * Wrapped through the alert system.
   */
  private async getJson<T>(
    node: StoreNode,
    path: string,
    query: Readonly<Record<string, string | number>> = {},
  ): Promise<T> {
    const apiKey = this.apiKeyFor(node);
    const url = new URL(path, this.secrets.apiBaseUrl);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }

    return guard<T>(
      {
        source: 'dutchie.client',
        meta: { node, path: url.pathname },
      },
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const response = await fetch(url.toString(), {
            method: 'GET', // READ-ONLY: never anything other than GET.
            headers: {
              Accept: 'application/json',
              // Dutchie POS uses HTTP Basic with the API key as the username.
              Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
            },
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error(
              `Dutchie API responded ${response.status} ${response.statusText} for ${url.pathname}`,
            );
          }
          return (await response.json()) as T;
        } finally {
          clearTimeout(timer);
        }
      },
      AlertTier.TIER_2,
    );
  }

  /**
   * Verify authentication/connectivity for a single node. Read-only probe.
   * Never throws for an auth failure — returns a structured result so callers
   * can aggregate across nodes via Promise.allSettled.
   */
  public async verifyNode(node: StoreNode): Promise<NodeVerificationResult> {
    const info = STORE_NODE_INFO[node];
    try {
      // A lightweight read endpoint used purely to confirm the key works.
      await this.getJson<unknown>(node, '/util/ping');
      return {
        node,
        displayName: info.displayName,
        ok: true,
        detail: 'Authenticated successfully (read-only).',
      };
    } catch (err) {
      return {
        node,
        displayName: info.displayName,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * READ: fetch the active product menu/inventory for a node.
   * Returns a typed product list. Wrapped through the alert system.
   */
  public async getProducts(node: StoreNode): Promise<DutchieProduct[]> {
    const raw = await this.getJson<unknown>(node, '/products');
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter((item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null,
      )
      .map((item) => {
        const product: DutchieProduct = {
          id: String(item['id'] ?? ''),
          name: String(item['name'] ?? ''),
          ...(typeof item['category'] === 'string'
            ? { category: item['category'] as string }
            : {}),
          ...(typeof item['price'] === 'number'
            ? { price: item['price'] as number }
            : {}),
          ...(typeof item['quantityAvailable'] === 'number'
            ? { quantityAvailable: item['quantityAvailable'] as number }
            : {}),
          ...(typeof item['recPrice'] === 'number'
            ? { recPrice: item['recPrice'] as number }
            : {}),
          ...(typeof item['unitCost'] === 'number'
            ? { unitCost: item['unitCost'] as number }
            : {}),
          ...(typeof item['lastModifiedDateUTC'] === 'string'
            ? { lastModifiedDateUTC: item['lastModifiedDateUTC'] as string }
            : {}),
          ...(typeof item['vendorId'] === 'string'
            ? { vendorId: item['vendorId'] as string }
            : {}),
          ...(typeof item['vendorName'] === 'string'
            ? { vendorName: item['vendorName'] as string }
            : {}),
        };
        return product;
      });
  }
}
