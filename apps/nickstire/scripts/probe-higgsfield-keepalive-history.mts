/**
 * probe-higgsfield-keepalive-history.mts · READ-ONLY (2026-08-03)
 *
 * Prints the last N higgsfield-session-keepalive rows from cron_log, including
 * the `details` field — which carries the credit balance on a successful refresh
 * ("session refreshed, N credits"). Answers two questions the health boolean
 * cannot: how long has it been healthy, and is there any balance to spend?
 *
 * Pure SELECT. No writes, no CLI spawn, no spend.
 *
 *   railway run --service MAINnicks-tire-auto -- pnpm exec tsx scripts/probe-higgsfield-keepalive-history.mts
 */
const { db } = await import("../server/lib/db-helper");
const d = await db();
if (!d) {
  console.log("database unavailable");
  process.exit(1);
}

const { cronLog } = await import("../drizzle/schema");
const { eq, desc } = await import("drizzle-orm");

const rows = await d
  .select({
    status: cronLog.status,
    startedAt: cronLog.startedAt,
    details: cronLog.details,
    errorMessage: cronLog.errorMessage,
  })
  .from(cronLog)
  .where(eq(cronLog.jobName, "higgsfield-session-keepalive"))
  .orderBy(desc(cronLog.startedAt))
  .limit(20);

console.log(`\n── higgsfield-session-keepalive · last ${rows.length} runs ──`);
for (const r of rows) {
  const when = r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt);
  const note = r.status === "failed" ? (r.errorMessage ?? "").slice(0, 90) : (r.details ?? "");
  console.log(`${when}  ${String(r.status).padEnd(10)}  ${note}`);
}

const failed = rows.filter((r) => r.status === "failed").length;
console.log(`\nfailed in this window: ${failed} / ${rows.length}`);
console.log("");

process.exit(0);
