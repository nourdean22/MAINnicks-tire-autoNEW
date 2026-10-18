/**
 * Queue-age readers: one per QUEUE_AGE_DECLARATIONS loop. READ-ONLY.
 *
 * Each returns { oldestDueAtMs, readFailed } for the oldest row its consumer
 * would select and has not processed. The age is computed IN SQL with
 * TIMESTAMPDIFF(MINUTE, <due>, NOW()) because driver-parsed TiDB datetimes come
 * back shifted on ET (apps/nickstire/AGENTS.md > Time); it is turned into an
 * epoch with the caller's nowMs only so classifyQueueAge keeps one input shape.
 *
 * Empty vs error: no DB, a thrown query and an unexpected result shape are all
 * readFailed. Only a successful read that found nothing is "no due row".
 * Identifiers below were checked against drizzle/schema.ts (lint:sql re-checks).
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import type { QueueAgeRead } from "./queueAge";

const MIN = 60_000;
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);
const failed = (error: string): QueueAgeRead => ({ oldestDueAtMs: null, readFailed: true, error });

async function rowsOf(query: SQL): Promise<Array<Record<string, unknown>> | string> {
  const d = await getDb();
  if (!d) return "database unavailable";
  const [raw] = (await d.execute(query)) as unknown as [unknown];
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : "unexpected result shape";
}

function fromAge(ageMinutes: unknown, nowMs: number): QueueAgeRead {
  if (ageMinutes === null || ageMinutes === undefined) return { oldestDueAtMs: null, readFailed: false };
  const n = Number(ageMinutes);
  if (!Number.isFinite(n)) return failed(`age is not a number: ${String(ageMinutes).slice(0, 40)}`);
  return { oldestDueAtMs: nowMs - n * MIN, readFailed: false };
}

/** A MAX() aggregate: exactly one row, NULL when nothing matched. */
async function oldestByAggregate(query: SQL, nowMs: number): Promise<QueueAgeRead> {
  try {
    const rows = await rowsOf(query);
    if (typeof rows === "string") return failed(rows);
    if (rows.length !== 1) return failed(`aggregate returned ${rows.length} rows`);
    return fromAge(rows[0].ageMinutes, nowMs);
  } catch (err) {
    return failed(errText(err));
  }
}

/** Exactly what getDueReminders() (server/db.ts) selects for processReminderQueue. */
function readReminderQueue(nowMs: number): Promise<QueueAgeRead> {
  return oldestByAggregate(
    sql`SELECT MAX(TIMESTAMPDIFF(MINUTE, nextDueDate, NOW())) AS ageMinutes
          FROM service_reminders
         WHERE status = 'scheduled' AND nextDueDate <= NOW()`,
    nowMs,
  );
}

/**
 * Mirrors runFollowupCadence (cron/jobs/followupCadence.ts): completed bookings
 * created 7..65 days ago whose EARLIEST un-fired touch (d7, then d30, then d60)
 * is past due. Opted-out and malformed phones are dropped the same way the job
 * drops them, because the job skips those forever without writing a row and
 * they would otherwise read as permanently stuck.
 */
