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
  buildEvalArgs,
  evaluateInstagramDraft,
  generateInstagramStudioDraft,
  renderInstagramStudioAssets,
} from "../services/instagramStudio";
import { captionClaimBlockers, publishToSocial } from "../services/socialPublish";
import { IG_CAPTION_MAX } from "./instagramAdmin";
import type { AutonomyPolicy } from "../../client/src/lib/autonomyPolicy";

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

/** The evaluator args every proc passes now live in the SERVICE
 *  (buildEvalArgs) so generation and re-score cannot drift again — the router
 *  copy and the service's inline copy previously disagreed, and the same
 *  carousel scored 6 points lower at generation than at re-score. */
const evalArgs = buildEvalArgs;

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

/**
 * The static path's policy boundary — the same one the reel path has had since
 * #815 (reelPipeline.ts:172), applied to the format the operator uses most.
 *
 * Static posts previously reached the model and the renderer with NO kill-switch
 * check, NO operating-mode check, NO budget accounting and NO audit event. The
 * emergency stop therefore did not stop everything, and the daily spend the
 * Control tab displays did not count a single static generation.
 *
 * Actor is always `operator` here: every procedure in this router is an
 * adminProcedure, driven by a tap. That matters — enforceAtBoundary lets an
 * operator proceed LOUDLY when policy storage is unreachable, while automated
 * actors fail closed. Claiming to be cron would silently lock the operator out
 * of their own studio during an outage.
 */
