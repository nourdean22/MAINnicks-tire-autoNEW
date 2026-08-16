/**
 * READ-ONLY · does a labeled corpus exist yet?
 *
 * The Ax/DSPy row in docs/UPSTREAMS.md has been WATCH for months on one
 * blocker: "zero labeled corpus". `admin_proposals` (migration 0111, #1541)
 * changed that in principle — every AI-originated write lands there as a DRAFT
 * and an operator approves or rejects it, which is a human label on a preserved
 * input, generated as a byproduct of work already being done.
 *
 * Whether it changed it in PRACTICE is a row count, and nobody has run it.
 * This answers exactly that and nothing else.
 *
 * Structurally read-only: every statement passes through q(), which refuses
 * anything that is not SELECT/SHOW/DESCRIBE before it reaches the driver.
 * There is no INSERT/UPDATE/DELETE/DDL path in this file.
 *
 * Usage: node scripts/probe-proposal-corpus.mjs <path-to-env-file>
 */
import mysql from "mysql2/promise";
import fs from "fs";

const envText = fs.readFileSync(process.argv[2], "utf8");
const url = (envText.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
if (!url) throw new Error("no DATABASE_URL in env file");

const base = url.replace(/\?ssl=.*$/, "");
console.log("host:", new URL(base).hostname);

const conn = await mysql.createConnection(`${base}?ssl={"rejectUnauthorized":true}`);

async function q(sql, params = []) {
  if (!/^\s*(select|show|describe)\b/i.test(sql)) {
    throw new Error("REFUSED non-read statement: " + sql.slice(0, 40));
  }
  const [rows] = await conn.execute(sql, params);
  return rows;
}

const out = {};

out.byStatus = await q(`
  SELECT status,
         COUNT(*)        AS n,
         MIN(created_at) AS first_seen,
         MAX(created_at) AS last_seen
  FROM admin_proposals
  GROUP BY status
  ORDER BY n DESC
`);

// A label is only useful if the INPUT that produced it is still there.
out.withPayload = await q(`
  SELECT COUNT(*) AS n
  FROM admin_proposals
  WHERE payload_json IS NOT NULL AND CHAR_LENGTH(payload_json) > 2
`);

out.byKind = await q(`
  SELECT action_type, status, COUNT(*) AS n
  FROM admin_proposals
  GROUP BY action_type, status
  ORDER BY n DESC
  LIMIT 20
`);

console.log(JSON.stringify(out, null, 1));

const decided = out.byStatus
  .filter((r) => /approve|reject/i.test(String(r.status)))
  .reduce((s, r) => s + Number(r.n), 0);

console.log(`\nHUMAN-ADJUDICATED ROWS: ${decided}`);
console.log(
  decided >= 200
    ? "→ enough to flip the Ax/DSPy WATCH row for ONE task. Pick the task, hold out a test set, measure against the incumbent prompt."
    : "→ NOT enough. Keep collecting; optimizing against this now would fit noise. Re-run this probe before proposing any training work.",
);

await conn.end();
