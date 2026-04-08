/**
 * Lead router — handles lead capture, CRM, and AI scoring.
 */
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { notifyNewLead } from "../email-notify";
import { scoreLead } from "../gemini";
import { syncLeadToSheet, getSpreadsheetUrl, isSheetConfigured } from "../sheets-sync";
import { z } from "zod";
import { eq, desc, and, gte } from "drizzle-orm";
import { leads } from "../../drizzle/schema";
import { sanitizeText, sanitizePhone, sanitizeEmail } from "../sanitize";
import { sendLeadEvent } from "../meta-capi";
import { logIntegrationFailure } from "../integration-failures";
import { withRetry } from "../retry";
import { sendSms, leadConfirmationSms } from "../sms";
import { SITE_URL } from "@shared/business";
import { handleAfterHoursCapture, isAfterHours } from "../services/afterHours";
import { alertNewLead } from "../services/telegram";
import { logAdminAction } from "../services/auditTrail";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

export const leadRouter = router({
  submit: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        phone: z.string().min(7).max(20),
        email: z.string().email().max(254).optional().or(z.literal("")),
        vehicle: z.string().max(200).optional(),
        problem: z.string().max(2000).optional(),
        source: z.enum(["popup", "chat", "booking", "manual", "callback", "fleet", "financing_preapproval"]).default("popup"),
        companyName: z.string().max(200).optional(),
        fleetSize: z.number().optional(),
        vehicleTypes: z.string().max(500).optional(),
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

      // Dedup check — prevent double-submit from same phone within 5 minutes
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const [recentDupe] = await d.select({ id: leads.id }).from(leads)
        .where(and(eq(leads.phone, phone), gte(leads.createdAt, fiveMinAgo)))
        .limit(1);
      if (recentDupe) {
        return { success: true, leadId: recentDupe.id, message: "Recent lead exists" };
      }

      const insertedRows = await d.insert(leads).values({
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
      }).$returningId();
      const leadId = insertedRows[0]?.id ?? null;

      // Dispatch to NOUR OS event bus (non-blocking)
      if (leadId) {
        import("../services/eventBus").then(({ emit }) =>
          emit.leadCaptured({
            id: leadId,
            name,
            phone,
            source: input.source,
            urgencyScore: scoring.score,
          })
        ).catch(() => {});
      }

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

      // Send SMS: financing pre-approval gets a special message
      if (input.source === "financing_preapproval") {
        const financingSms = `You may qualify for $0 down financing at Nick's! Bring your ID when you drop off. (216) 862-0005`;
        withRetry(
          () => sendSms(input.phone, financingSms),
          { maxRetries: 3, baseDelayMs: 1000, label: "sendSms (financing preapproval)" }
        ).catch(err => {
          console.error("[SMS] Financing preapproval SMS failed:", err);
          logIntegrationFailure({
            failureType: "sms",
            entityId: leadId,
            entityType: "lead",
            errorMessage: err instanceof Error ? err.message : String(err),
            errorDetails: err,
          });
        });
      } else if (isAfterHours()) {
        handleAfterHoursCapture({ name, phone, type: "lead" }).catch(() => {});
      } else {
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
      }

      // Telegram alert (always, regardless of hours)
      if (input.source === "financing_preapproval") {
        // Special financing pre-approval Telegram alert
        const amount = input.problem?.match(/\$(\S+)/)?.[1] || "unknown";
        import("../services/telegram").then(({ sendTelegramMessage }) => {
          const lines = [
            "\uD83D\uDCB3 <b>FINANCING PRE-APPROVAL</b>",
            "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
            `\uD83D\uDC64 <b>${name}</b>`,
            `\uD83D\uDCF1 ${phone}`,
            email ? `\u2709\uFE0F ${email}` : "",
            `\uD83D\uDCB0 Estimated: ~$${amount}`,
            "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
            `\u23F0 ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`,
          ];
          sendTelegramMessage(lines.filter(Boolean).join("\n"), "critical");
        }).catch(() => {});
      } else {
        alertNewLead({ name, phone, service: scoring.recommendedService, source: input.source }).catch(() => {});
      }

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
    return d.select().from(leads).orderBy(desc(leads.createdAt)).limit(1000);
  }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["new", "contacted", "booked", "completed", "closed", "lost"]).optional(),
        contacted: z.number().min(0).max(1).optional(),
        contactedBy: z.string().max(200).optional(),
        contactNotes: z.string().max(5000).optional(),
        lostReason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const { id, lostReason, ...updates } = input;
      const setObj: Record<string, unknown> = {};
      if (updates.status !== undefined) setObj.status = updates.status;
      if (updates.contacted !== undefined) {
        setObj.contacted = updates.contacted;
        if (updates.contacted === 1) setObj.contactedAt = new Date();
      }
      if (updates.contactedBy !== undefined) setObj.contactedBy = updates.contactedBy;
      if (updates.contactNotes !== undefined) setObj.contactNotes = updates.contactNotes;
      // Store lost reason: prepend to contact notes so it's visible + searchable
      if (lostReason && updates.status === "lost") {
        const existing = updates.contactNotes || "";
        const current = await d.select({ contactNotes: leads.contactNotes }).from(leads).where(eq(leads.id, id));
        const prev = current[0]?.contactNotes || existing;
        setObj.contactNotes = `[LOST: ${lostReason}]${prev ? " | " + prev : ""}`;
      }
      await d.update(leads).set(setObj).where(eq(leads.id, id));

      // Audit trail — log status changes and notes updates for Nick AI learning
      if (updates.status !== undefined) {
        logAdminAction({
          action: "lead.status_changed",
          entityType: "lead",
          entityId: id,
          details: `Status changed to ${updates.status}`,
          newValue: updates.status,
          metadata: lostReason ? { lostReason } : undefined,
        }).catch(() => {});
      }
      if (updates.contactNotes !== undefined) {
        logAdminAction({
          action: "lead.notes_updated",
          entityType: "lead",
          entityId: id,
          details: "Contact notes updated",
          newValue: updates.contactNotes,
        }).catch(() => {});
      }

      return { success: true };
    }),

  sheetUrl: adminProcedure.query(() => {
    return { url: getSpreadsheetUrl(), configured: isSheetConfigured() };
  }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      await d.delete(leads).where(eq(leads.id, input.id));
      logAdminAction({
        action: "lead.deleted",
        entityType: "lead",
        entityId: input.id,
        details: `Lead #${input.id} deleted`,
      }).catch(() => {});
      return { success: true };
    }),
});
