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
  /**
   * Per-item retry of a "failed" follow-up.
   *
   * wave-115 flipped the row back to "pending" for "the next runFollowUps()
   * to pick up" — but runFollowUps selects BOOKINGS by their followUp flags
   * (already 1 by then) and nothing else drains pending notification rows,
   * so a retried row sat "pending" forever while the operator's toast said
   * "requeued" (self-review on PR #2063). The retry now SENDS, and the row
   * records what happened.
   */
  retry: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
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
      if (!existing.recipientPhone) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No phone on file for this follow-up — call or text the customer manually",
        });
      }
      const { sendSms } = await import("../../sms");
      const { smsOutcome, smsClaimConsumed } = await import("../../lib/smsOutcome");
      const result = await sendSms(existing.recipientPhone, existing.message, {
        via: "shop",
        // A review request is marketing-class (quiet hours apply); a thank-you is a follow-up.
        messageClass: existing.notificationType === "review_request" ? "customer_marketing" : "customer_followup",
        humanInitiated: true,
      });
      const outcome = smsOutcome(result);
      if (smsClaimConsumed(result)) {
        // The status enum is pending/sent/failed: a queued or uncertain text
        // is recorded as sent (it must not be retried); the outcome goes back
        // to the operator verbatim.
        await d.update(customerNotifications)
          .set({ status: "sent", sentAt: new Date() })
          .where(eq(customerNotifications.id, input.id));
      }
      const { logAdminAction } = await import("../../services/auditTrail");
      logAdminAction({
        action: outcome === "queued" ? "customer.sms_queued" : "customer.sms_sent",
        entityType: "customer_notification",
        entityId: String(input.id),
        details: `Follow-up retry (${existing.notificationType}) → ${outcome}`,
        actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
      }).catch(() => { /* audit must never block the retry */ });
      return { ok: outcome !== "failed", id: input.id, outcome, error: outcome === "failed" ? result.error ?? "send_failed" : undefined };
    }),
});
