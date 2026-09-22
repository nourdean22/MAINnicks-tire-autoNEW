/**
 * release-voice-recovery-claims — give back the leads a dial that never rang burned.
 *
 * OPERATOR-RUN, PROD-WRITING. Dry run by default; nothing is written unless
 * `--execute` is passed, and the dry run returns before any UPDATE is built.
 *
 *   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/release-voice-recovery-claims.mjs
 *   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/release-voice-recovery-claims.mjs --execute
 *   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/release-voice-recovery-claims.mjs --max-age-days 45
 *
 * WHY THIS EXISTS. From 2026-06-18 to 2026-09-20 every voice-recovery dial —
 * 110 of 110 — was rejected by Vapi before the call existed (a partial model
 * override; 400 "assistantOverrides.model.provider must be one of…"). The
 * cron had already claimed each lead (voice_recovery_attempted_at set) and
 * then wrote outcome "failed", so every one of those customers is now
 * permanently ineligible for the one call the lane exists to make, without
 * ever having been rung. The cron no longer burns a lead on that class of
 * failure; this script is the one-time repair for the rows it already burned.
 *
 * WHAT IT SELECTS — only rows that provably never rang:
 *   voice_recovery_outcome = 'failed' AND voice_recovery_call_id IS NULL
 * A row with a call id reached Vapi and is NOT touched, whatever its outcome.
 *
 * AGE CUTOFF, AND WHY THE DEFAULT IS 60 DAYS. The recovery prompt tells the
 * customer their quote was "about 5-6 weeks ago". A lead whose D30 text went
 * out months ago would be called with a script that is no longer true, so by
 * default only leads whose follow_up_30d_sent_at is within --max-age-days are
 * released; the rest are LISTED and left as they are. The operator can widen
 * the window deliberately; the script will not do it by default.
 *
 * WHAT A RELEASE DOES. voice_recovery_attempted_at -> NULL and
 * voice_recovery_outcome -> NULL, which is exactly the state the cron's
 * at-most-once claim looks for. The lane then dials them at its own pace
 * (VAPI_RECOVERY_BATCH_SIZE, default 5 per run, one run per day, 10-17 ET).
 *
 * SAFETY. --execute first copies the affected rows into
 * _bak_alg_estimates_voice_release_<yyyymmdd> (CREATE TABLE … LIKE, then
 * INSERT … SELECT — the two-statement form TiDB accepts), verifies the copy's
 * row count, and only then updates. Reversal is
 *   UPDATE alg_estimates a JOIN <bak> b ON b.id = a.id
 *   SET a.voice_recovery_attempted_at = b.voice_recovery_attempted_at,
 *       a.voice_recovery_outcome = b.voice_recovery_outcome;
 * No customer is contacted by this script. Read prod-db-guard before running.
 */
import mysql from "mysql2/promise";

const argv = process.argv.slice(2);
const EXECUTE = argv.includes("--execute");
const argVal = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const MAX_AGE_DAYS = Math.max(1, Number(argVal("max-age-days", "60")) || 60);

const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("mysql://")) {
  console.error("DATABASE_URL missing or not mysql:// — run via: railway run -s MAINnicks-tire-auto -- node scripts/maintenance/release-voice-recovery-claims.mjs");
  process.exit(1);
}

const c = await mysql.createConnection(url);
try {
  const u = new URL(url);
  console.log(`TARGET ${u.hostname}${u.pathname} · mode ${EXECUTE ? "EXECUTE" : "DRY RUN"} · max age ${MAX_AGE_DAYS}d\n`);

  // Never-rang rows, split by whether the recovery script would still be true.
  const [rows] = await c.query(
    `SELECT id,
            DATE_FORMAT(follow_up_30d_sent_at, '%Y-%m-%d') AS d30,
            DATE_FORMAT(voice_recovery_attempted_at, '%Y-%m-%d') AS attempted,
            (follow_up_30d_sent_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS inWindow
     FROM alg_estimates
     WHERE voice_recovery_outcome = 'failed' AND voice_recovery_call_id IS NULL
     ORDER BY follow_up_30d_sent_at DESC`,
    [MAX_AGE_DAYS],
  );
  const release = rows.filter((r) => Number(r.inWindow) === 1);
  const tooOld = rows.filter((r) => Number(r.inWindow) !== 1);
  console.log(`never-rang rows (outcome failed, no call id): ${rows.length}`);
  console.log(`  would RELEASE (D30 text within ${MAX_AGE_DAYS}d): ${release.length}`);
  for (const r of release) console.log(`    est ${r.id} · D30 ${r.d30} · burned ${r.attempted}`);
  console.log(`  left as-is (older than ${MAX_AGE_DAYS}d — the "5-6 weeks ago" script would be false): ${tooOld.length}`);
  if (tooOld.length) console.log(`    oldest D30 ${tooOld[tooOld.length - 1].d30} · newest ${tooOld[0].d30}`);

  if (!EXECUTE) {
    console.log("\nDRY RUN — nothing written. Re-run with --execute to release the rows listed above.");
    process.exit(0);
  }
  if (release.length === 0) {
    console.log("\nnothing to release");
    process.exit(0);
  }

  const ids = release.map((r) => Number(r.id));
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const bak = `_bak_alg_estimates_voice_release_${stamp}`;

  // Backup first — a rejected copy aborts the run instead of orphaning it.
  await c.query(`CREATE TABLE IF NOT EXISTS \`${bak}\` LIKE alg_estimates`);
  await c.query(`INSERT INTO \`${bak}\` SELECT * FROM alg_estimates WHERE id IN (?) AND id NOT IN (SELECT id FROM \`${bak}\`)`, [ids]);
  const [[{ n: backed }]] = await c.query(`SELECT COUNT(*) AS n FROM \`${bak}\` WHERE id IN (?)`, [ids]);
  if (Number(backed) !== ids.length) {
    console.error(`ABORT: backup holds ${backed} of ${ids.length} rows — nothing updated`);
    process.exit(2);
  }
  console.log(`\nbacked up ${backed} rows into ${bak}`);

  const [res] = await c.query(
    `UPDATE alg_estimates
     SET voice_recovery_attempted_at = NULL, voice_recovery_outcome = NULL
     WHERE id IN (?) AND voice_recovery_outcome = 'failed' AND voice_recovery_call_id IS NULL`,
    [ids],
  );
  console.log(`released ${res.affectedRows} of ${ids.length} rows (attempted_at NULL, outcome NULL)`);
  const [[{ n: remaining }]] = await c.query(
    `SELECT COUNT(*) AS n FROM alg_estimates WHERE voice_recovery_outcome = 'failed' AND voice_recovery_call_id IS NULL`,
  );
  console.log(`never-rang rows still marked failed: ${remaining} (the ones older than ${MAX_AGE_DAYS}d, by design)`);
} finally {
  await c.end();
}
