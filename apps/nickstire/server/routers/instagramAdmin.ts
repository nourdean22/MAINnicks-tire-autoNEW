/**
 * Instagram Admin Console Router
 *
 * Thin admin-gated tRPC surface over the EXISTING Meta/IG services. It does
 * not reimplement fetching, posting, analytics, or AI generation — it wires
 * the operator UI to engines that already ship but are currently invisible:
 *
 *   - connection/token   → services/metaSocial (getMetaSocialStatus,
 *                            getPersistedTokenMeta, reconnectMetaFromUserToken)
 *   - account + feed      → server/instagram (cache readers) + syncInstagramPosts
 *   - analytics           → pipelines/instagram-data (5 built reports)
 *   - AI co-pilot         → services/igAutopost (runIgAutopostOneOff, eval-gated,
 *                            dry-run/Telegram-preview unless legacy_autopost_live)
 *   - comment moderation  → services/metaSocial (getMediaComments/replyToComment, NEW)
 *
 * Every procedure is adminProcedure (owner-gated). The only live external
 * write reachable here is postReply, which is an explicit per-comment action
 * and is claim-safety-checked before it can touch the Graph API.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, sql, gte, and, eq, isNotNull } from "drizzle-orm";
import { router, adminProcedure, dbAdminProcedure } from "../_core/trpc";
import { checkReviewReply, buildReplyPromptRules, hasBlockingFindings } from "@shared/reviewReplyQa";
import { IG_ARCHETYPES } from "@shared/const";
import { invokeLLM } from "../_core/llm";
import { sanitizeText } from "../sanitize";
import { affectedRowCount } from "../lib/db-affected";
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";
import { durableStorageConfigured, ephemeralStorageOverride, servesPermanentUrls } from "../storage";

const log = createLogger("routers:instagramAdmin");

/** Instagram's caption ceiling. Shared by the publish and schedule paths. */
export const IG_CAPTION_MAX = 2200;

/**
 * Assemble the publishable caption for an approved Reel draft from its brief
 * (selectedCaption + hashtags), falling back to the draft's hook text.
 *
 * Overlength is a hard error, not a trim: this string was hash-approved as part
 * of the brief, and the previous `.slice(0, 2200)` silently cut whatever the
 * limit landed on — hashtags, the CTA, or a mid-sentence break — publishing
 * something nobody reviewed. The operator edits the caption (which re-enters
 * the approval flow) rather than Meta receiving an unreviewed truncation.
 */
export function buildReelPublishCaption(briefJson: string | null, fallbackHook: string | null): string {
  let brief: { selectedCaption?: string; hashtags?: string[] } = {};
  try {
    brief = JSON.parse(briefJson || "{}");
  } catch {
    brief = {};
  }
  if (!brief.selectedCaption) return fallbackHook || "";
  const caption = `${brief.selectedCaption}\n\n${(brief.hashtags ?? []).join(" ")}`.trim();
  if (caption.length > IG_CAPTION_MAX) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Caption with hashtags is ${caption.length} characters — Instagram's limit is ${IG_CAPTION_MAX}. Shorten the caption or drop hashtags; nothing is trimmed automatically.`,
    });
  }
  return caption;
}

/**
 * Inventory -> Queue status mapping (pure; unit-tested). review_ready is the
 * REEL review state (finalizeReelDraft / assembly set it) - before 2026-07-17
 * it fell through unmapped, so the legacy Queue rendered reel drafts with NO
 * Approve button (the button keys on needs_review) and reel 630001 had to be
 * approved via raw tRPC calls.
 */
export function mapInventoryStatusForQueue(status: string): string {
  if (status === "assets_ready") return "ready";
  if (status === "pending") return "needs_review";
  if (status === "approved") return "ready";
  if (status === "generating") return "needs_review";
  if (status === "review_ready") return "needs_review";
  return status;
}

