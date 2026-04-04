/**
 * Financing router — tracks financing applications, provides admin dashboard data,
 * and syncs to Google Sheets CRM.
 */
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { syncFinancingToSheet } from "../sheets-sync";
import { FINANCING_PROVIDERS, PROVIDER_MAP } from "../../shared/financing";
import { z } from "zod";

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
      })
    )
    .mutation(async ({ input }) => {
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
      });

      console.log(
        `[Financing] ${providerInfo.name} application tracked from ${input.sourcePage}`,
        synced ? "(synced to sheets)" : "(sheets sync failed)"
      );

      // Financing application = high-intent lead signal — notify the whole system
      import("../services/eventBus").then(({ emit }) =>
        emit.leadCaptured({
          id: 0,
          name: safeName || "Financing Applicant",
          phone: safePhone || "",
          source: `financing_${input.provider}`,
          urgencyScore: 5, // Max score — high intent, they're applying for money
        })
      ).catch(() => {});

      return {
        success: true,
        provider: providerInfo.name,
        applyUrl: providerInfo.applyUrl,
        synced,
      };
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
    }),
});
