/**
 * Types for `dev-db.mjs`, which is plain JS.
 *
 * Why this exists: both harnesses that import it (`verify-reel-vo.mts` and
 * `verify-reel-shadow-readout.mts`) were resolving `startDevDb` as implicit
 * `any`. Nobody saw it because `scripts/` is outside `tsconfig.json`'s include
 * ("client/src", "shared", "server"), so `pnpm typecheck` never looks there —
 * the error only appears if you point tsc at a script deliberately. Declaring
 * the shape here fixes both callers rather than casting at each import.
 *
 * Keep in sync with dev-db.mjs by hand; there is no generator.
 */
export declare const EXPECTED_TABLE_COUNT: number;

export declare function startDevDb(options?: {
  /** Schema/database name. Default "nickstire". */
  dbName?: string;
  /** Apply the full Drizzle schema via drizzle-kit push. Default true. */
  applySchema?: boolean;
  /** Suppress the [dev-db] progress lines. Default false. */
  quiet?: boolean;
}): Promise<{
  /** mysql:// URL for the throwaway server — never production. */
  url: string;
  port: number;
  /** ALWAYS call this (try/finally) or the child MySQL leaks. */
  stop: () => Promise<void>;
}>;
