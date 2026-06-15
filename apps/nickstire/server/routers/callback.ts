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
import { eq, and, gte } from "drizzle-orm";
import { sanitizeText, sanitizePhone } from "../sanitize";
import { sendLeadEvent } from "../meta-capi";
import { SITE_URL, BUSINESS } from "@shared/business";
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
      // attribution-holds migration 0067 — content/term were already SENT
      // by the getUtmData() spread but zod-stripped (no column).
      utmContent: z.string().max(255).nullish(),
      utmTerm: z.string().max(255).nullish(),
      // journey-join migration 0068 - localStorage visitor id
      sessionId: z.string().max(64).nullish(),
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
        utmContent: input.utmContent || null,
        utmTerm: input.utmTerm || null,
        sessionId: input.sessionId || null,
      });

      const d = await db();
      if (d) {
        // wave-125 — link the duplicate lead row back to its
        // callback_requests row via callbackId FK. Operator can now
        // see the same person across CallTracking + Leads as ONE
        // entity, and a future dedup view can collapse them.
        // Also: skip the lead-row insert entirely if a recent (last
        // 5 min) lead row with the same phone already exists — this
        // catches the case where a customer submitted a popup lead
        // moments before clicking the callback button.
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        const [existing] = await d
          .select({ id: leads.id })
          .from(leads)
          .where(and(
            eq(leads.phone, phone),
            gte(leads.createdAt, fiveMinAgo),
          ))
          .limit(1);

        if (existing) {
          // Dedup: existing lead row gets the callbackId added
          await d.update(leads)
            .set({ callbackId: result?.id ?? null })
            .where(eq(leads.id, existing.id))
            .catch((e: unknown) => log.warn("[callback:submit] lead dedup update failed:", e));
        } else {
          await d.insert(leads).values({
            name,
            phone,
            source: "callback",
            problem: input.context || "Callback request from " + (input.sourcePage || "website"),
            urgencyScore: 4,
            urgencyReason: "Customer requested immediate callback",
            callbackId: result?.id ?? null,
            utmSource: input.utmSource || null,
            utmMedium: input.utmMedium || null,
            utmCampaign: input.utmCampaign || null,
            landingPage: input.landingPage || null,
            referrer: input.referrer || null,
            utmContent: input.utmContent || null,
            utmTerm: input.utmTerm || null,
            sessionId: input.sessionId || null,
          }).catch((e: unknown) => log.warn("[callback:submit] lead insert failed:", e));
        }
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
        // Wave-103 — callback confirm goes from the shop number so
        // when Nick actually calls back, the texted number matches.
        sendSms(input.phone, callbackConfirmationSms(input.name), { via: "shop" }).catch(err =>
          log.error("[SMS] Callback confirmation failed:", err)
        );
      }

      // sheets-attribution wave 2026-06 — same already-validated input
      // fields the DB insert stores; appended as each row's tail columns.
      const sheetAttribution = {
        utmSource: input.utmSource,
        utmMedium: input.utmMedium,
        utmCampaign: input.utmCampaign,
        landingPage: input.landingPage,
        referrer: input.referrer,
      };

      syncLeadToSheet({
        name: input.name,
        phone: input.phone,
        source: "callback",
        problem: "Callback request",
        urgencyScore: 4,
        urgencyReason: "Customer requested callback",
        ...sheetAttribution,
      }).catch(e => log.warn("[callback:submit] lead sheet sync failed:", e));

      syncCallbackToSheet({
        name: input.name,
        phone: input.phone,
        reason: input.context || undefined,
        sourcePage: input.sourcePage || undefined,
        ...sheetAttribution,
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
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `We couldn't save your callback request. Please call us directly at ${BUSINESS.phone.display}.` });
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

      // lead-source hygiene · close the linked duplicate lead when the
      // callback is resolved. callback.submit writes BOTH a callback_requests
      // row and a leads row joined by leads.callbackId; resolving only the
      // callback left a permanent status=new urgency-4 ghost that re-entered
      // every action queue and kept the stale-lead SMS cron texting a person
      // Nick already called. Scope: ONLY leads still in 'new' (never touches
      // rows the operator progressed manually), only on called/no-answer/
      // completed (re-opening to 'new' leaves the lead alone). FAIL-OPEN:
      // a sync error never blocks the callback status update.
      if (input.status !== "new") {
        try {
          const d = await db();
          if (d) {
            await d.update(leads)
              .set({ status: "contacted", lastFollowUpAt: new Date(), contactedBy: "callback-resolution" })
              .where(and(eq(leads.callbackId, input.id), eq(leads.status, "new")));
          }
        } catch (syncErr) {
          log.warn("[callback:updateStatus] linked-lead close failed (callback status saved fine)", { id: input.id, err: syncErr instanceof Error ? syncErr.message : String(syncErr) });
        }
      }

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
