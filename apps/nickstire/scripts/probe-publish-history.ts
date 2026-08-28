/**
 * Publish-history census — READ-ONLY probe. No writes, no side effects.
 *
 * THE QUESTION IT ANSWERS: the reel/content machinery generates packs and jobs
 * at volume and opens draft PRs on a schedule. Has any of it ever reached
 * Instagram? "The cron is registered" and "a pack merged" are both true and
 * neither is a publish — only a row with a platform post id is.
 *
 * Every statement below is a COUNT or a MAX(date). It opens no write path:
 * there is no INSERT/UPDATE/DELETE in this file, which is the check
 * prod-db-guard asks for before a prod-pointed script runs at all.
 *
 * Run: pnpm exec tsx scripts/probe-publish-history.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").host || "(unparseable)";
  } catch {
    return "(unset or unparseable)";
  }
}

/** table -> the questions worth asking of it. */
const CENSUS: Array<{ label: string; sql: string }> = [
  {
    label: "ig_autopost_log · by status (dryrun|posted|failed|aborted)",
    sql: "SELECT status, COUNT(*) AS n, MIN(createdAt) AS first, MAX(createdAt) AS last FROM ig_autopost_log GROUP BY status ORDER BY n DESC",
  },
  {
    label: "reel_jobs · by status",
    sql: "SELECT status, COUNT(*) AS n, MAX(createdAt) AS last FROM reel_jobs GROUP BY status ORDER BY n DESC",
  },
  {
    label: "reel_jobs · rows carrying an igPostId (the only proof of a reel reaching IG)",
    sql: "SELECT COUNT(*) AS with_ig_post_id FROM reel_jobs WHERE igPostId IS NOT NULL AND igPostId <> ''",
  },
  {
    label: "scheduled_posts · by status",
    sql: "SELECT status, COUNT(*) AS n, MAX(scheduledAt) AS last_scheduled, MAX(postedAt) AS last_posted FROM scheduled_posts GROUP BY status ORDER BY n DESC",
  },
  {
    label: "social_content_inventory · by status",
    sql: "SELECT status, COUNT(*) AS n FROM social_content_inventory GROUP BY status ORDER BY n DESC",
  },
  {
    label: "instagram_analytics · posts observed (any source)",
    sql: "SELECT COUNT(*) AS rows_all, COUNT(DISTINCT postId) AS distinct_posts, MAX(createdAt) AS last FROM instagram_analytics",
  },
  {
    label: "ig_metric_snapshots · observation coverage",
    sql: "SELECT COUNT(*) AS rows_all, COUNT(DISTINCT postId) AS distinct_posts, MAX(capturedAt) AS last FROM ig_metric_snapshots",
  },
  {
    label: "social_drafts · terminal artifacts",
    sql: "SELECT contentType, COUNT(*) AS n, MAX(createdAt) AS last FROM social_drafts GROUP BY contentType",
  },
  {
    // snake_case columns: drizzle maps jobName -> job_name. Querying the TS
    // property name returns "Unknown column", which is a broken probe, not a
    // zero — the first run of this file hit exactly that.
    label: "cron_log · reel/content job outcomes, last 30d",
    sql: "SELECT job_name, status, COUNT(*) AS n, MAX(started_at) AS last FROM cron_log WHERE started_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND (job_name LIKE '%reel%' OR job_name LIKE '%autopost%' OR job_name LIKE '%content%' OR job_name LIKE '%social%') GROUP BY job_name, status ORDER BY n DESC",
  },
  {
    // The window that matches the operator's Instagram Insights export, so the
    // publish counts and the engagement ratios describe the same 30 days.
    label: "ig_autopost_log · SAME 30d WINDOW as the Insights export",
    sql: "SELECT status, COUNT(*) AS n FROM ig_autopost_log WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY status ORDER BY n DESC",
  },
  {
    label: "ig_autopost_log · distinct failure reasons, last 30d (top 8)",
    sql: "SELECT LEFT(COALESCE(error, '(none)'), 90) AS reason, COUNT(*) AS n FROM ig_autopost_log WHERE status = 'failed' AND createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY reason ORDER BY n DESC LIMIT 8",
  },
  {
    label: "reel_jobs · SAME 30d WINDOW",
    sql: "SELECT status, COUNT(*) AS n FROM reel_jobs WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY status ORDER BY n DESC",
  },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  console.log(`DB host: ${dbHost()}`);
  if (!url) {
    console.error("DATABASE_URL unset — nothing probed. This is a SKIP, not a zero.");
    process.exitCode = 1;
    return;
  }
  const conn = await mysql.createConnection(url);
  try {
    for (const q of CENSUS) {
      console.log(`\n── ${q.label}`);
      try {
        const [rows] = await conn.query(q.sql);
        const list = rows as Array<Record<string, unknown>>;
        if (list.length === 0) {
          console.log("   (no rows)");
          continue;
        }
        for (const r of list) {
          console.log(
            "   " +
              Object.entries(r)
                .map(([k, v]) => `${k}=${v === null ? "NULL" : String(v)}`)
                .join(" · "),
          );
        }
      } catch (err) {
        // A missing table is a FINDING, not a crash — report and continue.
        console.log(`   ERROR: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
