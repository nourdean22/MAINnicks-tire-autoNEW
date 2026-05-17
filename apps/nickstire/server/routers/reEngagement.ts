/**
 * Re-engagement Router — turns service memory into admin actions.
 *
 * Two endpoints:
 *   - list: returns customers due for a service, with suggested SMS copy
 *   - sendSuggestion: sends the suggested SMS (admin-triggered, NOT cron)
 *
 * Design choice: the cron that runs bulk re-engagement is deliberately
 * separate and FEATURE-FLAG gated ("reEngagementAutoSend"). Today this
 * router is the manual-review-and-send flow, which is always how a new
 * outreach should start.
 */

import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import {
  getServiceMemory,
  getDueSuggestions,
  getAllCustomersDue,
} from "../services/serviceMemory";
import { sendSms } from "../sms";
import { createLogger } from "../lib/logger";
import { logAdminAction } from "../services/auditTrail";

const log = createLogger("re-engagement");

export const reEngagementRouter = router({
  /**
   * Returns up to `limit` customers due for a service, ranked by urgency.
   * Cheap enough to run on-demand from admin UI (single indexed SQL + per-row aggregation).
   */
  listDue: adminProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(500).default(50),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 50;
      const suggestions = await getAllCustomersDue(limit);
      return {
        suggestions,
        summary: {
          total: suggestions.length,
          overdue: suggestions.filter((s) => s.urgency === "overdue").length,
          due: suggestions.filter((s) => s.urgency === "due").length,
          soon: suggestions.filter((s) => s.urgency === "soon").length,
        },
      };
    }),

  /**
   * Returns per-customer service timeline — useful for drilling into
   * the customer drawer in admin before sending.
   */
  customerMemory: adminProcedure
    .input(z.object({ phone: z.string().min(5).max(30) }))
    .query(async ({ input }) => {
      const memory = await getServiceMemory(input.phone);
      if (!memory) return null;
      const suggestions = await getDueSuggestions(input.phone);
      return { memory, suggestions };
    }),

  /**
   * Admin-triggered send. Records an audit-trail entry.
   * Respects the same Twilio opt-out / smart-timing as all other SMS.
   */
  sendSuggestion: adminProcedure
    .input(
      z.object({
        phone: z.string().min(5).max(30),
        body: z.string().min(10).max(1600),
        customerId: z.number().optional(),
        reason: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Wave-108: re-engagement via shop gateway (admin-triggered, 1:1)
      const result = await sendSms(input.phone, input.body, { via: "shop" });

      if (result.success) {
        logAdminAction({
          action: "customer.sms_sent",
          entityType: "customer",
          entityId: input.customerId ?? input.phone.slice(-4),
          details: `Re-engagement SMS (${input.reason ?? "manual"})`,
          metadata: {
            reason: input.reason,
            phoneLast4: input.phone.slice(-4),
            bodyLen: input.body.length,
            adminUserId: ctx.user.id,
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
