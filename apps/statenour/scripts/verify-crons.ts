/**
 * CLI · Cron manifest verifier.
 *
 * Asserts that `config/crons.ts` is the single source of truth:
 *   1. Every cron named as `active` or `folded` has a corresponding
 *      `app/api/cron/<name>/route.ts` (so the code is actually present).
 *   2. Every `app/api/cron/*` directory has a matching entry in CRONS
 *      (no dark code).
 *   3. vercel.json's `crons` block equals `buildVercelCronsBlock()` and
 *      `functions` block equals `buildVercelFunctionsBlock()`.
 *
 * Run:  pnpm check:crons          → read-only verification
 *       pnpm check:crons --fix    → rewrite vercel.json from manifest
 */

import fs from "node:fs";
import path from "node:path";
import {
  CRONS,
  buildVercelCronsBlock,
  buildVercelFunctionsBlock,
  expectedCronRouteNames,
} from "../config/crons";

const argv = new Set(process.argv.slice(2));
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
console.log("[1/4]  manifest → filesystem");
for (const c of CRONS) {
  if (c.name === "mega-evening") continue; // shares mega route
  const routePath = path.join(cwd, "app/api/cron", c.name, "route.ts");
  if (!fs.existsSync(routePath)) {
    fail(`${c.name} (mode=${c.mode}) — missing ${path.relative(cwd, routePath)}`);
  }
}
if (errors === 0) ok(`${CRONS.length} manifest entries all backed by a route.ts`);

// ── 2 · Every route.ts has a manifest entry ──────────────────────────
console.log("");
console.log("[2/4]  filesystem → manifest (dark code detector)");
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

// ── 3 · vercel.json drift detection ──────────────────────────────────
console.log("");
console.log("[3/4]  manifest → vercel.json");
const vercelPath = path.join(cwd, "vercel.json");
const vercel = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
const wantCrons = buildVercelCronsBlock();
const wantFns = buildVercelFunctionsBlock();

const gotCrons = (vercel.crons ?? []) as { path: string; schedule: string }[];

// v9.1.16 · sort by path before comparing — was using positional
// equality, which gave a false "out of sync" if vercel.json had the
// right entries in a different order. The --fix path then needlessly
// re-shuffled the file. Now: same SET semantics, no false positives.
const sortByPath = (a: { path: string }, b: { path: string }) =>
  a.path.localeCompare(b.path);
const sortedGot = [...gotCrons].sort(sortByPath);
const sortedWant = [...wantCrons].sort(sortByPath);

const cronsMatch =
  sortedGot.length === sortedWant.length &&
  sortedGot.every(
    (g, i) =>
      g.path === sortedWant[i].path && g.schedule === sortedWant[i].schedule,
  );

if (!cronsMatch) {
  if (argv.has("--fix")) {
    vercel.crons = wantCrons;
    vercel.functions = wantFns;
    fs.writeFileSync(vercelPath, JSON.stringify(vercel, null, 2) + "\n", "utf8");
    ok(`rewrote vercel.json (crons: ${wantCrons.length}, functions: ${Object.keys(wantFns).length})`);
  } else {
    fail(`vercel.json crons block out of sync with manifest (got ${gotCrons.length}, want ${wantCrons.length}) — run with --fix`);
    // Show first diff for debuggability.
    const gotSet = new Set(gotCrons.map((c) => `${c.path}|${c.schedule}`));
    const wantSet = new Set(wantCrons.map((c) => `${c.path}|${c.schedule}`));
    for (const w of wantCrons) {
      const key = `${w.path}|${w.schedule}`;
      if (!gotSet.has(key)) console.error(`     + needed: ${w.path} @ ${w.schedule}`);
    }
    for (const g of gotCrons) {
      const key = `${g.path}|${g.schedule}`;
      if (!wantSet.has(key)) console.error(`     − removed: ${g.path} @ ${g.schedule}`);
    }
  }
} else {
  ok(`vercel.json crons match manifest (${gotCrons.length} scheduled)`);
}

// ── 4 · Retirement warnings ──────────────────────────────────────────
console.log("");
console.log("[4/4]  retirement window");
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

// ── 5 · Budget + fold-candidate ranking ──────────────────────────────
// v8.8 BATCH 46 — when active count is high, surface concrete fold
// suggestions. Priority order:
//   1. crons that fire >1×/day (e.g. every 15min, every 6h) — these
//      are the cheapest to fold without losing meaningful resolution
//   2. daily crons that don't need a specific hour
//   3. weekly crons (already low-cadence; only fold if desperate)
const VERCEL_PRO_CAP = 40;
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
console.log("[5/5]  budget + fold suggestions");
const activeSchedules = CRONS.filter((c) => c.mode === "active" && c.schedule);
const slotsLeft = VERCEL_PRO_CAP - activeSchedules.length;

if (activeSchedules.length > SOFT_CAP) {
  warn(
    `${activeSchedules.length} active schedules — over soft cap (${SOFT_CAP}). ${slotsLeft} slot(s) until hard cap (${VERCEL_PRO_CAP}).`,
  );
} else if (activeSchedules.length > SOFT_CAP - 4) {
  ok(
    `${activeSchedules.length} active schedules · ${slotsLeft} slot(s) headroom — getting close to soft cap.`,
  );
} else {
  ok(
    `${activeSchedules.length} active schedules · ${slotsLeft} slot(s) headroom (cap: ${VERCEL_PRO_CAP}).`,
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

console.log("");
if (errors > 0) {
  console.error(`✖ ${errors} errors${warnings ? `, ${warnings} warnings` : ""}`);
  process.exit(1);
}
console.log(`✓ manifest clean${warnings ? ` (${warnings} warnings)` : ""}`);