export const instagramAdminRouter = router({
  /** Connection diagnostics: credential/token status + durable-store fingerprint
   *  + a LIVE Graph probe. Presence checks alone showed "ready" with a dead
   *  token (revoked permissions, password reset, unlinked page) — `live` is the
   *  Graph API's own answer, cached 5 minutes so UI polling can't burn quota. */
  getConnectionStatus: dbAdminProcedure.query(async () => {
    const { getMetaSocialStatus, getPersistedTokenMeta, verifyMetaConnectionLive } = await import("../services/metaSocial");
    const [status, token, live] = await Promise.all([
      getMetaSocialStatus(),
      getPersistedTokenMeta(),
      verifyMetaConnectionLive(),
    ]);
    return { ...status, token, live };
  }),

  /** Pipeline Health: Storage, Veo API, Meta API, and failed reel jobs. */
  getPipelineHealth: adminProcedure.query(async () => {
    // verifyMetaConnectionLive comes along because "configured" and "connected"
    // are different questions and this endpoint answers the one the operator
    // reads. It is TTL-cached, so this is not a Graph call per poll.
    const { getMetaSocialStatus, verifyMetaConnectionLive } = await import("../services/metaSocial");
    const meta = await getMetaSocialStatus();

    const database = await db();
    // Counts EXACTLY what the Action Center lists. This used to be every reel job
    // with status "failed" — 61 in prod, most from a leaked API key months ago —
    // while the Action Center showed none of them. Two screens disagreeing by 61
    // is how an operator learns to ignore both.
    let failedJobs: number | null = 0;
    if (database) {
      try {
        const { selectReelJobsNeedingAttention } = await import("../services/reelRecoverability");
        failedJobs = (await selectReelJobsNeedingAttention(database, 200)).length;
      } catch (err) {
        // null = UNKNOWN. Never 0 — "we could not look" must not render as
        // "everything is fine".
        log.warn("could not count reel jobs needing attention", err);
        failedJobs = null;
      }
    } else {
      failedJobs = null;
    }

    return {
      storage: {
        // Was `S3_BUCKET && CLOUDFRONT_DOMAIN` / `!!CLOUDFRONT_DOMAIN`, which
        // INVERTED the truth for the shape production actually runs.
        // storage.ts:40 `usesProxiedReads()` is `S3_ENDPOINT && !CLOUDFRONT_DOMAIN`
        // — CloudFront being ABSENT is the condition under which permanent URLs
        // are served, through {SITE_URL}/generated/{key}. So with S3 set and CF
        // deliberately unset (prod, measured 2026-07-29) this card reported
        // "Missing S3/CF" and "Ephemeral Only" at exactly the moment permanent
        // URLs were working.
        //
        // socialDeliveryIssues.ts already reasoned this out correctly and
        // downgraded its own message to severity "info" with honest wording —
        // but it left the FLAG computed the same wrong way, and this card was
        // never touched. The wording was fixed where someone looked; the
        // definition was not. Both now read the storage module's own authority.
        configured: durableStorageConfigured(),
        permanentUrls: servesPermanentUrls(),
        /**
         * DESCRIPTIVE, not a verdict — which permanent-URL MODE is in use, so a
         * consumer can name it without re-deriving (and re-inverting) the
         * condition. Review of the first fix caught that making `configured`
         * true on S3 alone left Settings.tsx claiming "S3 and CloudFront are
         * configured" while CloudFront is deliberately absent: one false health
         * report swapped for another.
         *
         * false = app-proxied via {SITE_URL}/generated/{key} (the production
         * shape); true = CloudFront CDN in front of the bucket. Both are
         * permanent; only the delivery path differs.
         */
        cdn: !!process.env.CLOUDFRONT_DOMAIN,
        /** Generation proceeds without a durable bucket by explicit opt-in.
         *  Reported so the card can say "running, and losing files" instead
         *  of showing a blocker for a state the operator chose. */
        ephemeralOverride: ephemeralStorageOverride(),
      },
      generator: await (async () => {
        // The background reel pipeline generates video with VEO, not Higgsfield.
        // Reporting Higgsfield-credential presence here was a lie: the card
        // showed green while Veo (the active worker) had no key. Report the
        // ACTIVE provider and ITS credentials. REEL_VIDEO_PROVIDER lets the
        // operator name the provider explicitly; default reflects the code path
        // (reelPipeline.submitVeoRequest → Veo).
        // Use the SAME selector the pipeline uses (explicit env, else auto by
        // credentials) so the card reports the provider that will actually run.
        const { selectReelVideoProvider } = await import("../services/reelPipeline");
        const provider = await selectReelVideoProvider();
        const { veoCredentialsPresent } = await import("../services/veoStudio");
        // LIVENESS, NOT PRESENCE. `!!getHiggsfieldCredentialsJson()` used to decide
        // this, and a revoked refresh token leaves that blob perfectly intact -
        // which is precisely how a dead session read as "configured" for four days
        // (#1628). It mattered little while provider stayed template_stock and
        // would have become a live lie the moment it flipped to higgsfield.
        // `higgsfieldSessionLiveness` reads the keepalive's own recorded verdict:
        // one indexed lookup, no vendor round-trip, three states.
        const { higgsfieldSessionLiveness } = await import("../services/higgsfieldStudio");
        const hfSession = await higgsfieldSessionLiveness();
        const higgsfieldConfigured = hfSession.credsPresent;
        // The lane the video generator will ACTUALLY use, resolved exactly as
        // generateReelClipVideo resolves it: API key first (DB-then-env), CLI
        // session only as the fallback.
        const { getHiggsfieldApiCredentials } = await import("../services/higgsfieldApiClient");
        const higgsfieldApiCreds = provider === "higgsfield" ? await getHiggsfieldApiCredentials() : null;
        // template_stock renders locally with ffmpeg — it has NO credentials to
        // check, so it is always configured. Reporting Veo's key state for it
        // would paint the card red while the lane runs perfectly.
        const configured =
          provider === "template_stock"
            ? true
            : provider === "higgsfield"
              // MIRROR generateReelClipVideo's OWN lane selection (P2 review,
              // #1668): when API-key credentials exist the generator uses the
              // key-based REST lane and never touches the CLI session, so judging
              // readiness by the session verdict would paint a working generator
              // red. Only when the CLI session is the lane that will run does its
              // liveness decide - and `=== true` so UNKNOWN (null) does not read
              // as configured.
              ? higgsfieldApiCreds !== null || hfSession.live === true
              : veoCredentialsPresent();
        return {
          provider,
          configured,
          enabled: process.env.REEL_GENERATION_ENABLED === "true",
          // Kept so the Settings UI can still surface Higgsfield status separately
          // (it's the carousel/image path), without conflating it with the reel
          // video generator's health. This is PRESENCE of the credentials blob -
          // deliberately named as such now that liveness is reported beside it.
          higgsfieldConfigured,
          /**
           * The honest three-state session verdict, plus the ONLY account credit
           * balance this app can read (the API lane has no balance endpoint - every
           * GET on it returns 405). `live: null` means the keepalive verdict is
           * missing or stale, which is UNKNOWN and not dead.
           */
          higgsfieldSession: {
            live: hfSession.live,
            credsPresent: hfSession.credsPresent,
            balanceCredits: hfSession.balanceCredits,
            checkedAt: hfSession.checkedAt,
            reason: hfSession.reason,
          },
          /** Which Higgsfield lane the generator would run: the API key needs no
           *  session, so the session verdict is IRRELEVANT while this is
           *  "api_key". Null when the provider is not higgsfield. */
          higgsfieldLane:
            provider === "higgsfield" ? (higgsfieldApiCreds ? ("api_key" as const) : ("cli_session" as const)) : null,
        };
      })(),
      /**
       * CONFIGURED IS NOT CONNECTED.
       *
       * `connected` here is presence-only: credentials are set and an IG/page id
       * exists. A token that Meta has REVOKED or that has simply expired leaves
       * every one of those facts true — so HQ painted a green dot and the word
       * "Connected" while every publish failed at the Graph call.
       *
       * `verifyMetaConnectionLive` already asks Meta the actual question, and it
       * was already wired into getConnectionStatus — just not into the card the
       * operator looks at. It is cached (LIVE_CACHE_TTL_MS) so this costs a Graph
       * call only once per TTL, not once per health poll.
       *
       * Three states are reported, never two, because "we could not reach Meta to
       * ask" is not the same as "Meta says no" — and neither is "connected".
       */
      meta: await (async () => {
        const configured = meta.configured && (meta.facebookReady || meta.instagramReady);
        if (!configured) return { connected: false, live: false, liveError: "Not configured" };
        try {
          const live = await verifyMetaConnectionLive();
          // "Could not ASK" now arrives as a typed result (live.unknown) rather
          // than a throw — verifyMetaConnectionLive never threw, so the catch
          // below was unreachable and the third state never rendered. A
          // transport blip must not read as a dead token.
          if (live.unknown) {
            return {
              connected: configured,
              live: null as boolean | null,
              liveError: (live.error ?? "Could not reach Meta to verify").slice(0, 200),
            };
          }
          return {
            connected: configured,
            live: live.ok,
            liveError: live.ok ? null : (live.error ?? "Meta rejected the credentials"),
          };
        } catch (err) {
          // Could not ASK. Reporting that as connected would be the original bug
          // wearing a different hat, and reporting it as disconnected would send
          // the operator hunting a token that is probably fine.
          return {
            connected: configured,
            live: null as boolean | null,
            liveError: err instanceof Error ? err.message.slice(0, 200) : "Could not reach Meta to verify",
          };
        }
      })(),
      failedJobs,
    };
  }),

  /**
   * Delivery issues — "created" and "delivering" are different states. Every
   * blocker names the constrained layer and the smallest safe next action;
   * unknown facts arrive as warnings, never as calm. Read-only.
   */
  getDeliveryIssues: adminProcedure.query(async () => {
    const { getDeliveryIssues } = await import("../services/socialDeliveryIssues");
    return getDeliveryIssues();
  }),

  /**
   * Wave A3: 30-day reel pipeline reliability. Read-only, windowed, and
   * spelling-honest — prod carries BOTH "posted" and "published" as success
   * statuses, so success is their sum, never one of them. All-null = the
   * table could not be read (unknown, not healthy).
   */
  getReelReliability: adminProcedure.query(async () => {
    const { getReelReliability } = await import("../services/reelReliability");
    return getReelReliability();
  }),

  /**
   * Attention Microstructure swipe file (ScanFinish NT-012): joins reel_jobs
   * (hook + beat structure) to ig_metric_snapshots (saves/shares/skip rate)
   * and correlates. Same "measure, don't judge" discipline as
   * scripts/analyze-hook-vs-skip.mjs (which this generalizes rather than
   * duplicates) — `sufficient: false` below MIN_GROUP_N is the honest
   * answer, not a failure, and nothing here ever returns HIGH conviction: a
   * correlation graduates to HIGH/OBSERVED only via a deliberate
   * contentExperiments.ts run, never from this alone.
   */
  getSwipeFileCorrelations: adminProcedure
    .input(z.object({ metric: z.enum(["savesPerReach", "sharesPerReach", "skipRate"]).default("savesPerReach") }))
    .query(async ({ input }) => {
      const { getSwipeFileSamples } = await import("../services/attentionMicrostructureStore");
      const { compareAllSignals, swipeFileConviction } = await import("../../shared/attentionMicrostructure");
      const samples = await getSwipeFileSamples();
      const comparisons = compareAllSignals(samples, input.metric).map((c) => ({
        ...c,
        conviction: swipeFileConviction(c),
      }));
      return { sampleCount: samples.length, metric: input.metric, comparisons };
    }),

  /**
   * Editorial control plane for the approved Reel library. The recommended
   * ordering is deliberately a transparent heuristic, never a virality score.
   * Saving a slate resets only the slate's independent cursor atomically;
   * the canonical approved-library cursor is preserved. Production's daily
   * selector reads the same durable overlay.
   */
  getActiveSlate: adminProcedure.query(async () => {
    const database = await db();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — active slate is unknown, not empty." });
    const { buildActiveSlateStrategy } = await import("../services/instagramAdminStrategy");
    return buildActiveSlateStrategy(database);
  }),

  saveActiveSlate: adminProcedure
    .input(z.object({ slugs: z.array(z.string().min(1).max(191)).min(1).max(24) }))
    .mutation(async ({ input, ctx }) => {
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — active slate was not changed." });
      const { writeActiveReelSlate } = await import("../services/approvedReelPackRotation");
      try {
        return await writeActiveReelSlate(database, input.slugs, ctx.user.email ?? String(ctx.user.id));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.startsWith("active Reel slate ")) {
          throw new TRPCError({ code: "BAD_REQUEST", message });
        }
        log.error("active Reel slate write failed", { error: message });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Active Reel slate could not be saved; no success is claimed." });
      }
    }),

  clearActiveSlate: adminProcedure.mutation(async ({ ctx }) => {
    const database = await db();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — active slate was not changed." });
    const { clearActiveReelSlate } = await import("../services/approvedReelPackRotation");
    return clearActiveReelSlate(database, ctx.user.email ?? String(ctx.user.id));
  }),

  /** Correlations promoted only to testable priors — never causal rules. */
  getStructureHypotheses: adminProcedure.query(async () => {
    const { buildStructureHypotheses } = await import("../services/instagramAdminStrategy");
    return buildStructureHypotheses();
  }),

  /** Shadow-judge verdicts joined to downstream Reel outcomes and coverage. */
  getReelJudgeCalibration: adminProcedure.query(async () => {
    const database = await db();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — judge calibration is unknown." });
    const { buildReelJudgeCalibration } = await import("../services/instagramAdminStrategy");
    return buildReelJudgeCalibration(database);
  }),

  /** Measured pin candidates + a visual cover shelf; profile mutations stay manual. */
  getProfileMerchandising: adminProcedure.query(async () => {
    const database = await db();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — profile evidence is unknown." });
    const { buildProfileMerchandising } = await import("../services/instagramAdminStrategy");
    return buildProfileMerchandising(database);
  }),

  /**
   * Multilingual variant worklist (ScanFinish NT-015). NOT an automation —
   * verified before building: Meta's Reels AI translation is a Creator
   * Studio publish-time toggle with no Graph Content-Publishing API field,
   * and YouTube auto-dub is moot (no YouTube channel exists in this repo).
   * Returns which recent top-performing reels are worth the manual few
   * minutes in Creator Studio, reusing the same getTopPosts() recentWinners
   * already reads.
   */
  getMultilingualDubCandidates: adminProcedure.query(async () => {
    const { getMultilingualDubCandidates } = await import("../services/multilingualCandidates");
    const candidates = await getMultilingualDubCandidates();
    return {
      candidates,
      note: "No API triggers Meta AI translation or YouTube auto-dub — enable manually in Instagram Creator Studio for these posts.",
    };
  }),

  /**
   * Trial-reel outcome tracking (Wave C′): Trial publishing itself can now
   * use Meta's trial_params from the Queue. The 24h Trial-specific outcome
   * numbers remain manual because no trustworthy Trial-metric ingestion is
   * wired into our Graph reader yet. Hand-entered numbers stay explicitly
   * labeled rather than being fabricated from ordinary Reel insights.
   * Rides briefJson (zero DDL); CAS on version; fail-closed on unreadable
   * driver results (the `?? 1` class).
   */
  recordTrialResult: adminProcedure
    .input(z.object({
      id: z.string().min(1),
      expectedVersion: z.number().int().min(1),
      trial: z.object({
        postedAsTrial: z.boolean().optional(),
        views24h: z.number().int().min(0).optional(),
        avgWatchSeconds: z.number().min(0).optional(),
        shares: z.number().int().min(0).optional(),
        saves: z.number().int().min(0).optional(),
        comments: z.number().int().min(0).optional(),
        follows: z.number().int().min(0).optional(),
        promotedToEveryone: z.boolean().optional(),
        note: z.string().max(500).optional(),
      }).strict(),
    }))
    .mutation(async ({ input }) => {
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — trial result not recorded." });
      const { socialContentInventory } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const rows = await database.select({ briefJson: socialContentInventory.briefJson })
        .from(socialContentInventory).where(eq(socialContentInventory.id, input.id)).limit(1);
      if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
      let parsed: Record<string, unknown> = {};
      try { parsed = rows[0].briefJson ? JSON.parse(rows[0].briefJson) : {}; } catch { parsed = {}; }
      const prior = (parsed.trial ?? {}) as Record<string, unknown>;
      // Merge only the fields the operator actually entered — a partial save
      // must never null out numbers recorded earlier.
      const entered = Object.fromEntries(Object.entries(input.trial).filter(([, v]) => v !== undefined));
      const next = { ...parsed, trial: { ...prior, ...entered, recordedAt: new Date().toISOString() } };
      const { affectedRowCount } = await import("../lib/db-affected");
      const result = await database.update(socialContentInventory)
        .set({ briefJson: JSON.stringify(next), version: input.expectedVersion + 1 })
        .where(and(eq(socialContentInventory.id, input.id), eq(socialContentInventory.version, input.expectedVersion)));
      if (affectedRowCount(result) !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "The draft changed while you were typing — reopen it and re-enter the trial numbers." });
      }
      return { ok: true, version: input.expectedVersion + 1 };
    }),

  /**
   * ── Pattern Lab (Wave C′ final item) ──────────────────────────────────
   * Winning short-form STRUCTURES captured as data — never scraped content.
   * The adaptation feeds the EXISTING Create machinery via the handoff
   * contract; there is no second generator here.
   */
  listReelPatterns: adminProcedure.query(async () => {
    const database = await db();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — patterns cannot be read (outage, not an empty lab)." });
    const { socialReelPatterns } = await import("../../drizzle/schema");
    const { desc } = await import("drizzle-orm");
    const rows = await database.select().from(socialReelPatterns)
      .orderBy(desc(socialReelPatterns.createdAt)).limit(100);
    const patterns = [];
    for (const r of rows) {
      try {
        patterns.push({
          id: r.id,
          label: r.label,
          hookType: r.hookType,
          loopType: r.loopType,
          timesUsed: r.timesUsed,
          lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : null,
          createdAt: new Date(r.createdAt).toISOString(),
          pattern: JSON.parse(r.patternJson),
        });
      } catch {
        log.warn("skipping unparseable reel pattern row", { id: r.id });
      }
    }
    return patterns;
  }),

  saveReelPattern: adminProcedure
    .input(z.object({
      id: z.string().max(64).optional(),
      label: z.string().trim().min(1).max(80),
      sourceLabel: z.string().trim().max(120).optional(),
      // A citation for the operator's memory — the system NEVER fetches it.
      sourceUrl: z.string().url().max(300).optional(),
      hookType: z.enum(["impossible_object", "visual_contradiction", "satisfying_macro", "myth_vs_reality", "countdown", "tiny_story", "warning_alert", "forensic_scan"]),
      pacing: z.object({
        totalSeconds: z.number().min(3).max(90),
        beatCount: z.number().int().min(1).max(10),
        avgShotLength: z.number().min(0.3).max(30),
        firstTextAtSecond: z.number().min(0).max(30),
      }).strict(),
      visualStyle: z.object({
        lens: z.string().trim().max(120),
        lighting: z.string().trim().max(120),
        color: z.string().trim().max(120),
        motion: z.string().trim().max(120),
        texture: z.string().trim().max(120),
      }).strict(),
      captionStyle: z.object({
        wordsPerBeat: z.number().int().min(1).max(12),
        placement: z.string().trim().max(80),
        hierarchy: z.enum(["headline_only", "headline_subline", "subtitle", "kinetic"]),
      }).strict(),
      audioStyle: z.object({
        musicMood: z.string().trim().max(80),
        voiceover: z.boolean(),
        sfx: z.array(z.string().trim().min(1).max(40)).max(6),
      }).strict(),
      loopType: z.enum(["cause_loop", "object_loop", "question_loop", "motion_loop", "problem_loop", "other"]),
      shareTrigger: z.string().trim().min(1).max(200),
      saveTrigger: z.string().trim().min(1).max(200),
      // Required — a pattern without a Nick adaptation is a bookmark, not a plan.
      nickAdaptation: z.string().trim().min(10).max(600),
    }).strict())
    .mutation(async ({ input }) => {
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — pattern not saved." });
      const { socialReelPatterns } = await import("../../drizzle/schema");
      const { randomUUID } = await import("crypto");
      const id = input.id && input.id.startsWith("rp_") ? input.id : `rp_${randomUUID()}`;
      const pattern = { ...input, id };
      await database.insert(socialReelPatterns).values({
        id,
        label: input.label,
        hookType: input.hookType,
        loopType: input.loopType,
        patternJson: JSON.stringify(pattern),
      }).onDuplicateKeyUpdate({
        set: {
          label: input.label,
          hookType: input.hookType,
          loopType: input.loopType,
          patternJson: JSON.stringify(pattern),
        },
      });
      return { id };
    }),

  deleteReelPattern: adminProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — pattern not deleted." });
      const { socialReelPatterns } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { affectedRowCount } = await import("../lib/db-affected");
      const result = await database.delete(socialReelPatterns).where(eq(socialReelPatterns.id, input.id));
      if (affectedRowCount(result) !== 1) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pattern not found (already deleted?)." });
      }
      return { ok: true };
    }),

  /** Adaptation used → durable trail for the future pattern×outcome memory. */
  recordPatternUse: adminProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — use not recorded." });
      const { socialReelPatterns } = await import("../../drizzle/schema");
      const { eq, sql } = await import("drizzle-orm");
      const { affectedRowCount } = await import("../lib/db-affected");
      const result = await database.update(socialReelPatterns)
        .set({ timesUsed: sql`${socialReelPatterns.timesUsed} + 1`, lastUsedAt: new Date() })
        .where(eq(socialReelPatterns.id, input.id));
      if (affectedRowCount(result) !== 1) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pattern not found." });
      }
      return { ok: true };
    }),

  /*
   * getAccountInfo / reconnectToken / generatePost were DELETED 2026-07-24
   * (audit R4): zero client callers, no test coverage, and each duplicated a
   * capability owned elsewhere (feed cache, Settings config flow, the
   * governed Studio pipeline). finalizeReelDraft was deleted in the same cut
   * and RESTORED the same day: approval-integrity.test.ts's E2E pipeline
   * (enqueue -> finalize -> approve -> publish) exercises it — it is part of
   * the reel pipeline's tested contract, not dead weight.
   */

  /** Recent posts from the cached feed (refresh via syncFeed). */
  getLiveFeed: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(24) }).optional())
    .query(async ({ input }) => {
      const { getInstagramPosts } = await import("../instagram");
      return getInstagramPosts(input?.limit ?? 24);
    }),

  /** Content-intelligence bundle: fast, already-built analytics reports.
   *  accountAverages covers EVERY stored post — the headline stats used to
   *  average only the top-5 list, presenting winners as the baseline. */
  getAnalytics: dbAdminProcedure.query(async () => {
    const { getEngagementByType, getBestPostingTimes, getFollowerGrowth, getTopPosts, getAccountAverages } = await import(
      "../pipelines/instagram-data"
    );
    const [engagementByType, bestPostingTimes, followerGrowth, topPosts, accountAverages] = await Promise.all([
      getEngagementByType(),
      getBestPostingTimes({ limit: 7 }),
      getFollowerGrowth(),
      getTopPosts({ limit: 5 }),
      getAccountAverages(),
    ]);
    // Snapshot accrual (Wave C substrate): null = unreadable (unknown, never
    // zero). Windows/cohorts unlock as this history ages — the UI says so
    // instead of pretending.
    // withWatchTime/withSkipRate are COUNTS of non-null rows, deliberately not
    // the values. Migration 0108 has been storing avg_watch_time_ms and
    // skip_rate since 2026-07-31 and nothing has ever read them back, so the
    // first honest question is not "what is the number" but "do we have any".
    // A count cannot be misread: it carries no units, and skip_rate's units
    // (percent vs fraction) are still unconfirmed against a live Graph payload.
    // Both columns are REELS-ONLY (instagram-data.ts:162), so on an
    // image-heavy account a low count is expected, not a fault.
    let snapshotStats: {
      rows: number;
      earliest: string | null;
      withWatchTime: number | null;
      withSkipRate: number | null;
    } | null = null;
    try {
      const database = await db();
      if (database) {
        const { igMetricSnapshots } = await import("../../drizzle/schema");
        const { sql } = await import("drizzle-orm");
        const r = await database
          .select({
            n: sql<number>`count(*)`,
            earliest: sql<string | null>`min(${igMetricSnapshots.capturedAt})`,
            watch: sql<number>`sum(case when ${igMetricSnapshots.avgWatchTimeMs} is not null then 1 else 0 end)`,
            skip: sql<number>`sum(case when ${igMetricSnapshots.skipRate} is not null then 1 else 0 end)`,
          })
          .from(igMetricSnapshots)
          // IG history only — the FB insights lane shares this table under a
          // `fb:` postId prefix (instagram-data.ts) and is not IG snapshot history.
          .where(sql`${igMetricSnapshots.postId} NOT LIKE 'fb:%'`);
        const row = (r as Array<{ n: unknown; earliest: unknown; watch: unknown; skip: unknown }>)[0];
        const n = Number(row?.n);
        if (Number.isFinite(n)) {
          const earliestRaw = row?.earliest;
          // SUM() returns null on an empty table; keep that as unknown rather
          // than coercing to 0, matching the contract the rest of this file uses.
          const watch = Number(row?.watch);
          const skip = Number(row?.skip);
          snapshotStats = {
            rows: n,
            earliest: earliestRaw ? String(earliestRaw) : null,
            withWatchTime: Number.isFinite(watch) ? watch : null,
            withSkipRate: Number.isFinite(skip) ? skip : null,
          };
        }
      }
    } catch (err) {
      log.warn("snapshot stats unreadable — reporting unknown", err);
    }
    return { engagementByType, bestPostingTimes, followerGrowth, topPosts, accountAverages, snapshotStats };
  }),

  /** On-demand narrative performance report (separate proc — may be heavier). */
  getPerformanceReport: adminProcedure.query(async () => {
    const { generatePerformanceReport } = await import("../pipelines/instagram-data");
    return generatePerformanceReport();
  }),

  /** Intelligence Endpoint: Performance-Seeded Brief for content generation.
   *  Reads from analytics to provide context for the AI Copilot.
   *  topArchetypeLast30Days is computed from real ig_autopost_log data
   *  (was hardcoded to "proof" — fixed 2026-07-01 per Clarity Gate audit). */
  getCreationBrief: dbAdminProcedure.query(async () => {
    const { getTopPosts } = await import("../pipelines/instagram-data");
    const topPosts = await getTopPosts({ limit: 5 });

    /**
     * The best-performing archetype of the last 30 days, or NOTHING.
     *
     * This defaulted to the literal string "proof" and returned it as
     * `topArchetypeLast30Days` — so an empty table, or a database that could not
     * be read at all, produced a confident 30-day performance finding that was
     * really a hardcoded guess. The shop has published 8 things in its life, so
     * the empty case is the NORMAL one: this field has almost certainly never
     * shown anything but the default.
     *
     * The fix is the pattern already used by the posting window twelve lines
     * below — a nullable value plus a basis string saying why. That one was made
     * honest and this one, in the same function, was not.
     */
    let topArchetype: string | null = null;
    let topArchetypeBasis = "no posted content in the last 30 days";
    try {
      const database = await db();
      if (database) {
        const { igAutopostLog } = await import("../../drizzle/schema");
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const rows = await database
          .select({
            archetype: igAutopostLog.archetype,
            avgScore: sql<number>`AVG(${igAutopostLog.overallScore})`.as("avgScore"),
          })
          .from(igAutopostLog)
          .where(
            and(
              eq(igAutopostLog.status, "posted"),
              gte(igAutopostLog.createdAt, thirtyDaysAgo),
            ),
          )
          .groupBy(igAutopostLog.archetype)
          .orderBy(sql`avgScore DESC`)
          .limit(1);
        if (rows.length > 0 && rows[0].archetype) {
          topArchetype = rows[0].archetype;
          topArchetypeBasis = "highest average score across posts in the last 30 days";
        }
      } else {
        topArchetypeBasis = "could not be computed (database unavailable)";
      }
    } catch (err) {
      // A failed read is not a finding. It used to leave "proof" standing.
      topArchetypeBasis = "could not be computed (analytics unavailable)";
      log.warn("Failed to compute top archetype from ig_autopost_log", err);
    }

    // The posting window is DERIVED or it is absent. It used to be the literal
    // string "Tuesdays at 4:30 PM", returned beside genuinely computed fields, so
    // the HQ presented a hardcoded guess as performance-derived guidance. The data
    // to compute it honestly is right there — instagram_analytics carries
    // dayOfWeek, hourOfDay and engagementRate — but the sample is small, so a
    // minimum is enforced rather than reading a trend into three posts.
    // Aggregated by DAY OF WEEK only, never day+hour. With ~29 timed posts spread
    // over 7x24 = 168 day/hour slots, the winning slot is a sample of ONE — the
    // first version of this computed exactly that and would have called a single
    // post at 6% engagement the "optimal window". Replacing a hardcoded guess with
    // a computed one is not an improvement. Seven day-buckets is the coarsest
    // grouping that still answers the question, and the winning bucket must itself
    // clear a minimum before anything is claimed.
    const MIN_POSTS_IN_WINNING_BUCKET = 3;
    let optimalPostingWindow: string | null = null;
    let postingWindowBasis: string;
    try {
      const database = await db();
      if (!database) throw new Error("no database");
      const { instagramAnalytics } = await import("../../drizzle/schema");
      const rows = await database
        .select({
          dayOfWeek: instagramAnalytics.dayOfWeek,
          avgEngagement: sql<number>`AVG(${instagramAnalytics.engagementRate})`.as("avgEngagement"),
          n: sql<number>`COUNT(*)`.as("n"),
        })
        .from(instagramAnalytics)
        .where(and(isNotNull(instagramAnalytics.dayOfWeek), isNotNull(instagramAnalytics.engagementRate)))
        .groupBy(instagramAnalytics.dayOfWeek)
        .orderBy(sql`avgEngagement DESC`)
        .limit(1);

      const best = rows[0];
      const bucketN = Number(best?.n ?? 0);
      if (!best || best.dayOfWeek === null) {
        postingWindowBasis = "no posts with both a recorded day and engagement";
      } else if (bucketN < MIN_POSTS_IN_WINNING_BUCKET) {
        postingWindowBasis = `not enough data yet — the best day has only ${bucketN} post(s), need ${MIN_POSTS_IN_WINNING_BUCKET}`;
      } else {
        const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const day = DAYS[Number(best.dayOfWeek)] ?? `day ${best.dayOfWeek}`;
        optimalPostingWindow = `${day}s`;
        postingWindowBasis = `highest average engagement, ${bucketN} post(s) on that day`;
      }
    } catch (err) {
      log.warn("Failed to compute the posting window from instagram_analytics", err);
      postingWindowBasis = "could not be computed (analytics unavailable)";
    }

    return {
      topArchetypeLast30Days: topArchetype,
      /** Why the archetype says what it says — null means we have no finding. */
      topArchetypeBasis,
      optimalPostingWindow,
      /** Why the window says what it says — so the UI never implies more than it knows. */
      postingWindowBasis,
      // Previously two hardcoded tips presented as findings. Deriving this needs
      // theme-to-engagement analysis the pipeline does not do yet, and inventing
      // guidance is worse than admitting the gap.
      topicsToAvoid: [] as string[],
      topicsToAvoidBasis: "not derived yet — needs theme-level engagement analysis",
      /**
       * ALL-TIME top posts by engagement rate — getTopPosts applies no date
       * filter (instagram-data.ts:450). Labelled accordingly rather than as
       * "recent", because on an account with 8 posts ever "recent winners" and
       * "every post we have" are the same list wearing a more flattering name.
       *
       * The ellipsis is appended only when something was ACTUALLY cut: the old
       * `caption?.substring(0, 50) + "..."` rendered a captionless post as the
       * literal string "..." and a 40-character caption as one that looked
       * truncated.
       */
      recentWinnersBasis: "all-time top posts by engagement rate — not restricted to a recent window",
      recentWinners: topPosts.map(p => {
        const caption = p.caption ?? "";
        return {
          id: p.postId,
          caption: caption ? caption.slice(0, 50) + (caption.length > 50 ? "..." : "") : "No caption recorded",
        };
      })
    };
  }),

  /** Re-sync the analytics table + public cache from live Graph data. */
  syncFeed: adminProcedure.mutation(async () => {
    const { syncInstagramPosts } = await import("../pipelines/instagram-data");
    return syncInstagramPosts();
  }),

  /** Comments on one of our media objects, for moderation. */
  getComments: adminProcedure
    .input(z.object({ mediaId: z.string().min(1) }))
    .query(async ({ input }) => {
      const { getMediaComments } = await import("../services/metaSocial");
      return getMediaComments(input.mediaId);
    }),

  /** Draft a brand-safe reply to a comment via the LLM. Suggestion only —
   *  nothing is posted. The draft is run through the same claim-safety
   *  detector the operator's send gate uses, so a clean draft also passes. */
  suggestReply: adminProcedure
    .input(z.object({
      commentText: z.string().min(1).max(2000),
      tone: z.enum(["warm", "professional", "witty", "promo"]).optional().default("warm"),
    }))
    .mutation(async ({ input }) => {
      let toneGuideline = "Write a warm, human, 1-2 sentence public reply that sounds like the shop owner, not a brand.";
      if (input.tone === "professional") {
        toneGuideline = "Write a professional, polite, and direct 1-2 sentence reply focused on customer service and help.";
      } else if (input.tone === "witty") {
        toneGuideline = "Write a witty, lighthearted, and friendly 1-2 sentence reply with a touch of neighborhood humor.";
      } else if (input.tone === "promo") {
        toneGuideline = "Write a warm 1-2 sentence reply that casually invites them to check out our shop deals, book an appointment, or visit nickstire.org.";
      }

      const prompt = `You manage the Instagram account for Nick's Tire & Auto, a neighborhood Cleveland-area shop.
A follower left this comment on one of our posts: "${input.commentText}"

${toneGuideline}
${buildReplyPromptRules()}
Keep it under 200 characters.`;

      let draft = "";
      try {
        const result = await invokeLLM({
          messages: [{ role: "user", content: prompt }],
          // gemini-2.5-flash spends ~500-1000 tokens on internal thinking before
          // output; 200 left ~nothing for the reply -> empty drafts. 2048 covers
          // the thinking overhead plus a short 1-2 sentence reply.
          maxTokens: 2048,
        });
        const content = result.choices?.[0]?.message?.content;
        draft = typeof content === "string" ? sanitizeText(content) : "";
      } catch (err) {
        log.error("[instagramAdmin] suggestReply LLM failed:", err);
        draft = "";
      }

      const findings = draft ? checkReviewReply(draft) : [];
      return { draft, findings, blocked: hasBlockingFindings(findings) };
    }),

  /** Post a reply to a comment. LIVE external write — gated by an explicit
   *  per-comment admin action AND a hard claim-safety block. */
  postReply: adminProcedure
    .input(z.object({ commentId: z.string().regex(/^\d+$/, "commentId must be numeric"), message: z.string().min(1).max(2000) }))
    .mutation(async ({ input }) => {
      const cleaned = sanitizeText(input.message);

      const blockers = checkReviewReply(cleaned).filter((f) => f.severity === "block");
      if (blockers.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Claim-safety: ${blockers.map((f) => `${f.rule} ("${f.match}")`).join("; ")} — edit the reply first.`,
        });
      }

      const { replyToComment } = await import("../services/metaSocial");
      const result = await replyToComment(input.commentId, cleaned);
      if (!result.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error || "Failed to post reply to Instagram",
        });
      }
      return result;
    }),

  /** Advanced IQ 200 Content Generator endpoint for Studio.tsx */
  generatePostDraft: adminProcedure
    .input(z.object({
      sourceId: z.string(),
      sourceDetail: z.string().optional(),
      format: z.string()
    }))
    .mutation(async ({ input }) => {
      const { orchestrateAdvancedCaption, orchestrateAdvancedCarouselConcept } = await import("../services/socialIntelligence");
      
      const topic = `${input.sourceId}: ${input.sourceDetail || ""}`;
      
      if (input.format === "carousel") {
        const result = await orchestrateAdvancedCarouselConcept(topic);
        // We compile the carousel text into the caption for the UI to preview
        const caption = result.slides.map((s, i) => `[Slide ${i+1}] ${s.text}`).join("\\n\\n");
        return { caption };
      } else {
        const result = await orchestrateAdvancedCaption(topic);
        return { caption: result.caption };
      }
    }),

  /** Recent AI generations (from ig_autopost_log).
   *  @deprecated Zero client callers (audit R4, 2026-07-24) — its composer and
   *  the generatePost co-pilot are gone. Kept only for its test coverage;
   *  delete alongside the legacy queue. */
  getRecentGenerations: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(25) }).optional())
    .query(async ({ input }): Promise<Array<{
      id: number; archetype: string; conceptKey: string; status: string;
      caption: string; imageUrl: string | null; overallScore: number | null;
      source: string; createdAt: Date; error: string | null;
      evalScoresJson: string | null;
      igPostId: string | null;
      fbPostId: string | null;
    }>> => {
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — generation history cannot be read." });
      const { igAutopostLog } = await import("../../drizzle/schema");
      return database
        .select({
          id: igAutopostLog.id,
          archetype: igAutopostLog.archetype,
          conceptKey: igAutopostLog.conceptKey,
          status: igAutopostLog.status,
          caption: igAutopostLog.caption,
          imageUrl: igAutopostLog.imageUrl,
          overallScore: igAutopostLog.overallScore,
          source: igAutopostLog.source,
          createdAt: igAutopostLog.createdAt,
          error: igAutopostLog.error,
          evalScoresJson: igAutopostLog.evalScoresJson,
        })
        .from(igAutopostLog)
        .orderBy(desc(igAutopostLog.createdAt))
        .limit(input?.limit ?? 25);
    }),

  /** Provider + autopost run health. Surfaces WHICH AI provider is actually
   *  active and whether its key is present — the root cause of silent
   *  generation failures: when GEMINI_API_KEY is absent, llm.ts falls back to a
   *  (often out-of-quota) OpenAI key and posts fail with a 429. Plus the recent
   *  autopost pass/fail rate + last error. Key-presence based (no live API ping)
   *  so it's cheap and honest. */
  /** Generate an AI image for a manual draft in the Studio. */
  generateMedia: adminProcedure
    .input(z.object({ caption: z.string().min(1), prompt: z.string().optional() }))
    .mutation(async ({ input }) => {
      const { generatePostImage } = await import("../services/igAutopost");
      // Use the prompt if provided, otherwise fallback to the caption
      const imageResult = await generatePostImage(input.prompt || input.caption, { caption: input.caption });
      return imageResult;
    }),

  /** Stage a manual draft for later publishing via Queue */
  stageDraft: adminProcedure
    .input(z.object({
      format: z.enum(["single", "carousel", "reel", "story", "ad"]),
      // Same 2200 ceiling as publishPost — an overlength caption staged here would
      // only surface at publish time, after the operator has moved on.
      caption: z.string().min(1).max(2200),
      imageUrl: z.string().url().optional(),
      imageUrls: z.array(z.string().url()).optional(),
      videoUrl: z.string().url().optional(),
      sourceType: z.string(),
      sourceDetail: z.string().optional(),
      conceptBrief: z.any().optional(),
      // No qualityScore input: the legacy Studio sends a client-computed score and
      // this procedure used to silently discard it while persisting a flat 80.
      // Manual drafts are operator judgment, not machine evaluation — they stage
      // unscored (scoreOverall 0) and the Queue shows no score badge.
    }))
    .mutation(async ({ input }) => {
      if (input.format === "reel") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Reel format drafts cannot be created via stageDraft. Reels must be enqueued via enqueueReelJob and finalized via finalizeReelDraft.",
        });
      }

      // Same claim-safety gate as publishPost/schedulePost, applied at stage time —
      // a banned claim should bounce while the operator is still writing, not when
      // the cron tries to publish it hours later.
      const { captionClaimBlockers } = await import("../services/socialPublish");
      const blockers = captionClaimBlockers(input.caption);
      if (blockers.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Claim-safety: ${blockers.map((f) => `${f.rule} ("${f.match}")`).join("; ")} — edit the caption before staging.`,
        });
      }

      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { socialContentInventory } = await import("../../drizzle/schema");
      
      const assetPaths = [];
      if (input.imageUrl) assetPaths.push(input.imageUrl);
      if (input.imageUrls) assetPaths.push(...input.imageUrls);
      if (input.videoUrl) assetPaths.push(input.videoUrl);
      
      let mappedType: "post" | "reel" | "carousel" | "story" | "poll" = "post";
      if (input.format === "carousel") mappedType = "carousel";
      if (input.format === "story") mappedType = "story";
      
      const { randomUUID } = await import("crypto");
      
      await database.insert(socialContentInventory).values({
        id: `draft_${randomUUID()}`,
        platform: "both",
        contentType: mappedType,
        topic: `${input.sourceType}: ${input.sourceDetail || "manual draft"}`.substring(0, 128),
        seriesName: "manual_drafts",
        hookCategory: "manual",
        hookText: input.caption,
        bodyText: "",
        visualStyle: "manual",
        persona: "manual",
        // "ready" is deliberate for manual drafts: the operator IS the review. The
        // publish path still applies claim-safety and the at-most-once claim.
        status: "ready",
        assetPaths,
        briefJson: JSON.stringify(input.conceptBrief || {}),
        // 0 = unscored (schema default). This procedure used to write a flat 80,
        // which the Queue then displayed as a passing machine evaluation.
        scoreOverall: 0,
        version: 1,
      });
      
      return { success: true };
    }),

  /** Reel pipeline step: attach the finished mp4 to a generating draft and
   *  move it to review. Part of the E2E integrity contract pinned by
   *  approval-integrity.test.ts (enqueue -> finalize -> approve -> publish). */
  finalizeReelDraft: adminProcedure
    .input(z.object({
      id: z.string(),
      videoUrl: z.string(),
      brief: z.any(),
    }))
    .mutation(async ({ input }) => {
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const { socialContentInventory } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const rows = await database
        .select()
        .from(socialContentInventory)
        .where(eq(socialContentInventory.id, input.id))
        .limit(1);

      if (rows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Inventory record with ID ${input.id} not found.`,
        });
      }

      const item = rows[0];
      if (item.status !== "generating") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot finalize draft in status ${item.status}. Expected status 'generating'.`,
        });
      }

      if (!input.videoUrl.toLowerCase().endsWith(".mp4")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Reel asset must be an MP4 video.",
        });
      }

      const assetPaths = [input.videoUrl];
      const briefJson = JSON.stringify(input.brief || {});

      await database
        .update(socialContentInventory)
        .set({
          status: "review_ready",
          assetPaths,
          briefJson,
          updatedAt: new Date(),
        })
        .where(eq(socialContentInventory.id, input.id));

      return { success: true };
    }),

  /* ── AUTONOMOUS REEL PUBLISH APPROVALS ────────────────────────────────────
   * A SEPARATE LANE from approveDraft below, and deliberately so.
   *
   * approveDraft writes `social_content_approvals`, keyed on
   * (inventory_id, version) — that covers reels published through Studio. The
   * autonomous cron works off `reel_jobs` rows, which carry no inventory_id,
   * so that table has nothing to key on. #2000 added the reel_jobs-keyed
   * `reel_publish_approvals` and its default-deny gate, but shipped no writer:
   * the table had three readers and none of them could create a row, so the
   * cron could never publish again. These three procedures are that writer.
   *
   * Approving here does NOT publish. It records consent; the cron still has to
   * clear rendered QA, the claim audit, the disclosure gate and the originality
   * gate, all of which run BEFORE approval is even consulted.
   * ──────────────────────────────────────────────────────────────────────── */

  /** Assembled reels the autonomous cron could publish, with their real approval state. */
  reelPublishQueue: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ input }) => {
      const { listReelPublishQueue } = await import("../services/reelApproval");
      return listReelPublishQueue(input?.limit ?? 25);
    }),

  /**
   * The recovery ledger: what a reel job cost, what survived, and what is UNKNOWN.
   *
   * READ-ONLY — no provider connection, no spend, no write. It exists to answer
   * one question before repeating a paid request: "what did we pay for, and
   * might any of it still be live remotely?" Outstanding provider operations are
   * called out separately; reconcile those before spending again.
   *
   * Every gap is NAMED rather than inferred. A beat with no recorded operation
   * reports "either it predates op history, or none was submitted — NOT evidence
   * that nothing was paid for", clip reachability is explicitly not probed, and
   * cost is labelled an estimate with the reason. The failure this guards
   * against is concluding "nothing was paid for" from an absence of evidence and
   * then spending again.
   */
  /**
   * One read that answers "is the reel machine ok?".
   *
   * Every figure it returns was reachable before and none of it was on a
   * screen: whether anything is scheduled for tomorrow, how many finished
   * reels are waiting, which published openings actually held viewers, what a
   * published reel costs, and whether the lanes that do the work are running.
   * Those questions were being answered by hand, with ad-hoc SQL against
   * production, one probe at a time.
   *
   * READ-ONLY. It runs SELECTs and nothing else - no generation, no publish,
   * no spend - so it is safe to open, refresh and leave open.
   */
  reelPipelineHealth: adminProcedure
    .input(z.object({ windowDays: z.number().int().min(1).max(365).optional() }).optional())
    .query(async ({ input }) => {
      const { buildReelPipelineHealth } = await import("../services/reelPipelineHealth");
      return buildReelPipelineHealth(input?.windowDays ?? 30);
    }),

  reelRecoveryLedger: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).optional(),
          jobId: z.number().int().positive().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const { buildReelRecoveryLedger } = await import("../services/reelRecoveryLedger");
      return buildReelRecoveryLedger({ limit: input?.limit, jobId: input?.jobId });
    }),

  /**
   * Record one attributable human yes, bound to the exact caption bytes and
   * exact asset the cron will send.
   *
   * `expectedCaptionSha` / `expectedVideoUrl` are what the operator had on
   * screen. The service refuses if the live row has moved on since — an
   * approval must never be recorded against bytes nobody read.
   */
  approveReelPublish: adminProcedure
    .input(z.object({
      jobId: z.number().int().positive(),
      expectedCaptionSha: z.string().length(64),
      expectedVideoUrl: z.string().min(1),
      note: z.string().max(500).optional(),
      /**
       * DELIVERY ELIGIBILITY (0118). Optional: omit both and behaviour is
       * exactly as before — the rolling 72h TTL governs.
       *
       * Supplying them means the operator authorized a SPECIFIC SLOT they were
       * shown, which suppresses the TTL. That is the only way to approve today
       * for a date more than 72h out; without it such an approval expires
       * before its own slot. A window says ALLOWED DURING, never DUE AT.
       */
      publishWindowStartISO: z.string().datetime().nullable().optional(),
      publishWindowEndISO: z.string().datetime().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Same standard as approveDraft: no fallback approver. An unattributed
      // row is one the gate rejects anyway (APPROVAL_BLOCK.anonymous).
      if (!ctx.user?.id) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Approver identity must be verified. No fallback approver ID allowed.",
        });
      }
      const { recordReelApproval, ReelApprovalWriteError } = await import("../services/reelApproval");
      try {
        const res = await recordReelApproval({
          jobId: input.jobId,
          approvedBy: `admin:${ctx.user.id}`,
          expectedCaptionSha: input.expectedCaptionSha,
          expectedVideoUrl: input.expectedVideoUrl,
          note: input.note,
          publishWindowStart: input.publishWindowStartISO ? new Date(input.publishWindowStartISO) : null,
          publishWindowEnd: input.publishWindowEndISO ? new Date(input.publishWindowEndISO) : null,
        });
        log.info("reel publish approval recorded", {
          jobId: input.jobId, approvalId: res.approvalId, by: `admin:${ctx.user.id}`,
        });
        return res;
      } catch (err) {
        if (err instanceof ReelApprovalWriteError) {
          // The refusal reason is the whole value here — an operator who is
          // told only "failed" cannot tell a stale review from a permanent veto.
          throw new TRPCError({
            code:
              err.code === "stale_review" ? "CONFLICT"
              : err.code === "job_not_found" ? "NOT_FOUND"
              : err.code === "no_database" ? "INTERNAL_SERVER_ERROR"
              : "BAD_REQUEST",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /** Withdraw a previously granted approval. A withdrawal, never a delete. */
  revokeReelPublish: adminProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user?.id) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Revoker identity must be verified." });
      }
      const { revokeReelApproval } = await import("../services/reelApproval");
      const res = await revokeReelApproval({ jobId: input.jobId, revokedBy: `admin:${ctx.user.id}` });
      log.info("reel publish approval revoked", { jobId: input.jobId, revoked: res.revoked });
      return res;
    }),

  approveDraft: adminProcedure
    .input(z.object({
      id: z.string(),
      expectedVersion: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      
      if (!ctx.user?.id) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Reviewer identity must be verified. No fallback reviewer ID allowed.",
        });
      }

      const { socialContentInventory, socialContentApprovals } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      
      const rows = await database
        .select()
        .from(socialContentInventory)
        .where(eq(socialContentInventory.id, input.id))
        .limit(1);
      
      const draft = rows[0];
      if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
      
      if (draft.status !== "review_ready") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only drafts in 'review_ready' status can be approved.",
        });
      }

      if (draft.version !== input.expectedVersion) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Version mismatch. Expected version ${input.expectedVersion} but found ${draft.version}.`,
        });
      }

      const brief = JSON.parse(draft.briefJson || "{}");
      
      // Extract media URL from assetPaths
      let videoUrl = "";
      if (Array.isArray(draft.assetPaths)) {
        videoUrl = draft.assetPaths[0] as string;
      } else if (typeof draft.assetPaths === "string") {
        try {
          const parsed = JSON.parse(draft.assetPaths);
          if (Array.isArray(parsed)) videoUrl = parsed[0];
        } catch (e) {}
      }

      if (!videoUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No video asset found on this draft.",
        });
      }

      const beats = brief.storyboardBeats || [];
      const beatsDuration = beats.reduce((acc: number, beat: any) => acc + ((beat.endSecond || 3) - (beat.startSecond || 0)), 0);
      const expectedDuration = beatsDuration + 3.0; // beats + CTA card duration

      const validation = await validateFinalMedia(videoUrl, expectedDuration);
      if (!validation.valid || !validation.mediaHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Final media validation failed: ${validation.error}`,
        });
      }

      const { createHash, randomUUID } = await import("crypto");
      const briefHash = createHash("sha256").update(draft.briefJson || "").digest("hex");

      const nextVersion = draft.version + 1;
      const approvalId = `appr_${randomUUID()}`;

      // The CAS flip to "ready" and the approval-record insert MUST be atomic.
      // When they weren't, the missing social_content_approvals table (see the
      // 2026-07-16 audit) let the flip land and the insert fail — stranding a
      // publishable-looking row with no approval record. Both now commit or
      // roll back together.
      await database.transaction(async (tx: typeof database) => {
        const updateResult = await tx
          .update(socialContentInventory)
          .set({
            status: "ready",
            version: nextVersion,
            errorMessage: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(socialContentInventory.id, input.id),
              eq(socialContentInventory.status, "review_ready"),
              eq(socialContentInventory.version, input.expectedVersion)
            )
          );

        // Fails closed (like every other claim in the server): an unreadable
        // driver result counts as 0 → CONFLICT, which rolls back the tx.
        if (affectedRowCount(updateResult) === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Draft was modified by another request. Aborting approval.",
          });
        }

        // Durable approval semantics (0087): approvals expire and record the
        // governing policy version - enforced at publish time.
        let approvalPolicyVersion: number | null = null;
        try {
          const { getActivePolicy } = await import("../services/autonomyControl");
          approvalPolicyVersion = (await getActivePolicy()).version;
        } catch { /* legacy posture */ }
        const { APPROVAL_TTL_HOURS } = await import("../services/contentApprovals");
        await tx.insert(socialContentApprovals).values({
          id: approvalId,
          inventoryId: draft.id,
          version: input.expectedVersion,
          approvedBy: ctx.user.id,
          briefHash,
          mediaHash: validation.mediaHash,
          mediaUrl: videoUrl,
          expiresAt: new Date(Date.now() + APPROVAL_TTL_HOURS * 3600_000),
          policyVersion: approvalPolicyVersion,
        });
      });

      return { success: true };
    }),

  /** Higgsfield (reels) account health for the Settings panel — creds validity
   *  + remaining credit balance. Runs the CLI (~1-15s) so it's its own query
   *  with its own loading state, not folded into the fast getProviderHealth. */
  getHiggsfieldHealth: adminProcedure.query(async () => {
    const { getHiggsfieldAccountHealth } = await import("../services/higgsfieldStudio");
    const cli = await getHiggsfieldAccountHealth();

    // The API-KEY lane's health is reported alongside the CLI session's, because
    // that lane is what generateReelClipVideo actually PREFERS when configured —
    // reporting only the session would describe a mechanism the pipeline is not
    // using. `probeHiggsfieldApiCredentials` shipped with ZERO callers, which made
    // the one free pre-flight check unreachable from the operator's phone; this is
    // where it becomes reachable. It costs one ~10s HTTP call and NO credits, and
    // it is skipped entirely when the key is unset, so the existing CLI-only
    // behaviour is unchanged for anyone who has not opted in.
    const { resolveHiggsfieldApiCredentials, probeHiggsfieldApiCredentials } = await import(
      "../services/higgsfieldApiClient",
    );
    // `configured` is THREE-STATE here, not boolean-with-a-null (P2 review, Codex,
    // PR #1653). The version this replaces read a null credential as "not set" —
    // but the key lives in app_secret_kv and `getDb()` opens no socket, so an
    // unreachable database produced a confident "not set" for a key that may well
    // be sitting in the row. On the operator's phone that is the worst possible
    // wrong answer: it says "paste a key" when the truth is "fix connectivity",
    // and it is the same shape as the dead session that read as fine for four days.
    const resolution = await resolveHiggsfieldApiCredentials();
    const api = resolution.credentials
      ? {
          configured: true as const,
          store: resolution.store,
          ...(await probeHiggsfieldApiCredentials(resolution.credentials)),
        }
      : resolution.dbError
        ? {
            configured: "unknown" as const,
            store: resolution.store,
            healthy: null,
            reason: `the key store could not be read, so this is UNKNOWN and not "unset": ${resolution.dbError}`,
          }
        : {
            configured: false as const,
            store: resolution.store,
            healthy: null,
            reason:
              "the lookup COMPLETED and found nothing: no app_secret_kv rows (set them in Instagram -> Settings) and no HIGGSFIELD_API_KEY_ID / _SECRET env vars",
          };

    // `preferredLane` is the honest answer to "which one will actually run?" —
    // a surface that showed both healths without saying which is authoritative
    // would leave the operator to infer it, and inferring it wrong is how a dead
    // session got read as fine for four days.
    // An UNKNOWN api lane must not be reported as the preferred one — the pipeline
    // only prefers a lane it can actually get credentials for, so `=== true` is the
    // honest test. Reading `api.configured` as truthy would make the string
    // "unknown" select api_key and describe a lane that cannot run.
    return {
      ...cli,
      api,
      preferredLane: api.configured === true ? ("api_key" as const) : ("cli_session" as const),
    };
  }),
  getProviderHealth: adminProcedure.query(async () => {
    // Text LLM (server/_core/llm.ts) prefers GEMINI_API_KEY, else OPENAI_API_KEY.
    const geminiKey = !!process.env.GEMINI_API_KEY;
    const openaiKey = !!process.env.OPENAI_API_KEY;
    const textProvider: "gemini" | "openai" | "none" = geminiKey ? "gemini" : openaiKey ? "openai" : "none";

    // Default must match the ENGINE's default (igAutopost.generatePostImage
    // falls back to "adrender") — this panel used to claim "openai" while the
    // engine rendered the branded poster, so the health card described a
    // provider that wasn't in use.
    let imageProvider = (process.env.IG_AUTOPOST_IMAGE_PROVIDER || "adrender").toLowerCase();
    let higgsfieldCreds = !!process.env.HIGGSFIELD_CREDENTIALS_JSON;
    let recentRuns = 0;
    let recentFailures = 0;
    let lastError: string | null = null;
    let lastErrorAt: Date | null = null;

    try {
      const database = await db();
      if (database) {
        const { appSecretKv, igAutopostLog } = await import("../../drizzle/schema");
        const { inArray } = await import("drizzle-orm");
        const kv = await database
          .select()
          .from(appSecretKv)
          .where(inArray(appSecretKv.k, ["ig_autopost_image_provider", "higgsfield_credentials_json"]));
        for (const r of kv) {
          if (r.k === "ig_autopost_image_provider" && r.v) imageProvider = r.v.toLowerCase();
          if (r.k === "higgsfield_credentials_json" && r.v) higgsfieldCreds = true;
        }
        const runs = await database
          .select({ status: igAutopostLog.status, error: igAutopostLog.error, createdAt: igAutopostLog.createdAt })
          .from(igAutopostLog)
          .orderBy(desc(igAutopostLog.createdAt))
          .limit(10);
        recentRuns = runs.length;
        // runs are ordered newest-first, so the first failed row we hit is the
        // most recent failure (for-of avoids the dynamic-import any-inference).
        for (const r of runs) {
          if (r.status === "failed") {
            recentFailures++;
            if (!lastError && r.error) {
              lastError = r.error;
              lastErrorAt = r.createdAt;
            }
          }
        }
      }
    } catch (err) {
      log.error("getProviderHealth failed:", err);
    }

    // Is the ACTIVE image provider's credential actually present? Two prior
    // lies fixed here: the real default "adrender" (the deterministic branded
    // poster) needs NO AI key at all but fell through to the openai branch and
    // reported unconfigured; anything unrecognized now reports false instead
    // of borrowing openai's status.
    // Same presence-vs-liveness correction as getPipelineHealth. `higgsfieldCreds`
    // proves a blob exists; it does NOT prove the session works, and IG autopost
    // image generation runs through that same session.
    const { higgsfieldSessionLiveness } = await import("../services/higgsfieldStudio");
    const hfSession = await higgsfieldSessionLiveness();
    const imageHealthy =
      imageProvider === "adrender" ? true
      : imageProvider === "higgsfield" ? hfSession.live === true
      : imageProvider.includes("gemini") ? geminiKey
      : imageProvider === "openai" || imageProvider === "openrouter" ? openaiKey
      : false;

    return {
      text: {
        provider: textProvider,
        configured: textProvider !== "none",
        openaiFallback: !geminiKey && openaiKey,
      },
      image: {
        provider: imageProvider,
        configured: imageHealthy,
        /** PRESENCE of the credentials blob - not liveness. See higgsfieldSession. */
        higgsfieldCreds,
        higgsfieldSession: {
          live: hfSession.live,
          balanceCredits: hfSession.balanceCredits,
          checkedAt: hfSession.checkedAt,
          reason: hfSession.reason,
        },
      },
      autopost: { recentRuns, recentFailures, lastError, lastErrorAt },
    };
  }),

  /** Regenerate an image from a prompt (re-roll the visual while keeping a
   *  winning caption, or generate one for a custom post). Wraps the autopost
   *  image generator (which throws) into an ok/error result. */
  regenerateImage: adminProcedure
    .input(z.object({ prompt: z.string().min(3).max(1000) }))
    .mutation(async ({ input }) => {
      const { generatePostImage } = await import("../services/igAutopost");
      try {
        const res = await generatePostImage(input.prompt);
        return { ok: true as const, url: res.url };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }
    }),

  /** Milestone 1 (Creative Compiler 2.0): record an authenticated operator
   *  "publish anyway" override that accepts specific ADVISORY quality findings,
   *  bound to the exact approved (inventory, version, brief+media hash). Refuses
   *  any block-severity finding — a hard block needs a fix, never an override. */
  createQualityOverride: adminProcedure
    .input(z.object({
      inventoryId: z.string(),
      assetVersion: z.number().int(),
      assetId: z.string().optional(),
      campaignId: z.string().optional(),
      findings: z.array(z.object({
        findingId: z.string(),
        severity: z.enum(["warn", "repair", "block"]),
      })).min(1),
      operatorReason: z.string().min(1).max(2000),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user?.id) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authenticated operator required to record an override." });
      }
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { socialContentApprovals } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");

      // Bind to the exact hashes the operator approved — copy them from the
      // approval record for this version. No approval => nothing to override.
      const approvals = await database
        .select()
        .from(socialContentApprovals)
        .where(and(eq(socialContentApprovals.inventoryId, input.inventoryId), eq(socialContentApprovals.version, input.assetVersion)))
        .limit(1);
      if (approvals.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No approval record for this version — approve the content before recording an override." });
      }
      const approval = approvals[0];

      const { createOperatorOverride } = await import("../services/operatorOverride");
      const res = await createOperatorOverride(database, {
        campaignId: input.campaignId ?? null,
        inventoryId: input.inventoryId,
        assetId: input.assetId ?? null,
        assetVersion: input.assetVersion,
        contentHash: approval.mediaHash,
        briefHash: approval.briefHash,
        findings: input.findings,
        operatorReason: input.operatorReason,
        actorId: ctx.user.id,
        actorEmail: (ctx.user as unknown as { email?: string | null }).email ?? null,
      });
      if (!res.ok) {
        if (res.reason === "contains_hard_block") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot override hard blocks (${res.blockedFindingIds.join(", ")}) — these require a fix, not an override.` });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: "No findings provided to accept." });
      }
      return { ok: true as const, overrideId: res.overrideId, expiresAt: res.expiresAt };
    }),

  /** Publish a custom image or Reel to Instagram directly. */
  publishPost: dbAdminProcedure
    .input(z.object({
      inventoryId: z.string().optional(),
      platforms: z.array(z.enum(["facebook", "instagram"])).min(1, "Select at least one platform"),
      caption: z.string().min(1).max(2200),
      imageUrl: z.string().url().optional(),
      imageUrls: z.array(z.string().url()).min(2).max(10).optional(),
      videoUrl: z.string().url().optional(),
      /**
       * Meta's structured AI self-disclosure. Reaches the container via the
       * `...input` spread into publishToSocial below, which already types it and
       * forwards it to metaSocial's `is_ai_generated`.
       *
       * This lane had NO way to set it. The autonomous reel path computes it and
       * the disclosure gate refuses generated footage without it - but this manual
       * lane bypasses that gate, so an externally produced generated video
       * published here went out with no self-disclosure at all. Caption text is
       * NOT the platform mechanism.
       */
      isAiGenerated: z.boolean().optional(),
      /**
       * Explicit operator-only Trial Reel publish. We intentionally expose
       * MANUAL graduation only: broad distribution remains a second operator
       * decision instead of an opaque Meta auto-promotion.
       */
      trialReel: z.object({ graduationStrategy: z.literal("MANUAL") }).strict().optional(),
    }))
    .mutation(async ({ input }) => {
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      if (input.trialReel) {
        if (!input.inventoryId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Trial Reel publishing requires an approved Reel inventory item." });
        }
        if (input.platforms.length !== 1 || input.platforms[0] !== "instagram") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Trial Reels are Instagram-only and cannot be cross-posted." });
        }
      }
      
      let publishCaption = input.caption;
      let publishVideoUrl = input.videoUrl;
      // Re-asserted as a compare-and-set immediately before the Meta call. Reading
      // the status and acting on it are two statements; without a claim between
      // them two concurrent callers both pass every gate and both publish. Same
      // at-most-once idiom as cron/jobs/crudAutomation.ts:507.
      let observedStatus: string | null = null;
      // Milestone 1 (Creative Compiler 2.0): if an authenticated operator recorded
      // a publish-anyway override for this exact (inventory, approved version,
      // brief+media hashes), it is consumed atomically once the publish claim is
      // won. Captured in the reel integrity gate (where the current hashes are
      // known); consumed at the CAS below. Additive — no override = unchanged path.
      let pendingOverride: { inventoryId: string; assetVersion: number; currentContentHash: string; currentBriefHash: string } | null = null;
      // Resolved by the SAME publish authority that checked rendered-QA. Carry
      // this exact job id through to the success receipt so Queue/Trial posts
      // enter the existing controlled-experiment measurement loop just like
      // dailyReelPost does.
      let resolvedReelJobId: number | null = null;
      // The reel job this publish must claim assembled -> publishing alongside
      // the inventory row. Set only once the job is proven "assembled".
      let reelJobToClaim: number | null = null;

      if (input.inventoryId) {
        const { socialContentInventory, socialContentApprovals } = await import("../../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const rows = await database
          .select()
          .from(socialContentInventory)
          .where(eq(socialContentInventory.id, input.inventoryId))
          .limit(1);
        const draft = rows[0];
        if (draft) {
          observedStatus = draft.status;
          // Terminal states are not re-publishable. published_partial in particular has
          // a live post on at least one platform — re-running would duplicate it.
          if (draft.status === "publishing" || draft.status === "published" || draft.status === "published_partial") {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                draft.status === "publishing"
                  ? "This draft is already being published. Wait for that attempt to finish before retrying."
                  : draft.status === "published"
                    ? "This draft is already published. Re-publishing would duplicate the live post."
                    : "This draft is partially published — one platform is already live. Re-publishing would duplicate it; resolve the failed platform manually.",
            });
          }
          if (input.trialReel && draft.contentType !== "reel") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Trial Reel mode is valid only for an approved Reel draft." });
          }
          if (draft.contentType === "reel") {
            if (draft.status !== "ready") {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "This Reel draft must be reviewed and approved before publishing.",
              });
            }

            const approvedCaption = buildReelPublishCaption(draft.briefJson, draft.hookText);

            let approvedVideoUrl = "";
            if (Array.isArray(draft.assetPaths)) {
              approvedVideoUrl = draft.assetPaths[0] as string;
            } else if (typeof draft.assetPaths === "string") {
              try {
                const parsed = JSON.parse(draft.assetPaths);
                if (Array.isArray(parsed)) approvedVideoUrl = parsed[0];
              } catch (e) {}
            }

            if (!approvedVideoUrl) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "No approved video asset found on this Reel draft.",
              });
            }

            // Approval integrity AND the rendered-QA quality decision, in one
            // authority shared with schedulePost. This block used to hand-roll
            // the hash comparison (and schedulePost's copy had drifted to hashing
            // the URL string), and neither door consulted the quality gate at all
            // — so an approved reel with unavailable, stale or repair-required QA
            // published from the Queue with that state never surfaced.
            const { authorizeReelPublish, ReelNotPublishableError } = await import("../services/reelPublishAuthority");
            let authorization;
            try {
              authorization = await authorizeReelPublish(database, {
                draft: { id: draft.id, version: draft.version, briefJson: draft.briefJson },
                videoUrl: approvedVideoUrl,
              });
            } catch (err) {
              if (err instanceof ReelNotPublishableError) {
                throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
              }
              throw err;
            }

            // Integrity confirmed against the approved version — carry the exact
            // binding so an optional operator override can be consumed at the
            // publish CAS below. An override still lets an operator ship over
            // ADVISORY findings; it never bypasses a hard gate.
            pendingOverride = authorization.overrideBinding;
            resolvedReelJobId = authorization.reelJobId;

            // ONE REEL, ONE DOOR AT A TIME. The cron publishes from reel_jobs
            // ("assembled" -> "publishing") and never looked at this row; this
            // door published from this row and never looked at reel_jobs. So a
            // reel posted here stayed "assembled" and the cron posted it again,
            // and a job the cron had in flight ("publishing"/"publish_ambiguous",
            // possibly live) could be published here a second time. The job must
            // be "assembled" now, and is claimed below in the same step as the row.
            if (input.trialReel && resolvedReelJobId === null) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Trial Reel publishing needs this Reel's production job, and none could be resolved for this draft.",
              });
            }
            let clipUrlsJson: string | null = null;
            let onScreenText = "";
            /** Per-shot provenance (2026-10-09): lets a Reel made only of registry footage and drawn cards publish without the AI label. */
            let shotLineage: unknown = undefined;
            if (resolvedReelJobId !== null) {
              const { reelJobs } = await import("../../drizzle/schema");
              const [reelJob] = await database
                .select({ status: reelJobs.status, clipUrlsJson: reelJobs.clipUrlsJson, payload: reelJobs.payload })
                .from(reelJobs)
                .where(eq(reelJobs.id, resolvedReelJobId))
                .limit(1);
              if (!reelJob) {
                throw new TRPCError({ code: "BAD_REQUEST", message: `Reel job ${resolvedReelJobId} behind this draft no longer exists.` });
              }
              if (reelJob.status !== "assembled") {
                throw new TRPCError({
                  code: "CONFLICT",
                  message:
                    `Reel job ${resolvedReelJobId} is '${reelJob.status}', not 'assembled'` +
                    (["publishing", "publish_ambiguous", "posted", "published"].includes(String(reelJob.status))
                      ? " — it is already being published or may already be LIVE. Check Instagram; publishing again would duplicate it."
                      : " — only a finished, unpublished render can be published."),
                });
              }
              clipUrlsJson = reelJob.clipUrlsJson ?? null;
              const { parseReelJobPayload } = await import("@shared/reelJobPayload");
              const reelPayload = parseReelJobPayload(reelJob.payload);
              shotLineage = reelPayload.shotLineage;
              onScreenText = (reelPayload.storyboardBeats ?? [])
                .map((b) => b?.onScreenText ?? "")
                .filter(Boolean)
                .join(" ");
              reelJobToClaim = resolvedReelJobId;
            }

            // AI SELF-DISCLOSURE is server-authoritative for reels, derived from
            // THIS job's clips exactly as the cron derives it. The Queue sent no
            // flag, so generated reels went out with no is_ai_generated — which
            // cannot be added after the container is created. Any client value
            // is ignored. The disclosure gate judges the value that will be sent.
            const { shouldDiscloseAi, publishDisclosureProblem } = await import("@shared/reelDisclosure");
            const willDiscloseAi = shouldDiscloseAi(clipUrlsJson, process.env.REEL_VIDEO_PROVIDER, { shotLineage });
            const disclosureViolation = publishDisclosureProblem({
              jobId: resolvedReelJobId ?? draft.id,
              caption: approvedCaption,
              onScreenText,
              willDiscloseAi,
            });
            if (disclosureViolation) {
              throw new TRPCError({ code: "BAD_REQUEST", message: `Disclosure gate: ${disclosureViolation}` });
            }
            input.isAiGenerated = willDiscloseAi;

            publishCaption = approvedCaption;
            publishVideoUrl = approvedVideoUrl;
            // Reel media is server-authoritative. Clear any client-supplied
            // static/carousel fields before the shared publisher sees the
            // request, otherwise a crafted payload with imageUrls + an approved
            // Reel inventoryId can be routed through the carousel branch before
            // the approved video branch.
            input.imageUrl = undefined;
            input.imageUrls = undefined;
          } else {
            // Non-reel drafts: media is SERVER-authoritative. The client used to
            // supply imageUrl(s) verbatim with no check against the row — the last
            // format-level integrity hole after the reel gate (missed by both
            // prior audits). Publish what the row carries; when an approval
            // record exists (V2-approved drafts), verify hashes like reels. Rows
            // without a record (manual stageDraft — the operator IS the review)
            // pass with a warning, not a block.
            const rowAssets: string[] = Array.isArray(draft.assetPaths)
              ? (draft.assetPaths as string[])
              : (() => {
                  try {
                    const parsed = JSON.parse((draft.assetPaths as string) || "[]");
                    return Array.isArray(parsed) ? parsed : [];
                  } catch {
                    return [];
                  }
                })();
            if (rowAssets.length > 0) {
              const { verifyApprovalRecord } = await import("../services/contentApprovals");
              const verdict = await verifyApprovalRecord(database, {
                inventoryId: draft.id,
                version: draft.version - 1,
                briefJson: draft.briefJson,
                mediaUrls: rowAssets,
              });
              if (!verdict.ok && verdict.reason !== "no_record") {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `Integrity breach: the draft's ${verdict.reason === "brief_mismatch" ? "content" : "media"} changed after approval. Re-review and re-approve.`,
                });
              }
              if (!verdict.ok) {
                log.warn(`publishPost: no approval record for ${draft.id} v${draft.version - 1} (manual/pre-provenance draft) — publishing row media without integrity check`);
              }
              if (rowAssets.length > 1) {
                input.imageUrls = rowAssets;
                input.imageUrl = undefined;
              } else {
                input.imageUrl = rowAssets[0];
                input.imageUrls = undefined;
              }
            }
          }
        }
      } else {
        if (input.videoUrl) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Publishing a Reel requires a valid, approved inventoryId.",
          });
        }
      }

      const { captionClaimBlockers, assertPermanentPublicMediaUrl, publishToSocial } = await import("../services/socialPublish");
      if (publishVideoUrl) assertPermanentPublicMediaUrl(publishVideoUrl);
      
      const blockers = captionClaimBlockers(publishCaption);
      if (blockers.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Claim-safety: ${blockers.map((f) => `${f.rule} ("${f.match}")`).join("; ")} — edit the caption before publishing.`,
        });
      }
      const setInventoryStatus = async (status: string, errorMessage?: string, proof?: string | null) => {
        if (!input.inventoryId) return;
        const { socialContentInventory } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await database.update(socialContentInventory)
          .set({
            status,
            updatedAt: new Date(),
            ...(status === "published" || status === "published_partial" ? { publishedAt: new Date() } : {}),
            ...(errorMessage !== undefined ? { errorMessage: errorMessage.slice(0, 500) } : {}),
          })
          .where(eq(socialContentInventory.id, input.inventoryId));

        /**
         * Close the content run from the ONE place inventory status actually
         * changes, rather than at each of the three call sites below — a rule
         * applied in one place cannot be applied inconsistently in three.
         *
         * `operationalState` — the half of the two-state model that records what
         * was PROVEN — previously had no writer anywhere, so every run stalled at
         * "we built it" and could never answer "did it go live".
         *
         * Best-effort by construction: the post is already live by the time this
         * runs, and a bookkeeping failure must never be reported to the operator
         * as a publish failure.
         */
        if (status === "published" || status === "published_partial") {
          try {
            const { markContentRunPublishedByInventory } = await import("../services/contentRun");
            await markContentRunPublishedByInventory(input.inventoryId, {
              // No post id means we cannot PROVE it — that lands as `attempted`,
              // never `published`. Same distinction the attempt ledger draws.
              proof: proof ?? null,
              what: status === "published_partial"
                ? `published to some platforms only: ${errorMessage ?? "partial"}`
                : input.trialReel
                  ? "published as Instagram Trial Reel (MANUAL graduation)"
                  : "published to Instagram",
            });
          } catch (err) {
            log.warn("publish succeeded but the content run could not be closed", {
              inventoryId: input.inventoryId,
              err: err instanceof Error ? err.message.slice(0, 200) : String(err),
            });
          }
        }
      };

      const attachExperimentMediaReceipt = async (postId?: string | null) => {
        if (!postId || !resolvedReelJobId) return;
        try {
          const { attachPublishedMediaForReelJob } = await import("../services/contentExperimentStore");
          await attachPublishedMediaForReelJob(resolvedReelJobId, postId, new Date());
        } catch (err) {
          // The Instagram post is already confirmed live. Experiment bookkeeping
          // must never turn that success into an error that invites a duplicate.
          log.warn("Queue Reel published but experiment media attachment failed", {
            reelJobId: resolvedReelJobId,
            postId,
            err: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
        }
      };

      const persistTrialPublishReceipt = async (postId?: string | null) => {
        if (!input.trialReel || !input.inventoryId) return;
        try {
          const { socialContentInventory } = await import("../../drizzle/schema");
          const { eq, and } = await import("drizzle-orm");
          const rows = await database
            .select({ briefJson: socialContentInventory.briefJson, version: socialContentInventory.version })
            .from(socialContentInventory)
            .where(eq(socialContentInventory.id, input.inventoryId))
            .limit(1);
          if (!rows.length) return;

          let parsed: Record<string, unknown> = {};
          try { parsed = rows[0].briefJson ? JSON.parse(rows[0].briefJson) : {}; } catch { parsed = {}; }
          const prior = (parsed.trial ?? {}) as Record<string, unknown>;
          const next = {
            ...parsed,
            trial: {
              ...prior,
              postedAsTrial: true,
              graduationStrategy: input.trialReel.graduationStrategy,
              publishedAt: new Date().toISOString(),
              postId: postId ?? null,
            },
          };
          // Version is an optimistic guard only; publishing metadata does not
          // mutate the approved creative version. If a human records 24h
          // metrics concurrently and bumps version, refuse to overwrite them.
          const result = await database.update(socialContentInventory)
            .set({ briefJson: JSON.stringify(next), updatedAt: new Date() })
            .where(and(
              eq(socialContentInventory.id, input.inventoryId),
              eq(socialContentInventory.version, rows[0].version),
            ));
          if (affectedRowCount(result) !== 1) {
            log.warn("Trial Reel published but trial receipt lost a concurrent metadata race", {
              inventoryId: input.inventoryId,
              postId: postId ?? null,
            });
          }
        } catch (err) {
          // External publish is already live. Never turn bookkeeping failure
          // into a user-visible publish failure that could invite a duplicate.
          log.warn("Trial Reel published but trial receipt persistence failed", {
            inventoryId: input.inventoryId,
            postId: postId ?? null,
            err: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
        }
      };

      // Claim the row BEFORE the irreversible external call — the last gate that can
      // still stop a duplicate. A concurrent caller that read the same status loses
      // the CAS (0 rows) and is told to back off rather than posting a second time.
      if (input.inventoryId && observedStatus !== null) {
        const { socialContentInventory } = await import("../../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const claim = await database
          .update(socialContentInventory)
          .set({ status: "publishing", updatedAt: new Date() })
          .where(and(
            eq(socialContentInventory.id, input.inventoryId),
            eq(socialContentInventory.status, observedStatus),
          ));
        if (affectedRowCount(claim) === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another publish attempt claimed this draft first. Refresh to see its current state.",
          });
        }
      }

      // Claim the reel job too — the same CAS the cron uses. Losing it means the
      // autonomous lane got there first: hand the row back and refuse.
      const { queueStateForReelStatus } = await import("@shared/reelQueue");
      const setClaimedReelJob = async (status: "assembled" | "publish_ambiguous" | "posted", extra: { igPostId?: string | null; error?: string | null } = {}) => {
        if (reelJobToClaim === null) return;
        const { reelJobs } = await import("../../drizzle/schema");
        const { eq, and, inArray } = await import("drizzle-orm");
        const res = await database
          .update(reelJobs)
          .set({
            status,
            queueState: queueStateForReelStatus(status),
            ...(status === "assembled" ? { publicationScheduledAt: null } : {}),
            ...(status === "posted" ? { igPostId: extra.igPostId ?? null, error: null } : {}),
            ...(status === "publish_ambiguous" ? { error: String(extra.error ?? "publish outcome unknown — may be LIVE").slice(0, 500) } : {}),
          })
          // A confirmed post wins even if the stuck-claim sweeper (reelPipeline,
          // 12 min) already parked a slow publish as publish_ambiguous.
          .where(and(
            eq(reelJobs.id, reelJobToClaim),
            status === "posted" ? inArray(reelJobs.status, ["publishing", "publish_ambiguous"]) : eq(reelJobs.status, "publishing"),
          ));
        if (affectedRowCount(res) !== 1) {
          log.error("Queue Reel publish could not move its claimed reel job", { reelJobId: reelJobToClaim, toStatus: status });
        }
      };
      if (reelJobToClaim !== null) {
        const { reelJobs } = await import("../../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const jobClaim = await database
          .update(reelJobs)
          .set({ status: "publishing", queueState: queueStateForReelStatus("publishing"), publicationScheduledAt: new Date() })
          .where(and(eq(reelJobs.id, reelJobToClaim), eq(reelJobs.status, "assembled")));
        if (affectedRowCount(jobClaim) === 0) {
          await setInventoryStatus(observedStatus ?? "ready");
          throw new TRPCError({
            code: "CONFLICT",
            message: `Reel job ${reelJobToClaim} was claimed by another publish (the autonomous lane or a second tap). Refresh — it may already be going out.`,
          });
        }
      }

      // Publication is beginning (claim won) — consume any operator quality
      // override atomically and record it in the audit trail. Additive: with no
      // override this is a no-op ("none") and the publish proceeds on the
      // approval exactly as before. The override NEVER weakened a hard gate — all
      // of them (approval existence/expiry, hash match, kill switch, cadence,
      // claim safety) ran above, unchanged.
      // Held so a failed publish can hand the operator's acceptance back rather
      // than burning it (see releaseConsumedOverride).
      let consumedOverrideId: string | undefined;
      if (pendingOverride) {
        const { consumeOverrideForPublish } = await import("../services/operatorOverride");
        const consumed = await consumeOverrideForPublish(database, pendingOverride);
        if (consumed.ok) {
          consumedOverrideId = consumed.overrideId;
          const { recordAuditEvent, getActivePolicy } = await import("../services/autonomyControl");
          let policyVersion = 0;
          try { policyVersion = (await getActivePolicy()).version; } catch { /* degraded policy loader — audit still records */ }
          await recordAuditEvent({
            actionType: "reel_publish",
            // 21 chars — fits the audit decision varchar(24) uncut (was
            // "APPROVED_BY_OPERATOR_OVERRIDE", 29 chars, silently sliced to 24).
            decision: "APPROVED_VIA_OVERRIDE",
            reasoningCodes: consumed.acceptedFindingIds,
            policyVersion,
            context: { overrideId: consumed.overrideId, inventoryId: pendingOverride.inventoryId, assetVersion: pendingOverride.assetVersion },
          });
        }
      }

      // Media presence is validated BEFORE the attempt is recorded. Recording first
      // would write a "may be live" row for a request that never reached Meta,
      // putting a phantom entry on the reconciliation surface — the one place that
      // must only ever show real ambiguity.
      const hasMedia = Boolean(publishVideoUrl || input.imageUrl || (input.imageUrls && input.imageUrls.length));
      if (!hasMedia) {
        await setInventoryStatus(observedStatus ?? "ready");
        await setClaimedReelJob("assembled");
        throw new TRPCError({ code: "BAD_REQUEST", message: "No media to publish — provide imageUrl, imageUrls or videoUrl." });
      }

      // Durable attempt record BEFORE the irreversible call. The inventory CAS above
      // stops two operators racing, but it does not survive a process death: killed
      // between Meta accepting and the DB write, nothing would record the attempt.
      // A null id means the ledger is unavailable — refuse rather than publish
      // unrecorded, which is the ambiguity the ledger exists to remove.
      const { recordPublishAttempt, recordPublishOutcome, OUTCOME } = await import("../services/publishAttemptLedger");
      const attemptId = await recordPublishAttempt({
        inventoryId: input.inventoryId ?? null,
        platforms: input.platforms ?? [],
        mediaUrl: publishVideoUrl ?? null,
        caption: publishCaption,
      });
      if (!attemptId) {
        await setInventoryStatus(observedStatus ?? "ready");
        await setClaimedReelJob("assembled");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Publish-attempt ledger unavailable — refusing to publish unrecorded. Retry shortly.",
        });
      }

      let results: Awaited<ReturnType<typeof publishToSocial>>["results"];
      let igPostId: string | undefined;
      try {
        ({ results, igPostId } = await publishToSocial({
          ...input,
          caption: publishCaption,
          videoUrl: publishVideoUrl,
        }));
      } catch (err) {
        // A throw is not proof nothing posted — record it as AMBIGUOUS so the
        // reconciler surfaces it rather than leaving the attempt silently open.
        await recordPublishOutcome(attemptId, OUTCOME.ambiguous, { error: err instanceof Error ? err.message : String(err) });
        // Same rule as the cron: a throw may have posted, so the job is parked
        // for reconciliation, never handed back to "assembled" for a re-post.
        try {
          await setClaimedReelJob("publish_ambiguous", { error: `Queue publish threw: ${err instanceof Error ? err.message : String(err)}` });
        } catch (jobErr) {
          log.error("Queue Reel publish threw and its reel job could not be parked", { reelJobId: reelJobToClaim, err: jobErr instanceof Error ? jobErr.message.slice(0, 200) : String(jobErr) });
        }
        // The claim must not outlive a throw, or the draft wedges in "publishing"
        // and every later attempt hits the CONFLICT guard above.
        await setInventoryStatus(observedStatus ?? "failed", err instanceof Error ? err.message : String(err));
        // Nothing went live, so the operator's override was spent on nothing —
        // give it back on the same signal that rolls the draft back, or the
        // retry loses their decision and re-blocks on the finding they accepted.
        if (consumedOverrideId) {
          const { releaseConsumedOverride } = await import("../services/operatorOverride");
          await releaseConsumedOverride(database, consumedOverrideId);
        }
        throw err;
      }

      const succeeded = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);
      const failureDetail = failed.map((r) => `${r.platform}: ${r.error}`).join("; ");
      // A dispatched-but-unanswered media_publish is NOT a plain failure: the
      // post may be LIVE, and "failed" is the status that invites the retry
      // that duplicates it. ANY ambiguous platform makes the WHOLE operation
      // ambiguous — the first version required every platform to fail, so
      // "Facebook confirmed + Instagram unanswered" fell into the PARTIAL
      // branch, whose message tells the operator to post the missing platform
      // manually. Manually posting a possibly-live Instagram reel is exactly
      // the duplicate this state exists to prevent.
      const dispatchAmbiguous = failed.some((r) => r.ambiguous);
      await recordPublishOutcome(
        attemptId,
        dispatchAmbiguous ? OUTCOME.ambiguous : succeeded.length === 0 ? OUTCOME.failed : OUTCOME.confirmed,
        { igPostId: igPostId ?? null, error: failureDetail || null, platformResults: results },
      );

      // Settle the claimed reel job from INSTAGRAM's outcome: live -> posted
      // (with the media id, so no door posts it again), unanswered ->
      // publish_ambiguous, clean refusal -> back to assembled. Bookkeeping after
      // a possibly-live publish must never throw into a retry.
      try {
        const igResult = results.find((r) => r.platform === "instagram");
        if (igPostId || igResult?.success) await setClaimedReelJob("posted", { igPostId: igPostId ?? null });
        else if (igResult?.ambiguous) await setClaimedReelJob("publish_ambiguous", { error: igResult.error ?? null });
        else await setClaimedReelJob("assembled");
      } catch (jobErr) {
        log.error("Queue Reel publish finished but its reel job could not be settled", { reelJobId: reelJobToClaim, err: jobErr instanceof Error ? jobErr.message.slice(0, 200) : String(jobErr) });
      }

      // Attach as soon as Instagram has returned a confirmed media id, even if
      // another requested platform failed later in this multi-platform call.
      // The assignment store is idempotent (media_id IS NULL), so a retry cannot
      // rewrite an experiment episode onto a different post.
      await attachExperimentMediaReceipt(igPostId ?? null);

      if (dispatchAmbiguous) {
        const confirmedNote = succeeded.length
          ? `CONFIRMED on ${succeeded.map((r) => r.platform).join(", ")}${igPostId ? ` (id ${igPostId})` : ""}; `
          : "";
        await setInventoryStatus(
          "ambiguous",
          `${confirmedNote}publish dispatched but unanswered on ${failed.filter((r) => r.ambiguous).map((r) => r.platform).join(", ")} — may be LIVE, verify before retrying: ${failureDetail}`,
          igPostId ?? null,
        );
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: succeeded.length
            ? `Published on ${succeeded.map((r) => r.platform).join(", ")}, but the ${failed.filter((r) => r.ambiguous).map((r) => r.platform).join(", ")} call timed out AFTER it was sent — that platform MAY BE LIVE. Verify on the account; do NOT repost manually.`
            : "The publish call timed out after it was sent — the post MAY BE LIVE. Check the Instagram account before retrying; retrying now can duplicate it.",
        });
      }

      if (succeeded.length === 0) {
        await setInventoryStatus("failed", failureDetail);
        // Every platform rejected it — same rule as the throw path above.
        if (consumedOverrideId) {
          const { releaseConsumedOverride } = await import("../services/operatorOverride");
          await releaseConsumedOverride(database, consumedOverrideId);
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Publish failed: ${failureDetail}`,
        });
      }

      if (failed.length > 0) {
        // At least one platform is LIVE and at least one is not. Recording this as
        // "published" is what let the Queue's onSuccess toast report success for a
        // post that never reached Instagram — so this throws instead.
        await setInventoryStatus("published_partial", failureDetail, igPostId ?? null);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Partially published — LIVE on ${succeeded.map((r) => r.platform).join(", ")}; FAILED on ${failureDetail}. Do NOT retry: re-publishing would duplicate the live post. Post the failed platform manually.`,
        });
      }

      await setInventoryStatus("published", undefined, igPostId ?? null);
      await persistTrialPublishReceipt(igPostId ?? null);

      return { success: true, results, postId: igPostId, publishedAsTrial: Boolean(input.trialReel) };
    }),

  /**
   * schedulePost / listScheduled / cancelScheduled were DELETED 2026-07-24.
   * All three had ZERO client callers, and schedulePost carried two verified
   * integrity holes its live sibling publishPost had already fixed (no
   * terminal-status guard for non-reel drafts; client-supplied media accepted
   * verbatim). Deferred publishing for Studio content is owned end-to-end by
   * instagramStudio.schedule -> scheduled_posts(inventoryId) -> runScheduledPosts,
   * which also writes the fire-time outcome back onto the inventory row.
   */

  /** Get Meta integration configuration parameters (env defaults + database overrides). */
  getMetaConfig: adminProcedure.query(async () => {
    const { getAppId, getPageId, getIgUserId, getAppSecret } = await import("../services/metaSocial");
    const [appId, pageId, igUserId, appSecret] = await Promise.all([
      getAppId(),
      getPageId(),
      getIgUserId(),
      getAppSecret(),
    ]);

    let imageProvider = "";
    let hasHiggsfieldCreds = false;
    let hasHiggsfieldApiKey = false;
    try {
      const database = await db();
      if (database) {
        const { appSecretKv } = await import("../../drizzle/schema");
        const { inArray } = await import("drizzle-orm");
        const rows = await database
          .select()
          .from(appSecretKv)
          .where(
            inArray(appSecretKv.k, [
              "ig_autopost_image_provider",
              "higgsfield_credentials_json",
              "higgsfield_api_key_id",
            ])
          );
        for (const r of rows) {
          if (r.k === "ig_autopost_image_provider") imageProvider = r.v;
          if (r.k === "higgsfield_credentials_json" && r.v) hasHiggsfieldCreds = true;
          if (r.k === "higgsfield_api_key_id" && r.v) hasHiggsfieldApiKey = true;
        }
      }
    } catch (err) {
      log.error("Failed to load image provider / higgsfield credentials meta:", err);
    }

    if (!imageProvider) {
      imageProvider = process.env.IG_AUTOPOST_IMAGE_PROVIDER || "openai";
    }

    return {
      appId: appId ?? "",
      pageId: pageId ?? "",
      igUserId: igUserId ?? "",
      hasSecret: !!appSecret,
      imageProvider,
      hasHiggsfieldCreds,
      hasHiggsfieldApiKey,
    };
  }),

  /** Update Meta integration configuration overrides in database secrets KV. */
  updateMetaConfig: adminProcedure
    .input(z.object({
      appId: z.string().trim().min(1, "App ID cannot be empty"),
      pageId: z.string().trim().min(1, "Page ID cannot be empty"),
      igUserId: z.string().trim().min(1, "Instagram User ID cannot be empty"),
      appSecret: z.string().trim().optional(),
      imageProvider: z.enum(["openai", "gemini", "higgsfield"]).optional(),
      higgsfieldCredentialsJson: z.string().trim().optional(),
      // The API KEY lane. Stored in app_secret_kv rather than a Railway env var
      // so it can be set from the phone and take effect immediately — an env var
      // needs a redeploy that measured ~20 minutes.
      higgsfieldApiKeyId: z.string().trim().max(200).optional(),
      higgsfieldApiKeySecret: z.string().trim().max(400).optional(),
    }))
    .mutation(async ({ input }) => {
      const database = await db();
      if (!database) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not connected",
        });
      }
      const { appSecretKv } = await import("../../drizzle/schema");

      const updates = [
        { k: "meta_app_id", v: input.appId },
        { k: "meta_page_id", v: input.pageId },
        { k: "meta_ig_user_id", v: input.igUserId },
      ];

      if (input.appSecret) {
        updates.push({ k: "meta_app_secret", v: input.appSecret });
      }

      if (input.imageProvider) {
        updates.push({ k: "ig_autopost_image_provider", v: input.imageProvider });
      }

      if (input.higgsfieldCredentialsJson) {
        updates.push({ k: "higgsfield_credentials_json", v: input.higgsfieldCredentialsJson });
      }

      if (input.higgsfieldApiKeyId) {
        updates.push({ k: "higgsfield_api_key_id", v: input.higgsfieldApiKeyId });
      }
      if (input.higgsfieldApiKeySecret) {
        updates.push({ k: "higgsfield_api_key_secret", v: input.higgsfieldApiKeySecret });
      }

      for (const item of updates) {
        await database
          .insert(appSecretKv)
          .values({ k: item.k, v: item.v })
          .onDuplicateKeyUpdate({ set: { v: item.v } });
      }

      const { clearRuntimeMetaConfigCache } = await import("../services/metaSocial");
      clearRuntimeMetaConfigCache();

      const { clearRuntimeHiggsfieldCache } = await import("../services/higgsfieldStudio");
      clearRuntimeHiggsfieldCache();

      // Same reason as the line above: getHiggsfieldApiCredentials latches on
      // first read and never re-queries, so without this the pasted key would not
      // take effect until a redeploy — which is the entire friction this DB-backed
      // path exists to remove.
      const { clearRuntimeHiggsfieldApiKeyCache } = await import("../services/higgsfieldApiClient");
      clearRuntimeHiggsfieldApiKeyCache();

      return { success: true };
    }),

  /** Get all Instagram Drafts for the Queue */
  getAllDrafts: adminProcedure.query(async () => {
    const database = await db();
    // THROW, never [] — the Queue's isError branch renders the honest outage
    // card; a 200-with-empty painted "no drafts" during a DB outage.
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — drafts cannot be read (outage, not an empty queue)." });
    const { socialContentInventory } = await import("../../drizzle/schema");
    const { desc } = await import("drizzle-orm");
    const rows = await database
      .select()
      .from(socialContentInventory)
      .orderBy(desc(socialContentInventory.createdAt))
      .limit(50);
      
    // Resolve the reel job behind each reel draft ONCE, in a single batched query,
    // so the Queue can offer per-job actions (re-run QA, repair, re-assemble).
    // Without this the client has no way to reach a reel job: brief_json.reelJobId
    // is written only by the cron manufacturing path — measured on prod, 0 of 32
    // reel inventory rows carry it — so reel_jobs.briefId is the real link for
    // everything else. Same resolution the publish authority uses, just batched.
    const reelJobByInventoryId = new Map<string, number>();
    try {
      const reelIds = rows.filter((r: typeof rows[number]) => r.contentType === "reel").map((r: typeof rows[number]) => r.id);
      if (reelIds.length) {
        const { reelJobs } = await import("../../drizzle/schema");
        const { inArray, asc } = await import("drizzle-orm");
        const jobs = await database
          .select({ id: reelJobs.id, briefId: reelJobs.briefId })
          .from(reelJobs)
          .where(inArray(reelJobs.briefId, reelIds))
          .orderBy(asc(reelJobs.id));
        // Ascending, so the LAST write wins => the newest job for that inventory row.
        for (const j of jobs) if (j.briefId) reelJobByInventoryId.set(j.briefId, Number(j.id));
      }
    } catch (e) {
      log.warn("could not resolve reel jobs for the queue (per-job actions will be unavailable)", e);
    }

    // Fetched ONCE for the whole page, not per draft. The badge should agree
    // with the gate that admits a brief, and that gate scores against the recent
    // window - but this is a list endpoint, so a per-row history read would be an
    // N+1 against a MEDIUMTEXT column. Skipped entirely when the page holds no
    // reels.
    let recentSignals: Awaited<ReturnType<typeof import("../services/reelRepetitionHistory").getRecentReelSignals>> | undefined;
    if (rows.some((r: typeof rows[number]) => r.contentType === "reel")) {
      const { getRecentReelSignals } = await import("../services/reelRepetitionHistory");
      recentSignals = await getRecentReelSignals();
    }

    const results = [];
    for (const r of rows) {
      let parsedBrief: any = {};
      try { parsedBrief = r.briefJson ? JSON.parse(r.briefJson) : {}; } catch {}
      let parsedAssetPaths: any[] = [];
      try { parsedAssetPaths = r.assetPaths ? (Array.isArray(r.assetPaths) ? r.assetPaths : JSON.parse(r.assetPaths as string)) : []; } catch {}
      
      const mappedStatus = mapInventoryStatusForQueue(r.status);
      
      const isReel = r.contentType === "reel";
      const mediaPath = parsedAssetPaths[0] || "";

      // scoreOverall 0 = never machine-evaluated (manual drafts). Surface that as
      // NO badge (client renders nothing for null) — the previous `|| 80` fallback
      // dressed unscored drafts up as a passing evaluation that never ran.
      let scoreObj: { gate: string; overall: number } | null =
        r.scoreOverall > 0 ? { gate: "pass", overall: r.scoreOverall } : null;
      if (isReel) {
        if (!parsedBrief || Object.keys(parsedBrief).length === 0) {
          scoreObj = { gate: "block", overall: 0 };
        } else {
          try {
            const { calculateReelQualityScore, isScorableReelBrief } = await import("../../client/src/lib/facelessReelStudio");
            if (!isScorableReelBrief(parsedBrief)) {
              // Historical rows predate the current ReelBrief shape. Treat
              // those as unscorable/fail-closed instead of throwing on a
              // missing array (observed in production 2026-09-28).
              scoreObj = { gate: "block", overall: 0 };
            } else {
              const qRes = calculateReelQualityScore(parsedBrief, undefined, { recent: recentSignals });
              scoreObj = { gate: qRes.passing ? "pass" : "block", overall: qRes.overall };
            }
          } catch (e) {
            log.warn("failed to calculate reel score in getAllDrafts", e);
            scoreObj = { gate: "block", overall: 0 };
          }
        }
      }

      results.push({
        id: r.id,
        // Optimistic-concurrency token — approveDraft REQUIRES
        // expectedVersion (approval-integrity arc). The list previously
        // omitted it, leaving the Queue call site with nothing to pass.
        version: r.version,
        status: mappedStatus,
        format: r.contentType,
        caption: r.hookText,
        /**
         * The AUTHORITATIVE caption this draft would publish with, built by
         * the same server function the publish path uses. The Reel queue's
         * confirm panel previously assembled its preview from caption +
         * hashtags fields — but reel hashtags live inside briefJson and the
         * list never returned them, so the panel said "exactly as shown" over
         * copy that was missing every hashtag the server would add.
         * `publishCaptionError` carries the overlength refusal so the panel
         * can say so BEFORE the final tap instead of erroring after it.
         */
        ...(isReel
          ? (() => {
              try {
                return { publishCaption: buildReelPublishCaption(r.briefJson, r.hookText), publishCaptionError: null as string | null };
              } catch (err) {
                return { publishCaption: null as string | null, publishCaptionError: err instanceof Error ? err.message : String(err) };
              }
            })()
          : { publishCaption: r.hookText, publishCaptionError: null as string | null }),
        assetPack: {
          imageUrl: isReel ? "" : mediaPath,
          videoUrl: isReel ? mediaPath : "",
        },
        qualityScore: scoreObj,
        // brief_json.reelJobId when the cron wrote it, else the batched briefId
        // lookup. null when neither resolves — the UI disables per-job actions
        // and says why rather than offering a control that cannot work.
        reelJobId: (parsedBrief && parsedBrief.reelJobId) ?? reelJobByInventoryId.get(r.id) ?? null,
        conceptBrief: { sourceSummary: r.topic, ...parsedBrief }
      });
    }
    return results;
  }),

  // getPerformanceInsights was removed here: it had no consumer anywhere in the
  // app and its payload was fabricated (qualityScore hardcoded 90, shares
  // hardcoded 0, a canned "insight" string) on top of getTopPosts, whose source
  // table is starved (see instagram.ts loadCache). Rebuild it against real data
  // if a Learn-panel consumer ever materializes.

  /** Reject a draft manually from the Queue */
  rejectDraft: adminProcedure
    .input(z.object({
      id: z.string(),
      reason: z.string().optional(),
      /** Optional for legacy callers; when supplied it joins the CAS. */
      expectedVersion: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // The old body was every anti-pattern this codebase has spent a week
      // deleting: `if (database)` returned {success:true} on a DB OUTAGE
      // (a lying success that wrote nothing), no status guard could relabel a
      // PUBLISHED row as rejected, and the unchecked update reported success
      // for zero matched rows.
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — nothing was rejected." });
      const { socialContentInventory } = await import("../../drizzle/schema");
      const { and, eq, inArray } = await import("drizzle-orm");
      const rows = await database.select({
        status: socialContentInventory.status,
        version: socialContentInventory.version,
        contentType: socialContentInventory.contentType,
        briefJson: socialContentInventory.briefJson,
      })
        .from(socialContentInventory).where(eq(socialContentInventory.id, input.id)).limit(1);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
      const REJECTABLE = ["pending", "needs_review", "review_ready", "ready", "failed", "draft", "generating"];
      if (!REJECTABLE.includes(rows[0].status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A ${rows[0].status} item cannot be rejected from here${rows[0].status === "scheduled" ? " — unschedule it first" : rows[0].status === "ambiguous" ? " — resolve the ambiguous publish first" : ""}.`,
        });
      }
      const { affectedRowCount } = await import("../lib/db-affected");
      const rejected = await database.update(socialContentInventory)
        .set({ status: "rejected", errorMessage: input.reason ?? "Manual rejection", version: rows[0].version + 1, updatedAt: new Date() })
        .where(and(
          eq(socialContentInventory.id, input.id),
          inArray(socialContentInventory.status, REJECTABLE),
          eq(socialContentInventory.version, input.expectedVersion ?? rows[0].version),
        ));
      if (affectedRowCount(rejected) === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "The draft changed while you were deciding (it may have been approved or published). Refresh before rejecting." });
      }
      // A Reel's publish consent lives on its reel job, not on this row. Setting
      // "rejected" alone left any live approval standing, so the autonomous cron
      // published the reel the operator had just rejected. Withdraw it here.
      // The row is already rejected, and the cron + auto-approval both hold a
      // rejected row on their own, so a failed revoke is reported, not thrown.
      if (rows[0].contentType !== "reel") return { success: true };
      let revokedApprovals: number | null = null;
      try {
        const { resolveReelJobId } = await import("../services/reelPublishAuthority");
        const jobId = await resolveReelJobId(database, { id: input.id, briefJson: rows[0].briefJson });
        if (jobId) {
          const { revokeReelApproval } = await import("../services/reelApproval");
          revokedApprovals = (await revokeReelApproval({ jobId, revokedBy: `rejected in Queue by admin:${ctx.user?.id ?? "unknown"}` })).revoked;
        } else {
          revokedApprovals = 0;
        }
      } catch (err) {
        log.error("reel draft rejected but its publish approval could not be revoked — the inventory hold still stops the cron", {
          inventoryId: input.id,
          err: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
      }
      return { success: true, revokedApprovals };
    }),

  // §K.4 real-shop media flywheel — "Capture opportunity" for the Today tab:
  // subjects the upcoming slate needs a real photo of and the pool cannot
  // supply. Read-only. A pool-read failure throws (dbAdminProcedure + the
  // service), so the card renders unknown rather than a clean empty list.
  getCaptureOpportunities: dbAdminProcedure.query(async () => {
    const { getDbTyped } = await import("../db");
    const database = await getDbTyped();
    if (!database) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable — capture opportunities are unknown, not empty." });
    const { captureOpportunities } = await import("../services/instagramAdminStrategy");
    return captureOpportunities(database);
  }),

  /** Creative Assistant (Wave C, README §M) — "what should we make today?"
   *  Five cards max, each with the exact signal lines it was ranked on; a
   *  failed source renders as `inputs.<source> = "error: …"` and its cards
   *  are omitted, never scored on a zero. Deterministic, no LLM. */
  getCreativeAssistant: adminProcedure.query(async () => {
    const { buildCreativeAssistant } = await import("../services/creativeAssistant");
    return buildCreativeAssistant();
  }),
});

