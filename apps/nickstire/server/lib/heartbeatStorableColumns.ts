/**
 * Which `camera_runtime` columns the DATABASE has right now, for writers AND readers.
 *
 * Migrations here are hand-applied, so there is always a window where the code names a
 * column production does not have. The heartbeat upsert names EVERY column, which used to
 * turn that window into "every camera heartbeat rejected for every producer until someone
 * applies the DDL and notices the lattice went STALE" (the warning on `handleRunMigrations`
 * says "apply before deploying" for exactly this). A reader has the mirror-image failure: a
 * SELECT that names a missing column 500s the Lot page and fails the alert cron every five
 * minutes, which is worse than not having the column at all.
 *
 * One catalog read serves both sides: `storableHeartbeatColumns` intersects the route's
 * column list with INFORMATION_SCHEMA once per process (refreshed every ten minutes and at
 * once on an unknown-column error) so a late apply drops ONLY the fields nobody can store
 * yet, says so once in the log, and keeps the row alive. `cameraRuntimeHasColumns` lets a
 * reader add the same columns to its SELECT only once they exist. Columns that predate 0124
 * are never dropped by the writer: they are the row, and a catalog that cannot see them is
 * a broken catalog, not a missing column.
 */
import { sql } from "drizzle-orm";

/**
 * camera_runtime columns added after the row's shape was first deployed (migration 0124
 * onward) -- the only ones production can plausibly lack.
 */
export const CAMERA_RUNTIME_COLUMNS_SINCE_0124: ReadonlySet<string> = new Set<string>([
  "relocateFailures", "preexistingCrossed",
  "arrivalsAfterStitch", "stitchedTotal", "stitchRefusedAmbiguous",
  "conversationWorkerOk", "conversationWorkerState", "conversationWorkerHeartbeatAt",
  "conversationAudioSource", "conversationCaptureHost", "conversationSttEngine",
  "conversationQueueDepth", "conversationLastTrigger", "lastConversationEventAt",
  "lastConversationCaptureAt", "lastConversationSttAt", "lastConversationPostAt",
  "lastConversationSummaryAt", "lastConversationCoverage", "conversationFailuresToday",
  "conversationLastError",
  // 0144 rolling windows
  "detectionsLast10m", "portalCrossingsLast60m",
  "conversationListeningCoverage60m", "conversationCaptureSecondsLast60m",
  "conversationCapturesLast60m", "conversationCaptureFailuresLast60m",
  "conversationWakeTriggersLast60m", "conversationTranscribeBacklog",
]);

/**
 * The 0144 rolling-window columns, in the order the readers select them. Readers add these
 * to a SELECT only when `cameraRuntimeHasColumns` says production has them.
 */
export const CAMERA_RUNTIME_WINDOW_COLUMNS_0144 = [
  "detectionsLast10m", "portalCrossingsLast60m",
  "conversationListeningCoverage60m", "conversationCaptureSecondsLast60m",
  "conversationCapturesLast60m", "conversationCaptureFailuresLast60m",
  "conversationWakeTriggersLast60m", "conversationTranscribeBacklog",
] as const;

type ColumnLister = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

const CATALOG_TTL_MS = 10 * 60 * 1000;
let catalogCache: { at: number; present: ReadonlySet<string> } | null = null;
/** The last `missing` list the writer logged, so a stable gap is said once, not per heartbeat. */
let loggedMissing: string | null = null;

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const list = Array.isArray(result) ? result[0] : result;
  return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
}

/** Forget what the catalog said; the next caller asks again. */
export function resetStorableHeartbeatColumns(): void {
  catalogCache = null;
  loggedMissing = null;
}

/**
 * The catalog's view of `camera_runtime`, cached for the TTL. `null` when it could not be
 * read or came back empty: an outage of the catalog is not information about any column.
 */
