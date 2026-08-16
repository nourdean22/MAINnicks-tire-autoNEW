/**
 * Runtime verification for the reel shadow-judge readout (PR #1612).
 *
 * Proves `scripts/reel-shadow-judge-readout.ts` EXECUTES — not merely that it
 * typechecks. `scripts/` sits outside `tsconfig.json`'s include, so the repo gate
 * never looks at that file at all, and unit tests exercise the pure summarizer
 * without ever running a query. This drives the REAL script against a throwaway
 * local MySQL: no prod DB, no LLM, no Meta, no writes to anything that matters.
 *
 * It earned its keep twice on first run. It caught that the script HUNG after
 * printing (getDb() opens a mysql2 pool with no exported close, so the tail
 * needed `process.exit(0)` like scripts/data-census.ts:122 — the harness timeout
 * killed the child and reported exit `null`), and it confirmed every bucket and
 * exclusion reason against a hand-checked seed.
 *
 * The seed is deliberately adversarial — one row for each branch that could lie:
 *
 *   judged, sub-threshold, PUBLISHED  → the realized-exposure number
 *   judged, hard reject, ambiguous    → must NOT count as exposure (may be live)
 *   judged, clear                     → the denominator
 *   verdict row present but UNPARSEABLE → no_verdict bucket, neither side
 *   eligible, posted, NO verdict row  → the real coverage gap
 *   posted before the rollout date    → excluded, and SAID so
 *   posted via another publish path   → excluded, and SAID so
 *   never posted                      → excluded from coverage entirely
 *
 * Expected (verified 2026-08-16): judged 3 · would block 2 (1 hard reject,
 * 1 below 60) · clear 1 · no verdict 1 · exposure 1 · mean 73.3 · coverage 3/4
 * with 1 before-rollout and 1 other-path excluded · script exit 0.
 *
 * Never touches production: the readout's loadEnvFromDotenv only fills vars that
 * are undefined, so the explicit DATABASE_URL in the child env wins over .env.
 *
 * Run:  pnpm exec tsx scripts/verify-reel-shadow-readout.mts
 */
import { spawnSync } from "node:child_process";
import mysql from "mysql2/promise";
import { startDevDb } from "./lib/dev-db.mjs";

const { url, stop } = await startDevDb({ dbName: "reelshadow" });
console.log("\n[harness] disposable DB up\n");

try {
  const c = await mysql.createConnection(url);

  const kv = (key: string, value: string) =>
    c.execute(
      "INSERT INTO shop_settings (`key`, value, label, category, updatedBy) VALUES (?,?,?,'general','system')",
      [key, value, `seed ${key}`],
    );

  // Judge verdicts: sub-threshold block, clear, hard reject, and UNPARSEABLE.
  await kv("reel_shadow_judge_101", JSON.stringify({ total: 42, rejected: false, briefId: "autopost-2026-08-14", topic: "brake pad wear", note: "generic mechanic imagery any shop could run", at: "2026-08-14T13:00:00Z" }));
  await kv("reel_shadow_judge_102", JSON.stringify({ total: 88, rejected: false, briefId: "autopost-2026-08-15", topic: "TPMS light", at: "2026-08-15T13:00:00Z" }));
  await kv("reel_shadow_judge_103", JSON.stringify({ total: 90, rejected: true, briefId: "autopost-2026-08-16", topic: "battery heat myth", note: "unsupported claim", at: "2026-08-16T13:00:00Z" }));
  await kv("reel_shadow_judge_104", "{not json");
  // Must be IGNORED by the LIKE scan's parser.
  await kv("reel_autopost_index", "7");
  // QC rows so judge-vs-QC agreement is exercised.
  await kv("reel_qc_checklist_101", JSON.stringify({ passCount: 7, failCount: 2, at: "x" }));
  await kv("reel_qc_checklist_102", JSON.stringify({ passCount: 9, failCount: 0, at: "x" }));

  const job = (id: number, briefId: string, status: string, igPostId: string | null) =>
    c.execute(
      "INSERT INTO reel_jobs (id, briefId, payload, status, igPostId, caption, source) VALUES (?,?,?,?,?,?,?)",
      [id, briefId, JSON.stringify({ topic: briefId }), status, igPostId, "caption", "cron"],
    );

  await job(101, "autopost-2026-08-14", "posted", "ig_101");        // eligible, judged, would-block, LIVE
  await job(102, "autopost-2026-08-15", "posted", "ig_102");        // eligible, judged, clear
  await job(103, "autopost-2026-08-16", "publish_ambiguous", null); // judged, outcome UNKNOWN
  await job(104, "autopost-2026-08-16", "posted", "ig_104");        // eligible, verdict unparseable
  await job(105, "autopost-2026-08-15", "posted", "ig_105");        // eligible, NO verdict row -> real gap
  await job(106, "autopost-2026-07-01", "posted", "ig_106");        // pre-rollout -> excluded
  await job(107, "campaign-manual-9", "posted", "ig_107");          // other publish path -> excluded
  await job(108, "autopost-2026-08-15", "assembled", null);         // never posted -> excluded
  await c.end();
  console.log("[harness] seeded 7 KV rows + 8 reel_jobs\n");

  const r = spawnSync("pnpm", ["exec", "tsx", "scripts/reel-shadow-judge-readout.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
    shell: true,
    timeout: 180_000,
  });
  console.log("──── SCRIPT STDOUT ────");
  console.log(r.stdout ?? "(none)");
  if (r.stderr?.trim()) console.log("──── STDERR ────\n" + r.stderr);
  console.log(`──── script exit: ${r.status} ────`);
} finally {
  await stop();
  console.log("[harness] disposable DB torn down");
}
