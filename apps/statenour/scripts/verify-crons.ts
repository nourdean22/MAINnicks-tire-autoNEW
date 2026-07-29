/**
 * CLI · Cron manifest verifier.
 *
 * Asserts that `config/crons.ts` is the single source of truth via seven
 * checks ([1/7]–[7/7]), the first two being:
 *   1. Every cron named as `active` or `folded` has a corresponding
 *      `app/api/cron/<name>/route.ts` (so the code is actually present).
 *   2. Every `app/api/cron/*` directory has a matching entry in CRONS
 *      (no dark code).
 * Checks 3–7 cover schedule/class sanity, mega fan-out membership, and
 * bidirectional worker-list validation (see the numbered sections below).
 *
 * The vercel.json drift check was removed when statenour left Vercel
 * for Railway — scheduled jobs now run via the Inngest mega fan-out,
 * not a vercel.json `crons` block.
 *
 * Run:  pnpm check:crons
 */

import fs from "node:fs";
import path from "node:path";
import { CRONS, expectedCronRouteNames } from "../config/crons";
import { MORNING_JOBS, EVENING_JOBS, WEEKLY_JOBS } from "../lib/inngest/jobs";

const cwd = process.cwd();

let errors = 0;
let warnings = 0;
const fail = (msg: string) => { errors++; console.error(`  ❌ ${msg}`); };
const warn = (msg: string) => { warnings++; console.warn(`  ⚠️  ${msg}`); };
const ok = (msg: string) => console.log(`  ✅ ${msg}`);

console.log("");
console.log("cron manifest · verifying");
console.log("");

// ── 1 · Every named cron has a route.ts on disk ──────────────────────
console.log("[1/7]manifest → filesystem");
for (const c of CRONS) {
  if (c.name === "mega-evening" || c.inngest) continue; // shares mega route / Inngest-native (no route file)
  const routePath = path.join(cwd, "app/api/cron", c.name, "route.ts");
  if (!fs.existsSync(routePath)) {
    fail(`${c.name} (mode=${c.mode}) — missing ${path.relative(cwd, routePath)}`);
  }
}
if (errors === 0) ok(`${CRONS.length} manifest entries all backed by a route.ts`);

// ── 1.5 · Inngest-native crons validation ──────────────────────────
console.log("");
console.log("[1.5/7] Inngest-native crons manifest parity");
const functionsDir = path.join(cwd, "lib/inngest/functions");
const files = fs.existsSync(functionsDir)
  ? fs.readdirSync(functionsDir).filter((f) => f.endsWith(".ts") && f !== "index.ts")
  : [];
const inngestCrons = new Map<string, string>();

