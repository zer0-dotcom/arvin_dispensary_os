/**
 * Frontend data contracts.
 *
 * These are re-exported DIRECTLY from the backend source via the `@backend/*`
 * path alias (approved: type-drift protection). Because they are `import type`
 * re-exports, they are fully erased at build time — no backend runtime code,
 * no secrets, and no AWS/Dutchie modules are pulled into the frontend bundle.
 * If a backend interface changes, `tsc` fails here immediately, flagging drift.
 *
 * Origins:
 *   WeeklyDossier, *Section, NodeComparisonRow  -> modules/forward-intelligence/dossier-synthesizer.ts
 *   ReorderAlert, DemandForecastResult          -> modules/forward-intelligence/demand-forecaster.ts
 *   VendorScorecard                             -> modules/forward-intelligence/vendor-scorecard.ts
 *   MarginScanResult, MarginFlag, DeadStockFlag -> modules/margin-scanner/scanner.ts
 *   SweepResult, CompetitorSnapshot, CompetitorProduct -> modules/competitor-radar/scraper.ts
 */

export type {
  WeeklyDossier,
  InventoryHealthSection,
  ReorderWatchSection,
  VendorRankingsSection,
  NodeComparisonRow,
} from '@backend/modules/forward-intelligence/dossier-synthesizer';

export type {
  ReorderAlert,
  DemandForecastResult,
} from '@backend/modules/forward-intelligence/demand-forecaster';

export type { VendorScorecard } from '@backend/modules/forward-intelligence/vendor-scorecard';

export type {
  MarginScanResult,
  MarginFlag,
  DeadStockFlag,
} from '@backend/modules/margin-scanner/scanner';

export type {
  SweepResult,
  CompetitorSnapshot,
  CompetitorProduct,
} from '@backend/modules/competitor-radar/scraper';

/**
 * Discriminated union returned by every loader. Pages MUST switch on `status`,
 * which makes "no fabrication on missing data" (Rule §1.3) a compile-time
 * obligation rather than a convention.
 */
export type LoadResult<T> =
  | { status: 'ok'; data: T; sourceFile: string; loadedAt: string }
  | { status: 'missing' }
  | { status: 'error'; message: string };
