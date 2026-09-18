#!/usr/bin/env node
/**
 * probe-embedding-shadow.mjs · READ-ONLY · 2026-09-18
 *
 * What is currently held out of recall, and what did that actually change?
 *
 * The number worth watching is NOT the total. `lib/db/pgvector.ts` already
 * filtered brain_memory in real time (`"sourceType" <> 'brain_memory' OR
 * EXISTS(...)`), so brain_memory's dead rows never surfaced — marking them only
 * stops them being SCANNED. The rows whose visibility actually changes are the
 * NON-brain_memory ones: those had no liveness filter at all, so they surfaced
 * in semantic search, consumed a LIMIT slot, and were dropped by the caller
 * when the source join came back empty.
 *
 * Usage:
 *   railway run -s statenour-web -- node scripts/probe-embedding-shadow.mjs
 */
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const L = (s = "") => console.log(s);

await client.connect();
try {
  const rows = (
    await client.query(
      `SELECT "sourceType" st,
              COALESCE("sourceUnavailableReason",'(none)') reason,
              COUNT(*)::int n
         FROM vector_embeddings
        WHERE "sourceUnavailableAt" IS NOT NULL
        GROUP BY 1,2 ORDER BY 3 DESC`,
    )
  ).rows;

  L("held out of recall (marked, NOT deleted):");
  L("sourceType             reason          rows");
  L("-".repeat(48));
  let total = 0;
  let leakClosed = 0;
  for (const r of rows) {
    total += r.n;
    if (r.st !== "brain_memory") leakClosed += r.n;
    L(`${r.st.padEnd(22)} ${r.reason.padEnd(15)} ${r.n}`);
  }
  L("-".repeat(48));

  const tot = (await client.query(`SELECT COUNT(*)::int n FROM vector_embeddings`)).rows[0].n;
  const pct = tot > 0 ? ((total / tot) * 100).toFixed(1) : "0";
  L(`marked      ${total} of ${tot} rows (${pct}%)`);
  L(`scan saved  ${total} rows no longer read by every recall query`);
  L(`LEAK CLOSED ${leakClosed} non-brain_memory rows that previously SURFACED in`);
  L(`            semantic search pointing at a source that is gone. brain_memory`);
  L(`            was already filtered in real time, so its share is scan cost only.`);
  L();
  L("restore route (reversible, nothing was deleted):");
  L(`  UPDATE vector_embeddings`);
  L(`     SET "sourceUnavailableAt" = NULL, "sourceUnavailableReason" = NULL;`);
} catch (e) {
  console.error("PROBE FAILED:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await client.end();
}
