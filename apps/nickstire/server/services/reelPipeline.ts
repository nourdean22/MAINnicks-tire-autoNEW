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
import type { CtaType } from "../../shared/instagramStudio";
import type { EpisodeContract, EpisodeDeclaration } from "../../shared/episodeContract";

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
export type ReelVideoProvider = "veo" | "higgsfield" | "template_stock";

/** What each provider is recorded as in generation_reservations.model. */
const PROVIDER_LEDGER_MODEL: Record<ReelVideoProvider, () => string> = {
  veo: () => process.env.REEL_VEO_MODEL || "veo-3.1-fast-generate-preview",
  higgsfield: () => "seedance1_5",
  template_stock: () => "ffmpeg_local",
};

export async function selectReelVideoProvider(): Promise<ReelVideoProvider> {
  const explicit = process.env.REEL_VIDEO_PROVIDER?.toLowerCase();
  // template_stock is EXPLICIT-PIN ONLY and is never auto-selected below. It
  // needs no credentials, so auto-detect would happily prefer it over a funded
  // paid provider and quietly change what the shop publishes. The prod pin
  // (higgsfield, a deliberate cost decision) must also survive this lane.
  if (explicit === "veo" || explicit === "higgsfield" || explicit === "template_stock") {
    // The pin still wins — that is its job, and the tests pin that contract.
    // But it is announced when the pinned provider has no credentials at all,
    // because this selector is how prod ended up generating into a dead provider:
    // on 2026-08-03 REEL_VIDEO_PROVIDER=higgsfield was live with generation,
    // autopost and publish all enabled while that session had been expired since
    // 07-31, and nothing between the env var and the failing CLI call said so.
    //
    // Deliberately a warn and NOT a throw: socialDeliveryIssues.ts calls this
    // OUTSIDE its try block, so throwing here would take down the whole Today
    // delivery panel to report a config problem.
    //
    // NOT a liveness check, and it would NOT have caught the incident above:
    // getHiggsfieldCredentialsJson returns the stored blob without parsing it, so
    // an EXPIRED session reads as present. Liveness belongs to the keepalive probe
    // and to the operator-facing readiness signal, not to a hot selector.
    if (!(await reelProviderCredentialsPresent(explicit))) {
      log.warn("REEL_VIDEO_PROVIDER pins a provider with no credentials present", {
        pinned: explicit,
        hint: "unset REEL_VIDEO_PROVIDER to auto-select, or load that provider's credentials",
      });
    }
    return explicit;
  }
  if (await reelProviderCredentialsPresent("veo")) return "veo";
  if (await reelProviderCredentialsPresent("higgsfield")) return "higgsfield";
  return "veo";
}

/**
 * Presence, NOT liveness — the same contract veoCredentialsPresent documents for
 * itself. A stored-but-expired Higgsfield session reads as present here.
 */
export async function reelProviderCredentialsPresent(provider: ReelVideoProvider): Promise<boolean> {
  // The local lane renders with ffmpeg and has no credentials to be missing, so
  // it is always "present" — otherwise pinning it would log the no-credentials
  // warning on every selection for a provider that is working correctly.
  if (provider === "template_stock") return true;
  if (provider === "veo") {
    const { veoCredentialsPresent } = await import("./veoStudio");
    return veoCredentialsPresent();
  }
  try {
    const { getHiggsfieldCredentialsJson } = await import("./higgsfieldStudio");
    return Boolean(await getHiggsfieldCredentialsJson());
  } catch {
    return false;
  }
}

/** Minimal structural view of a client ReelBrief — only the fields gen needs. */
/** Instagram's published caption ceiling, including hashtags. */
export const INSTAGRAM_CAPTION_LIMIT = 2200;

