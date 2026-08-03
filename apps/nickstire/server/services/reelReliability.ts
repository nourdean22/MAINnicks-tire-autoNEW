/**
 * Reel pipeline reliability — 30-day windowed, read-only.
 *
 * Extracted VERBATIM from routers/instagramAdmin.ts getReelReliability so the
 * admin console and the operator's Telegram surface read the SAME arithmetic
 * instead of two copies that drift. No logic change in the move.
 *
 * Two contracts here are load-bearing and must survive any edit:
 *
 *  - Spelling honesty. Prod carries BOTH "posted" and "published" as success
 *    statuses, so success is their SUM, never one of them.
 *  - All-null means UNKNOWN, not healthy. When the table cannot be read every
 *    count comes back null — including `closedFailures`, which is null and NOT
 *    0, because the shapes must match or a consumer reads undefined on the
 *    error path. "We could not count" must never render as "there were none".
 */
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";

const log = createLogger("services:reel-reliability");

export interface ReelReliability {
  windowDays: number;
  total: number | null;
  byStatus: Record<string, number>;
  succeeded: number | null;
  failed: number | null;
  closedFailures: number | null;
  ambiguous: number | null;
  failureRate: number | null;
}

export async function getReelReliability(): Promise<ReelReliability> {
  const database = await db();
  // `closedFailures` is null here, NOT 0 — the shapes must match or a consumer
  // reads undefined on the error path, and "we could not count" must never
  // render as "there were none".
  const unknown: ReelReliability = {
    windowDays: 30,
    total: null,
    byStatus: {},
    succeeded: null,
    failed: null,
    closedFailures: null,
    ambiguous: null,
    failureRate: null,
  };
  if (!database) return unknown;
  try {
    const { reelJobs } = await import("../../drizzle/schema");
    const { sql } = await import("drizzle-orm");
    // A failure the operator already closed is not a reliability problem.
    // Measured 2026-08-01: this panel read "67 jobs · 48 failed · 72% failure"
    // while 11 of those failures were the resolved Higgsfield outage plus
    // operator discards and supersessions. The arithmetic was correct and the
    // signal was wrong — the same defect the attention badge had, in a second
    // panel, telling you the pipeline is broken when the causes are fixed.
    //
    // Counted SEPARATELY rather than dropped, so closing a job cannot quietly
    // improve the score with nobody able to see it.
    const { OPERATOR_CLOSED_MARKERS } = await import("./reelRecoverability");
    const closedPattern = OPERATOR_CLOSED_MARKERS.map((m) => `%${m}%`);
    const isClosed = sql`(${reelJobs.error} IS NOT NULL AND (${sql.join(
      closedPattern.map((p) => sql`${reelJobs.error} LIKE ${p}`),
      sql` OR `,
    )}))`;
    const rows = await database
      .select({
        status: reelJobs.status,
        closed: sql<number>`CASE WHEN ${isClosed} THEN 1 ELSE 0 END`,
        n: sql<number>`count(*)`,
      })
      .from(reelJobs)
      .where(sql`${reelJobs.createdAt} >= DATE_SUB(NOW(), INTERVAL 30 DAY)`)
      .groupBy(reelJobs.status, sql`CASE WHEN ${isClosed} THEN 1 ELSE 0 END`);
    const byStatus: Record<string, number> = {};
    let total = 0;
    let closedFailures = 0;
    for (const r of rows as Array<{ status: string | null; closed: unknown; n: unknown }>) {
      const n = Number(r.n);
      if (!Number.isFinite(n)) continue;
      const key = r.status ?? "unknown";
      byStatus[key] = (byStatus[key] ?? 0) + n;
      total += n;
      if (key === "failed" && Number(r.closed) === 1) closedFailures += n;
    }
    const succeeded = (byStatus.posted ?? 0) + (byStatus.published ?? 0);
    // Unresolved failures only. `closedFailures` is surfaced beside it so the
    // difference stays visible rather than being quietly netted out.
    const failed = Math.max(0, (byStatus.failed ?? 0) - closedFailures);
    const ambiguous = byStatus.publish_ambiguous ?? 0;
    // Denominator drops the closed ones too: leaving them in would make the
    // rate look better simply because more jobs were closed, which is the
    // mirror image of the bug being fixed.
    const denominator = Math.max(0, total - closedFailures);
    return {
      windowDays: 30,
      total,
      byStatus,
      succeeded,
      failed,
      closedFailures,
      ambiguous,
      failureRate: denominator > 0 ? Math.round((failed / denominator) * 100) / 100 : null,
    };
  } catch (err) {
    log.warn("reel reliability query failed — reporting unknown, not healthy", err);
    return unknown;
  }
}
