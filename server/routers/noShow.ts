/**
 * No-Show Router — admin queries + manual confirmation send.
 * Backed by services/noShowPrediction.ts.
 */

import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { scoreBooking, listAtRiskBookings, getNoShowStats } from "../services/noShowPrediction";
import { sendSms } from "../sms";
import { createLogger } from "../lib/logger";
import { logAdminAction } from "../services/auditTrail";

const log = createLogger("routers:noShow");

export const noShowRouter = router({
  /** List upcoming bookings ordered by no-show risk */
  listAtRisk: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .query(async ({ input }) => {
      const list = await listAtRiskBookings(input?.limit ?? 50);
      return {
        bookings: list,
        summary: {
          total: list.length,
          critical: list.filter((b) => b.riskBand === "critical").length,
          high: list.filter((b) => b.riskBand === "high").length,
          medium: list.filter((b) => b.riskBand === "medium").length,
          low: list.filter((b) => b.riskBand === "low").length,
        },
      };
    }),

  /** Get full score + signal breakdown for one booking (for the customer drawer) */
  scoreOne: adminProcedure
    .input(z.object({ bookingId: z.number() }))
    .query(async ({ input }) => {
      return scoreBooking(input.bookingId);
    }),

  /** 30-day no-show trend stats for the admin dashboard */
  stats: adminProcedure
    .input(z.object({ days: z.number().min(7).max(365).default(30) }).optional())
    .query(async ({ input }) => {
      return getNoShowStats(input?.days ?? 30);
    }),

  /**
   * Send a confirmation SMS for a high-risk booking.
   * Admin-triggered (not cron). Follows Twilio opt-out + smart-timing.
   */
  sendConfirmation: adminProcedure
    .input(
      z.object({
        bookingId: z.number(),
        phone: z.string().min(5).max(30),
        body: z.string().min(10).max(1600),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const result = await sendSms(input.phone, input.body);
      if (result.success) {
        logAdminAction({
          action: "customer.sms_sent",
          entityType: "booking",
          entityId: input.bookingId,
          details: "No-show prevention confirmation",
          metadata: {
            adminUserId: ctx.user.id,
            phoneLast4: input.phone.slice(-4),
          },
        }).catch((err) => log.warn("Audit log failed", { err: String(err) }));
      }
      return {
        success: result.success,
        sid: result.sid ?? null,
        error: result.error ?? null,
      };
    }),
});
