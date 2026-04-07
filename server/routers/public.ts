/**
 * Public router — weather, reviews, Instagram, search, diagnostics, and social proof.
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
import { desc, gte, like, or, and, sql } from "drizzle-orm";

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
                source: "popup",
                vehicle: `${input.year} ${input.make} ${input.model}`,
                problem: `Estimate: ${estimate.repairTitle}\nRange: $${estimate.grandTotalLow}–$${estimate.grandTotalHigh}\nPowered by Auto Labor Guide`,
                recommendedService: estimate.repairTitle.slice(0, 100),
                urgencyScore: 3,
              });
            }

            // 2. Push estimate to Auto Labor Guide (API first, Telegram fallback)
            const { pushEstimate } = await import("../services/shopDriverSync");
            await pushEstimate({
              customerName: input.customerName || "N/A",
              customerPhone: input.customerPhone || "N/A",
              customerEmail: input.customerEmail,
              vehicle: `${input.year} ${input.make} ${input.model}`,
              repairTitle: estimate.repairTitle,
              lineItems: estimate.lineItems,
              grandTotalLow: estimate.grandTotalLow,
              grandTotalHigh: estimate.grandTotalHigh,
            });

            // 3. Unified event bus
            const { emit } = await import("../services/eventBus");
            emit.leadCaptured({
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

// ── Neighborhoods for anonymized activity messages ──────
const NEIGHBORHOODS = [
  "Cleveland Heights", "Lakewood", "Parma", "Euclid", "Shaker Heights",
  "South Euclid", "East Cleveland", "Garfield Heights", "Mentor", "Strongsville",
];

function pickNeighborhood(index: number): string {
  return NEIGHBORHOODS[index % NEIGHBORHOODS.length];
}

function anonymizeName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || "Someone";
}

export interface ActivityItem {
  type: "booking" | "completed" | "review";
  message: string;
  minutesAgo: number;
}

export const activityRouter = router({
  /** Recent real activity for FOMO ticker — anonymized bookings, jobs, reviews from today */
  recent: publicProcedure.query(async (): Promise<ActivityItem[]> => {
    try {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) return [];

      const { bookings, invoices, reviewReplies } = await import("../../drizzle/schema");

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const items: ActivityItem[] = [];

      // 1. Recent bookings from today
      const recentBookings = await d
        .select({
          name: bookings.name,
          service: bookings.service,
          createdAt: bookings.createdAt,
        })
        .from(bookings)
        .where(gte(bookings.createdAt, todayStart))
        .orderBy(desc(bookings.createdAt))
        .limit(5);

      for (const b of recentBookings) {
        const ago = Math.max(1, Math.round((Date.now() - new Date(b.createdAt).getTime()) / 60000));
        const neighborhood = pickNeighborhood(ago);
        items.push({
          type: "booking",
          message: `Someone in ${neighborhood} just booked ${b.service}`,
          minutesAgo: ago,
        });
      }

      // 2. Completed jobs today (invoices)
      const recentJobs = await d
        .select({
          vehicleInfo: invoices.vehicleInfo,
          serviceDescription: invoices.serviceDescription,
          invoiceDate: invoices.invoiceDate,
        })
        .from(invoices)
        .where(gte(invoices.invoiceDate, todayStart))
        .orderBy(desc(invoices.invoiceDate))
        .limit(5);

      for (const j of recentJobs) {
        const ago = Math.max(1, Math.round((Date.now() - new Date(j.invoiceDate).getTime()) / 60000));
        const vehicle = j.vehicleInfo || "a vehicle";
        const service = j.serviceDescription?.split(",")[0]?.trim() || "service";
        items.push({
          type: "completed",
          message: `A ${vehicle} just got ${service.toLowerCase()} completed`,
          minutesAgo: ago,
        });
      }

      // 3. Recent positive reviews
      const recentReviews = await d
        .select({
          reviewerName: reviewReplies.reviewerName,
          reviewText: reviewReplies.reviewText,
          reviewRating: reviewReplies.reviewRating,
          reviewDate: reviewReplies.reviewDate,
        })
        .from(reviewReplies)
        .where(gte(reviewReplies.reviewRating, 4))
        .orderBy(desc(reviewReplies.reviewDate))
        .limit(5);

      for (const r of recentReviews) {
        const ago = r.reviewDate
          ? Math.max(1, Math.round((Date.now() - new Date(r.reviewDate).getTime()) / 60000))
          : 60;
        const stars = "\u2605".repeat(r.reviewRating || 5);
        const excerpt = r.reviewText
          ? `"${r.reviewText.slice(0, 80)}${r.reviewText.length > 80 ? "..." : ""}"`
          : '"Great service!"';
        items.push({
          type: "review",
          message: `${stars} New ${r.reviewRating}-star review: ${excerpt}`,
          minutesAgo: ago,
        });
      }

      // Sort by recency and return up to 10
      items.sort((a, b) => a.minutesAgo - b.minutesAgo);
      return items.slice(0, 10);
    } catch (err) {
      console.error("[Activity] Failed to fetch recent activity:", err);
      return [];
    }
  }),
});

