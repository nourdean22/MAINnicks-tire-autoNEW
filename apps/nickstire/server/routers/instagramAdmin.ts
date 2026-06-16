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
import { router, adminProcedure } from "../_core/trpc";
import { checkReviewReply, buildReplyPromptRules, hasBlockingFindings } from "@shared/reviewReplyQa";
import { invokeLLM } from "../_core/llm";
import { sanitizeText } from "../sanitize";
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
    .input(z.object({ commentText: z.string().min(1).max(2000) }))
    .mutation(async ({ input }) => {
      const prompt = `You manage the Instagram account for Nick's Tire & Auto, a neighborhood Cleveland-area shop.
A follower left this comment on one of our posts: "${input.commentText}"

Write a warm, human, 1-2 sentence public reply that sounds like the shop owner, not a brand.
${buildReplyPromptRules()}
Keep it under 200 characters.`;

      let draft = "";
      try {
        const result = await invokeLLM({
          messages: [{ role: "user", content: prompt }],
          maxTokens: 200,
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
    .input(z.object({ archetype: z.enum(ARCHETYPES).optional() }).optional())
    .mutation(async ({ input }) => {
      const { runIgAutopostOneOff } = await import("../services/igAutopost");
      return runIgAutopostOneOff(input?.archetype);
    }),
});
