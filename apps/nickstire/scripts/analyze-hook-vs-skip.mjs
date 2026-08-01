/**
 * analyze-hook-vs-skip.mjs · READ-ONLY · Stage 1 of the hook work
 *
 * Joins each reel's OPENING (beat 1 visual + on-screen text) to how many people
 * actually skipped it, and reports which opening properties correlate.
 *
 * IT DOES NOT GATE ANYTHING, and that is the design. The existing hook check
 * awards 10/10 whenever beat 1 starts at 0s with any non-empty visual and any
 * non-empty text — it gave reel #1230001 a perfect score, and that reel
 * measured an 82.6 skip rate with 3.0s average watch. Replacing one unvalidated
 * score with another would repeat the mistake in a new costume.
 *
 * So this measures. Whether a property becomes a rule is a decision for the
 * data, and the tool refuses to report a difference it cannot support:
 * a comparison needs MIN_GROUP_N posts on BOTH sides or it prints as
 * "insufficient" rather than as a finding.
 *
 * Usage (needs prod DB only — no Meta token; skip rates are already stored).
 * Run via tsx: this imports the shared TS module rather than duplicating the
 * classifiers, so stage 2 cannot drift from what stage 1 measured.
 *   ./node_modules/.bin/tsx scripts/analyze-hook-vs-skip.mjs
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { extractHookSignals, compareSignals, MIN_GROUP_N } from "../shared/hookSignals.ts";

const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });

// Newest snapshot per post that actually reported a skip rate. A post with no
// reported skip rate is EXCLUDED, never treated as zero.
const [rows] = await conn.execute(`
  SELECT j.id AS jobId, j.payload,
         s.skip_rate AS skipRate, s.avg_watch_time_ms AS watchMs, s.reach
    FROM reel_jobs j
    JOIN ig_metric_snapshots s ON s.postId = j.igPostId
   WHERE j.igPostId IS NOT NULL AND j.igPostId <> ''
     AND s.skip_rate IS NOT NULL
     AND s.id = (SELECT MAX(s2.id) FROM ig_metric_snapshots s2
                  WHERE s2.postId = j.igPostId AND s2.skip_rate IS NOT NULL)
   ORDER BY j.id DESC
`);

const samples = [];
for (const r of rows) {
  let beat1 = {};
  try { beat1 = (JSON.parse(r.payload || "{}").storyboardBeats || [])[0] || {}; } catch { /* skip */ }
  if (!beat1.visual && !beat1.onScreenText) continue;
  samples.push({
    jobId: r.jobId,
    skipRate: r.skipRate === null ? null : Number(r.skipRate),
    watchMs: r.watchMs === null ? null : Number(r.watchMs),
    reach: r.reach,
    text: String(beat1.onScreenText || ""),
    signals: extractHookSignals({
      visual: String(beat1.visual || ""),
      motion: String(beat1.motion || ""),
      onScreenText: String(beat1.onScreenText || ""),
    }),
  });
}

console.log(`\nHOOK vs SKIP · ${samples.length} reel(s) with a reported skip rate\n`);
if (samples.length === 0) {
  console.log("  No reels have a stored skip rate yet. `reels_skip_rate` began collecting");
  console.log("  2026-08-01; this becomes answerable as posts accumulate.\n");
  await conn.end();
  process.exit(0);
}

console.log("  job       skip  watch   reach  opener");
for (const s of samples) {
  const w = s.watchMs === null ? "n/r" : `${(s.watchMs / 1000).toFixed(1)}s`;
  const flags = [
    s.signals.textIsWarmup ? "WARMUP" : null,
    s.signals.textIsQuestion ? "question" : null,
    s.signals.textIsClaim ? "claim" : null,
    s.signals.opensTight ? "tight" : s.signals.opensWide ? "wide" : null,
    s.signals.hasMotion ? "motion" : "static",
  ].filter(Boolean).join(" ");
  console.log(`  #${s.jobId}  ${String(s.skipRate).padStart(5)}  ${w.padStart(5)}  ${String(s.reach ?? "n/r").padStart(5)}  ${flags}`);
  console.log(`             "${s.text.slice(0, 66)}"`);
}

console.log(`\n─── signal comparison (needs ${MIN_GROUP_N}+ per side) ───`);
const comparisons = compareSignals(samples);
let reportable = 0;
for (const c of comparisons) {
  if (!c.sufficient) {
    console.log(`  ${c.signal.padEnd(15)} insufficient — ${c.withN} with / ${c.withoutN} without`);
    continue;
  }
  reportable++;
  const dir = c.delta > 0 ? "MORE skipped" : "LESS skipped";
  console.log(
    `  ${c.signal.padEnd(15)} with ${c.withAvgSkip.toFixed(1)} (n=${c.withN}) · without ${c.withoutAvgSkip.toFixed(1)} (n=${c.withoutN}) · ${Math.abs(c.delta).toFixed(1)} ${dir}`,
  );
}

console.log("\n─── verdict ───");
if (reportable === 0) {
  console.log(`  NOTHING IS REPORTABLE YET. Every signal has under ${MIN_GROUP_N} posts on one side.`);
  console.log("  That is the honest answer, not a failure — the account has too few measured");
  console.log("  reels to tell a real hook property from noise. Publish more, re-run.");
  console.log("  Do NOT turn any of these into a gate on this evidence.");
} else {
  console.log(`  ${reportable} signal(s) have enough posts to compare. Still DIRECTIONAL:`);
  console.log("  a difference here is a candidate to test deliberately, not a rule to enforce.");
}
console.log("");
await conn.end();
