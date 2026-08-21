/**
 * Return the three locally-timed-out reel jobs to the queue so the pipeline
 * finishes the beats it never got to — WITHOUT re-paying for the ones it
 * already rendered.
 *
 * WHY THIS IS CHEAP. Beat clips are persisted progressively into
 * reel_jobs.clipUrlsJson as each one lands, and the gen loop skips any beat
 * whose slot already holds an http URL (reelPipeline.ts: "resuming: clip
 * already exists for beat"). So re-queuing a partially-generated job
 * regenerates ONLY the missing beats. Measured on these three: 11 of 16 beats
 * are already stored, so this costs 5 beats, not 16.
 *
 * WHY IT IS SAFE TO RE-QUEUE AT ALL. provider-history.ts confirmed against
 * Higgsfield that every job submitted in the timed-out window reports
 * status=completed with a result_url — the remote renders finished and the
 * local 360s poll was the only thing that failed. Nothing is still running
 * remotely that a re-queue could collide with.
 *
 * GUARDED: the UPDATE matches id IN (...) AND status='needs_regen', so a row
 * that has moved on since this was written is left alone and reported rather
 * than clobbered. DRY RUN by default; --apply to write.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

import { getDb } from "../../server/db";
import { reelJobs } from "../../drizzle/schema";
import { inArray, and, eq } from "drizzle-orm";
import { loadLedger, saveLedger } from "./ledger";

const APPLY = process.argv.includes("--apply");

/** reel_jobs ids of the regeneration jobs that timed out locally 2026-08-20. */
const JOB_IDS = [1740002, 1740003, 1740004];
/** The ledger entries those jobs belong to, so their regen state is reopened too. */
const LEDGER_IDS = ["1470001", "1440001", "1500001"];

function clipCount(json: string | null): { stored: number; total: string } {
  try {
    const a = JSON.parse(json ?? "[]");
    if (!Array.isArray(a)) return { stored: 0, total: "?" };
    return { stored: a.filter((u) => typeof u === "string" && u.startsWith("http")).length, total: String(a.length) };
  } catch {
    return { stored: 0, total: "?" };
  }
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB not available — check DATABASE_URL");

  const before = await db.select().from(reelJobs).where(inArray(reelJobs.id, JOB_IDS));
  console.log("\n--- BEFORE (this printout is the rollback record) ---");
  for (const r of before) {
    const c = clipCount(r.clipUrlsJson);
    console.log(`  job ${r.id}: status=${r.status} attempts=${r.attempts} clips=${c.stored}/${c.total} error=${(r.error ?? "").slice(0, 90)}`);
  }
  const eligible = before.filter((r) => r.status === "needs_regen");
  console.log(`\n${eligible.length} of ${before.length} row(s) are in the expected 'needs_regen' state and would be re-queued.`);
  if (eligible.length !== before.length) {
    console.log("  (rows in any other state are deliberately left alone by the guard)");
  }

  if (!APPLY) {
    console.log("\nDRY RUN — would set status='queued', attempts=0, error=NULL on the eligible rows,");
    console.log("and reopen ledger regen state for", LEDGER_IDS.join(", "));
    console.log("  re-run with --apply to write.\n");
    process.exit(0);
  }

  const res = await db
    .update(reelJobs)
    .set({ status: "queued", attempts: 0, error: null })
    .where(and(inArray(reelJobs.id, JOB_IDS), eq(reelJobs.status, "needs_regen")));
  const { affectedRowCount } = await import("../../server/lib/db-affected");
  console.log(`\nUPDATE affectedRows = ${affectedRowCount(res)}`);

  const after = await db.select().from(reelJobs).where(inArray(reelJobs.id, JOB_IDS));
  console.log("--- AFTER ---");
  for (const r of after) {
    const c = clipCount(r.clipUrlsJson);
    console.log(`  job ${r.id}: status=${r.status} attempts=${r.attempts} clips=${c.stored}/${c.total}`);
  }

  // Reopen the ledger so regen.ts stops treating these as terminal. job_id is
  // left in place deliberately — that is what makes regenerateOne RESUME the
  // existing partially-rendered job instead of enqueueing a fresh paid one.
  const ledger = loadLedger();
  let reopened = 0;
  for (const id of LEDGER_IDS) {
    const e = ledger.entries[id];
    if (!e) { console.log(`  ledger entry ${id} missing — skipped`); continue; }
    e.regen.status = "in_progress";
    e.regen.qc = null;
    reopened += 1;
  }
  saveLedger(ledger);
  console.log(`\nledger: reopened ${reopened} entr(ies) to in_progress (job_id kept, so they RESUME rather than re-enqueue).`);
  console.log("Next: pnpm exec tsx scripts/reel-remediation/regen.ts\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("resume-timed-out failed:", err);
  process.exit(1);
});
