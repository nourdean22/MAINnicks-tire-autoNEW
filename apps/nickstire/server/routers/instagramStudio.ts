import { randomUUID } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  INSTAGRAM_FORMATS,
  INSTAGRAM_OBJECTIVES,
  INSTAGRAM_SOURCE_TYPES,
  INSTAGRAM_STUDIO_VERSION,
  type InstagramStudioDraft,
} from "../../shared/instagramStudio";
import { socialContentInventory, scheduledPosts } from "../../drizzle/schema";
import { adminProcedure, router } from "../_core/trpc";
import { dbTyped } from "../lib/db-helper";
import {
  evaluateInstagramDraft,
  generateInstagramStudioDraft,
  renderInstagramStudioAssets,
} from "../services/instagramStudio";
import { captionClaimBlockers, publishToSocial } from "../services/socialPublish";
import { IG_CAPTION_MAX } from "./instagramAdmin";

const sourceSchema = z.object({
  type: z.enum(INSTAGRAM_SOURCE_TYPES),
  recordId: z.string().trim().max(80).optional(),
  detail: z.string().trim().max(2000).optional(),
  evidenceStatus: z.enum(["verified", "operator_context", "unverified"]).optional(),
});

const qualityDimensionSchema = z.object({
  key: z.enum([
    "claim_safety", "source_grounding", "hook_strength", "voice_match",
    "local_relevance", "usefulness", "visual_readiness", "novelty",
  ]),
  label: z.string(),
  score: z.number().min(0).max(10),
  weight: z.number().min(0).max(1),
  status: z.enum(["pass", "warn", "block"]),
  finding: z.string().optional(),
});

const qualitySchema = z.object({
  version: z.literal(INSTAGRAM_STUDIO_VERSION),
  overall: z.number().min(0).max(100),
  gate: z.enum(["pass", "warn", "block"]),
  dimensions: z.array(qualityDimensionSchema),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  evaluatedAt: z.string(),
});

const slideSchema = z.object({
  role: z.enum(["hook", "truth", "proof", "action", "cta"]),
  headline: z.string().max(42),
  body: z.string().max(110),
  artDirection: z.string().max(300),
});

const draftSchema = z.object({
  version: z.literal(INSTAGRAM_STUDIO_VERSION),
  id: z.string().min(3).max(80),
  source: sourceSchema,
  format: z.enum(INSTAGRAM_FORMATS),
  objective: z.enum(INSTAGRAM_OBJECTIVES),
  topic: z.string().min(2).max(180),
  caption: z.string().min(1).max(2200),
  hashtags: z.array(z.string().max(40)).max(12),
  headline: z.string().min(1).max(42),
  subheadline: z.string().min(1).max(90),
  cta: z.string().min(1).max(52),
  artDirection: z.string().min(1).max(500),
  carouselSlides: z.array(slideSchema).max(7),
  imageUrls: z.array(z.string().url()).max(10),
  videoUrl: z.string().url().optional(),
  rationale: z.string().max(500),
  conceptKey: z.string().min(3).max(64),
  quality: qualitySchema,
  createdAt: z.string(),
});

function parseDraft(value: string | null): InstagramStudioDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed?.version === INSTAGRAM_STUDIO_VERSION ? draftSchema.parse(parsed) : null;
  } catch {
    return null;
  }
}

/** Recent concept keys for the novelty dimension. Failure means "recency
 *  unknown" (scored honestly as unchecked), never a blocked evaluation. */
async function recentKeysSafe(): Promise<string[] | undefined> {
  try {
    const { fetchRecentConceptKeys } = await import("../services/igAutopost");
    return await fetchRecentConceptKeys();
  } catch {
    return undefined;
  }
}

/** The evaluator args every proc passes — including the carousel slides the
 *  renderer actually draws (visual readiness scored copy that never rendered
 *  before this). */
function evalArgs(d: {
  source: InstagramStudioDraft["source"];
  format: InstagramStudioDraft["format"];
  caption: string;
  headline: string;
  subheadline: string;
  artDirection: string;
  conceptKey: string;
  cta: string;
  carouselSlides: Array<{ headline: string; body: string }>;
}) {
  return {
    source: d.source,
    format: d.format,
    caption: d.caption,
    headline: d.headline,
    subheadline: d.subheadline,
    artDirection: d.artDirection,
    conceptKey: d.conceptKey,
    cta: d.cta,
    carouselSlides: d.carouselSlides,
  };
}

