/**
 * Review Replies Router
 * Fetch, draft, approve, and post replies to Google reviews
 * Integrates with Google Places API for review fetching
 */
import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { eq, asc, desc, sql } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";
import { sanitizeText } from "../sanitize";
import { TRPCError } from "@trpc/server";
import { buildPlaceDetailsUrl } from "@shared/const";
import { buildReplyPromptRules, checkReviewReply } from "@shared/reviewReplyQa";

import { db } from "../lib/db-helper";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:reviewReplies");
async function fetchNewReviewsFromGoogle(): Promise<any[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY not configured");
  }

  // NO catch-and-return-[]. This function used to swallow every failure —
  // 429, 500, timeout, DNS — and return an empty array, so the mutation
  // resolved {created:0, total:0} and the Growth screen printed "Last run: 0
  // new drafts from 0 reviews" as a SUCCESS. A fresh 1-star review sat undrafted
  // while the operator had positive confirmation there was nothing to draft.
  // The client already renders an error branch (fetchNew.error); it was just
  // never reachable because nothing propagated. The !apiKey branch above already
  // throws, so letting these throw too is consistent — a failed fetch is a
  // failed run, not an empty result.
  const response = await fetch(buildPlaceDetailsUrl(apiKey, "reviews"), {
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Google Places API error: ${response.status}`);
  }

  const data = await response.json();
  return data.result?.reviews || [];
}

async function generateAIDraftReply(review: any): Promise<string> {
  const prompt = `You are a professional auto repair shop manager responding to a Google review.
The customer gave a ${review.rating}-star review with this comment: "${review.text}"

Write a warm, professional 2-3 sentence response that:
1. Thanks them for the feedback
2. If negative (1-3 stars): Apologizes and offers to make it right
3. If positive (4-5 stars): Mentions one specific thing that went well and invites them back

${buildReplyPromptRules()}

Keep it under 160 characters.`;

  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      // gemini-2.5-flash's thinking overhead ate the 256 budget -> empty reply
      // -> the generic "Thank you for your review!" fallback fired every time.
      // 2048 leaves room for the thinking plus a short personalized reply.
      maxTokens: 2048,
    });

    const content = result.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return sanitizeText(content);
    }
    throw new Error("Invalid LLM response");
  } catch (err) {
    log.error("[ReviewReplies] AI draft generation failed:", err);
    return "Thank you for your review! We appreciate your feedback.";
  }
}

export const reviewRepliesRouter = router({
  /** Fetch new reviews from Google Places and generate AI drafts (admin) */
  fetchNewReviews: adminProcedure.mutation(async () => {
    const { reviewReplies } = await import("../../drizzle/schema");
    const database = await db();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

    const reviews = await fetchNewReviewsFromGoogle();
    let created = 0;

    for (const review of reviews) {
      const reviewId = review.time?.toString() || `${review.author_name}_${Date.now()}`;

      // Check if already exists
      const existing = await database
        .select()
        .from(reviewReplies)
        .where(eq(reviewReplies.reviewId, reviewId))
        .limit(1);

      if (existing.length > 0) {
        continue;
      }

      // Generate AI draft
      const draftReply = await generateAIDraftReply(review);

      // Insert new review reply record
      await database.insert(reviewReplies).values({
        reviewId,
        reviewerName: review.author_name || "Anonymous",
        reviewRating: review.rating || 3,
        reviewText: sanitizeText(review.text),
        reviewDate: review.time ? new Date(review.time * 1000) : new Date(),
        draftReply,
        status: "draft",
      });

      created++;
    }

    return { created, total: reviews.length };
  }),

  /** List all review replies with filtering (admin) */
  list: adminProcedure
    .input(
      z.object({
        status: z.enum(["draft", "approved", "skipped", "posted"]).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
    )
    .query(async ({ input }) => {
      const { reviewReplies } = await import("../../drizzle/schema");
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const query = input.status
        ? database.select().from(reviewReplies).where(eq(reviewReplies.status, input.status))
        : database.select().from(reviewReplies);

      // Operator queue order: worst rating first (angry reviews are the
      // urgent ones), newest first within a rating.
      return query
        .orderBy(asc(reviewReplies.reviewRating), desc(reviewReplies.reviewDate))
        .limit(input.limit);
    }),

  /** Update draft reply text (admin) */
  updateDraft: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        draftReply: z.string().min(1).max(500),
      })
    )
    .mutation(async ({ input }) => {
      const { reviewReplies } = await import("../../drizzle/schema");
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const cleaned = sanitizeText(input.draftReply);

      await database
        .update(reviewReplies)
        .set({ draftReply: cleaned })
        .where(eq(reviewReplies.id, input.id));

      return { success: true };
    }),

  /** Approve a draft for posting (admin) */
  approve: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const { reviewReplies } = await import("../../drizzle/schema");
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const record = await database
        .select()
        .from(reviewReplies)
        .where(eq(reviewReplies.id, input.id))
        .limit(1);

      if (!record.length || !record[0].draftReply) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Review or draft not found" });
      }

      // Claim-safety gate: a reply with a blocking finding can never be
      // approved — the operator edits the draft first. Same rule family
      // the GBP Q&A seeds are test-enforced against.
      const blockers = checkReviewReply(record[0].draftReply).filter((f) => f.severity === "block");
      if (blockers.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Claim-safety: ${blockers.map((f) => `${f.rule} ("${f.match}")`).join("; ")} — edit the draft first.`,
        });
      }

      await database
        .update(reviewReplies)
        .set({
          finalReply: record[0].draftReply,
          status: "approved",
          approvedAt: new Date(),
        })
        .where(eq(reviewReplies.id, input.id));

      return { success: true };
    }),

  /** Skip replying to a review (admin) */
  skip: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const { reviewReplies } = await import("../../drizzle/schema");
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      await database
        .update(reviewReplies)
        .set({ status: "skipped" })
        .where(eq(reviewReplies.id, input.id));

      return { success: true };
    }),

  /** Owner confirms an approved reply was pasted into Google (admin).
   *  DB-only — records the outcome; nothing is sent to Google from here.
   *  Only reachable from "approved" so "posted" always means a final
   *  reply existed and the owner explicitly confirmed pasting it. */
  markPosted: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const { reviewReplies } = await import("../../drizzle/schema");
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const record = await database
        .select()
        .from(reviewReplies)
        .where(eq(reviewReplies.id, input.id))
        .limit(1);

      if (!record.length) {
        throw new Error("Review reply not found");
      }
      if (record[0].status !== "approved") {
        throw new Error("Only approved replies can be marked posted — approve the draft first");
      }

      await database
        .update(reviewReplies)
        .set({ status: "posted", postedAt: new Date() })
        .where(eq(reviewReplies.id, input.id));

      return { success: true };
    }),

  /** Get stats on review replies (admin) */
  stats: adminProcedure.query(async () => {
    const { reviewReplies } = await import("../../drizzle/schema");
    const database = await db();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

    const [drafts, approved, skipped, posted, oldestApproved] = await Promise.all([
      database.select({ count: sql<number>`count(*)` }).from(reviewReplies).where(eq(reviewReplies.status, "draft")),
      database.select({ count: sql<number>`count(*)` }).from(reviewReplies).where(eq(reviewReplies.status, "approved")),
      database.select({ count: sql<number>`count(*)` }).from(reviewReplies).where(eq(reviewReplies.status, "skipped")),
      database.select({ count: sql<number>`count(*)` }).from(reviewReplies).where(eq(reviewReplies.status, "posted")),
      // Backlog rot signal: the oldest approved-but-not-posted reply.
      database
        .select({ oldest: sql<Date | string | null>`min(${reviewReplies.approvedAt})` })
        .from(reviewReplies)
        .where(eq(reviewReplies.status, "approved")),
    ]);

    const d = drafts[0]?.count ?? 0;
    const a = approved[0]?.count ?? 0;
    const s = skipped[0]?.count ?? 0;
    const p = posted[0]?.count ?? 0;
    const oldestRaw = oldestApproved[0]?.oldest ?? null;
    const oldestApprovedAt = oldestRaw ? new Date(oldestRaw) : null;

    return {
      draft: d,
      approved: a,
      skipped: s,
      posted: p,
      total: d + a + s + p,
      /** When the oldest still-unposted approved reply was approved (null if none). */
      oldestApprovedAt,
    };
  }),

  /** Intelligence Endpoint: Clusters reviews by theme to use as content seeds (admin) */
  getContentClusters: adminProcedure.query(async () => {
    const { reviewReplies } = await import("../../drizzle/schema");
    const database = await db();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

    // Fetch all reviews to cluster them by keyword.
    // In a full production pipeline, this would run asynchronously in a cron and store to a table.
    // For Phase 2, we perform basic keyword extraction over the active review table.
    const allReviews = await database.select({ text: reviewReplies.reviewText }).from(reviewReplies);

    const clusters = [
      { id: "brakes", label: "Brake Trust & Reliability", keywords: /brake|pad|rotor|squeak|grind/i, count: 0, sample: "" },
      { id: "speed", label: "Speed & Efficiency", keywords: /fast|quick|speed|wait|time/i, count: 0, sample: "" },
      { id: "honesty", label: "Honesty & Fair Pricing", keywords: /honest|fair|price|scam|up-sell|upsell|trust/i, count: 0, sample: "" },
      { id: "tires", label: "Tire Emergencies", keywords: /tire|flat|patch|nail|blowout/i, count: 0, sample: "" },
      { id: "service", label: "Friendly Customer Service", keywords: /friendly|helpful|nice|polite/i, count: 0, sample: "" }
    ];

    // Simple single-pass matching
    for (const review of allReviews) {
      if (!review.text) continue;
      for (const cluster of clusters) {
        if (cluster.keywords.test(review.text)) {
          cluster.count++;
          if (!cluster.sample) cluster.sample = review.text.slice(0, 100) + "...";
        }
      }
    }

    // Sort by most mentioned
    clusters.sort((a, b) => b.count - a.count);

    return {
      totalReviewsAnalyzed: allReviews.length,
      clusters: clusters.map(c => ({
        id: c.id,
        label: c.label,
        count: c.count,
        sample: c.sample
      }))
    };
  }),
});
