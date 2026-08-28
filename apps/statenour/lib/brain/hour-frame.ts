/**
 * lib/brain/hour-frame.ts — which clock an hour-encoding memory key was written in.
 *
 * THE SPLIT. FOUR BrainMemory keys embed an hour:
 *
 *     journal-ingest.ts       journal_mood_{date}_{h}      110 rows
 *     pipeline-controller.ts  mood_{date}_{h}              220 rows
 *     pipeline-controller.ts  booking_hour_{h}               0 rows
 *     pipeline-controller.ts  unanswered_leads_{date}_{h}    0 rows
 *
 * The 2026-08-26 audit that prompted this file found only THREE of them. The
 * fourth (`unanswered_leads`) was found by the discovery arm of
 * tests/repo/hour-frame.test.ts on its first run — which is the argument for
 * discovering these call sites instead of listing them by hand.
 *
 * Until #1809 those `{h}` values came from a bare `new Date().getHours()`, which
 * on Railway is UTC. After #1809 they come from `hourET()`. So the SAME
 * real-world hour writes a DIFFERENT key either side of the deploy, and the two
 * key spaces are not distinguishable from the row: `mood_2026-08-20_18` could be
 * 18:00 UTC or 18:00 ET depending only on when it was written.
 *
 * WHY THIS IS A MARKER AND NOT A MIGRATION. Measured 2026-08-26, before any
 * ET-keyed row existed:
 *
 *   · 330 rows across the two live families (journal_mood 110, mood 220),
 *     ALL of them UTC-keyed. booking_hour has never written a row.
 *   · ~1-3 new rows per day.
 *   · NOTHING READS THE HOUR. Every `key: { startsWith: ... }` consumer in the
 *     app targets other families (history:, coach:drift-recovery:, weekly_).
 *     These rows are read by CATEGORY — app/api/brain/time-travel/route.ts:153
 *     asks for the dominant `emotional_state` for a DAY — so the hour in the key
 *     is not an input to anything today.
 *
 * Rewriting 330 keys would be a production write with no measurable consumer on
 * the other end. Doing nothing would leave a silent ambiguity for whoever builds
 * the first hour-aware consumer. Stamping the frame costs nothing, touches no
 * existing row, and makes the question answerable from the data instead of from
 * a commit archaeology exercise.
 *
 * SO: rows written from here on carry `metadata.hourFrame = "et"`. A row with no
 * `hourFrame` is UTC-keyed and predates the boundary below. That is the whole
 * contract — absence is meaningful, which is why the marker is only ever added,
 * never backfilled.
 *
 * DECIDED 2026-08-28 (operator): EXCLUDE, don't migrate. Any consumer that
 * parses the {h} out of one of these keys must bound its query to rows at or
 * after HOUR_FRAME_BOUNDARY_ISO (`createdAt: { gte: new Date(HOUR_FRAME_BOUNDARY_ISO) }`)
 * and label the rendered window — "since 2026-08-25 (ET frame)" — rather than
 * silently aggregating a mixed series. Pre-boundary rows are RETAINED: correct
 * in their own frame, excluded from keyed-hour aggregates, never deleted.
 * tests/repo/hour-frame.test.ts discovers key-prefix READERS and fails any that
 * do not reference this boundary — the same ratchet the writer side has.
 *
 * Measured before deciding (census 2026-08-27 + engine audit 2026-08-28):
 *   · 218 live rows pre-boundary, 6 post (all marker-stamped), 111 soft-deleted.
 *   · The four analysis engines (decision-patterns, time-intelligence,
 *     teaching-moments, counter-intuitive) derive hours from ABSOLUTE
 *     `createdAt` via hourET() — DST-correct for rows of every era — and none
 *     reads these keys, so their aggregates were never mixed-frame. Their
 *     timestamp-based windows deliberately do NOT exclude pre-boundary rows.
 *   · Migration is technically viable (every row carries `createdAt`, so
 *     hourET(createdAt) rekeying would be DST-exact) — declined anyway: a
 *     rewrite of behavioural history with zero hour-readers on the other end.
 */

/** The clock an hour-encoding key was written in. Absent on a row = "utc". */
export const HOUR_FRAME_ET = "et" as const;

/**
 * #1809 merged at this instant; the deploy followed within minutes. Rows created
 * before it are UTC-keyed, rows after are ET-keyed. Recorded so a future
 * consumer can classify the unmarked rows by `created_at` without needing to
 * find the PR.
 */
export const HOUR_FRAME_BOUNDARY_ISO = "2026-08-25T15:17:30Z";

/**
 * Metadata to pass as `remember()`'s 5th argument from any call site whose KEY
 * embeds an hour. `tests/repo/hour-frame.test.ts` discovers those call sites and
 * fails if one of them omits this — so a fourth hour-encoding key added later
 * cannot quietly rejoin the ambiguity.
 */
export function hourFrameMeta(): { hourFrame: typeof HOUR_FRAME_ET } {
  return { hourFrame: HOUR_FRAME_ET };
}
