/**
 * audit-log-shape-readonly.mts — READ-ONLY confirmation probe for the bounded
 * bridge send action's idempotency marker.
 *
 * WHY THIS EXISTS (2026-08-10). `send_opportunity_sms` — the one customer-texting
 * action statenour may call — guarded replays with
 *
 *   SELECT 1 FROM audit_log WHERE action = 'sms.bridge_send'
 *     AND details LIKE '%bridge_send:<key>%'
 *
 * `audit_log` has no `details` column. It was created in
 * drizzle/0016_past_stone_men.sql with 8 columns (id, actor, action,
 * entity_type, entity_id, changes, ip_address, created_at) and has never been
 * ALTERed. `logAdminAction` writes the detail string into the `changes` JSON at
 * `$.detail.new` — the documented house rule for this table ("we avoid a new DB
 * migration by using audit_log's `changes` JSON column",
 * services/snapApplications.ts:4).
 *
 * So every call raised MySQL 1054, `exec()` did not catch, and the dispatcher
 * turned it into a generic 500 that statenour rendered as "❌ Opportunity SMS
 * blocked/failed" — a total outage wearing the costume of a working safety gate.
 * Fixed in the same commit that added this file; the unit tests mock `execute`,
 * so only the schema (or prod) could settle it.
 *
 * WHAT THIS SCRIPT IS FOR NOW: confirming against production that (a) the shape
 * assumption holds and (b) markers actually accumulate after the fix deploys.
 * Zero rows for `sms.bridge_send` is the expected PRE-fix state.
 *
 * SAFETY — this file contains SHOW/SELECT statements and nothing else. There is
 * no DELETE, UPDATE, INSERT, TRUNCATE, DROP or ALTER anywhere in it, and no
 * write path exists to guard. It prints the resolved DB host before querying so
 * the target is proven rather than assumed (prod-db-guard step 3).
 *
 * Run:  pnpm exec tsx scripts/audit-log-shape-readonly.mts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — refusing to guess a target.");
  process.exit(1);
}

const parsed = new URL(url);
console.log(`DB host   : ${parsed.hostname}`);
console.log(`DB name   : ${parsed.pathname.replace(/^\//, "")}`);
console.log(`user      : ${parsed.username ? parsed.username.slice(0, 4) + "…" : "(none)"}`);
console.log("mode      : READ-ONLY (SHOW / SELECT only)\n");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });

try {
  const [cols] = await conn.query("SHOW COLUMNS FROM audit_log");
  const names = (cols as Array<{ Field: string; Type: string }>).map((c) => c.Field);
  console.log(`audit_log columns : ${names.join(", ")}`);
  console.log(`has 'details'     : ${names.includes("details") ? "YES — revisit the guard's JSON extraction" : "NO (expected)"}`);
  console.log(`has 'changes'     : ${names.includes("changes") ? "YES (expected)" : "NO — the guard cannot work"}\n`);

  const [rows] = await conn.query(
    "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'sms.bridge_send'",
  );
  const n = Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
  console.log(`sms.bridge_send markers ever written : ${n}`);
  console.log(n === 0
    ? "  → consistent with the guard having thrown on every call (pre-fix state)."
    : "  → markers present; the guard can dedupe.");

  if (n > 0) {
    const [sample] = await conn.query(
      `SELECT created_at, actor, entity_id,
              JSON_UNQUOTE(JSON_EXTRACT(changes, '$.detail.new')) AS marker_detail
         FROM audit_log WHERE action = 'sms.bridge_send'
        ORDER BY created_at DESC LIMIT 5`,
    );
    console.log("\nmost recent markers (read via the exact path the guard queries):");
    for (const r of sample as Array<Record<string, unknown>>) {
      console.log(`  ${String(r.created_at)} · ${String(r.actor)} · ${String(r.marker_detail).slice(0, 140)}`);
    }
  }
} finally {
  await conn.end();
}
