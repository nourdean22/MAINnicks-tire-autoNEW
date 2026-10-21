/**
 * Share Cards Router
 * Create and manage shareable vehicle health summaries
 * Generates unique tokens for public access
 */
import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { db } from "../lib/db-helper";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:shareCards");

export const shareCardsRouter = router({

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
});