export interface ReelJobBrief {
  id?: string;
  topic?: string;
  campaignKeyword?: string;
  /**
   * The action the caption actually asks for. Distinct from campaignKeyword:
   * "BRAKES" is a topic, "SEND" is a call to action. The governor's repetition
   * check needs the latter — fed the keyword, it was deduplicating topics while
   * believing it was varying CTAs, so every reel could carry the same ask.
   */
  ctaType?: CtaType;
  /** The contract this job is governed by, stamped at enqueue. */
  episodeContract?: EpisodeContract;
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
/**
 * Enqueue a reel.
 *
 * `episode` is REQUIRED. It is the authority for what this episode claims,
 * says, and discloses; the brief is now an input to that contract rather than a
 * parallel source of truth. Callers build it with `fromReelJobBrief` (which
 * reports what the brief could not supply) plus whatever the caller genuinely
 * knows — objective, disclosure mode, CTA, claims, evidence.
 *
 * The contract is preflighted BEFORE the spend boundary and persisted with the
 * job, so every later stage derives from one stored artifact instead of
 * re-deriving from a bag of optional fields.
 */
export async function enqueueReelJob(
  brief: ReelJobBrief,
  source: "admin" | "cron",
  episode: EpisodeDeclaration,
): Promise<{ jobId: number }> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) throw new Error("DB not available");
  const { reelJobs } = await import("../../drizzle/schema");

  // Contract preflight runs FIRST — before the legacy preflight, before the
  // spend boundary, before the governor reservation — so a contract defect
  // costs nothing. A caller that supplies no contract gets one derived from the
  // brief rather than a bypass: the derived contract is held to the same rules,
  // and what the brief could not supply shows up as findings instead of being
  // assumed away.
  // Instagram's cap is 5 and the generator routinely emits 10-12; every post
  // this account has made violated it. Trimming here is NOT the silent
  // truncation this file refuses to do for captions: tags 6..n were never
  // publishable, so dropping them removes an already-illegal tail rather than
  // amputating meaning. Blocking instead would have been worse — a measured
  // dry-run showed it stopping 10 of 12 real briefs.
  {
    const { HASHTAG_CAP } = await import("../../shared/episodeContract");
    const tags = brief.hashtags ?? [];
    if (tags.length > HASHTAG_CAP) {
      log.warn("hashtags over the platform cap — trimming", {
        briefId: brief.id, had: tags.length, cap: HASHTAG_CAP, dropped: tags.slice(HASHTAG_CAP),
      });
      brief.hashtags = tags.slice(0, HASHTAG_CAP);
    }
  }

  {
    const { contractFromDeclaration, preflightEpisode } = await import("../../shared/episodeContract");
    const contract = contractFromDeclaration(brief as Record<string, unknown>, episode);
    const pre = preflightEpisode(contract, new Date(), {
      requireClaimEvidence: process.env.REEL_REQUIRE_CLAIM_EVIDENCE === "true",
    });
    if (pre.warnings.length) {
      // Real findings the pipeline cannot yet enforce because no evidence
      // record reaches a reel brief. Logged every time so the gap stays visible
      // rather than becoming invisible acceptance.
      log.warn("episode contract findings NOT enforced (claim/evidence layer unwired)", {
        briefId: brief.id, source, warnings: pre.warnings,
      });
    }
    if (!pre.allowed) {
      log.warn("episode contract BLOCKED enqueue — no spend reserved", {
        briefId: brief.id, source, blocks: pre.blocks,
      });
      throw new Error(`Episode contract blocked (${pre.blocks.length}): ${pre.detail.join("; ")}`);
    }
    (brief as { episodeContract?: EpisodeContract }).episodeContract = contract;
  }

  // M10: deterministic preflight — do NOT reserve paid generation for a brief
  // with a predictable defect. Runs BEFORE the spend boundary + governor
  // reservation below, so a blocked brief costs nothing. Same block conditions
  // as the quality gate (structure, claim-safety, faceless, in-frame-text), now
  // enforced on EVERY enqueue path incl. the previously-ungated cron path.
  {
    const { runReelPreflight } = await import("../../client/src/lib/facelessReelStudio");
    const pre = runReelPreflight(brief as never);
    if (pre.status === "block") {
      log.warn("reel preflight BLOCKED enqueue — no spend reserved", { blocking: pre.blocking });
      throw new Error(`Reel preflight blocked (${pre.blocking.length}): ${pre.blocking.map((f) => f.message).join("; ")}`);
    }
  }

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
      // The real CTA when the brief carries one. Falls back to the keyword only
      // so pre-existing briefs keep reserving rather than silently losing their
      // slot; new briefs should always set ctaType.
      cta: brief.ctaType ?? brief.campaignKeyword,
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

  // FAIL, don't truncate. A hard slice to the limit silently amputated whatever
  // sat at the end of the composed caption — which is exactly where the CTA, the
  // required claim qualifier, and the AI disclosure live. A caption that cannot
  // be published intact is a brief defect to repair upstream, not something to
  // quietly shorten on its way into a job row. Same rule the markdown ingester
  // already applies (scripts/ingest-reels-markdown.ts:112).
  let caption: string | null = null;
  if (brief.selectedCaption) {
    const composed = `${brief.selectedCaption}\n\n${(brief.hashtags ?? []).join(" ")}`.trim();
    if (composed.length > INSTAGRAM_CAPTION_LIMIT) {
      throw new Error(
        `caption + hashtags is ${composed.length} chars, over Instagram's ${INSTAGRAM_CAPTION_LIMIT} limit — ` +
          `shorten the caption or drop hashtags upstream; refusing to truncate and lose the CTA/disclosure`,
      );
    }
    caption = composed;
  }
  // Compensation boundary: the content reservation was created above. If THIS
  // insert throws (constraint, connection, an oversized field), release the
  // reserved slot before rethrowing so it doesn't leak and eat the feed
  // cap/spacing for a reel that will never exist. (MEDIUMTEXT fixed one cause of
  // the insert failure; this closes the boundary for any cause.)
  let res;
  try {
    res = await d.insert(reelJobs).values({
      briefId: String(brief.id ?? "unknown"),
      payload: JSON.stringify(brief),
      status: "queued",
      caption,
      source,
    });
  } catch (insertErr) {
    const resId = (brief as { contentReservationId?: string }).contentReservationId;
    if (resId) {
      try {
        const { releaseReservation } = await import("./contentGovernor");
        await releaseReservation(resId);
        log.warn("released content reservation after reel_jobs insert failure", { resId });
      } catch (relErr) {
        log.error("failed to release reservation after insert failure — slot may leak", { resId, err: relErr instanceof Error ? relErr.message : String(relErr) });
      }
    }
    throw insertErr;
  }
  const jobId = Number(
    (res as unknown as { insertId?: number })?.insertId ??
      (res as unknown as Array<{ insertId?: number }>)?.[0]?.insertId ??
      0,
  );
  // Reserve the render budget in the ledger (idempotent on the job id).
  // Settled at assets_ready with clips × per-clip estimate; failed jobs keep
  // the conservative reservation as their spend record.
  {
    const { reserve, reelClipCostUsd } = await import("./generationLedger");
    const { getActivePolicy } = await import("./autonomyControl");
    const beatsCount = brief.storyboardBeats?.length ?? 6;
    const policy = await getActivePolicy();
    // The provider is chosen at RUN time by selectReelVideoProvider, but this
    // reservation used to hardcode higgsfield/seedance1_5 — so a Veo render was
    // booked against Higgsfield. Not hypothetical: on 2026-07-31 job 1200003
    // logged provider="veo" while generation_reservations held ZERO veo rows,
    // silently corrupting every cost-per-reel and provider comparison.
    // Resolve the SAME selector the worker will use, so the ledger records what
    // actually ran. Reservation happens before the run, so a mid-flight provider
    // flip can still diverge — settlement is where actuals must be reconciled.
    const reservedProvider = await selectReelVideoProvider();
    try {
      await reserve({
        actionId: `reel_job_${jobId}`,
        campaignId: (brief as { genomeId?: string | null }).genomeId ?? null,
        provider: reservedProvider,
        // The model string was a binary ternary, so a third provider was
        // recorded as seedance1_5 — nothing validates it, and every
        // cost-per-reel and provider-comparison figure would have inherited
        // the lie.
        model: PROVIDER_LEDGER_MODEL[reservedProvider](),
        operation: "reel_clips",
        // Priced by the provider actually resolved above, not a flat Seedance
        // constant — this figure is what reserve() checks against the daily
        // ceiling, so pricing Veo at Higgsfield's rate loosened the guard, and
        // pricing the free local lane at it would throw BUDGET_DAILY_EXCEEDED
        // for renders that cost nothing.
        estimatedCostUsd: beatsCount * reelClipCostUsd(reservedProvider),
        dailyBudgetUsd: policy.limits.maxGenerationCostPerDayUsd,
      });
    } catch (err) {
      // A budget breach discovered at reservation time must stop the job:
      // flip it to failed before the worker ever picks it up.
      if (err instanceof Error && err.message.startsWith("BUDGET_DAILY_EXCEEDED")) {
        const { eq } = await import("drizzle-orm");
        await d.update(reelJobs).set({ status: "failed", error: err.message.slice(0, 1000) }).where(eq(reelJobs.id, jobId));
        await releaseFailedJobReservation(JSON.stringify(brief), jobId);
      }
      throw err;
    }
  }
  log.info("reel job enqueued", { jobId, briefId: brief.id, beats: brief.storyboardBeats?.length ?? 0 });
  // Place the episode in the running experiment, if there is one. NO-OP by
  // default (no experiment running), never throws — an unassigned episode is a
  // measurement gap; a thrown error here would be a lost reel. Assignment
  // happens at ENQUEUE rather than at publish so the arm is fixed before any
  // generation decision could be influenced by it.
  {
    const { assignEpisodeToActiveExperiment } = await import("./contentExperimentStore");
    // provider is intentionally omitted: it is resolved inside the reservation
    // block above and is not in scope here, and guessing it would put a WRONG
    // provider on the experiment record — the exact defect fixed in #1257.
    await assignEpisodeToActiveExperiment(jobId, { contentOrigin: "ai_generated" });
  }

  return { jobId };
}

