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
import type { ClipProbe } from "../../shared/clipDrift";
import { createLogger } from "../lib/logger";
import type { ReelAssemblyBrief } from "./reelAssembly";
import type { CtaType } from "../../shared/instagramStudio";
import type { ApprovedProductionPackSnapshot, EpisodeContract, EpisodeDeclaration, ProductionSlot } from "../../shared/episodeContract";
import { buildStructuredVideoPrompt } from "../../shared/reelVideoPrompt";
import { queueStateForReelStatus } from "../../shared/reelQueue";

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
export type ReelVideoProvider = "veo" | "higgsfield" | "template_stock" | "self_hosted";

/** What each provider is recorded as in generation_reservations.model. */
const PROVIDER_LEDGER_MODEL: Record<ReelVideoProvider, () => string> = {
  veo: () => process.env.REEL_VEO_MODEL || "veo-3.1-fast-generate-preview",
  higgsfield: () => "seedance1_5",
  template_stock: () => "ffmpeg_local",
  // Provider identity stays "self_hosted"; the open-weight MODEL is a profile
  // beneath it, recorded here so cost-per-reel comparisons can split by model.
  self_hosted: () => `video_forge:${process.env.VIDEO_FORGE_PROFILE || "ltx-2.5-distilled"}`,
};

/**
 * What a provider is recorded as in generation_reservations.model.
 *
 * Exported because selectiveRepair reserves against the SAME ledger for the
 * same kind of work, and used to hardcode "seedance1_5" — so a repair on a
 * template_stock or Veo job filed its spend under Higgsfield's name. One map,
 * one source of truth: adding a provider now cannot leave the repair path
 * mislabelling it.
 */
export function reelLedgerModel(provider: ReelVideoProvider): string {
  return PROVIDER_LEDGER_MODEL[provider]();
}

