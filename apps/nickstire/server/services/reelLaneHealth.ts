/**
 * Reel lane health for the morning brief's EXCEPTIONS block (2026-10-08).
 *
 * WHY. From 2026-10-05 to 2026-10-08 no Reel published (Railway: the last
 * "Instagram Reel published" was 10-04 04:09Z). Publication needs an exact
 * per-reel human approval (reel_publish_approvals, 72 h TTL); the approved
 * backlog was down to three ineligible jobs (one already published, two caption
 * reposts), so every nightly drain selected nothing, and no new job was
 * enqueued until 10-08 10:02Z. The only trace was a nightly "skipped
 * ineligible approved jobs" log line and an admin panel nobody opened. Whatever
 * holds production on a given day, the lane does not move until a human
 * approves a finished reel, so the human has to be told.
 *
 * THREE STATES, as everywhere in the brief: a healthy lane renders nothing, a
 * stalled lane renders one line naming the decision that unblocks it, and a
 * failed read renders UNKNOWN — never silence, which would read as healthy.
 *
 * "Last posted" is MAX(updatedAt) over reel_jobs rows in status 'posted'. A
 * later write to a posted row can only move that time FORWARD, so the error is
 * a missed alarm on one morning, never a false one.
 */
import { sql } from "drizzle-orm";

/** A Reel publishes nightly; 36 h without one means at least one night was missed. */
const REEL_STALL_HOURS = 36;

export type ReelLaneReading =
  | { kind: "measured"; hoursSinceLastPost: number | null; readyAwaitingApproval: number }
  | { kind: "unreadable" };

export function renderReelLaneException(r: ReelLaneReading): string | null {
  if (r.kind === "unreadable") return "Instagram Reel lane UNKNOWN (read failed — check Instagram → Queue)";
  const stalled = r.hoursSinceLastPost === null || r.hoursSinceLastPost >= REEL_STALL_HOURS;
  if (!stalled) return null;
  const since = r.hoursSinceLastPost === null
    ? "No Reel has ever been recorded as posted"
    : `No Reel posted in ${Math.floor(r.hoursSinceLastPost / 24)} day(s)`;
  if (r.readyAwaitingApproval > 0) {
    return `${since} — ${r.readyAwaitingApproval} finished Reel(s) waiting for your approval (Instagram → Queue)`;
  }
  return `${since} and no finished Reel is waiting for approval — production may be held or failing (check Instagram → Queue)`;
}

type Executor = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

const firstRow = (res: unknown): Record<string, unknown> | undefined => {
  const rows = Array.isArray(res) ? res[0] : undefined;
  return Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
};

/** Read-only. Throws on a failed query; the caller maps a throw to `unreadable`. */
export async function readReelLane(db: Executor): Promise<ReelLaneReading> {
  const last = firstRow(await db.execute(sql`
    SELECT TIMESTAMPDIFF(HOUR, MAX(updatedAt), NOW()) AS hoursSince
    FROM reel_jobs WHERE status = 'posted'
  `));
  const ready = firstRow(await db.execute(sql`
    SELECT COUNT(*) AS n FROM reel_jobs j
    WHERE j.status = 'assembled' AND j.mp4Url IS NOT NULL AND j.mp4Url <> ''
      AND NOT EXISTS (
        SELECT 1 FROM reel_publish_approvals a
        WHERE a.reel_job_id = j.id AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > NOW())
      )
  `));
  const hours = last?.hoursSince;
  return {
    kind: "measured",
    hoursSinceLastPost: hours === null || hours === undefined ? null : Number(hours),
    readyAwaitingApproval: Number(ready?.n ?? 0),
  };
}
