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

/**
 * Which video generator produces reel clips. Veo (Gemini) and Higgsfield
 * (Seedance) both work; the pipeline was hardwired to Veo, so a dead Gemini key
 * blocked reels even with a funded Higgsfield plan loaded.
 *
 * Selection: explicit REEL_VIDEO_PROVIDER wins. Otherwise auto — use whichever
 * is actually credentialed, preferring Veo only when it has a key; if Veo has
 * no key but Higgsfield does, use Higgsfield. So "Higgsfield loaded, Gemini key
 * dead" generates today with zero config.
 */
export async function selectReelVideoProvider(): Promise<"veo" | "higgsfield"> {
  const explicit = process.env.REEL_VIDEO_PROVIDER?.toLowerCase();
  if (explicit === "veo" || explicit === "higgsfield") return explicit;
  const { veoCredentialsPresent } = await import("./veoStudio");
  if (veoCredentialsPresent()) return "veo";
  try {
    const { getHiggsfieldCredentialsJson } = await import("./higgsfieldStudio");
    if (await getHiggsfieldCredentialsJson()) return "higgsfield";
  } catch { /* fall through */ }
  return "veo";
}

/** Minimal structural view of a client ReelBrief — only the fields gen needs. */
export interface ReelJobBrief {
  id?: string;
  topic?: string;
  campaignKeyword?: string;
  selectedCaption?: string;
  hashtags?: string[];
  storyboardBeats?: Array<{ 
    beatNumber: number; 
    visual: string; 
    onScreenText?: string;
    veoOperationName?: string;
  }>;
  promptPack?: Array<{ beatNumber: number; prompt: string; negativePrompt?: string }>;
  higgsfieldPromptPack?: Array<{ beatNumber: number; prompt: string; negativePrompt?: string }>;
  voiceoverScript?: string;
  /** campaign lineage — the creative_genomes row this brief descends from */
  genomeId?: string | null;
  /** operator-approved visual world; its locked invariants MUST survive into
   *  the prompt pack rebuilt here (the #814 P1: briefClean dropped this) */
  visualWorld?: {
    style: string;
    heroFrameUrl: string;
    framePrompt: string;
    lockedInvariants: string;
  };
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

  // THE authoritative policy boundary for render spend (#815 review P1: the
  // router-only check let cron + service callers bypass kill switches and
  // budget). Every caller — admin Studio, Campaign Package, daily cron,
  // content manufacturing, future autonomous controllers — passes here.
  // Operator paths proceed loud on policy-infra failure; cron fails closed.
  {
    const { enforceAtBoundary, clevelandDayStart, ESTIMATED_REEL_RENDER_COST_USD } = await import("./autonomyControl");
    // Today's spend comes from the generation LEDGER (reserved + settled +
    // failed since Cleveland midnight) — never from job-row counts. Until
    // 0086 is applied the ledger returns null and the coarse count-based
    // fallback stands in, loudly.
    let spendToday: number;
    const { dailySpendUsd } = await import("./generationLedger");
    const ledgerSpend = await dailySpendUsd();
    if (ledgerSpend !== null) {
      spendToday = ledgerSpend;
    } else {
      const { gte } = await import("drizzle-orm");
      const { sql: dsql } = await import("drizzle-orm");
      let rendersToday = 0;
      try {
        const [row] = await d.select({ n: dsql<number>`COUNT(*)` }).from(reelJobs).where(gte(reelJobs.createdAt, clevelandDayStart()));
        rendersToday = Number(row?.n ?? 0);
      } catch { /* count unavailable — budget check runs without today's spend */ }
      spendToday = rendersToday * ESTIMATED_REEL_RENDER_COST_USD;
      log.warn("generation ledger unavailable — coarse job-count spend fallback in use", { spendToday });
    }
    await enforceAtBoundary(
      {
        type: "enqueue_render",
        format: "reel",
        estimatedCostUsd: ESTIMATED_REEL_RENDER_COST_USD,
        today: { generationCostUsd: spendToday },
      },
      { type: source === "cron" ? "cron" : "operator", id: source },
      (brief as { genomeId?: string | null }).genomeId ?? null,
    );
  }

  // Content governor: reserve the publishing slot BEFORE spending on
  // production — a reel that could never be scheduled (cap, spacing, repeat
  // topic/CTA) must die here, not after 6 provider clips. Reservation id
  // rides the payload for the future consumption linkage.
  {
    const { requestReservation } = await import("./contentGovernor");
    const now = new Date();
    const reservation = await requestReservation({
      platform: "instagram",
      format: "reel",
      windowStart: now,
      windowEnd: new Date(now.getTime() + 24 * 3600_000),
      topic: brief.topic,
      cta: brief.campaignKeyword,
      campaignId: (brief as { genomeId?: string | null }).genomeId ?? null,
    });
    if (reservation) (brief as { contentReservationId?: string }).contentReservationId = reservation.reservationId;
  }

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
  // Reserve the render budget in the ledger (idempotent on the job id).
  // Settled at assets_ready with clips × per-clip estimate; failed jobs keep
  // the conservative reservation as their spend record.
  {
    const { reserve, COST_ESTIMATES_USD } = await import("./generationLedger");
    const { getActivePolicy } = await import("./autonomyControl");
    const beatsCount = brief.storyboardBeats?.length ?? 6;
    const policy = await getActivePolicy();
    try {
      await reserve({
        actionId: `reel_job_${jobId}`,
        campaignId: (brief as { genomeId?: string | null }).genomeId ?? null,
        provider: "higgsfield",
        model: "seedance1_5",
        operation: "reel_clips",
        estimatedCostUsd: beatsCount * COST_ESTIMATES_USD.seedance_clip,
        dailyBudgetUsd: policy.limits.maxGenerationCostPerDayUsd,
      });
    } catch (err) {
      // A budget breach discovered at reservation time must stop the job:
      // flip it to failed before the worker ever picks it up.
      if (err instanceof Error && err.message.startsWith("BUDGET_DAILY_EXCEEDED")) {
        const { eq } = await import("drizzle-orm");
        await d.update(reelJobs).set({ status: "failed", error: err.message.slice(0, 1000) }).where(eq(reelJobs.id, jobId));
      }
      throw err;
    }
  }
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

