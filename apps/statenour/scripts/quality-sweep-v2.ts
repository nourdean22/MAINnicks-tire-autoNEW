/**
 * Quality sweep v2 — system-wide audit that produces actionable
 * findings. Not destructive — reports only. Pair with specific
 * cleanup scripts (scripts/cleanup-stale-drift.ts, etc.) for the
 * actual surgery.
 *
 * Checks:
 *   1. Orphan lib exports — named exports never referenced outside
 *      their own file. Candidates for deletion.
 *   2. Dead API routes — /api/** routes that no UI/other-route calls.
 *   3. Empty Prisma tables — tables in schema with 0 rows.
 *   4. Cold/dead BrainMemory — confidence < 0.1, seenCount === 1,
 *      untouched > 60d.
 *   5. Ghost CronJobLog — recent log rows for jobs whose route no
 *      longer exists.
 *   6. Dead vercel.json schedules — crons scheduled but route missing.
 *   7. Audit log category distribution — eventTypes dominating > 40%
 *      of a 7d window (noise candidates).
 *
 * Run: pnpm exec tsx scripts/quality-sweep-v2.ts
 *
 * Output is plain text — pipe to a file or eyeball the summary.
 */
import fs from "fs";
import path from "path";
import { glob } from "glob";
import { prisma } from "@/lib/prisma";

const ROOT = process.cwd();
const lines: string[] = [];
const log = (s: string) => lines.push(s);
const section = (title: string) => log(`\n━━━ ${title} ━━━`);

// ── 1. Orphan lib exports ────────────────────────────────────
async function checkOrphanExports() {
  section("Orphan lib exports (candidates for deletion)");
  const libFiles = await glob("lib/**/*.{ts,tsx}", { cwd: ROOT, ignore: ["**/*.test.ts", "**/*.spec.ts"] });
  let orphans = 0;
  let checked = 0;
  for (const f of libFiles) {
    const content = fs.readFileSync(path.join(ROOT, f), "utf8");
    // Quick export extractor — captures `export function foo`, `export const foo`
    const exportMatches = content.matchAll(/export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)/g);
    for (const m of exportMatches) {
      const name = m[1];
      if (name.startsWith("_") || name.length < 4) continue; // skip private + short names
      checked++;
      // Search for usage OUTSIDE this file
      const usagePattern = new RegExp(`\\b${name}\\b`, "g");
      const importers = await glob("{lib,app,components,hooks}/**/*.{ts,tsx}", {
        cwd: ROOT,
        ignore: [f, "**/*.test.ts", "**/*.spec.ts"],
      });
      let found = false;
      for (const i of importers) {
        const c = fs.readFileSync(path.join(ROOT, i), "utf8");
        const hits = c.match(usagePattern);
        if (hits && hits.length > 0) {
          found = true;
          break;
        }
      }
      if (!found) {
        orphans++;
        log(`  ${f} → ${name}`);
        if (orphans > 30) {
          log("  … (stopping at 30 — run again after cleanup)");
          return;
        }
      }
    }
  }
  log(`checked ${checked} exports · ${orphans} potential orphans`);
}

