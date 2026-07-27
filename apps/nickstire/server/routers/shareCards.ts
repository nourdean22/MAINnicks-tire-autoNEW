/**
 * Share Cards Router
 * Create and manage shareable vehicle health summaries
 * Generates unique tokens for public access
 */
import { z } from "zod";
import { router, adminProcedure, publicProcedure } from "../_core/trpc";
import { eq, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { SITE_URL } from "@shared/business";

import { db } from "../lib/db-helper";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:shareCards");
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

        // `result` is drizzle-mysql2's [ResultSetHeader, FieldPacket[]] tuple.
        // Reading .insertId off the ARRAY returned undefined, so every created
        // card reported `id: undefined`. The ~20 call sites in server/db.ts get
        // this right with `result[0].insertId`; this one did not.
        const { insertedId } = await import("../lib/dbResult");
        const id = insertedId(result);
        if (id === null) {
          // The row was written — the insert did not throw — so this is a
          // driver/reporting problem, not a failed create. Say so and return
          // the token, which is what the share URL actually depends on.
          log.warn("[ShareCards] insert reported no insertId", { token });
        }

        return {
          token,
          shareUrl,
          id,
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

      // wave-116 — was read-modify-write (`(card[0].views || 0) + 1`),
      // which loses increments under concurrent traffic (two requests
      // both read N, both write N+1, real count: 2 increments → +1).
      // Now uses atomic SQL increment so the DB serializes the update.
      setImmediate(() => {
        database
          .update(shareCards)
          .set({ views: sql`COALESCE(${shareCards.views}, 0) + 1` })
          .where(eq(shareCards.token, input.token))
          .catch((err: unknown) => {
            log.error("[ShareCards] Failed to increment views:", err);
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

        // wave-116 — atomic SQL increment (was read-modify-write).
        // Returns affectedRows so we can detect "card not found" without
        // a separate SELECT round-trip.
        const result = await database
          .update(shareCards)
          .set({ shares: sql`COALESCE(${shareCards.shares}, 0) + 1` })
          .where(eq(shareCards.token, input.token));

        // THIS GUARD FIRED ON EVERY CALL.
        //
        // `result` is drizzle-mysql2's [ResultSetHeader, FieldPacket[]] tuple,
        // so `.affectedRows` read off the ARRAY was undefined, the `?? 0`
        // turned that into zero, and zero meant "not found" — so trackShare
        // threw for every token, including valid ones. A check written to
        // detect a missing row instead guaranteed failure.
        //
        // The `as unknown as` casts are why tsc never objected: they told the
        // compiler to stop looking at exactly the place the shape was wrong.
        const { affectedRows } = await import("../lib/dbResult");
        const affected = affectedRows(result);
        if (affected === null) {
          // The driver reported NOTHING. That is not evidence of a missing
          // card, and treating it as such is the original bug in a new coat.
          log.warn("[ShareCards] update reported no row count; treating as success", { token: input.token });
          return { success: true };
        }
        if (affected === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Share card not found" });
        }

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
