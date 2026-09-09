/**
 * resume-timed-out-reels.ts · put a LOCAL_TIMEOUT_REMOTE_UNKNOWN job back in the
 * queue so the generator RESUMES it, instead of regenerating it from scratch.
 *
 * WHY THIS EXISTS RATHER THAN contentAdmin.regenerateReelFromBrief:
 * that procedure builds a BRAND NEW job from the surviving brief, which
 * discards every clip the dead job already generated. On 2026-09-09 the three
 * timed-out slots (1920005, 1920007, 1920008) still held 8 paid clips between
 * them; regenerating would have paid for 15 clips to replace 7 missing ones.
 * The generator already resumes per beat — reelPipeline.ts:905-906 skips any
 * beat whose clipUrlsJson entry is already an http url — so all a resume needs
 * is the row back in `queued`, which is the status the gen stage claims
 * (reelPipeline.ts:~818).
 *
 * SAFE TO RESUME, specifically: the timeout error warns the remote job "may
 * still be running and billing". That is a live-window concern. These rows are
 * terminal and hours old, so nothing is in flight; the resume adds beats, it
 * does not re-submit an outstanding operation.
 *
 * SAFETY
 *  · DRY RUN by default; --apply to write.
 *  · PRE-FLIGHT, all must pass or the row is refused:
 *      - status is exactly `needs_regen` (terminal, no worker holds it)
 *      - never published (no igPostId)
 *      - has a brief with beats, and a prompt pack to generate from
 *      - saved clips are a strict PREFIX of the beats: every saved entry is an
 *        http url and there is at least one beat left to generate. A gap or a
 *        full set means this is not the resume case and needs a human.
 *  · UPDATE is guarded on id AND status, so a row that changed under us is not
 *    written (affectedRows is checked).
 *  · Reads every row back and prints the result.
 */
import { getDb } from "../server/db";
import { reelJobs } from "../drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";
import { queueStateForReelStatus } from "@shared/reelQueue";

const APPLY = process.argv.includes("--apply");
const IDS = process.argv
  .slice(2)
  .filter((a) => /^\d+$/.test(a))
  .map(Number);

async function main() {
  if (!IDS.length) {
    console.error("usage: tsx scripts/resume-timed-out-reels.ts <jobId...> [--apply]");
    process.exit(1);
  }
  const d = await getDb();
  if (!d) throw new Error("DB not available");

  const rows = await d.select().from(reelJobs).where(inArray(reelJobs.id, IDS));
  const ok: number[] = [];

  for (const job of rows) {
    const reasons: string[] = [];
    if (job.status !== "needs_regen") reasons.push(`status is ${job.status}, want needs_regen`);
    if (job.igPostId) reasons.push(`already published as ${job.igPostId}`);

    let beats = 0;
    let pack = 0;
    try {
      const p = JSON.parse(job.payload ?? "{}");
      beats = (p.storyboardBeats ?? []).length;
      pack = (p.promptPack ?? p.higgsfieldPromptPack ?? []).length;
    } catch {
      reasons.push("payload unparseable");
    }
    if (!beats) reasons.push("no storyboard beats");
    if (!pack) reasons.push("no prompt pack to generate from");

    let clips: unknown[] = [];
    try {
      clips = JSON.parse(job.clipUrlsJson ?? "[]");
    } catch {
      reasons.push("clipUrlsJson unparseable");
    }
    const saved = clips.filter((u) => typeof u === "string" && (u as string).startsWith("http")).length;
    if (saved !== clips.length) reasons.push(`clip list has a gap (${saved} http of ${clips.length})`);
    if (beats && clips.length >= beats) reasons.push(`already has ${clips.length} clips for ${beats} beats — nothing to resume`);

    if (reasons.length) {
      console.log(`REFUSE #${job.id}: ${reasons.join(" | ")}`);
      continue;
    }
    console.log(`READY  #${job.id} ${job.briefId} — ${saved}/${beats} clips kept, ${beats - saved} to generate`);
    ok.push(job.id);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — would requeue ${ok.length} job(s): ${JSON.stringify(ok)}. Re-run with --apply to write.`);
    process.exit(0);
  }

  for (const id of ok) {
    const res: any = await d
      .update(reelJobs)
      .set({
        status: "queued",
        queueState: queueStateForReelStatus("queued"),
        attempts: 0,
        error: null,
      })
      .where(and(eq(reelJobs.id, id), eq(reelJobs.status, "needs_regen")));
    const affected = res?.[0]?.affectedRows ?? res?.affectedRows ?? 0;
    console.log(`WRITE  #${id}: affectedRows=${affected}${affected === 1 ? "" : "  <-- NOT WRITTEN (row changed underneath)"}`);
  }

  const after = await d.select().from(reelJobs).where(inArray(reelJobs.id, ok));
  console.log("\nREAD BACK:");
  for (const j of after) console.log(`  #${j.id} status=${j.status} attempts=${j.attempts} error=${j.error ?? "null"}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e?.stack ?? e);
  process.exit(1);
});
