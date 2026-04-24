/**
 * Callback router — handles callback request submissions and admin management.
 */
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { createCallbackRequest, getCallbackRequests, updateCallbackStatus } from "../db";
import { notifyCallbackRequest } from "../email-notify";
import { syncLeadToSheet, syncCallbackToSheet } from "../sheets-sync";
import { sendSms, callbackConfirmationSms } from "../sms";
import { z } from "zod";
import { leads } from "../../drizzle/schema";
import { sanitizeText, sanitizePhone } from "../sanitize";
import { sendLeadEvent } from "../meta-capi";
import { SITE_URL } from "@shared/business";
import { handleAfterHoursCapture, isAfterHours } from "../services/afterHours";
import { alertNewLead } from "../services/telegram";

import { db } from "../lib/db-helper";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:callback");
export const callbackRouter = router({
  submit: publicProcedure
    // NULLISH on UTM/tracking fields — frontends send `null` when values
    // are absent. Using `.optional()` alone rejects null and silently kills
    // submissions. This bug cost us ~99% of form conversions (see commit
    // log for call tracking fix).
    .input(z.object({
      name: z.string().min(1).max(200),
      phone: z.string().min(7).max(20),
      context: z.string().max(1000).nullish(),
      sourcePage: z.string().max(500).nullish(),
      pixelEventId: z.string().max(100).nullish(),
      pixelUserData: z.object({
        client_user_agent: z.string().max(500),
        fbc: z.string().max(500).nullish(),
        fbp: z.string().max(500).nullish(),
      }).nullish(),
      utmSource: z.string().max(100).nullish(),
      utmMedium: z.string().max(100).nullish(),
      utmCampaign: z.string().max(255).nullish(),
      landingPage: z.string().max(500).nullish(),
      referrer: z.string().max(500).nullish(),
    }))
    .mutation(async ({ input }) => {
      try {
      // Sanitize user inputs
      const name = sanitizeText(input.name);
      const phone = sanitizePhone(input.phone);
      const context = sanitizeText(input.context);

      const result = await createCallbackRequest({
        name,
        phone,
        context: context || null,
        sourcePage: input.sourcePage || null,
        utmSource: input.utmSource || null,
        utmMedium: input.utmMedium || null,
        utmCampaign: input.utmCampaign || null,
        landingPage: input.landingPage || null,
        referrer: input.referrer || null,
      });

      const d = await db();
      if (d) {
        await d.insert(leads).values({
          name,
          phone,
          source: "callback",
          problem: input.context || "Callback request from " + (input.sourcePage || "website"),
          urgencyScore: 4,
          urgencyReason: "Customer requested immediate callback",
          utmSource: input.utmSource || null,
          utmMedium: input.utmMedium || null,
          utmCampaign: input.utmCampaign || null,
          landingPage: input.landingPage || null,
          referrer: input.referrer || null,
        }).catch((e: any) => log.warn("[callback:submit] lead insert failed:", e));
      }

      notifyCallbackRequest({
        name: input.name,
        phone: input.phone,
        reason: input.context || undefined,
        sourcePage: input.sourcePage || undefined,
      }).catch(err => log.error("[Callback] Email notification failed:", err));

      // Unified event bus dispatch (→ NOUR OS + ShopDriver + Telegram + learning)
      import("../services/eventBus").then(({ emit }) =>
        emit.callbackRequested({ name, phone, reason: input.context || null })
      ).catch(e => log.warn("[callback:submit] event bus dispatch failed:", e));

      // After-hours gets a different SMS than business hours
      if (isAfterHours()) {
        handleAfterHoursCapture({ name, phone, type: "callback" }).catch(e => log.warn("[callback:submit] after-hours capture failed:", e));
      } else {
        sendSms(input.phone, callbackConfirmationSms(input.name)).catch(err =>
          log.error("[SMS] Callback confirmation failed:", err)
        );
      }

      syncLeadToSheet({
        name: input.name,
        phone: input.phone,
        source: "callback",
        problem: "Callback request",
        urgencyScore: 4,
        urgencyReason: "Customer requested callback",
      }).catch(e => log.warn("[callback:submit] lead sheet sync failed:", e));

      syncCallbackToSheet({
        name: input.name,
        phone: input.phone,
        reason: input.context || undefined,
        sourcePage: input.sourcePage || undefined,
      }).catch(e => log.warn("[callback:submit] callback sheet sync failed:", e));

      // Meta Conversions API: Send server-side Lead event for callback
      if (input.pixelEventId) {
        sendLeadEvent({
          eventId: input.pixelEventId,
          sourceUrl: SITE_URL,
          phone: input.phone,
          name: input.name,
          userAgent: input.pixelUserData?.client_user_agent,
          fbc: input.pixelUserData?.fbc,
          fbp: input.pixelUserData?.fbp,
          contentName: "Callback Request",
          contentCategory: input.sourcePage || "website",
        }).catch(err => log.error("[CAPI] Callback lead event failed:", err));
      }

      // Telegram alert (always, regardless of hours)
      alertNewLead({ name, phone, service: input.context || "Callback", source: "callback" }).catch(e => log.warn("[callback:submit] telegram lead alert failed:", e));

      return result;
      } catch (err) {
        log.error("[Callback] Submit failed:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "We couldn't save your callback request. Please call us directly at (216) 862-0005." });
      }
    }),

  list: adminProcedure.query(async () => {
    return getCallbackRequests();
  }),

  updateStatus: adminProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["new", "called", "no-answer", "completed"]),
      notes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await updateCallbackStatus(input.id, input.status, input.notes);

      // Callback status = conversion signal
      import("../services/eventBus").then(({ dispatch }) =>
        dispatch("stage_changed", {
          callbackId: input.id,
          newStatus: input.status,
          notes: input.notes,
        }, { priority: input.status === "completed" ? "high" : "normal", source: "callback" })
      ).catch(e => log.warn("[callback:updateStatus] event bus stage change dispatch failed:", e));

      // Completed callback = conversion success, track for feedback
      if (input.status === "completed") {
        import("../services/feedbackLoop").then(({ trackAlertOutcome }) =>
          trackAlertOutcome("callback_followup", "acted")
        ).catch(e => log.warn("[callback:updateStatus] feedback tracking for completed callback failed:", e));
      } else if (input.status === "no-answer") {
        import("../services/nickMemory").then(({ remember }) =>
          remember({
            type: "lesson",
            content: `Callback #${input.id} resulted in no-answer. Consider different timing or channel.`,
            source: "callback_feedback",
            confidence: 0.6,
          })
        ).catch(e => log.warn("[callback:updateStatus] no-answer memory lesson failed:", e));
      }

      return result;
    }),
});
