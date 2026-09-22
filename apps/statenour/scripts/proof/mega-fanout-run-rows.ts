/**
 * proof:mega-rows - READ-ONLY: how many cron_job_log rows does ONE run produce?
 *
 *   railway run -s statenour-web -- pnpm proof:mega-rows
 *   railway run -s statenour-web -- pnpm proof:mega-rows -- --job=industry-pull --since=2026-09-17
 *
 * The 2026-09-22 finding this script exists to re-check: every mega-fanout run
 * since the lifecycle middleware shipped had 5-6 rows under ONE Inngest run id
 * (4-5 `started` + 1 `success`). Inngest fires `onRunStart` once per
 * parallel-step request (mega-fanout runs `Promise.allSettled` of `step.run`s
 * under `concurrency: { limit: 5 }`), and the settle updated only the newest
 * row. 49 stale `started` rows looked like 49 dead runs; they were duplicate
 * births. `beginCronRun` is idempotent per (job, run id) since #2525; after it
 * deploys every run id should carry exactly one row. Also lists every job in
 * the window with more rows than distinct run ids, so the next fan-out with the
 * same shape is found by measurement, not by accident.
 *
 * Read-only by construction: findMany only.
 */
import Module from "node:module";

{
  const cjs = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => (request === "server-only" ? {} : original(request, parent, isMain));
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main(): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const job = arg("job", "mega-fanout");
  const since = new Date(arg("since", "2026-09-17T23:00:00Z"));

  const rows = await prisma.cronJobLog.findMany({
    where: { jobName: { startsWith: job }, createdAt: { gte: since } },
    select: { jobName: true, status: true, runId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(job + "* rows since " + since.toISOString().slice(0, 10) + ": " + rows.length);
  const byStatus = new Map<string, number>();
  for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  console.log("  by status: " + [...byStatus].map(([k, v]) => k + "=" + v).join(" · "));

  const byRun = new Map<string, { n: number; job: string; statuses: Set<string>; first: Date; last: Date }>();
  for (const r of rows) {
    const key = r.runId ?? "(no run id)";
    const e = byRun.get(key) ?? { n: 0, job: r.jobName, statuses: new Set<string>(), first: r.createdAt, last: r.createdAt };
    e.n += 1;
    e.statuses.add(r.status);
    e.last = r.createdAt;
    byRun.set(key, e);
  }
  const histogram: Record<string, number> = {};
  for (const e of byRun.values()) histogram[String(e.n)] = (histogram[String(e.n)] ?? 0) + 1;
  console.log("  distinct run ids: " + byRun.size + " · rows-per-run histogram: " + JSON.stringify(histogram) + "  (healthy = every run id at 1)");
  for (const [rid, e] of [...byRun].slice(0, 8)) {
    console.log(
      "   " + rid.slice(0, 14).padEnd(14) + " " + e.job.padEnd(22) + " rows=" + e.n + " " + e.first.toISOString().slice(5, 16) + " -> " +
        e.last.toISOString().slice(11, 16) + " statuses=" + [...e.statuses].join(","),
    );
  }

  // Every job in the window whose rows outnumber its run ids - the same shape elsewhere.
  const all = await prisma.cronJobLog.findMany({
    where: { createdAt: { gte: since }, runId: { not: null } },
    select: { jobName: true, runId: true },
  });
  const perJob = new Map<string, { rows: number; runs: Set<string> }>();
  for (const r of all) {
    const e = perJob.get(r.jobName) ?? { rows: 0, runs: new Set<string>() };
    e.rows += 1;
    if (r.runId) e.runs.add(r.runId);
    perJob.set(r.jobName, e);
  }
  const offenders = [...perJob].filter(([, e]) => e.rows > e.runs.size).sort((a, b) => b[1].rows - b[1].runs.size - (a[1].rows - a[1].runs.size));
  console.log(
    "jobs with more rows than run ids since " + since.toISOString().slice(0, 10) + ": " +
      (offenders.length === 0 ? "none" : offenders.slice(0, 10).map(([j, e]) => j + " rows=" + e.rows + " runs=" + e.runs.size).join(" · ")),
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("proof:mega-rows failed:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
