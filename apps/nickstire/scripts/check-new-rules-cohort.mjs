/**
 * check-new-rules-cohort.mjs · READ-ONLY
 *
 * The first measurement of whether 2026-08-01's content changes moved anything.
 *
 * Four reels published under the new rules — 5 hashtags (was 8-13), a SEND cta
 * (was "save this"), no fabricated statistics, grounded briefs:
 *
 *   #1230001  18161448238479905   generated + published autonomously
 *   #1200001  17947835511039108   caption repaired, published by hand
 *   #1200002  18051687443562150   caption repaired, published by hand
 *   #1200003  18124915078747968   RECOVERED from a failed job, no new spend
 *
 * BASELINE — every reel this account had posted before the change (n=8):
 *   saved  0.00      shares 0.38      reach 204   (6.2% of 3,288 followers)
 *
 * A save has never been recorded on this account. That is the number to watch.
 *
 * WHY THIS IS A SCRIPT AND NOT A SCHEDULED CLOUD AGENT: the Graph call needs
 * META_PAGE_ACCESS_TOKEN, which lives in Railway, and `.env` is gitignored. A
 * cloud routine gets a git checkout and no credentials, so it could only have
 * scheduled a failure.
 *
 * Usage — run under Railway so the Meta token is present:
 *   railway run --service MAINnicks-tire-auto --environment production -- \
 *     node scripts/check-new-rules-cohort.mjs
 *
 * SAFETY: read-only. Graph GETs and one SELECT.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const COHORT = [
  { job: 1230001, id: "18161448238479905", note: "autonomous" },
  { job: 1200001, id: "17947835511039108", note: "caption repaired" },
  { job: 1200002, id: "18051687443562150", note: "caption repaired" },
  { job: 1200003, id: "18124915078747968", note: "recovered job" },
];

const BASELINE = { saved: 0.0, shares: 0.38, reach: 204, n: 8 };

const tok = process.env.META_PAGE_ACCESS_TOKEN || process.env.FB_PAGE_ACCESS_TOKEN;
if (!tok) {
  console.error("no META_PAGE_ACCESS_TOKEN — run under `railway run` (see header)");
  process.exit(1);
}

// Reel-only metrics fail the whole call on other media types, so ask widest
// first and step down. Absent stays NULL — "not reported" and "zero" are
// different facts and must not be collapsed.
const LADDERS = [
  "reach,saved,shares,views,ig_reels_avg_watch_time,reels_skip_rate",
  "reach,saved,shares,views",
  "reach,saved,shares",
];

const rows = [];
for (const c of COHORT) {
  let data = null;
  for (const metrics of LADDERS) {
    const r = await fetch(`https://graph.facebook.com/v25.0/${c.id}/insights?metric=${metrics}`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    const j = await r.json();
    if (r.ok && j.data) { data = j.data; break; }
  }
  if (!data) { rows.push({ ...c, unavailable: true }); continue; }
  const v = {};
  for (const m of data) if (typeof m.values?.[0]?.value === "number") v[m.name] = m.values[0].value;
  rows.push({
    ...c,
    reach: v.reach ?? null,
    saved: v.saved ?? null,
    shares: v.shares ?? null,
    views: v.views ?? null,
    // Graph returns this in MILLISECONDS — kept native and labelled.
    watchMs: v.ig_reels_avg_watch_time ?? null,
    skip: v.reels_skip_rate ?? null,
  });
}

const show = (x) => (x === null || x === undefined ? "n/r" : String(x));
console.log(`\nNEW-RULES COHORT · ${new Date().toISOString().slice(0, 16)}Z`);
console.log(`baseline (n=${BASELINE.n} pre-change reels): saved ${BASELINE.saved} · shares ${BASELINE.shares} · reach ${BASELINE.reach}\n`);
console.log("  job       reach  saved  shares  views  avgWatch  skip   note");
for (const r of rows) {
  if (r.unavailable) { console.log(`  #${r.job}  insights unavailable`); continue; }
  const w = r.watchMs === null ? "n/r" : `${(r.watchMs / 1000).toFixed(1)}s`;
  console.log(
    `  #${r.job}  ${show(r.reach).padStart(5)}  ${show(r.saved).padStart(5)}  ${show(r.shares).padStart(6)}  ${show(r.views).padStart(5)}  ${w.padStart(8)}  ${show(r.skip).padStart(5)}   ${r.note}`,
  );
}

const got = rows.filter((r) => !r.unavailable);
const sum = (k) => got.reduce((a, r) => a + (r[k] ?? 0), 0);
const reported = (k) => got.filter((r) => r[k] !== null).length;

console.log("\n─── verdict ───");
if (reported("saved") === 0) {
  console.log("  saves NOT REPORTED for any post — cannot judge. Not the same as zero.");
} else {
  const s = sum("saved");
  console.log(`  saves: ${s} across ${reported("saved")} reported post(s) — baseline was 0.00 per reel, always.`);
  console.log(s > 0
    ? "  >>> FIRST SAVES EVER RECORDED on this account. The change moved something."
    : "  still zero. If 72h is also zero, the constraint is the first two seconds of video, not the caption.");
}
const avgReach = reported("reach") ? Math.round(sum("reach") / reported("reach")) : null;
if (avgReach !== null) {
  const d = (((avgReach - BASELINE.reach) / BASELINE.reach) * 100).toFixed(0);
  console.log(`  reach: avg ${avgReach} vs baseline ${BASELINE.reach} (${d > 0 ? "+" : ""}${d}%)`);
}
console.log(`  shares: ${sum("shares")} total vs a baseline of ${BASELINE.shares}/reel`);
console.log("\n  n=4 against n=8. Directional only — do not call a winner off this.\n");

// Cross-check the DB agrees these are the rows we think they are.
try {
  const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
    .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
    ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
  const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
  const [db] = await conn.execute(
    `SELECT id, status, igPostId FROM reel_jobs WHERE id IN (${COHORT.map((c) => c.job).join(",")}) ORDER BY id`,
  );
  // COHORT entries key the media id as `id`, NOT `igPostId`. The first version
  // compared `c.igPostId` — always undefined — so the check reported
  // "ID MISMATCH, investigate" on a perfectly healthy set. A cross-check that
  // cries wolf gets ignored, which is worse than not having one.
  const bad = db.filter((r) => !COHORT.some((c) => c.job === r.id && c.id === r.igPostId));
  console.log(`  db cross-check: ${db.length}/4 rows found${bad.length ? " — ID MISMATCH, investigate" : ", media ids agree"}`);
  await conn.end();
} catch {
  console.log("  db cross-check skipped (no local DATABASE_URL)");
}
