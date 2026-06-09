/**
 * sheetsSyncHealth — pure status mapper for the "Sheets Sync Health" card.
 *
 * server/sheets-sync.ts is fire-and-forget: it logs FAILURES only and tracks
 * NO last-success timestamp or row count. So this derives sync trustworthiness
 * purely from the wave-1 `adminDashboard.integrationFailures` feed, filtered to
 * `failureType === "sheets_sync"` (already scrubbed of secrets server-side).
 *
 * HONESTY · because no success signal exists, "Healthy" means only "no recent
 * Sheets-sync failures logged" — the card never claims a positive sync nor
 * invents a last-success time/row count. `status === "unknown"` while the feed
 * hasn't loaded.
 *
 * Pure + side-effect-free so the status thresholds are unit-tested in
 * client/src/__tests__/sheets-sync-health.test.ts.
 */

/** failureType emitted by sheets-sync producers (lead.ts / booking.ts / emergency.ts). */
export const SHEETS_SYNC_FAILURE_TYPE = "sheets_sync";

export type SheetsSyncStatus = "healthy" | "warning" | "failing" | "unknown";

/** Narrow structural view of one scrubbed failure row (subset of the tRPC shape). */
export interface SyncFailureRow {
  failureType: string;
  /** Already scrubbed + truncated server-side — safe to display. */
  message: string;
  resolved: boolean;
  createdAt: string | Date;
}

export interface SheetsSyncHealth {
  status: SheetsSyncStatus;
  /** Most recent sheets_sync failure (feed is server-sorted desc), or null. */
  lastFailure: { message: string; createdAt: string | Date; resolved: boolean } | null;
  /** sheets_sync failures still unresolved in the recent window. */
  unresolvedCount: number;
  /** sheets_sync failures present in the recent window (any resolution). */
  recentCount: number;
}

/**
 * Map the integration-failures feed onto a Sheets-sync health status.
 *
 *   no feed yet                       -> "unknown"
 *   no sheets_sync failures in window -> "healthy"  (no failures logged)
 *   >=1 unresolved sheets_sync        -> "failing"  (active breakage)
 *   only resolved sheets_sync         -> "warning"  (broke recently, recovered)
 */
export function deriveSheetsSyncHealth(
  failData: { failures: SyncFailureRow[] } | null | undefined,
): SheetsSyncHealth {
  if (!failData) {
    return { status: "unknown", lastFailure: null, unresolvedCount: 0, recentCount: 0 };
  }

  const sheets = failData.failures.filter((f) => f.failureType === SHEETS_SYNC_FAILURE_TYPE);
  const unresolvedCount = sheets.filter((f) => !f.resolved).length;
  const recentCount = sheets.length;
  const first = sheets[0];
  const lastFailure = first
    ? { message: first.message, createdAt: first.createdAt, resolved: first.resolved }
    : null;

  let status: SheetsSyncStatus;
  if (recentCount === 0) status = "healthy";
  else if (unresolvedCount > 0) status = "failing";
  else status = "warning";

  return { status, lastFailure, unresolvedCount, recentCount };
}
