/**
 * Self-contained pipeline domain types.
 *
 * WHY THIS EXISTS (Railway frontend-only build root):
 * ---------------------------------------------------
 * The repo root modules/ and lib/ directories are NOT part of Railway's deploy
 * context (Railway's configured build root is `frontend/`). Runtime code that
 * must execute inside the deployed container therefore CANNOT import those
 * repo-root modules — `experimental.externalDir` only resolves them in local /
 * monorepo dev, never in the standalone Railway build.
 *
 * These types are intentionally structurally identical to their repo-root
 * counterparts (modules/**, lib/dutchie/client.ts) so the JSON artifacts this
 * pipeline writes remain byte-compatible with what frontend/lib/data-loader.ts
 * (and the existing pages/types re-exported via `@backend/*`) already read.
 */

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

/** Minimal typed shape for the Dutchie /products read response. */
export interface DutchieProduct {
  readonly id: string;
  readonly name: string;
  readonly category?: string;
  readonly price?: number;
  readonly quantityAvailable?: number;
  readonly recPrice?: number;
  readonly unitCost?: number;
  readonly lastModifiedDateUTC?: string;
  readonly vendorId?: string;
  readonly vendorName?: string;
}

/**
 * Alert tier string literals. Mirrors the repo-root `AlertTier` string enum
 * VALUES exactly so persisted JSON stays identical. We only need the surfacing
 * tiers used by the margin scanner output here.
 */
export type PipelineAlertTier = 'TIER_1' | 'TIER_2' | 'TIER_3';
