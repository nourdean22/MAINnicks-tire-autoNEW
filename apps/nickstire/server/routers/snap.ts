/**
 * Snap Finance Router — admin query + submit endpoints.
 * Backs SnapDashboardSection.tsx.
 */

import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { createLogger } from "../lib/logger";
import {
  listSnapApplications,
  getSnapSummary,
  recordSnapApplication,
} from "../services/snapApplications";

const log = createLogger("routers:snap");

/**
 * Partner-required fields for a real Snap submission, enforced at the server
 * boundary (poka-yoke): this mutation fires a REAL application at Snap's API —
 * a credit pull the shop is charged for — so a nameless, amountless or
 * service-less application must be unrepresentable, not merely discouraged in
 * the UI. `disclosureAcknowledged` is the front desk attesting the customer
 * was shown Snap's disclosure before the hand-off; the attestation is recorded
 * on the audit row.
 *
 * Exported so financingGuards.test.ts can pin each rejection.
 */
export const snapSubmitInput = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerPhone: z.string().trim().min(7).max(30),
  customerEmail: z.string().email().max(254).optional(),
  amount: z.number().positive({ message: "Amount is required — a $0 application is not submittable" }).max(50000),
  vehicle: z.string().max(200).optional(),
  service: z.string().trim().min(3, { message: "Service description is required for a Snap application" }).max(500),
  disclosureAcknowledged: z.boolean().refine((v) => v === true, {
    message: "Snap disclosure must be acknowledged with the customer before submitting",
  }),
});

export const snapRouter = router({
  /** List recent applications */
  list: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(500).default(50) }).optional())
    .query(async ({ input }) => {
      return listSnapApplications(input?.limit ?? 50);
    }),

  /** Summary counts */
  summary: adminProcedure.query(async () => {
    return getSnapSummary();
  }),

  /**
   * Submit a new application. Proxies to Snap's API via the same path
   * as the public POST /api/snap/application but guarded by admin auth
   * instead of STATENOUR_SYNC_KEY. In-app submission for when the front
   * desk keys in an application directly.
   */
  submit: adminProcedure
    .input(snapSubmitInput)
    .mutation(async ({ input, ctx }) => {
      const snapApiKey = process.env.SNAP_FINANCE_API_KEY;
      const snapMerchantId = process.env.SNAP_FINANCE_MERCHANT_ID;

      let externalApplicationId: string | null = null;
      let status = "pending";
      let proxyUsed = false;

      if (snapApiKey && snapMerchantId) {
        try {
          const r = await fetch("https://api.snapfinance.com/v1/applications", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${snapApiKey}`,
              "X-Merchant-Id": snapMerchantId,
            },
            body: JSON.stringify({
              merchant_id: snapMerchantId,
              customer: {
                name: input.customerName,
                phone: input.customerPhone,
                email: input.customerEmail ?? null,
              },
              amount: input.amount ?? null,
              vehicle: input.vehicle ?? null,
              service_description: input.service ?? null,
            }),
            signal: AbortSignal.timeout(15_000),
          });
          const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
          externalApplicationId = (body.id ?? body.applicationId ?? null) as string | null;
          status = (body.status as string) ?? "pending";
          proxyUsed = true;
        } catch (err) {
          log.warn("Snap proxy failed — recording locally only", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const localId = await recordSnapApplication({
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail,
        amount: input.amount,
        vehicle: input.vehicle,
        service: input.service,
        externalApplicationId,
        status,
        // Attribution + disclosure attestation on the audit row (Phase 2):
        // WHO keyed the application, and that the customer saw the disclosure.
        submittedBy: ctx.user?.email ?? ctx.user?.name ?? "admin",
        disclosureAcknowledged: input.disclosureAcknowledged,
      });

      return { success: true, localId, externalApplicationId, status, proxyUsed };
    }),
});
