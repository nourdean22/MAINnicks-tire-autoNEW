/**
 * start-hook-experiment.mjs · begin the opening-line test
 *
 * HYPOTHESIS: warm-up openers lose viewers before the content starts.
 * Measured 2026-08-01 across the reels with a reported skip rate — the account's
 * two WORST are its only two warm-up openers, and its best two open with a
 * question:
 *
 *   83.6 skip · 2.8s   "Cleveland's mid-July sun: Not just baking the asphalt..."
 *   82.6 skip · 3.0s   "Cleveland winters bring more than just snow..."
 *   39.8 skip · 5.8s   "What's hiding under your car?"
 *   42.3 skip · 6.3s   "Is this your windshield after a light rain?"
 *
 * n=2 per side. That is a hypothesis, not a finding — which is exactly why this
 * is an experiment rather than a new rule in the master prompt.
 *
 * DESIGN
 *
 * · TWO ARMS: `control` (current behaviour, untouched) and `direct` (the opener
 *   may not warm up). There is deliberately NO warm-up arm — deliberately
 *   shipping content we expect to underperform, to a real audience, to prove a
 *   point we can test one-sided, is not a trade worth making.
 *
 * · PRIMARY METRIC IS avgWatchTimeMs, NOT skip_rate. evaluateExperiment picks
 *   the arm with the HIGHEST rate, so a lower-is-better metric would crown the
 *   worse arm. Watch time is the correctly-signed complement and is what
 *   Instagram actually distributes on.
 *
 * · ONE VARIABLE. Both arms share provider, franchise, cta and slot, so
 *   findConfounds() stays clean and a result can be attributed.
 *
 * The arm reaches the PROMPT via hookArmForEpisode(), resolved before
 * generation. Assignment at enqueue only records; it cannot change what is made.
 *
 * SAFETY: DRY RUN by default; --apply to write. Refuses if a hook_style
 * experiment is already running, rather than creating a second one that would
 * fight it for episodes.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const EXPERIMENT_ID = "hook-style-2026-08";

const ARMS = [
  { armId: "control", variantValue: "control" },
  { armId: "direct", variantValue: "direct" },
];

const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });

const [running] = await conn.execute(
  "SELECT experiment_id, started_at FROM content_experiments WHERE status = 'running' AND primary_variable = 'hook_style'",
);
if (running.length) {
  console.error(`\nREFUSING: a hook_style experiment is already running (${running[0].experiment_id}, started ${running[0].started_at}).`);
  console.error("  Two would fight over the same episodes and neither would be interpretable.\n");
  await conn.end();
  process.exit(1);
}

console.log(`\nexperiment : ${EXPERIMENT_ID}`);
console.log(`variable   : hook_style   ·   arms: ${ARMS.map((a) => a.variantValue).join(" vs ")}`);
console.log(`metric     : avgWatchTimeMs (higher is better — skip_rate is inverted and would crown the worse arm)`);
console.log(`objective  : discovery`);
console.log(`assignment : deterministic on briefId, resolved BEFORE generation so the arm reaches the prompt`);

if (!APPLY) {
  console.log("\nDRY RUN — re-run with --apply to start it.\n");
  await conn.end();
  process.exit(0);
}

const [res] = await conn.execute(
  `INSERT INTO content_experiments
     (experiment_id, primary_variable, objective, primary_metric, arms_json, status)
   VALUES (?, 'hook_style', 'discovery', 'avgWatchTimeMs', ?, 'running')
   ON DUPLICATE KEY UPDATE arms_json = VALUES(arms_json), status = 'running'`,
  [EXPERIMENT_ID, JSON.stringify(ARMS)],
);
console.log(`\naffectedRows = ${res.affectedRows}`);

const [after] = await conn.execute(
  "SELECT experiment_id, status, primary_variable, primary_metric FROM content_experiments WHERE experiment_id = ?",
  [EXPERIMENT_ID],
);
console.log(`verified: ${after[0].experiment_id} · ${after[0].status} · ${after[0].primary_variable} → ${after[0].primary_metric}`);
console.log("\nEvery new daily reel now lands in an arm. Read results with:");
console.log("  ./node_modules/.bin/tsx scripts/analyze-hook-vs-skip.mjs\n");
await conn.end();
