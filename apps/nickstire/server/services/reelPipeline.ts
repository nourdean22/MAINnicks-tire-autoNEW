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

/** Per-clip Veo/generator timeout. seedance renders take minutes, so this is
 *  generous — its only job is to cap a HUNG CLI poll (the failure mode that
 *  otherwise parks a job in `generating` forever) so it rejects into the normal
 *  retry path instead of wedging the pipeline. Env-overridable. */
const GEN_CLIP_TIMEOUT_MS = Number(process.env.REEL_GEN_CLIP_TIMEOUT_MS) || 6 * 60_000;
/** Re-host fetch of an already-finished generated clip — short; it exists. */
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
 *  unblocks the JOB, not the underlying op — a timed-out generator CLI
 *  subprocess keeps running until it exits on its own; we just stop awaiting it. */
/** A LOCAL timeout — the underlying provider operation is NOT cancelled and may
 *  still be running/charging. Callers must distinguish this from a provider
 *  failure: a timed-out Veo op must be RESUMED (same operation name), never
 *  re-submitted, or every timeout doubles the paid spend. */
export class LocalTimeoutError extends Error {
  readonly isLocalTimeout = true as const;
}
export function isLocalTimeout(e: unknown): e is LocalTimeoutError {
  return e instanceof LocalTimeoutError || (typeof e === "object" && e !== null && (e as { isLocalTimeout?: boolean }).isLocalTimeout === true);
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LocalTimeoutError(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
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
  storyboardBeats?: Array<{ 
    beatNumber: number; 
    visual: string; 
    onScreenText?: string;
    veoOperationName?: string;
  }>;
  promptPack?: Array<{ beatNumber: number; prompt: string }>;
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

  try {
    const { buildHiggsfieldReelPromptPack } = await import("../../client/src/lib/facelessReelStudio");
    const promptPack = buildHiggsfieldReelPromptPack(brief as any);
    brief.promptPack = promptPack;
    brief.higgsfieldPromptPack = promptPack;
  } catch (e) {
    log.warn("failed to rebuild prompt packs server-side in enqueueReelJob", e);
  }

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
  const claimRes = await d
    .update(reelJobs)
    .set({ status: "generating", attempts: attempt })
    .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "queued")));
  const affectedRows = (claimRes[0] as unknown as { affectedRows?: number })?.affectedRows ?? 0;
  if (affectedRows !== 1) return { processed: false }; // another worker claimed it

  try {
    const brief = JSON.parse(job.payload) as ReelJobBrief;
    const beats = brief.storyboardBeats ?? [];
    if (!beats.length) throw new Error("brief has no storyboardBeats");

    // Fail BEFORE the first paid Veo clip if the output can't be durably kept —
    // otherwise we pay for clips that a deploy/restart wipes off ephemeral disk
    // (a failure prod already recorded). Marks the job failed with a clear,
    // actionable message rather than silently spending credits.
    const { assertDurableStorageForGeneration, storagePut } = await import("../storage");
    assertDurableStorageForGeneration(`reel job ${job.id} clip generation`);

    const { generateReelClipVideo } = await import("./veoStudio");

    let clipUrls: string[] = [];
    try {
      if (job.clipUrlsJson) {
        const parsed = JSON.parse(job.clipUrlsJson);
        if (Array.isArray(parsed)) clipUrls = parsed;
      }
    } catch (e) {
      log.warn("failed to parse existing clipUrlsJson, starting fresh", { jobId: job.id, err: e });
    }

    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      
      // If the clip for this beat index was already generated and hosted in a previous run, resume/skip it
      if (clipUrls[i] && clipUrls[i].startsWith("http")) {
        log.info("resuming: clip already exists for beat", { jobId: job.id, beat: beat.beatNumber, url: clipUrls[i] });
        continue;
      }

      const prompt =
        brief.promptPack?.find((p) => p.beatNumber === beat.beatNumber)?.prompt ??
        brief.higgsfieldPromptPack?.find((p) => p.beatNumber === beat.beatNumber)?.prompt ?? beat.visual;
      if (!prompt || !prompt.trim()) throw new Error(`beat ${beat.beatNumber} has no prompt`);

      const { submitVeoRequest, pollVeoOperation, downloadAndRehostVeoVideo } = await import("./veoStudio");

      let finalClipUrl = "";
      let opName = beat.veoOperationName;

      if (opName) {
        log.info("resuming generation: polling existing Veo operation name", { jobId: job.id, beat: beat.beatNumber, opName });
        try {
          const videoUri = await withTimeout(
            pollVeoOperation(opName),
            GEN_CLIP_TIMEOUT_MS,
            `poll beat ${beat.beatNumber} (existing)`
          );
          finalClipUrl = await downloadAndRehostVeoVideo(videoUri);
        } catch (pollErr) {
          // A LOCAL timeout means the Veo op is still alive — re-throw so the
          // job requeues and the NEXT pulse resumes polling this SAME opName
          // (persisted on the beat). Discarding it here and re-submitting is
          // what doubled the paid spend on every timeout. Only a genuine
          // provider failure (op rejected/failed) is safe to replace.
          if (isLocalTimeout(pollErr)) {
            log.warn("poll timed out — resuming same Veo op next pulse (no re-submit)", { jobId: job.id, beat: beat.beatNumber, opName });
            throw pollErr;
          }
          log.warn("existing Veo op failed (provider error) — submitting a fresh request", { jobId: job.id, beat: beat.beatNumber, err: pollErr });
          opName = undefined;
        }
      }

      if (!opName) {
        opName = await submitVeoRequest(prompt);
        beat.veoOperationName = opName;
        await d.update(reelJobs)
          .set({ 
            payload: JSON.stringify(brief),
            updatedAt: new Date() 
          })
          .where(eq(reelJobs.id, job.id));

        const videoUri = await withTimeout(
          pollVeoOperation(opName),
          GEN_CLIP_TIMEOUT_MS,
          `poll beat ${beat.beatNumber} (new)`
        );
        finalClipUrl = await downloadAndRehostVeoVideo(videoUri);
      }
      
      // Save clip URL at the specific beat index
      clipUrls[i] = finalClipUrl;

      // Heartbeat: bump updatedAt and progressive clipUrlsJson in the DB immediately after each success
      await d.update(reelJobs)
        .set({ 
          clipUrlsJson: JSON.stringify(clipUrls),
          updatedAt: new Date() 
        })
        .where(eq(reelJobs.id, job.id));

      log.info("reel clip generated and saved progressively", { jobId: job.id, beat: beat.beatNumber, of: beats.length });
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
 * re-spend generator credits re-generating clips).
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

  const { reelJobs, socialContentInventory } = await import("../../drizzle/schema");
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
  const claimRes = await d
    .update(reelJobs)
    .set({ status: "assembling", attempts: attempt })
    .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "assets_ready")));
  const affectedRows = (claimRes[0] as unknown as { affectedRows?: number })?.affectedRows ?? 0;
  if (affectedRows !== 1) return { processed: false }; // another worker claimed it

  try {
    // The stored payload is the full client ReelBrief (storyboardBeats carry
    // startSecond/endSecond) — richer than the gen stage's minimal ReelJobBrief.
    const brief = JSON.parse(job.payload) as ReelAssemblyBrief;
    const clipUrls = JSON.parse(job.clipUrlsJson ?? "[]") as string[];
    if (!Array.isArray(clipUrls) || !clipUrls.length) throw new Error("no clipUrls on assets_ready job");

    const { assembleReel } = await import("./reelAssembly");
    const { mp4Url, durationSec } = await assembleReel(brief, clipUrls, job.id);

    await d.update(reelJobs).set({ status: "assembled", mp4Url, error: null }).where(eq(reelJobs.id, job.id));

    if (job.briefId && job.briefId !== "unknown") {
      await d
        .update(socialContentInventory)
        .set({
          status: "review_ready",
          assetPaths: [mp4Url],
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(socialContentInventory.id, job.briefId));
    }

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
 * stage stops making progress: a hung Veo/ffmpeg call that somehow
 * escapes the per-call timeout, or — the un-catchable case — a process restart
 * mid-stage, where no try/catch runs and the row is stranded in `generating`/
 * `assembling` forever (the stage claimers only ever pick up `queued`/
 * `assets_ready`, never a working status).
 *
 * `generating` -> `queued` (clips aren't persisted until `assets_ready`, so a
 * re-gen is required). `assembling` -> `assets_ready` (clips already exist — we
 * never re-gen and never re-spend generator credits). Honors MAX_ATTEMPTS so a
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
