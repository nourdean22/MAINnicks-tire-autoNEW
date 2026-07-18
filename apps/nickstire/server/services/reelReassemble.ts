/**
 * Re-assemble a reel from its surviving source clips.
 *
 * WHY THIS IS WORTH HAVING
 * Three production reels sat unpublishable because their assembled master lived on
 * the container's ephemeral disk and a redeploy took it. Their SOURCE CLIPS
 * survived — Higgsfield hosts those itself — so the reel can be rebuilt by running
 * ffmpeg again over media we already paid for. Zero generation spend. Without this
 * the only route back was "regenerate from brief", which is a new paid job.
 *
 * WHAT IT IS NOT
 * It is not a repair. It does not fix a defect, and it does not preserve the old
 * asset's identity: ffmpeg produces a different file with a different hash. That
 * means the prior rendered-QA verdict no longer describes the media, and the prior
 * approval no longer describes what would publish. Both are invalidated here
 * deliberately — inheriting them would be exactly the stale-evidence failure the
 * publish gate exists to prevent.
 */
import { createLogger } from "../lib/logger";
import { probeUrl } from "./reelRecoverability";

const log = createLogger("services:reel-reassemble");

export type ReassembleResult =
  | { ok: true; jobId: number; mp4Url: string; durationSec: number; clipsUsed: number }
  | { ok: false; jobId: number; reason: string };

/**
 * Rebuild the master for `jobId` from its recorded clip URLs.
 *
 * Fails closed at every step: a job in the wrong state, a missing brief, any clip
 * that no longer resolves, or a lost claim all stop before ffmpeg runs.
 */
export async function reassembleFromClips(jobId: number): Promise<ReassembleResult> {
  const fail = (reason: string): ReassembleResult => ({ ok: false, jobId, reason });

  const { db } = await import("../lib/db-helper");
  const d = await db();
  if (!d) return fail("no database");

  const { reelJobs } = await import("../../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");
  const { affectedRowCount } = await import("../lib/db-affected");

  const [job] = await d.select().from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
  if (!job) return fail(`reel job ${jobId} not found`);

  // Only a job that has finished generating clips can be re-assembled. A job still
  // generating would race the pipeline for the same row.
  if (job.status !== "assembled") {
    return fail(`job is '${job.status}' — only an 'assembled' job can be re-assembled`);
  }

  let clipUrls: string[] = [];
  try {
    const parsed = JSON.parse(job.clipUrlsJson ?? "[]");
    if (Array.isArray(parsed)) clipUrls = parsed.filter((u): u is string => typeof u === "string");
  } catch {
    return fail("clipUrlsJson is unparseable — cannot know which clips to use");
  }
  if (!clipUrls.length) return fail("no source clips recorded on this job");

  let brief: Record<string, unknown>;
  try {
    brief = JSON.parse(job.payload ?? "{}");
  } catch {
    return fail("job payload is unparseable — no brief to assemble against");
  }
  const beats = (brief as { storyboardBeats?: unknown }).storyboardBeats;
  if (!Array.isArray(beats) || !beats.length) return fail("brief has no storyboard beats");
  if (beats.length !== clipUrls.length) {
    // assembleReel throws on this, but failing here gives the operator the numbers.
    return fail(`beat/clip mismatch: ${beats.length} beats vs ${clipUrls.length} clips`);
  }

  // Re-probe rather than trusting an earlier assessment: reachability is a live
  // property, and a provider URL can expire between listing the job and acting on
  // it. A partial set cannot rebuild the approved reel — a shorter video is a
  // different one.
  const probes = await Promise.all(clipUrls.map((u) => probeUrl(u)));
  const dead = probes.filter((p) => !p.reachable);
  if (dead.length) {
    return fail(`${dead.length} of ${clipUrls.length} source clips no longer resolve — re-assembly would not reproduce the approved reel`);
  }

  // Claim the row before spending minutes in ffmpeg, so a second operator click or
  // a concurrent runner cannot assemble the same job twice.
  const claim = await d
    .update(reelJobs)
    .set({ status: "assembling" })
    .where(and(eq(reelJobs.id, jobId), eq(reelJobs.status, "assembled")));
  if (affectedRowCount(claim) !== 1) {
    return fail("another process claimed this job first");
  }

  // Marks the boundary between "evaluated against the OLD file" and "evaluated
  // against this render" — the only way to tell a fresh audio verdict from a
  // carried-over one.
  const startedAt = Date.now();
  try {
    const { assembleReel } = await import("./reelAssembly");
    const { mp4Url, durationSec } = await assembleReel(brief as never, clipUrls, jobId);

    // RE-READ the payload. assembleReel persists a fresh audioQa verdict of its own
    // during the run, so writing back the copy loaded BEFORE assembly would clobber
    // it — a read-modify-write race against ourselves. (Observed live: all three
    // recovered jobs came back with no audio verdict, which under an armed audio
    // gate would hold them forever.)
    const [after] = await d.select().from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
    const fresh = JSON.parse(after?.payload ?? job.payload ?? "{}");

    // The media CHANGED, so any judgement about the OLD media is void.
    delete fresh.renderedQa;

    // Audio is kept ONLY if it was evaluated against THIS render. Re-reading alone
    // is not enough: when assembleReel does not reach its audio stage, the re-read
    // still carries the PREVIOUS verdict, and keeping that would smuggle a stale
    // approval onto a new file — the very thing dropping renderedQa prevents.
    const audio = fresh.audioQa as { evaluatedAt?: string } | undefined;
    const evaluatedAt = audio?.evaluatedAt ? Date.parse(audio.evaluatedAt) : NaN;
    if (!Number.isFinite(evaluatedAt) || evaluatedAt < startedAt) {
      delete fresh.audioQa;
    }
    fresh.reassembledAt = new Date().toISOString();

    await d
      .update(reelJobs)
      .set({ status: "assembled", mp4Url, error: null, payload: JSON.stringify(fresh) })
      .where(eq(reelJobs.id, jobId));

    log.warn("reel re-assembled from surviving clips — QA and approval invalidated", {
      jobId, mp4Url, clips: clipUrls.length, durationSec,
    });
    return { ok: true, jobId, mp4Url, durationSec, clipsUsed: clipUrls.length };
  } catch (err) {
    // Release the claim so the job is actionable again rather than wedged in
    // "assembling". Nothing external happened here — ffmpeg is local and
    // idempotent — so unlike a publish, returning to the prior state is safe.
    await d
      .update(reelJobs)
      .set({ status: "assembled", error: `re-assembly failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 400)}` })
      .where(and(eq(reelJobs.id, jobId), eq(reelJobs.status, "assembling")));
    log.error("re-assembly failed — job returned to 'assembled'", { jobId, err });
    return fail(err instanceof Error ? err.message : String(err));
  }
}
