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
import { buildLeadContactStatusSet } from "./leadUpdateSet";
import { recordLeadDelivery } from "../lead-delivery";
import { sanitizeText, sanitizePhone, sanitizeEmail } from "../sanitize";
import { sendLeadEvent } from "../meta-capi";
import { logIntegrationFailure } from "../integration-failures";
import { withRetry } from "../retry";
import { sendSmsOrThrow, leadConfirmationSms } from "../sms";
import { SITE_URL, BUSINESS } from "@shared/business";
import { handleAfterHoursCapture, isAfterHours } from "../services/afterHours";
import { alertNewLead } from "../services/telegram";
import { logAdminAction } from "../services/auditTrail";
import { withActivityLedger } from "../services/activityLedger";

import { db } from "../lib/db-helper";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:lead");
export const leadRouter = router({
  submit: publicProcedure
    .input(
      // NULLISH on UTM/tracking fields — same fix as callback.ts.
      // Frontend sends null for missing UTM; `.optional()` alone rejected them.
      z.object({
        name: z.string().min(1).max(200),
        phone: z.string().min(7).max(20),
        email: z.string().email().max(254).nullish().or(z.literal("")),
        vehicle: z.string().max(200).nullish(),
        problem: z.string().max(2000).nullish(),
        // Conversion-overhaul Batch 8 added "sms_capture" and "newsletter"
        // as INPUT values — but they are NOT in the DB `leads.source` enum
        // (schema.ts), so MySQL coerced them to '' (or errored in strict
        // mode), silently corrupting the source on every TextMeQuote /
        // EmailNewsletterCapture lead. They stay accepted here (public forms
        // send them) and are REMAPPED to valid enum values at insert below.
        // "sms" added — it exists in the DB enum but was missing here.
        // "diagnose" added with drizzle/0082 — canonical source for the
        // /diagnose symptom-checker (previously submitted as "popup").
        source: z.enum([
          "popup",
          "chat",
          "booking",
          "manual",
          "callback",
          "fleet",
          "financing_preapproval",
          "careers",
          "sms",
          "diagnose",
          "sms_capture",
          "newsletter",
        ]).default("popup"),
        companyName: z.string().max(200).nullish(),
        fleetSize: z.number().nullish(),
        vehicleTypes: z.string().max(500).nullish(),
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
        // by every getUtmData() form spread but zod-stripped (no column).
        utmContent: z.string().max(255).nullish(),
        utmTerm: z.string().max(255).nullish(),
        // journey-join migration 0068 - localStorage visitor id
        sessionId: z.string().max(64).nullish(),
      })
    )
    // Activity ledger (0110): one attributed row per captured lead — actor_type
    // 'public' for the website form, with a PII-masked after-snapshot. Records
    // only after the mutation succeeds; a ledger failure never blocks capture.
    .use((opts) =>
      withActivityLedger(opts, {
        action: "lead.created",
        entityType: "lead",
        entityId: (_input, data) => (data as { leadId?: number | null })?.leadId,
        after: (input, data) => {
          const i = input as { name?: string; phone?: string; source?: string };
          const r = data as { leadId?: number | null; message?: string };
          return {
            name: i.name,
            phone: i.phone,
            source: i.source,
            ...(r?.message ? { note: r.message } : {}),
          };
        },
      }),
    )
    .mutation(async ({ input, ctx }) => {
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

      // Remap input-only source values to members of the DB enum — without
      // this, MySQL coerces "sms_capture"/"newsletter" to '' (blank source,
      // invisible to every source rollup) or rejects the row in strict mode.
      // The true origin is preserved in utmCampaign when the form didn't
      // supply one (TextMeQuote / EmailNewsletterCapture send no UTM).
      const SOURCE_REMAP: Record<string, "sms" | "popup"> = { sms_capture: "sms", newsletter: "popup" };
      const dbSource = SOURCE_REMAP[input.source] ?? input.source;
      const originCampaign = dbSource !== input.source && !input.utmCampaign ? input.source : null;

      const insertedRows = await d.insert(leads).values({
        name,
        phone,
        email: email || null,
        vehicle: vehicle || null,
        problem: problem || null,
        source: dbSource,
        urgencyScore: scoring.score,
        urgencyReason: scoring.reason,
        recommendedService: scoring.recommendedService,
        companyName: input.companyName || null,
        fleetSize: input.fleetSize || null,
        vehicleTypes: input.vehicleTypes || null,
        utmSource: input.utmSource || null,
        utmMedium: input.utmMedium || null,
        utmCampaign: input.utmCampaign || originCampaign,
        landingPage: input.landingPage || null,
        referrer: input.referrer || null,
        utmContent: input.utmContent || null,
        utmTerm: input.utmTerm || null,
        sessionId: input.sessionId || null,
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
        ).catch((e) => { log.warn("[routers/lead] fire-and-forget failed:", e); });
      }

      // TCPA-defensible opt-in record (implicit consent via lead form)
      import("../services/complianceLog").then(({ logSmsOptIn }) =>
        logSmsOptIn({
          phone,
          source: `lead_form:${input.source}`,
          ipAddress: ctx.req?.ip ?? null,
          userAgent: ctx.req?.headers?.["user-agent"]?.toString() ?? null,
          context: { leadId },
        }),
      ).catch((err) => log.warn("[lead] compliance log failed:", err));

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
          // sheets-attribution wave 2026-06 — same already-validated input
          // fields the DB insert stores; appended as the row's tail columns.
          utmSource: input.utmSource,
          utmMedium: input.utmMedium,
          utmCampaign: input.utmCampaign,
          landingPage: input.landingPage,
          referrer: input.referrer,
        }),
        { maxRetries: 3, baseDelayMs: 1000, label: "syncLeadToSheet" }
      ).catch(err => {
        log.error("[Sheets] Lead sync failed:", err);
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
      )
        .then(() => recordLeadDelivery({ leadId, channel: "email", status: "sent", provider: "resend" }))
        .catch(err => {
          log.error("[Lead] Email notification failed:", err);
          logIntegrationFailure({
            failureType: "email",
            entityId: leadId,
            entityType: "lead",
            errorMessage: err instanceof Error ? err.message : String(err),
            errorDetails: err,
          });
          void recordLeadDelivery({ leadId, channel: "email", status: "failed", provider: "resend", detail: err instanceof Error ? err.message : String(err) });
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
          log.error("[CAPI] Lead event failed:", err);
          logIntegrationFailure({
            failureType: "capi",
            entityId: leadId,
            entityType: "lead",
            errorMessage: err instanceof Error ? err.message : String(err),
            errorDetails: err,
          });
        });
      }

      // financing_preapproval no longer gets a special SMS: the old message
      // promised "$10 down / soft check / no credit-score ding" -- provider
      // terms Nick's cannot guarantee. The modal that produced this source was
      // removed; any straggler (stale PWA cache) gets the generic confirmation.
      if (isAfterHours()) {
        handleAfterHoursCapture({ name, phone, type: "lead" }).catch((e) => { log.warn("[routers/lead] fire-and-forget failed:", e); });
      } else {
        withRetry(
          // Wave-108: lead confirmation via shop gateway (transactional)
          () => sendSmsOrThrow(input.phone, leadConfirmationSms(input.name), { via: "shop" }),
          { maxRetries: 3, baseDelayMs: 1000, label: "sendSms (lead confirmation)" }
        )
          .then((r) => recordLeadDelivery({ leadId, channel: "sms", status: "sent", provider: "shop", providerRef: r?.sid ?? null }))
          .catch(err => {
            log.error("[SMS] Lead confirmation failed:", err);
            logIntegrationFailure({
              failureType: "sms",
              entityId: leadId,
              entityType: "lead",
              errorMessage: err instanceof Error ? err.message : String(err),
              errorDetails: err,
            });
            void recordLeadDelivery({ leadId, channel: "sms", status: "failed", provider: "shop", detail: err instanceof Error ? err.message : String(err) });
          });
      }

      // Telegram alert (always, regardless of hours)
      alertNewLead({ name, phone, service: scoring.recommendedService, source: input.source })
        .then(() => recordLeadDelivery({ leadId, channel: "telegram", status: "sent", provider: "telegram" }))
        .catch((e) => { log.warn("[routers/lead] fire-and-forget failed:", e); void recordLeadDelivery({ leadId, channel: "telegram", status: "failed", provider: "telegram", detail: e instanceof Error ? e.message : String(e) }); });

      return {
        success: true,
        // Review finding 2026-08-12: without this the activity-ledger row for
        // every NEW lead recorded entityId "unknown" (only the dedup early
        // return carried leadId). Additive — no client destructures against it.
        leadId,
        urgencyScore: scoring.score,
        recommendedService: scoring.recommendedService,
      };
      } catch (err) {
        log.error("[Lead] Submit failed:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `We couldn't save your information. Please call us at ${BUSINESS.phone.display}.` });
      }
    }),

  list: adminProcedure.query(async () => {
    const d = await db();
    if (!d) {
      // ROS-083 · returning [] made DB-unavailable resolve as HTTP 200, so the
      // Leads page rendered five confident zeros and a Kanban of empty columns
      // with react-query's isError false. Every client-side unknown guard is
      // inert unless this throws. adminProcedure only — the public submit path
      // above keeps its own error handling.
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "Database unavailable — the lead pipeline is unknown, not empty.",
      });
    }
    return d.select().from(leads).orderBy(desc(leads.createdAt)).limit(1000);
  }),

  /**
   * Read the notification-delivery chronology for one lead (admin). Surfaces
   * the durable lead_delivery_events ledger so an operator can see whether each
   * email / SMS / Telegram was attempted, sent, or failed — the per-lead
   * observability the append-only Google Sheet never had.
   */
  deliveryEvents: adminProcedure
    .input(z.object({ leadId: z.number() }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];
      const { leadDeliveryEvents } = await import("../../drizzle/schema");
      return d.select().from(leadDeliveryEvents)
        .where(eq(leadDeliveryEvents.leadId, input.leadId))
        .orderBy(desc(leadDeliveryEvents.createdAt))
        .limit(100);
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
        estimatedValueCents: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const { id, lostReason, ...updates } = input;
      // Base column mapping — incl. the status→"contacted" atomicity guard —
      // lives in a pure, unit-tested helper (leadUpdateSet.ts). Async concerns
      // (lost-reason note merge + booking/invoice attribution) stay below.
      const setObj = buildLeadContactStatusSet(updates);
      // Store lost reason: prepend to contact notes so it's visible + searchable
      if (lostReason && updates.status === "lost") {
        const existing = updates.contactNotes || "";
        const current = await d.select({ contactNotes: leads.contactNotes }).from(leads).where(eq(leads.id, id));
        const prev = current[0]?.contactNotes || existing;
        setObj.contactNotes = `[LOST: ${lostReason}]${prev ? " | " + prev : ""}`;
      }

      // wave-125 — source-to-revenue attribution. When a lead transitions
      // to "booked" or "completed", look up the most-recent matching
      // booking (by phone, last 30d) and stamp bookingId on the lead.
      // Same for "completed" → look up most-recent invoice. Best-effort
      // (silent fail) so it never blocks the operator's status change.
      if (updates.status === "booked" || updates.status === "completed") {
        try {
          const [thisLead] = await d.select({ phone: leads.phone, bookingId: leads.bookingId, invoiceId: leads.invoiceId })
            .from(leads).where(eq(leads.id, id)).limit(1);
          if (thisLead?.phone) {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            if (updates.status === "booked" && !thisLead.bookingId) {
              const { bookings } = await import("../../drizzle/schema");
              const { desc: descFn } = await import("drizzle-orm");
              const [match] = await d.select({ id: bookings.id })
                .from(bookings)
                .where(and(eq(bookings.phone, thisLead.phone), gte(bookings.createdAt, thirtyDaysAgo)))
                .orderBy(descFn(bookings.createdAt))
                .limit(1);
              if (match) setObj.bookingId = match.id;
            }
            if (updates.status === "completed" && !thisLead.invoiceId) {
              const { invoices } = await import("../../drizzle/schema");
              const { desc: descFn } = await import("drizzle-orm");
              const [match] = await d.select({ id: invoices.id })
                .from(invoices)
                .where(and(eq(invoices.customerPhone, thisLead.phone), gte(invoices.invoiceDate, thirtyDaysAgo)))
                .orderBy(descFn(invoices.invoiceDate))
                .limit(1);
              if (match) setObj.invoiceId = match.id;
            }
          }
        } catch (attrErr) {
          log.warn("[lead.update] revenue attribution failed (non-blocking)", { error: attrErr instanceof Error ? attrErr.message : String(attrErr) });
        }
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
        }).catch((e) => { log.warn("[routers/lead] fire-and-forget failed:", e); });
      }
      if (updates.contactNotes !== undefined) {
        logAdminAction({
          action: "lead.notes_updated",
          entityType: "lead",
          entityId: id,
          details: "Contact notes updated",
          newValue: updates.contactNotes,
        }).catch((e) => { log.warn("[routers/lead] fire-and-forget failed:", e); });
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
      }).catch((e) => { log.warn("[routers/lead] fire-and-forget failed:", e); });
      return { success: true };
    }),

  /** AI-draft a personalized response for a lead */
  draftResponse: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const [lead] = await d.select().from(leads).where(eq(leads.id, input.id)).limit(1);
      if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found" });

      const { invokeLLM } = await import("../_core/llm");
      const result = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are writing a response for Nick's Tire & Auto in Cleveland/Euclid.
Draft a friendly, professional SMS or call script to respond to this lead.

Rules:
- Use their first name
- Reference their specific vehicle and service need
- Mention our FCFS / drop-off model (no appointment needed)
- Include a rough price range if the service is identifiable
- Keep it under 150 words for SMS, or 200 words for call script
- Tone: warm, knowledgeable, not salesy
- Always include: ${BUSINESS.phone.display}
- Business hours: Mon-Sat 8am-6pm
- End with a clear next step`,
          },
          {
            role: "user",
            content: `Lead: ${lead.name}
Phone: ${lead.phone || "unknown"}
Vehicle: ${lead.vehicle || "unknown"}
Problem: ${lead.problem || "general inquiry"}
Source: ${lead.source || "website"}
Urgency: ${lead.urgencyScore || 3}/5
Value estimate: ${lead.estimatedValueCents ? `$${(lead.estimatedValueCents / 100).toFixed(0)}` : "unknown"}

Draft both an SMS response and a phone call script.`,
          },
        ],
      });

      const draft = result.choices?.[0]?.message?.content;
      if (typeof draft !== "string" || draft.length < 20) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI draft generation failed" });
      }

      return { draft, leadId: input.id, leadName: lead.name };
    }),
});
