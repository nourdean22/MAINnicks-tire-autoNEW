/**
 * shopMedia — Nour's imported shop photos and videos (contract v1, 2026-10-18).
 * Nothing the importer registers is reusable until `review` approves it.
 * Owner-only: shared/adminPermissions.ts maps shopMedia.* to security.manage.
 * Behaviour lives in services/shopMediaLibrary.ts; this file is the boundary.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { dbTyped } from "../lib/db-helper";
import { listShopMedia, reviewShopMedia, shopMediaStats } from "../services/shopMediaLibrary";

async function requireDatabase() {
  const database = await dbTyped();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable: the shop media library is unknown, not empty." });
  return database;
}

export const shopMediaRouter = router({
  list: adminProcedure
    .input(z.object({
      state: z.enum(["quarantined", "approved", "rejected"]),
      kind: z.enum(["photo", "video"]).optional(),
      orientation: z.enum(["vertical", "horizontal"]).optional(),
      people: z.string().max(16).optional(),
      tag: z.string().max(64).optional(),
      cursor: z.number().int().min(0).max(1_000_000).optional(),
      limit: z.number().int().min(1).max(60).optional(),
      bindable: z.boolean().optional(),
    }))
    .query(async ({ input }) => listShopMedia(await requireDatabase(), input)),

  review: adminProcedure
    .input(z.object({
      assetIds: z.array(z.string().min(1).max(64)).min(1).max(100),
      decision: z.enum(["approve", "reject"]),
    }))
    .mutation(async ({ input }) => reviewShopMedia(await requireDatabase(), input.assetIds, input.decision)),

  stats: adminProcedure.query(async () => shopMediaStats(await requireDatabase())),
});
