/**
 * Emergency Router (Feature 10)
 * Handles after-hours emergency service requests with SMS notifications.
 * Creates records in DB, syncs to Google Sheets, and alerts shop owner.
 */
import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { emergencyRequests } from "../../drizzle/schema";
import { sanitizeText, sanitizePhone, sanitizeName } from "../sanitize";
import { sendSms } from "../sms";
import { syncLeadToSheet } from "../sheets-sync";
import { withRetry } from "../retry";
import { logIntegrationFailure } from "../integration-failures";
import { TRPCError } from "@trpc/server";
import { getDb } from "../lib/db-helper";
import { getNextOpenTime } from "../services/afterHours";
import { BUSINESS } from "@shared/business";

const STORE_OWNER_PHONE = process.env.OWNER_PHONE_NUMBER || "";
if (!STORE_OWNER_PHONE) {
  console.error("[Emergency] OWNER_PHONE_NUMBER is not configured — owner SMS alerts will be skipped");
}

export const emergencyRouter = router({
  submit: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        phone: z.string().min(7).max(20),
        vehicle: z.string().max(200).optional(),
        problem: z.string().min(1).max(1000),
        urgency: z.enum(["emergency", "next-day"]).default("emergency"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const name = sanitizeName(input.name);
        const phone = sanitizePhone(input.phone);
        const vehicle = sanitizeText(input.vehicle);
        const problem = sanitizeText(input.problem);

        if (!name || !phone) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Name and phone are required",
          });
        }

        const d = await getDb();
        if (!d) throw new Error("Database not available");

        // Create emergency request record
        await d.insert(emergencyRequests).values({
          name,
          phone,
          vehicle: vehicle || null,
          problem: problem || null,
          urgency: input.urgency,
          status: "new",
          source: "after_hours_emergency",
        });

        // Get the created record for reference
        const created = await d
          .select()
          .from(emergencyRequests)
          .orderBy(desc(emergencyRequests.id))
          .where(eq(emergencyRequests.phone, phone))
          .limit(1);
        const emergencyId = created[0]?.id || null;

        const nextOpenTime = getNextOpenTime();

        // Unified event bus — CRITICAL priority (→ NOUR OS + Telegram + learning)
        import("../services/eventBus").then(({ emit }) =>
          emit.emergencyRequest({
            name,
            phone,
            problem: problem || "No description",
            urgency: input.urgency,
          })
        ).catch(err => {
          console.error("[EventBus] Emergency dispatch failed:", err);
        });

        // Sync to Google Sheets asynchronously (fire and forget with retry)
        withRetry(
          () =>
            syncLeadToSheet({
              name,
              phone,
              vehicle: vehicle || undefined,
              problem: problem || undefined,
              source: "after_hours_emergency",
              urgencyScore: input.urgency === "emergency" ? 5 : 4,
              urgencyReason: `After-hours ${input.urgency} request`,
              recommendedService: "Emergency Service",
            }),
          { maxRetries: 2, baseDelayMs: 500, label: "emergency-sheets-sync" }
        ).catch((err) => {
          console.error("[Emergency] Sheets sync failed:", err);
          logIntegrationFailure({
            failureType: "sheets_sync",
            entityId: emergencyId,
            entityType: "lead",
            errorMessage: err instanceof Error ? err.message : String(err),
            errorDetails: err,
          });
        });

        // IMMEDIATE Telegram alert (backup for SMS)
        import("../services/telegram").then(({ sendTelegram }) =>
          sendTelegram(
            `🚨 EMERGENCY REQUEST\n\n` +
            `Customer: ${name}\n` +
            `Phone: ${phone}\n` +
            `Vehicle: ${vehicle || "N/A"}\n` +
            `Problem: ${problem || "N/A"}\n` +
            `Urgency: ${input.urgency}\n\n` +
            `⚡ CALL THEM BACK ASAP`
          )
        ).catch((e) => { console.warn("[routers/emergency] fire-and-forget failed:", e); });

        // IMMEDIATE SMS to owner about the emergency request
        withRetry(
          () =>
            sendSms(
              STORE_OWNER_PHONE,
              `🚨 AFTER-HOURS REQUEST: ${name} (${phone}) — ${vehicle || "Vehicle info not provided"} — ${problem}`
            ),
          { maxRetries: 2, baseDelayMs: 500, label: "emergency-owner-sms" }
        ).catch((err) => {
          console.error("[Emergency] Owner SMS failed:", err);
          logIntegrationFailure({
            failureType: "sms",
            entityId: emergencyId,
            entityType: "lead",
            errorMessage: err instanceof Error ? err.message : String(err),
            errorDetails: err,
          });
        });

        // SMS confirmation to customer with next open time
        withRetry(
          () =>
            sendSms(
              phone,
              `Thanks ${name}! We received your emergency request. Our next available time is ${nextOpenTime}. Call us then at ${BUSINESS.phone.display}. - Nick's Tire & Auto`
            ),
          { maxRetries: 2, baseDelayMs: 500, label: "emergency-customer-sms" }
        ).catch((err) => {
          console.error("[Emergency] Customer SMS failed:", err);
          logIntegrationFailure({
            failureType: "sms",
            entityId: emergencyId,
            entityType: "lead",
            errorMessage: err instanceof Error ? err.message : String(err),
            errorDetails: err,
          });
        });

        return {
          success: true,
          nextOpenTime,
          message: `We've received your emergency request and the owner has been notified. We'll be available ${nextOpenTime}.`,
        };
      } catch (err) {
        console.error("[Emergency] Submit failed:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            `We couldn't save your emergency request. Please call us immediately at ${BUSINESS.phone.display}.`,
        });
      }
    }),
});
