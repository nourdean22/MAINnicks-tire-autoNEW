/**
 * backstamp-queued-orchestrations · the one-time back-stamp of historical
 * sms_orchestrations rows that read `queued · outside_hours_queued` although
 * their text was sent (or failed) by the delayed queue. The cron
 * orchestration-status-reconcile does this going forward for rows younger
 * than 7 days; this script covers everything older, on the operator's say-so.
 *
 * DRY RUN BY DEFAULT: without --execute it only SELECTs and prints what would
 * be stamped, by outcome and by month, and returns before any UPDATE is built.
 *
 *   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/backstamp-queued-orchestrations.mjs
 *   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/backstamp-queued-orchestrations.mjs --execute
 *
 * SAFETY. --execute copies the matched rows into
 * _bak_sms_orchestrations_backstamp_<yyyymmdd> (CREATE TABLE … LIKE, INSERT …
 * SELECT of the matched ids, count-verified) before the UPDATE, and every
 * UPDATE re-checks the queued state in its WHERE. Never sends anything.
 */
import mysql from "mysql2/promise";

const EXECUTE = process.argv.includes("--execute");
const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("mysql://")) {
  console.error("DATABASE_URL missing — run via: railway run -s MAINnicks-tire-auto -- node scripts/maintenance/backstamp-queued-orchestrations.mjs");
  process.exit(1);
}
const c = await mysql.createConnection(url);

const [cands] = await c.query(`
  SELECT o.id, DATE_FORMAT(o.createdAt, '%Y-%m') AS m,
         MAX(CASE WHEN mm.status IN ('sent','delivered') THEN 1 ELSE 0 END) AS anySent,
         MAX(CASE WHEN mm.status = 'failed' THEN 1 ELSE 0 END) AS anyFailed,
         MAX(mm.sent_at) AS sentAt
  FROM sms_orchestrations o
  JOIN sms_conversations sc ON sc.phone = RIGHT(REGEXP_REPLACE(o.customer_phone, '[^0-9]', ''), 10)
  JOIN sms_messages mm ON mm.conversationId = sc.id AND mm.direction = 'outbound'
    AND mm.createdAt BETWEEN o.createdAt - INTERVAL 5 MINUTE AND o.createdAt + INTERVAL 36 HOUR
  WHERE o.status = 'queued' AND o.status_reason = 'outside_hours_queued'
  GROUP BY o.id, m ORDER BY o.id`);
const [[total]] = await c.query("SELECT COUNT(*) AS n FROM sms_orchestrations WHERE status = 'queued' AND status_reason = 'outside_hours_queued'");
const toSent = cands.filter((r) => Number(r.anySent) === 1);
const toFailed = cands.filter((r) => Number(r.anySent) !== 1 && Number(r.anyFailed) === 1);
const byMonth = {};
for (const r of cands) { const k = Number(r.anySent) === 1 ? "sent" : Number(r.anyFailed) === 1 ? "failed" : "none"; byMonth[r.m] ??= { sent: 0, failed: 0, none: 0 }; byMonth[r.m][k] += 1; }
console.log(`queued·outside_hours_queued rows: ${total.n} · with a message row in the window: ${cands.length} · would stamp sent ${toSent.length}, failed ${toFailed.length}, leave ${cands.length - toSent.length - toFailed.length} (+ ${Number(total.n) - cands.length} with no message row)`);
for (const [m, v] of Object.entries(byMonth).sort()) console.log(`  ${m}: sent ${v.sent} · failed ${v.failed} · none ${v.none}`);

if (!EXECUTE) {
  console.log("DRY RUN — nothing written. Re-run with --execute to back up and stamp.");
  await c.end();
  process.exit(0);
}
const ids = [...toSent, ...toFailed].map((r) => Number(r.id));
if (ids.length === 0) { console.log("nothing to stamp"); await c.end(); process.exit(0); }
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const bak = `_bak_sms_orchestrations_backstamp_${stamp}`;
await c.query(`CREATE TABLE IF NOT EXISTS \`${bak}\` LIKE sms_orchestrations`);
await c.query(`INSERT IGNORE INTO \`${bak}\` SELECT * FROM sms_orchestrations WHERE id IN (?)`, [ids]);
const [[bakCount]] = await c.query(`SELECT COUNT(*) AS n FROM \`${bak}\` WHERE id IN (?)`, [ids]);
if (Number(bakCount.n) !== ids.length) { console.error(`backup holds ${bakCount.n} of ${ids.length} — aborting before any UPDATE`); await c.end(); process.exit(1); }
console.log(`backup ${bak}: ${bakCount.n} rows verified`);
let sent = 0; let failed = 0;
for (const r of toSent) {
  const [res] = await c.query("UPDATE sms_orchestrations SET status = 'sent', status_reason = 'sent_from_delayed_queue', sent_at = COALESCE(?, NOW()), updatedAt = NOW() WHERE id = ? AND status = 'queued' AND status_reason = 'outside_hours_queued'", [r.sentAt, r.id]);
  sent += res.affectedRows;
}
for (const r of toFailed) {
  const [res] = await c.query("UPDATE sms_orchestrations SET status = 'failed', status_reason = 'delayed_queue_failed', failed_at = NOW(), updatedAt = NOW() WHERE id = ? AND status = 'queued' AND status_reason = 'outside_hours_queued'", [r.id]);
  failed += res.affectedRows;
}
console.log(`stamped sent ${sent} · failed ${failed} · backup kept in ${bak}`);
await c.end();
