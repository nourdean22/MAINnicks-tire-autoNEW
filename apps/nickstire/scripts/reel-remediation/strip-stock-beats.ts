/**
 * Clear the STOCK clip slots on a reel job and re-queue it, so the pipeline
 * regenerates only those beats with the real provider.
 *
 * Why this exists: on 2026-08-21, while the remediation was resuming job
 * 1740002 locally, PRODUCTION's pulse cron claimed the same queued row (it
 * claims unscoped) and finished the missing beats using the code still on
 * `main` at the time — which still had the silent stock fallback. Two beats
 * came back as template-stock, and this remediation's own QC caught it.
 *
 * That specific race is closed now (the fallback is merged and deployed, so
 * prod cannot substitute stock at all), but the repair is still needed for the
 * reel it already poisoned.
 *
 * The pipeline's resume rule is `clipUrls[i].startsWith("http")` -> skip. So
 * blanking exactly the stock slots regenerates exactly those beats and leaves
 * the good ones untouched — 2 beats of spend instead of 5.
 *
 * GUARDED: only clears slots whose URL actually contains "template-stock", only
 * re-queues a job that is currently `assembled` or `needs_regen`, and prints a
 * before/after. DRY RUN by default; --apply to write.
 */
import "./env-pin";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

import { getDb } from "../../server/db";
import { reelJobs } from "../../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { loadLedger, saveLedger } from "./ledger";

const APPLY = process.argv.includes("--apply");

const jobArg = process.argv.find((a) => a.startsWith("--job="))?.split("=")[1];
const ledgerArg = process.argv.find((a) => a.startsWith("--ledger="))?.split("=")[1];
if (!jobArg || !ledgerArg) {
  console.error("usage: strip-stock-beats.ts --job=<reelJobId> --ledger=<ledgerEntryId> [--apply]");
  process.exit(1);
}
const JOB_ID = Number(jobArg);
/** Statuses it is safe to re-queue from — never one that may be mid-flight. */
const REQUEUEABLE = ["assembled", "needs_regen", "failed"];

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB not available — check DATABASE_URL");

  const [row] = await db.select().from(reelJobs).where(eq(reelJobs.id, JOB_ID)).limit(1);
  if (!row) { console.error(`job ${JOB_ID} not found`); process.exit(1); }

  let clips: unknown[];
  try { clips = JSON.parse(row.clipUrlsJson ?? "[]"); } catch { console.error("clipUrlsJson is unparseable — refusing"); process.exit(1); }
  if (!Array.isArray(clips)) { console.error("clipUrlsJson is not an array — refusing"); process.exit(1); }

  console.log(`\n--- BEFORE (rollback record) ---`);
  console.log(`job ${row.id} status=${row.status} attempts=${row.attempts}`);
  const stockIdx: number[] = [];
  clips.forEach((u, i) => {
    const isStock = typeof u === "string" && u.includes("template-stock");
    if (isStock) stockIdx.push(i);
    console.log(`  idx${i}: ${isStock ? "*** STOCK — will be cleared ***" : "keep"}  ${String(u).slice(0, 96)}`);
  });

  if (stockIdx.length === 0) {
    console.log("\nNo template-stock clips on this job — nothing to do.\n");
    process.exit(0);
  }
  if (!REQUEUEABLE.includes(row.status)) {
    console.error(`\njob status is "${row.status}" — refusing to re-queue something that may be mid-flight (safe: ${REQUEUEABLE.join(", ")}).\n`);
    process.exit(1);
  }

  // null, not delete: the slot must EXIST and be falsy so the resume check
  // (`clipUrls[i] && startsWith("http")`) regenerates that beat while leaving
  // the surrounding indices aligned to their beat numbers.
  const cleared = clips.map((u, i) => (stockIdx.includes(i) ? null : u));

  console.log(`\n${stockIdx.length} stock slot(s) would be cleared: beats ${stockIdx.map((i) => i + 1).join(", ")}`);
  console.log(`${clips.length - stockIdx.length} real clip(s) preserved — those beats will resume-skip, not re-spend.`);

  if (!APPLY) {
    console.log(`\nDRY RUN — would set clipUrlsJson (stock slots nulled), status='queued', attempts=0, error=NULL,`);
    console.log(`and reopen ledger entry ${ledgerArg}. Re-run with --apply to write.\n`);
    process.exit(0);
  }

  const res = await db
    .update(reelJobs)
    .set({ clipUrlsJson: JSON.stringify(cleared), status: "queued", attempts: 0, error: null, mp4Url: null })
    .where(and(eq(reelJobs.id, JOB_ID), inArray(reelJobs.status, REQUEUEABLE)));
  const { affectedRowCount } = await import("../../server/lib/db-affected");
  console.log(`\nUPDATE affectedRows = ${affectedRowCount(res)}`);

  const [after] = await db.select().from(reelJobs).where(eq(reelJobs.id, JOB_ID)).limit(1);
  const afterClips = JSON.parse(after?.clipUrlsJson ?? "[]") as unknown[];
  console.log(`--- AFTER ---`);
  console.log(`job ${after?.id} status=${after?.status} attempts=${after?.attempts}`);
  afterClips.forEach((u, i) => console.log(`  idx${i}: ${u === null ? "(cleared — will regenerate)" : "kept"}`));

  const ledger = loadLedger();
  const entry = ledger.entries[ledgerArg];
  if (entry) {
    entry.regen.status = "in_progress";
    entry.regen.qc = null;
    entry.regen.new_render_path = null;
    saveLedger(ledger);
    console.log(`\nledger: entry ${ledgerArg} reopened to in_progress (job_id kept, so it RESUMES).`);
  } else {
    console.log(`\nledger entry ${ledgerArg} not found — job re-queued anyway.`);
  }
  console.log(`Next: pnpm exec tsx scripts/reel-remediation/regen.ts\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("strip-stock-beats failed:", err);
  process.exit(1);
});