export async function selectReelVideoProvider(): Promise<ReelVideoProvider> {
  const explicit = process.env.REEL_VIDEO_PROVIDER?.toLowerCase();
  // template_stock is EXPLICIT-PIN ONLY and is never auto-selected below. It
  // needs no credentials, so auto-detect would happily prefer it over a funded
  // paid provider and quietly change what the shop publishes. The prod pin
  // (higgsfield, a deliberate cost decision) must also survive this lane.
  // self_hosted (NOUR Video Forge) is EXPLICIT-PIN ONLY during rollout, like
  // template_stock: auto-selecting a lane that has not cleared its benchmark
  // would change what the shop publishes without an operator decision.
  if (explicit === "veo" || explicit === "higgsfield" || explicit === "template_stock" || explicit === "self_hosted") {
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
 * Route a TERMINAL paid-provider failure to `needs_regen` instead of the
 * (now-removed) silent template-stock rescue.
 *
 * 2026-08-20 · Higgsfield stock-fallback remediation. `shouldDegradeToFreeLane`
 * lived here and, when armed, substituted free template-stock footage and
 * published it — the silent fallback this remediation kills (operator
 * decision: silence over stock, reversing the 2026-08-03 "degrade beats going
 * dark" tradeoff). A terminal failure of a PAID provider (veo/higgsfield) now
 * yields `needs_regen`: a distinct, non-publishable state the admin surfaces
 * and the remediation regenerates. template_stock has nowhere lower to fall,
 * so it keeps its own terminal status. Pure + synchronous so it is unit-
 * testable without mocking the whole pipeline.
 */
export function terminalPaidFailureIsNeedsRegen(
  terminal: boolean,
  activeProvider: ReelVideoProvider | undefined,
): boolean {
  return terminal && activeProvider !== undefined && activeProvider !== "template_stock";
}

/**
 * Terminal generation statuses a caller polling processNextReelJob for ONE
 * job (scopeJobId) must stop retrying on — the job will never become
 * assets_ready and every further attempt just burns a wasted poll.
 *
 * 2026-08-20 · Higgsfield stock-fallback remediation, Phase 2. Before
 * needs_regen existed, "failed" was the only terminal generation status and
 * server/routers/content.ts's admin-triggered generation loop hardcoded a
 * check for exactly that string. Adding needs_regen without updating that
 * caller left it unrecognized: the loop matched neither the success nor the
 * (then-only) terminal branch, looped with no sleep and no break, then
 * burned its remaining attempts on 2s no-op sleeps once the job left
 * "queued" — surfacing a blank "Reel clip generation failed or timed out: "
 * error with the real reason silently lost. A shared constant is what
 * prevents that class of miss recurring the next time a status is added —
 * grep this repo-wide, not the literal string "failed", when adding one.
 */
export const REEL_GENERATION_TERMINAL_STATUSES: ReadonlySet<string> = new Set(["failed", "needs_regen"]);

/**
 * Presence, NOT liveness — the same contract veoCredentialsPresent documents for
 * itself. A stored-but-expired Higgsfield session reads as present here.
 */
export async function reelProviderCredentialsPresent(provider: ReelVideoProvider): Promise<boolean> {
  // The local lane renders with ffmpeg and has no credentials to be missing, so
  // it is always "present" — otherwise pinning it would log the no-credentials
  // warning on every selection for a provider that is working correctly.
  if (provider === "template_stock") return true;
  if (provider === "self_hosted") {
    const { videoForgeConfigured } = await import("./videoForgeClient");
    return videoForgeConfigured();
  }
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
  approvedPackSlug?: string;
  approvedProductionPack?: ApprovedProductionPackSnapshot;
  productionSlot?: ProductionSlot;
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
    /**
     * `motion` and `audioCue` were IN the persisted payload all along and
     * simply undeclared here, so nothing could read them and the video
     * model only ever saw `visual`. Verified against prod 2026-08-29: jobs
     * 1770003/4/5 all carry `motion`, two carry `audioCue`. The whole brief
     * is JSON.stringify'd at enqueue and a TS type does not strip fields at
     * runtime, so declaring them IS the fix - no migration. Optional
     * because 1770004 has `motion` but no `audioCue`.
     */
    motion?: string;
    audioCue?: string;
    /** Higgsfield API request already submitted; resume polling, never resubmit. */
    higgsfieldRequestId?: string;
    /** Video Forge idempotency key, persisted BEFORE submit (Forge dedupes on it). */
    selfHostedIdempotencyKey?: string;
    /** Video Forge job id — resume polling, never resubmit. */
    selfHostedJobId?: string;
    /** Profile the in-flight job was submitted with; a resume must not switch models. */
    selfHostedProfile?: string;
    /**
     * APPEND-ONLY history of every provider operation this beat ever submitted.
     *
     * `higgsfieldRequestId` and `veoOperationName` above are ACTIVE handles:
     * their presence means "a request is outstanding, reconcile it rather than
     * buying a duplicate", and they are deleted the moment the beat resolves.
     * That is correct for resume semantics and fatal for accounting — the
     * identifier for work we PAID FOR was destroyed on the happy path (:898)
     * and on terminal remote failure (:860), so there was no way to ask "for
     * job N, what did we pay for, and might any of it still be live remotely".
     *
     * A recovery ledger cannot be reconstructed from rows that were deleted, so
     * the handle is copied here BEFORE the active one is cleared. This changes
     * no resume behaviour: nothing reads `providerOps` to decide whether to
     * resubmit, and the active-handle fields are unchanged.
     */
    providerOps?: Array<{
      provider: "higgsfield" | "veo" | "self_hosted";
      /** The provider's own operation/request id — the paid handle. */
      opId: string;
      /** ISO timestamp of when this outcome was recorded. */
      at: string;
      outcome: "succeeded" | "failed" | "abandoned";
      /** self_hosted only: measured GPU seconds, model version, output hash. */
      receipt?: import("./videoForgeClient").SelfHostedReceipt;
    }>;
  }>;
  promptPack?: Array<{ beatNumber: number; prompt: string; negativePrompt?: string }>;
  higgsfieldPromptPack?: Array<{ beatNumber: number; prompt: string; negativePrompt?: string }>;
  voiceoverScript?: string;
  /** campaign lineage — the creative_genomes row this brief descends from */
  genomeId?: string | null;
  /** durable parent for the whole make→publish journey; optional for legacy callers */
  contentRunId?: string | null;
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
 * The 0113 columns are intentionally required by the durable enqueue path. A
 * missing operator-applied migration must stop before reservations or paid
 * work, rather than silently creating a legacy row that has no identity.
 */
/**
 * Copy a provider handle into the beat's append-only history before the active
 * handle is cleared.
 *
 * Call this immediately BEFORE `delete beat.higgsfieldRequestId` (or the veo
 * equivalent). The active field means "outstanding, reconcile me"; this one
 * means "we submitted this, and here is how it ended". Losing the second is how
 * a paid request became unaccountable.
 *
 * Deliberately tolerant: a malformed or missing id is skipped rather than
 * throwing, because this is bookkeeping on the generation path and must never
 * be the reason a clip fails. Bounded at 50 entries per beat so a pathological
 * retry loop cannot grow `payload` (MEDIUMTEXT) without limit.
 */
function recordProviderOp(
  beat: { providerOps?: Array<{ provider: "higgsfield" | "veo" | "self_hosted"; opId: string; at: string; outcome: "succeeded" | "failed" | "abandoned" }> },
  provider: "higgsfield" | "veo",
  opId: string | undefined | null,
  outcome: "succeeded" | "failed" | "abandoned",
): void {
  if (typeof opId !== "string" || !opId.trim()) return;
  if (!Array.isArray(beat.providerOps)) beat.providerOps = [];
  if (beat.providerOps.length >= 50) return;
  beat.providerOps.push({ provider, opId, at: new Date().toISOString(), outcome });
}

async function assertEpisodeQueueSchemaReady(d: any): Promise<void> {
  if (typeof d.execute !== "function") {
    throw new Error("REEL_EPISODE_SCHEMA_NOT_APPLIED: database adapter cannot verify migration 0113; enqueue fail closed");
  }
  try {
    const { sql } = await import("drizzle-orm");
    const result = await d.execute(sql`
      SELECT COLUMN_NAME AS column_name
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'reel_jobs'
        AND COLUMN_NAME IN ('episode_id', 'episode_version', 'idempotency_key', 'queue_state', 'production_slot', 'production_ready_at', 'publication_scheduled_at')
    `);
    const rows = Array.isArray(result) ? result[0] : result;
    const names = new Set((Array.isArray(rows) ? rows : []).map((row: any) => String(row.column_name ?? row.COLUMN_NAME ?? "")));
    const required = ["episode_id", "episode_version", "idempotency_key", "queue_state", "production_slot", "production_ready_at", "publication_scheduled_at"];
    const missing = required.filter((name) => !names.has(name));
    if (missing.length) throw new Error(`missing columns: ${missing.join(", ")}`);

    const indexResult = await d.execute(sql`
      SELECT INDEX_NAME AS index_name
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'reel_jobs'
        AND INDEX_NAME IN ('uniq_reel_jobs_episode_version', 'uniq_reel_jobs_idempotency')
    `);
    const indexRows = Array.isArray(indexResult) ? indexResult[0] : indexResult;
    const indexes = new Set((Array.isArray(indexRows) ? indexRows : []).map((row: any) => String(row.index_name ?? row.INDEX_NAME ?? "")));
    const missingIndexes = ["uniq_reel_jobs_episode_version", "uniq_reel_jobs_idempotency"].filter((name) => !indexes.has(name));
    if (missingIndexes.length) throw new Error(`missing uniqueness indexes: ${missingIndexes.join(", ")}`);
  } catch (err) {
    throw new Error(`REEL_EPISODE_SCHEMA_NOT_APPLIED: apply drizzle/0113_reel_episode_contract_queue.sql before enqueue; enqueue fail closed (${err instanceof Error ? err.message : String(err)})`);
  }
}

async function findReelJobByIdempotency(d: any, reelJobs: any, idempotencyKey: string): Promise<any | null> {
  const query = d.select().from(reelJobs).where((await import("drizzle-orm")).eq(reelJobs.idempotencyKey, idempotencyKey));
  const rows = typeof query.limit === "function" ? await query.limit(1) : await query;
  return rows[0]?.id != null ? rows[0] : null;
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
/**
 * Preflight refused this brief BEFORE any spend or persistence.
 *
 * Typed rather than a bare Error because a caller has to be able to tell this
 * apart from a provider outage or a DB fault: this one is a verdict about the
 * CONTENT and retrying it unchanged can never succeed, while the others are
 * transient and must stay loud. `dailyReelPost` relies on that distinction to
 * advance the pack rotation instead of retrying the same pack forever — see
 * the deadlock note there.
 */
export class ReelPreflightBlockedError extends Error {
  constructor(public readonly blocking: string[]) {
    super(`Reel preflight blocked (${blocking.length}): ${blocking.join("; ")}`);
    this.name = "ReelPreflightBlockedError";
  }
}

export async function enqueueReelJob(
  brief: ReelJobBrief,
  source: "admin" | "cron",
  episode: EpisodeDeclaration,
): Promise<{ jobId: number }> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) throw new Error("DB not available");
  const { reelJobs } = await import("../../drizzle/schema");
  await assertEpisodeQueueSchemaReady(d);

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
    const raw = brief.hashtags ?? [];

    // DEDUPE BEFORE CAPPING, case-insensitively.
    //
    // The cap alone let a duplicated set through intact: reel 1320001 published
    // #TireSafety #RoadTripReady #ClevelandAuto #EuclidOH twice each — eight
    // tags, over the cap, and only four distinct ideas. Slicing to five would
    // have kept #TireSafety twice and still wasted a slot. A repeated tag adds
    // no reach and reads as sloppy on a business account, so the duplicate is
    // the thing to remove first; the cap then applies to real tags only.
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const t of raw) {
      const key = String(t).trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(t);
    }
    if (unique.length !== raw.length) {
      log.warn("duplicate hashtags removed", {
        briefId: brief.id, had: raw.length, distinct: unique.length,
      });
    }
    if (unique.length > HASHTAG_CAP) {
      log.warn("hashtags over the platform cap — trimming", {
        briefId: brief.id, had: unique.length, cap: HASHTAG_CAP, dropped: unique.slice(HASHTAG_CAP),
      });
    }
    brief.hashtags = unique.slice(0, HASHTAG_CAP);
  }

  // CONDEMNED-SCRIPT CHECK — here because this is BEFORE the spend boundary.
  //
  // The claim audit's veto is keyed by job id, so a condemned script escapes it
  // simply by being regenerated into a new row. That is not hypothetical: on
  // 2026-08-30, jobs 1830001-1830003 were created as replacements for three
  // condemned jobs and reproduced their scripts VERBATIM (voiceover and
  // on-screen similarity 1.00, measured against production payloads
  // 2026-09-07). Two of the three carried the false claims that condemned their
  // antecedents — including "In Ohio, it's an automatic fail for your E-Check",
  // which is false in 81 of Ohio's 88 counties.
  //
  // Blocking at the publish door alone would be too late in the only sense that
  // costs money: the clips would already have been generated and paid for. A
  // condemned script must never reach the renderer.
  {
    const { condemnedContentProblem } = await import("../../shared/reelClaimAudit");
    const condemned = condemnedContentProblem({
      voiceover: brief.voiceoverScript,
      onScreenText: (brief.storyboardBeats ?? []).map((b) => b?.onScreenText ?? "").filter(Boolean).join(" "),
    });
    if (condemned) {
      log.error("condemned script BLOCKED at enqueue — no clips generated, no spend reserved", {
        briefId: brief.id, source, reason: condemned,
      });
      throw new Error(`REEL_SCRIPT_CONDEMNED: ${condemned}`);
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

  const episodeContract = (brief as { episodeContract?: EpisodeContract }).episodeContract;
  const idempotencyKey = episodeContract?.publication.idempotencyKey;
  if (!episodeContract || !idempotencyKey) {
    throw new Error("REEL_EPISODE_CONTRACT_INVALID: enqueue requires a durable Episode Contract identity");
  }
  // Avoid reserving a content slot or generation budget for a row that already
  // exists. The unique index below remains the race-safe authority when two
  // workers pass this read concurrently.
  const existingBeforeReservation = await findReelJobByIdempotency(d, reelJobs, idempotencyKey);
  if (existingBeforeReservation) {
    log.info("reel enqueue deduplicated by episode idempotency key", {
      jobId: existingBeforeReservation.id,
      idempotencyKey,
    });
    // Repair lineage for legacy/deduped jobs too. This is deliberately
    // best-effort: a missing observability parent must never make an existing
    // durable Reel job fail enqueue.
    try {
      const { ensureContentRunForReelJob } = await import("./contentRun");
      await ensureContentRunForReelJob({
        reelJobId: Number(existingBeforeReservation.id),
        source,
        topic: brief.topic ?? null,
        runId: brief.contentRunId ?? null,
      });
    } catch { /* lineage degraded; durable Reel row remains authoritative */ }
    return { jobId: Number(existingBeforeReservation.id) };
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
      throw new ReelPreflightBlockedError(pre.blocking.map((f) => f.message));
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
    // RESERVE THE SLOT ON THE DAY THE REEL IS MEANT TO PUBLISH, not the day it
    // was enqueued. `publicationIntendedAt` (0118) is the job's DUE-AT; before
    // this, every reservation was dated `now`, so scheduling eight days of
    // reels in one sitting stacked eight same-CTA reservations onto one day
    // and the governor refused the sixth as REPEAT_CTA (2026-09-08, live).
    // The cap, spacing and repeat rules are all evaluated relative to
    // windowStart, so a dated window makes them apply to the right day. A job
    // with no intent behaves exactly as before.
    const windowStart =
      episode.publicationIntendedAt instanceof Date && !Number.isNaN(episode.publicationIntendedAt.getTime())
        ? new Date(Math.max(episode.publicationIntendedAt.getTime(), now.getTime()))
        : now;
    const reservation = await requestReservation({
      platform: "instagram",
      format: "reel",
      windowStart,
      windowEnd: new Date(windowStart.getTime() + 24 * 3600_000),
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
      episodeId: episodeContract.episodeId,
      episodeVersion: episodeContract.schemaVersion,
      idempotencyKey,
      queueState: queueStateForReelStatus("queued"),
      productionSlot: episodeContract.productionSlot,
      // DUE-AT, stamped at enqueue. Migration 0118 added this column and
      // `reelRecoveryLedger` reads it, but nothing in the repo ever WROTE one -
      // so every job's intent was null and "was this late?" had nothing to
      // compare against. It is deliberately NOT `publicationScheduledAt`, which
      // is stamped at the publish CAS and means "publish STARTED".
      //
      // Null is a legitimate value and is left alone: a caller that supplies no
      // intent (admin one-off, canary, backfill) gets an unscheduled job rather
      // than a fabricated deadline.
      ...(episode.publicationIntendedAt ? { publicationIntendedAt: episode.publicationIntendedAt } : {}),
      caption,
      source,
    });
  } catch (insertErr) {
    // A concurrent enqueue may have won the unique index between the
    // pre-check and insert. Return its durable row, but release this caller's
    // reservation so the losing attempt does not consume queue capacity.
    try {
      const existingAfterRace = await findReelJobByIdempotency(d, reelJobs, idempotencyKey);
      if (existingAfterRace) {
        const resId = (brief as { contentReservationId?: string }).contentReservationId;
        if (resId) {
          const { releaseReservation } = await import("./contentGovernor");
          await releaseReservation(resId);
        }
        log.info("reel enqueue race resolved by durable idempotency key", {
          jobId: existingAfterRace.id,
          idempotencyKey,
        });
        return { jobId: Number(existingAfterRace.id) };
      }
    } catch { /* preserve the original insert error */ }
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

  // Universal lineage: every durable Reel job gets the same content_run parent
  // the static Studio path already uses. This is OBSERVABILITY, not a gate —
  // failure here stays loud but cannot invalidate a job that already exists.
  if (jobId > 0) {
    try {
      const { ensureContentRunForReelJob } = await import("./contentRun");
      const runId = await ensureContentRunForReelJob({
        reelJobId: jobId,
        source,
        topic: brief.topic ?? null,
        runId: brief.contentRunId ?? null,
      });
      if (runId && brief.contentRunId !== runId) {
        brief.contentRunId = runId;
        const { eq } = await import("drizzle-orm");
        await d.update(reelJobs).set({ payload: JSON.stringify(brief) }).where(eq(reelJobs.id, jobId));
      }
    } catch (err) {
      log.warn("reel job queued but content-run lineage could not be persisted", {
        jobId,
        err: err instanceof Error ? err.message.slice(0, 180) : String(err),
      });
    }
  }

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
    // briefId is the key generation resolves its arm on (dailyReelPost
    // hookArmForEpisode, reelBriefGen durationLaneForEpisode) — recording
    // under any other key records an arm that was never generated.
    await assignEpisodeToActiveExperiment(jobId, { contentOrigin: "ai_generated", briefId: brief.id });
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

  // 2026-08-20 · Higgsfield stock-fallback remediation, Phase 2 preflight.
  // Abort BEFORE claiming a job (and burning an attempt) when the selected
  // provider is Higgsfield and the keepalive already proved the session dead
  // — cheap (reads cron_log, never spawns the CLI) and mirrors the same
  // liveness check the removed inline degrade used to consult. `healthy ===
  // false` ONLY: null means not-knowable (no row / stale verdict) and must
  // never block a working provider on a blind spot.
  const preflightProvider = await selectReelVideoProvider();
  if (preflightProvider === "higgsfield") {
    // THE SESSION CHECK GATES THE SESSION LANE, NOT THE API LANE.
    //
    // Review P1 on #2170, verified: higgsfieldStudio.generateReelClipVideo
    // PREFERS the key-based Cloud API whenever getHiggsfieldApiCredentials()
    // resolves ("PURCHASED, setting the two env vars switches lanes with no
    // caller change"). This preflight ran before that choice and aborted on a
    // dead BROWSER SESSION regardless — so with API credentials configured and
    // the session expired, which is precisely the configuration the API lane
    // exists to rescue, generation still refused to start.
    //
    // That made the documented remedy inert: buying Cloud API credits and
    // setting HIGGSFIELD_API_KEY_ID/_SECRET would not have unblocked a single
    // render while the CLI session stayed dead, and nothing said why.
    //
    // So: skip the session preflight when the API lane is configured, and let
    // generateReelClipVideo pick. A dead session is only disqualifying when the
    // session is the ONLY lane available.
    const { getHiggsfieldApiCredentials } = await import("./higgsfieldApiClient");
    const apiLaneConfigured = Boolean(await getHiggsfieldApiCredentials());
    const { higgsfieldSessionHealth } = await import("./higgsfieldStudio");
    const health = apiLaneConfigured ? { healthy: null as boolean | null, reason: null as string | null, checkedAt: null as Date | null } : await higgsfieldSessionHealth();
    if (apiLaneConfigured) {
      log.info("reel generation preflight: higgsfield API lane configured — CLI session health is not disqualifying", {});
    }
    if (health.healthy === false) {
      log.error("reel generation preflight: higgsfield session is dead — aborting the batch before claiming a job", {
        reason: health.reason,
        checkedAt: health.checkedAt?.toISOString() ?? null,
      });
      return { processed: false, error: `preflight: higgsfield session dead — ${health.reason ?? "no reason recorded"}` };
    }
  }

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
    .set({ status: "generating", queueState: queueStateForReelStatus("generating"), attempts: attempt })
    .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "queued")));
  const affectedRows = (claimRes[0] as unknown as { affectedRows?: number })?.affectedRows ?? 0;
  if (affectedRows !== 1) return { processed: false }; // another worker claimed it

  {
    const { advanceContentRunByReelJobId, RUN_STAGE } = await import("./contentRun");
    await advanceContentRunByReelJobId(job.id, {
      stage: RUN_STAGE.generating,
      evidence: { at: new Date().toISOString(), what: "Reel generation claimed" },
    });
  }

  // Hoisted above the try so the outer catch (job-level terminal-failure
  // fallback, below) knows which provider was actually in flight — without
  // this a job that had ALREADY flipped higgsfield->template_stock inline
  // and then failed AGAIN would be misread as "a paid provider just failed"
  // and forced into a fallback that does not exist.
  let videoProvider: ReelVideoProvider | undefined;
  let activeProvider: ReelVideoProvider | undefined;

  try {
    const brief = JSON.parse(job.payload) as ReelJobBrief;
    const beats = brief.storyboardBeats ?? [];
    if (!beats.length) throw new Error("brief has no storyboardBeats");

    // THE CONDEMNED-SCRIPT GATE HAS TO RUN HERE TOO, NOT ONLY AT ENQUEUE.
    //
    // enqueueReelJob blocks a condemned script before the spend boundary, which
    // is correct for every job created since that gate shipped. It does nothing
    // for a row that was ALREADY QUEUED when it shipped — and those rows exist.
    //
    // Live example, found 2026-09-09: job 1830003 has sat `queued` since
    // 2026-08-30 carrying the voiceover "In Ohio, it's an automatic fail for
    // your E-Check". That claim is FALSE in 81 of Ohio's 88 counties; it is the
    // exact assertion the 2026-08-29 claim audit condemned, reproduced verbatim
    // under a new job id. The publish door would have refused it — after the
    // clips were rendered and paid for.
    //
    // A queue is not a safe place to store an unenforced decision. Re-check at
    // the moment of spend, where the cost actually is.
    {
      const { condemnedContentProblem } = await import("../../shared/reelClaimAudit");
      const condemned = condemnedContentProblem({
        voiceover: brief.voiceoverScript,
        onScreenText: beats.map((b) => b?.onScreenText ?? "").filter(Boolean).join(" "),
      });
      if (condemned) {
        const { eq } = await import("drizzle-orm");
        await d.update(reelJobs)
          .set({
            status: "failed",
            queueState: queueStateForReelStatus("failed"),
            error: `REEL_SCRIPT_CONDEMNED (blocked at generation, before spend): ${condemned}`.slice(0, 1000),
          })
          .where(eq(reelJobs.id, job.id));
        await releaseFailedJobReservation(job.payload, job.id);
        log.error("condemned script BLOCKED at generation — legacy queued row, no clips generated", {
          jobId: job.id, briefId: job.briefId, reason: condemned,
        });
        return { processed: true, jobId: job.id, status: "failed" };
      }
    }

    const { assertDurableStorageForGeneration, storagePut } = await import("../storage");

    // 2026-08-20 · the forceProvider="template_stock" rescue is GONE (silent
    // stock fallback removed). videoProvider is the selected provider AND the
    // pricing anchor settle() bills against. There is no longer a mid-job
    // provider flip: activeProvider tracks videoProvider for the whole run.
    videoProvider = await selectReelVideoProvider();
    log.info("reel clip generation provider selected", {
      jobId: job.id,
      provider: videoProvider,
    });

    // The provider actually used for the beat being rendered. With the silent
    // degrade removed it never diverges from videoProvider — kept as a
    // separate name only so the settlement/precondition code below reads the
    // same as before. An EXPLICIT template_stock pin (REEL_VIDEO_PROVIDER) is
    // a deliberate operator choice and flows through videoProvider normally.
    activeProvider = videoProvider;

    // Clips this run rendered on the FREE lane. The reservation was priced at
    // enqueue against the SELECTED provider, and the comment on that reserve
    // call already names the hazard: "a mid-flight provider flip can still
    // diverge - settlement is where actuals must be reconciled". Without this
    // counter a degraded reel settles every clip at the paid provider's rate,
    // which is the exact ledger lie the flat-Seedance settle used to tell.
    let freeLaneClips = 0;
    // self_hosted settles at MEASURED compute (receipt gpu_seconds × rate) for
    // clips rendered this run; clips resumed from an earlier run fall back to
    // the profile estimate. Both flagged estimates until a GPU billing feed exists.
    let selfHostedMeasuredUsd = 0;
    let selfHostedMeasuredClips = 0;

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
    if (videoProvider === "veo" || videoProvider === "template_stock" || videoProvider === "self_hosted") {
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
      // An authored pack prompt passes through untouched - it is a human's
      // wording. Only the GENERATED path is restructured. That path used to
      // send `beat.visual` alone while `motion` and `audioCue` sat unread in
      // the same payload; see shared/reelVideoPrompt.ts for the measurement.
      const prompt =
        packEntry?.prompt ??
        buildStructuredVideoPrompt({ visual: beat.visual, motion: beat.motion, audioCue: beat.audioCue });
      const negativePrompt = packEntry?.negativePrompt;
      if (!prompt || !prompt.trim()) throw new Error(`beat ${beat.beatNumber} has no prompt`);

      let finalClipUrl = "";

      if (activeProvider === "template_stock") {
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
        // The hero is NAMED heroFrameUrl and is normally a still, but the field
        // has always been a bare URL and nothing stopped an operator-approved
        // visual world from pointing at footage. Route by extension instead of
        // silently discarding a video (which is what the image-only gate did) —
        // real footage outranks a camera move over a still.
        const heroIsVideo = Boolean(hero && /\.(mp4|mov|webm|m4v)([?#]|$)/i.test(hero));
        const heroIsImage = Boolean(hero && /\.(jpe?g|png|webp)([?#]|$)/i.test(hero));
        finalClipUrl = await withTimeout(
          generateTemplateStockClip({
            beatNumber: beat.beatNumber,
            backgroundVideoUrl: heroIsVideo ? hero : undefined,
            backgroundImageUrl: heroIsImage ? hero : undefined,
          }),
          GEN_CLIP_TIMEOUT_MS,
          `template_stock beat ${beat.beatNumber}`,
        );
        clipUrls[i] = finalClipUrl;
        freeLaneClips += 1;
        await d.update(reelJobs)
          .set({ clipUrlsJson: JSON.stringify(clipUrls), updatedAt: new Date() })
          .where(eq(reelJobs.id, job.id));
        log.info("reel clip rendered (template_stock) and saved progressively", { jobId: job.id, beat: beat.beatNumber, of: beats.length });
        continue;
      }

      if (activeProvider === "higgsfield") {
        // Higgsfield/Seedance is a single blocking call (submit+poll+rehost
        // internally), but the API lane now persists its request ID. Each
        // beat's URL is persisted right after success below, and an ambiguous
        // API timeout resumes the same remote request on the next pulse.
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
        try {
          const { higgsfieldRequestId } = beat;
          if (higgsfieldRequestId) {
            const { pollHiggsfieldRequest, HiggsfieldApiSubmittedError } = await import("./higgsfieldApiClient");
            try {
              finalClipUrl = await withTimeout(
                pollHiggsfieldRequest(higgsfieldRequestId),
                GEN_CLIP_TIMEOUT_MS,
                `higgsfield reconcile beat ${beat.beatNumber}`,
              );
            } catch (reconcileErr) {
              // A terminal remote failure is known-safe to replace. Any other
              // submitted error remains attached so the next pulse reconciles
              // the same paid request rather than buying a duplicate.
              if (reconcileErr instanceof HiggsfieldApiSubmittedError && /generation (failed|cancelled|canceled)/i.test(reconcileErr.message)) {
                // History BEFORE the active handle is cleared: this request was
                // submitted and may have billed, and the ledger needs to know it
                // existed even though it produced nothing.
                recordProviderOp(beat, "higgsfield", beat.higgsfieldRequestId, "failed");
                delete beat.higgsfieldRequestId;
                await d.update(reelJobs).set({ payload: JSON.stringify(brief), updatedAt: new Date() }).where(eq(reelJobs.id, job.id));
              }
              throw reconcileErr;
            }
          } else {
            finalClipUrl = await withTimeout(
              generateReelClipVideo({
                prompt,
                negativePrompt,
                startImageUrl,
                // Keep the provider's own poll deadline inside the worker's
                // deadline, even when an operator configured a longer CLI/API
                // timeout. The callback persists the handle before polling;
                // this margin also makes the submitted-error path observable
                // before the outer timeout can win.
                higgsfieldPollTimeoutMs: Math.max(1, GEN_CLIP_TIMEOUT_MS - 30_000),
                onHiggsfieldRequestSubmitted: async (requestId) => {
                  beat.higgsfieldRequestId = requestId;
                  await d.update(reelJobs).set({ payload: JSON.stringify(brief), updatedAt: new Date() }).where(eq(reelJobs.id, job.id));
                },
              }),
              GEN_CLIP_TIMEOUT_MS,
              `higgsfield beat ${beat.beatNumber}`,
            );
          }
        } catch (genErr) {
          const { HiggsfieldApiSubmittedError } = await import("./higgsfieldApiClient");
          if (genErr instanceof HiggsfieldApiSubmittedError && !/generation (failed|cancelled|canceled)/i.test(genErr.message)) {
            // Persist the remote handle BEFORE the outer retry classifier sees
            // the error. A request that may still bill is never blindly
            // duplicated on the next pulse.
            beat.higgsfieldRequestId = genErr.requestId;
            await d.update(reelJobs).set({ payload: JSON.stringify(brief), updatedAt: new Date() }).where(eq(reelJobs.id, job.id));
          }
          throw genErr;
        }
        clipUrls[i] = finalClipUrl;
        // Same reason as the failure path above — a SUCCEEDED request is the one
        // we definitely paid for, and its id was the field being deleted.
        recordProviderOp(beat, "higgsfield", beat.higgsfieldRequestId, "succeeded");
        delete beat.higgsfieldRequestId;
        await d.update(reelJobs)
          .set({ clipUrlsJson: JSON.stringify(clipUrls), payload: JSON.stringify(brief), updatedAt: new Date() })
          .where(eq(reelJobs.id, job.id));
        log.info("reel clip generated (higgsfield) and saved progressively", { jobId: job.id, beat: beat.beatNumber, of: beats.length });
        continue;
      }

      if (activeProvider === "self_hosted") {
        // NOUR Video Forge: open-weight model on a GPU we control. Same
        // per-beat contract as the other lanes — one URL, persisted at once —
        // plus the resume rules in videoForgeClient (key persisted before
        // submit, job id after, a local window that RESUMES instead of
        // resubmitting, per-profile hard ceilings).
        const { renderSelfHostedBeat } = await import("./videoForgeClient");
        const hero = brief.visualWorld?.heroFrameUrl;
        // Same gate as the Higgsfield lane: condition on the operator-approved
        // hero frame only when REEL_IMAGE_CONDITIONING is on. The bake-off
        // decides whether it becomes the default.
        const startImageUrl =
          process.env.REEL_IMAGE_CONDITIONING === "true" && hero && /\.(jpe?g|png|webp)([?#]|$)/i.test(hero) ? hero : undefined;
        const persist = async () => {
          await d.update(reelJobs).set({ payload: JSON.stringify(brief), updatedAt: new Date() }).where(eq(reelJobs.id, job.id));
        };
        const { url, receipt } = await renderSelfHostedBeat({
          beat,
          idempotencyBase: `nickstire-reel-${job.id}-b${beat.beatNumber}`,
          prompt,
          negativePrompt,
          startImageUrl,
          persist,
          heartbeat: async () => {
            await d.update(reelJobs).set({ updatedAt: new Date() }).where(eq(reelJobs.id, job.id));
          },
          metadata: { reel_job_id: job.id, beat_number: beat.beatNumber },
        });
        clipUrls[i] = url;
        selfHostedMeasuredUsd += receipt.computeUsd;
        selfHostedMeasuredClips += 1;
        await d.update(reelJobs)
          .set({ clipUrlsJson: JSON.stringify(clipUrls), payload: JSON.stringify(brief), updatedAt: new Date() })
          .where(eq(reelJobs.id, job.id));
        log.info("reel clip generated (self_hosted) and saved progressively", { jobId: job.id, beat: beat.beatNumber, of: beats.length, profile: receipt.profile, gpuSeconds: receipt.gpuSeconds });
        continue;
      }

      // Veo is the LAST branch, and it is reached only by elimination. That was
      // an implicit else for two providers: widening the union does not make
      // this a compile error, so an unhandled provider silently ran Veo and
      // spent real money under another provider's name. Fail loudly instead.
      if (activeProvider !== "veo") {
        throw new Error(
          `unhandled REEL_VIDEO_PROVIDER "${activeProvider}" — add an explicit branch before the Veo path`,
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
          // Abandoned, but it WAS submitted and may have billed. Record it
          // before the handle is dropped, or the resubmit below makes the first
          // op invisible and the job looks like it cost one request when it
          // cost two.
          recordProviderOp(beat, "veo", opName, "abandoned");
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
      recordProviderOp(beat, "veo", opName, "succeeded");

      // Heartbeat: bump updatedAt and progressive clipUrlsJson in the DB immediately after each success
      await d.update(reelJobs)
        .set({ 
          clipUrlsJson: JSON.stringify(clipUrls),
          payload: JSON.stringify(brief),
          updatedAt: new Date() 
        })
        .where(eq(reelJobs.id, job.id));

      log.info("reel clip generated and saved progressively", { jobId: job.id, beat: beat.beatNumber, of: beats.length });
    }

    await d
      .update(reelJobs)
      // reset attempts so the assembly stage gets its own fresh retry budget
      .set({ status: "assets_ready", queueState: queueStateForReelStatus("assets_ready"), clipUrlsJson: JSON.stringify(clipUrls), error: null, attempts: 0, productionReadyAt: new Date() })
      .where(eq(reelJobs.id, job.id));
    // Provider spend is complete at this point — settle the reservation with
    // clips × per-clip estimate (flagged estimate; no USD feed from the CLI).
    try {
      const { settle, reelClipCostUsd } = await import("./generationLedger");
      // videoProvider is the provider this run actually used, resolved above —
      // settling at a flat Seedance rate is what made a mid-flight provider flip
      // undetectable in the ledger, and would settle a free local reel as if it
      // had spent Seedance money.
      // Split the bill by the lane that actually rendered each clip. Clips the
      // free lane produced cost nothing; everything else (including clips
      // resumed from an earlier run) is priced at the selected provider's rate.
      // When no flip happened freeLaneClips is 0 and this is the original
      // expression unchanged.
      const paidClips = Math.max(0, clipUrls.length - freeLaneClips);
      const settledUsd =
        videoProvider === "self_hosted"
          ? selfHostedMeasuredUsd + Math.max(0, paidClips - selfHostedMeasuredClips) * reelClipCostUsd("self_hosted")
          : paidClips * reelClipCostUsd(videoProvider) + freeLaneClips * reelClipCostUsd("template_stock");
      await settle(`reel_job_${job.id}`, settledUsd);
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
    let freshPayload: string | undefined;
    try {
      const [fresh] = await d
        .select({ payload: reelJobs.payload })
        .from(reelJobs)
        .where(eq(reelJobs.id, job.id))
        .limit(1);
      freshPayload = fresh?.payload;
      const parsed = JSON.parse(fresh?.payload ?? "{}") as { storyboardBeats?: Array<{ veoOperationName?: string; higgsfieldRequestId?: string; selfHostedJobId?: string; selfHostedIdempotencyKey?: string }> };
      // A persisted Video Forge KEY counts as a handle too: Forge dedupes on
      // it, so "submit sent, response lost" is resumable, not ambiguous.
      hasRemoteOperationId = (parsed.storyboardBeats ?? []).some(
        (b) => (typeof b?.veoOperationName === "string" && b.veoOperationName.length > 0) ||
          (typeof b?.higgsfieldRequestId === "string" && b.higgsfieldRequestId.length > 0) ||
          (typeof b?.selfHostedJobId === "string" && b.selfHostedJobId.length > 0) ||
          (typeof b?.selfHostedIdempotencyKey === "string" && b.selfHostedIdempotencyKey.length > 0),
      );
    } catch { /* unreadable payload — treat as no handle, i.e. the cautious branch */ }

    const verdict = classifyProviderError(err, {
      isLocalTimeout: isLocalTimeout(err),
      hasRemoteOperationId,
    });
    const decided = nextStatusFor(verdict, attempt, MAX_ATTEMPTS, "queued");
    let nextStatus = decided.status;
    let nextAttempts = decided.attempts;
    // 2026-08-20 · Higgsfield stock-fallback remediation · the silent stock
    // fallback is DEAD (operator decision: silence over stock). A paid
    // provider (veo OR higgsfield) that exhausted every retry used to be
    // RESCUED here onto the free template-stock lane and published anyway —
    // the exact silent substitution this remediation kills (7 stock reels
    // reached Instagram that way). Now a terminal paid failure is routed to
    // `needs_regen`: non-publishable, operator-actionable, surfaced on the
    // admin, and left for real regeneration. template_stock failing has
    // nowhere lower to fall, so it keeps its own terminal status.
    const routedToNeedsRegen = terminalPaidFailureIsNeedsRegen(decided.terminal, activeProvider);
    if (routedToNeedsRegen) nextStatus = "needs_regen";

    await d
      .update(reelJobs)
      .set({
        status: nextStatus,
        queueState: queueStateForReelStatus(nextStatus),
        attempts: nextAttempts,
        error: stampError(verdict, msg).slice(0, 1000),
      })
      .where(eq(reelJobs.id, job.id));

    if (routedToNeedsRegen) {
      // The shop is NOT publishing this reel — the paid provider is down and
      // the silent stock fallback is gone. The operator must know the same
      // day (the 2026-08-03/08-07 lesson: a cron_log "timeout" line reaches
      // no one). Best-effort: a dead Telegram must never take the job down.
      void import("./telegram")
        .then(({ sendTelegram }) =>
          sendTelegram(
            [
              `REEL PROVIDER DOWN — reel NOT published (no stock fallback).`,
              `Job ${job.id} marked needs_regen. Provider: ${activeProvider}. Verdict: ${verdict.errorClass} (${verdict.action}).`,
              `Fix the provider (Higgsfield session runbook), then regenerate — nothing posts until real footage renders.`,
            ].join("\n"),
          ),
        )
        .catch(() => undefined);
      log.error("paid reel provider exhausted its retries - marked needs_regen (silent stock fallback removed)", {
        jobId: job.id,
        provider: activeProvider,
        errorClass: verdict.errorClass,
      });
    }

    log.warn("reel job failure classified", {
      jobId: job.id,
      errorClass: verdict.errorClass,
      action: verdict.action,
      mayDoubleSpend: verdict.mayDoubleSpend,
      attempt,
      nextStatus,
      needsRegen: routedToNeedsRegen,
    });
    if (nextStatus === "failed" || nextStatus === "needs_regen") {
      {
        const { advanceContentRunByReelJobId, RUN_STAGE, IMPLEMENTATION_STATE } = await import("./contentRun");
        await advanceContentRunByReelJobId(job.id, {
          stage: nextStatus === "needs_regen" ? RUN_STAGE.held : RUN_STAGE.failed,
          implementationState: IMPLEMENTATION_STATE.failed,
          failureReason: msg.slice(0, 1000),
          evidence: {
            at: new Date().toISOString(),
            what: nextStatus === "needs_regen" ? "Reel generation requires regeneration" : "Reel generation failed",
          },
        });
      }
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
    .set({ status: "assembling", queueState: queueStateForReelStatus("assembling"), attempts: attempt })
    .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "assets_ready")));
  const affectedRows = (claimRes[0] as unknown as { affectedRows?: number })?.affectedRows ?? 0;
  if (affectedRows !== 1) return { processed: false }; // another worker claimed it

  {
    const { advanceContentRunByReelJobId, RUN_STAGE } = await import("./contentRun");
    await advanceContentRunByReelJobId(job.id, {
      stage: RUN_STAGE.assembling,
      evidence: { at: new Date().toISOString(), what: "Reel assembly claimed" },
    });
  }

  try {
    // The stored payload is the full client ReelBrief (storyboardBeats carry
    // startSecond/endSecond) — richer than the gen stage's minimal ReelJobBrief.
    const brief = JSON.parse(job.payload) as ReelAssemblyBrief;
    const clipUrls = JSON.parse(job.clipUrlsJson ?? "[]") as string[];
    if (!Array.isArray(clipUrls) || !clipUrls.length) throw new Error("no clipUrls on assets_ready job");

    // ── Durable storage is a precondition for ASSEMBLY, not just generation ──
    //
    // 2026-09-07. The generation stage asserts this at :750, but Higgsfield jobs
    // skip that assert entirely (:749 — it returns its own CDN URL, so there is
    // nothing of ours to lose yet). Assembly is where OUR artifact is created,
    // and it had no precondition at all: `assembleReel` calls `storagePut`, and
    // with S3_BUCKET unset storage.ts falls through to a 24h PRESIGNED url over
    // `data/generated/` on the container's ephemeral disk. A redeploy takes the
    // master with it.
    //
    // That is not hypothetical. reelRecoverability.ts records it measured:
    // "every one of those jobs' mp4Url returns 404 ... a restart takes the
    // master with it." The publish door then refuses the presigned URL
    // (socialPublish.assertPermanentPublicMediaUrl), so the reel is not
    // published either — the work is spent, the approval is spent, and the
    // artifact is gone.
    //
    // Verified against production 2026-09-07: S3_BUCKET and S3_ENDPOINT are
    // both set, so this assert is a NO-OP in prod today and exists to stop the
    // configuration regressing silently. Failing here — before ffmpeg, before
    // the DB write — is the cheapest possible place to find out.
    const { assertDurableStorageForGeneration } = await import("../storage");
    assertDurableStorageForGeneration(`reel job ${job.id} assembly`);

    const { assembleReel } = await import("./reelAssembly");
    const { mp4Url, durationSec, clipProbes } = await assembleReel(brief, clipUrls, job.id);

    await d.update(reelJobs).set({ status: "assembled", queueState: queueStateForReelStatus("assembled"), mp4Url, error: null, productionReadyAt: new Date() }).where(eq(reelJobs.id, job.id));
    // Provider drift evidence (shared/clipDrift.ts): each clip's probed shape,
    // labelled with the provider that rendered it, merged onto the row's
    // CURRENT payload (assembly itself re-reads and writes audioQa). Best
    // effort — an assembled Reel is never failed over its bookkeeping.
    await persistClipProbes(d, job.id, clipProbes);
    // Rendered creative QA (flag-gated; default OFF so prod behavior is
    // unchanged until the operator arms it). Best-effort: QA never fails an
    // assembled job - its verdict is evidence for the approve gate.
    if (process.env.RENDERED_QA_ENABLED === "true") {
      try {
        const { runRenderedQaOnJob } = await import("./renderedQa");
        // $0 pixel pre-flags always; ≤1 specialist vision lens only behind
        // RENDERED_QA_SPECIALIST (default OFF — the second call is spend).
        await runRenderedQaOnJob(job.id, { pixelStats: true, specialist: process.env.RENDERED_QA_SPECIALIST === "true" });
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

      const { advanceContentRunByReelJobId, RUN_STAGE, IMPLEMENTATION_STATE } = await import("./contentRun");
      await advanceContentRunByReelJobId(job.id, {
        stage: RUN_STAGE.awaiting_approval,
        implementationState: IMPLEMENTATION_STATE.built,
        inventoryId: job.briefId,
        evidence: {
          at: new Date().toISOString(),
          what: "Reel assembled and staged in the canonical review queue",
          proof: mp4Url,
        },
      });
    } else {
      const { advanceContentRunByReelJobId, RUN_STAGE, IMPLEMENTATION_STATE } = await import("./contentRun");
      await advanceContentRunByReelJobId(job.id, {
        stage: RUN_STAGE.held,
        implementationState: IMPLEMENTATION_STATE.built,
        failureReason: "assembled Reel has no publish-gate inventory identity",
        evidence: {
          at: new Date().toISOString(),
          what: "Reel assembled but cannot enter the canonical review queue",
          proof: mp4Url,
        },
      });
    }

    log.info("reel job assembled", { jobId: job.id, mp4Url, durationSec });
    return { processed: true, jobId: job.id, status: "assembled" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Retry assembly (back to assets_ready, NOT queued — clips are already gen'd).
    const nextStatus = attempt >= MAX_ATTEMPTS ? "failed" : "assets_ready";
    await d.update(reelJobs).set({ status: nextStatus, queueState: queueStateForReelStatus(nextStatus), error: msg.slice(0, 1000) }).where(eq(reelJobs.id, job.id));
    if (nextStatus === "failed") {
      await releaseFailedJobReservation(job.payload, job.id);
      const { advanceContentRunByReelJobId, RUN_STAGE, IMPLEMENTATION_STATE } = await import("./contentRun");
      await advanceContentRunByReelJobId(job.id, {
        stage: RUN_STAGE.failed,
        implementationState: IMPLEMENTATION_STATE.failed,
        failureReason: msg.slice(0, 1000),
        evidence: { at: new Date().toISOString(), what: "Reel assembly failed after exhausting retries" },
      });
    }
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
/**
 * Maximum times the pipeline will resume the SAME job by itself. A resume is
 * cheap and safe, but a job that keeps timing out is telling us something the
 * cron cannot fix, and an unbounded retry would spend real credits discovering
 * that over and over.
 */
export const MAX_AUTO_RESUMES = 2;

/**
 * PUT A TIMED-OUT JOB BACK IN THE QUEUE INSTEAD OF LEAVING IT DEAD.
 *
 * A provider timeout lands the job in `needs_regen` - terminal, no worker
 * holds it - while the clips it already generated are saved and PAID FOR
 * (the generator writes each beat progressively). Nothing retried those rows,
 * so every timeout was a permanently lost schedule slot until an operator
 * noticed: three slots sat dead from 2026-09-07 to 2026-09-09 holding 8 paid
 * clips between them.
 *
 * The generator already resumes per beat - it skips any beat whose clip entry
 * is already an http url - so a resume is just the row put back in `queued`,
 * and it costs only the beats that are actually missing.
 *
 * REFUSES anything that is not plainly the resume case:
 *   · status is not exactly `needs_regen` (never touch a row a worker holds)
 *   · the job already published
 *   · no beats, or no prompt pack to generate from
 *   · saved clips are not a clean PREFIX of the beats - a gap, or a full set,
 *     is a different problem and a human should see it
 *   · it has already been auto-resumed MAX_AUTO_RESUMES times
 *
 * The write is guarded on id AND status, so a row that changed underneath is
 * left alone. Spend stays bounded by the ordinary generation governor, which
 * runs when the pipeline picks the job up - this function authorizes nothing,
 * it only makes the job eligible again.
 */
export async function resumeTimedOutReelJobs(limit = 5): Promise<{ resumed: number[]; skipped: Array<{ jobId: number; why: string }> }> {
  const out: { resumed: number[]; skipped: Array<{ jobId: number; why: string }> } = { resumed: [], skipped: [] };
  if (process.env.REEL_GENERATION_ENABLED !== "true") return out;

  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return out;

  const { reelJobs } = await import("../../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");
  const { affectedRowCount } = await import("../lib/db-affected");
  const { queueStateForReelStatus } = await import("@shared/reelQueue");

  const rows = await d.select().from(reelJobs).where(eq(reelJobs.status, "needs_regen")).limit(limit);

  for (const job of rows) {
    if (job.igPostId) { out.skipped.push({ jobId: job.id, why: "already_published" }); continue; }

    let payload: Record<string, any> = {};
    try { payload = JSON.parse(job.payload ?? "{}"); } catch {
      out.skipped.push({ jobId: job.id, why: "payload_unparseable" });
      continue;
    }
    const beats = (payload.storyboardBeats ?? []).length;
    const pack = (payload.promptPack ?? payload.higgsfieldPromptPack ?? []).length;
    if (!beats) { out.skipped.push({ jobId: job.id, why: "no_beats" }); continue; }
    if (!pack) { out.skipped.push({ jobId: job.id, why: "no_prompt_pack" }); continue; }

    // NEVER RESUME A JOB WHOSE REMOTE STATE IS UNKNOWN.
    //
    // Defect in this function as first shipped (2026-09-09), found by audit the
    // same day: it read status, igPostId, payload and clips — and never the
    // stamped error class. shared/providerErrors.ts marks
    // LOCAL_TIMEOUT_REMOTE_UNKNOWN as { action: "RECONCILE_BEFORE_RETRY",
    // mayDoubleSpend: true } precisely because the provider may already have
    // completed and BILLED the beat we are about to buy again. Auto-requeueing
    // it is the single thing that policy table forbids — and it is the exact
    // class the three jobs resumed on 2026-09-09 were carrying.
    //
    // Until a provider-reconciliation lane exists, such a job is QUARANTINED
    // rather than silently re-paid: it stays needs_regen and is reported in
    // `skipped` with its class, so the gap is visible instead of expensive.
    const { parseErrorClass, policyForErrorClass } = await import("../../shared/providerErrors");
    const cls = parseErrorClass(job.error);
    if (cls && policyForErrorClass(cls).mayDoubleSpend) {
      out.skipped.push({ jobId: job.id, why: `reconcile_first:${cls}` });
      continue;
    }

    const autoResumes = Number(payload.autoResumes ?? 0);
    if (autoResumes >= MAX_AUTO_RESUMES) { out.skipped.push({ jobId: job.id, why: "auto_resume_cap" }); continue; }

    let clips: unknown[] = [];
    try { clips = JSON.parse(job.clipUrlsJson ?? "[]"); } catch {
      out.skipped.push({ jobId: job.id, why: "clips_unparseable" });
      continue;
    }
    const saved = clips.filter((u) => typeof u === "string" && (u as string).startsWith("http")).length;
    if (saved !== clips.length) { out.skipped.push({ jobId: job.id, why: "clip_gap" }); continue; }
    if (clips.length >= beats) { out.skipped.push({ jobId: job.id, why: "nothing_missing" }); continue; }

    payload.autoResumes = autoResumes + 1;
    const res = await d
      .update(reelJobs)
      .set({
        status: "queued",
        queueState: queueStateForReelStatus("queued"),
        attempts: 0,
        error: null,
        payload: JSON.stringify(payload),
      })
      .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "needs_regen")));

    if (affectedRowCount(res) === 1) {
      out.resumed.push(job.id);
      log.info("reel job auto-resumed after a provider timeout", {
        jobId: job.id, briefId: job.briefId, clipsKept: saved, beatsMissing: beats - saved, autoResume: autoResumes + 1,
      });
    } else {
      out.skipped.push({ jobId: job.id, why: "row_changed_underneath" });
    }
  }
  return out;
}

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
        .set({ status: "publish_ambiguous", queueState: queueStateForReelStatus("publish_ambiguous"), error: `publish claim stuck >${Math.round(STUCK_JOB_MS / 60_000)}m — reconcile with Meta before any retry (the post may be LIVE)` })
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
        queueState: queueStateForReelStatus(nextStatus),
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

/**
 * Attach each beat's provider (its last succeeded providerOp; "local" for an
 * ffmpeg render with no op) to the probes assembly measured, and write them to
 * the payload as `clipProbes`. reelLaneHealth reads them across the week.
 */
async function persistClipProbes(
  d: NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>,
  jobId: number,
  probes: Array<Omit<ClipProbe, "provider">>,
): Promise<void> {
  if (!probes.length) return;
  try {
    const { reelJobs } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await d.select({ payload: reelJobs.payload }).from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
    if (!row) return;
    const payload = JSON.parse(row.payload ?? "{}") as {
      storyboardBeats?: Array<{ beatNumber: number; providerOps?: Array<{ provider: string; outcome: string }> }>;
      clipProbes?: ClipProbe[];
    };
    const providerOf = (beatNumber: number): string => {
      const ops = payload.storyboardBeats?.find((b) => b.beatNumber === beatNumber)?.providerOps ?? [];
      const last = [...ops].reverse().find((o) => o.outcome === "succeeded");
      return last?.provider ?? "local";
    };
    payload.clipProbes = probes.map((p) => ({ ...p, provider: providerOf(p.beatNumber) }));
    await d.update(reelJobs).set({ payload: JSON.stringify(payload) }).where(eq(reelJobs.id, jobId));
  } catch (e) {
    log.warn("could not persist clip probes (assembly unaffected)", { jobId, e: e instanceof Error ? e.message : String(e) });
  }
}
