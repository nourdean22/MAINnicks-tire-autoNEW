/**
 * Faceless Reel pipeline — durable BACKGROUND generation.
 *
 * The reel gen pipeline is minutes-long (a Higgsfield clip per storyboard
 * beat), which dies on Railway's synchronous request timeout (we hit 502/500
 * proving this). So work runs as a background job: enqueueReelJob() inserts a
 * queued reel_jobs row and returns instantly; the tiered cron's pulse tier
 * calls processNextReelJob() (gated OFF by default via REEL_GENERATION_ENABLED)
 * to claim and run ONE job per tick.
 *
 * Increment 1 (this file): gen clips per beat -> re-host to public storage ->
 * status `assets_ready`. Voiceover (ElevenLabs), ffmpeg assembly, and the
 * gated publish (publishToSocial / REEL_PUBLISH_ENABLED) are later stages.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:reel-pipeline");

const MAX_ATTEMPTS = 3;

/** Minimal structural view of a client ReelBrief — only the fields gen needs. */
export interface ReelJobBrief {
  id?: string;
  selectedCaption?: string;
  hashtags?: string[];
  storyboardBeats?: Array<{ beatNumber: number; visual: string; onScreenText?: string }>;
  higgsfieldPromptPack?: Array<{ beatNumber: number; prompt: string }>;
  voiceoverScript?: string;
}

/**
 * Enqueue a reel for background generation. Returns immediately with a jobId;
 * the pulse cron processes it. Does NOT generate or publish here.
 */
export async function enqueueReelJob(
  brief: ReelJobBrief,
  source: "admin" | "cron" = "admin",
): Promise<{ jobId: number }> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) throw new Error("DB not available");
  const { reelJobs } = await import("../../drizzle/schema");
  const caption = brief.selectedCaption
    ? `${brief.selectedCaption}\n\n${(brief.hashtags ?? []).join(" ")}`.trim().slice(0, 2200)
    : null;
  const res = await d.insert(reelJobs).values({
    briefId: String(brief.id ?? "unknown"),
    payload: JSON.stringify(brief),
    status: "queued",
    caption,
    source,
  });
  const jobId = Number(
    (res as unknown as { insertId?: number })?.insertId ??
      (res as unknown as Array<{ insertId?: number }>)?.[0]?.insertId ??
      0,
  );
  log.info("reel job enqueued", { jobId, briefId: brief.id, beats: brief.storyboardBeats?.length ?? 0 });
  return { jobId };
}

/**
 * Claim and process the oldest queued reel job (gen clips -> re-host ->
 * assets_ready). Returns {processed:false} when disabled or idle.
 *
 * SAFETY: hard no-op unless REEL_GENERATION_ENABLED === "true" — enqueued jobs
 * never spend Higgsfield credits until the operator explicitly arms generation.
 */
export async function processNextReelJob(): Promise<{
  processed: boolean;
  jobId?: number;
  status?: string;
  error?: string;
}> {
  if (process.env.REEL_GENERATION_ENABLED !== "true") return { processed: false };

  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return { processed: false };

  const { reelJobs } = await import("../../drizzle/schema");
  const { eq, and, asc } = await import("drizzle-orm");

  const rows = await d
    .select()
    .from(reelJobs)
    .where(eq(reelJobs.status, "queued"))
    .orderBy(asc(reelJobs.createdAt))
    .limit(1);
  if (!rows.length) return { processed: false };
  const job = rows[0];
  const attempt = (job.attempts ?? 0) + 1;

  // Atomic claim: only the worker that flips queued->generating proceeds, so a
  // future second worker can't double-process the same row.
  const claim = await d
    .update(reelJobs)
    .set({ status: "generating", attempts: attempt })
    .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "queued")));
  const claimed =
    (claim as unknown as { affectedRows?: number; rowsAffected?: number })?.affectedRows ??
    (claim as unknown as { affectedRows?: number; rowsAffected?: number })?.rowsAffected ??
    0;
  if (claimed !== 1) return { processed: false }; // another worker claimed it

  try {
    const brief = JSON.parse(job.payload) as ReelJobBrief;
    const beats = brief.storyboardBeats ?? [];
    if (!beats.length) throw new Error("brief has no storyboardBeats");

    const { generateReelClipVideo } = await import("./higgsfieldStudio");
    const { storagePut } = await import("../storage");

    const clipUrls: string[] = [];
    for (const beat of beats) {
      const prompt =
        brief.higgsfieldPromptPack?.find((p) => p.beatNumber === beat.beatNumber)?.prompt ?? beat.visual;
      if (!prompt || !prompt.trim()) throw new Error(`beat ${beat.beatNumber} has no prompt`);
      const hgUrl = await generateReelClipVideo(prompt);
      // Re-host the Higgsfield clip to our own public storage — HF URLs are
      // temporary, and storagePut falls back to the public /generated route
      // when S3 isn't configured, so the clip is always fetchable from us.
      const resp = await fetch(hgUrl);
      if (!resp.ok) throw new Error(`failed to fetch clip for beat ${beat.beatNumber}: HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      const put = await storagePut(`reels/${job.id}/clip-${beat.beatNumber}.mp4`, buf, "video/mp4");
      clipUrls.push(put.url);
      log.info("reel clip generated", { jobId: job.id, beat: beat.beatNumber });
    }

    await d
      .update(reelJobs)
      .set({ status: "assets_ready", clipUrlsJson: JSON.stringify(clipUrls), error: null })
      .where(eq(reelJobs.id, job.id));
    log.info("reel job assets_ready", { jobId: job.id, clips: clipUrls.length });
    return { processed: true, jobId: job.id, status: "assets_ready" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Retry on the next pulse until MAX_ATTEMPTS, then park as failed.
    const nextStatus = attempt >= MAX_ATTEMPTS ? "failed" : "queued";
    await d.update(reelJobs).set({ status: nextStatus, error: msg.slice(0, 1000) }).where(eq(reelJobs.id, job.id));
    log.warn("reel job step failed", { jobId: job.id, attempt, nextStatus, error: msg });
    return { processed: true, jobId: job.id, status: nextStatus, error: msg };
  }
}
