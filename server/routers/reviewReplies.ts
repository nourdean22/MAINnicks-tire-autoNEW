/**
 * Review Replies Router
 * Fetch, draft, approve, and post replies to Google reviews
 * Integrates with Google Places API for review fetching
 */
import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { eq, sql } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";
import { sanitizeText } from "../sanitize";
import { TRPCError } from "@trpc/server";
import { buildPlaceDetailsUrl } from "@shared/const";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

async function fetchNewReviewsFromGoogle(): Promise<any[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY not configured");
  }

  try {
    const response = await fetch(buildPlaceDetailsUrl(apiKey, "reviews"));

    if (!response.ok) {
      throw new Error(`Google Places API error: ${response.status}`);
    }

    const data = await response.json();
    return data.result?.reviews || [];
  } catch (err) {
    console.error("[ReviewReplies] Failed to fetch reviews from Google:", err);
    return [];
  }
}

async function generateAIDraftReply(review: any): Promise<string> {
  const prompt = `You are a professional auto repair shop manager responding to a Google review.
The customer gave a ${review.rating}-star review with this comment: "${review.text}"

Write a warm, professional 2-3 sentence response that:
1. Thanks them for the feedback
2. If negative (1-3 stars): Apologizes and offers to make it right
3. If positive (4-5 stars): Reinforces quality and invites them back

Keep it under 160 characters (Google's limit).`;

  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      maxTokens: 256,
    });

    const content = result.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return sanitizeText(content);
    }
    throw new Error("Invalid LLM response");
  } catch (err) {
    console.error("[ReviewReplies] AI draft generation failed:", err);
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

      return query.limit(input.limit);
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
        throw new Error("Review or draft not found");
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

  /** Get stats on review replies (admin) */
  stats: adminProcedure.query(async () => {
    const { reviewReplies } = await import("../../drizzle/schema");
    const database = await db();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

    const [drafts, approved, skipped, posted] = await Promise.all([
      database.select({ count: sql<number>`count(*)` }).from(reviewReplies).where(eq(reviewReplies.status, "draft")),
      database.select({ count: sql<number>`count(*)` }).from(reviewReplies).where(eq(reviewReplies.status, "approved")),
      database.select({ count: sql<number>`count(*)` }).from(reviewReplies).where(eq(reviewReplies.status, "skipped")),
      database.select({ count: sql<number>`count(*)` }).from(reviewReplies).where(eq(reviewReplies.status, "posted")),
    ]);

    const d = drafts[0]?.count ?? 0;
    const a = approved[0]?.count ?? 0;
    const s = skipped[0]?.count ?? 0;
    const p = posted[0]?.count ?? 0;

    return {
      draft: d,
      approved: a,
      skipped: s,
      posted: p,
      total: d + a + s + p,
    };
  }),
});
