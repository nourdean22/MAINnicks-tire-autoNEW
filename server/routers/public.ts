/**
 * Public router — weather, reviews, Instagram, search, and diagnostics.
 */
import { publicProcedure, router } from "../_core/trpc";
import { getWeather, getWeatherAlert } from "../weather";
import { getGoogleReviews } from "../google-reviews";
import { getInstagramPosts, getInstagramAccount } from "../instagram";
import { keywordSearch, aiSearch } from "../search";
import { runDiagnosis } from "../diagnose";
import { generateLaborEstimate } from "../laborEstimate";
import { z } from "zod";
import { sanitizeText } from "../sanitize";

export const weatherRouter = router({
  current: publicProcedure.query(async () => {
    const weather = await getWeather();
    if (!weather) return { alert: null, weather: null };
    const alert = getWeatherAlert(weather);
    return { alert, weather };
  }),
});

export const reviewsRouter = router({
  google: publicProcedure.query(async () => {
    return getGoogleReviews();
  }),
});

export const instagramRouter = router({
  posts: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(20).default(6) }).optional())
    .query(async ({ input }) => {
      return getInstagramPosts(input?.limit ?? 6);
    }),
  account: publicProcedure.query(async () => {
    return getInstagramAccount();
  }),
});

export const searchRouter = router({
  instant: publicProcedure
    .input(z.object({ query: z.string().min(1).max(200) }))
    .query(({ input }) => {
      return { results: keywordSearch(sanitizeText(input.query)) };
    }),
  ai: publicProcedure
    .input(z.object({ query: z.string().min(2).max(500) }))
    .mutation(async ({ input }) => {
      return aiSearch(sanitizeText(input.query));
    }),
});

export const laborEstimateRouter = router({
  generate: publicProcedure
    .input(
      z.object({
        year: z.string().min(4).max(4),
        make: z.string().min(1).max(50),
        model: z.string().min(1).max(50),
        mileage: z.string().max(20).optional(),
        repairDescription: z.string().min(3).max(1000),
        customerName: z.string().max(100).optional(),
        customerPhone: z.string().max(20).optional(),
        customerEmail: z.string().email().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const sanitized = {
        year: sanitizeText(input.year) || input.year,
        make: sanitizeText(input.make) || input.make,
        model: sanitizeText(input.model) || input.model,
        mileage: sanitizeText(input.mileage),
        repairDescription: sanitizeText(input.repairDescription) || input.repairDescription,
      };
      const estimate = await generateLaborEstimate(sanitized);

      // Push to Auto Labor Guide (ShopDriver) — they own the estimate lifecycle
      // Also create a lead in our system for tracking
      if (input.customerName || input.customerPhone || input.customerEmail) {
        (async () => {
          try {
            // 1. Create lead in our DB for pipeline tracking
            const { getDb } = await import("../db");
            const d = await getDb();
            if (d) {
              const { leads } = await import("../../drizzle/schema");
              await d.insert(leads).values({
                name: input.customerName || "Online Estimate",
                phone: input.customerPhone || "",
                email: input.customerEmail || null,
                source: "estimate",
                service: estimate.repairTitle,
                vehicle: `${input.year} ${input.make} ${input.model}`,
                message: `Estimate: ${estimate.repairTitle}\nRange: $${estimate.grandTotalLow}–$${estimate.grandTotalHigh}\nPowered by Auto Labor Guide`,
                urgencyScore: 3,
                status: "new",
              });
            }

            // 2. Notify shop to create estimate in Auto Labor Guide
            const { sendTelegram } = await import("../services/telegram");
            await sendTelegram(
              `📋 NEW ESTIMATE REQUEST — Create in Auto Labor Guide\n\n` +
              `Customer: ${input.customerName || "N/A"}\n` +
              `Phone: ${input.customerPhone || "N/A"}\n` +
              `Email: ${input.customerEmail || "N/A"}\n` +
              `Vehicle: ${input.year} ${input.make} ${input.model}${input.mileage ? ` (${input.mileage} mi)` : ""}\n` +
              `Repair: ${estimate.repairTitle}\n` +
              `Range: $${estimate.grandTotalLow}–$${estimate.grandTotalHigh}\n` +
              `Labor: ${estimate.totalLaborHours}h @ $${Math.round(estimate.totalLaborCost / Math.max(estimate.totalLaborHours, 0.1))}/hr\n\n` +
              `Line items:\n${estimate.lineItems.map(li => `• ${li.description}: ${li.laborHours}h + $${li.partsLow}-$${li.partsHigh} parts`).join("\n")}\n\n` +
              `⚡ Create this estimate in ShopDriver and email to customer`
            );

            // 3. Fire NOUR OS event
            const { onLeadCaptured } = await import("../nour-os-bridge");
            onLeadCaptured({
              id: 0,
              name: input.customerName || "Online Estimate",
              phone: input.customerPhone || "",
              source: "estimate",
              urgencyScore: 3,
            });
          } catch (err) {
            console.error("[Estimate] Pipeline failed:", err instanceof Error ? err.message : err);
          }
        })();
      }

      return estimate;
    }),
});

export const diagnoseRouter = router({
  analyze: publicProcedure
    .input(
      z.object({
        vehicleYear: z.string().max(4).optional(),
        vehicleMake: z.string().max(50).optional(),
        vehicleModel: z.string().max(50).optional(),
        mileage: z.string().max(20).optional(),
        symptoms: z.array(z.string().max(200)).min(1).max(20),
        additionalInfo: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const sanitized = {
        ...input,
        vehicleYear: sanitizeText(input.vehicleYear),
        vehicleMake: sanitizeText(input.vehicleMake),
        vehicleModel: sanitizeText(input.vehicleModel),
        mileage: sanitizeText(input.mileage),
        symptoms: input.symptoms.map(s => sanitizeText(s)),
        additionalInfo: sanitizeText(input.additionalInfo),
      };
      return runDiagnosis(sanitized);
    }),
});
