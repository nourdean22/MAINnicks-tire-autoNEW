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
import type { ReelAssemblyBrief } from "./reelAssembly";

const log = createLogger("services:reel-pipeline");

const MAX_ATTEMPTS = 3;

/** Per-clip Higgsfield gen timeout. seedance renders take minutes, so this is
 *  generous — its only job is to cap a HUNG CLI poll (the failure mode that
 *  otherwise parks a job in `generating` forever) so it rejects into the normal
 *  retry path instead of wedging the pipeline. Env-overridable. */
const GEN_CLIP_TIMEOUT_MS = Number(process.env.REEL_GEN_CLIP_TIMEOUT_MS) || 6 * 60_000;
/** Re-host fetch of an already-finished Higgsfield clip — short; it exists. */
const CLIP_FETCH_TIMEOUT_MS = Number(process.env.REEL_CLIP_FETCH_TIMEOUT_MS) || 90_000;
/** How long a job may sit in a working status (`generating`/`assembling`)
 *  WITHOUT a progress write before the sweeper treats it as orphaned and
 *  requeues it. Covers a hung call that escapes the per-call timeout AND the
 *  un-catchable case — a process restart mid-stage, where no try/catch runs and
 *  the row is stranded forever. Longer than one clip's gen timeout + margin so a
 *  healthy job (it heartbeats after every clip) is never killed mid-flight. */
const STUCK_JOB_MS = Number(process.env.REEL_STUCK_JOB_MS) || 12 * 60_000;

/** Reject `p` if it doesn't settle within `ms`. Clears the timer on either
 *  outcome so a resolved promise never leaks a dangling handle. NOTE: this
 *  unblocks the JOB, not the underlying op — a timed-out Higgsfield CLI
 *  subprocess keeps running until it exits on its own; we just stop awaiting it. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

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

    const { generateReelClipVideo } = await import("./veoStudio");
    const { storagePut } = await import("../storage");

    const clipUrls: string[] = [];
    for (const beat of beats) {
      const prompt =
        brief.higgsfieldPromptPack?.find((p) => p.beatNumber === beat.beatNumber)?.prompt ?? beat.visual;
      if (!prompt || !prompt.trim()) throw new Error(`beat ${beat.beatNumber} has no prompt`);
      // Timeout-guarded: a hung Veo poll otherwise blocks here forever with
      // the job parked in `generating` (no catch ever fires). On timeout it
      // rejects into the catch below and retries on the next pulse.
      const hgUrl = await withTimeout(
        generateReelClipVideo(prompt),
        GEN_CLIP_TIMEOUT_MS,
        `gen beat ${beat.beatNumber}`,
      );
      // Re-host the generated clip to our own public storage — source URLs can
      // be temporary, and storagePut falls back to the public /generated route
      // when S3 isn't configured, so the clip is always fetchable from us.
      const resp = await withTimeout(fetch(hgUrl), CLIP_FETCH_TIMEOUT_MS, `fetch beat ${beat.beatNumber}`);
      if (!resp.ok) throw new Error(`failed to fetch clip for beat ${beat.beatNumber}: HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      // Unique basename per (job, beat): the no-S3 fallback serves by basename
      // only, so a job-scoped prefix isn't enough — fold jobId into the filename
      // so job N's clip-0 can't overwrite job M's before assembly downloads it.
      const put = await storagePut(`reels/clip-${job.id}-${beat.beatNumber}.mp4`, buf, "video/mp4");
      clipUrls.push(put.url);
      // Heartbeat: bump updatedAt after each clip so the stuck-job sweeper can
      // tell an actively-progressing sequential gen from a hung one (updatedAt is
      // otherwise frozen at claim time for the entire multi-minute gen loop).
      await d.update(reelJobs).set({ updatedAt: new Date() }).where(eq(reelJobs.id, job.id));
      log.info("reel clip generated", { jobId: job.id, beat: beat.beatNumber, of: beats.length });
    }

    await d
      .update(reelJobs)
      // reset attempts so the assembly stage gets its own fresh retry budget
      .set({ status: "assets_ready", clipUrlsJson: JSON.stringify(clipUrls), error: null, attempts: 0 })
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

/**
 * Claim and process the oldest `assets_ready` reel job: download its re-hosted
 * clips, generate a voiceover, run the ffmpeg assembly, re-host the finished
 * MP4 (`assets_ready -> assembling -> assembled`, mp4Url set). STOPS at
 * `assembled` — publishing is a separate, separately-gated stage. Retry on
 * failure returns the job to `assets_ready` (never `queued`, which would
 * re-spend Higgsfield credits re-generating clips).
 *
 * SAFETY: same REEL_GENERATION_ENABLED kill-switch as the gen stage — a hard
 * no-op until the operator arms the pipeline.
 */
