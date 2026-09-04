/**
 * Self-contained, READ-ONLY Dutchie POS client for the Railway frontend build.
 *
 * WHY A SEPARATE CLIENT (not the repo-root lib/dutchie/client.ts)?
 * ---------------------------------------------------------------
 * The repo-root client depends on lib/vault/secrets.ts, which imports the AWS
 * SDK (`@aws-sdk/client-secrets-manager`) — a dependency the frontend package
 * deliberately does NOT carry, and repo-root files are outside Railway's
 * frontend-only deploy root. To keep the cron route fully self-contained and
 * deployable standalone, this client reads its read-only credentials directly
 * from `process.env` (which is exactly how they are provided on Railway).
 *
 * HARD RULES preserved from the backend client:
 *   - READ-ONLY: only GET is ever issued; there is no verb parameter and no
 *     mutation method. It cannot write to Dutchie.
 *   - No hardcoded secrets: every credential is read from process.env only.
 */

import { StoreNode, type DutchieProduct } from './types';

const DEFAULT_API_BASE_URL = 'https://api.pos.dutchie.com';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface DutchieEnvSecrets {
  readonly apiBaseUrl: string;
  readonly apiKey5thAve: string;
  readonly apiKey9thAve: string;
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Resolve read-only Dutchie credentials from environment variables.
 * Throws a descriptive error (no secret values in the message) when the
 * required keys are absent, so the route can fail closed with a 500.
 */
export function resolveDutchieEnvSecrets(): DutchieEnvSecrets {
  const apiKey5thAve = process.env['DUTCHIE_API_KEY_5TH_AVE'];
  const apiKey9thAve = process.env['DUTCHIE_API_KEY_9TH_AVE'];
  const apiBaseUrl = process.env['DUTCHIE_API_BASE_URL'];

  const missing: string[] = [];
  if (!nonEmpty(apiKey5thAve)) missing.push('DUTCHIE_API_KEY_5TH_AVE');
  if (!nonEmpty(apiKey9thAve)) missing.push('DUTCHIE_API_KEY_9TH_AVE');
  if (missing.length > 0) {
    throw new Error(
      `Missing required Dutchie env var(s): ${missing.join(', ')}. ` +
        'Configure read-only API keys in the deployment environment.',
    );
  }

  return {
    apiBaseUrl: nonEmpty(apiBaseUrl) ? apiBaseUrl.trim() : DEFAULT_API_BASE_URL,
    apiKey5thAve: (apiKey5thAve as string).trim(),
    apiKey9thAve: (apiKey9thAve as string).trim(),
  };
}

export interface DutchieClientOptions {
  readonly timeoutMs?: number;
}

/**
 * Return the first argument that is a non-empty (trimmed) string, else undefined.
 * Scoped helper for the defensive product-name / id fallback below — production
 * Dutchie catalog payloads have been observed to place the human name / id under
 * alternate keys, leaving `item.name` / `item.id` empty.
 */
function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

/** Safely read a nested object value (e.g. `item.product`) as a record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export class FrontendDutchieReadOnlyClient {
  private readonly secrets: DutchieEnvSecrets;
  private readonly timeoutMs: number;

  constructor(secrets: DutchieEnvSecrets, options: DutchieClientOptions = {}) {
    this.secrets = secrets;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Factory that resolves credentials from process.env. */
  static fromEnv(options: DutchieClientOptions = {}): FrontendDutchieReadOnlyClient {
    return new FrontendDutchieReadOnlyClient(resolveDutchieEnvSecrets(), options);
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
   * Low-level READ helper. Locked to HTTP GET — no verb parameter exists, so
   * no write can ever be issued from here.
   */
  private async getJson<T>(node: StoreNode, path: string): Promise<T> {
    const apiKey = this.apiKeyFor(node);
    const url = new URL(path, this.secrets.apiBaseUrl);

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
  }

  /** READ: fetch the active product menu/inventory for a node. */
  async getProducts(node: StoreNode): Promise<DutchieProduct[]> {
    const raw = await this.getJson<unknown>(node, '/products');
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null,
      )
      .map((item) => {
        // Defensive fallback: production Dutchie payloads sometimes carry the
        // human-readable name / id under alternate keys (or nested under
        // `product`), leaving the canonical `name` / `id` empty. Resolve across
        // the known aliases in priority order so reorderWatch / margin / vendor
        // outputs never end up with `name: ''` / `productId: ''`.
        const nested = asRecord(item['product']);
        const resolvedName =
          firstNonEmptyString(
            item['name'],
            item['productName'],
            nested?.['name'],
            item['title'],
            item['productTitle'],
            item['brand'],
          ) ?? 'Unnamed Product';
        const resolvedId =
          firstNonEmptyString(
            item['productId'],
            nested?.['id'],
            item['id'],
            item['sku'],
          ) ?? '';

        const product: DutchieProduct = {
          id: resolvedId,
          name: resolvedName,
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
