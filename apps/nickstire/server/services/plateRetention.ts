/**
 * Plate-read retention for the camera lane · ADR-0017 section 7.
 *
 * The 30-day plate-retention policy was implemented once, in statenour
 * (`apps/statenour/lib/services/plate-retention.ts`), against `device_events` in Neon.
 * Plate text ALSO lands in this app, in `vehicle_visits.plateText` in TiDB, written by
 * `POST /api/camera/visits` -- and nothing here ever removed it. The policy was enforced on
 * one of the two tables that hold plate text; the other accumulated indefinitely.
 *
 * That is silent today only because `VisionPipeline.step()` never constructs a `PlateLab`,
 * so the producer always sends `plateText: null`. The moment the recogniser is wired --
 * which is a one-line change on the edge, already on the roadmap -- plates start flowing
 * into a table with no expiry. This exists so that wiring is safe rather than a disclosure.
 *
 * THE POLICY, mirrored from statenour so the two cannot drift apart silently:
 *   a plate read lives 30 days UNLESS it matched a plate the customer gave us.
 * There, "matched" is `customerRef.status = 'matched'`. Here it is `customerMatch = 'EXACT'`
 * -- the only class that is allowed to bind `customerId` (`cameraVisitsRoutes.ts:214`).
 * `plateRetentionParity.test.ts` fails if the two windows stop agreeing.
 *
 * SCRUBBED IS NOT NONE. A scrubbed row sets `plateStatus = 'SCRUBBED'`, so a reader can
 * tell "we had a plate and the policy removed it" from "no plate was ever read". Collapsing
 * both to NONE is the empty-vs-error defect: a retention action would render as a camera
 * that never saw anything. Note that `SCRUBBED` is deliberately NOT in the ingest enum
 * `PLATE_STATUS` -- a producer must never be able to claim a read was already scrubbed.
 *
 * Cheap by construction, and it stays cheap. The driving predicate is
 * `plateText IS NOT NULL`, served by `idx_vehicle_visits_plateText`; once a row is scrubbed
 * its plateText is NULL and it leaves that index range forever. On a shop with no plate
 * recogniser wired the range is empty and the job reads nothing.
 */
import { sql } from "drizzle-orm";

/** Must equal statenour's `PLATE_RETENTION_DAYS`. Operator-owned: this is a policy number,
 *  not an engineering one. Ohio HB 725 (commercial-ALPR restriction) was still in House
 *  Public Safety Committee as of its 2026-03-24 hearing, so nothing external pins it yet. */
export const PLATE_RETENTION_DAYS = 30;

/** The status a scrubbed row carries. Not a member of the ingest enum, by design.
 *  Deliberately NOT exported: it is a value STORED in the database and read back by other
 *  code and by humans, so its test must pin the literal string. A test importing this
 *  constant would keep passing through a rename that silently changed the stored contract. */
const PLATE_SCRUBBED_STATUS = "SCRUBBED";

/** Rows touched per statement. TiDB bounds transaction size, and an unbounded UPDATE over a
 *  table that has been collecting for a year is exactly the shape that gets killed halfway
 *  and leaves the operator unable to say what was scrubbed.
 *  Reported on the result rather than exported: an operator reading "capped after 20000 rows"
 *  needs to know it was 40 batches of 500, and a constant nothing renders tells nobody that. */
const PLATE_SCRUB_BATCH = 500;

/** Safety stop. A run that wants more than this has hit something structural -- a clock
 *  jump, a backfill, a policy change -- and should be looked at rather than grinding all
 *  night. It reports `capped`, so a truncated run can never read as a completed one. */
const PLATE_SCRUB_MAX_BATCHES = 40;

export interface PlateScrubResult {
  scrubbed: number;
  batches: number;
  /** True when MAX_BATCHES stopped the run with work still pending. NEVER report a capped
   *  run as a clean one: the difference is "retention is current" vs "retention is behind". */
  capped: boolean;
  cutoff: Date;
  /** The batching this run used. On the result so the cron's operator message can say what
   *  a cap actually means -- "40 batches of 500" -- instead of an opaque row count. */
  batchSize: number;
  maxBatches: number;
}

/**
 * Null out plate text on expired, unlinked camera visits. Returns what it actually did.
 *
 * Throws if the database is unavailable. A retention job that swallows a failed connection
 * and returns `{ scrubbed: 0 }` reports "nothing to scrub" for a policy that has silently
 * stopped running -- the cron log would show a green job for as long as the outage lasts.
 */
export async function scrubExpiredPlates(now: Date = new Date()): Promise<PlateScrubResult> {
  const cutoff = new Date(now.getTime() - PLATE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { getDbTyped } = await import("../db");
  const d = await getDbTyped();
  if (!d) throw new Error("plate retention: database unavailable, nothing was scrubbed");

  const limits = { batchSize: PLATE_SCRUB_BATCH, maxBatches: PLATE_SCRUB_MAX_BATCHES };
  let scrubbed = 0;
  let batches = 0;
  for (; batches < PLATE_SCRUB_MAX_BATCHES; batches++) {
    const res = await d.execute(sql`
      UPDATE vehicle_visits
      SET plateText = NULL, plateStatus = ${PLATE_SCRUBBED_STATUS}
      WHERE plateText IS NOT NULL
        AND createdAt < ${cutoff}
        AND customerMatch <> 'EXACT'
      LIMIT ${PLATE_SCRUB_BATCH}
    `);
    const affected = affectedRows(res);
    scrubbed += affected;
    if (affected < PLATE_SCRUB_BATCH) {
      return { scrubbed, batches: batches + 1, capped: false, cutoff, ...limits };
    }
  }
  return { scrubbed, batches, capped: true, cutoff, ...limits };
}

/**
 * Rows affected by an UPDATE, across the shapes mysql2 and Drizzle return it in.
 *
 * Returns `null` when it cannot tell, and the caller treats that as "assume a full batch"
 * rather than as zero -- reading an unrecognised driver response as 0 would end the loop
 * on the first batch and leave the rest of the backlog unscrubbed under a green job.
 */
function affectedRows(res: unknown): number {
  const rows = Array.isArray(res) ? res[0] : res;
  const n = (rows as { affectedRows?: unknown } | null)?.affectedRows;
  return typeof n === "number" ? n : PLATE_SCRUB_BATCH;
}
