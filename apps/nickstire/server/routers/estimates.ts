/**
 * AI Estimate Router — Public endpoint for symptom-based cost estimates
 *
 * Primary: Claude-powered laborEstimate (real labor times + shop rate + LLM)
 * Fallback: Static aiEstimateGenerator (regex pattern matching)
 */
import { z } from "zod";
import { router, publicProcedure, adminProcedure } from "../_core/trpc";
import { withActivityLedger } from "../services/activityLedger";
import { generateLaborEstimate, type LaborEstimateResult } from "../laborEstimate";
import { generateEstimate } from "../services/aiEstimateGenerator";
import { BUSINESS } from "@shared/business";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:estimates");
export const estimatesRouter = router({
  /**
   * Primary estimate endpoint — Claude-powered with ALG labor times.
   * Falls back to static generator if LLM fails.
   */
  generate: publicProcedure
    .input(z.object({
      vehicleYear: z.number().min(1990).max(2030),
      vehicleMake: z.string().min(1).max(50),
      vehicleModel: z.string().min(1).max(50),
      symptomDescription: z.string().min(3).max(1000),
      mileage: z.number().optional(),
    }))
    // Activity ledger (0110): every generated estimate gets an attributed row
    // (actor_type 'public' for the website tool). estimates_log has no server
    // writer, so this is the only durable record of quote activity.
    .use((opts) =>
      withActivityLedger(opts, {
        action: "estimate.generated",
        entityType: "estimate",
        entityId: (input) => {
          const i = input as { vehicleYear?: number; vehicleMake?: string; vehicleModel?: string };
          return `${i.vehicleYear ?? "?"}-${(i.vehicleMake ?? "?").toLowerCase()}-${(i.vehicleModel ?? "?").toLowerCase()}`.slice(0, 36);
        },
        after: (input, data) => {
          const i = input as { symptomDescription?: string };
          const r = data as { _source?: string; grandTotalLow?: number; grandTotalHigh?: number; possibleIssues?: unknown[] };
          return {
            symptom: i.symptomDescription?.slice(0, 200),
            source: r?._source,
            estimateLow: r?.grandTotalLow ?? null,
            estimateHigh: r?.grandTotalHigh ?? null,
            issueCount: Array.isArray(r?.possibleIssues) ? r.possibleIssues.length : null,
          };
        },
      }),
    )
    .mutation(async ({ input }) => {
      const vehicle = `${input.vehicleYear} ${input.vehicleMake} ${input.vehicleModel}`;

      // Try Claude-powered estimate first
      try {
        const laborResult = await generateLaborEstimate({
          year: String(input.vehicleYear),
          make: input.vehicleMake,
          model: input.vehicleModel,
          mileage: input.mileage ? String(input.mileage) : undefined,
          repairDescription: input.symptomDescription,
        });

        // If Claude returned real line items, use the rich result
        if (laborResult.lineItems.length > 0) {
          // Dispatch event with rich data
          import("../services/eventBus").then(({ emit }) =>
            emit.estimateGenerated({
              vehicle,
              symptom: input.symptomDescription,
              issueCount: laborResult.lineItems.length,
              source: "ai_labor_estimate",
              estimateLow: laborResult.grandTotalLow,
              estimateHigh: laborResult.grandTotalHigh,
            })
          ).catch((e) => { log.warn("[routers/estimates] fire-and-forget failed:", e); });

          // Return unified shape — rich format with backward-compat fields
          return {
            // Rich labor estimate fields
            ...laborResult,
            // Backward-compat fields for existing UI
            possibleIssues: laborResult.lineItems.map(item => ({
              issue: item.description,
              likelihood: "likely" as const,
              estimatedCostRange: {
                low: Math.round(item.laborCost + item.partsLow),
                high: Math.round(item.laborCost + item.partsHigh),
              },
              estimatedTime: `${item.laborHours}h labor`,
              explanation: item.notes,
            })),
            recommendation: `Bring your ${vehicle} to Nick's Tire & Auto for this repair. Estimated total: $${laborResult.grandTotalLow}–$${laborResult.grandTotalHigh}. Call ${BUSINESS.phone.display} or schedule a drop-off at nickstire.org.`,
            _source: "claude" as const,
          };
        }
      } catch (err) {
        log.warn("[Estimates] Claude estimate failed, falling back to static:", err instanceof Error ? err.message : err);
      }

      // Fallback to static estimate
      const result = generateEstimate(input);

      import("../services/eventBus").then(({ emit }) =>
        emit.estimateGenerated({
          vehicle,
          symptom: input.symptomDescription,
          issueCount: result.possibleIssues?.length || 0,
          source: "ai_estimate_static",
        })
      ).catch((e) => { log.warn("[routers/estimates] fire-and-forget failed:", e); });

      return { ...result, _source: "static" as const };
    }),

  /**
   * Convert an estimate into a work order — pre-fills customer, vehicle, service, quoted total.
   * Uses the existing workOrderService for proper UUID + order number generation.
   */
  convertToWorkOrder: adminProcedure
    .input(z.object({
      customerName: z.string().min(1),
      customerPhone: z.string().optional(),
      vehicleYear: z.number(),
      vehicleMake: z.string(),
      vehicleModel: z.string(),
      repairDescription: z.string(),
      estimateLow: z.number().optional(),
      estimateHigh: z.number().optional(),
      lineItems: z.array(z.object({
        description: z.string(),
        laborHours: z.number(),
        laborCost: z.number(),
        partsLow: z.number(),
        partsHigh: z.number(),
      })).optional(),
    }))
    // Activity ledger (0110): estimate → work order is an admin-attributed
    // money write (quoted total lands on a work_orders row).
    .use((opts) =>
      withActivityLedger(opts, {
        action: "workorder.created_from_estimate",
        entityType: "work_order",
        entityId: (_input, data) => (data as { workOrderId?: string })?.workOrderId,
        after: (input, data) => {
          const i = input as { customerName?: string; customerPhone?: string; repairDescription?: string; estimateLow?: number; estimateHigh?: number };
          const r = data as { orderNumber?: string; vehicle?: string };
          return {
            customerName: i.customerName,
            customerPhone: i.customerPhone ?? null,
            service: i.repairDescription?.slice(0, 200),
            estimateLow: i.estimateLow ?? null,
            estimateHigh: i.estimateHigh ?? null,
            orderNumber: r?.orderNumber,
            vehicle: r?.vehicle,
          };
        },
      }),
    )
    .mutation(async ({ input }) => {
      const { createWorkOrder, addLineItem } = await import("../services/workOrderService");
      const { getDb } = await import("../db");
      const { customers } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      // Find customer by phone
      let customerId: number | null = null;
      if (input.customerPhone) {
        const d = await getDb();
        if (d) {
          const existing = await d.select().from(customers)
            .where(eq(customers.phone, input.customerPhone)).limit(1);
          if (existing.length > 0) {
            customerId = existing[0].id;
          }
        }
      }

      // Create work order via service layer
      const wo = await createWorkOrder({
        customerId,
        vehicleYear: input.vehicleYear,
        vehicleMake: input.vehicleMake,
        vehicleModel: input.vehicleModel,
        serviceDescription: input.repairDescription,
        customerComplaint: input.repairDescription,
        quotedTotal: input.estimateHigh ?? input.estimateLow ?? 0,
        source: "estimate_conversion",
      });

      // Add line items from estimate
      if (input.lineItems?.length) {
        for (const li of input.lineItems) {
          await addLineItem({
            workOrderId: wo.id,
            type: "labor",
            description: li.description,
            laborHours: li.laborHours,
            laborRate: li.laborCost / (li.laborHours || 1),
            unitPrice: li.laborCost + (li.partsLow + li.partsHigh) / 2,
          });
        }
      }

      const vehicle = `${input.vehicleYear} ${input.vehicleMake} ${input.vehicleModel}`;

      // Dispatch event (estimateGenerated is a generic Record<string, any> emitter)
      import("../services/eventBus").then(({ emit }) =>
        emit.estimateGenerated({
          type: "estimate_converted_to_wo",
          workOrderId: wo.id,
          orderNumber: wo.orderNumber,
          vehicle,
          service: input.repairDescription.slice(0, 100),
          source: "estimate_conversion",
        })
      ).catch((e) => { log.warn("[routers/estimates] fire-and-forget failed:", e); });

      return { workOrderId: wo.id, orderNumber: wo.orderNumber, vehicle, status: "approved" };
    }),
});
