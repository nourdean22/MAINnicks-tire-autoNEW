/**
 * Public router — weather, reviews, Instagram, search, and diagnostics.
 * Expensive external API calls are cached server-side to reduce latency & costs.
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
import { serverCache, CACHE_TTL } from "../cache";

export const weatherRouter = router({
  current: publicProcedure.query(async () => {
    return serverCache.getOrSet("weather:current", CACHE_TTL.WEATHER, async () => {
      const weather = await getWeather();
      if (!weather) return { alert: null, weather: null };
      const alert = getWeatherAlert(weather);
      return { alert, weather };
    });
  }),
});

export const reviewsRouter = router({
  google: publicProcedure.query(async () => {
    return serverCache.getOrSet("reviews:google", CACHE_TTL.REVIEWS, () => getGoogleReviews());
  }),
});

export const instagramRouter = router({
  posts: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(20).default(6) }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 6;
      return serverCache.getOrSet(`instagram:posts:${limit}`, CACHE_TTL.INSTAGRAM, () => getInstagramPosts(limit));
    }),
  account: publicProcedure.query(async () => {
    return serverCache.getOrSet("instagram:account", CACHE_TTL.INSTAGRAM, () => getInstagramAccount());
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
        mileage: z.string().optional(),
        repairDescription: z.string().min(3).max(1000),
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
      return generateLaborEstimate(sanitized);
    }),
});

export const diagnoseRouter = router({
  analyze: publicProcedure
    .input(
      z.object({
        vehicleYear: z.string().optional(),
        vehicleMake: z.string().optional(),
        vehicleModel: z.string().optional(),
        mileage: z.string().optional(),
        symptoms: z.array(z.string()).min(1),
        additionalInfo: z.string().optional(),
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
