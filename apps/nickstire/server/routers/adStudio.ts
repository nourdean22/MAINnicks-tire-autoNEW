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

  /**
   * Post the carousel ad NOW — through publishToSocial, the ONE gated door.
   *
   * The previous body called postInstagramCarousel DIRECTLY while its comment
   * claimed "the existing gated path". The gates live in publishToSocial
   * (autonomy kill-switch, publishing kill-switch, per-platform switches, the
   * daily-cadence content governor) — so Ad Studio was the one surface the
   * emergency stop did not stop and the cadence cap did not count. Claim
   * safety is additionally enforced HERE because publishToSocial documents
   * that callers must gate first, and this caller trusted the client.
   */
  post: adminProcedure
    .input(z.object({ slideUrls: slideUrlsSchema, caption: captionSchema }))
    .mutation(async ({ input }) => {
      const { publishToSocial, captionClaimBlockers, assertPermanentPublicMediaUrl } = await import("../services/socialPublish");
      const blockers = captionClaimBlockers(input.caption);
      if (blockers.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Claim-safety: ${blockers.map((b) => `${b.rule} ("${b.match}")`).join("; ")} — edit the caption first.`,
        });
      }
      for (const url of input.slideUrls) assertPermanentPublicMediaUrl(url);

      const { results } = await publishToSocial({
        platforms: ["instagram"],
        caption: input.caption,
        imageUrls: input.slideUrls,
      });
      const instagram = results.find((r) => r.platform === "instagram");
      if (instagram?.ambiguous) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The publish call timed out AFTER it was sent — the ad MAY BE LIVE. Check the Instagram account before retrying; retrying now can duplicate it.",
        });
      }
      if (!instagram?.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: instagram?.error || "carousel post failed" });
      }
      return { postId: instagram.postId ?? null };
    }),

  /** Schedule the carousel ad for later (publish-later queue, fired by cron).
   *  Deferred execution gets the STRICTER checks — nobody is watching when it
   *  fires, so claim-safety and permanent-URL problems must refuse NOW. */
  schedule: adminProcedure
    .input(z.object({ slideUrls: slideUrlsSchema, caption: captionSchema, scheduledAt: z.string().datetime() }))
    .mutation(async ({ input }) => {
      const when = new Date(input.scheduledAt);
      if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "scheduledAt must be a valid future time" });
      }
      const { captionClaimBlockers, assertPermanentPublicMediaUrl } = await import("../services/socialPublish");
      const blockers = captionClaimBlockers(input.caption);
      if (blockers.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Claim-safety: ${blockers.map((b) => `${b.rule} ("${b.match}")`).join("; ")} — edit the caption before scheduling.`,
        });
      }
      for (const url of input.slideUrls) assertPermanentPublicMediaUrl(url);
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
