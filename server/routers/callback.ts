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

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

export const callbackRouter = router({
  submit: publicProcedure
    .input(z.object({
      name: z.string().min(1).max(200),
      phone: z.string().min(7).max(20),
      context: z.string().max(1000).optional(),
      sourcePage: z.string().max(500).optional(),
      // Meta Pixel event ID for server-side CAPI deduplication
      pixelEventId: z.string().max(100).optional(),
      pixelUserData: z.object({
        client_user_agent: z.string().max(500),
        fbc: z.string().max(500).optional(),
        fbp: z.string().max(500).optional(),
      }).optional(),
      // UTM source attribution
      utmSource: z.string().max(100).optional(),
      utmMedium: z.string().max(100).optional(),
      utmCampaign: z.string().max(255).optional(),
      landingPage: z.string().max(500).optional(),
      referrer: z.string().max(500).optional(),
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
        }).catch(() => {});
      }

      notifyCallbackRequest({
        name: input.name,
        phone: input.phone,
        reason: input.context || undefined,
        sourcePage: input.sourcePage || undefined,
      }).catch(err => console.error("[Callback] Email notification failed:", err));

      // Unified event bus dispatch (→ NOUR OS + ShopDriver + Telegram + learning)
      import("../services/eventBus").then(({ emit }) =>
        emit.callbackRequested({ name, phone, reason: input.context || null })
      ).catch(() => {});

      // After-hours gets a different SMS than business hours
      if (isAfterHours()) {
        handleAfterHoursCapture({ name, phone, type: "callback" }).catch(() => {});
      } else {
        sendSms(input.phone, callbackConfirmationSms(input.name)).catch(err =>
          console.error("[SMS] Callback confirmation failed:", err)
        );
      }

      syncLeadToSheet({
        name: input.name,
        phone: input.phone,
        source: "callback",
        problem: "Callback request",
        urgencyScore: 4,
        urgencyReason: "Customer requested callback",
      }).catch(() => {});

      syncCallbackToSheet({
        name: input.name,
        phone: input.phone,
        reason: input.context || undefined,
        sourcePage: input.sourcePage || undefined,
      }).catch(() => {});

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
        }).catch(err => console.error("[CAPI] Callback lead event failed:", err));
      }

      // Telegram alert (always, regardless of hours)
      alertNewLead({ name, phone, service: input.context || "Callback", source: "callback" }).catch(() => {});

      return result;
      } catch (err) {
        console.error("[Callback] Submit failed:", err);
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
      return updateCallbackStatus(input.id, input.status, input.notes);
    }),
});