async function readFollowupCadence(nowMs: number): Promise<QueueAgeRead> {
  if (!process.env.VAPI_API_KEY) return { oldestDueAtMs: null, readFailed: false, skipped: "VAPI_API_KEY missing" };
  if (process.env.FEATURE_FOLLOWUP_CADENCE !== "1") {
    return { oldestDueAtMs: null, readFailed: false, skipped: "FEATURE_FOLLOWUP_CADENCE != '1'" };
  }
  if (process.env.FOLLOWUP_CADENCE_DRY_RUN === "1") {
    return { oldestDueAtMs: null, readFailed: false, skipped: "FOLLOWUP_CADENCE_DRY_RUN=1 writes no touch rows" };
  }
  try {
    const { loadSuppressionIndex } = await import("../sms");
    const suppression = await loadSuppressionIndex();
    if (!suppression.ok) return failed(`suppression index unreadable: ${suppression.reason}`);
    if (suppression.stale) return failed("suppression index is stale");
    // shortcut: LIMIT 2000 rows of a 58-day window; upgrade to SQL-side suppression if completed bookings ever exceed it.
    const rows = await rowsOf(sql`
      SELECT b.phone AS phone,
             TIMESTAMPDIFF(MINUTE,
               DATE_ADD(b.createdAt, INTERVAL (CASE WHEN f7.id IS NULL THEN 7 WHEN f30.id IS NULL THEN 30 ELSE 60 END) DAY),
               NOW()) AS ageMinutes
        FROM bookings b
        LEFT JOIN voice_followups f7 ON f7.bookingId = b.id AND f7.touch = 'd7'
        LEFT JOIN voice_followups f30 ON f30.bookingId = b.id AND f30.touch = 'd30'
        LEFT JOIN voice_followups f60 ON f60.bookingId = b.id AND f60.touch = 'd60'
       WHERE b.status = 'completed'
         AND b.createdAt >= NOW() - INTERVAL 65 DAY
         AND b.createdAt <= NOW() - INTERVAL 7 DAY
         AND (f7.id IS NULL OR f30.id IS NULL OR f60.id IS NULL)
         AND DATE_ADD(b.createdAt, INTERVAL (CASE WHEN f7.id IS NULL THEN 7 WHEN f30.id IS NULL THEN 30 ELSE 60 END) DAY) <= NOW()
       ORDER BY ageMinutes DESC
       LIMIT 2000
    `);
    if (typeof rows === "string") return failed(rows);
    for (const r of rows) {
      const phone10 = String(r.phone ?? "").replace(/\D/g, "").slice(-10);
      if (phone10.length !== 10 || suppression.phones.has(phone10)) continue;
      return fromAge(r.ageMinutes, nowMs);
    }
    return { oldestDueAtMs: null, readFailed: false };
  } catch (err) {
    return failed(errText(err));
  }
}

/** reel-pipeline's stages all no-op unless the flag is exactly "true" (scheduler requiresFlag). */
const reelOff = (): QueueAgeRead | null =>
  process.env.REEL_GENERATION_ENABLED === "true"
    ? null
    : { oldestDueAtMs: null, readFailed: false, skipped: "REEL_GENERATION_ENABLED != 'true'" };

/**
 * Non-terminal = the statuses reel-pipeline itself drains: queued
 * (processNextReelJob), assets_ready (processNextAssemblyJob), generating and
 * assembling (claimed in-flight, recovered by recoverStuckReelJobs). Aged by
 * the last update, so a row that is still being worked on stays young.
 */
async function readReelPipeline(nowMs: number): Promise<QueueAgeRead> {
  const off = reelOff();
  if (off) return off;
  return oldestByAggregate(
    sql`SELECT MAX(TIMESTAMPDIFF(MINUTE, updatedAt, NOW())) AS ageMinutes
          FROM reel_jobs
         WHERE status IN ('queued', 'generating', 'assets_ready', 'assembling')`,
    nowMs,
  );
}

/**
 * publication_scheduled_at is stamped at the publish CAS (dailyReelPost sets
 * status 'publishing' with it, and clears it on every revert to 'assembled'),
 * so it means "publish STARTED". A stamped row still in publishing or
 * publish_ambiguous is a publish that has not resolved to posted.
 *
 * Claims are made by daily-reel-post (REEL_AUTOPOST_ENABLED) and resolved by
 * reel-pipeline (recovery + reconcile lane), so this is skipped only when BOTH
 * lanes are off: a claim nothing will ever resolve is exactly a stuck publish.
 */
async function readReelPublish(nowMs: number): Promise<QueueAgeRead> {
  if (process.env.REEL_AUTOPOST_ENABLED !== "true" && reelOff()) {
    return {
      oldestDueAtMs: null,
      readFailed: false,
      skipped: "REEL_AUTOPOST_ENABLED and REEL_GENERATION_ENABLED both != 'true'",
    };
  }
  return oldestByAggregate(
    sql`SELECT MAX(TIMESTAMPDIFF(MINUTE, publication_scheduled_at, NOW())) AS ageMinutes
          FROM reel_jobs
         WHERE status IN ('publishing', 'publish_ambiguous') AND publication_scheduled_at IS NOT NULL`,
    nowMs,
  );
}

export const QUEUE_AGE_READERS: Readonly<Record<string, (nowMs: number) => Promise<QueueAgeRead>>> = Object.freeze({
  "reminder-queue": readReminderQueue,
  "followup-cadence": readFollowupCadence,
  "reel-pipeline": readReelPipeline,
  "reel-pipeline:publish": readReelPublish,
});