function mediaForDraft(draft: InstagramStudioDraft) {
  if (draft.format === "carousel") return { imageUrls: draft.imageUrls };
  if (draft.format === "reel") return { videoUrl: draft.videoUrl };
  return { imageUrl: draft.imageUrls[0] };
}

function assertPublishable(draft: InstagramStudioDraft): void {
  if (draft.quality.gate === "block") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Quality gate blocked: ${draft.quality.blockers.join("; ")}` });
  }
  if (draft.format === "carousel" && draft.imageUrls.length < 2) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Carousel requires at least two rendered slides." });
  }
  if (draft.format !== "reel" && draft.imageUrls.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Render or attach media before continuing." });
  }
  if (draft.format === "reel" && !draft.videoUrl) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Reel requires an approved video asset." });
  }
  const blockers = captionClaimBlockers(draft.caption);
  if (blockers.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Claim-safety: ${blockers.map((item) => `${item.rule} (${item.match})`).join("; ")}`,
    });
  }
}

async function loadInventoryDraft(id: string) {
  const database = await dbTyped();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const rows = await database.select().from(socialContentInventory).where(eq(socialContentInventory.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found" });
  const draft = parseDraft(row.briefJson);
  if (!draft) throw new TRPCError({ code: "BAD_REQUEST", message: "This item predates Studio V2 and must be opened in the legacy queue." });
  return { database, row, draft };
}

export const instagramStudioRouter = router({
  generate: adminProcedure
    .input(z.object({
      source: sourceSchema,
      format: z.enum(INSTAGRAM_FORMATS).refine((value) => value !== "reel", "Use the Reel Studio for Reels"),
      objective: z.enum(INSTAGRAM_OBJECTIVES),
      operatorDirection: z.string().trim().max(2000).optional(),
    }))
    .mutation(async ({ input }) => generateInstagramStudioDraft(input)),

  evaluate: adminProcedure
    .input(draftSchema)
    .mutation(async ({ input }) => ({
      ...input,
      quality: evaluateInstagramDraft({ ...evalArgs(input), recentConceptKeys: await recentKeysSafe() }),
    })),

  render: adminProcedure
    .input(draftSchema)
    .mutation(async ({ input }) => {
      const evaluated = {
        ...input,
        quality: evaluateInstagramDraft({ ...evalArgs(input), recentConceptKeys: await recentKeysSafe() }),
      };
      const imageUrls = await renderInstagramStudioAssets(evaluated);
      return { ...evaluated, imageUrls };
    }),

  stage: adminProcedure
    .input(draftSchema)
    .mutation(async ({ input }) => {
      if (input.format === "reel") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Reels must use the verified ReelBrief pipeline." });
      }
      const database = await dbTyped();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const quality = evaluateInstagramDraft({ ...evalArgs(input), recentConceptKeys: await recentKeysSafe() });
      const draft = { ...input, quality };
      assertPublishable(draft);
      const id = input.id.startsWith("ig_") ? input.id : `ig_${randomUUID()}`;
      const contentType = input.format === "post" || input.format === "ad" ? "post" : input.format;
      await database.insert(socialContentInventory).values({
        id,
        platform: "instagram",
        contentType,
        topic: input.topic.slice(0, 128),
        seriesName: "instagram_studio_v2",
        hookCategory: input.objective,
        hookText: input.caption,
        bodyText: input.subheadline,
        visualStyle: "nick_grit_v2",
        persona: "nick",
        scoreOverall: quality.overall,
        status: "pending",
        assetPaths: input.imageUrls,
        briefJson: JSON.stringify({ ...draft, id }),
        version: 1,
      }).onDuplicateKeyUpdate({
        set: {
          hookText: input.caption,
          bodyText: input.subheadline,
          scoreOverall: quality.overall,
          status: "pending",
          assetPaths: input.imageUrls,
          briefJson: JSON.stringify({ ...draft, id }),
          errorMessage: null,
          updatedAt: new Date(),
        },
      });
      return { id, status: "needs_review" as const, quality };
    }),

  list: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ input }) => {
      const database = await dbTyped();
      if (!database) return [];
      const rows = await database.select().from(socialContentInventory)
        .where(eq(socialContentInventory.seriesName, "instagram_studio_v2"))
        .orderBy(desc(socialContentInventory.createdAt))
        .limit(input?.limit ?? 50);
      return rows.map((row) => ({
        id: row.id,
        version: row.version,
        status: row.status === "pending" ? "needs_review" : row.status,
        scheduledAt: row.scheduledAt,
        publishedAt: row.publishedAt,
        error: row.errorMessage,
        draft: parseDraft(row.briefJson),
      })).filter((item) => item.draft !== null);
    }),

  update: adminProcedure
    .input(z.object({ id: z.string(), expectedVersion: z.number().int().positive(), draft: draftSchema }))
    .mutation(async ({ input }) => {
      const { database, row } = await loadInventoryDraft(input.id);
      if (["published", "scheduled"].includes(row.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot edit a ${row.status} item.` });
      }
      if (row.version !== input.expectedVersion) {
        throw new TRPCError({ code: "CONFLICT", message: "Draft changed in another session. Refresh before saving." });
      }
      const quality = evaluateInstagramDraft({ ...evalArgs(input.draft), recentConceptKeys: await recentKeysSafe() });
      const nextVersion = row.version + 1;
      await database.update(socialContentInventory).set({
        hookText: input.draft.caption,
        bodyText: input.draft.subheadline,
        scoreOverall: quality.overall,
        status: "pending",
        assetPaths: input.draft.imageUrls,
        briefJson: JSON.stringify({ ...input.draft, quality }),
        version: nextVersion,
        errorMessage: null,
        updatedAt: new Date(),
      }).where(and(eq(socialContentInventory.id, input.id), eq(socialContentInventory.version, input.expectedVersion)));
      return { version: nextVersion, status: "needs_review" as const, quality };
    }),

  approve: adminProcedure
    .input(z.object({ id: z.string(), expectedVersion: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { user } = ctx;
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Admin identity missing" });
      const { database, row, draft } = await loadInventoryDraft(input.id);
      if (row.version !== input.expectedVersion) throw new TRPCError({ code: "CONFLICT", message: "Draft version changed. Refresh first." });
      if (row.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Only needs-review drafts can be approved." });
      assertPublishable(draft);

      // Provenance: hash the brief + the exact media bytes being approved,
      // BEFORE the status flip — publish/schedule/cron recompute and refuse on
      // mismatch, so what goes live is what this human looked at. Reels have
      // had this since the approval-integrity arc; other formats had nothing.
      const { createApprovalRecord } = await import("../services/contentApprovals");
      const mediaUrls = draft.format === "reel" ? [draft.videoUrl as string] : draft.imageUrls;
      await createApprovalRecord(database, {
        inventoryId: input.id,
        version: input.expectedVersion,
        approvedBy: user.id,
        briefJson: row.briefJson,
        mediaUrls,
      });

      const nextVersion = row.version + 1;
      const updateResult = await database.update(socialContentInventory).set({
        status: "ready", version: nextVersion, errorMessage: null, updatedAt: new Date(),
      }).where(and(eq(socialContentInventory.id, input.id), eq(socialContentInventory.version, input.expectedVersion)));
      // The pre-checks above are read-then-act; this is the actual gate. Losing
      // the CAS means another request approved/edited first — say so instead of
      // returning a success for an update that matched zero rows.
      const { affectedRowCount } = await import("../lib/db-affected");
      if (affectedRowCount(updateResult) === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Draft was modified by another request. Refresh and re-review." });
      }
      return { status: "ready" as const, version: nextVersion };
    }),

  reject: adminProcedure
    .input(z.object({ id: z.string(), reason: z.string().trim().min(2).max(500) }))
    .mutation(async ({ input }) => {
      const { database, row } = await loadInventoryDraft(input.id);
      if (row.status === "published") throw new TRPCError({ code: "BAD_REQUEST", message: "Published content cannot be rejected." });
      await database.update(socialContentInventory).set({
        status: "rejected", errorMessage: input.reason, updatedAt: new Date(),
      }).where(eq(socialContentInventory.id, input.id));
      return { status: "rejected" as const };
    }),

  publish: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const { database, row, draft } = await loadInventoryDraft(input.id);
      if (row.status !== "ready") throw new TRPCError({ code: "BAD_REQUEST", message: "Approve the draft before publishing." });
      assertPublishable(draft);

      // Same ceiling publishPost enforces; the previous `.slice(0, 2200)` here
      // silently cut hashtags/CTA off an approved caption at publish time.
      const caption = `${draft.caption}\n\n${draft.hashtags.map((tag) => `#${tag}`).join(" ")}`.trim();
      if (caption.length > IG_CAPTION_MAX) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Caption with hashtags is ${caption.length} characters — Instagram's limit is ${IG_CAPTION_MAX}. Shorten it; nothing is trimmed automatically.`,
        });
      }

      // Integrity: what publishes must be byte-identical to what was approved.
      // The approval record was written at version-1 (approve bumps the row).
      const { verifyApprovalRecord } = await import("../services/contentApprovals");
      const mediaUrls = draft.format === "reel" ? [draft.videoUrl as string] : draft.imageUrls;
      const verdict = await verifyApprovalRecord(database, {
        inventoryId: input.id,
        version: row.version - 1,
        briefJson: row.briefJson,
        mediaUrls,
      });
      if (!verdict.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            verdict.reason === "no_record"
              ? "No approval record found for this version — re-approve the draft before publishing."
              : `Integrity breach: the draft's ${verdict.reason === "brief_mismatch" ? "content" : "media"} changed after approval. Re-review and re-approve.`,
        });
      }

      // At-most-once claim before the irreversible Meta call (same idiom as
      // publishPost/#748): two concurrent publishes both pass the status read
      // above; only the CAS winner proceeds.
      const { affectedRowCount } = await import("../lib/db-affected");
      const claim = await database.update(socialContentInventory)
        .set({ status: "publishing", updatedAt: new Date() })
        .where(and(eq(socialContentInventory.id, input.id), eq(socialContentInventory.status, "ready")));
      if (affectedRowCount(claim) === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Another publish attempt claimed this draft first." });
      }

      let outcome: Awaited<ReturnType<typeof publishToSocial>>;
      try {
        outcome = await publishToSocial({
          platforms: ["instagram"],
          caption,
          ...mediaForDraft(draft),
          isStory: draft.format === "story",
        });
      } catch (err) {
        // The claim must not outlive a throw or the draft wedges in "publishing".
        await database.update(socialContentInventory).set({
          status: "ready", errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500), updatedAt: new Date(),
        }).where(eq(socialContentInventory.id, input.id));
        throw err;
      }
      const instagram = outcome.results.find((item) => item.platform === "instagram");
      if (!instagram?.success) {
        await database.update(socialContentInventory).set({
          status: "ready",
          errorMessage: instagram?.error?.slice(0, 500) || "Instagram publish failed",
          updatedAt: new Date(),
        }).where(eq(socialContentInventory.id, input.id));
        throw new TRPCError({ code: "BAD_REQUEST", message: instagram?.error || "Instagram publish failed" });
      }
      await database.update(socialContentInventory).set({
        status: "published", publishedAt: new Date(), errorMessage: null, updatedAt: new Date(),
      }).where(eq(socialContentInventory.id, input.id));
      return { status: "published" as const, postId: instagram.postId ?? null };
    }),

  schedule: adminProcedure
    .input(z.object({ id: z.string(), scheduledAt: z.string().datetime() }))
    .mutation(async ({ input }) => {
      const { database, row, draft } = await loadInventoryDraft(input.id);
      if (row.status !== "ready") throw new TRPCError({ code: "BAD_REQUEST", message: "Approve the draft before scheduling." });
      if (draft.format === "story" || draft.format === "reel") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${draft.format} scheduling is not armed; publish it explicitly from the queue.` });
      }
      assertPublishable(draft);
      const when = new Date(input.scheduledAt);
      if (!Number.isFinite(when.getTime()) || when.getTime() <= Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Scheduled time must be in the future." });
      }
      const media = mediaForDraft(draft);
      await database.insert(scheduledPosts).values({
        platforms: ["instagram"],
        caption: `${draft.caption}\n\n${draft.hashtags.map((tag) => `#${tag}`).join(" ")}`.trim().slice(0, 2200),
        imageUrl: "imageUrl" in media ? media.imageUrl ?? null : null,
        imageUrls: "imageUrls" in media ? media.imageUrls ?? null : null,
        videoUrl: null,
        scheduledAt: when,
        status: "pending",
      });
      await database.update(socialContentInventory).set({
        status: "scheduled", scheduledAt: when, errorMessage: null, updatedAt: new Date(),
      }).where(eq(socialContentInventory.id, input.id));
      return { status: "scheduled" as const, scheduledAt: when.toISOString() };
    }),

  diagnostics: adminProcedure.query(async () => {
    const database = await dbTyped();
    if (!database) return { connected: false, counts: {}, blockers: ["Database unavailable"] };
    const rows = await database.select({ status: socialContentInventory.status })
      .from(socialContentInventory)
      .where(eq(socialContentInventory.seriesName, "instagram_studio_v2"));
    const counts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
    const blocked = await database.select({ id: socialContentInventory.id })
      .from(socialContentInventory)
      .where(and(
        eq(socialContentInventory.seriesName, "instagram_studio_v2"),
        inArray(socialContentInventory.status, ["failed", "rejected"]),
      )).limit(20);
    return { connected: true, counts, blockers: blocked.map((item) => item.id) };
  }),
});