async function enforceStudioBoundary(
  type: "generate_campaign" | "enqueue_render",
  format: string,
  operatorId?: string | number | null,
): Promise<void> {
  /**
   * The Studio's formats and the POLICY's formats are different vocabularies,
   * and the policy is the one with the permission rules attached. Mapped
   * explicitly and type-checked against the policy's own key set, because a
   * cast here silently disables format permissions: an unrecognised key matches
   * no rule, so `ad` — the only format that can spend paid media — would sail
   * past the paidAd permission entirely.
   */
  const POLICY_FORMAT = {
    post: "photo",
    photo: "photo",
    carousel: "carousel",
    story: "story",
    ad: "paidAd",
    reel: "reel",
  } satisfies Record<string, keyof AutonomyPolicy["formatPermissions"]>;
  const policyFormat = (POLICY_FORMAT as Record<string, keyof AutonomyPolicy["formatPermissions"]>)[format];
  if (!policyFormat) {
    // An unmapped format must not proceed ungoverned. Failing here is loud and
    // fixable; passing an unknown key would be silent and permanent.
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Format "${format}" has no autonomy-policy equivalent, so it cannot be governed. Add it to POLICY_FORMAT before using it.`,
    });
  }

  const { enforceAtBoundary } = await import("../services/autonomyControl");
  const { COST_ESTIMATES_USD } = await import("../services/generationLedger");
  const { dailySpendUsd } = await import("../services/generationLedger");

  // A budget check that cannot read today's spend must not invent a zero — that
  // would report the day as untouched and let every limit pass. Left undefined,
  // the policy engine treats the counter as unmeasured rather than as empty.
  const spendToday = await dailySpendUsd();

  await enforceAtBoundary(
    {
      type,
      format: policyFormat,
      platform: "instagram",
      estimatedCostUsd: type === "generate_campaign"
        ? COST_ESTIMATES_USD.gemini_brief
        : COST_ESTIMATES_USD.gpt_image_2,
      ...(spendToday !== null ? { today: { generationCostUsd: spendToday } } : {}),
    },
    { type: "operator", id: String(operatorId ?? "admin") },
  );
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
      /**
       * CORRECTION OF #932. I changed this message on the false belief that the
       * Reel Studio was unmounted. It is not: StudioV2.tsx:73 holds a
       * `showReelStudio` toggle that renders LegacyStudio (imported at :23), so
       * "Use the Reel Studio for Reels" was accurate directions all along.
       *
       * My reachability check was `grep ... | grep -vE "QueueV2"`, and grep
       * matches the whole output LINE — which includes the file path. The line
       * `StudioV2.tsx:23:import LegacyStudio from "./Studio"` contains the very
       * string the filter excluded, so the one result proving reachability was
       * removed by a filter written to remove false positives. A confident zero
       * from a broken query.
       *
       * The message now names the toggle explicitly, which is the durable fix:
       * directions that say WHERE the button is cannot be misread as pointing
       * at nothing.
       */
      format: z.enum(INSTAGRAM_FORMATS).refine(
        (value) => value !== "reel",
        "Reels use the verified ReelBrief pipeline — open the Reel Studio from the button on this tab.",
      ),
      objective: z.enum(INSTAGRAM_OBJECTIVES),
      operatorDirection: z.string().trim().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      /**
       * THE STATIC PATH HAD NO GATE AT ALL.
       *
       * reelPipeline.ts:172 and selectiveRepair.ts:131 both pass through
       * enforceAtBoundary, so the reel path honours the kill switch, the
       * operating mode, the daily generation budget, and writes an audit event.
       * Static posts — the format the operator uses most — reached the model and
       * the renderer with none of that.
       *
       * That is not a missing nicety. It means the emergency stop did not stop
       * everything: an operator who hit the kill switch would still have been
       * able to spend on posts, and the daily budget the Control tab shows would
       * not have counted a single one of them. A limit that covers one of two
       * paths is not a limit, it is a description of one path.
       */
      await enforceStudioBoundary("generate_campaign", input.format, ctx.user?.id);
      // Same recency window the re-score paths use — generation previously
      // omitted it, so novelty scored differently before and after staging.
      const draft = await generateInstagramStudioDraft({ ...input, recentConceptKeys: await recentKeysSafe() });
      // Open a content run so the four separate operator actions
      // (generate -> evaluate -> render -> stage) become ONE traceable thing.
      // Recording is additive and MUST NOT be able to break generation: the draft
      // is already made and paid for by the time we get here, so a null runId
      // degrades to today's behaviour rather than losing the work.
      const { createContentRun, advanceContentRun, RUN_STAGE, IMPLEMENTATION_STATE } =
        await import("../services/contentRun");
      const runId = await createContentRun({
        requestedBy: String(ctx.user?.id ?? ""),
        requestSource: "operator",
        requestedTopic: input.operatorDirection ?? null,
        requestedFormat: input.format,
      });
      if (runId) {
        await advanceContentRun(runId, {
          stage: RUN_STAGE.generating,
          implementationState: IMPLEMENTATION_STATE.pending,
          chosenFormat: input.format,
          formatReason: "Operator chose this format directly.",
          objective: input.objective,
          thesis: draft.topic,
          evidence: { at: new Date().toISOString(), what: `draft generated: "${draft.headline}"` },
        });
      }
      return { ...draft, runId };
    }),

  /**
   * `runId` is extended here for the same reason render and stage extend it, and
   * its absence was a silent severing of the whole spine.
   *
   * draftSchema is a plain z.object, so it STRIPS unknown keys. The client holds
   * the draft as one state object and replaces it wholesale with whatever this
   * mutation returns — so an operator who tapped "Re-check quality" before
   * rendering lost the runId, and every later call passed a draft without one.
   * render and stage then skipped advanceContentRun entirely, and the run sat at
   * stage `generating` forever, never learning which queue item it became.
   *
   * Whether the traceability spine worked depended on whether the operator
   * happened to press an optional button. That is not a spine.
   */
  evaluate: adminProcedure
    .input(draftSchema.extend({ runId: z.string().max(64).optional() }))
    .mutation(async ({ input }) => ({
      ...input,
      quality: evaluateInstagramDraft({ ...evalArgs(input), recentConceptKeys: await recentKeysSafe() }),
    })),

  render: adminProcedure
    .input(draftSchema.extend({ runId: z.string().max(64).optional() }))
    .mutation(async ({ input, ctx }) => {
      // Rendering is the step that actually spends on images, so it carries its
      // own gate rather than trusting that generate ran one — the Queue can
      // re-render a stored draft without generate ever being called in this
      // session, and a gate you can reach around is not a gate.
      await enforceStudioBoundary("enqueue_render", input.format, ctx.user?.id);
      const evaluated = {
        ...input,
        quality: evaluateInstagramDraft({ ...evalArgs(input), recentConceptKeys: await recentKeysSafe() }),
      };
      const imageUrls = await renderInstagramStudioAssets(evaluated);
      if (input.runId) {
        const { advanceContentRun, RUN_STAGE, IMPLEMENTATION_STATE } = await import("../services/contentRun");
        const { COST_ESTIMATES_USD } = await import("../services/generationLedger");
        // `costCents` had no writer anywhere, so contentRevenue's cost column was
        // structurally zero for every run — and a revenue figure sitting beside a
        // zero cost reads as pure profit. The per-image estimate is the same one
        // the spend governor budgets against, so the two agree by construction
        // rather than by two people remembering the same number.
        const costCents = Math.round(imageUrls.length * COST_ESTIMATES_USD.gpt_image_2 * 100);
        await advanceContentRun(input.runId, {
          stage: RUN_STAGE.qa,
          // BUILT, not proven. The media exists; nothing has published it.
          implementationState: IMPLEMENTATION_STATE.built,
          addCostCents: costCents,
          evidence: {
            at: new Date().toISOString(),
            what: `${imageUrls.length} asset(s) rendered (est. $${(costCents / 100).toFixed(2)})`,
            proof: imageUrls[0] ?? null,
          },
        });
      }
      return { ...evaluated, imageUrls };
    }),

  stage: adminProcedure
    .input(draftSchema.extend({ runId: z.string().max(64).optional() }))
    .mutation(async ({ input }) => {
      if (input.format === "reel") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Reels must use the verified ReelBrief pipeline." });
      }
      const database = await dbTyped();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const quality = evaluateInstagramDraft({ ...evalArgs(input), recentConceptKeys: await recentKeysSafe() });

      /**
       * Make the caption's existing shop links measurable BEFORE the row is
       * written, so what gets approved is exactly what gets published.
       *
       * This is the step that was missing: buildTrackedUrl had zero callers, so
       * no published link ever carried a run id, so leads.utmContent never
       * contained one, so the revenue report could only ever be empty — and an
       * empty report reads as "this content earned nothing" rather than "nothing
       * was ever measurable".
       */
      let caption = input.caption;
      let tracking: { rewritten: number; trackedUrls: string[] } = { rewritten: 0, trackedUrls: [] };
      if (input.runId) {
        const { applyTrackingToCaption } = await import("../services/contentRunAttribution");
        const applied = applyTrackingToCaption({ caption: input.caption, runId: input.runId });
        caption = applied.caption;
        tracking = { rewritten: applied.rewritten, trackedUrls: applied.trackedUrls };
      }

      const draft = { ...input, caption, quality };
      assertPublishable(draft);
      const id = input.id.startsWith("ig_") ? input.id : `ig_${randomUUID()}`;
      const contentType = input.format === "post" || input.format === "ad" ? "post" : input.format;

      // Generated drafts keep their stable ig_ id across evaluate/render, so a
      // re-tap of "Send to review queue" upserts the SAME row. The duplicate-key
      // update below used to run with NO status guard — one accidental re-stage
      // yanked an approved (even published) row back to "pending", outside the
      // version protocol every other mutation honors. Only rows still in a
      // pre-review state may be overwritten by staging.
      const existingRows = await database.select({ status: socialContentInventory.status, version: socialContentInventory.version })
        .from(socialContentInventory).where(eq(socialContentInventory.id, id)).limit(1);
      const existing = existingRows[0];
      if (existing && !["pending", "rejected", "failed"].includes(existing.status)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `This draft is already ${existing.status} in the queue. Edit it from the Queue instead of re-staging.`,
        });
      }

      const { sql } = await import("drizzle-orm");
      await database.insert(socialContentInventory).values({
        id,
        platform: "instagram",
        contentType,
        topic: input.topic.slice(0, 128),
        seriesName: "instagram_studio_v2",
        hookCategory: input.objective,
        hookText: caption,
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
          hookText: caption,
          bodyText: input.subheadline,
          scoreOverall: quality.overall,
          status: "pending",
          assetPaths: input.imageUrls,
          briefJson: JSON.stringify({ ...draft, id }),
          errorMessage: null,
          // Overwrites participate in the version protocol like every other
          // writer — a stale editor holding the old version must lose its CAS.
          version: sql`${socialContentInventory.version} + 1`,
          updatedAt: new Date(),
        },
      });

      // LINK the inventory row to the run. This is the join that lets the run
      // answer "what happened to the thing I asked for at 9am" — without it the
      // run knows a draft was made but not which queue item it became.
      if (input.runId) {
        const { advanceContentRun, RUN_STAGE } = await import("../services/contentRun");
        await advanceContentRun(input.runId, {
          stage: RUN_STAGE.awaiting_approval,
          inventoryId: id,
          evidence: {
            at: new Date().toISOString(),
            // Whether this post can ever be attributed is recorded AT STAGE TIME,
            // because that is the last moment it could have been changed. A run
            // that later shows no revenue must be distinguishable from a run that
            // was never measurable in the first place.
            what: tracking.rewritten > 0
              ? `staged to the queue as ${id}; ${tracking.rewritten} caption link(s) now carry this run's tracking`
              : `staged to the queue as ${id}; NO trackable link in the caption, so this post cannot be attributed to revenue`,
            proof: tracking.trackedUrls[0] ?? null,
          },
        });
      }
      return { id, status: "needs_review" as const, quality, trackedLinks: tracking.rewritten };
    }),

  list: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ input }) => {
      const database = await dbTyped();
      // THROW, never []. A 200-with-empty is indistinguishable from a genuinely
      // empty queue — QueueV2's isError branch (pinned by emptyIsNotUnknown
      // .test.ts) renders the honest outage card, but only if we actually error.
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — the queue cannot be read (this is an outage, not an empty queue)." });
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
      const saveResult = await database.update(socialContentInventory).set({
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
      // Same rule as approve: the read-then-act check above is advisory; this
      // CAS is the gate. Matching zero rows means another request edited or
      // approved first — reporting success for a write that changed nothing is
      // how a lost edit masquerades as a saved one.
      const { affectedRowCount } = await import("../lib/db-affected");
      if (affectedRowCount(saveResult) === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Draft changed in another session. Refresh before saving." });
      }
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
      // "publishing" means the Meta call is in flight — the outcome is not ours
      // to overwrite. Rejecting here used to race the publish's failure path,
      // which reset the row to "ready" and erased the rejection.
      if (row.status === "publishing") {
        throw new TRPCError({ code: "CONFLICT", message: "A publish attempt is in flight. Wait for its outcome, then reject." });
      }

      // A scheduled item has a pending scheduled_posts row that WILL fire.
      // Cancel it FIRST — flipping the inventory status alone never stopped the
      // cron, which is how rejected content still went live at the scheduled
      // time. Zero cancelled rows means the cron already claimed it.
      const { affectedRowCount } = await import("../lib/db-affected");
      if (row.status === "scheduled") {
        const cancelled = await database.update(scheduledPosts).set({
          status: "canceled",
          error: `rejected by operator: ${input.reason}`.slice(0, 500),
        }).where(and(eq(scheduledPosts.inventoryId, input.id), eq(scheduledPosts.status, "pending")));
        if (affectedRowCount(cancelled) === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "The scheduled publish is already executing (or was created before cancellation was possible). Verify its outcome on Instagram before rejecting.",
          });
        }
      }

      // Version-CAS like every other mutation — reject was the one writer
      // outside the protocol, so a concurrent edit could silently absorb or
      // erase a rejection.
      const rejectResult = await database.update(socialContentInventory).set({
        status: "rejected", errorMessage: input.reason, version: row.version + 1, updatedAt: new Date(),
      }).where(and(eq(socialContentInventory.id, input.id), eq(socialContentInventory.version, row.version)));
      if (affectedRowCount(rejectResult) === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Draft changed in another session. Refresh and re-review before rejecting." });
      }
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

      // Every post-claim write below is predicated on status='publishing' — we
      // only ever overwrite the state we own. Without the predicate, a reject
      // that lands during the seconds-long Meta call was erased by the failure
      // path's unconditional reset to "ready".
      const ownClaim = and(eq(socialContentInventory.id, input.id), eq(socialContentInventory.status, "publishing"));

      let outcome: Awaited<ReturnType<typeof publishToSocial>>;
      try {
        outcome = await publishToSocial({
          platforms: ["instagram"],
          caption,
          ...mediaForDraft(draft),
          isStory: draft.format === "story",
        });
      } catch (err) {
        // A throw is NOT proof nothing posted — the call may have reached Meta
        // before dying. Park for reconciliation instead of releasing back to
        // "ready", which invites a duplicate on retry. Same rule as the
        // scheduled-posts cron.
        await database.update(socialContentInventory).set({
          status: "ambiguous",
          errorMessage: `threw mid-publish — may be LIVE on Instagram. Verify before retrying: ${(err instanceof Error ? err.message : String(err))}`.slice(0, 500),
          updatedAt: new Date(),
        }).where(ownClaim);
        throw err;
      }
      const instagram = outcome.results.find((item) => item.platform === "instagram");
      if (!instagram?.success) {
        if (instagram?.ambiguous) {
          // The media_publish POST was dispatched and the response never came
          // back. Recording this as a plain failure is what turned one timeout
          // into two live posts: "failed" invites retry, and the first post may
          // already be up.
          await database.update(socialContentInventory).set({
            status: "ambiguous",
            errorMessage: `publish timed out AFTER dispatch — may be LIVE on Instagram. Verify before retrying: ${instagram.error ?? "no response"}`.slice(0, 500),
            updatedAt: new Date(),
          }).where(ownClaim);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The publish call timed out after it was sent — the post MAY BE LIVE. Check the Instagram account before retrying; retrying now can duplicate it.",
          });
        }
        await database.update(socialContentInventory).set({
          status: "ready",
          errorMessage: instagram?.error?.slice(0, 500) || "Instagram publish failed",
          updatedAt: new Date(),
        }).where(ownClaim);
        throw new TRPCError({ code: "BAD_REQUEST", message: instagram?.error || "Instagram publish failed" });
      }
      await database.update(socialContentInventory).set({
        status: "published", publishedAt: new Date(), errorMessage: null, updatedAt: new Date(),
      }).where(ownClaim);
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

      // The publish path was fixed to REJECT an over-length caption; this one still
      // silently `.slice(0, 2200)`d it, so the same draft would publish intact but
      // schedule truncated — the operator reviews one caption and a different one
      // goes out hours later, with no signal. Deferred execution is exactly when
      // nobody is watching, so it needs the stricter rule, not the looser one.
      const scheduledCaption = `${draft.caption}\n\n${draft.hashtags.map((tag) => `#${tag}`).join(" ")}`.trim();
      if (scheduledCaption.length > IG_CAPTION_MAX) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Caption with hashtags is ${scheduledCaption.length} characters — Instagram's limit is ${IG_CAPTION_MAX}. Shorten it; nothing is trimmed automatically.`,
        });
      }
      /**
       * SCHEDULING NEEDS THE APPROVAL CHECK MORE THAN PUBLISHING DOES, NOT LESS.
       *
       * `publish` verifies that what goes out is byte-identical to what the
       * operator approved (instagramStudio.ts:564). `schedule` did not — so the
       * stricter path was the one where a human is watching, and the looser path
       * was the one that fires hours later with nobody in the room.
       *
       * This file already makes exactly this argument about captions a few lines
       * up: "deferred execution is exactly when nobody is watching, so it needs
       * the stricter rule, not the looser one." The rule was written down and
       * then applied to one of the two things that needed it.
       */
      // Verify with the SAME media set approve hashed (the full imageUrls
      // array). Deriving a subset from mediaForDraft here made every
      // multi-image post/ad fail with a false "media changed" — approve hashed
      // N urls, schedule presented 1.
      const { verifyApprovalRecord } = await import("../services/contentApprovals");
      const scheduleVerdict = await verifyApprovalRecord(database, {
        inventoryId: input.id,
        version: row.version - 1,
        briefJson: row.briefJson,
        mediaUrls: draft.imageUrls,
      });
      if (!scheduleVerdict.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            scheduleVerdict.reason === "no_record"
              ? "No approval record found for this version — re-approve the draft before scheduling it."
              : `Integrity breach: the draft's ${scheduleVerdict.reason === "brief_mismatch" ? "content" : "media"} changed after approval. Re-review and re-approve before scheduling.`,
        });
      }

      // CLAIM BEFORE INSERT. The status read at the top is advisory; this CAS
      // is the gate. Two concurrent schedule calls (a double-tap, or schedule
      // racing publish) both pass the read — without the claim, both inserted a
      // scheduled_posts row and the cron published the post twice.
      const { affectedRowCount } = await import("../lib/db-affected");
      const scheduleClaim = await database.update(socialContentInventory).set({
        status: "scheduled", errorMessage: null, updatedAt: new Date(),
      }).where(and(eq(socialContentInventory.id, input.id), eq(socialContentInventory.status, "ready")));
      if (affectedRowCount(scheduleClaim) === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Another request claimed this draft first (scheduled or publishing). Refresh the queue." });
      }

      // STATUS ONLY — never `scheduledAt`. The scheduled_posts row inserted
      // below owns this publish; stamping scheduled_at here would ALSO arm
      // socialInventoryPublisher.ts:29, which publishes inventory rows with
      // status IN ('approved','scheduled') AND scheduled_at <= now. Two
      // publishers over two tables, same content, same moment — a guaranteed
      // duplicate post that no CAS can prevent, because each publisher's
      // at-most-once claim only protects it from itself.
      try {
        await database.insert(scheduledPosts).values({
          inventoryId: input.id,
          platforms: ["instagram"],
          caption: scheduledCaption,
          imageUrl: "imageUrl" in media ? media.imageUrl ?? null : null,
          imageUrls: "imageUrls" in media ? media.imageUrls ?? null : null,
          videoUrl: null,
          scheduledAt: when,
          status: "pending",
        });
      } catch (err) {
        // The claim must not outlive a failed insert — release it or the draft
        // reads "scheduled" with no scheduled_posts row to ever fire it.
        await database.update(socialContentInventory).set({
          status: "ready", errorMessage: `scheduling failed: ${(err instanceof Error ? err.message : String(err))}`.slice(0, 500), updatedAt: new Date(),
        }).where(and(eq(socialContentInventory.id, input.id), eq(socialContentInventory.status, "scheduled")));
        throw err;
      }
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
