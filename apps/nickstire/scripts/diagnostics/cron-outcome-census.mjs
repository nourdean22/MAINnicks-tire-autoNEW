/**
 * cron-outcome-census · for every job the scheduler owns: did it become eligible,
 * did it attempt, did it produce an OUTCOME — three separate questions, because
 * "completed with 0 records" is not evidence of anything (operator mandate
 * 2026-09-22 item 14: eligibility heartbeat → attempt → outcome).
 *
 * READ-ONLY: cron_log and cron_tier_skip_state only. Per job, over --days (7):
 *   tier            which tier owns it (from the scheduler's own cadence map)
 *   runs            cron_log rows
 *   completed/failed/skipped
 *   zero-record     completed rows with recordsProcessed 0 or NULL
 *   last non-zero   the last completed run whose recordsProcessed > 0 (age in h)
 *   last details    the most recent row's details, so a "why" is visible
 *   verdict         OUTCOME_SEEN · ATTEMPTED_ONLY (every completed run is a zero) ·
 *                   FAILING (last run failed) · SKIPPED (last run skipped) ·
 *                   NEVER_RAN (no row in the window) — tier eligibility shown beside it
 *
 *   railway run -s MAINnicks-tire-auto -- node scripts/diagnostics/cron-outcome-census.mjs [--days 7] [--only ATTEMPTED_ONLY,NEVER_RAN]
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DAYS = Number(opt("days", "7"));
const ONLY = opt("only", "").split(",").filter(Boolean);

const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("mysql://")) {
  console.error("DATABASE_URL missing — run via: railway run -s MAINnicks-tire-auto -- node scripts/diagnostics/cron-outcome-census.mjs");
  process.exit(1);
}

// The tier each job belongs to, read from the scheduler source (no import: the
// scheduler boots timers on import). `name: "x"` lines under a `name: "<tier>"`
// tier header, in file order.
const src = readFileSync(new URL("../../server/cron/scheduler.ts", import.meta.url), "utf8");
const tierOf = new Map();
const disabled = new Set(); // `enabled: false` jobs skip inside runTier WITHOUT a cron_log row — invisible unless read from source
{
  const tiers = new Set(["heartbeat", "pulse", "hourly", "daily", "briefings"]);
  let current = null;
  let lastJob = null;
  for (const line of src.split("\n")) {
    const m = line.match(/^\s*name: "([a-z0-9-]+)"/);
    if (m) {
      if (tiers.has(m[1]) && /^\s{4}name:/.test(line)) { current = m[1]; lastJob = null; continue; }
      if (current && !tierOf.has(m[1])) { tierOf.set(m[1], current); lastJob = m[1]; }
      continue;
    }
    if (lastJob && /^\s*enabled: false,/.test(line)) disabled.add(lastJob);
  }
}

const c = await mysql.createConnection(url);
const [tiers] = await c.query(
  "SELECT tier_name, TIMESTAMPDIFF(MINUTE, last_run_at, NOW()) AS lastRunMin FROM cron_tier_skip_state WHERE tier_name IN ('heartbeat','pulse','hourly','daily','briefings')",
);
// cron_log is trimmed by the cleanup job: "never (60d)" can only mean "never in
// what the log still holds" — print the horizon so the reader knows the denominator.
const [[horizon]] = await c.query("SELECT TIMESTAMPDIFF(HOUR, MIN(started_at), NOW()) AS ageH, COUNT(*) AS n FROM cron_log");
const tierAge = new Map(tiers.map((t) => [t.tier_name, t.lastRunMin]));

const [rows] = await c.query(
  `SELECT job_name,
          COUNT(*) AS runs,
          SUM(status = 'completed') AS completed,
          SUM(status = 'failed') AS failed,
          SUM(status = 'skipped') AS skipped,
          SUM(status = 'completed' AND COALESCE(records_processed, 0) = 0) AS zeroRuns,
          MAX(CASE WHEN status = 'completed' AND records_processed > 0 THEN started_at END) AS lastNonZero,
          MAX(started_at) AS lastRun
   FROM cron_log
   WHERE started_at >= NOW() - INTERVAL ? DAY
   GROUP BY job_name`,
  [DAYS],
);
const [latest] = await c.query(
  `SELECT l.job_name, l.status, LEFT(COALESCE(l.details, ''), 110) AS details, TIMESTAMPDIFF(HOUR, l.started_at, NOW()) AS ageH
   FROM cron_log l
   JOIN (SELECT job_name, MAX(started_at) AS m FROM cron_log WHERE started_at >= NOW() - INTERVAL ? DAY GROUP BY job_name) x
     ON x.job_name = l.job_name AND x.m = l.started_at`,
  [DAYS],
);
const [nonZeroAge] = await c.query(
  `SELECT job_name, TIMESTAMPDIFF(HOUR, MAX(started_at), NOW()) AS ageH FROM cron_log
   WHERE started_at >= NOW() - INTERVAL 60 DAY AND status = 'completed' AND records_processed > 0 GROUP BY job_name`,
);
await c.end();

const byJob = new Map(rows.map((r) => [r.job_name, r]));
const latestBy = new Map(latest.map((r) => [r.job_name, r]));
const nzAge = new Map(nonZeroAge.map((r) => [r.job_name, Number(r.ageH)]));

const verdictOf = (name, r) => {
  const last = latestBy.get(name);
  if (disabled.has(name)) return r ? "DISABLED_NOW" : "DISABLED";
  if (!r) return "NEVER_RAN";
  if (last?.status === "failed") return "FAILING";
  if (last?.status === "skipped") return "SKIPPED";
  if (Number(r.completed) > 0 && Number(r.zeroRuns) === Number(r.completed)) return "ATTEMPTED_ONLY";
  return "OUTCOME_SEEN";
};

const names = [...new Set([...tierOf.keys(), ...byJob.keys()])].sort();
const tally = {};
const lines = [];
for (const name of names) {
  const r = byJob.get(name);
  const v = verdictOf(name, r);
  tally[v] = (tally[v] ?? 0) + 1;
  if (ONLY.length && !ONLY.includes(v)) continue;
  const tier = tierOf.get(name) ?? "?";
  const tAge = tierAge.get(tier);
  const last = latestBy.get(name);
  const nz = nzAge.get(name);
  lines.push(
    `| ${name} | ${tier}${tAge == null ? "" : ` (${Math.round(tAge / 60)}h)`} | ${r ? r.runs : 0} | ${r ? `${r.completed}/${r.failed}/${r.skipped}` : "—"} | ${r ? r.zeroRuns : "—"} | ${nz == null ? "never (60d)" : `${nz}h ago`} | ${v} | ${last ? `${last.status} ${last.ageH}h: ${String(last.details).replace(/\|/g, "/")}` : "—"} |`,
  );
}
console.log(`cron outcome census · ${DAYS}d · ${names.length} jobs · tiers last ran (h ago): ${[...tierAge].map(([t, m]) => `${t} ${Math.round(m / 60)}`).join(" · ")}`);
console.log(`cron_log horizon: oldest row ${Math.round(Number(horizon.ageH) / 24)} days ago (${horizon.n} rows) — "never" below means never within that horizon, nothing older is knowable from this table`);
console.log("verdicts: " + Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · "));
console.log("");
console.log("| job | tier (last pass) | runs | completed/failed/skipped | zero-record | last non-zero outcome | verdict | latest run |");
console.log("|---|---|---|---|---|---|---|---|");
for (const l of lines) console.log(l);
