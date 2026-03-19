/**
 * Public router — weather, reviews, Instagram, search, and diagnostics.
 */
import { publicProcedure, router } from "../_core/trpc";
import { getWeather, getWeatherAlert } from "../weather";
import { getGoogleReviews } from "../google-reviews";
import { getInstagramPosts, getInstagramAccount } from "../instagram";
import { keywordSearch, aiSearch } from "../search";
import { runDiagnosis } from "../diagnose";
import { z } from "zod";

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
      return { results: keywordSearch(input.query) };
    }),
  ai: publicProcedure
    .input(z.object({ query: z.string().min(2).max(500) }))
    .mutation(async ({ input }) => {
      return aiSearch(input.query);
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
      return runDiagnosis(input);
    }),
});
