/**
 * Does `config/crons.ts` describe the cron system that is actually RUNNING?
 *
 * Three truths, which can all disagree:
 *   · the MANIFEST   — config/crons.ts (declared)
 *   · the LOG        — cron_job_log (observed)
 *   · the SWITCHES   — BrainMemory category="cron_control" (absence = enabled)
 *
 * `pnpm check:crons` validates the manifest's internal consistency. It never
 * reads the other two, so a cron can be declared `active` and be switched OFF
 * in production indefinitely — which is exactly what `data-cleanup` was doing
 * when this probe was written (off since 2026-09-08, note empty, no expiry, and
 * it is the sweeper that hard-deletes expired brain memories).
 *
 * All classification lives in ./lib/cron-truth.mjs behind pure functions so
 * tests/scripts/cron-truth.test.ts can break it with fixtures — a runtime-only
 * check cannot catch a classification regression before an operator acts on it.
 *
 * READ-ONLY. Usage:
 *   railway run -s statenour-web -- node apps/statenour/scripts/probe-cron-truth.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCron, auditKillSwitch, bySeverity, isFailureStatus } from "./lib/cron-truth.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DAYS = Number(process.env.DAYS ?? 14);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL absent — refusing to guess a target.");
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });

// ── manifest ──────────────────────────────────────────────────────────
// ⚠ Anchor on `name:` and scan to the NEXT `name:`. Framing entries as `{ … }`
// with a non-greedy body stops at the first NESTED `},`, which parsed 56 of 79
// and reported 23 real crons as untracked.
const src = readFileSync(join(APP, "config/crons.ts"), "utf8");
const hits = [...src.matchAll(/^\s*name:\s*"([^"]+)"/gm)];
const declared = hits.map((h, i) => {
  const body = src.slice(h.index, i + 1 < hits.length ? hits[i + 1].index : src.length);
  const pick = (k) => {
    const m = new RegExp(`${k}:\\s*(?:"([^"]*)"|(null|true|false))`).exec(body);
    return m ? (m[1] ?? m[2]) : null;
  };
  return { name: h[1], schedule: pick("schedule"), mode: pick("mode"), inngest: pick("inngest") === "true" };
});

// ⚠ EXACT control, not a guessed floor. A `< 50` threshold let a 56-of-79
// under-read pass as healthy, and every comparison downstream was then noise.
const rawCount = (src.match(/^\s*name:\s*"/gm) || []).length;
if (declared.length !== rawCount || rawCount === 0) {
  console.error(`ABORT — manifest parser read ${declared.length} of ${rawCount} entries.`);
  process.exit(2);
}
console.log(`manifest: ${declared.length} crons declared`);

// ── which crons can even be OBSERVED? ─────────────────────────────────
//
// `/api/cron/*` routes are wrapped by cronHandler -> logCronRun (http.ts:403),
// so route-based crons log automatically. Inngest functions bypass that wrapper
// entirely, so an Inngest cron is only observable if its OWN body writes a row —
// which, measured 2026-09-17, exactly ONE of 27 does (cron-heartbeat's self-row).
//
// ⚠⚠ TWO DETECTOR TRAPS, BOTH HIT WHILE WRITING THIS:
//
// 1. READING the table is not WRITING to it. A first version matched
//    /logCronRun|cronJobLog/, which `diagnose-cron-failure` satisfies by
//    QUERYING the log. That graded its silence as a dead schedule and produced
//    a confident ALERT that the cron-failure watchdog was down. It is not — it
//    simply never writes a row, so its silence proves nothing.
//
// 2. The write can span lines. cron-heartbeat writes
//    `prisma.cronJobLog\n  .create({...})`, so a `cronJobLog\.create` pattern
//    matches NOTHING. Whitespace is collapsed before testing — the same
//    line-anchored-regex trap this repo has now recorded three times.
const WRITES_CRON_LOG = /cronJobLog\s*\.\s*(create|upsert|createMany)|logCronRun\s*\(/;
const loggingFns = new Set();
let scannedFns = 0;
try {
  const dir = join(APP, "lib/inngest/functions");
  for (const f of readdirSync(dir)) {
    if (!/\.tsx?$/.test(f)) continue;
    scannedFns += 1;
    const body = readFileSync(join(dir, f), "utf8").replace(/\s+/g, " ");
    if (WRITES_CRON_LOG.test(body)) loggingFns.add(f.replace(/\.tsx?$/, ""));
  }
} catch {
  /* directory shape changed — treated as "unknown", never as "does not log" */
}
console.log(
  `inngest functions: ${scannedFns} scanned · ${loggingFns.size} write a cron_job_log row` +
    `${scannedFns > 0 && loggingFns.size === 0 ? "  ⚠ zero writers — check the detector before trusting any 'unobservable' verdict" : ""}`,
);

