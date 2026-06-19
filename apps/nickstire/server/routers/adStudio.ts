/**
 * Ad Studio Router — self-serve graphic-design Instagram AD generator.
 *
 * generate → claim-safe LLM copy (adCopyGen) + server-side puppeteer render of
 * the brand template (adRender) → hosted slide URLs. post/schedule reuse the
 * EXISTING carousel paths (metaSocial.postInstagramCarousel + scheduled_posts).
 * Every procedure is owner-gated; posting is an explicit operator action.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../_core/trpc";
import { createLogger } from "../lib/logger";

const log = createLogger("routers:adStudio");

const ANGLES = ["financing", "free_check", "trust"] as const;
const slideUrlsSchema = z.array(z.string().url()).min(2).max(10);
const captionSchema = z.string().min(1).max(2200);

export const adStudioRouter = router({
  /** Generate claim-safe ad copy + render 5 hosted graphic-design slides. */
  generate: adminProcedure
    .input(z.object({ angle: z.enum(ANGLES).default("financing"), topic: z.string().max(120).optional() }))
    .mutation(async ({ input }) => {
      const { generateAdCopy } = await import("../services/adStudio/adCopyGen");
      const { renderAdSlides } = await import("../services/adStudio/adRender");
      const { copy, issues } = await generateAdCopy({ angle: input.angle, topic: input.topic });
      const { slideUrls } = await renderAdSlides(copy);
      log.info("ad generated", { angle: input.angle, slides: slideUrls.length, issues: issues.length });
      return { copy, issues, slideUrls };
    }),

  /** Post the carousel ad NOW via the existing gated Meta carousel path. */
  post: adminProcedure
    .input(z.object({ slideUrls: slideUrlsSchema, caption: captionSchema }))
    .mutation(async ({ input }) => {
      const { postInstagramCarousel } = await import("../services/metaSocial");
      const res = await postInstagramCarousel({ imageUrls: input.slideUrls, caption: input.caption });
      if (!res.success) throw new TRPCError({ code: "BAD_REQUEST", message: res.error || "carousel post failed" });
      return { postId: res.postId ?? null };
    }),

  /** Schedule the carousel ad for later (publish-later queue, fired by cron). */
  schedule: adminProcedure
    .input(z.object({ slideUrls: slideUrlsSchema, caption: captionSchema, scheduledAt: z.string().datetime() }))
    .mutation(async ({ input }) => {
      const when = new Date(input.scheduledAt);
      if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "scheduledAt must be a valid future time" });
      }
      const { db } = await import("../lib/db-helper");
      const database = await db();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "database unavailable" });
      const { scheduledPosts } = await import("../../drizzle/schema");
      await database.insert(scheduledPosts).values({
        platforms: ["instagram"],
        caption: input.caption,
        imageUrls: input.slideUrls,
        scheduledAt: when,
        status: "pending",
      });
      log.info("ad scheduled", { scheduledAt: input.scheduledAt });
      return { ok: true as const, scheduledAt: input.scheduledAt };
    }),
});
