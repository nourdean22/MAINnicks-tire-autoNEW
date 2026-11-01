/**
 * transfer-callback-cost-readonly.mts — READ-ONLY. What does a transfer cost, and
 * what do voice callbacks look like today? Baseline for the transfer-callback
 * kill criterion (2026-10-31).
 *
 * Prints COUNTS and sums only: no phone number, no transcript, no name.
 *
 * SAFETY — SELECT statements only. No DELETE / UPDATE / INSERT / DDL anywhere in
 * this file, so there is no write path to guard. Prints the resolved host before
 * querying (prod-db-guard step 3).
 *
 * Run: railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/transfer-callback-cost-readonly.mts
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
console.log("mode    : READ-ONLY (SELECT only)\n");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const DAYS = 30;

try {
  const [[all]] = (await conn.query(
    `SELECT COUNT(*) AS calls, COUNT(cost_total) AS with_cost,
            SUM(cost_total) AS cost, SUM(CASE WHEN cost_total IS NOT NULL THEN duration_seconds END) AS secs_with_cost
       FROM vapi_call_archives WHERE started_at >= NOW() - INTERVAL ? DAY`,
    [DAYS],
  )) as any[];
  const perSec = all.secs_with_cost ? Number(all.cost) / Number(all.secs_with_cost) : null;
  console.log(`=== vapi_call_archives, last ${DAYS} d ===`);
  console.log(`calls=${all.calls} with_cost=${all.with_cost} cost_sum=${all.cost} seconds_with_cost=${all.secs_with_cost} cost_per_second=${perSec}`);

  const [[fwd]] = (await conn.query(
    `SELECT COUNT(*) AS calls, AVG(duration_seconds) AS avg_secs, SUM(cost_total) AS cost
       FROM vapi_call_archives WHERE started_at >= NOW() - INTERVAL ? DAY AND ended_reason = 'assistant-forwarded-call'`,
    [DAYS],
  )) as any[];
  console.log(`forwarded calls=${fwd.calls} avg_seconds=${fwd.avg_secs} cost_sum=${fwd.cost}\n`);

  const [[cb]] = (await conn.query(
    `SELECT COUNT(*) AS rows_total, SUM(context LIKE '%callId=%') AS with_call_id
       FROM callback_requests WHERE utmSource = 'voice-agent' AND createdAt >= NOW() - INTERVAL ? DAY`,
    [DAYS],
  )) as any[];
  const [[dup]] = (await conn.query(
    `SELECT COUNT(*) AS calls_with_two_or_more FROM (
       SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(context, 'callId=', -1), ' ', 1) AS cid, COUNT(*) AS n
         FROM callback_requests
        WHERE utmSource = 'voice-agent' AND context LIKE '%callId=%' AND createdAt >= NOW() - INTERVAL ? DAY
        GROUP BY cid HAVING n > 1) d`,
    [DAYS],
  )) as any[];
  console.log(`=== voice callback_requests, last ${DAYS} d ===`);
  console.log(`rows=${cb.rows_total} with_callId=${cb.with_call_id} calls_with_two_or_more_rows=${dup.calls_with_two_or_more}`);
} finally {
  await conn.end();
}