export const serviceReviewsRouter = router({
  /** Real reviews mentioning a specific service — for dynamic social proof on service pages */
  forService: publicProcedure
    .input(z.object({ service: z.string().min(1).max(100) }))
    .query(async ({ input }): Promise<{
      reviews: Array<{
        name: string;
        rating: number;
        text: string;
        date: string;
      }>;
    }> => {
      try {
        const { getDb } = await import("../db");
        const d = await getDb();
        if (!d) return { reviews: [] };

        const { reviewReplies } = await import("../../drizzle/schema");

        // Build keyword variations for the service
        const serviceKeywords = buildServiceKeywords(input.service);

        // Query reviews that mention this service (4-5 stars, most recent)
        const conditions = serviceKeywords.map(
          (kw) => like(reviewReplies.reviewText, `%${kw}%`)
        );

        const matchingReviews: Array<{
          reviewerName: string | null;
          reviewRating: number | null;
          reviewText: string | null;
          reviewDate: Date | null;
        }> = await d
          .select({
            reviewerName: reviewReplies.reviewerName,
            reviewRating: reviewReplies.reviewRating,
            reviewText: reviewReplies.reviewText,
            reviewDate: reviewReplies.reviewDate,
          })
          .from(reviewReplies)
          .where(
            and(
              gte(reviewReplies.reviewRating, 4),
              or(...conditions)
            )
          )
          .orderBy(desc(reviewReplies.reviewDate))
          .limit(3);

        return {
          reviews: matchingReviews.map((r) => ({
            name: anonymizeName(r.reviewerName || "Customer"),
            rating: r.reviewRating || 5,
            text: r.reviewText || "",
            date: r.reviewDate ? new Date(r.reviewDate).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            }) : "",
          })),
        };
      } catch (err) {
        console.error("[ServiceReviews] Failed:", err);
        return { reviews: [] };
      }
    }),
});

/** Map service slugs/names to keyword variations for searching review text */
function buildServiceKeywords(service: string): string[] {
  const lower = service.toLowerCase();
  const keywordMap: Record<string, string[]> = {
    tires: ["tire", "tires", "flat", "rotation", "mount", "balance"],
    brakes: ["brake", "brakes", "rotor", "pad", "pads", "stopping"],
    diagnostics: ["diagnostic", "check engine", "engine light", "scan", "code"],
    emissions: ["emission", "e-check", "smog", "echeck"],
    "oil-change": ["oil change", "oil", "lube", "synthetic"],
    "oil change": ["oil change", "oil", "lube", "synthetic"],
    "general-repair": ["repair", "fix", "mechanic", "honest"],
    "ac-repair": ["ac", "air conditioning", "a/c", "heat", "cooling", "cold air"],
    "ac repair": ["ac", "air conditioning", "a/c", "heat", "cooling", "cold air"],
    transmission: ["transmission", "trans", "shifting", "gear"],
    electrical: ["electrical", "wiring", "alternator", "starter"],
    battery: ["battery", "dead battery", "jump", "starting"],
    exhaust: ["exhaust", "muffler", "catalytic", "pipe"],
    cooling: ["coolant", "radiator", "overheating", "thermostat"],
  };

  return keywordMap[lower] || [lower, lower.replace(/-/g, " ")];
}

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
