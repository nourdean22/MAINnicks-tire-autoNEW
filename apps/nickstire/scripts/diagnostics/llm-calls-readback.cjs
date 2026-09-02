// READ-ONLY diagnostic: llm_calls ledger read-back (2026-09-02, admin audit F-21 follow-up).
// Run from apps/nickstire with DATABASE_URL in the environment:  pnpm diag:llm-calls
// Every statement is a SELECT and is checked against an allowlist before it runs.
// Ages are computed IN SQL: mysql2 parses TiDB DATETIMEs in local time, so a driver
// Date printed as UTC reads +4h on Eastern (see memory nickstire-mysql2-datetime-local-parse-skew).
require("dotenv/config");
const mysql = require("mysql2/promise");

const READ_ONLY = /^\s*SELECT\b/i;
const QUERIES = [
  ["totals", "SELECT COUNT(*) AS n, SUM(ok = 1) AS okRows, SUM(ok = 0) AS failRows, TIMESTAMPDIFF(MINUTE, MAX(calledAt), UTC_TIMESTAMP()) AS minutesSinceLast FROM llm_calls"],
  ["by lane / provider (all time)", "SELECT lane, provider, COUNT(*) AS n, SUM(ok = 0) AS fails, ROUND(AVG(latencyMs)) AS avgMs, SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)) AS tokens FROM llm_calls GROUP BY lane, provider ORDER BY n DESC LIMIT 25"],
  ["last 10", "SELECT TIMESTAMPDIFF(MINUTE, calledAt, UTC_TIMESTAMP()) AS minAgo, model, lane, latencyMs, ok, LEFT(error, 60) AS error FROM llm_calls ORDER BY calledAt DESC LIMIT 10"],
  ["errors (top)", "SELECT LEFT(error, 80) AS error, COUNT(*) AS n FROM llm_calls WHERE ok = 0 GROUP BY LEFT(error, 80) ORDER BY n DESC LIMIT 5"],
];

(async () => {
  const url = process.env.DATABASE_URL || "";
  if (!url.startsWith("mysql://")) { console.error("ABORT: no mysql DATABASE_URL in the environment"); process.exit(2); }
  console.log("host fingerprint:", new URL(url).hostname.replace(/^([^.]{3})[^.]*/, "$1***"), "· now (UTC):", new Date().toISOString());
  let conn;
  try { conn = await mysql.createConnection(url); }
  catch { conn = await mysql.createConnection(url + (url.includes("?") ? "&" : "?") + 'ssl={"rejectUnauthorized":true}'); }
  try {
    for (const [label, sql] of QUERIES) {
      if (!READ_ONLY.test(sql)) { console.error("ABORT: non-read statement", label); process.exit(2); }
      const [rows] = await conn.query(sql);
      console.log(`\n== ${label}`);
      for (const r of rows) console.log("  ", JSON.stringify(r));
    }
  } finally { await conn.end(); }
})().catch((e) => { console.error("ERR", e.code || "", e.message); process.exit(1); });