/**
 * Claim and process the oldest queued reel job (gen clips -> re-host ->
 * assets_ready). Returns {processed:false} when disabled or idle.
 *
 * SAFETY: hard no-op unless REEL_GENERATION_ENABLED === "true" — enqueued jobs
 * never spend Higgsfield credits until the operator explicitly arms generation.
 */
/**
 * A job that terminally FAILS must release its content-governor slot — the
 * reel it reserved a window for never came to exist. Live incident: failed
 * job 660001's orphaned reservation blocked every reel enqueue for its full
 * 24h window (RESERVATION_SPACING) until released by hand. Best-effort: a
 * missing/unparseable id just logs.
 */
export async function releaseFailedJobReservation(payloadJson: string | null, jobId: number): Promise<void> {
  try {
    const payload = JSON.parse(payloadJson ?? "{}") as { contentReservationId?: string };
    if (!payload.contentReservationId) return;
    const { releaseReservation } = await import("./contentGovernor");
    await releaseReservation(payload.contentReservationId);
    log.info("released content reservation for terminally failed job", { jobId, reservationId: payload.contentReservationId });
  } catch (e) {
    log.warn("failed to release reservation for failed job", { jobId, e: e instanceof Error ? e.message : String(e) });
  }
}

export async function processNextReelJob(scopeJobId?: number): Promise<{
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

  // scopeJobId pins the worker to ONE job (the operator canary passes it so it
  // can never claim + spend credits on an unrelated older queued row). The cron
  // calls with no arg → queue-wide FIFO as before.
  const where = scopeJobId
    ? and(eq(reelJobs.status, "queued"), eq(reelJobs.id, scopeJobId))
    : eq(reelJobs.status, "queued");
  const rows = await d
    .select()
    .from(reelJobs)
    .where(where)
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
    // template_stock re-hosts through storagePut exactly like Veo (it renders to
    // local disk first), so it carries the same precondition — without durable
    // storage the clip lands on ephemeral disk and a redeploy destroys it.
    // Higgsfield is the only provider that returns its own durable CDN URL.
    if (videoProvider === "veo" || videoProvider === "template_stock") {
      assertDurableStorageForGeneration(`reel job ${job.id} ${videoProvider} clip generation`);
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

      if (videoProvider === "template_stock") {
        // Local ffmpeg render — no API, no credits, no credentials. Same
        // per-beat contract as Higgsfield: one blocking call returning one
        // public URL, persisted immediately below so a retry resume-skips it.
        // That per-beat write is also the pipeline's stuck-job heartbeat, so a
        // lane that rendered every beat before writing once would be swept.
        // NOTE: `prompt` is deliberately NOT passed. It is a provider
        // scene-generation instruction, and assembly already burns the beat's
        // onScreenText over the stitched clips — sending it here exposed
        // internal prompts on screen and produced a duplicate caption layer.
        const { generateTemplateStockClip } = await import("./templateStockStudio");
        const hero = brief.visualWorld?.heroFrameUrl;
        finalClipUrl = await withTimeout(
          generateTemplateStockClip({
            beatNumber: beat.beatNumber,
            backgroundImageUrl: hero && /\.(jpe?g|png|webp)([?#]|$)/i.test(hero) ? hero : undefined,
          }),
          GEN_CLIP_TIMEOUT_MS,
          `template_stock beat ${beat.beatNumber}`,
        );
        clipUrls[i] = finalClipUrl;
        await d.update(reelJobs)
          .set({ clipUrlsJson: JSON.stringify(clipUrls), updatedAt: new Date() })
          .where(eq(reelJobs.id, job.id));
        log.info("reel clip rendered (template_stock) and saved progressively", { jobId: job.id, beat: beat.beatNumber, of: beats.length });
        continue;
      }

      if (videoProvider === "higgsfield") {
        // Higgsfield/Seedance is a single blocking call (submit+poll+rehost
        // internally) — no resumable op name. Each beat's URL is persisted right
        // after success below, so a job retry resume-skips completed beats. A
        // local timeout requeues and regenerates only the unfinished beat.
        const { generateReelClipVideo } = await import("./higgsfieldStudio");
        // Image conditioning (milestone 6, flag-gated REEL_IMAGE_CONDITIONING):
        // the identity-drift killer. EVERY beat anchors on the SAME approved
        // Visual World hero frame — a real generated IMAGE — so all beats share
        // one visual DNA. (The earlier "chain on the previous beat's clip"
        // wiring was wrong: --start-image needs an IMAGE, and clipUrls hold
        // mp4s; a shared hero anchor is both correct and stronger for identity
        // lock.) generateReelClipVideo ignores startImageUrl unless the flag is
        // on AND the URL looks like an image, so prod stays text-only until a
        // paid seedance image-render proves it live.
        const hero = brief.visualWorld?.heroFrameUrl;
        const startImageUrl = hero && /\.(jpe?g|png|webp)([?#]|$)/i.test(hero) ? hero : undefined;
        finalClipUrl = await withTimeout(
          generateReelClipVideo({ prompt, negativePrompt, startImageUrl }),
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

      // Veo is the LAST branch, and it is reached only by elimination. That was
      // an implicit else for two providers: widening the union does not make
      // this a compile error, so an unhandled provider silently ran Veo and
      // spent real money under another provider's name. Fail loudly instead.
      if (videoProvider !== "veo") {
        throw new Error(
          `unhandled REEL_VIDEO_PROVIDER "${videoProvider}" — add an explicit branch before the Veo path`,
        );
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
      const { settle, reelClipCostUsd } = await import("./generationLedger");
      // videoProvider is the provider this run actually used, resolved above —
      // settling at a flat Seedance rate is what made a mid-flight provider flip
      // undetectable in the ledger, and would settle a free local reel as if it
      // had spent Seedance money.
      await settle(`reel_job_${job.id}`, clipUrls.length * reelClipCostUsd(videoProvider));
    } catch { /* ledger degraded — reservation's estimate stands */ }
    log.info("reel job assets_ready", { jobId: job.id, clips: clipUrls.length });
    return { processed: true, jobId: job.id, status: "assets_ready" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // WHAT failed decides what to do about it. One blanket "retry until
    // MAX_ATTEMPTS" resubmitted safety-blocked prompts unchanged (paying to be
    // rejected identically), spent retries on rate limits that never ran, and
    // treated an expired key as a flaky provider. See shared/providerErrors.ts.
    const { classifyProviderError, nextStatusFor, stampError } = await import("../../shared/providerErrors");
    // Whether a timeout is RESUMABLE or AMBIGUOUS is decided by whether an
    // operation handle survived, and the handle lives on a beat inside the
    // payload — which the Veo path rewrites immediately after submitting,
    // BEFORE it polls. `job.payload` here is the copy read at claim time, so it
    // predates that write; re-read the row or every Veo timeout is misread as
    // the ambiguous Higgsfield case and goes terminal instead of resuming.
    let hasRemoteOperationId = false;
    try {
      const [fresh] = await d
        .select({ payload: reelJobs.payload })
        .from(reelJobs)
        .where(eq(reelJobs.id, job.id))
        .limit(1);
      const parsed = JSON.parse(fresh?.payload ?? "{}") as { storyboardBeats?: Array<{ veoOperationName?: string }> };
      hasRemoteOperationId = (parsed.storyboardBeats ?? []).some(
        (b) => typeof b?.veoOperationName === "string" && b.veoOperationName.length > 0,
      );
    } catch { /* unreadable payload — treat as no handle, i.e. the cautious branch */ }

    const verdict = classifyProviderError(err, {
      isLocalTimeout: isLocalTimeout(err),
      hasRemoteOperationId,
    });
    const decided = nextStatusFor(verdict, attempt, MAX_ATTEMPTS, "queued");
    const nextStatus = decided.status;
    await d
      .update(reelJobs)
      .set({ status: nextStatus, attempts: decided.attempts, error: stampError(verdict, msg).slice(0, 1000) })
      .where(eq(reelJobs.id, job.id));
    log.warn("reel job failure classified", {
      jobId: job.id,
      errorClass: verdict.errorClass,
      action: verdict.action,
      mayDoubleSpend: verdict.mayDoubleSpend,
      attempt,
      nextStatus,
    });
    if (nextStatus === "failed") {
      // Terminal failure: keep the conservative reservation as the spend
      // record (clips may have partially generated and burned credits).
      try {
        const { fail } = await import("./generationLedger");
        await fail(`reel_job_${job.id}`);
        await releaseFailedJobReservation(job.payload, job.id);
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
export async function processNextAssemblyJob(scopeJobId?: number): Promise<{
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

  // scopeJobId pins assembly to ONE job (see processNextReelJob).
  const where = scopeJobId
    ? and(eq(reelJobs.status, "assets_ready"), eq(reelJobs.id, scopeJobId))
    : eq(reelJobs.status, "assets_ready");
  const rows = await d
    .select()
    .from(reelJobs)
    .where(where)
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
      // Observed Visual Bible (milestone 5): continuity facts from the ACTUAL
      // rendered pixels, persisted onto the payload so future campaign briefs
      // can inherit forbiddenChanges/identity facts (the identity-drift
      // killer). Same flag + best-effort posture as QA — never fails the job.
      try {
        const path = await import("path");
        const fsp = await import("fs/promises");
        const os = await import("os");
        const { spawn } = await import("child_process");
        const mp4Path = mp4Url.startsWith("/") || /^[A-Za-z]:/.test(mp4Url)
          ? mp4Url
          : path.join(process.cwd(), "data", mp4Url.replace(/^https?:\/\/[^/]+\//, ""));
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "bible-"));
        const frames: string[] = [];
        for (let i = 0; i < 6; i++) {
          const t = (i * (Math.max(durationSec - 1, 6) / 5) + 0.5).toFixed(2);
          const p = path.join(dir, `f${i}.jpg`);
          await new Promise<void>((resolve) => {
            const bin = process.env.FFMPEG_PATH || "ffmpeg";
            const c = spawn(bin, ["-y", "-v", "error", "-ss", t, "-i", mp4Path, "-frames:v", "1", "-vf", "scale=540:960", "-q:v", "5", p], { shell: process.platform === "win32" && !process.env.FFMPEG_PATH });
            c.on("close", () => resolve());
            c.on("error", () => resolve());
          });
          frames.push(p);
        }
        const { observeVisualBible } = await import("./visualBibleObserved");
        const bible = await observeVisualBible(job.id, frames, brief.voiceoverScript?.slice(0, 300));
        if (bible) {
          const freshRes = await d.select({ payload: reelJobs.payload }).from(reelJobs).where(eq(reelJobs.id, job.id)).limit(1);
          const fresh = JSON.parse(freshRes[0]?.payload ?? "{}");
          fresh.observedVisualBible = bible;
          await d.update(reelJobs).set({ payload: JSON.stringify(fresh) }).where(eq(reelJobs.id, job.id));
          log.info("observed visual bible persisted", { jobId: job.id, defects: bible.visibleDefects.length, drift: bible.identityDriftAcrossFrames.length });
        }
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      } catch (e) {
        log.warn("observed-bible hook failed (job remains assembled)", { jobId: job.id, e: e instanceof Error ? e.message : String(e) });
      }
    }

    if (job.briefId && job.briefId !== "unknown") {
      // Update-then-insert via the shared link-healer. The bare UPDATE here
      // matched ZERO rows for canary/autopost briefIds (no inventory row
      // exists for them) and nothing checked — three assembled reels sat
      // stranded with the Action Center's Publish button pointing at an
      // empty gate (verified live 2026-07-25).
      const { ensureReelDraftForJob } = await import("./reelInventoryLink");
      const linkOutcome = await ensureReelDraftForJob(d, { briefId: job.briefId, mp4Url, brief });
      if (linkOutcome === "created") {
        log.info("reel draft CREATED for gate (briefId had no inventory row)", { jobId: job.id, briefId: job.briefId });
      }
    }

    log.info("reel job assembled", { jobId: job.id, mp4Url, durationSec });
    return { processed: true, jobId: job.id, status: "assembled" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Retry assembly (back to assets_ready, NOT queued — clips are already gen'd).
    const nextStatus = attempt >= MAX_ATTEMPTS ? "failed" : "assets_ready";
    await d.update(reelJobs).set({ status: nextStatus, error: msg.slice(0, 1000) }).where(eq(reelJobs.id, job.id));
    if (nextStatus === "failed") await releaseFailedJobReservation(job.payload, job.id);
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
  // Read write-results through the canonical helper. Drizzle's mysql2 driver
  // resolves .update() to [ResultSetHeader, FieldPacket[]], so reading
  // .affectedRows straight off the result yields undefined -> 0 -> the
  // publish_ambiguous alarm and the recovered counter were both dead.
  const { affectedRowCount } = await import("../lib/db-affected");

  const cutoff = new Date(Date.now() - STUCK_JOB_MS);
  const stuck = await d
    .select()
    .from(reelJobs)
    .where(and(inArray(reelJobs.status, ["generating", "assembling", "repair_rendering", "publishing"]), lt(reelJobs.updatedAt, cutoff)));

  let recovered = 0;
  for (const job of stuck) {
    const attempts = job.attempts ?? 0;
    // A stuck "publishing" claim is AMBIGUOUS: the Meta call may have succeeded
    // before the process died, so re-queueing it could double-post a live reel.
    // Park it for operator reconciliation instead of auto-retrying (audit: a
    // thrown publish left the job wedged and nothing swept it).
    if (job.status === "publishing") {
      const res = await d
        .update(reelJobs)
        .set({ status: "publish_ambiguous", error: `publish claim stuck >${Math.round(STUCK_JOB_MS / 60_000)}m — reconcile with Meta before any retry (the post may be LIVE)` })
        .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "publishing")));
      const moved = affectedRowCount(res);
      if (moved === 1) {
        recovered++;
        log.error("stuck PUBLISHING claim parked as publish_ambiguous — verify on Instagram before retrying", { jobId: job.id });
      }
      continue;
    }
    const requeue = job.status === "assembling" ? "assets_ready" : job.status === "repair_rendering" ? "repair_queued" : "queued";
    const nextStatus = attempts >= MAX_ATTEMPTS ? "failed" : requeue;
    if (nextStatus === "failed") await releaseFailedJobReservation(job.payload, job.id);
    const res = await d
      .update(reelJobs)
      .set({
        status: nextStatus,
        error: `recovered from stuck '${job.status}' (no progress >${Math.round(STUCK_JOB_MS / 60_000)}m)`,
      })
      .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, job.status)));
    const flipped = affectedRowCount(res);
    if (flipped === 1) {
      recovered++;
      log.warn("recovered stuck reel job", { jobId: job.id, from: job.status, toStatus: nextStatus, attempts });
    }
  }
  return { recovered };
}
