/**
 * Share Cards Router
 * Create and manage shareable vehicle health summaries
 * Generates unique tokens for public access
 */
import { z } from "zod";
import { router, adminProcedure, publicProcedure } from "../_core/trpc";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { SITE_URL } from "@shared/business";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export const shareCardsRouter = router({
  /** Create a new share card (admin) */
  create: adminProcedure
    .input(
      z.object({
        customerName: z.string().max(100).optional(),
        vehicleInfo: z.string().max(200).optional(),
        serviceType: z.string().max(100).optional(),
        healthScore: z.number().int().min(0).max(100).optional(),
        healthDetails: z.string().optional(),
        completedDate: z.date().optional(),
        inspectionId: z.number().int().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { shareCards } = await import("../../drizzle/schema");
        const database = await db();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        const token = generateToken();

        const result = await database.insert(shareCards).values({
          token,
          customerName: input.customerName || undefined,
          vehicleInfo: input.vehicleInfo || undefined,
          serviceType: input.serviceType || undefined,
          healthScore: input.healthScore || undefined,
          healthDetails: input.healthDetails || undefined,
          completedDate: input.completedDate || undefined,
          inspectionId: input.inspectionId || undefined,
          views: 0,
          shares: 0,
        });

        const shareUrl = `${SITE_URL}/share/${token}`;

        return {
          token,
          shareUrl,
          id: (result as any).insertId,
        };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),

  /** Get a share card by token (public) */
  get: publicProcedure
    .input(z.object({ token: z.string().length(64) }))
    .query(async ({ input }) => {
      const { shareCards } = await import("../../drizzle/schema");
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const card = await database
        .select()
        .from(shareCards)
        .where(eq(shareCards.token, input.token))
        .limit(1);

      if (!card.length) {
        throw new Error("Share card not found");
      }

      // Increment views asynchronously
      setImmediate(() => {
        database
          .update(shareCards)
          .set({ views: (card[0].views || 0) + 1 })
          .where(eq(shareCards.token, input.token))
          .catch((err: unknown) => {
            console.error("[ShareCards] Failed to increment views:", err);
          });
      });

      return card[0];
    }),

  /** Track share action (public) */
  trackShare: publicProcedure
    .input(z.object({ token: z.string().length(64) }))
    .mutation(async ({ input }) => {
      try {
        const { shareCards } = await import("../../drizzle/schema");
        const database = await db();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        const card = await database
          .select()
          .from(shareCards)
          .where(eq(shareCards.token, input.token))
          .limit(1);

        if (!card.length) {
          throw new Error("Share card not found");
        }

        await database
          .update(shareCards)
          .set({ shares: (card[0].shares || 0) + 1 })
          .where(eq(shareCards.token, input.token));

        return { success: true };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),

  /** List all share cards (admin) */
  list: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).default(100),
      })
    )
    .query(async ({ input }) => {
      const { shareCards } = await import("../../drizzle/schema");
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      return database.select().from(shareCards).limit(input.limit);
    }),

  /** Delete a share card (admin) */
  delete: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      try {
        const { shareCards } = await import("../../drizzle/schema");
        const database = await db();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        await database.delete(shareCards).where(eq(shareCards.id, input.id));

        return { success: true };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
});
