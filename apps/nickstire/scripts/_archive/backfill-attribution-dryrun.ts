/**
 * Attribution backfill DRY-RUN (autonomous attribution completion wave 2026-06).
 *
 * READ-ONLY BY CONSTRUCTION: this script contains ZERO write statements —
 * there is no apply mode here at all. Running a real backfill is a separate,
 * separately-approved piece of work (see the rollback/risk notes in
 * docs/audits/NICKSTIRE-AUTONOMOUS-ATTRIBUTION-COMPLETION.md).
 *
 * What it reports (counts only, no PII):
 *  - per table: total rows, rows with utmSource, rows with sessionId,
 *    rows that are blank-on-both (the honest blind spot)
 *  - what a Sheets-tail backfill COULD cover (DB rows with utm captured
 *    before the Sheets attribution tail shipped 2026-06-09) and why row
 *    matching to existing Sheet rows is approximate (timestamp+name only).
 *
 * Run: railway run -s MAINnicks-tire-auto -- pnpm tsx scripts/backfill-attribution-dryrun.ts
 */
import mysql from "mysql2/promise";

const TABLES = [
  { table: "leads", utmCol: "utmSource", sessionCol: "sessionId" },
  { table: "bookings", utmCol: "utmSource", sessionCol: "sessionId" },
  { table: "callback_requests", utmCol: "utmSource", sessionCol: "sessionId" },
  { table: "tire_orders", utmCol: "utmSource", sessionCol: "sessionId" },
  { table: "call_events", utmCol: "utmSource", sessionCol: "sessionId" },
] as const;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set — run via railway run");
  console.log("[backfill-dryrun] READ-ONLY report — this script cannot write.");

  const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
  try {
    for (const t of TABLES) {
      const [rows] = await conn.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN ${t.utmCol} IS NOT NULL AND ${t.utmCol} <> '' THEN 1 ELSE 0 END) AS withUtm,
                SUM(CASE WHEN ${t.sessionCol} IS NOT NULL THEN 1 ELSE 0 END) AS withSession
         FROM ${t.table}`,
      );
      const r = (rows as any[])[0];
      console.log(
        `  ${t.table}: total=${r.total} withUtm=${r.withUtm} withSession=${r.withSession} ` +
        `blankBoth=${r.total - Math.max(Number(r.withUtm), Number(r.withSession))}`,
      );
    }
    console.log(
      "[backfill-dryrun] NOTE: sessionId starts populating at the 0068 deploy — " +
      "historical rows are an honest blind spot, not an error. A Sheets-tail " +
      "backfill would require timestamp+name matching against Sheet rows " +
      "(approximate) and Sheet row MUTATION (not append) — both need separate " +
      "explicit approval. No backfill was performed.",
    );
  } finally {
    await conn.end();
  }
}

main().catch(e => { console.error("[backfill-dryrun] FAILED:", e?.message || e); process.exit(1); });