// ── CONTROL: is the log alive? ────────────────────────────────────────
const total = await prisma.cronJobLog.count();
const newest = await prisma.cronJobLog.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
const ageH = newest ? (Date.now() - newest.createdAt.getTime()) / 3_600_000 : Infinity;
console.log(`CONTROL · cron_job_log rows=${total} · newest ${ageH.toFixed(1)}h old`);
if (total === 0 || ageH > 6) {
  console.error("ABORT — the log is empty or stale. Every 'not observed' below would say nothing.");
  process.exit(2);
}

// ── observed ──────────────────────────────────────────────────────────
const since = new Date(Date.now() - DAYS * 86_400_000);
const grouped = await prisma.cronJobLog.groupBy({
  by: ["jobName", "status"],
  where: { createdAt: { gte: since } },
  _count: { _all: true },
  _max: { createdAt: true },
});
const observed = new Map();
for (const r of grouped) {
  const e = observed.get(r.jobName) ?? { total: 0, failures: 0, last: null };
  e.total += r._count._all;
  if (isFailureStatus(r.status)) e.failures += r._count._all;
  if (!e.last || r._max.createdAt > e.last) e.last = r._max.createdAt;
  observed.set(r.jobName, e);
}

// ── kill switches ─────────────────────────────────────────────────────
const switchRows = await prisma.brainMemory.findMany({
  where: { category: "cron_control" },
  select: { key: true, content: true, expiresAt: true },
});
const switches = new Map();
for (const r of switchRows) {
  let parsed = {};
  try {
    parsed = JSON.parse(r.content);
  } catch {
    parsed = {};
  }
  switches.set(r.key, { enabled: parsed.enabled !== false, note: parsed.note ?? null, expiresAt: r.expiresAt });
}

// ── verdicts ──────────────────────────────────────────────────────────
const results = declared.map((d) => {
  const sw = switches.get(d.name);
  const logs = d.inngest ? loggingFns.size > 0 && [...loggingFns].some((f) => d.name.includes(f) || f.includes(d.name)) : true;
  return {
    ...d,
    ...classifyCron(d, {
      observed: observed.get(d.name) ?? null,
      disabled: sw ? !sw.enabled : false,
      logsItsRuns: d.inngest ? logs : true,
    }),
    runs: observed.get(d.name)?.total ?? 0,
    failures: observed.get(d.name)?.failures ?? 0,
  };
});

const counts = results.reduce((a, r) => ((a[r.severity] = (a[r.severity] ?? 0) + 1), a), {});
console.log(`\nverdicts: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" · ")}`);

console.log(`\n── needs attention (alert + warn), worst first ──`);
const notable = results.filter((r) => r.severity === "alert" || r.severity === "warn").sort(bySeverity);
if (notable.length === 0) console.log("  none");
for (const r of notable) {
  console.log(`  [${r.severity.toUpperCase()}] ${r.name.padEnd(30)} ${r.verdict}`);
  console.log(`          ${r.detail}`);
}

console.log(`\n── jobs with FAILED runs in ${DAYS}d (partial is NOT a failure) ──`);
const failing = results.filter((r) => r.failures > 0).sort((a, b) => b.failures - a.failures);
if (failing.length === 0) console.log("  none");
for (const r of failing) console.log(`  ${r.name.padEnd(30)} ${r.failures}/${r.runs} failed`);

console.log(`\n── kill switches ──`);
if (switches.size === 0) console.log("  none set — every cron enabled by default");
for (const [name, sw] of switches) {
  const problems = auditKillSwitch({ enabled: sw.enabled, note: sw.note, expiresAt: sw.expiresAt });
  console.log(`  ${sw.enabled ? "on " : "OFF"} ${name.padEnd(30)}${problems.length ? " ⚠ " + problems.join("; ") : ""}`);
}

await prisma.$disconnect();
