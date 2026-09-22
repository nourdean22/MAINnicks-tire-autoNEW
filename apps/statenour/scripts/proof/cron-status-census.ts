/**
 * proof:cron-census - READ-ONLY census of cron_job_log, the receipt the cron
 * lifecycle (lib/inngest/cron-lifecycle.ts) is judged by.
 *
 *   railway run -s statenour-web -- pnpm proof:cron-census
 *
 * Prints: the status vocabulary all-time and over 30 days (anything outside
 * started | success | failed | partial | interrupted | duplicate is a token no
 * positive list knows about); stale `started` rows older than STALE_RUN_MINUTES,
 * grouped by run id so a duplicate birth is not read as a death; and, for the
 * last 24h of `success` rows, how many carry a resultCount.
 *
 * Baseline 2026-09-22 (before #2525 deployed): success 10,522 · started 49 ·
 * partial 15 · failed 8; 49 stale started rows = 10 run ids x 4-5 duplicates,
 * every run a success; 692 of 694 daily successes had resultCount = null.
 * Expected after #2525: 0 stale started rows, the 49 marked `duplicate`, 0
 * `interrupted`, and new successes of count-bearing jobs carrying a number.
 *
 * Read-only by construction: groupBy / findMany / count only. `server-only` is
 * stubbed the way seed-policies.ts does it so `@/lib/prisma` loads outside Next.
 */
import Module from "node:module";

{
  const cjs = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => (request === "server-only" ? {} : original(request, parent, isMain));
}

const KNOWN = ["started", "success", "failed", "partial", "interrupted", "duplicate"];
const STALE_MINUTES = 90;

async function main(): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const now = Date.now();

  const all = await prisma.cronJobLog.groupBy({
    by: ["status"],
    _count: { _all: true },
    _min: { createdAt: true },
    _max: { createdAt: true },
  });
  console.log("ALL TIME  status -> count (first .. last)");
  for (const r of all) {
    const flag = KNOWN.includes(r.status) ? "" : "   <-- UNKNOWN TOKEN";
    console.log(
      "  " + r.status.padEnd(12) + String(r._count._all).padStart(8) + "  " +
        (r._min.createdAt?.toISOString().slice(0, 10) ?? "?") + " .. " + (r._max.createdAt?.toISOString().slice(0, 10) ?? "?") + flag,
    );
  }

  const recent = await prisma.cronJobLog.groupBy({
    by: ["status"],
    where: { createdAt: { gte: new Date(now - 30 * 86_400_000) } },
    _count: { _all: true },
  });
  console.log("LAST 30D  status -> count");
  for (const r of recent) console.log("  " + r.status.padEnd(12) + String(r._count._all).padStart(8));

  const stale = await prisma.cronJobLog.findMany({
    where: { status: "started", createdAt: { lt: new Date(now - STALE_MINUTES * 60_000) } },
    select: { jobName: true, runId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const byRun = new Map<string, number>();
  for (const r of stale) byRun.set(r.runId ?? "(no run id)", (byRun.get(r.runId ?? "(no run id)") ?? 0) + 1);
  console.log(
    "STALE started rows (> " + STALE_MINUTES + " min): " + stale.length + " across " + byRun.size + " run id(s)" +
      (stale.length > 0 ? "; oldest " + stale[0].createdAt.toISOString().slice(0, 16) + " " + stale[0].jobName : ""),
  );
  const multi = [...byRun.values()].filter((n) => n > 1).length;
  if (multi > 0) console.log("  " + multi + " run id(s) carry more than one started row - duplicate births, not deaths (group by run id before naming the shape)");

  const daySince = new Date(now - 86_400_000);
  const [daySuccess, dayNull, dayZero] = await Promise.all([
    prisma.cronJobLog.count({ where: { status: "success", createdAt: { gte: daySince } } }),
    prisma.cronJobLog.count({ where: { status: "success", createdAt: { gte: daySince }, resultCount: null } }),
    prisma.cronJobLog.count({ where: { status: "success", createdAt: { gte: daySince }, resultCount: 0 } }),
  ]);
  console.log(
    "LAST 24H  success rows " + daySuccess + " · resultCount null " + dayNull + " · zero " + dayZero + " · a number > 0 " + (daySuccess - dayNull - dayZero),
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("proof:cron-census failed:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