async function cameraRuntimeCatalog(d: ColumnLister, now: number): Promise<ReadonlySet<string> | null> {
  if (catalogCache && now - catalogCache.at < CATALOG_TTL_MS) return catalogCache.present;
  try {
    const rows = rowsOf(await d.execute(sql`
      SELECT COLUMN_NAME AS columnName FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'camera_runtime'
    `));
    if (rows.length === 0) return null;
    const present = new Set(rows.map((r) => String(r.columnName ?? r.COLUMN_NAME ?? "")));
    catalogCache = { at: now, present };
    return present;
  } catch {
    return null;
  }
}

/**
 * `all` minus the post-0124 columns production does not have yet.
 *
 * Falls back to the FULL list when the catalog cannot be read or returns nothing: that is
 * the behaviour this replaces, and a catalog outage must not start silently dropping fields
 * that are perfectly storable.
 */
export async function storableHeartbeatColumns<T extends string>(
  d: ColumnLister,
  all: readonly T[],
  since: ReadonlySet<string>,
  now: number = Date.now(),
  log: (msg: string) => void = (msg) => console.info(msg),
): Promise<readonly T[]> {
  const present = await cameraRuntimeCatalog(d, now);
  if (present === null) return all;
  const columns = all.filter((c) => !since.has(c) || present.has(c));
  const missing = all.filter((c) => !columns.includes(c));
  const missingKey = JSON.stringify(missing);
  if (missing.length && missingKey !== loggedMissing) {
    log(`[camera-heartbeat] camera_runtime lacks ${missing.join(", ")}; those fields are DROPPED until the migration is applied (drizzle/0144, or Admin > run migrations)`);
  }
  loggedMissing = missing.length ? missingKey : null;
  return columns;
}

/**
 * Does production have EVERY one of `names`? For readers: add a column to a SELECT only on
 * `true`. An unreadable catalog answers `false` -- the safe direction for a reader, since
 * leaving a column out of a SELECT costs a NULL on a card while naming a missing one costs
 * the whole read.
 */
export async function cameraRuntimeHasColumns(
  d: ColumnLister,
  names: readonly string[],
  now: number = Date.now(),
): Promise<boolean> {
  const present = await cameraRuntimeCatalog(d, now);
  if (present === null) return false;
  return names.every((n) => present.has(n));
}

/**
 * The `ON DUPLICATE KEY UPDATE` clause for one column set, every assignment guarded by
 * `accept`. The ORDER is semantic -- see the derivation above `HEARTBEAT_GUARDED_SET` in
 * routes/cameraVisitsRoutes.ts: plain columns first, then `stateSince` (reads the OLD
 * `state`), then `state`, `heartbeatSeq`, `producerInstanceId`, and `receivedAt` LAST so
 * every guard before it still sees the pre-statement liveness clock.
 */
export function heartbeatGuardedSetFor(
  columns: readonly string[],
  accept: string,
  readByGuards: readonly string[],
): string {
  const guard = (c: string) => `\`${c}\` = IF(${accept}, VALUES(\`${c}\`), \`${c}\`)`;
  const reserved = new Set<string>(readByGuards);
  const plain = columns.filter((c) => c !== "camera" && !reserved.has(c));
  const acceptedAfterDiscriminators =
    "(VALUES(`producerInstanceId`) = `producerInstanceId` AND VALUES(`heartbeatSeq`) >= `heartbeatSeq`)";
  return [
    ...plain.map(guard),
    // Before `state`, or it compares the new state to itself and never fires.
    `\`stateSince\` = IF(${accept} AND VALUES(\`state\`) <> \`state\`, NOW(), \`stateSince\`)`,
    guard("state"),
    guard("heartbeatSeq"),
    guard("producerInstanceId"),
    // LAST: every accept guard above must still see the pre-statement liveness clock.
    `\`receivedAt\` = IF(${acceptedAfterDiscriminators}, NOW(), \`receivedAt\`)`,
  ].join(", ");
}
