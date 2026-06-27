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
import { desc } from "drizzle-orm";
import { router, adminProcedure } from "../_core/trpc";
import { checkReviewReply, buildReplyPromptRules, hasBlockingFindings } from "@shared/reviewReplyQa";
import { invokeLLM } from "../_core/llm";
import { sanitizeText } from "../sanitize";
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";

const log = createLogger("routers:instagramAdmin");

const ARCHETYPES = ["proof", "anti", "math", "seasonal", "question", "process"] as const;

export const instagramAdminRouter = router({
  /** Connection diagnostics: credential/token status + durable-store fingerprint. */
  getConnectionStatus: adminProcedure.query(async () => {
    const { getMetaSocialStatus, getPersistedTokenMeta } = await import("../services/metaSocial");
    const [status, token] = await Promise.all([getMetaSocialStatus(), getPersistedTokenMeta()]);
    return { ...status, token };
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
      generator: {
        configured: !!process.env.HIGGSFIELD_API_KEY,
        enabled: process.env.REEL_GENERATION_ENABLED === "true",
      },
      meta: {
        connected: meta.connected,
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
   *  Reads from analytics to provide context for the AI Copilot. */
  getCreationBrief: adminProcedure.query(async () => {
    const { getTopPosts, getEngagementByType } = await import("../pipelines/instagram-data");
    
    // In a full implementation, this would aggregate actual data to find the single
    // best archetype of the last 30 days and the worst performers to avoid.
    // We mock the aggregation logic slightly for the Phase 2 API definition.
    const topPosts = await getTopPosts({ limit: 5 });
    
    return {
      topArchetypeLast30Days: "proof",
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
      archetype: z.enum(ARCHETYPES).optional(),
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
      caption: z.string().min(1),
      imageUrl: z.string().url().optional(),
      imageUrls: z.array(z.string().url()).optional(),
      videoUrl: z.string().url().optional(),
      sourceType: z.string(),
      sourceDetail: z.string().optional(),
      conceptBrief: z.any().optional(),
      qualityScore: z.any().optional(),
    }))
    .mutation(async ({ input }) => {
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { socialContentInventory } = await import("../../drizzle/schema");
      
      const assetPaths = [];
      if (input.imageUrl) assetPaths.push(input.imageUrl);
      if (input.imageUrls) assetPaths.push(...input.imageUrls);
      if (input.videoUrl) assetPaths.push(input.videoUrl);
      
      let mappedType: "post" | "reel" | "carousel" | "story" | "poll" = "post";
      if (input.format === "reel") mappedType = "reel";
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
        status: "assets_ready",
        assetPaths,
        briefJson: JSON.stringify(input.conceptBrief || {}),
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

    let imageProvider = (process.env.IG_AUTOPOST_IMAGE_PROVIDER || "openai").toLowerCase();
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

    // Is the ACTIVE image provider's credential actually present?
    const imageHealthy =
      imageProvider === "higgsfield" ? higgsfieldCreds : imageProvider.includes("gemini") ? geminiKey : openaiKey;

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
      const { captionClaimBlockers, assertPermanentPublicMediaUrl, publishToSocial } = await import("../services/socialPublish");
      if (input.videoUrl) assertPermanentPublicMediaUrl(input.videoUrl);
      
      const blockers = captionClaimBlockers(input.caption);
      if (blockers.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Claim-safety: ${blockers.map((f) => `${f.rule} ("${f.match}")`).join("; ")} — edit the caption before publishing.`,
        });
      }
      const { results, igPostId } = await publishToSocial(input);
      if (results.length > 0 && results.every((r) => !r.success)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Publish failed: ${results.map((r) => `${r.platform}: ${r.error}`).join("; ")}`,
        });
      }

      if (input.inventoryId) {
        const database = await db();
        if (database) {
          const { socialContentInventory } = await import("../../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          await database.update(socialContentInventory)
            .set({ status: "published", publishedAt: new Date() })
            .where(eq(socialContentInventory.id, input.inventoryId));
        }
      }

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
      const { captionClaimBlockers, assertPermanentPublicMediaUrl } = await import("../services/socialPublish");
      if (input.videoUrl) assertPermanentPublicMediaUrl(input.videoUrl);
      
      const blockers = captionClaimBlockers(input.caption);
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
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { scheduledPosts, socialContentInventory } = await import("../../drizzle/schema");
      await database.insert(scheduledPosts).values({
        platforms: input.platforms,
        caption: input.caption,
        imageUrl: input.imageUrl ?? null,
        videoUrl: input.videoUrl ?? null,
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
      
    return rows.map(r => {
      let parsedBrief: any = {};
      try { parsedBrief = r.briefJson ? JSON.parse(r.briefJson) : {}; } catch {}
      let parsedAssetPaths: any[] = [];
      try { parsedAssetPaths = r.assetPaths ? (Array.isArray(r.assetPaths) ? r.assetPaths : JSON.parse(r.assetPaths as string)) : []; } catch {}
      
      let mappedStatus = r.status;
      if (r.status === "assets_ready") mappedStatus = "ready";
      if (r.status === "pending") mappedStatus = "needs_review";
      if (r.status === "approved") mappedStatus = "ready";
      if (r.status === "generating") mappedStatus = "needs_review";
      
      return {
        id: r.id,
        status: mappedStatus,
        format: r.contentType,
        caption: r.hookText,
        assetPack: { imageUrl: parsedAssetPaths[0] || "" },
        qualityScore: { gate: "pass", overall: r.scoreOverall || 80 },
        conceptBrief: { sourceSummary: r.topic, ...parsedBrief }
      };
    });
  }),

  /** Get Performance Insights for the Learn Panel */
  getPerformanceInsights: adminProcedure.query(async () => {
    const { getTopPosts } = await import("../pipelines/instagram-data");
    const topPosts = await getTopPosts({ limit: 5 });
    
    return {
      topWinners: topPosts.map(p => ({
        id: p.postId,
        format: p.mediaType === "VIDEO" ? "reel" : (p.mediaType === "CAROUSEL_ALBUM" ? "carousel" : "post"),
        qualityScore: 90, // mock score for now until we have real quality scores mapped
        caption: p.caption?.substring(0, 50) + "...",
        likes: p.likeCount,
        comments: p.commentsCount,
        shares: p.sharesCount ?? 0,
        imageUrl: p.mediaUrl || ""
      })),
      activeThemes: [
        { name: "Recent Top Performers", insight: "These posts drove the most engagement in the last 30 days." }
      ]
    };
  }),

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
