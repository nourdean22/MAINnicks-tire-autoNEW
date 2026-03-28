/**
 * Lead router — handles lead capture, CRM, and AI scoring.
 */
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { notifyNewLead } from "../email-notify";
import { scoreLead } from "../gemini";
import { syncLeadToSheet, getSpreadsheetUrl, isSheetConfigured } from "../sheets-sync";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { leads } from "../../drizzle/schema";
import { sanitizeText, sanitizePhone, sanitizeEmail } from "../sanitize";
import { sendLeadEvent } from "../meta-capi";
import { logIntegrationFailure } from "../integration-failures";
import { withRetry } from "../retry";
import { sendSms, leadConfirmationSms } from "../sms";
import { SITE_URL } from "@shared/business";
import { onLeadCaptured } from "../nour-os-bridge";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

export const leadRouter = router({
  submit: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        phone: z.string().min(7).max(20),
        email: z.string().email().optional().or(z.literal("")),
        vehicle: z.string().optional(),
        problem: z.string().optional(),
        source: z.enum(["popup", "chat", "booking", "manual", "callback", "fleet"]).default("popup"),
        companyName: z.string().optional(),
        fleetSize: z.number().optional(),
        vehicleTypes: z.string().optional(),
        // Meta Pixel event ID for server-side CAPI deduplication
        pixelEventId: z.string().optional(),
        pixelUserData: z.object({
          client_user_agent: z.string(),
          fbc: z.string().optional(),
          fbp: z.string().optional(),
        }).optional(),
        // UTM source attribution
        utmSource: z.string().max(100).optional(),
        utmMedium: z.string().max(100).optional(),
        utmCampaign: z.string().max(255).optional(),
        landingPage: z.string().max(500).optional(),
        referrer: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
      // Sanitize user inputs
      const name = sanitizeText(input.name);
      const phone = sanitizePhone(input.phone);
      const email = input.email ? sanitizeEmail(input.email) : null;
      const vehicle = sanitizeText(input.vehicle);
      const problem = sanitizeText(input.problem);

      const d = await db();
      if (!d) throw new Error("Database not available");

      let scoring = { score: 3, reason: "Manual review recommended", recommendedService: "General Repair" };
      if (problem) {
        scoring = await scoreLead(problem, vehicle);
      }
      if (input.source === "fleet") {
        scoring.score = 5;
        scoring.reason = "Fleet/commercial account inquiry";
        scoring.recommendedService = "Fleet Services";
      }

      await d.insert(leads).values({
        name,
        phone,
        email: email || null,
        vehicle: vehicle || null,
        problem: problem || null,
        source: input.source,
        urgencyScore: scoring.score,
        urgencyReason: scoring.reason,
        recommendedService: scoring.recommendedService,
        companyName: input.companyName || null,
        fleetSize: input.fleetSize || null,
        vehicleTypes: input.vehicleTypes || null,
        utmSource: input.utmSource || null,
        utmMedium: input.utmMedium || null,
        utmCampaign: input.utmCampaign || null,
        landingPage: input.landingPage || null,
        referrer: input.referrer || null,
      });

      // Get the lead ID after insert to associate failures with the lead
      const insertedLead = await d
        .select()
        .from(leads)
        .orderBy(desc(leads.createdAt))
        .limit(1);
      const leadId = insertedLead[0]?.id || null;

      withRetry(
        () => syncLeadToSheet({
          name: input.name,
          phone: input.phone,
          email: input.email,
          vehicle: input.vehicle,
          problem: input.problem,
          source: input.source,
          urgencyScore: scoring.score,
          urgencyReason: scoring.reason,
          recommendedService: scoring.recommendedService,
        }),
        { maxRetries: 3, baseDelayMs: 1000, label: "syncLeadToSheet" }
      ).catch(err => {
        console.error("[Sheets] Lead sync failed:", err);
        logIntegrationFailure({
          failureType: "sheets_sync",
          entityId: leadId,
          entityType: "lead",
          errorMessage: err instanceof Error ? err.message : String(err),
          errorDetails: err,
        });
      });

      // Send email notification for all leads (routing handles urgency)
      withRetry(
        () => notifyNewLead({
          name: input.name,
          phone: input.phone,
          email: input.email || undefined,
          source: input.source,
          vehicle: input.vehicle || undefined,
          problem: input.problem || undefined,
          urgencyScore: scoring.score,
          urgencyReason: scoring.reason,
          recommendedService: scoring.recommendedService,
          companyName: input.companyName || undefined,
          fleetSize: input.fleetSize || undefined,
          vehicleTypes: input.vehicleTypes || undefined,
        }),
        { maxRetries: 3, baseDelayMs: 1000, label: "notifyNewLead" }
      ).catch(err => {
        console.error("[Lead] Email notification failed:", err);
        logIntegrationFailure({
          failureType: "email",
          entityId: leadId,
          entityType: "lead",
          errorMessage: err instanceof Error ? err.message : String(err),
          errorDetails: err,
        });
      });

      // Meta Conversions API: Send server-side Lead event
      if (input.pixelEventId) {
        const nameParts = (input.name || "").split(" ");
        withRetry(
          () => sendLeadEvent({
            eventId: input.pixelEventId,
            sourceUrl: SITE_URL,
            phone: input.phone,
            email: input.email || undefined,
            name: input.name,
            userAgent: input.pixelUserData?.client_user_agent,
            fbc: input.pixelUserData?.fbc,
            fbp: input.pixelUserData?.fbp,
            contentName: input.source === "fleet" ? "Fleet Inquiry" : "Lead Form Submission",
            contentCategory: input.source || "popup",
          }),
          { maxRetries: 3, baseDelayMs: 1000, label: "sendLeadEvent (lead)" }
        ).catch(err => {
          console.error("[CAPI] Lead event failed:", err);
          logIntegrationFailure({
            failureType: "capi",
            entityId: leadId,
            entityType: "lead",
            errorMessage: err instanceof Error ? err.message : String(err),
            errorDetails: err,
          });
        });
      }

      // NOUR OS: Dispatch lead event
      onLeadCaptured({
        id: leadId || 0,
        name: input.name,
        phone: input.phone,
        source: input.source,
        urgencyScore: scoring.score,
        interest: input.problem || scoring.recommendedService,
      }).catch(err => console.error("[Lead] NOUR OS dispatch failed:", err));

      // Send SMS confirmation to customer
      withRetry(
        () => sendSms(input.phone, leadConfirmationSms(input.name)),
        { maxRetries: 3, baseDelayMs: 1000, label: "sendSms (lead confirmation)" }
      ).catch(err => {
        console.error("[SMS] Lead confirmation failed:", err);
        logIntegrationFailure({
          failureType: "sms",
          entityId: leadId,
          entityType: "lead",
          errorMessage: err instanceof Error ? err.message : String(err),
          errorDetails: err,
        });
      });

      return {
        success: true,
        urgencyScore: scoring.score,
        recommendedService: scoring.recommendedService,
      };
      } catch (err) {
        console.error("[Lead] Submit failed:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "We couldn't save your information. Please call us at (216) 862-0005." });
      }
    }),

  list: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];
    return d.select().from(leads).orderBy(desc(leads.createdAt));
  }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["new", "contacted", "booked", "completed", "closed", "lost"]).optional(),
        contacted: z.number().min(0).max(1).optional(),
        contactedBy: z.string().optional(),
        contactNotes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const { id, ...updates } = input;
      const setObj: Record<string, unknown> = {};
      if (updates.status !== undefined) setObj.status = updates.status;
      if (updates.contacted !== undefined) {
        setObj.contacted = updates.contacted;
        if (updates.contacted === 1) setObj.contactedAt = new Date();
      }
      if (updates.contactedBy !== undefined) setObj.contactedBy = updates.contactedBy;
      if (updates.contactNotes !== undefined) setObj.contactNotes = updates.contactNotes;
      await d.update(leads).set(setObj).where(eq(leads.id, id));
      return { success: true };
    }),

  sheetUrl: adminProcedure.query(() => {
    return { url: getSpreadsheetUrl(), configured: isSheetConfigured() };
  }),
});
