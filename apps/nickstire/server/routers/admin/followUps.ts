/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { adminProcedure, router } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, ne, desc } from "drizzle-orm";
import { customerNotifications } from "../../../drizzle/schema";

import { db } from "../../lib/db-helper";



export const followUpsRouter = router({
  run: adminProcedure.mutation(async () => {
    const { runFollowUps } = await import("../../follow-ups");
    return runFollowUps();
  }),
  pending: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];
    return d.select().from(customerNotifications)
      .where(eq(customerNotifications.status, "pending"))
      .orderBy(desc(customerNotifications.createdAt))
      .limit(50);
  }),
  recent: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];
    // Exclude status='pending' — those rows are already shown in the
    // `pending` query above. Without this filter, when total rows < 50
    // the operator sees every pending item twice (once in PENDING, once
    // in RECENT). `recent` is the sent/failed/skipped history list.
    return d.select().from(customerNotifications)
      .where(ne(customerNotifications.status, "pending"))
      .orderBy(desc(customerNotifications.createdAt))
      .limit(50);
  }),
  // wave-115 — per-item cancel: marks a pending follow-up as "skipped"
  // so it never sends. Useful when the customer already called back or
  // the booking was canceled.
  cancel: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [existing] = await d.select().from(customerNotifications)
        .where(eq(customerNotifications.id, input.id)).limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Follow-up not found" });
      }
      if (existing.status !== "pending") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Can only cancel pending follow-ups (this one is "${existing.status}")`,
        });
      }
      await d.update(customerNotifications)
        .set({ status: "skipped" })
        .where(eq(customerNotifications.id, input.id));
      return { ok: true as const, id: input.id };
    }),
  // wave-115 — per-item retry: takes a "failed" follow-up and re-queues
  // it as "pending" so the next runFollowUps() picks it up. Idempotent —
  // does nothing on already-pending or already-sent rows.
  retry: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [existing] = await d.select().from(customerNotifications)
        .where(eq(customerNotifications.id, input.id)).limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Follow-up not found" });
      }
      if (existing.status !== "failed") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Can only retry failed follow-ups (this one is "${existing.status}")`,
        });
      }
      await d.update(customerNotifications)
        .set({ status: "pending" })
        .where(eq(customerNotifications.id, input.id));
      return { ok: true as const, id: input.id };
    }),
});
