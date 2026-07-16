/**
 * Financing router — tracks financing applications, provides admin dashboard data,
 * and syncs to Google Sheets CRM.
 */
import { TRPCError } from "@trpc/server";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { syncFinancingToSheet } from "../sheets-sync";
import { FINANCING_PROVIDERS, PROVIDER_MAP } from "../../shared/financing";
import { z } from "zod";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:financing");
export const financingRouter = router({
  /**
   * Track a financing application click from the website.
   * Called when a customer clicks "Apply Now" on any financing provider.
   * Syncs to Google Sheets for tracking.
   */
  trackApplication: publicProcedure
    .input(
      z.object({
        provider: z.enum(["acima", "snap", "koalafi", "american-first"]),
        customerName: z.string().max(200).optional(),
        customerPhone: z.string().max(20).optional(),
        customerEmail: z.string().max(254).optional(),
        sourcePage: z.string().max(500).default("/financing"),
        estimatedAmount: z.string().max(20).optional(),
        // attribution-holds wave 2026-06 · optional UTM context (same shapes
        // as lead/callback/booking) so the Financing sheet rows attribute to
        // channel/campaign. Nullish + optional — no behavior change for
        // callers that omit them.
        utmSource: z.string().max(100).nullish(),
        utmMedium: z.string().max(100).nullish(),
        utmCampaign: z.string().max(255).nullish(),
        landingPage: z.string().max(500).nullish(),
        referrer: z.string().max(500).nullish(),
        // journey-join — visitor session id. The client's getUtmData() spread
        // already sends this; it was zod-stripped here until now. It is the join
        // key that ties this click back to the originating lead.
        sessionId: z.string().max(64).nullish(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { sanitizeName, sanitizePhone } = await import("../sanitize");
        const providerInfo = PROVIDER_MAP[input.provider];
        if (!providerInfo) {
          return { success: false, error: "Unknown provider" };
        }

        const safeName = input.customerName ? sanitizeName(input.customerName) : undefined;
        const safePhone = input.customerPhone ? sanitizePhone(input.customerPhone) : undefined;

        // Sync to Google Sheets
        const synced = await syncFinancingToSheet({
          provider: providerInfo.name,
          providerType: providerInfo.typeLabel,
          customerName: safeName,
          customerPhone: safePhone,
          customerEmail: input.customerEmail,
          sourcePage: input.sourcePage,
          estimatedAmount: input.estimatedAmount,
          status: "Clicked Apply",
          notes: `Applied via ${input.sourcePage}`,
          utmSource: input.utmSource,
          utmMedium: input.utmMedium,
          utmCampaign: input.utmCampaign,
          landingPage: input.landingPage,
          referrer: input.referrer,
        });

        console.info(
          `[Financing] ${providerInfo.name} application tracked from ${input.sourcePage}`,
          synced ? "(synced to sheets)" : "(sheets sync failed)"
        );

        // attribution-join wave — persist the click to the DB so it's joinable
        // to the originating lead by sessionId (the Sheet is append-only +
        // unjoinable). Best-effort: never block the click response.
        try {
          const { getDb } = await import("../db");
          const { financingClicks } = await import("../../drizzle/schema");
          const d = await getDb();
          if (d) {
            await d.insert(financingClicks).values({
              provider: input.provider,
              sourcePage: input.sourcePage,
              customerName: safeName ?? null,
              customerPhone: safePhone ?? null,
              customerEmail: input.customerEmail ?? null,
              estimatedAmount: input.estimatedAmount ?? null,
              sessionId: input.sessionId ?? null,
              utmSource: input.utmSource ?? null,
              utmMedium: input.utmMedium ?? null,
              utmCampaign: input.utmCampaign ?? null,
              landingPage: input.landingPage ?? null,
              referrer: input.referrer ?? null,
              createdAt: new Date(),
            });
          }
        } catch (persistErr) {
          log.warn("[financing] click DB persist failed (non-blocking)", { error: persistErr instanceof Error ? persistErr.message : String(persistErr) });
        }

        // No leadCaptured emit here: a bare provider-link click has no name or
        // phone, and a synthetic "Financing Applicant" entry contaminates the
        // lead pipeline (nickMemory, NOUR OS bridge). Click telemetry lives in
        // the Sheets sync + financingClicks row above; a real lead only exists
        // once the customer submits a form with contact info.

        return {
          success: true,
          provider: providerInfo.name,
          applyUrl: providerInfo.applyUrl,
          synced,
        };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),

  /**
   * Get all financing providers — used by the admin dashboard
   * to show quick links and provider info.
   */
  providers: publicProcedure.query(() => {
    return FINANCING_PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      shortName: p.shortName,
      type: p.typeLabel,
      merchantPortalUrl: p.merchantPortalUrl,
      customerPortalUrl: p.customerPortalUrl,
      applyUrl: p.applyUrl,
      color: p.color,
      maxAmount: p.maxAmount,
    }));
  }),

  /**
   * Admin: Log a financing application manually (e.g., from the counter).
   * Used when a customer applies in-store and the staff wants to log it.
   */
  logApplication: adminProcedure
    .input(
      z.object({
        provider: z.enum(["acima", "snap", "koalafi", "american-first"]),
        customerName: z.string().min(1),
        customerPhone: z.string().min(1),
        customerEmail: z.string().optional(),
        estimatedAmount: z.string().optional(),
        status: z.enum(["Applied", "Approved", "Denied", "Funded", "Cancelled"]).default("Applied"),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const providerInfo = PROVIDER_MAP[input.provider];
        if (!providerInfo) {
          return { success: false, error: "Unknown provider" };
        }

        const synced = await syncFinancingToSheet({
          provider: providerInfo.name,
          providerType: providerInfo.typeLabel,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail,
          sourcePage: "Admin Portal",
          estimatedAmount: input.estimatedAmount,
          status: input.status,
          notes: input.notes,
        });

        return { success: true, synced };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),

  /**
   * Admin: recent financing clicks LEFT JOINed to the originating lead by
   * sessionId. Answers "which financing clicks belong to a known lead?" — the
   * attribution the append-only Sheet could never provide. A null leadId row is
   * an unattributed click (no session match), surfaced honestly, not hidden.
   */
  recentClicks: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { financingClicks, leads } = await import("../../drizzle/schema");
      const { desc, eq } = await import("drizzle-orm");
      const d = await getDb();
      if (!d) return [];
      return d.select({
        id: financingClicks.id,
        provider: financingClicks.provider,
        sourcePage: financingClicks.sourcePage,
        sessionId: financingClicks.sessionId,
        createdAt: financingClicks.createdAt,
        leadId: leads.id,
        leadName: leads.name,
        leadPhone: leads.phone,
      })
        .from(financingClicks)
        .leftJoin(leads, eq(financingClicks.sessionId, leads.sessionId))
        .orderBy(desc(financingClicks.createdAt))
        .limit(input.limit);
    }),
});