// ── 2. Dead API routes ──────────────────────────────────────
async function checkDeadRoutes() {
  section("Dead API routes (0 callers in code)");
  // glob returns platform-native separators on Windows; normalize so
  // the derived /api/foo route path is consistent with how fetch
  // callers write it in code (always forward-slash).
  const apiFiles = (await glob("app/api/**/route.ts", { cwd: ROOT })).map((f) =>
    f.replace(/\\/g, "/"),
  );
  let dead = 0;
  for (const f of apiFiles) {
    const routePath =
      "/" +
      f
        .replace(/^app\//, "")
        .replace(/\/route\.ts$/, "")
        .replace(/\/\[([^\]]+)\]/g, "/[$1]");
    // Skip dynamic routes — hard to grep
    if (routePath.includes("[")) continue;
    const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match the route in a string literal (after " ' or `) followed
    // by a quote, slash, or ? query separator.
    const usagePattern = new RegExp(`["'\`]${escaped}["'\`/?]`, "g");
    const code = (
      await glob("{lib,app,components,hooks}/**/*.{ts,tsx}", {
        cwd: ROOT,
        ignore: [f, "**/*.test.ts"],
      })
    ).map((p) => p.replace(/\\/g, "/"));
    let found = false;
    for (const c of code) {
      if (c === f) continue;
      const content = fs.readFileSync(path.join(ROOT, c), "utf8");
      if (usagePattern.test(content)) {
        found = true;
        break;
      }
    }
    if (!found) {
      dead++;
      log(`  ${routePath}  (${f})`);
    }
  }
  log(`${dead} routes with zero in-code references`);
}

// ── 3. Empty Prisma tables ──────────────────────────────────
async function checkEmptyTables() {
  section("Prisma tables with 0 rows");
  // Hand-picked set since we can't enumerate dynamically without
  // Prisma introspection. Covers the models we've discussed.
  const tables: Array<{ name: string; count: () => Promise<number> }> = [
    { name: "DailyScore",       count: () => prisma.dailyScore.count() },
    { name: "OpenLoop",         count: () => prisma.openLoop.count() },
    { name: "Mission",          count: () => prisma.mission.count() },
    { name: "Task",             count: () => prisma.task.count() },
    { name: "Commitment",       count: () => prisma.commitment.count() },
    { name: "BrainDump",        count: () => prisma.brainDump.count() },
    { name: "BrainMemory",      count: () => prisma.brainMemory.count() },
    { name: "Reflection",       count: () => prisma.reflection.count() },
    { name: "Prediction",       count: () => prisma.prediction.count() },
    { name: "StrategicLaw",     count: () => prisma.strategicLaw.count() },
    { name: "SituationLog",     count: () => prisma.situationLog.count() },
    { name: "VectorEmbedding",  count: () => prisma.vectorEmbedding.count() },
    { name: "MemoryEdge",       count: () => prisma.memoryEdge.count() },
    { name: "AutonomousAction", count: () => prisma.autonomousAction.count() },
    { name: "CronJobLog",       count: () => prisma.cronJobLog.count() },
    { name: "ErrorLog",         count: () => prisma.errorLog.count() },
    { name: "Quote",            count: () => prisma.quote.count() },
    { name: "Customer",         count: () => prisma.customer.count() },
    { name: "Job",              count: () => prisma.job.count() },
    { name: "Lead",             count: () => prisma.lead.count() },
  ];
  for (const t of tables) {
    try {
      const c = await t.count();
      if (c === 0) log(`  ${t.name}: 0 rows`);
    } catch (e) {
      log(`  ${t.name}: error (${(e as Error).message.slice(0, 50)})`);
    }
  }
}

// ── 4. Cold BrainMemory ────────────────────────────────────
async function checkColdMemory() {
  section("Cold BrainMemory (confidence<0.1, seenCount=1, >60d)");
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400_000);
  const cold = await prisma.brainMemory.count({
    where: { confidence: { lt: 0.1 }, seenCount: 1, lastSeen: { lt: sixtyDaysAgo } },
  });
  log(`${cold} memories eligible for decay sweep`);
}

// ── 5. Ghost CronJobLog ─────────────────────────────────────
async function checkGhostCronLogs() {
  section("Ghost CronJobLog entries (job route doesn't exist)");
  const since = new Date(Date.now() - 7 * 86400_000);
  const recentJobs = await prisma.cronJobLog.groupBy({
    by: ["jobName"],
    where: { createdAt: { gte: since } },
    _count: { id: true },
  });
  const routeDirs = fs
    .readdirSync(path.join(ROOT, "app/api/cron"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const routes = new Set(routeDirs);
  let ghosts = 0;
  for (const j of recentJobs) {
    if (!routes.has(j.jobName)) {
      ghosts++;
      log(`  ${j.jobName} · ${j._count.id} rows · no matching /api/cron/${j.jobName}/route.ts`);
    }
  }
  log(`${ghosts} ghost cron names logging to DB`);
}

// ── 6. Dead vercel.json schedules ──────────────────────────
async function checkDeadSchedules() {
  section("vercel.json schedules pointing at missing routes");
  const raw = fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8");
  const parsed = JSON.parse(raw) as { crons?: Array<{ path: string; schedule: string }> };
  const routeDirs = fs
    .readdirSync(path.join(ROOT, "app/api/cron"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const routes = new Set(routeDirs);
  let dead = 0;
  for (const c of parsed.crons ?? []) {
    const match = c.path.match(/\/api\/cron\/([^/?]+)/);
    if (!match) continue;
    const name = match[1];
    if (!routes.has(name)) {
      dead++;
      log(`  ${c.path} (${c.schedule}) — no route exists`);
    }
  }
  log(`${dead} scheduled crons pointing at missing routes`);
}

// ── 7. Audit log noise ─────────────────────────────────────
async function checkAuditNoise() {
  section("AuditEvent noise — types dominating > 40% of 7d window");
  const since = new Date(Date.now() - 7 * 86400_000);
  const total = await prisma.auditEvent.count({ where: { createdAt: { gte: since } } });
  if (total < 100) {
    log(`only ${total} events in window — skipping`);
    return;
  }
  const grouped = await prisma.auditEvent.groupBy({
    by: ["eventType"],
    where: { createdAt: { gte: since } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 10,
  });
  for (const g of grouped) {
    const pct = Math.round((g._count.id / total) * 100);
    const flag = pct >= 40 ? " 🚨 NOISE" : pct >= 20 ? " ⚠" : "";
    log(`  ${g.eventType}: ${g._count.id} (${pct}%)${flag}`);
  }
}

async function main() {
  log(`QUALITY SWEEP v2 · ${new Date().toISOString()}`);
  await checkEmptyTables();
  await checkColdMemory();
  await checkGhostCronLogs();
  await checkDeadSchedules();
  await checkAuditNoise();
  await checkDeadRoutes();
  await checkOrphanExports();
  console.log(lines.join("\n"));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
