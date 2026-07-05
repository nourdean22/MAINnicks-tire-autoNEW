/**
 * DB hygiene scan + prune pair (wraps runHygieneScan).
 *
 * Carved from admin/dashboard.ts (1,133 lines, one router object holding
 * 17 procedures) in the 2026-07-05 polish wave. Grouped by reason-to-change.
 * Each group is a plain procedure record; ./index.ts spread-merges them into
 * one flat router, so every adminDashboard.<proc> client call path is
 * byte-identical. Pure mechanical move — no procedure body was modified.
 */
/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { adminProcedure } from "../../../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { bookings, leads, callbackRequests } from "../../../../drizzle/schema";

import { db } from "../../../lib/db-helper";

import { createLogger } from "../../../lib/logger";

const log = createLogger("routers:admin");
import { runHygieneScan } from "../hygiene";


export const dbCleanupProcedures = {
  dbCleanupScan: adminProcedure.query(async () => {
    return runHygieneScan();
  }),

  dbCleanupPrune: adminProcedure
    .input(z.object({
      fakeIds: z.array(z.object({ id: z.number(), table: z.enum(["leads", "bookings", "callbacks"]) })),
      duplicateIds: z.array(z.object({ id: z.number(), table: z.enum(["leads", "bookings", "callbacks"]) })),
      staleIds: z.array(z.object({ id: z.number(), table: z.enum(["leads", "bookings", "callbacks"]) })),
    }))
    .mutation(async ({ input, ctx }) => {
      // 1. Run scanner to retrieve valid cleanup candidates
      const candidates = await runHygieneScan();

      // 2. Validate all requested IDs exist in candidate pools
      for (const item of input.fakeIds) {
        const isValid = candidates.fake.some(c => c.id === item.id && c.table === item.table);
        if (!isValid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Record ID ${item.id} in table ${item.table} is not a valid candidate for fake cleanup.`,
          });
        }
      }

      for (const item of input.duplicateIds) {
        const isValid = candidates.duplicates.some(c => c.id === item.id && c.table === item.table);
        if (!isValid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Record ID ${item.id} in table ${item.table} is not a valid candidate for duplicate cleanup.`,
          });
        }
      }

      for (const item of input.staleIds) {
        const isValid = candidates.stale.some(c => c.id === item.id && c.table === item.table);
        if (!isValid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Record ID ${item.id} in table ${item.table} is not a valid candidate for stale cleanup.`,
          });
        }
      }

      const d = await db();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { eq } = await import("drizzle-orm");

      let deletedCount = 0;
      let archivedCount = 0;

      for (const item of input.fakeIds) {
        if (item.table === "leads") {
          await d.delete(leads).where(eq(leads.id, item.id));
        } else if (item.table === "bookings") {
          await d.delete(bookings).where(eq(bookings.id, item.id));
        } else if (item.table === "callbacks") {
          await d.delete(callbackRequests).where(eq(callbackRequests.id, item.id));
        }
        deletedCount++;
      }

      for (const item of input.duplicateIds) {
        if (item.table === "leads") {
          await d.delete(leads).where(eq(leads.id, item.id));
        } else if (item.table === "bookings") {
          await d.delete(bookings).where(eq(bookings.id, item.id));
        } else if (item.table === "callbacks") {
          await d.delete(callbackRequests).where(eq(callbackRequests.id, item.id));
        }
        deletedCount++;
      }

      for (const item of input.staleIds) {
        if (item.table === "leads") {
          await d.update(leads)
            .set({ status: "closed", contacted: 0, contactNotes: "[SYSTEM: Closed as stale]" })
            .where(eq(leads.id, item.id));
        } else if (item.table === "bookings") {
          await d.update(bookings)
            .set({ status: "cancelled", adminNotes: "[SYSTEM: Cancelled as stale]" })
            .where(eq(bookings.id, item.id));
        } else if (item.table === "callbacks") {
          await d.update(callbackRequests)
            .set({ status: "no-answer", notes: "[SYSTEM: Closed as stale]" })
            .where(eq(callbackRequests.id, item.id));
        }
        archivedCount++;
      }

      const { logAdminAction } = await import("../../../services/auditTrail");
      logAdminAction({
        action: "database.hygiene_prune",
        entityType: "system",
        entityId: 0,
        details: `Database cleanup: deleted ${deletedCount} records, archived/closed ${archivedCount} stale records.`,
        actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
      }).catch((e) => { log.warn("[routers/admin] audit trail logging failed:", e); });

      return { success: true, deleted: deletedCount, archived: archivedCount };
    }),
};
