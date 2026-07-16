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
import { desc, sql, gte, and, eq } from "drizzle-orm";
import { router, adminProcedure } from "../_core/trpc";
import { checkReviewReply, buildReplyPromptRules, hasBlockingFindings } from "@shared/reviewReplyQa";
import { IG_ARCHETYPES } from "@shared/const";
import { invokeLLM } from "../_core/llm";
import { sanitizeText } from "../sanitize";
import { affectedRowCount } from "../lib/db-affected";
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";

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

export const instagramAdminRouter = router({
  /** Connection diagnostics: credential/token status + durable-store fingerprint
   *  + a LIVE Graph probe. Presence checks alone showed "ready" with a dead
   *  token (revoked permissions, password reset, unlinked page) — `live` is the
   *  Graph API's own answer, cached 5 minutes so UI polling can't burn quota. */
  getConnectionStatus: adminProcedure.query(async () => {
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
    const { getMetaSocialStatus } = await import("../services/metaSocial");
    const meta = await getMetaSocialStatus();

    const database = await db();
    let failedJobs = 0;
    if (database) {
      const { reelJobs } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const result = await database.select().from(reelJobs).where(eq(reelJobs.status, "failed"));
      failedJobs = result.length;
    }

    return {
      storage: {
        configured: !!process.env.S3_BUCKET && !!process.env.CLOUDFRONT_DOMAIN,
        permanentUrls: !!process.env.CLOUDFRONT_DOMAIN,
      },
      generator: await (async () => {
        // The background reel pipeline generates video with VEO, not Higgsfield.
        // Reporting Higgsfield-credential presence here was a lie: the card
        // showed green while Veo (the active worker) had no key. Report the
        // ACTIVE provider and ITS credentials. REEL_VIDEO_PROVIDER lets the
        // operator name the provider explicitly; default reflects the code path
        // (reelPipeline.submitVeoRequest → Veo).
        const provider = (process.env.REEL_VIDEO_PROVIDER || "veo").toLowerCase();
        const { veoCredentialsPresent } = await import("../services/veoStudio");
        const higgsfieldConfigured = !!(await (await import("../services/higgsfieldStudio")).getHiggsfieldCredentialsJson());
        const configured = provider === "higgsfield" ? higgsfieldConfigured : veoCredentialsPresent();
        return {
          provider,
          configured,
          enabled: process.env.REEL_GENERATION_ENABLED === "true",
          // Kept so the Settings UI can still surface Higgsfield status separately
          // (it's the carousel/image path), without conflating it with the reel
          // video generator's health.
          higgsfieldConfigured,
        };
      })(),
      meta: {
        connected: meta.configured && (meta.facebookReady || meta.instagramReady),
      },
      failedJobs,
    };
  }),

  /** Account header (username, followers, etc.) from the cached feed. */
  getAccountInfo: adminProcedure.query(async () => {
    const { getInstagramAccount } = await import("../instagram");
    return getInstagramAccount();
  }),

  /** Recent posts from the cached feed (refresh via syncFeed). */
  getLiveFeed: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(24) }).optional())
    .query(async ({ input }) => {
      const { getInstagramPosts } = await import("../instagram");
      return getInstagramPosts(input?.limit ?? 24);
    }),

  /** Content-intelligence bundle: four fast, already-built analytics reports. */
  getAnalytics: adminProcedure.query(async () => {
    const { getEngagementByType, getBestPostingTimes, getFollowerGrowth, getTopPosts } = await import(
      "../pipelines/instagram-data"
    );
    const [engagementByType, bestPostingTimes, followerGrowth, topPosts] = await Promise.all([
      getEngagementByType(),
      getBestPostingTimes({ limit: 7 }),
      getFollowerGrowth(),
      getTopPosts({ limit: 5 }),
    ]);
    return { engagementByType, bestPostingTimes, followerGrowth, topPosts };
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
  getCreationBrief: adminProcedure.query(async () => {
    const { getTopPosts } = await import("../pipelines/instagram-data");
    const topPosts = await getTopPosts({ limit: 5 });

    // Compute best-performing archetype from the last 30 days of posted content.
    // Falls back to "proof" (highest base rate at 50%) if no data exists yet.
    let topArchetype = "proof";
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
        }
      }
    } catch (err) {
      log.warn("Failed to compute top archetype from ig_autopost_log, using fallback", err);
    }

    return {
      topArchetypeLast30Days: topArchetype,
      optimalPostingWindow: "Tuesdays at 4:30 PM",
      topicsToAvoid: ["generic holiday posts", "long text captions without images"],
      recentWinners: topPosts.map(p => ({
        id: p.postId,
        caption: p.caption?.substring(0, 50) + "..."
      }))
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

  /** Mint a never-expiring Page token from a pasted short-lived user token. */
  reconnectToken: adminProcedure
    .input(z.object({ userToken: z.string().min(10) }))
    .mutation(async ({ input }) => {
      const { reconnectMetaFromUserToken } = await import("../services/metaSocial");
      const result = await reconnectMetaFromUserToken(input.userToken.trim());
      // Never return the token itself to the client — only success + error.
      return { ok: result.ok, error: result.error ?? null };
    }),

  /** AI co-pilot: generate + eval an IG post. Dry-run by default (logs +
   *  Telegram preview); only posts live when the legacy_autopost_live flag
   *  is enabled — so this is safe to expose without a live-publish toggle. */
  generatePost: adminProcedure
    .input(z.object({
      archetype: z.enum(IG_ARCHETYPES).optional(),
      customConcept: z.string().trim().max(1000).optional(),
    }).optional())
    .mutation(async ({ input }) => {
      const { runIgAutopostOneOff } = await import("../services/igAutopost");
      return runIgAutopostOneOff(input?.archetype, input?.customConcept);
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

  /** Recent AI generations (from ig_autopost_log) so the composer can show
   *  the actual draft the co-pilot produced — generatePost returns scores +
   *  status but not the caption/image (those go to the log + Telegram). */
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
      if (!database) return [];
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

        await tx.insert(socialContentApprovals).values({
          id: approvalId,
          inventoryId: draft.id,
          version: input.expectedVersion,
          approvedBy: ctx.user.id,
          briefHash,
          mediaHash: validation.mediaHash,
          mediaUrl: videoUrl,
        });
      });

      return { success: true };
    }),

  /** Higgsfield (reels) account health for the Settings panel — creds validity
   *  + remaining credit balance. Runs the CLI (~1-15s) so it's its own query
   *  with its own loading state, not folded into the fast getProviderHealth. */
  getHiggsfieldHealth: adminProcedure.query(async () => {
    const { getHiggsfieldAccountHealth } = await import("../services/higgsfieldStudio");
    return getHiggsfieldAccountHealth();
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
    const imageHealthy =
      imageProvider === "adrender" ? true
      : imageProvider === "higgsfield" ? higgsfieldCreds
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
        higgsfieldCreds,
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

  /** Publish a custom image or Reel to Instagram directly. */
  publishPost: adminProcedure
    .input(z.object({
      inventoryId: z.string().optional(),
      platforms: z.array(z.enum(["facebook", "instagram"])).min(1, "Select at least one platform"),
      caption: z.string().min(1).max(2200),
      imageUrl: z.string().url().optional(),
      imageUrls: z.array(z.string().url()).min(2).max(10).optional(),
      videoUrl: z.string().url().optional(),
    }))
    .mutation(async ({ input }) => {
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      
      let publishCaption = input.caption;
      let publishVideoUrl = input.videoUrl;
      // Re-asserted as a compare-and-set immediately before the Meta call. Reading
      // the status and acting on it are two statements; without a claim between
      // them two concurrent callers both pass every gate and both publish. Same
      // at-most-once idiom as cron/jobs/crudAutomation.ts:507.
      let observedStatus: string | null = null;

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

            const approvals = await database
              .select()
              .from(socialContentApprovals)
              .where(and(eq(socialContentApprovals.inventoryId, draft.id), eq(socialContentApprovals.version, draft.version - 1)))
              .limit(1);
            if (approvals.length === 0) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "No active approval record found for this version of the Reel.",
              });
            }

            const approval = approvals[0];
            const { createHash } = await import("crypto");
            const currentBriefHash = createHash("sha256").update(draft.briefJson || "").digest("hex");
            
            let currentMediaHash = "";
            if (approvedVideoUrl.startsWith("mock://")) {
              currentMediaHash = "mocked_media_hash_32chars_long_hash";
            } else {
              const response = await fetch(approvedVideoUrl);
              if (!response.ok) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `Failed to download video for publishing: HTTP ${response.status}`,
                });
              }
              const buffer = Buffer.from(await response.arrayBuffer());
              currentMediaHash = createHash("sha256").update(buffer).digest("hex");
            }

            if (currentBriefHash !== approval.briefHash || currentMediaHash !== approval.mediaHash) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Integrity breach: Current brief or media hash does not match approved values.",
              });
            }

            publishCaption = approvedCaption;
            publishVideoUrl = approvedVideoUrl;
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
      const setInventoryStatus = async (status: string, errorMessage?: string) => {
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

      let results: Awaited<ReturnType<typeof publishToSocial>>["results"];
      let igPostId: string | undefined;
      try {
        ({ results, igPostId } = await publishToSocial({
          ...input,
          caption: publishCaption,
          videoUrl: publishVideoUrl,
        }));
      } catch (err) {
        // The claim must not outlive a throw, or the draft wedges in "publishing"
        // and every later attempt hits the CONFLICT guard above.
        await setInventoryStatus(observedStatus ?? "failed", err instanceof Error ? err.message : String(err));
        throw err;
      }

      const succeeded = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);
      const failureDetail = failed.map((r) => `${r.platform}: ${r.error}`).join("; ");

      if (succeeded.length === 0) {
        await setInventoryStatus("failed", failureDetail);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Publish failed: ${failureDetail}`,
        });
      }

      if (failed.length > 0) {
        // At least one platform is LIVE and at least one is not. Recording this as
        // "published" is what let the Queue's onSuccess toast report success for a
        // post that never reached Instagram — so this throws instead.
        await setInventoryStatus("published_partial", failureDetail);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Partially published — LIVE on ${succeeded.map((r) => r.platform).join(", ")}; FAILED on ${failureDetail}. Do NOT retry: re-publishing would duplicate the live post. Post the failed platform manually.`,
        });
      }

      await setInventoryStatus("published");

      return { success: true, results, postId: igPostId };
    }),

  /** Schedule a post for later. The scheduled-posts cron fires it at scheduledAt.
   *  Same claim-safety gate as publishPost, applied now at schedule time. */
  schedulePost: adminProcedure
    .input(z.object({
      inventoryId: z.string().optional(),
      platforms: z.array(z.enum(["facebook", "instagram"])).min(1),
      caption: z.string().min(1).max(2200),
      imageUrl: z.string().url().optional(),
      imageUrls: z.array(z.string().url()).min(2).max(10).optional(),
      videoUrl: z.string().url().optional(),
      scheduledAt: z.string().datetime(),
    }))
    .mutation(async ({ input }) => {
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      let publishCaption = input.caption;
      let publishVideoUrl = input.videoUrl;

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
          if (draft.contentType === "reel") {
            if (draft.status !== "ready") {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "This Reel draft must be reviewed and approved before scheduling.",
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

            const approvals = await database
              .select()
              .from(socialContentApprovals)
              .where(and(eq(socialContentApprovals.inventoryId, draft.id), eq(socialContentApprovals.version, draft.version - 1)))
              .limit(1);
            if (approvals.length === 0) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "No active approval record found for this version of the Reel.",
              });
            }

            const approval = approvals[0];
            const { createHash } = await import("crypto");
            const currentBriefHash = createHash("sha256").update(draft.briefJson || "").digest("hex");
            const currentMediaHash = createHash("sha256").update(approvedVideoUrl).digest("hex");

            if (currentBriefHash !== approval.briefHash || currentMediaHash !== approval.mediaHash) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Integrity breach: Current brief or media hash does not match approved values.",
              });
            }

            publishCaption = approvedCaption;
            publishVideoUrl = approvedVideoUrl;
          }
        }
      } else {
        if (input.videoUrl) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Scheduling a Reel requires a valid, approved inventoryId.",
          });
        }
      }

      const { captionClaimBlockers, assertPermanentPublicMediaUrl } = await import("../services/socialPublish");
      if (publishVideoUrl) assertPermanentPublicMediaUrl(publishVideoUrl);
      
      const blockers = captionClaimBlockers(publishCaption);
      if (blockers.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Claim-safety: ${blockers.map((f) => `${f.rule} ("${f.match}")`).join("; ")} — edit the caption first.`,
        });
      }
      const when = new Date(input.scheduledAt);
      if (when.getTime() <= Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Scheduled time must be in the future." });
      }
      
      const { scheduledPosts, socialContentInventory } = await import("../../drizzle/schema");
      await database.insert(scheduledPosts).values({
        platforms: input.platforms,
        caption: publishCaption,
        imageUrl: input.imageUrl ?? null,
        videoUrl: publishVideoUrl ?? null,
        imageUrls: input.imageUrls ?? null,
        scheduledAt: when,
        status: "pending",
      });

      if (input.inventoryId) {
        const { eq } = await import("drizzle-orm");
        await database.update(socialContentInventory)
          .set({ status: "scheduled", scheduledAt: when, updatedAt: new Date() })
          .where(eq(socialContentInventory.id, input.inventoryId));
      }

      return { ok: true, scheduledAt: when.toISOString() };
    }),

  /** List scheduled posts, newest scheduled time first. */
  listScheduled: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ input }) => {
      const database = await db();
      if (!database) return [];
      const { scheduledPosts } = await import("../../drizzle/schema");
      return database
        .select()
        .from(scheduledPosts)
        .orderBy(desc(scheduledPosts.scheduledAt))
        .limit(input?.limit ?? 50);
    }),

  /** Cancel a still-pending scheduled post (DB-only — nothing posts). */
  cancelScheduled: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { scheduledPosts } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      await database
        .update(scheduledPosts)
        .set({ status: "canceled" })
        .where(and(eq(scheduledPosts.id, input.id), eq(scheduledPosts.status, "pending")));
      return { ok: true };
    }),

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
            ])
          );
        for (const r of rows) {
          if (r.k === "ig_autopost_image_provider") imageProvider = r.v;
          if (r.k === "higgsfield_credentials_json" && r.v) hasHiggsfieldCreds = true;
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

      return { success: true };
    }),

  /** Get all Instagram Drafts for the Queue */
  getAllDrafts: adminProcedure.query(async () => {
    const database = await db();
    if (!database) return [];
    const { socialContentInventory } = await import("../../drizzle/schema");
    const { desc } = await import("drizzle-orm");
    const rows = await database
      .select()
      .from(socialContentInventory)
      .orderBy(desc(socialContentInventory.createdAt))
      .limit(50);
      
    const results = [];
    for (const r of rows) {
      let parsedBrief: any = {};
      try { parsedBrief = r.briefJson ? JSON.parse(r.briefJson) : {}; } catch {}
      let parsedAssetPaths: any[] = [];
      try { parsedAssetPaths = r.assetPaths ? (Array.isArray(r.assetPaths) ? r.assetPaths : JSON.parse(r.assetPaths as string)) : []; } catch {}
      
      let mappedStatus = r.status;
      if (r.status === "assets_ready") mappedStatus = "ready";
      if (r.status === "pending") mappedStatus = "needs_review";
      if (r.status === "approved") mappedStatus = "ready";
      if (r.status === "generating") mappedStatus = "needs_review";
      
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
            const { calculateReelQualityScore } = await import("../../client/src/lib/facelessReelStudio");
            const qRes = calculateReelQualityScore(parsedBrief);
            scoreObj = { gate: qRes.passing ? "pass" : "block", overall: qRes.overall };
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
        assetPack: { 
          imageUrl: isReel ? "" : mediaPath,
          videoUrl: isReel ? mediaPath : "",
        },
        qualityScore: scoreObj,
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
      reason: z.string().optional()
    }))
    .mutation(async ({ input }) => {
      const database = await db();
      if (database) {
        const { socialContentInventory } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await database.update(socialContentInventory)
          .set({ status: "rejected", errorMessage: input.reason, updatedAt: new Date() })
          .where(eq(socialContentInventory.id, input.id));
      }
      return { success: true };
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
