/**
 * consent-coverage-readonly.mts — READ-ONLY. What does arming the consent gate cost?
 *
 * `consentGateShadowMisses` is an in-process counter that resets on every deploy,
 * so it only measures uptime, not reality. The durable answer is in the data:
 * how many phones carry an `sms.opt_in` row in `audit_log`, against how many the
 * marketing lanes could actually text.
 *
 * SAFETY — SELECT statements only. No DELETE / UPDATE / INSERT / DDL anywhere in
 * this file, so there is no write path to guard. Prints the resolved host before
 * querying (prod-db-guard step 3).
 *
 * Run: pnpm exec tsx scripts/consent-coverage-readonly.mts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — refusing to guess a target.");
  process.exit(1);
}
const parsed = new URL(url);
console.log(`DB host : ${parsed.hostname}`);
console.log(`DB name : ${parsed.pathname.replace(/^\//, "")}`);
console.log("mode    : READ-ONLY (SELECT only)\n");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });

/** last-10-digit key — the same normalisation the consent + opt-out indexes use */
const KEY = (col: string) => `RIGHT(REGEXP_REPLACE(${col}, '[^0-9]', ''), 10)`;

try {
  const [[optin]] = (await conn.query(
    `SELECT COUNT(*) AS rows_total,
            COUNT(DISTINCT ${KEY("actor")}) AS distinct_phones,
            MIN(created_at) AS first_seen,
            MAX(created_at) AS last_seen
       FROM audit_log WHERE action = 'sms.opt_in'`,
  )) as any[];
  console.log("=== consent ledger (audit_log action='sms.opt_in') ===");
  console.log(
    `rows=${optin.rows_total}  distinct phones=${optin.distinct_phones}  window=${optin.first_seen} -> ${optin.last_seen}\n`,
  );

  const [[optout]] = (await conn.query(
    `SELECT COUNT(DISTINCT ${KEY("actor")}) AS distinct_phones
       FROM audit_log WHERE action = 'sms.opt_out'`,
  )) as any[];
  console.log(`opt-outs on record: ${optout.distinct_phones} phones\n`);

  // the universe the marketing lanes draw from
  const [[cust]] = (await conn.query(
    `SELECT COUNT(*) AS total,
            COUNT(DISTINCT ${KEY("phone")}) AS distinct_phones
       FROM customers WHERE phone IS NOT NULL AND phone <> ''`,
  )) as any[];
  console.log("=== marketing-eligible universe ===");
  console.log(`customers with a phone: ${cust.total} rows, ${cust.distinct_phones} distinct numbers`);

  // how many of those actually carry consent
  const [[covered]] = (await conn.query(
    `SELECT COUNT(*) AS covered FROM (
       SELECT DISTINCT ${KEY("c.phone")} AS k
         FROM customers c
         JOIN audit_log a
           ON a.action = 'sms.opt_in'
          AND ${KEY("a.actor")} = ${KEY("c.phone")}
        WHERE c.phone IS NOT NULL AND c.phone <> ''
     ) t`,
  )) as any[];

  const pct = cust.distinct_phones
    ? ((covered.covered / cust.distinct_phones) * 100).toFixed(1)
    : "n/a";
  console.log(`customers WITH a consent row: ${covered.covered}  (${pct}%)`);
  console.log(
    `customers WITHOUT one:        ${cust.distinct_phones - covered.covered}  <- these stop receiving marketing SMS the moment the gate is armed\n`,
  );

  // recent marketing volume, to size the blast radius
  try {
    const [[recent]] = (await conn.query(
      `SELECT COUNT(*) AS sends, COUNT(DISTINCT ${KEY("to_phone")}) AS phones
         FROM sms_messages
        WHERE direction = 'outbound'
          AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
    )) as any[];
    console.log("=== outbound SMS, last 30 days (all classes) ===");
    console.log(`sends=${recent.sends}  distinct recipients=${recent.phones}`);
  } catch (err) {
    // shape differs across schema versions — say so rather than render a zero
    console.log(`outbound volume: UNREADABLE (${(err as Error).message.slice(0, 90)})`);
  }
} finally {
  await conn.end();
}