export async function validateFinalMedia(mp4Url: string, expectedDuration: number): Promise<{ valid: boolean; error?: string; mediaHash?: string }> {
  if (mp4Url.startsWith("mock://")) {
    return { valid: true, mediaHash: "mocked_media_hash_32chars_long_hash" };
  }

  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);
  const fs = await import("fs");
  const path = await import("path");
  const os = await import("os");
  const crypto = await import("crypto");

  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `reel_val_${crypto.randomBytes(16).toString("hex")}.mp4`);

  try {
    const response = await fetch(mp4Url);
    if (!response.ok) {
      return { valid: false, error: `Failed to download video: HTTP ${response.status}` };
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.promises.writeFile(tempFilePath, buffer);

    const mediaHash = crypto.createHash("sha256").update(buffer).digest("hex");

    const ffprobeArgs = [
      "-v", "error",
      "-show_entries", "stream=width,height,codec_name,codec_type",
      "-show_entries", "format=duration",
      "-of", "json",
      tempFilePath
    ];

    const { stdout } = await execFileAsync("ffprobe", ffprobeArgs);
    const info = JSON.parse(stdout);

    const streams = info.streams || [];
    const format = info.format || {};

    const videoStream = streams.find((s: any) => s.codec_type === "video");
    const audioStream = streams.find((s: any) => s.codec_type === "audio");

    if (!videoStream) {
      return { valid: false, error: "No video stream found in media asset." };
    }

    const { width, height, codec_name: videoCodec } = videoStream;
    if (width !== 1080 || height !== 1920) {
      return { valid: false, error: `Invalid resolution: expected vertical 1080x1920, got ${width}x${height}` };
    }

    if (videoCodec !== "h264" && videoCodec !== "libx264") {
      return { valid: false, error: `Invalid video codec: expected H.264, got ${videoCodec}` };
    }

    if (!audioStream) {
      return { valid: false, error: "Audio stream is missing from the Reel. Instagram Reels require an audio stream." };
    }

    const duration = parseFloat(format.duration);
    if (isNaN(duration) || Math.abs(duration - expectedDuration) > 1.5) {
      return { valid: false, error: `Invalid duration: expected ~${expectedDuration}s, got ${duration}s` };
    }

    return { valid: true, mediaHash };
  } catch (err) {
    return { valid: false, error: `Media validation failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    try {
      if (fs.existsSync(tempFilePath)) {
        await fs.promises.unlink(tempFilePath);
      }
    } catch (e) {
      log.warn("failed to clean up temp media validation file", e);
    }
  }
}