    const { assertDurableStorageForGeneration, storagePut } = await import("../storage");

    const videoProvider = await selectReelVideoProvider();
    log.info("reel clip generation provider selected", { jobId: job.id, provider: videoProvider });

    // The durable-storage precondition only applies to providers that RE-HOST
    // through our storage (Veo → storagePut → ephemeral local disk without S3,
    // which a deploy wipes after we already paid). Higgsfield returns its OWN
    // hosted CDN URL (parseResultUrl) — durable without any S3, the same way the
    // carousel image path already trusts Higgsfield URLs — so it needs no
    // precondition. This is why "Higgsfield loaded" generates with zero infra.
    if (videoProvider === "veo") {
      assertDurableStorageForGeneration(`reel job ${job.id} Veo clip generation`);
    }

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

      // Keep the compiled negativePrompt paired with its beat: Seedance has no
      // negative parameter, so the adapter compiles it into a DO NOT INCLUDE
      // section - dropping it here (the pre-2026-07-17 behavior) meant every
      // style exclusion the compiler produced had zero effect on generation.
      const packEntry =
        brief.promptPack?.find((p) => p.beatNumber === beat.beatNumber) ??
        brief.higgsfieldPromptPack?.find((p) => p.beatNumber === beat.beatNumber);
      const prompt = packEntry?.prompt ?? beat.visual;
      const negativePrompt = packEntry?.negativePrompt;
      if (!prompt || !prompt.trim()) throw new Error(`beat ${beat.beatNumber} has no prompt`);

      let finalClipUrl = "";

      if (videoProvider === "higgsfield") {
        // Higgsfield/Seedance is a single blocking call (submit+poll+rehost
        // internally) — no resumable op name. Each beat's URL is persisted right
        // after success below, so a job retry resume-skips completed beats. A
        // local timeout requeues and regenerates only the unfinished beat.
        const { generateReelClipVideo } = await import("./higgsfieldStudio");
        finalClipUrl = await withTimeout(
          generateReelClipVideo({ prompt, negativePrompt }),
          GEN_CLIP_TIMEOUT_MS,
          `higgsfield beat ${beat.beatNumber}`,
        );
        clipUrls[i] = finalClipUrl;
        await d.update(reelJobs)
          .set({ clipUrlsJson: JSON.stringify(clipUrls), updatedAt: new Date() })
          .where(eq(reelJobs.id, job.id));
        log.info("reel clip generated (higgsfield) and saved progressively", { jobId: job.id, beat: beat.beatNumber, of: beats.length });
        continue;
      }

      const { submitVeoRequest, pollVeoOperation, downloadAndRehostVeoVideo } = await import("./veoStudio");

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
    // Provider spend is complete at this point — settle the reservation with
    // clips × per-clip estimate (flagged estimate; no USD feed from the CLI).
    try {
      const { settle, COST_ESTIMATES_USD } = await import("./generationLedger");
      await settle(`reel_job_${job.id}`, clipUrls.length * COST_ESTIMATES_USD.seedance_clip);
    } catch { /* ledger degraded — reservation's estimate stands */ }
    log.info("reel job assets_ready", { jobId: job.id, clips: clipUrls.length });
    return { processed: true, jobId: job.id, status: "assets_ready" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Retry on the next pulse until MAX_ATTEMPTS, then park as failed.
    const nextStatus = attempt >= MAX_ATTEMPTS ? "failed" : "queued";
    await d.update(reelJobs).set({ status: nextStatus, error: msg.slice(0, 1000) }).where(eq(reelJobs.id, job.id));
    if (nextStatus === "failed") {
      // Terminal failure: keep the conservative reservation as the spend
      // record (clips may have partially generated and burned credits).
      try {
        const { fail } = await import("./generationLedger");
        await fail(`reel_job_${job.id}`);
      } catch { /* ledger degraded */ }
    }
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
    // Rendered creative QA (flag-gated; default OFF so prod behavior is
    // unchanged until the operator arms it). Best-effort: QA never fails an
    // assembled job - its verdict is evidence for the approve gate.
    if (process.env.RENDERED_QA_ENABLED === "true") {
      try {
        const { runRenderedQaOnJob } = await import("./renderedQa");
        await runRenderedQaOnJob(job.id);
      } catch (e) {
        log.warn("rendered QA hook failed (job remains assembled)", { jobId: job.id, e: e instanceof Error ? e.message : String(e) });
      }
    }

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
    .where(and(inArray(reelJobs.status, ["generating", "assembling", "repair_rendering"]), lt(reelJobs.updatedAt, cutoff)));

  let recovered = 0;
  for (const job of stuck) {
    const attempts = job.attempts ?? 0;
    const requeue = job.status === "assembling" ? "assets_ready" : job.status === "repair_rendering" ? "repair_queued" : "queued";
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
