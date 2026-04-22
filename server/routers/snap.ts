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
    .input(z.object({
      customerName: z.string().min(1).max(200),
      customerPhone: z.string().min(7).max(30),
      customerEmail: z.string().email().max(254).optional(),
      amount: z.number().min(0).max(50000).optional(),
      vehicle: z.string().max(200).optional(),
      service: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
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
      });

      return { success: true, localId, externalApplicationId, status, proxyUsed };
    }),
});
