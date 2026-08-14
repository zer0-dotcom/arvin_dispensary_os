/**
 * Secrets loader.
 *
 * Resolution order:
 *   1. AWS Secrets Manager at `prod/dispensary-os/dutchie` (production path).
 *   2. Fallback to `process.env` (LOCAL DEV / build-time only) if AWS is
 *      unreachable or not configured.
 *
 * HARD RULE: no credential value is ever hardcoded in this file. The only
 * literals here are AWS resource paths and the NAMES of env vars — never their
 * values. See `.env.example` for the placeholder env var contract.
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { AlertTier, triggerAlert } from '../alerts';

/** Default AWS Secrets Manager path holding the Dutchie read-only credentials. */
export const DEFAULT_DUTCHIE_SECRET_PATH = 'prod/dispensary-os/dutchie';

/**
 * Shape of the Dutchie credential bundle. READ-ONLY keys only.
 * Stored in Secrets Manager as a JSON blob with these keys, or provided via
 * the matching env vars (see `.env.example`) for local dev.
 */
export interface DutchieSecrets {
  readonly apiBaseUrl: string;
  /** Read-only API key for NY Canna Co 5th Ave (NODE_5TH_AVE). */
  readonly apiKey5thAve: string;
  /** Read-only API key for NY Cannabis Co 9th Ave (NODE_9TH_AVE). */
  readonly apiKey9thAve: string;
}

export type SecretsSource = 'aws-secrets-manager' | 'process-env';

export interface LoadedSecrets {
  readonly secrets: DutchieSecrets;
  readonly source: SecretsSource;
}

const DEFAULT_API_BASE_URL = 'https://api.pos.dutchie.com';

/** Read the secret path from env, defaulting to the production path. */
function resolveSecretPath(): string {
  const fromEnv = process.env['DUTCHIE_SECRET_PATH'];
  return fromEnv && fromEnv.trim().length > 0
    ? fromEnv.trim()
    : DEFAULT_DUTCHIE_SECRET_PATH;
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Parse and validate the JSON blob stored in Secrets Manager into typed
 * `DutchieSecrets`. Throws if required keys are missing so callers surface a
 * clear alert rather than proceeding with partial credentials.
 */
function parseSecretString(raw: string): DutchieSecrets {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Secret payload at Secrets Manager path is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Secret payload is not a JSON object.');
  }

  const obj = parsed as Record<string, unknown>;
  const apiBaseUrl =
    typeof obj['apiBaseUrl'] === 'string' && obj['apiBaseUrl'].length > 0
      ? (obj['apiBaseUrl'] as string)
      : DEFAULT_API_BASE_URL;
  const apiKey5thAve = obj['apiKey5thAve'];
  const apiKey9thAve = obj['apiKey9thAve'];

  if (typeof apiKey5thAve !== 'string' || apiKey5thAve.length === 0) {
    throw new Error("Secret payload missing 'apiKey5thAve'.");
  }
  if (typeof apiKey9thAve !== 'string' || apiKey9thAve.length === 0) {
    throw new Error("Secret payload missing 'apiKey9thAve'.");
  }

  return {
    apiBaseUrl,
    apiKey5thAve,
    apiKey9thAve,
  };
}

/**
 * Attempt to load secrets from AWS Secrets Manager.
 * Returns `null` (rather than throwing) on any failure, so the caller can fall
 * back to process.env. A TIER_2 alert is surfaced to record the degradation.
 */
async function tryLoadFromAws(secretPath: string): Promise<DutchieSecrets | null> {
  try {
    const region = process.env['AWS_REGION'] ?? 'us-east-1';
    const client = new SecretsManagerClient({ region });
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretPath }),
    );

    if (!nonEmpty(response.SecretString)) {
      throw new Error('Secrets Manager returned an empty SecretString.');
    }
    return parseSecretString(response.SecretString);
  } catch (err) {
    // Not fatal on its own — we will try the env fallback next.
    triggerAlert(
      AlertTier.TIER_2,
      'Could not load Dutchie secrets from AWS Secrets Manager; will attempt process.env fallback.',
      {
        source: 'vault.secrets',
        meta: { secretPath },
        cause: err,
      },
    );
    return null;
  }
}

/**
 * Attempt to load secrets from environment variables (LOCAL DEV / build only).
 *
 * Env var contract (values are placeholders in `.env.example`, never real):
 *   DUTCHIE_API_BASE_URL      (optional; defaults to the public POS base url)
 *   DUTCHIE_API_KEY_5TH_AVE   (required for fallback)
 *   DUTCHIE_API_KEY_9TH_AVE   (required for fallback)
 *
 * Returns `null` if the required env vars are absent.
 */
function tryLoadFromEnv(): DutchieSecrets | null {
  const apiKey5thAve = process.env['DUTCHIE_API_KEY_5TH_AVE'];
  const apiKey9thAve = process.env['DUTCHIE_API_KEY_9TH_AVE'];
  const apiBaseUrl = process.env['DUTCHIE_API_BASE_URL'];

  if (!nonEmpty(apiKey5thAve) || !nonEmpty(apiKey9thAve)) {
    return null;
  }

  return {
    apiBaseUrl: nonEmpty(apiBaseUrl) ? apiBaseUrl.trim() : DEFAULT_API_BASE_URL,
    apiKey5thAve: apiKey5thAve.trim(),
    apiKey9thAve: apiKey9thAve.trim(),
  };
}

let cached: LoadedSecrets | null = null;

/**
 * Load the Dutchie read-only credentials, preferring AWS Secrets Manager and
 * falling back to process.env. The result is cached for the process lifetime.
 *
 * Raises a TIER_3 (halt + surface) alert if NO credential source is available,
 * because proceeding without credentials cannot be auto-remediated and needs a
 * human to fix configuration.
 */
export async function loadDutchieSecrets(
  options: { forceReload?: boolean } = {},
): Promise<LoadedSecrets> {
  if (cached && !options.forceReload) {
    return cached;
  }

  const secretPath = resolveSecretPath();

  const fromAws = await tryLoadFromAws(secretPath);
  if (fromAws) {
    cached = { secrets: fromAws, source: 'aws-secrets-manager' };
    return cached;
  }

  const fromEnv = tryLoadFromEnv();
  if (fromEnv) {
    triggerAlert(
      AlertTier.TIER_1,
      'Using process.env fallback for Dutchie secrets (local/dev mode).',
      { source: 'vault.secrets', meta: { secretPath } },
    );
    cached = { secrets: fromEnv, source: 'process-env' };
    return cached;
  }

  // No credentials anywhere — halt and surface for a human. `triggerAlert`
  // throws Tier3HaltError here; the return below is unreachable but keeps the
  // control-flow analysis explicit.
  triggerAlert(
    AlertTier.TIER_3,
    'No Dutchie credentials available from AWS Secrets Manager or process.env. ' +
      'Human review required to configure the secret path or local env vars.',
    { source: 'vault.secrets', meta: { secretPath } },
  );
  throw new Error('unreachable: TIER_3 alert should have halted execution');
}

/** Reset the in-memory cache (primarily for tests / forced reloads). */
export function clearSecretsCache(): void {
  cached = null;
}
