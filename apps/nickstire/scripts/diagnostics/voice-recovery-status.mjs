/**
 * voice-recovery-status — did the recovery lane dial, and what happened.
 *
 * READ-ONLY. Every statement is a SELECT. Run against production through the
 * service environment so no key is pasted into a command:
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm diag:voice-recovery
 *   railway run -s MAINnicks-tire-auto -- pnpm diag:voice-recovery -- --days 14
 *
 * WHY THIS EXISTS. On 2026-09-22 the lane turned out to have dialed 110 times
 * and connected 0 — every attempt rejected by Vapi (a partial model override)
 * and every lead burned — while cron_log said "completed · placed=0 failed=N"
 * for three months. Nobody read the OUTCOME column. This prints it: the dial
 * runs, the outcome distribution on alg_estimates, how many leads are eligible
 * right now, and what would promote the ledger row voice-recovery-outbound-dial
 * (a placed run plus a call id on the row). Run it the day after a change to
 * the lane, and after the burned-lead release script.
 *
 * PII: estimate ids, counts and dates only. No phone, no name, no transcript.
 */
import mysql from "mysql2/promise";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DAYS = Math.max(1, Number(arg("days", "7")) || 7);

const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("mysql://")) {
  console.error("DATABASE_URL missing or not mysql:// — run via: railway run -s MAINnicks-tire-auto -- pnpm diag:voice-recovery");
  process.exit(1);
}

const c = await mysql.createConnection(url);
try {
  const u = new URL(url);
  console.log(`TARGET ${u.hostname}${u.pathname} · last ${DAYS}d\n`);

  const [runs] = await c.query(
    `SELECT DATE_FORMAT(started_at, '%m-%d %H:%i') AS at, status, records_processed AS placed,
            LEFT(COALESCE(details, error_message, ''), 160) AS d
     FROM cron_log
     WHERE job_name = 'voice-recovery' AND started_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       AND (details LIKE 'placed=%' OR status <> 'completed' OR details LIKE 'No estimates%' OR details LIKE 'Skipped%')
     ORDER BY started_at DESC LIMIT 20`,
    [DAYS],
  );
  console.log(`RUNS (dial runs, skips and failures; hour-gate rows omitted): ${runs.length}`);
  for (const r of runs) console.log(`  ${r.at}  ${r.status.padEnd(9)} placed=${r.placed ?? 0}  ${r.d}`);

  const [out] = await c.query(
    `SELECT COALESCE(voice_recovery_outcome, '<null>') AS outcome, COUNT(*) AS n,
            SUM(voice_recovery_call_id IS NOT NULL) AS withCallId,
            DATE_FORMAT(MIN(voice_recovery_attempted_at), '%m-%d') AS firstAt,
            DATE_FORMAT(MAX(voice_recovery_attempted_at), '%m-%d') AS lastAt
     FROM alg_estimates WHERE voice_recovery_attempted_at IS NOT NULL
     GROUP BY outcome ORDER BY n DESC`,
  );
  console.log(`\nOUTCOMES (alg_estimates, all attempted leads):`);
  for (const r of out) console.log(`  ${String(r.n).padStart(5)}  ${r.outcome.padEnd(15)} with call id ${r.withCallId}  ${r.firstAt}..${r.lastAt}`);
  if (out.length === 0) console.log("  (no lead has ever been attempted)");

  const [[elig]] = await c.query(
    `SELECT COUNT(*) AS n FROM alg_estimates
     WHERE follow_up_30d_sent = 1 AND matched_invoice_id IS NULL AND voice_recovery_attempted_at IS NULL
       AND follow_up_30d_sent_at IS NOT NULL AND follow_up_30d_sent_at <= DATE_SUB(NOW(), INTERVAL 7 DAY)
       AND customer_phone IS NOT NULL`,
  );
  const [[burned]] = await c.query(
    `SELECT COUNT(*) AS n FROM alg_estimates WHERE voice_recovery_outcome = 'failed' AND voice_recovery_call_id IS NULL`,
  );
  console.log(`\nELIGIBLE NOW (the cron's own predicate): ${elig.n}`);
  console.log(`NEVER-RANG rows still marked failed (outcome failed, no call id): ${burned.n} — scripts/maintenance/release-voice-recovery-claims.mjs`);

  const placedRuns = runs.filter((r) => Number(r.placed) > 0).length;
  const withCall = out.reduce((a, r) => a + Number(r.withCallId), 0);
  console.log(`\nPROMOTION (ledger row voice-recovery-outbound-dial → live_verified): ${placedRuns > 0 && withCall > 0 ? "READY — a placed run and a call id exist" : "NOT YET — needs a run with placed>=1 and a row carrying voice_recovery_call_id"}`);
} finally {
  await c.end();
}