for (const file of files) {
  const content = fs.readFileSync(path.join(functionsDir, file), "utf-8");
  const blocks = content.split(".createFunction(");
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const cronMatch = block.match(/cron:\s*["'`]([^"'`]+)["'`]/);
    if (cronMatch) {
      const idMatch = block.match(/id:\s*["'`]([^"'`]+)["'`]/);
      if (idMatch) {
        const id = idMatch[1];
        if (id === "mega-fanout-morning" || id === "mega-fanout-evening") continue;
        inngestCrons.set(id, cronMatch[1]);
      }
    }
  }
}

// A. Check that all crons found on disk are in the manifest
for (const [id, schedule] of inngestCrons.entries()) {
  const manifestEntry = CRONS.find((c) => c.name === id);
  if (!manifestEntry) {
    fail(`Inngest cron id "${id}" found in code but is NOT registered in config/crons.ts`);
  } else if (!manifestEntry.inngest) {
    fail(`Inngest cron id "${id}" is registered in config/crons.ts but is missing inngest: true`);
  } else if (manifestEntry.schedule !== schedule) {
    fail(`Inngest cron id "${id}" schedule mismatch: code="${schedule}", manifest="${manifestEntry.schedule}"`);
  }
}

// B. Check that all active inngest crons in manifest actually exist in code
for (const c of CRONS) {
  if (c.inngest && c.mode === "active") {
    const codeSchedule = inngestCrons.get(c.name);
    if (!codeSchedule) {
      fail(`Inngest cron "${c.name}" is marked active in manifest but no cron function with this id exists in lib/inngest/functions/`);
    }
  }
}
if (errors === 0) ok(`${inngestCrons.size} Inngest-native crons validated successfully`);

// ── 2 · Every route.ts has a manifest entry ──────────────────────────
console.log("");
console.log("[2/7]filesystem → manifest (dark code detector)");
const cronRoot = path.join(cwd, "app/api/cron");
const cronDirs = fs.existsSync(cronRoot)
  ? fs.readdirSync(cronRoot).filter((d) => fs.statSync(path.join(cronRoot, d)).isDirectory())
  : [];
const expected = expectedCronRouteNames();
for (const d of cronDirs) {
  if (!expected.has(d)) {
    fail(`app/api/cron/${d}/ exists but is NOT in config/crons.ts (dark code)`);
  }
}
if (errors === 0) ok(`${cronDirs.length} cron routes all documented in the manifest`);

// ── 3 · Retirement warnings ──────────────────────────────────────────
console.log("");
console.log("[3/7]retirement window");
const today = new Date();
for (const c of CRONS) {
  if (c.mode === "retired" && c.retireAfter) {
    const when = new Date(c.retireAfter);
    if (when < today) {
      warn(`${c.name} was scheduled for retirement on ${c.retireAfter} — DELETE route.ts now`);
    } else {
      ok(`${c.name} retired; scheduled for deletion ${c.retireAfter}`);
    }
  }
}

// ── 4 · Budget + fold-candidate ranking ──────────────────────────────
// v8.8 BATCH 46 — when active count is high, surface concrete fold
// suggestions. Priority order:
//   1. crons that fire >1×/day (e.g. every 15min, every 6h) — these
//      are the cheapest to fold without losing meaningful resolution
//   2. daily crons that don't need a specific hour
//   3. weekly crons (already low-cadence; only fold if desperate)
//
// SOFT_CAP is a self-imposed sprawl threshold — every cron is load +
// surface area. Railway has no platform cron limit, so folding is a
// hygiene call, not a billing one.
const SOFT_CAP = 38;

function fireFrequency(schedule: string): number {
  // Approximate fires-per-day from the cron expression. Conservative
  // lower bound — used only for ranking, not for invoice math.
  if (/^\*\/(\d+)/.test(schedule.split(" ")[0])) {
    const min = Number(schedule.match(/^\*\/(\d+)/)?.[1] ?? 60);
    return Math.round((24 * 60) / Math.max(1, min));
  }
  if (/^0 \*\/(\d+)/.test(schedule)) {
    const h = Number(schedule.match(/^0 \*\/(\d+)/)?.[1] ?? 24);
    return Math.round(24 / Math.max(1, h));
  }
  // Weekly / specific time → roughly 1/day or less.
  if (/\* \* [0-6]$/.test(schedule)) return 1 / 7;
  return 1;
}

console.log("");
console.log("[4/7]budget + fold suggestions");
const activeSchedules = CRONS.filter((c) => c.mode === "active" && c.schedule);

if (activeSchedules.length > SOFT_CAP) {
  warn(
    `${activeSchedules.length} active schedules — over the ${SOFT_CAP}-cron soft cap. Consider folding some into the mega fan-out.`,
  );
} else if (activeSchedules.length > SOFT_CAP - 4) {
  ok(
    `${activeSchedules.length} active schedules · approaching the ${SOFT_CAP}-cron soft cap.`,
  );
} else {
  ok(
    `${activeSchedules.length} active schedules · under the ${SOFT_CAP}-cron soft cap.`,
  );
}

// Rank fold candidates: high-frequency crons NOT in the alert/device
// categories (those need their cadence to stay responsive).
const SACRED_CATEGORIES = new Set(["alert", "device"]);
const candidates = activeSchedules
  .filter((c) => !SACRED_CATEGORIES.has(c.category))
  .map((c) => ({
    name: c.name,
    schedule: c.schedule!,
    category: c.category,
    fpd: fireFrequency(c.schedule!),
  }))
  .sort((a, b) => b.fpd - a.fpd);

if (candidates.length > 0 && activeSchedules.length > SOFT_CAP - 4) {
  console.log("");
  console.log("  fold candidates (rank by fires/day, sacred=alert+device skipped):");
  for (const c of candidates.slice(0, 5)) {
    console.log(`    · ${c.name.padEnd(28)} ${c.schedule.padEnd(15)} ~${Math.round(c.fpd)}/day · category=${c.category}`);
  }
  console.log("");
  console.log("  fold pattern: set mode=\"folded\", schedule=null,");
  console.log("                foldedInto=\"mega\" + add to mega's");
  console.log("                CRON_JOBS array. See v8.7.1/v8.7.2 commits.");
}

// ── 5 · jobs.ts fan-out refs → filesystem ────────────────────────────
// config/crons.ts (checks 1-2) is METADATA. The mega fan-out
// (lib/inngest/jobs.ts) is what actually FIRES crons — a ref there to a
// deleted route 404s and starves the fan-out. Wave AE (2026-05-28)
// deleted ~51 routes but left their jobs.ts refs, silently killing ~70%
// of crons for 2 days. No check looked here. Now it does.
console.log("");
console.log("[5/7]  jobs.ts fan-out refs -> filesystem");
const fanoutRefs = new Set(
  [...MORNING_JOBS, ...EVENING_JOBS, ...WEEKLY_JOBS].map((p) =>
    p.replace(/^\/api\/cron\//, "").replace(/\?.*$/, ""),
  ),
);
let deadFanoutRefs = 0;
for (const name of fanoutRefs) {
  const routePath = path.join(cwd, "app/api/cron", name, "route.ts");
  if (!fs.existsSync(routePath)) {
    fail(
      `jobs.ts fans out to /api/cron/${name} but ${path.relative(cwd, routePath)} does NOT exist — the fan-out 404s on it`,
    );
    deadFanoutRefs++;
  }
}
if (deadFanoutRefs === 0) ok(`${fanoutRefs.size} fan-out refs all backed by a route.ts`);

// ── 6 · manifest "active" → actually fires ───────────────────────────
// A cron marked mode:"active" claims it runs on its own schedule. It only
// actually fires if it's in the mega fan-out (jobs.ts) or fires
// independently (the allowlist). Wave AE left ~10 crons marked "active"
// that were never wired — the manifest lied. mode:"dormant" is the honest
// state for a parked cron; this gate stops "active" from drifting back
// into a claim that isn't true.
console.log("");
console.log("[6/7]  manifest active -> actually fires");
// Crons that legitimately fire OUTSIDE the fan-out (verified live in
// CronJobLog). Keep this list tiny + evidence-based.
const INDEPENDENT = new Set([
  "error-telegram-push", // fires every ~10min via its own path (verified live)
  "mega", // the morning dispatcher itself (Inngest cron 0 9 * * *)
  "mega-evening", // the evening dispatcher itself (Inngest cron 0 3 * * *)
]);
let phantomActive = 0;
for (const c of CRONS) {
  if (c.mode !== "active") continue;
  // Inngest-native crons fire via their own Inngest cron trigger, not the
  // fan-out. Worker-fired crons (2026-07-28: the third real dispatch path,
  // apps/worker/src/scheduler.ts node-cron → HTTP) are reachable too — the
  // inngest-liveness watcher MUST live there so it survives an Inngest
  // outage, which is the exact failure it watches for.
  if (fanoutRefs.has(c.name) || INDEPENDENT.has(c.name) || c.inngest || c.worker) continue;
  fail(
    `${c.name} is mode:"active" but is NOT in the mega fan-out (lib/inngest/jobs.ts), not inngest-native, and not worker-fired — wire it into a dispatcher or mark it mode:"dormant"`,
  );
  phantomActive++;
}
if (phantomActive === 0) ok(`all active crons are reachable (fan-out or independent)`);

// ── 7 · worker HIGH_FREQ_JOBS ↔ manifest + filesystem ────────────────
// The worker's node-cron list (apps/worker/src/scheduler.ts) is the third
// dispatch path, and until 2026-07-28 NOTHING validated it: Wave AE
// (05-28) deleted four routes the worker kept firing at — two months of
// 404s every 2-60 min, visible only in the worker's own console. This
// check makes that drift class structurally impossible, both directions:
//   A. every worker job name → route.ts exists + manifest entry has
//      worker: true (the worker fires nothing undocumented or dead)
//   B. every manifest worker:true entry → present in the worker's list
//      (no "worker-fired" claim the worker doesn't actually fire)
console.log("");
console.log("[7/7]  worker HIGH_FREQ_JOBS <-> manifest + filesystem");

/**
 * Check-7 core, extracted so the red self-test below exercises the SAME
 * code path the real check runs — not a logic replica (the original
 * red-proof was a replica; hardened 2026-07-28 late).
 */
function validateWorkerList(workerSrc: string): string[] {
  const problems: string[] = [];
  const listMatch = workerSrc.match(/const HIGH_FREQ_JOBS[\s\S]*?\n\];/);
  if (!listMatch) {
    problems.push("could not locate the HIGH_FREQ_JOBS array — verifier regex needs updating");
    return problems;
  }
  const workerNames = [...listMatch[0].matchAll(/name:\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
  for (const name of workerNames) {
    const routePath = path.join(cwd, "app/api/cron", name, "route.ts");
    if (!fs.existsSync(routePath)) {
      problems.push(`worker fires /api/cron/${name} but the route does NOT exist — every tick is a 404 (the Wave-AE ghost class)`);
    }
    const entry = CRONS.find((c) => c.name === name);
    if (!entry) {
      problems.push(`worker fires "${name}" but it has NO entry in config/crons.ts`);
    } else if (!entry.worker) {
      problems.push(`worker fires "${name}" but its manifest entry is missing worker: true`);
    }
  }
  for (const c of CRONS) {
    if (c.worker && c.mode === "active" && !workerNames.includes(c.name)) {
      problems.push(`${c.name} is marked worker: true + active but is NOT in the worker's HIGH_FREQ_JOBS list — it never fires`);
    }
  }
  return problems;
}

// Red self-test — runs EVERY invocation, in memory, against a fixture
// carrying a Wave-AE ghost. If the check ever loses the ability to catch
// a ghost (regex rot, refactor), THIS fails loudly before the real check
// can emit a false green. Poka-yoke, same pattern as the skill-compiler
// validator's --self-test.
const RED_FIXTURE = [
  "const HIGH_FREQ_JOBS: JobDef[] = [",
  '  { name: "brain-bus-backfill", schedule: "*/2 * * * *", description: "ghost" },',
  "];",
].join("\n");
const redProblems = validateWorkerList(RED_FIXTURE);
if (redProblems.length === 0) {
  fail("check-7 SELF-TEST failed: the ghost fixture produced ZERO problems — the worker-list check can no longer catch a dead route and its green is meaningless");
} else {
  ok(`self-test: ghost fixture caught (${redProblems.length} problem(s)) — the check can still fail`);
}

const workerSchedulerPath = path.join(cwd, "../worker/src/scheduler.ts");
if (!fs.existsSync(workerSchedulerPath)) {
  fail(`apps/worker/src/scheduler.ts not found at ${workerSchedulerPath} — cannot validate the worker dispatch path`);
} else {
  const problems = validateWorkerList(fs.readFileSync(workerSchedulerPath, "utf-8"));
  for (const p of problems) fail(p);
  if (problems.length === 0) ok(`worker jobs all route-backed + manifest-honest, both directions`);
}

console.log("");
if (errors > 0) {
  console.error(`✖ ${errors} errors${warnings ? `, ${warnings} warnings` : ""}`);
  process.exit(1);
}
console.log(`✓ manifest clean${warnings ? ` (${warnings} warnings)` : ""}`);