export async function processNextAssemblyJob(): Promise<{
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
    .where(eq(reelJobs.status, "assets_ready"))
    .orderBy(asc(reelJobs.createdAt))
    .limit(1);
  if (!rows.length) return { processed: false };
  const job = rows[0];
  const attempt = (job.attempts ?? 0) + 1;

  // Atomic claim: only the worker that flips assets_ready->assembling proceeds.
  const claim = await d
    .update(reelJobs)
    .set({ status: "assembling", attempts: attempt })
    .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "assets_ready")));
  const claimed =
    (claim as unknown as { affectedRows?: number; rowsAffected?: number })?.affectedRows ??
    (claim as unknown as { affectedRows?: number; rowsAffected?: number })?.rowsAffected ??
    0;
  if (claimed !== 1) return { processed: false }; // another worker claimed it

  try {
    // The stored payload is the full client ReelBrief (storyboardBeats carry
    // startSecond/endSecond) — richer than the gen stage's minimal ReelJobBrief.
    const brief = JSON.parse(job.payload) as ReelAssemblyBrief;
    const clipUrls = JSON.parse(job.clipUrlsJson ?? "[]") as string[];
    if (!Array.isArray(clipUrls) || !clipUrls.length) throw new Error("no clipUrls on assets_ready job");

    const { assembleReel } = await import("./reelAssembly");
    const { mp4Url, durationSec } = await assembleReel(brief, clipUrls, job.id);

    await d.update(reelJobs).set({ status: "assembled", mp4Url, error: null }).where(eq(reelJobs.id, job.id));
    log.info("reel job assembled", { jobId: job.id, mp4Url, durationSec });
    return { processed: true, jobId: job.id, status: "assembled" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Retry assembly (back to assets_ready, NOT queued — clips are already gen'd).
    const nextStatus = attempt >= MAX_ATTEMPTS ? "failed" : "assets_ready";
    await d.update(reelJobs).set({ status: nextStatus, error: msg.slice(0, 1000) }).where(eq(reelJobs.id, job.id));
    log.warn("reel assembly failed", { jobId: job.id, attempt, nextStatus, error: msg });
    return { processed: true, jobId: job.id, status: nextStatus, error: msg };
  }
}

/**
 * Requeue reel jobs orphaned in a working status. A job lands here when its
 * stage stops making progress: a hung Higgsfield/ffmpeg call that somehow
 * escapes the per-call timeout, or — the un-catchable case — a process restart
 * mid-stage, where no try/catch runs and the row is stranded in `generating`/
 * `assembling` forever (the stage claimers only ever pick up `queued`/
 * `assets_ready`, never a working status).
 *
 * `generating` -> `queued` (clips aren't persisted until `assets_ready`, so a
 * re-gen is required). `assembling` -> `assets_ready` (clips already exist — we
 * never re-gen and never re-spend Higgsfield credits). Honors MAX_ATTEMPTS so a
 * job that keeps wedging is parked `failed` instead of looping. The status-
 * guarded UPDATE makes it idempotent and safe against a worker that revives the
 * job between our SELECT and UPDATE.
 *
 * SAFETY: same REEL_GENERATION_ENABLED kill-switch — never touches the DB when off.
 */
export async function recoverStuckReelJobs(): Promise<{ recovered: number }> {
  if (process.env.REEL_GENERATION_ENABLED !== "true") return { recovered: 0 };

  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return { recovered: 0 };

  const { reelJobs } = await import("../../drizzle/schema");
  const { eq, and, lt, inArray } = await import("drizzle-orm");

  const cutoff = new Date(Date.now() - STUCK_JOB_MS);
  const stuck = await d
    .select()
    .from(reelJobs)
    .where(and(inArray(reelJobs.status, ["generating", "assembling"]), lt(reelJobs.updatedAt, cutoff)));

  let recovered = 0;
  for (const job of stuck) {
    const attempts = job.attempts ?? 0;
    const requeue = job.status === "assembling" ? "assets_ready" : "queued";
    const nextStatus = attempts >= MAX_ATTEMPTS ? "failed" : requeue;
    const res = await d
      .update(reelJobs)
      .set({
        status: nextStatus,
        error: `recovered from stuck '${job.status}' (no progress >${Math.round(STUCK_JOB_MS / 60_000)}m)`,
      })
      .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, job.status)));
    const flipped =
      (res as unknown as { affectedRows?: number; rowsAffected?: number })?.affectedRows ??
      (res as unknown as { affectedRows?: number; rowsAffected?: number })?.rowsAffected ??
      0;
    if (flipped === 1) {
      recovered++;
      log.warn("recovered stuck reel job", { jobId: job.id, from: job.status, to: nextStatus, attempts });
    }
  }
  return { recovered };
}
