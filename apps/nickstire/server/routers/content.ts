/**
 * Content router — public content access and admin content management.
 */
import { TRPCError } from "@trpc/server";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { getDbTyped } from "../db";
import { contentManufacturingCampaigns, socialContentInventory } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { sendNotification } from "../email-notify";
import {
  generateArticle,
  saveGeneratedArticle,
  getPublishedArticles,
  getAllDynamicArticles,
  getDynamicArticleBySlug,
  updateArticleStatus,
  updateArticleContent,
  getActiveNotifications,
  getAllNotifications,
  updateNotificationStatus,
  deleteNotification,
  getGenerationLog,
  runContentGeneration,
  getCurrentSeason,
} from "../content-generator";
import { z } from "zod";
import { GBP_ARCHETYPES } from "@shared/const";

import { createLogger } from "../lib/logger";
import type { ReelBrief } from "../../client/src/lib/facelessReelStudio";
import { dispatch } from "../services/eventBus";

const log = createLogger("routers:content");

/**
 * Minimal input schema for server-side reel quality validation — covers exactly
 * the fields `calculateReelQualityScore` reads. `.passthrough()` keeps any extra
 * ReelBrief fields the client sends; the validated object is cast to ReelBrief
 * for the pure scorer, which only touches these fields.
 */
const reelBriefScoreInput = z.object({
  campaignKeyword: z.string(),
  mechanicTruth: z.string().default(""),
  voiceoverScript: z.string().default(""),
  selectedCaption: z.string().default(""),
  captionHooks: z.array(z.string()).default([]),
  sourceNotes: z.array(z.unknown()).default([]),
  winningConceptId: z.string().nullable().default(null),
  storyboardBeats: z.array(z.object({
    beatNumber: z.number(),
    startSecond: z.number(),
    endSecond: z.number(),
    visual: z.string(),
    onScreenText: z.string(),
  }).passthrough()).default([]),
  promptPack: z.array(z.object({ prompt: z.string() }).passthrough()).default([]),
  higgsfieldPromptPack: z.array(z.object({ prompt: z.string() }).passthrough()).default([]),
  concepts: z.array(z.object({
    id: z.string(),
    loopIdea: z.string().default(""),
    scores: z.object({
      hook: z.number(), truth: z.number(), save: z.number(),
      local: z.number(), absurdity: z.number(), fit: z.number(),
    }),
  }).passthrough()).default([]),
}).passthrough();

export const contentRouter = router({
  publishedArticles: publicProcedure.query(async () => {
    return getPublishedArticles();
  }),
  articleBySlug: publicProcedure
    .input(z.object({ slug: z.string().max(200) }))
    .query(async ({ input }) => {
      return getDynamicArticleBySlug(input.slug);
    }),
  activeNotifications: publicProcedure.query(async () => {
    return getActiveNotifications();
  }),
  currentSeason: publicProcedure.query(() => {
    return { season: getCurrentSeason() };
  }),
});

export const contentAdminRouter = router({
  allArticles: adminProcedure.query(async () => {
    return getAllDynamicArticles();
  }),
  updateArticleStatus: adminProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["draft", "published", "rejected"]),
    }))
    .mutation(async ({ input }) => {
      try {
        return updateArticleStatus(input.id, input.status);
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
  updateArticleContent: adminProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().max(500).optional(),
      excerpt: z.string().max(2000).optional(),
      metaDescription: z.string().max(500).optional(),
      sectionsJson: z.string().max(100000).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { id, ...updates } = input;
        return updateArticleContent(id, updates);
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
  allNotifications: adminProcedure.query(async () => {
    return getAllNotifications();
  }),
  toggleNotification: adminProcedure
    .input(z.object({
      id: z.number(),
      isActive: z.number().min(0).max(1),
    }))
    .mutation(async ({ input }) => {
      try {
        return updateNotificationStatus(input.id, input.isActive);
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
  deleteNotification: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        return deleteNotification(input.id);
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
  generationLog: adminProcedure.query(async () => {
    return getGenerationLog();
  }),
  generateContent: adminProcedure
    .input(z.object({ topic: z.string().max(500).optional() }).optional())
    .mutation(async ({ input: _input }) => {
      try {
        const result = await runContentGeneration();
        if (result.article) {
          sendNotification({
            category: "content",
            subject: "New AI Content Generated",
            body: `Article: ${result.article.title}\nNotifications: ${result.notifications.length} generated\nErrors: ${result.errors.length > 0 ? result.errors.join(", ") : "None"}\n\nReview and publish at /admin?tab=content`,
          }).catch((e) => { log.warn("[routers/content] fire-and-forget failed:", e); });
        }
        return result;
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
  generateArticle: adminProcedure
    .input(z.object({ topic: z.string().max(500) }))
    .mutation(async ({ input }) => {
      try {
        const article = await generateArticle(input.topic);
        const id = await saveGeneratedArticle(article);
        return { article, id };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
  // GBP one-off post generator — admin clicks "Generate GBP Post" button.
  // Returns the post text + CTA + image hint (no auto-send). Nour pastes
  // into business.google.com manually because GBP Posts API is deprecated.
  generateGBPPost: adminProcedure
    .input(z.object({
      forceArchetype: z.enum(GBP_ARCHETYPES).optional(),
      dryRun: z.boolean().optional(),
      requiresReview: z.boolean().optional(),
    }).optional())
    .mutation(async ({ input }) => {
      try {
        const { generateOneOffGBPPost } = await import("../services/gbpAutoPost");
        return await generateOneOffGBPPost(input?.forceArchetype, {
          dryRun: input?.dryRun,
          requiresReview: input?.requiresReview,
        });
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "GBP post generation failed" });
      }
    }),
  // GBP post history — last 14 posts (variety guard window). Lets Nour
  // see what's been queued and confirm playbook ratio is being respected.
  gbpPostHistory: adminProcedure.query(async () => {
    try {
      const { db: dbHelper } = await import("../lib/db-helper");
      const { gbpPostLog } = await import("../../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      const d = await dbHelper();
      if (!d) return [];
      const rows = await d
        .select({
          id: gbpPostLog.id,
          archetype: gbpPostLog.archetype,
          postBody: gbpPostLog.postBody,
          ctaType: gbpPostLog.ctaType,
          source: gbpPostLog.source,
          postedAt: gbpPostLog.postedAt,
        })
        .from(gbpPostLog)
        .orderBy(desc(gbpPostLog.postedAt))
        .limit(14);
      return rows;
    } catch (err) {
      log.warn("[content] gbpPostHistory failed", { err: err instanceof Error ? err.message : err });
      return [];
    }
  }),
  saveReelDraft: adminProcedure
    .input(z.object({
      id: z.string(),
      topic: z.string(),
      brief: z.any(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { getDb } = await import("../db");
        const { socialDrafts } = await import("../../drizzle/schema");
        const d = await getDb();
        if (d) {
          await d.insert(socialDrafts).values({
            id: input.id,
            contentType: "reel",
            topic: input.topic,
            briefJson: JSON.stringify(input.brief),
          }).onDuplicateKeyUpdate({
            set: {
              topic: input.topic,
              briefJson: JSON.stringify(input.brief),
            }
          });
        }

        // Dual-write/sync to sheet
        let sheetOk = false;
        try {
          const { syncReelDraftToSheet } = await import("../sheets-sync");
          sheetOk = await syncReelDraftToSheet(input.id, input.topic, JSON.stringify(input.brief));
        } catch (err) {
          log.warn("syncReelDraftToSheet failed", err);
        }

        // Sync with Statenour Command Center Queue
        try {
          await dispatch("social_draft:sync", {
            id: input.id,
            content: input.brief?.selectedCaption || input.brief?.voiceoverScript || input.topic,
            status: input.brief?.status === "approved" || input.brief?.status === "scheduled" ? "pending" : (input.brief?.status || "pending"),
            imageUrl: input.brief?.videoUrl || null,
            platforms: ["instagram"],
            kind: "reel",
            source: "nick",
            sourceMetadata: {
              topic: input.topic,
              brief: input.brief,
            },
            scheduledFor: input.brief?.scheduledFor ? new Date(input.brief.scheduledFor).toISOString() : null,
            publishedAt: input.brief?.publishedAt ? new Date(input.brief.publishedAt).toISOString() : null,
          }, { source: "content_router" });
        } catch (syncErr) {
          log.warn("Failed to sync Reel draft to Statenour:", syncErr);
        }

        return { success: true, sheetSynced: sheetOk };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Save Reel draft failed" });
      }
    }),
  /** Deterministic 4:5 slide rendering for a carousel brief - the consumer of
   *  the Studio's headline/body design intent (docs/operations: textOverlayPlan
   *  had NO production path until 2026-07-17). Renders via the same
   *  puppeteer+storagePut stack as Studio V2, with per-territory design systems. */
  renderCarouselSlides: adminProcedure
    .input(z.object({
      brief: z.object({
        id: z.string().optional(),
        creativeTerritory: z.string(),
        campaignKeyword: z.string().min(1),
        topic: z.string().min(1),
        slides: z.array(z.object({
          slideNumber: z.number().int().min(1).max(7),
          role: z.string(),
          headline: z.string().min(1),
          body: z.string(),
        })).min(1).max(7),
      }),
    }))
    .mutation(async ({ input }) => {
      const { renderCarouselSlides } = await import("../services/carouselSlideRenderer");
      const urls = await renderCarouselSlides(input.brief as any);
      return { urls };
    }),

  /** Genome Wave 1 slice 2: role-diverse concept tournament with an
   *  INDEPENDENT judge (replaces self-scored concept selection). Optionally
   *  chains the judged winner into a campaign genome. */
  listCampaignGenomes: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }).optional())
    .query(async ({ input }) => {
      const { listGenomes } = await import("../services/creativeMemory");
      return listGenomes(input?.limit ?? 20);
    }),

  /** Shadow planner (Stage 0 autonomy): DETERMINISTIC ranked campaign
   *  recommendations from real signals - observes and recommends ONLY.
   *  Structurally incapable of generating, reserving, or publishing. */
  getShadowPlan: adminProcedure.query(async () => {
    const { generateShadowPlan } = await import("../services/shadowPlanner");
    const plan = await generateShadowPlan();

    // The planner picks WHAT to talk about; it has never been able to pick a
    // FORM — its own comment concedes every moment maps to reel+carousel. The
    // format decision is a separate pure module, composed HERE at the boundary
    // rather than imported into either planner: I/O belongs at the edge, and the
    // format planner's purity scan forbids database imports on purpose.
    const { decideContentFormat, emptyFormatSignals } = await import("../services/contentFormatPlanner");
    const signals = emptyFormatSignals();

    try {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (d) {
        const { socialContentInventory, reelJobs } = await import("../../drizzle/schema");
        const { desc, eq, and, gte, inArray, sql } = await import("drizzle-orm");

        // Format fatigue: what did we actually publish, most recent first.
        const recent = await d
          .select({ contentType: socialContentInventory.contentType })
          .from(socialContentInventory)
          .where(eq(socialContentInventory.status, "posted"))
          .orderBy(desc(socialContentInventory.updatedAt))
          .limit(6);
        signals.recentFormats = {
          available: true,
          values: recent.map((r: typeof recent[number]) =>
            (r.contentType === "post" ? "single" : String(r.contentType)) as never),
        };

        // Footage on hand: clips from reels whose assets survived. This is what
        // makes a reel FREE instead of a paid generation.
        const withClips = await d
          .select({ n: sql<number>`COUNT(*)`.as("n") })
          .from(reelJobs)
          .where(and(inArray(reelJobs.status, ["assembled", "assets_ready"]), gte(reelJobs.updatedAt, new Date(Date.now() - 30 * 864e5))));
        signals.mediaOnHand = { available: true, clipCount: Number(withClips[0]?.n ?? 0) * 6, photoCount: 0 };
      }
    } catch (err) {
      // A signal we could not read stays UNAVAILABLE — never a silent zero.
      // decideContentFormat grades its own confidence down accordingly and says
      // which inputs were missing.
      log.warn("format signals partially unavailable", err);
    }

    const top = plan.recommendations[0];
    if (top?.objective) signals.objective = { available: true, value: top.objective as never };

    const format = decideContentFormat(signals);
    return { ...plan, format };
  }),

  /** Operator command center: governing policy + its SOURCE (storage vs
   *  code-default fallback), kill switches, today's spend vs cap, live
   *  reservations, decision trail, recent jobs with QA verdicts. Every
   *  section carries an explicit available flag — no silent zeros. */
  getCommandCenter: adminProcedure.query(async () => {
    const { collectCommandCenter } = await import("../services/commandCenter");
    return collectCommandCenter();
  }),

  /** Autonomy control plane: active policy + recent audit tail for the
   *  operator, plus policy versioning and one-tap kill switches. */
  getAutonomyStatus: adminProcedure.query(async () => {
    const { getActivePolicy } = await import("../services/autonomyControl");
    const policy = await getActivePolicy();
    let recentEvents: Array<{ occurredAt: Date; actionType: string; decision: string; reasoningCodes: string; policyVersion: number }> = [];
    try {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (d) {
        const { autonomyAuditEvents } = await import("../../drizzle/schema");
        const { desc } = await import("drizzle-orm");
        recentEvents = await d
          .select({
            occurredAt: autonomyAuditEvents.occurredAt,
            actionType: autonomyAuditEvents.actionType,
            decision: autonomyAuditEvents.decision,
            reasoningCodes: autonomyAuditEvents.reasoningCodes,
            policyVersion: autonomyAuditEvents.policyVersion,
          })
          .from(autonomyAuditEvents)
          .orderBy(desc(autonomyAuditEvents.occurredAt))
          .limit(25);
      }
    } catch { /* 0086 pending — status still returns the governing policy */ }
    return { policy, recentEvents };
  }),

  publishAutonomyPolicy: adminProcedure
    .input(z.object({ policy: z.unknown(), note: z.string().max(400).default("") }))
    .mutation(async ({ input, ctx }) => {
      const { publishPolicyVersion } = await import("../services/autonomyControl");
      const { validateAutonomyPolicyShape } = await import("../../client/src/lib/autonomyPolicy");
      if (!validateAutonomyPolicyShape(input.policy)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Policy failed shape validation" });
      }
      return publishPolicyVersion(input.policy, input.note, ctx.user?.email ?? "admin");
    }),

  setAutonomyKillSwitch: adminProcedure
    .input(z.object({ scope: z.enum(["global", "generation", "publishing"]), on: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const { setKillSwitch } = await import("../services/autonomyControl");
      return setKillSwitch(input.scope, input.on, ctx.user?.email ?? "admin");
    }),

  runConceptTournament: adminProcedure
    .input(z.object({
      campaignAsk: z.string().min(8).max(600),
      objective: z.string().max(32).optional(),
      proofHandles: z.array(z.string().max(200)).max(8).optional(),
      avoidRecent: z.array(z.string().max(200)).max(12).optional(),
      generateGenome: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { assertAllowed } = await import("../services/autonomyControl");
      await assertAllowed({ type: "generate_campaign" }).catch((err: unknown) => {
        if (err instanceof Error && err.message.startsWith("Blocked by autonomy policy")) {
          throw new TRPCError({ code: "FORBIDDEN", message: err.message });
        }
        return undefined; // policy infra failure — default posture allows
      });
      const { runConceptTournament } = await import("../services/conceptTournament");
      const { generateGenome, ...tournamentInput } = input;
      const result = await runConceptTournament(tournamentInput, { generateGenome });
      if (!result.genome) return { ...result, seeds: null };
      const { genomeToReelSeed, genomeToCarouselSeed, genomeToPhotoSeed } = await import("../../client/src/lib/creativeGenome");
      return {
        ...result,
        seeds: {
          reel: genomeToReelSeed(result.genome),
          carousel: genomeToCarouselSeed(result.genome),
          photo: genomeToPhotoSeed(result.genome),
        },
      };
    }),

  /** Reel Visual World: generate three 9:16 reference-frame candidates
   *  (safe / bold / experimental) for a brief's hero + motion lens. Uses
   *  image credits (up to 3 calls). Selection is the operator's — the chosen
   *  candidate's visualWorld object rides the brief into enqueue, where its
   *  locked invariants replace the generic continuity block in every beat
   *  prompt. */
  generateReelReferenceFrames: adminProcedure
    .input(z.object({
      brief: z.object({
        topic: z.string().min(1).max(400),
        objectCharacter: z.string().min(1).max(60),
        motionLens: z.string().min(1).max(60),
        storyboardBeats: z.array(z.object({ visual: z.string() }).passthrough()).default([]),
      }).passthrough(),
    }))
    .mutation(async ({ input }) => {
      const { generateReferenceFrames } = await import("../services/visualWorld");
      const frames = await generateReferenceFrames(input.brief as never);
      return { frames };
    }),
  /** Evidence options for the Campaign Package proof picker: recent verified
   *  5-star reviews + declined work items, as typed handles the evidence
   *  resolver can verify (review:<id> / declined_work:<id>). Read-only. */
  listEvidenceOptions: adminProcedure.query(async () => {
    const out: Array<{ handle: string; label: string }> = [];
    try {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) return out;
      const { reviewPipeline, workOrderItems } = await import("../../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");
      const reviews = await d
        .select({ id: reviewPipeline.id, author: reviewPipeline.authorName, text: reviewPipeline.reviewText })
        .from(reviewPipeline)
        .where(eq(reviewPipeline.rating, 5))
        .orderBy(desc(reviewPipeline.reviewTime))
        .limit(8);
      for (const r of reviews) {
        if (!r.text) continue;
        out.push({ handle: `review:${r.id}`, label: `5-star ${r.author || "review"}: "${r.text.slice(0, 90)}"` });
      }
      const declined = await d
        .select({ id: workOrderItems.id, description: workOrderItems.description })
        .from(workOrderItems)
        .where(eq(workOrderItems.declined, true))
        .limit(8);
      for (const w of declined) {
        out.push({ handle: `declined_work:${w.id}`, label: `Declined work: ${w.description.slice(0, 90)}` });
      }
    } catch (err) {
      log.warn("listEvidenceOptions unavailable", { err: err instanceof Error ? err.message : String(err) });
    }
    return out;
  }),

  /** Rendered creative QA on demand: extract frames from an assembled reel,
   *  build a contact sheet, run the vision critic against the brief +
   *  approved Visual World, persist the structured verdict into the job
   *  payload. Read/evaluate only — never changes job status. */
  runRenderedQa: adminProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const { runRenderedQaOnJob } = await import("../services/renderedQa");
      const verdict = await runRenderedQaOnJob(input.jobId);
      if (!verdict) throw new TRPCError({ code: "BAD_REQUEST", message: "Rendered QA could not run (job missing, no mp4, or extraction failed) — see server logs." });
      // M11: wire QA -> repair router -> quality automation -> publish gate so the
      // endpoint returns the actual decision (proceed / auto_repair /
      // needs_paid_repair / pause / reject), not just raw findings.
      const { orchestratePostQa } = await import("../services/postQaOrchestrator");
      const outcome = orchestratePostQa(verdict.findings);
      return { ...verdict, automation: outcome.verdict, repairPlan: outcome.repairPlan, publishGate: outcome.publishGate };
    }),

  /** M12: the operator-facing draft workspace for a reel job — the compiler's
   *  own output made inspectable (Truth, Concepts, Execution intent-vs-scene,
   *  Preflight verdict, exact compiled prompts). Read-only; derived from the
   *  persisted brief so it can never drift from what will be generated. */
  draftWorkspace: adminProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const { reelJobs } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const [job] = await d.select().from(reelJobs).where(eq(reelJobs.id, input.jobId)).limit(1);
      if (!job?.payload) throw new TRPCError({ code: "NOT_FOUND", message: "Reel job or its brief not found" });
      const { buildDraftWorkspace } = await import("../../client/src/lib/facelessReelStudio");
      return buildDraftWorkspace(JSON.parse(job.payload));
    }),

  /** Selective repair: regenerate EXACTLY one failing beat (from the QA
   *  verdict's preserve/change instruction or an explicit one), replace only
   *  that clip in a BACKGROUND worker (no provider call on the request
   *  path), then the existing assembly worker re-assembles. Queuing
   *  invalidates the stale mp4 immediately. Policy-gated, cap-enforced. */
  repairReelBeat: adminProcedure
    .input(z.object({
      jobId: z.number().int().positive(),
      beatNumber: z.number().int().min(1).max(12),
      instruction: z.object({
        code: z.string().max(64).optional(),
        description: z.string().max(400).optional(),
        preserve: z.array(z.string().max(200)).max(6).default([]),
        change: z.array(z.string().max(200)).max(6).default([]),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      const { requestBeatRepair } = await import("../services/selectiveRepair");
      try {
        return await requestBeatRepair(input);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Blocked by autonomy policy")) {
          throw new TRPCError({ code: "FORBIDDEN", message: err.message });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "repair failed" });
      }
    }),

  /** Genome Wave 2: Reel Director — one campaign genome -> a full
   *  quality-scored ReelBrief via the existing generator. Generation only;
   *  rendering stays behind the operator's explicit enqueueReelJob tap. The
   *  genome arrives inline (not by id) so this works before drizzle/0085 is
   *  applied and directly from a just-run tournament result. */
  draftReelFromGenome: adminProcedure
    .input(z.object({ genome: z.unknown() }))
    .mutation(async ({ input }) => {
      const { creativeGenomeSchema } = await import("../../client/src/lib/creativeGenome");
      const genome = creativeGenomeSchema.parse(input.genome);
      const { draftReelFromGenome } = await import("../services/reelDirector");
      return draftReelFromGenome(genome);
    }),

  /** Genome Wave 2: Carousel Director — one campaign genome -> a full
   *  boost-scored CarouselBrief via the existing generator. Generation only;
   *  the client chains the result into saveCarouselDraft (Draft Board), where
   *  the existing render + publish paths take over. */
  draftCarouselFromGenome: adminProcedure
    .input(z.object({ genome: z.unknown() }))
    .mutation(async ({ input }) => {
      const { creativeGenomeSchema } = await import("../../client/src/lib/creativeGenome");
      const genome = creativeGenomeSchema.parse(input.genome);
      const { draftCarouselFromGenome } = await import("../services/carouselDirector");
      return draftCarouselFromGenome(genome);
    }),

  /** Genome Wave 1: generate ONE claim-safe campaign genome + the seeds that
   *  drive today's reel/carousel/photo flows from it. */
  generateCampaignGenome: adminProcedure
    .input(z.object({
      campaignAsk: z.string().min(8).max(600),
      objective: z.string().max(32).optional(),
      proofHandles: z.array(z.string().max(200)).max(8).optional(),
    }))
    .mutation(async ({ input }) => {
      const { generateCampaignGenome } = await import("../services/genomeGen");
      const { genomeToReelSeed, genomeToCarouselSeed, genomeToPhotoSeed } = await import("../../client/src/lib/creativeGenome");
      const { genome, attempts } = await generateCampaignGenome(input);
      const { saveGenome } = await import("../services/creativeMemory");
      await saveGenome({ genome, campaignAsk: input.campaignAsk, source: "direct" });
      return {
        genome,
        attempts,
        seeds: {
          reel: genomeToReelSeed(genome),
          carousel: genomeToCarouselSeed(genome),
          photo: genomeToPhotoSeed(genome),
        },
      };
    }),

  saveCarouselDraft: adminProcedure
    .input(z.object({
      id: z.string(),
      topic: z.string(),
      brief: z.any(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { getDb } = await import("../db");
        const { socialDrafts } = await import("../../drizzle/schema");
        const d = await getDb();
        if (d) {
          await d.insert(socialDrafts).values({
            id: input.id,
            contentType: "carousel",
            topic: input.topic,
            briefJson: JSON.stringify(input.brief),
          }).onDuplicateKeyUpdate({
            set: {
              topic: input.topic,
              briefJson: JSON.stringify(input.brief),
            }
          });
        }

        // Dual-write/sync to sheet
        let sheetOk = false;
        try {
          const { syncCarouselDraftToSheet } = await import("../sheets-sync");
          sheetOk = await syncCarouselDraftToSheet(input.id, input.topic, JSON.stringify(input.brief));
        } catch (err) {
          log.warn("syncCarouselDraftToSheet failed", err);
        }

        // Sync with Statenour Command Center Queue
        try {
          await dispatch("social_draft:sync", {
            id: input.id,
            content: input.brief?.caption || input.brief?.selectedCaption || input.topic,
            status: input.brief?.status === "approved" || input.brief?.status === "scheduled" ? "pending" : (input.brief?.status || "pending"),
            imageUrl: (input.brief?.assetPaths && input.brief.assetPaths[0]) || null,
            platforms: ["instagram"],
            kind: "post",
            source: "nick",
            sourceMetadata: {
              topic: input.topic,
              brief: input.brief,
            },
            scheduledFor: input.brief?.scheduledFor ? new Date(input.brief.scheduledFor).toISOString() : null,
            publishedAt: input.brief?.publishedAt ? new Date(input.brief.publishedAt).toISOString() : null,
          }, { source: "content_router" });
        } catch (syncErr) {
          log.warn("Failed to sync Carousel draft to Statenour:", syncErr);
        }

        return { success: true, sheetSynced: sheetOk };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Save Carousel draft failed" });
      }
    }),
  allReelDrafts: adminProcedure.query(async () => {
    try {
      const dbDrafts: any[] = [];
      try {
        const { getDb } = await import("../db");
        const { socialDrafts } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const d = await getDb();
        if (d) {
          const rows = await d.select().from(socialDrafts).where(eq(socialDrafts.contentType, "reel"));
          for (const r of rows) {
            try {
              dbDrafts.push(JSON.parse(r.briefJson));
            } catch (e) {
              log.error("Failed to parse db Reel draft JSON", { id: r.id, error: e });
            }
          }
        }
      } catch (dbErr) {
        log.warn("Failed to fetch Reel drafts from DB, continuing to sheet", dbErr);
      }

      // Fetch sheets drafts
      let sheetDrafts: any[] = [];
      try {
        const { fetchReelDraftsFromSheet } = await import("../sheets-sync");
        sheetDrafts = await fetchReelDraftsFromSheet();
      } catch (sheetErr) {
        log.warn("fetchReelDraftsFromSheet failed", sheetErr);
      }

      // Merge them by ID. DB takes priority.
      const mergedMap = new Map<string, any>();
      for (const sd of sheetDrafts) {
        if (sd && sd.id) {
          mergedMap.set(sd.id, sd);
        }
      }
      for (const dd of dbDrafts) {
        if (dd && dd.id) {
          mergedMap.set(dd.id, dd);
        }
      }

      return Array.from(mergedMap.values());
    } catch (err) {
      log.warn("allReelDrafts failed", err);
      return [];
    }
  }),
  allCarouselDrafts: adminProcedure.query(async () => {
    try {
      const dbDrafts: any[] = [];
      try {
        const { getDb } = await import("../db");
        const { socialDrafts } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const d = await getDb();
        if (d) {
          const rows = await d.select().from(socialDrafts).where(eq(socialDrafts.contentType, "carousel"));
          for (const r of rows) {
            try {
              dbDrafts.push(JSON.parse(r.briefJson));
            } catch (e) {
              log.error("Failed to parse db Carousel draft JSON", { id: r.id, error: e });
            }
          }
        }
      } catch (dbErr) {
        log.warn("Failed to fetch Carousel drafts from DB, continuing to sheet", dbErr);
      }

      let sheetDrafts: any[] = [];
      try {
        const { fetchCarouselDraftsFromSheet } = await import("../sheets-sync");
        sheetDrafts = await fetchCarouselDraftsFromSheet();
      } catch (sheetErr) {
        log.warn("fetchCarouselDraftsFromSheet failed", sheetErr);
      }

      const mergedMap = new Map<string, any>();
      for (const sd of sheetDrafts) {
        if (sd && sd.id) {
          mergedMap.set(sd.id, sd);
        }
      }
      for (const dd of dbDrafts) {
        if (dd && dd.id) {
          mergedMap.set(dd.id, dd);
        }
      }

      return Array.from(mergedMap.values());
    } catch (err) {
      log.warn("allCarouselDrafts failed", err);
      return [];
    }
  }),
  logReel: adminProcedure
    .input(z.object({
      topic: z.string(),
      verifiedFact: z.string(),
      sources: z.string(),
      driverConfusion: z.string(),
      clevelandAngle: z.string(),
      campaignKeyword: z.string(),
      creativeTerritory: z.string(),
      usefulAbsurdity: z.string(),
      storyboardOutline: z.string(),
      captionHook: z.string(),
      instagramUrl: z.string(),
      assetPaths: z.string(),
      score: z.string(),
      hashtags: z.string(),
      avoidedRepeats: z.string(),
      issues: z.string(),
      insightsChecked: z.string(),
      facebookCrossPostOff: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        try {
          const { getDb } = await import("../db");
          const { socialDrafts } = await import("../../drizzle/schema");
          const { eq, and } = await import("drizzle-orm");
          const d = await getDb();
          if (d) {
            const existing = await d
              .select()
              .from(socialDrafts)
              .where(and(eq(socialDrafts.contentType, "reel"), eq(socialDrafts.topic, input.topic)))
              .limit(1);

            if (existing.length > 0) {
              const row = existing[0];
              let brief: any = {};
              try {
                brief = JSON.parse(row.briefJson);
              } catch (e) {
                log.error("Failed to parse existing briefJson for logging", e);
              }
              brief.status = "posted";
              brief.instagramUrl = input.instagramUrl;
              brief.assetPaths = input.assetPaths;
              brief.verifiedFact = input.verifiedFact;
              brief.sources = input.sources;
              brief.driverConfusion = input.driverConfusion;
              brief.clevelandAngle = input.clevelandAngle;
              brief.campaignKeyword = input.campaignKeyword;
              brief.creativeTerritory = input.creativeTerritory;
              brief.usefulAbsurdity = input.usefulAbsurdity;
              brief.storyboardOutline = input.storyboardOutline;
              brief.captionHook = input.captionHook;
              brief.score = input.score;
              brief.hashtags = input.hashtags;
              brief.avoidedRepeats = input.avoidedRepeats;
              brief.issues = input.issues;
              brief.insightsChecked = input.insightsChecked;
              brief.facebookCrossPostOff = input.facebookCrossPostOff;

              await d
                .update(socialDrafts)
                .set({
                  briefJson: JSON.stringify(brief),
                })
                .where(eq(socialDrafts.id, row.id));
            } else {
              const newId = `posted-reel-${Date.now()}`;
              const brief = {
                id: newId,
                topic: input.topic,
                status: "posted",
                instagramUrl: input.instagramUrl,
                assetPaths: input.assetPaths,
                campaignKeyword: input.campaignKeyword,
                creativeTerritory: input.creativeTerritory,
                usefulAbsurdity: input.usefulAbsurdity,
                storyboardOutline: input.storyboardOutline,
                captionHook: input.captionHook,
                score: input.score,
                verifiedFact: input.verifiedFact,
                sources: input.sources,
                driverConfusion: input.driverConfusion,
                clevelandAngle: input.clevelandAngle,
                hashtags: input.hashtags,
                avoidedRepeats: input.avoidedRepeats,
                issues: input.issues,
                insightsChecked: input.insightsChecked,
                facebookCrossPostOff: input.facebookCrossPostOff,
              };
              await d.insert(socialDrafts).values({
                id: newId,
                contentType: "reel",
                topic: input.topic,
                briefJson: JSON.stringify(brief),
              });
            }
          }
        } catch (dbErr) {
          log.error("Failed to log Reel in database", dbErr);
        }

        // Dual-write to Google Sheets
        let sheetOk = false;
        try {
          const { syncReelLogToSheet } = await import("../sheets-sync");
          sheetOk = await syncReelLogToSheet(input);
        } catch (err) {
          log.warn("syncReelLogToSheet failed", err);
        }

        // Sync with Statenour Command Center Queue
        try {
          await dispatch("social_draft:sync", {
            id: input.topic ? `reel-${input.topic.toLowerCase().replace(/[^a-z0-9]/g, "-")}` : `posted-reel-${Date.now()}`,
            content: input.captionHook || input.topic,
            status: "published",
            imageUrl: input.instagramUrl || null,
            platforms: ["instagram"],
            kind: "reel",
            source: "nick",
            sourceMetadata: {
              topic: input.topic,
              instagramUrl: input.instagramUrl,
              assetPaths: input.assetPaths,
              score: input.score,
            },
            publishedAt: new Date().toISOString(),
          }, { source: "content_router" });
        } catch (syncErr) {
          log.warn("Failed to sync logged Reel to Statenour:", syncErr);
        }

        return { success: true, sheetSynced: sheetOk };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Log Reel failed" });
      }
    }),
  logCarousel: adminProcedure
    .input(z.object({
      topic: z.string(),
      verifiedFact: z.string(),
      sources: z.string(),
      driverConfusion: z.string(),
      clevelandAngle: z.string(),
      campaignKeyword: z.string(),
      creativeTerritory: z.string(),
      usefulAbsurdity: z.string(),
      storyboardOutline: z.string(),
      captionHook: z.string(),
      instagramUrl: z.string(),
      assetPaths: z.string(),
      score: z.string(),
      hashtags: z.string(),
      avoidedRepeats: z.string(),
      issues: z.string(),
      insightsChecked: z.string(),
      facebookCrossPostOff: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        try {
          const { getDb } = await import("../db");
          const { socialDrafts } = await import("../../drizzle/schema");
          const { eq, and } = await import("drizzle-orm");
          const d = await getDb();
          if (d) {
            const existing = await d
              .select()
              .from(socialDrafts)
              .where(and(eq(socialDrafts.contentType, "carousel"), eq(socialDrafts.topic, input.topic)))
              .limit(1);

            if (existing.length > 0) {
              const row = existing[0];
              let brief: any = {};
              try {
                brief = JSON.parse(row.briefJson);
              } catch (e) {
                log.error("Failed to parse existing briefJson for logging", e);
              }
              brief.status = "posted";
              brief.instagramUrl = input.instagramUrl;
              brief.assetPaths = input.assetPaths;
              brief.verifiedFact = input.verifiedFact;
              brief.sources = input.sources;
              brief.driverConfusion = input.driverConfusion;
              brief.clevelandAngle = input.clevelandAngle;
              brief.campaignKeyword = input.campaignKeyword;
              brief.creativeTerritory = input.creativeTerritory;
              brief.usefulAbsurdity = input.usefulAbsurdity;
              brief.storyboardOutline = input.storyboardOutline;
              brief.captionHook = input.captionHook;
              brief.score = input.score;
              brief.hashtags = input.hashtags;
              brief.avoidedRepeats = input.avoidedRepeats;
              brief.issues = input.issues;
              brief.insightsChecked = input.insightsChecked;
              brief.facebookCrossPostOff = input.facebookCrossPostOff;

              await d
                .update(socialDrafts)
                .set({
                  briefJson: JSON.stringify(brief),
                })
                .where(eq(socialDrafts.id, row.id));
            } else {
              const newId = `posted-carousel-${Date.now()}`;
              const brief = {
                id: newId,
                topic: input.topic,
                status: "posted",
                instagramUrl: input.instagramUrl,
                assetPaths: input.assetPaths,
                campaignKeyword: input.campaignKeyword,
                creativeTerritory: input.creativeTerritory,
                usefulAbsurdity: input.usefulAbsurdity,
                storyboardOutline: input.storyboardOutline,
                captionHook: input.captionHook,
                score: input.score,
                verifiedFact: input.verifiedFact,
                sources: input.sources,
                driverConfusion: input.driverConfusion,
                clevelandAngle: input.clevelandAngle,
                hashtags: input.hashtags,
                avoidedRepeats: input.avoidedRepeats,
                issues: input.issues,
                insightsChecked: input.insightsChecked,
                facebookCrossPostOff: input.facebookCrossPostOff,
              };
              await d.insert(socialDrafts).values({
                id: newId,
                contentType: "carousel",
                topic: input.topic,
                briefJson: JSON.stringify(brief),
              });
            }
          }
        } catch (dbErr) {
          log.error("Failed to log Carousel in database", dbErr);
        }

        // Dual-write to Google Sheets
        let sheetOk = false;
        try {
          const { syncCarouselLogToSheet } = await import("../sheets-sync");
          sheetOk = await syncCarouselLogToSheet(input);
        } catch (err) {
          log.warn("syncCarouselLogToSheet failed", err);
        }

        // Sync with Statenour Command Center Queue
        try {
          await dispatch("social_draft:sync", {
            id: input.topic ? `carousel-${input.topic.toLowerCase().replace(/[^a-z0-9]/g, "-")}` : `posted-carousel-${Date.now()}`,
            content: input.captionHook || input.topic,
            status: "published",
            imageUrl: input.instagramUrl || null,
            platforms: ["instagram"],
            kind: "post",
            source: "nick",
            sourceMetadata: {
              topic: input.topic,
              instagramUrl: input.instagramUrl,
              assetPaths: input.assetPaths,
              score: input.score,
            },
            publishedAt: new Date().toISOString(),
          }, { source: "content_router" });
        } catch (syncErr) {
          log.warn("Failed to sync logged Carousel to Statenour:", syncErr);
        }

        return { success: true, sheetSynced: sheetOk };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Log Carousel failed" });
      }
    }),
  allReelLogs: adminProcedure.query(async () => {
    try {
      const dbLogs: any[] = [];
      try {
        const { getDb } = await import("../db");
        const { socialDrafts } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const d = await getDb();
        if (d) {
          const rows = await d.select().from(socialDrafts).where(eq(socialDrafts.contentType, "reel"));
          for (const r of rows) {
            try {
              const brief = JSON.parse(r.briefJson);
              if (brief.status === "posted") {
                dbLogs.push({
                  timestamp: r.updatedAt.toLocaleString("en-US", { timeZone: "America/New_York" }),
                  topic: r.topic,
                  verifiedFact: brief.verifiedFact || "",
                  sources: brief.sources || "",
                  driverConfusion: brief.driverConfusion || "",
                  clevelandAngle: brief.clevelandAngle || "",
                  campaignKeyword: brief.campaignKeyword || "",
                  creativeTerritory: brief.creativeTerritory || "",
                  usefulAbsurdity: brief.usefulAbsurdity || "",
                  storyboardOutline: brief.storyboardOutline || "",
                  captionHook: brief.captionHook || "",
                  instagramUrl: brief.instagramUrl || "",
                  assetPaths: brief.assetPaths || "",
                  score: brief.score || "",
                  hashtags: brief.hashtags || "",
                  avoidedRepeats: brief.avoidedRepeats || "",
                  issues: brief.issues || "",
                  insightsChecked: brief.insightsChecked || "",
                  facebookCrossPostOff: brief.facebookCrossPostOff || "",
                });
              }
            } catch (e) {
              log.error("Failed to parse db Reel log briefJson", e);
            }
          }
        }
      } catch (dbErr) {
        log.warn("Failed to fetch Reel logs from DB, continuing to sheet", dbErr);
      }

      let sheetLogs: any[] = [];
      try {
        const { fetchReelLogsFromSheet } = await import("../sheets-sync");
        sheetLogs = await fetchReelLogsFromSheet();
      } catch (sheetErr) {
        log.warn("fetchReelLogsFromSheet failed", sheetErr);
      }

      const mergedMap = new Map<string, any>();
      for (const l of sheetLogs) {
        if (l.topic) {
          mergedMap.set(l.topic, l);
        }
      }
      for (const l of dbLogs) {
        if (l.topic) {
          mergedMap.set(l.topic, l);
        }
      }
      return Array.from(mergedMap.values());
    } catch (err) {
      log.warn("allReelLogs failed", err);
      return [];
    }
  }),
  allCarouselLogs: adminProcedure.query(async () => {
    try {
      const dbLogs: any[] = [];
      try {
        const { getDb } = await import("../db");
        const { socialDrafts } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const d = await getDb();
        if (d) {
          const rows = await d.select().from(socialDrafts).where(eq(socialDrafts.contentType, "carousel"));
          for (const r of rows) {
            try {
              const brief = JSON.parse(r.briefJson);
              if (brief.status === "posted") {
                dbLogs.push({
                  timestamp: r.updatedAt.toLocaleString("en-US", { timeZone: "America/New_York" }),
                  topic: r.topic,
                  verifiedFact: brief.verifiedFact || "",
                  sources: brief.sources || "",
                  driverConfusion: brief.driverConfusion || "",
                  clevelandAngle: brief.clevelandAngle || "",
                  campaignKeyword: brief.campaignKeyword || "",
                  creativeTerritory: brief.creativeTerritory || "",
                  usefulAbsurdity: brief.usefulAbsurdity || "",
                  storyboardOutline: brief.storyboardOutline || "",
                  captionHook: brief.captionHook || "",
                  instagramUrl: brief.instagramUrl || "",
                  assetPaths: brief.assetPaths || "",
                  score: brief.score || "",
                  hashtags: brief.hashtags || "",
                  avoidedRepeats: brief.avoidedRepeats || "",
                  issues: brief.issues || "",
                  insightsChecked: brief.insightsChecked || "",
                  facebookCrossPostOff: brief.facebookCrossPostOff || "",
                });
              }
            } catch (e) {
              log.error("Failed to parse db Carousel log briefJson", e);
            }
          }
        }
      } catch (dbErr) {
        log.warn("Failed to fetch Carousel logs from DB, continuing to sheet", dbErr);
      }

      let sheetLogs: any[] = [];
      try {
        const { fetchCarouselLogsFromSheet } = await import("../sheets-sync");
        sheetLogs = await fetchCarouselLogsFromSheet();
      } catch (sheetErr) {
        log.warn("fetchCarouselLogsFromSheet failed", sheetErr);
      }

      const mergedMap = new Map<string, any>();
      for (const l of sheetLogs) {
        if (l.topic) {
          mergedMap.set(l.topic, l);
        }
      }
      for (const l of dbLogs) {
        if (l.topic) {
          mergedMap.set(l.topic, l);
        }
      }
      return Array.from(mergedMap.values());
    } catch (err) {
      log.warn("allCarouselLogs failed", err);
      return [];
    }
  }),
  publishCarousel: adminProcedure
    .input(z.object({
      imageUrls: z.array(z.string()),
      caption: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { getMetaSocialStatus, postInstagramCarousel } = await import("../services/metaSocial");
        const status = await getMetaSocialStatus();
        if (!status.configured || !status.instagramReady) {
          const { sendTelegram } = await import("../services/telegram");
          const mockPostId = `sandbox_carousel_${Date.now()}`;
          const slideCount = input.imageUrls.length;
          const charCount = input.caption.length;
          const hashtags = input.caption.match(/#[a-zA-Z0-9_]+/g) || [];
          const cleanCaption = input.caption.replace(/#[a-zA-Z0-9_]+/g, "").trim();

          const msg = [
            `🎨 <b>[SANDBOX INSTAGRAM CAROUSEL POST]</b>`,
            `────────────────────────────────`,
            `📱 <b>Placement:</b> Instagram Carousel Feed`,
            `🔢 <b>Slide Count:</b> ${slideCount} panels`,
            `📝 <b>Caption Length:</b> ${charCount} chars (${hashtags.length} hashtags)`,
            `🛡️ <b>Status:</b> SIMULATED / SANDBOX MODE`,
            `💡 <i>To publish this live, flip the <code>legacy_autopost_live</code> feature flag ON and configure Meta API credentials.</i>`,
            `────────────────────────────────`,
            `📖 <b>CAPTION BODY:</b>`,
            `"${cleanCaption}"`,
            `\n🏷️ <b>HASHTAGS:</b>`,
            hashtags.join(" ") || "None",
            `────────────────────────────────`,
            `🖼️ <b>SLIDES & ASSETS:</b>`,
            ...input.imageUrls.map((url, i) => `  • Panel ${i + 1}: <a href="${url}">Slide Image Link ${i + 1}</a>`),
            `────────────────────────────────`,
            `✨ <i>This is a mock sandbox transmission. Content has been logged to database with ID: <code>${mockPostId}</code></i>`
          ].join("\n");

          await sendTelegram(msg);
          return { success: true, postId: mockPostId, isSandbox: true };
        }
        const res = await postInstagramCarousel({
          imageUrls: input.imageUrls,
          caption: input.caption,
        });
        return { success: res.success, postId: res.postId, error: res.error, isSandbox: false };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Carousel publishing failed" });
      }
    }),
  publishReel: adminProcedure
    .input(z.object({
      videoUrl: z.string(),
      caption: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { getMetaSocialStatus } = await import("../services/metaSocial");
        const status = await getMetaSocialStatus();
        if (!status.configured || !status.instagramReady) {
          const { sendTelegram } = await import("../services/telegram");
          const mockPostId = `sandbox_reel_${Date.now()}`;
          const charCount = input.caption.length;
          const hashtags = input.caption.match(/#[a-zA-Z0-9_]+/g) || [];
          const cleanCaption = input.caption.replace(/#[a-zA-Z0-9_]+/g, "").trim();

          const msg = [
            `🎬 <b>[SANDBOX INSTAGRAM REEL POST]</b>`,
            `────────────────────────────────`,
            `📱 <b>Placement:</b> Instagram Reels Feed`,
            `📝 <b>Caption Length:</b> ${charCount} chars (${hashtags.length} hashtags)`,
            `🛡️ <b>Status:</b> SIMULATED / SANDBOX MODE`,
            `💡 <i>To publish this live, flip the <code>legacy_autopost_live</code> feature flag ON and configure Meta API credentials.</i>`,
            `────────────────────────────────`,
            `📖 <b>CAPTION BODY:</b>`,
            `"${cleanCaption}"`,
            `\n🏷️ <b>HASHTAGS:</b>`,
            hashtags.join(" ") || "None",
            `────────────────────────────────`,
            `📹 <b>VIDEO ASSET:</b>`,
            `  • Source URL: <a href="${input.videoUrl}">Watch Reel Video</a>`,
            `────────────────────────────────`,
            `✨ <i>This is a mock sandbox transmission. Content has been logged to database with ID: <code>${mockPostId}</code></i>`
          ].join("\n");

          await sendTelegram(msg);
          return { success: true, postId: mockPostId, isSandbox: true };
        }
        // LIVE branch: this legacy path publishes a CLIENT-supplied videoUrl +
        // caption with no inventory row, no approval record, and no media
        // permanence check — it bypasses the provenance every reviewed path
        // enforces. Disabled by default; the reviewed Studio → approve →
        // publish path is the supported route. The sandbox preview above still
        // works for previewing without Meta credentials.
        if (process.env.REEL_LEGACY_PUBLISH_ENABLED !== "true") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "The legacy direct reel publisher is disabled (it bypasses approval provenance). Publish reels through Studio → approve → publish. Set REEL_LEGACY_PUBLISH_ENABLED=true only if you understand the bypass.",
          });
        }
        // Route the LIVE post through the single gated choke point
        // (REEL_PUBLISH_ENABLED + reel claim-safety) — never call
        // postInstagramReel directly.
        const { publishToSocial } = await import("../services/socialPublish");
        const { results } = await publishToSocial({
          platforms: ["instagram"],
          caption: input.caption,
          videoUrl: input.videoUrl,
        });
        const ig = results.find((r) => r.platform === "instagram");
        return { success: !!ig?.success, postId: ig?.postId, error: ig?.error, isSandbox: false };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Reel publishing failed" });
      }
    }),
  // Enqueue a reel for BACKGROUND generation. Reel gen is minutes-long and dies
  // on a synchronous request (Railway gateway timeout), so this returns a jobId
  // immediately and the pulse cron (REEL_GENERATION_ENABLED-gated) processes it.
  // Does NOT publish — publishing is a later, separately-gated stage.
  enqueueReelJob: adminProcedure
    .input(z.object({
      brief: z.object({
        campaignKeyword: z.string().min(1),
        topic: z.string().min(1),
        storyboardBeats: z.array(z.object({
          beatNumber: z.number(),
          visual: z.string(),
          startSecond: z.number(),
          endSecond: z.number(),
          motion: z.string(),
          onScreenText: z.string(),
        })).min(1),
        hashtags: z.array(z.string()),
        selectedCaption: z.string().min(1),
        sourceType: z.enum(["review", "declined_work", "manual"]),
        // The wizard has NINE creative source categories but the enqueue enum
        // collapses non-DB sources to "manual" (#797) - sourceOrigin preserves
        // the original category for provenance, analytics, and audits.
        sourceOrigin: z.string().max(64).optional(),
        // Campaign lineage: the creative_genomes row this brief was drafted
        // from, so a published reel traces back to its campaign.
        genomeId: z.string().max(64).nullable().optional(),
        sourceId: z.string().optional(),
        sourceNotes: z.any().optional(),
        mechanicTruth: z.any().optional(),
        winningConceptId: z.any().optional(),
        concepts: z.any().optional(),
        voiceoverScript: z.any().optional(),
        captionHooks: z.any().optional(),
        // Operator-approved visual world — zod strips unknown keys, so without
        // this line the approved reference frame would be SILENTLY dropped at
        // enqueue and every beat prompt would fall back to generic continuity.
        visualWorld: z.object({
          style: z.enum(["safe", "bold", "experimental"]),
          heroFrameUrl: z.string().max(2048),
          framePrompt: z.string().max(4000),
          lockedInvariants: z.string().max(4000),
        }).optional(),
        motionLens: z.string(),
        objectCharacter: z.string(),
        archetype: z.string(),
        // P2 (gated assessment, confirmed): the directors attach claim-level
        // evidence records to the brief, but zod's default strip removed them
        // here — so the persisted job payload and the approval hash covered a
        // brief WITHOUT its evidence provenance. Schema-validated passthrough.
        evidenceRecords: z.array(z.object({
          id: z.string(),
          handle: z.string(),
          sourceType: z.enum(["db_record", "public_registry"]),
          assertion: z.string(),
          claim: z.string(),
          retrievedAt: z.string(),
          expiresAt: z.string(),
          snapshotHash: z.string().nullable(),
          snapshotStatus: z.enum(["fetched", "fetch_blocked", "db_row", "not_attempted"]),
          entailment: z.literal("not_evaluated"),
          confidence: z.number(),
          sensitivity: z.enum(["public", "internal"]),
        })).optional(),
      })
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      // Autonomy policy is enforced at the SHARED service boundary
      // (reelPipeline.enqueueReelJob) — router-only enforcement let cron and
      // service callers bypass it (#815 review P1). The service's denial is
      // mapped to FORBIDDEN below at the call site.

      const { resolveSourceProvenance } = await import("../services/reelBriefGen");
      const resolved = await resolveSourceProvenance(
        input.brief.sourceType,
        input.brief.sourceId,
        input.brief.topic
      );

      if ((input.brief.sourceType === "review" || input.brief.sourceType === "declined_work") && !resolved.isVerified) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "NEEDS_RESEARCH: Grounded database evidence record not found or unverified. Operator context notes cannot be treated as verified facts.",
        });
      }

      const brief = { ...input.brief };
      // Reconstruct prompt pack server-side to enforce server-side prompts and safety checks
      try {
        const { buildHiggsfieldReelPromptPack } = await import("../../client/src/lib/facelessReelStudio");
        const promptPack = buildHiggsfieldReelPromptPack(brief as any);
        (brief as any).promptPack = promptPack;
        (brief as any).higgsfieldPromptPack = promptPack;
      } catch (e: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to reconstruct prompt packs server-side: ${e.message}`,
        });
      }

      const { calculateReelQualityScore } = await import("../../client/src/lib/facelessReelStudio");
      const score = calculateReelQualityScore(brief as any);
      if (!score.passing) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Reel brief quality score (${score.overall}/75) is below passing threshold.`,
        });
      }

      // Discard client-provided prompt packs to enforce server-side reconstruction
      const briefClean: any = {
        campaignKeyword: brief.campaignKeyword,
        topic: brief.topic,
        storyboardBeats: brief.storyboardBeats,
        hashtags: brief.hashtags,
        selectedCaption: brief.selectedCaption,
        sourceType: brief.sourceType,
        sourceOrigin: (brief as any).sourceOrigin,
        sourceId: brief.sourceId,
        sourceNotes: brief.sourceNotes,
        mechanicTruth: brief.mechanicTruth,
        winningConceptId: brief.winningConceptId,
        concepts: brief.concepts,
        voiceoverScript: brief.voiceoverScript,
        captionHooks: brief.captionHooks,
        motionLens: brief.motionLens,
        objectCharacter: brief.objectCharacter,
        archetype: brief.archetype,
        // Campaign lineage + approved visual world MUST survive the whitelist:
        // omitting them here silently stripped genomeId (review P2) and the
        // hero-frame URL before inventory + reel_jobs persistence.
        genomeId: (brief as any).genomeId ?? null,
        visualWorld: (brief as any).visualWorld,
        promptPack: (brief as any).promptPack,
        higgsfieldPromptPack: (brief as any).higgsfieldPromptPack,
      };

      const { createHash, randomUUID } = await import("crypto");
      const briefJson = JSON.stringify(briefClean);
      
      const { socialContentInventory } = await import("../../drizzle/schema");
      const inventoryId = `draft_${randomUUID()}`;
      
      await d.insert(socialContentInventory).values({
        id: inventoryId,
        platform: "both",
        contentType: "reel",
        topic: `${briefClean.campaignKeyword}: ${briefClean.topic}`.substring(0, 128),
        seriesName: "reels",
        hookCategory: "reel",
        hookText: briefClean.selectedCaption,
        bodyText: "",
        visualStyle: "reel",
        persona: "reel",
        status: "generating",
        briefJson,
        scoreOverall: score.overall,
        version: 1,
      });

      const briefWithId = { ...briefClean, id: inventoryId };

      const { enqueueReelJob } = await import("../services/reelPipeline");
      let jobId: number;
      try {
        ({ jobId } = await enqueueReelJob(briefWithId, "admin"));
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Blocked by autonomy policy")) {
          throw new TRPCError({ code: "FORBIDDEN", message: err.message });
        }
        throw err;
      }
      return { inventoryId, jobId };
    }),
  getReelJob: adminProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) return null;
      const { reelJobs } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await d.select().from(reelJobs).where(eq(reelJobs.id, input.jobId)).limit(1);
      const row = rows[0];
      if (!row) return null;

      let totalScenes = 0;
      try {
        const brief = JSON.parse(row.payload);
        totalScenes = brief.storyboardBeats?.length || 0;
      } catch (e) {}

      let completedScenes = 0;
      try {
        if (row.clipUrlsJson) {
          const clips = JSON.parse(row.clipUrlsJson);
          if (Array.isArray(clips)) {
            completedScenes = clips.filter(c => typeof c === "string" && c.startsWith("http")).length;
          }
        }
      } catch (e) {}

      let mappedStatus: "queued" | "generating" | "assembling" | "completed" | "failed" = "queued";
      if (row.status === "failed") {
        mappedStatus = "failed";
      } else if (row.status === "assembled" || row.mp4Url) {
        mappedStatus = "completed";
      } else if (row.status === "assets_ready" || row.status === "assembling") {
        mappedStatus = "assembling";
      } else if (row.status === "generating") {
        mappedStatus = "generating";
      }

      return {
        status: mappedStatus,
        videoUrl: row.mp4Url || undefined,
        error: row.error || undefined,
        completedScenes,
        totalScenes,
      };
    }),
  generateCarouselImages: adminProcedure
    .input(z.object({
      briefId: z.string(),
      prompts: z.array(z.string()),
    }))
    .mutation(async ({ input }) => {
      let hgUrls: string[] = [];
      let isFallback = false;
      let fallbackWarning = "";

      try {
        const { generateCarouselSlideImage } = await import("../services/higgsfieldStudio");
        log.info(`Generating ${input.prompts.length} Carousel images via Higgsfield in parallel...`);
        hgUrls = await Promise.all(
          input.prompts.map((prompt) => generateCarouselSlideImage({ prompt, aspectRatio: "3:4" }))
        );
      } catch (err) {
        log.warn("Higgsfield Carousel image generation failed, trying Gemini/OpenRouter fallback...", {
          err: err instanceof Error ? err.message : String(err)
        });
        isFallback = true;
        fallbackWarning = `Higgsfield CLI error: ${err instanceof Error ? err.message : String(err)}. Fell back to Gemini/OpenRouter.`;
      }

      try {
        const { storagePut } = await import("../storage");
        let imageUrls: string[];

        if (isFallback) {
          const { generateImage } = await import("../_core/imageGeneration");
          const pngUrls = await Promise.all(
            input.prompts.map(async (prompt) => {
              const res = await generateImage({ prompt });
              if (!res.url) throw new Error("Fallback image generation returned no URL");
              return res.url;
            })
          );

          log.info("Persisting fallback Gemini/OpenRouter images to S3/storage...");
          imageUrls = await Promise.all(
            pngUrls.map(async (url, i) => {
              const res = await fetch(url);
              if (!res.ok) throw new Error(`Failed to download slide ${i + 1} from fallback provider`);
              const buffer = Buffer.from(await res.arrayBuffer());
              
              const sharp = (await import("sharp")).default;
              const jpegBuf = await sharp(buffer)
                .flatten({ background: { r: 255, g: 255, b: 255 } })
                .jpeg({ quality: 90 })
                .toBuffer();

              const key = `carousel-studio/${Date.now()}-${i}.jpg`;
              const upload = await storagePut(key, jpegBuf, "image/jpeg");
              return upload.url;
            })
          );
        } else {
          log.info("Downloading and persisting generated Carousel images to S3/storage...");
          imageUrls = await Promise.all(
            hgUrls.map(async (url, i) => {
              const res = await fetch(url);
              if (!res.ok) throw new Error(`Failed to download slide ${i + 1} from Higgsfield`);
              const buffer = Buffer.from(await res.arrayBuffer());
              const key = `carousel-studio/${Date.now()}-${i}.jpg`;
              const upload = await storagePut(key, buffer, "image/jpeg");
              return upload.url;
            })
          );
        }

        return { success: true, imageUrls, warning: fallbackWarning || undefined };
      } catch (err) {
        log.error("Carousel image generation failed completely", { err: err instanceof Error ? err.message : String(err) });
        return {
          success: false,
          error: err instanceof Error ? err.message : "Carousel image generation failed",
          imageUrls: []
        };
      }
    }),
  /** One-click: generate a ready-to-review CarouselBrief via the Studio's own
   *  master prompt + the funded Gemini. Generation only — no posting. The
   *  existing generateCarouselImages/save/publish procs handle the rest. */
  generateCarouselBrief: adminProcedure
    .input(z.object({
      topic: z.string().max(300).optional(),
      campaignKeyword: z.string().max(40).optional(),
      territory: z.string().max(60).optional(),
      seasonLocalAngle: z.string().max(300).optional(),
      avoidTopics: z.array(z.string().max(200)).max(50).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { generateCarouselBriefAI } = await import("../services/carouselBriefGen");
        const { brief } = await generateCarouselBriefAI(input);
        return { success: true as const, brief };
      } catch (err) {
        log.error("generateCarouselBrief failed", { err: err instanceof Error ? err.message : String(err) });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Carousel brief generation failed",
        });
      }
    }),
  generateReelVideo: adminProcedure
    .input(z.object({
      briefId: z.string(),
      prompts: z.array(z.string()),
    }))
    .mutation(async ({ input }) => {
      try {
        const { generateReelClipVideo, stitchVideos } = await import("../services/higgsfieldStudio");
        const { storagePut } = await import("../storage");

        log.info(`Generating ${input.prompts.length} Reel clips in parallel...`);
        const hgUrls = await Promise.all(
          input.prompts.map((prompt) => generateReelClipVideo(prompt))
        );

        log.info("Stitching clips into single MP4...");
        const stitchedBuffer = await stitchVideos(hgUrls);

        log.info("Uploading final stitched MP4 to storage...");
        const key = `reels-studio/${Date.now()}-stitched.mp4`;
        const upload = await storagePut(key, stitchedBuffer, "video/mp4");

        return { success: true, videoUrl: upload.url };
      } catch (err) {
        log.error("Reel video generation failed", { err: err instanceof Error ? err.message : String(err) });
        return {
          success: false,
          error: err instanceof Error ? err.message : "Reel video generation failed",
          videoUrl: null
        };
      }
    }),
  /** One-click: generate a ready-to-review ReelBrief via the Studio's master
   *  prompt + the funded Gemini. Generation only — no video render, no posting. */
  generateReelBrief: adminProcedure
    .input(z.object({
      topic: z.string().max(300).optional(),
      campaignKeyword: z.string().max(40).optional(),
      factBucket: z.string().max(40).optional(),
      archetype: z.string().max(40).optional(),
      avoidTopics: z.array(z.string().max(200)).max(50).optional(),
      sourceType: z.string().max(50).optional(),
      sourceId: z.string().max(50).optional(),
      sourceDetail: z.string().max(1000).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { generateReelBriefAI } = await import("../services/reelBriefGen");
        const { calculateReelQualityScore } = await import("../../client/src/lib/facelessReelStudio");
        const { brief } = await generateReelBriefAI(input);
        const qualityScore = calculateReelQualityScore(brief);
        return { success: true as const, brief, qualityScore };
      } catch (err) {
        log.error("generateReelBrief failed", { err: err instanceof Error ? err.message : String(err) });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Reel brief generation failed",
        });
      }
    }),
  /** Server-authoritative reel quality gate. Re-scores an (optionally edited)
   *  brief with the same 75-pt gate the Studio UI uses, so quality is
   *  enforceable server-side rather than advisory client-only. Pure compute —
   *  no generation, storage, or posting. */
  validateReelBrief: adminProcedure
    .input(z.object({ brief: reelBriefScoreInput }))
    .mutation(async ({ input }) => {
      const { calculateReelQualityScore, buildHiggsfieldReelPromptPack } = await import("../../client/src/lib/facelessReelStudio");
      const brief = input.brief as unknown as ReelBrief;
      const promptPack = buildHiggsfieldReelPromptPack(brief);
      brief.promptPack = promptPack;
      brief.higgsfieldPromptPack = promptPack;
      const qualityScore = calculateReelQualityScore(brief);
      return { qualityScore, passing: qualityScore.passing };
    }),
  probeVeoConnection: adminProcedure
    .mutation(async () => {
      const { probeVeoConnection } = await import("../services/veoStudio");
      return await probeVeoConnection();
    }),
  getProprietaryEvidence: adminProcedure
    .input(z.object({ topicKeyword: z.string().optional() }).optional())
    .query(async ({ input }) => {
      try {
        const { getProprietaryEvidence } = await import("../services/evidenceEngine");
        return await getProprietaryEvidence(input?.topicKeyword);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Failed to fetch proprietary evidence",
        });
      }
    }),
  runPromptEvals: adminProcedure.query(async () => {
    try {
      const { runPromptEvals } = await import("../../scripts/run-prompt-evals");
      return await runPromptEvals();
    } catch (err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: err instanceof Error ? err.message : "Failed to run prompt evals",
      });
    }
  }),
  listStatenourQueue: adminProcedure
    .input(z.object({
      status: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const statenourUrl = process.env.STATENOUR_SYNC_URL || "https://statenour-web-production.up.railway.app";
      const syncKey = process.env.STATENOUR_SYNC_KEY || "";
      if (!syncKey) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Statenour sync key is not configured on Nick's Tire." });
      }

      const status = input?.status || "all";
      try {
        const res = await fetch(`${statenourUrl}/api/sync/queue?status=${status}`, {
          headers: { "x-sync-key": syncKey },
        });
        if (!res.ok) {
          throw new Error(`Statenour responded with status: ${res.status}`);
        }
        const json = await res.json();
        const payload = json && json.ok && json.data ? json.data : json;
        const drafts = (payload.drafts || []) as any[];
        return drafts.map((d: any) => ({
          ...d,
          previewUrl: `${statenourUrl}/api/content/render-asset?id=${d.id}`,
        }));
      } catch (err: any) {
        log.error("Failed to fetch Statenour social publish queue:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to fetch Statenour queue: ${err.message}` });
      }
    }),
  actOnStatenourQueueItem: adminProcedure
    .input(z.object({
      id: z.string(),
      action: z.enum(["approve", "reject", "schedule", "publish", "delete"]),
      reason: z.string().optional(),
      scheduledFor: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const statenourUrl = process.env.STATENOUR_SYNC_URL || "https://statenour-web-production.up.railway.app";
      const syncKey = process.env.STATENOUR_SYNC_KEY || "";
      if (!syncKey) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Statenour sync key is not configured on Nick's Tire." });
      }

      try {
        const res = await fetch(`${statenourUrl}/api/sync/queue`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-sync-key": syncKey,
          },
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          throw new Error(`Statenour responded with status: ${res.status}`);
        }
        const json = await res.json();
        return json && json.ok && json.data ? json.data : json;
      } catch (err: any) {
        log.error("Failed to mutate Statenour social publish queue item:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to mutate Statenour queue item: ${err.message}` });
      }
    }),
  listCampaigns: adminProcedure.query(async () => {
    const db = await getDbTyped();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
    return db.select().from(contentManufacturingCampaigns);
  }),
  createCampaign: adminProcedure
    .input(z.object({
      topic: z.string().min(2),
      persona: z.string().min(2),
      targetMonthlyVolume: z.number().default(30),
    }))
    .mutation(async ({ input }) => {
      const db = await getDbTyped();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const id = `campaign_${Date.now()}`;
      await db.insert(contentManufacturingCampaigns).values({
        id,
        topic: input.topic,
        persona: input.persona,
        targetMonthlyVolume: input.targetMonthlyVolume,
        isActive: true,
      });
      return { success: true, id };
    }),
  toggleCampaign: adminProcedure
    .input(z.object({
      id: z.string(),
      isActive: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDbTyped();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await db.update(contentManufacturingCampaigns)
        .set({ isActive: input.isActive })
        .where(eq(contentManufacturingCampaigns.id, input.id));
      return { success: true };
    }),
  explodeCampaignTopic: adminProcedure
    .input(z.object({ topic: z.string() }))
    .mutation(async ({ input }) => {
      const { explodeTopic } = await import("../services/contentManufacturing");
      return explodeTopic(input.topic);
    }),
  previewHooks: adminProcedure
    .input(z.object({
      topic: z.string(),
      angle: z.object({
        angle: z.string(),
        narrativeFranchise: z.string(),
        entertainmentPillar: z.string(),
        description: z.string(),
      }),
    }))
    .mutation(async ({ input }) => {
      const { generateHookLibrary } = await import("../services/contentManufacturing");
      return generateHookLibrary(input.topic, input.angle);
    }),
  triggerDraftGeneration: adminProcedure
    .input(z.object({
      campaignId: z.string().optional(),
      topic: z.string(),
      angle: z.object({
        angle: z.string(),
        narrativeFranchise: z.string(),
        entertainmentPillar: z.string(),
        description: z.string(),
      }),
      hook: z.object({
        hookText: z.string(),
        hookCategory: z.string(),
        scoreCuriosity: z.number(),
        scoreEmotion: z.number(),
        scoreLocalRelevance: z.number(),
        scoreAuthority: z.number(),
        scoreOverall: z.number().optional(),
      }),
      persona: z.string(),
      contentType: z.enum(["reel", "carousel", "post", "story"]),
    }))
    .mutation(async ({ input }) => {
      const { generateScoredDraft, validateClaimSafety } = await import("../services/contentManufacturing");
      const db = await getDbTyped();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      
      const draft = await generateScoredDraft(
        input.topic,
        input.angle,
        input.hook as any,
        input.persona,
        input.contentType,
        "both"
      );
      
      const validation = validateClaimSafety(draft);
      if (!validation.safe) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Claim Safety Violation: ${validation.errors.join("; ")}`,
        });
      }
      
      const overallScore = Math.round(
        draft.scoreCuriosity * 0.125 +
        draft.scoreEmotion * 0.125 +
        draft.scoreShareability * 0.125 +
        draft.scoreCommentPotential * 0.125 +
        draft.scoreSavePotential * 0.10 +
        draft.scoreLocalRelevance * 0.15 +
        draft.scoreRevenueRelevance * 0.10 +
        draft.scoreAuthority * 0.15
      );
      
      const id = `draft_${Date.now()}`;
      await db.insert(socialContentInventory).values({
        id,
        campaignId: input.campaignId || null,
        contentType: input.contentType,
        platform: "both",
        topic: input.topic,
        seriesName: input.angle.narrativeFranchise,
        episodeNumber: 1,
        hookCategory: input.hook.hookCategory,
        hookText: draft.hookText,
        bodyText: draft.bodyText,
        visualStyle: draft.visualStyle,
        persona: draft.persona,
        scoreCuriosity: draft.scoreCuriosity,
        scoreEmotion: draft.scoreEmotion,
        scoreShareability: draft.scoreShareability,
        scoreCommentPotential: draft.scoreCommentPotential,
        scoreSavePotential: draft.scoreSavePotential,
        scoreLocalRelevance: draft.scoreLocalRelevance,
        scoreRevenueRelevance: draft.scoreRevenueRelevance,
        scoreAuthority: draft.scoreAuthority,
        scoreHookStrength: draft.scoreHookStrength,
        scoreOverall: overallScore,
        gscQuerySeed: input.hook.hookText,
        weatherTriggerCondition: draft.weatherTriggerCondition || null,
        interactiveDmKeyword: draft.interactiveDmKeyword,
        status: "pending",
        briefJson: draft.briefJson,
        assetPaths: [],
      });
      
      return { success: true, id, draft, overallScore };
    }),
  generateAndPublishLiveTestReel: adminProcedure
    .input(z.object({
      dryRun: z.boolean().optional(),
    }).optional())
    .mutation(async ({ input }) => {
      // This endpoint force-armed publishing PROCESS-WIDE (see the removed
      // env mutation below) — any concurrent cron pulse saw the kill switch
      // defeated for its whole multi-minute run. It also publishes without an
      // approval record. Gated OFF by default; opt in only in a real test
      // environment, and even then non-dryRun requires a second explicit flag.
      if (process.env.REEL_LIVE_TEST_ENABLED !== "true") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Live-test reel endpoint is disabled. Set REEL_LIVE_TEST_ENABLED=true in a test environment to use it; production reels go through Studio → approve → publish.",
        });
      }
      if (!input?.dryRun && process.env.REEL_LIVE_TEST_ALLOW_PUBLISH !== "true") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Live-test publishing is disabled. Pass dryRun=true, or set REEL_LIVE_TEST_ALLOW_PUBLISH=true to publish from the canary (not recommended — it bypasses approval provenance).",
        });
      }
      const db = await getDbTyped();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

      const { generateReelBriefAI } = await import("../services/reelBriefGen");
      const { critiqueReelBrief, detectServiceCategory, getNarrativeSpineDetails, determineVisualStyle } = await import("../services/contentManufacturing");
      const { enqueueReelJob, processNextReelJob, processNextAssemblyJob } = await import("../services/reelPipeline");
      const { publishToSocial } = await import("../services/socialPublish");
      const { getInstagramPermalink } = await import("../services/metaSocial");

      const topic = "Cleveland roads do not just hit your tires. They keep score. (Cleveland vs Your Car - Pothole Gremlin)";
      
      let brief: any = null;
      let overallScore = 0;
      let criticScores: any = null;
      let bestBrief: any = null;
      let bestScore = -1;
      let bestCriticScores: any = null;

      log.info("Starting evaluation loop for live test reel");
      for (let i = 0; i < 5; i++) {
        log.info(`Generation attempt ${i + 1} of 5`);
        const genRes = await generateReelBriefAI({
          topic,
          campaignKeyword: "POTHOLE",
          factBucket: "cleveland_survival",
          archetype: "pov_you_are_the_part",
        });
        brief = genRes.brief;
        
        criticScores = await critiqueReelBrief(brief, topic);
        overallScore = Math.round(
          criticScores.scoreCuriosity * 0.125 +
          criticScores.scoreEmotion * 0.125 +
          criticScores.scoreShareability * 0.125 +
          criticScores.scoreCommentPotential * 0.125 +
          criticScores.scoreSavePotential * 0.10 +
          criticScores.scoreLocalRelevance * 0.15 +
          criticScores.scoreRevenueRelevance * 0.10 +
          criticScores.scoreAuthority * 0.15
        );
        
        log.info(`Attempt ${i + 1} got score: ${overallScore}`);
        
        if (overallScore > bestScore) {
          bestScore = overallScore;
          bestBrief = brief;
          bestCriticScores = criticScores;
        }
        
        if (overallScore >= 90) {
          log.info(`Found candidate meeting score threshold >= 90: ${overallScore}`);
          break;
        }
      }
      
      if (!bestBrief) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate any reel brief",
        });
      }

      log.info(`Proceeding with best candidate (Score: ${bestScore})`);
      
      const serviceCat = detectServiceCategory({ topic: bestBrief.topic, bodyText: bestBrief.voiceoverScript || "" });
      const spine = getNarrativeSpineDetails(serviceCat);
      const character = spine.characters[0] || "";
      const visualStyle = determineVisualStyle(serviceCat, "Cleveland Survival Guide");

      // NOTE: this endpoint used to set REEL_GENERATION_ENABLED and
      // REEL_PUBLISH_ENABLED = "true" here, PROCESS-WIDE, for the whole run —
      // defeating the operator's kill switch for every concurrent cron. That
      // mutation is removed. The gate above (REEL_LIVE_TEST_ENABLED) is what
      // authorizes this canary; the pipeline reads the real flags, which must
      // already be armed in the test environment for generation to proceed.
      {
        const { jobId } = await enqueueReelJob(bestBrief, "admin");
        log.info(`Enqueued reel job ID: ${jobId}`);

        // Run clip generation
        let genAttempts = 0;
        let genSuccess = false;
        let lastError = "";
        while (genAttempts < 15 && !genSuccess) {
          genAttempts++;
          log.info(`Running processNextReelJob attempt ${genAttempts}`);
          const res = await processNextReelJob();
          if (res.jobId === jobId) {
            if (res.status === "assets_ready") {
              genSuccess = true;
            } else if (res.status === "failed") {
              lastError = res.error || "failed status";
              break;
            }
          }
          if (!res.processed) {
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        if (!genSuccess) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Reel clip generation failed or timed out: ${lastError}`,
          });
        }

        // Run assembly
        let assemblyAttempts = 0;
        let assemblySuccess = false;
        while (assemblyAttempts < 15 && !assemblySuccess) {
          assemblyAttempts++;
          log.info(`Running processNextAssemblyJob attempt ${assemblyAttempts}`);
          const res = await processNextAssemblyJob();
          if (res.jobId === jobId) {
            if (res.status === "assembled") {
              assemblySuccess = true;
            } else if (res.status === "failed") {
              lastError = res.error || "failed status";
              break;
            }
          }
          if (!res.processed) {
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        if (!assemblySuccess) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Reel assembly failed or timed out: ${lastError}`,
          });
        }

        // Fetch assembled URL
        const { reelJobs } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const jobRows = await db.select().from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
        const finalJob = jobRows[0];
        if (!finalJob || !finalJob.mp4Url) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not retrieve assembled MP4 URL from database",
          });
        }

        // Publish to Instagram
        let pubResult: any = { success: false, error: "Dry run" };
        let permalink: string | null = null;
        if (!input?.dryRun) {
          log.info(`Publishing to Instagram: ${finalJob.mp4Url}`);
          pubResult = await publishToSocial({
            platforms: ["instagram"],
            videoUrl: finalJob.mp4Url,
            caption: finalJob.caption || bestBrief.selectedCaption || "",
          });
          if (pubResult.igPostId) {
            permalink = await getInstagramPermalink(pubResult.igPostId);
            await db.update(reelJobs)
              .set({ status: "posted", igPostId: pubResult.igPostId })
              .where(eq(reelJobs.id, jobId));
          } else {
            log.error("Instagram publish failed", { pubResult });
          }
        }

        // publishToSocial returns { results, igPostId } with NO top-level
        // `success` — the old `pubResult.success` was always undefined, so a
        // real live post reported success:false. Derive it from the actual IG
        // result (or the dry-run short-circuit).
        const igResult = Array.isArray(pubResult.results)
          ? pubResult.results.find((r: { platform: string }) => r.platform === "instagram")
          : undefined;
        const publishedOk = input?.dryRun ? true : !!igResult?.success;
        return {
          success: publishedOk,
          jobId,
          topic: bestBrief.topic,
          championHook: bestBrief.captionHooks?.[0] || bestBrief.mechanicTruth,
          caption: finalJob.caption || bestBrief.selectedCaption,
          criticScore: bestScore,
          visualStyle: visualStyle.name,
          serviceUniverse: serviceCat,
          narrativeSpine: spine.narrative,
          characterUsed: character,
          mp4Url: finalJob.mp4Url,
          igPostId: pubResult.igPostId,
          instagramPermalink: permalink,
          metaPublishResponse: pubResult,
          criticScores: bestCriticScores,
        };
      }
    }),
  runFullPipeline: adminProcedure
    .input(z.object({
      campaignId: z.string(),
      topic: z.string(),
      persona: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { runManufacturingPipeline } = await import("../services/contentManufacturing");
      return runManufacturingPipeline(input.campaignId, input.topic, input.persona);
    }),
  getReserveStatus: adminProcedure.query(async () => {
    const { getReserveStatus } = await import("../services/contentManufacturing");
    return getReserveStatus();
  }),
  replenishReserve: adminProcedure.mutation(async () => {
    const { replenishReserve } = await import("../services/contentManufacturing");
    return replenishReserve();
  }),
  syncSocialMetricsAndAttribution: adminProcedure.mutation(async () => {
    const { syncSocialMetrics, attributeRevenueToSocial } = await import("../services/contentManufacturing");
    const sync = await syncSocialMetrics();
    const attrib = await attributeRevenueToSocial();
    return { sync, attrib };
  }),
  listInventory: adminProcedure
    .input(z.object({
      status: z.string().optional(),
      topic: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDbTyped();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      let query = db.select().from(socialContentInventory);
      const conditions = [];
      if (input?.status) conditions.push(eq(socialContentInventory.status, input.status));
      if (input?.topic) conditions.push(eq(socialContentInventory.topic, input.topic));
      if (conditions.length > 0) {
        return query.where(and(...conditions)).orderBy(desc(socialContentInventory.createdAt));
      }
      return query.orderBy(desc(socialContentInventory.createdAt));
    }),
  actOnInventoryItem: adminProcedure
    .input(z.object({
      id: z.string(),
      action: z.enum(["approve", "reject", "schedule"]),
      scheduledAt: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDbTyped();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const status = input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "scheduled";
      const scheduledDate = input.scheduledAt ? new Date(input.scheduledAt) : null;
      await db.update(socialContentInventory)
        .set({ status, scheduledAt: scheduledDate })
        .where(eq(socialContentInventory.id, input.id));
      return { success: true };
    }),
  /* ─── Reel Action Center ───────────────────────────────────────────────────
   * These three exist as REST routes behind requireAdminApiKey, which compares a
   * Bearer header and NEVER looks at a session cookie — so the operator's browser
   * could not reach them at all, and the only way to run them was curl with the
   * admin key. Everything here is the operator's own daily work, so it belongs on
   * a session-authenticated transport. The REST routes stay for headless/cron use.
   * ------------------------------------------------------------------------- */

  /** Every non-terminal reel job, with the SPECIFIC reason it stopped and only
   *  the actions its surviving artifacts can support. */
  reelJobsNeedingAttention: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

    // ONE definition of "needs attention", shared with HQ so the two screens can
    // never disagree — they did: HQ counted every failed job ever (61) while this
    // list excluded failed entirely and reported nothing stuck.
    const { assessReelJob, selectReelJobsNeedingAttention } = await import("../services/reelRecoverability");
    const rows = await selectReelJobsNeedingAttention(d, 50);
    const { evaluateReelPublishGate } = await import("../services/qualityGate");

    const jobs = await Promise.all(
      rows.map(async (job: typeof rows[number]) => {
        // runIfMissing:false — a LIST must never trigger paid vision QA.
        let gateReason: string | undefined;
        if (job.status === "assembled") {
          try {
            const g = await evaluateReelPublishGate(job.id, { runIfMissing: false });
            if (!g.allowed) gateReason = `${g.gate}: ${g.reason}`;
          } catch (err) {
            gateReason = `quality gate could not be evaluated: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`;
          }
        }
        return assessReelJob(job, { gateReason });
      }),
    );
    return {
      count: jobs.length,
      unrecoverable: jobs.filter((j: typeof jobs[number]) => j.recoverability === "brief_only" || j.recoverability === "unrecoverable").length,
      jobs,
    };
  }),

  /** Rebuild a lost master from surviving source clips. Free — no generation
   *  spend. NOT a repair: it produces a different file, so the service drops the
   *  stale QA verdict and the job returns to "assembled" needing fresh QA. */
  reassembleReelFromClips: adminProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const { reassembleFromClips } = await import("../services/reelReassemble");
      const { withOperatorAction, ACTION_OUTCOME } = await import("../services/operatorActionLog");
      const result = await withOperatorAction(
        { action: "reassemble", operatorId: ctx.user?.id ?? null, jobId: input.jobId, costsMoney: false },
        () => reassembleFromClips(input.jobId),
        // reassembleFromClips ANSWERS with { ok: false, reason } rather than
        // throwing, because a job in the wrong state is an answer, not a fault.
        // Without this the log recorded every refused re-assembly as a success.
        { outcomeOfResult: (r) => (r.ok ? ACTION_OUTCOME.ok : ACTION_OUTCOME.refused) },
      );
      if (!result.ok) {
        // A refusal is an ANSWER about the job's state, not a server fault.
        throw new TRPCError({ code: "BAD_REQUEST", message: result.reason });
      }
      return result;
    }),

  /** Publishes that may or may not be live — an attempt with no recorded
   *  outcome. This is what a publish_ambiguous job gets reconciled against. */
  openPublishAttempts: adminProcedure
    .input(z.object({ olderThanMinutes: z.number().int().min(0).max(10080).optional() }))
    .query(async ({ input }) => {
      const { findUnreconciledAttempts } = await import("../services/publishAttemptLedger");
      const attempts = await findUnreconciledAttempts(input.olderThanMinutes ?? 15);
      return { count: attempts.length, attempts };
    }),
  /** Ask META what happened to an open publish attempt. Read-only: it returns a
   *  verdict or candidates, and never changes anything on its own. */
  checkAmbiguousPublish: adminProcedure
    .input(z.object({ attemptId: z.string().min(1), jobId: z.number().int().positive().optional() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const { autonomyAuditEvents, reelJobs } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const [attempt] = await d.select().from(autonomyAuditEvents).where(eq(autonomyAuditEvents.id, input.attemptId)).limit(1);
      if (!attempt) throw new TRPCError({ code: "NOT_FOUND", message: "That publish attempt is not in the ledger." });

      let ctx: { jobId?: number | null } = {};
      try { ctx = JSON.parse(attempt.contextJson ?? "{}"); } catch { /* timing-only match */ }
      const jobId = input.jobId ?? ctx.jobId ?? null;

      // The caption is the strongest signal, so recover it from the job when we can.
      let expectedCaption: string | null = null;
      if (jobId) {
        const [job] = await d.select().from(reelJobs).where(eq(reelJobs.id, Number(jobId))).limit(1);
        if (job?.payload) {
          try { expectedCaption = (JSON.parse(job.payload) as { selectedCaption?: string }).selectedCaption ?? null; } catch { /* fall back to timing */ }
        }
      }

      const { reconcileAttempt } = await import("../services/publishReconciler");
      const verdict = await reconcileAttempt({
        attemptId: input.attemptId,
        attemptedAt: new Date(attempt.occurredAt),
        expectedCaption,
      });
      return { ...verdict, jobId, attemptId: input.attemptId };
    }),

  /** Apply a reconciliation decision. Separate from the CHECK on purpose: the
   *  operator sees the evidence first, and a wrong call here either drops a reel
   *  or double-posts to a live audience. */
  resolveAmbiguousPublish: adminProcedure
    .input(z.object({
      /** Which table the id belongs to — reel jobs and scheduled posts have
       *  independent id spaces, so writing to the wrong one is silent corruption. */
      kind: z.enum(["reel_job", "scheduled_post"]).default("reel_job"),
      jobId: z.number().int().positive(),
      attemptId: z.string().min(1),
      decision: z.enum(["published", "not_published"]),
      igPostId: z.string().max(64).optional(),
      operatorNote: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.decision === "published" && !input.igPostId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Marking a publish live requires the Instagram post id it went out as." });
      }
      const { applyReconciliation } = await import("../services/publishReconciler");
      const { withOperatorAction, ACTION_OUTCOME } = await import("../services/operatorActionLog");
      const res = await withOperatorAction(
        { action: `reconcile_${input.decision}`, operatorId: ctx.user?.id ?? null, jobId: input.jobId, costsMoney: false,
          detail: { kind: input.kind, attemptId: input.attemptId } },
        () => applyReconciliation(input),
        { outcomeOfResult: (r) => (r.ok ? ACTION_OUTCOME.ok : ACTION_OUTCOME.refused) },
      );
      if (!res.ok) throw new TRPCError({ code: "BAD_REQUEST", message: res.detail });
      return res;
    }),

  /** Close out a reel job that cannot be recovered. Terminal and deliberate: it
   *  existed on NO transport before, so a dead job could only be left to sit. */
  discardReelJob: adminProcedure
    .input(z.object({
      jobId: z.number().int().positive(),
      reason: z.string().min(1).max(300),
      /** archive keeps the record legible for audit; discard is a plain close. */
      mode: z.enum(["archive", "discard"]).default("discard"),
    }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { reelJobs } = await import("../../drizzle/schema");
      const { eq, and, inArray } = await import("drizzle-orm");
      const { affectedRowCount } = await import("../lib/db-affected");

      // A posted job is history and a publishing/ambiguous one may be LIVE —
      // neither may be closed here. Ambiguity is resolved by reconciling, not by
      // discarding the evidence.
      const { recordOperatorAction, ACTION_OUTCOME } = await import("../services/operatorActionLog");
      const CLOSEABLE = ["assembled", "queued", "generating", "assets_ready", "assembling", "repair_rendering", "failed"];
      const res = await d
        .update(reelJobs)
        .set({ status: "failed", error: `${input.mode === "archive" ? "archived" : "discarded"} by operator: ${input.reason}`.slice(0, 500) })
        .where(and(eq(reelJobs.id, input.jobId), inArray(reelJobs.status, CLOSEABLE)));
      if (affectedRowCount(res) !== 1) {
        await recordOperatorAction({ action: "discard", outcome: ACTION_OUTCOME.refused, operatorId: ctx.user?.id ?? null, jobId: input.jobId, detail: { reason: input.reason } });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This job cannot be closed from here — it has already published, or it may be live and needs reconciling first.",
        });
      }
      await recordOperatorAction({ action: "discard", outcome: ACTION_OUTCOME.ok, operatorId: ctx.user?.id ?? null, jobId: input.jobId, detail: { reason: input.reason, mode: input.mode } });
      return { ok: true, jobId: input.jobId, mode: input.mode };
    }),
  /**
   * A CHEAP platform-level "something needs you" count, safe to poll from the
   * admin sidebar on every page load.
   *
   * Deliberately NOT reelJobsNeedingAttention: that one PROBES every artifact
   * over HTTP to decide what is recoverable, which is right for a detail view and
   * catastrophic for a badge that polls. Counts only — two COUNT(*) queries.
   *
   * `unknown: true` when a count could not be read. Callers must render that as
   * "unable to determine", never as zero: a failed query showing 0 is a green
   * light the system never gave.
   */
  operationsSignal: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return { heldReels: 0, openPublishes: 0, total: 0, unknown: true };

    let heldReels = 0;
    let openPublishes = 0;
    let unknown = false;

    try {
      const { reelJobs } = await import("../../drizzle/schema");
      const { inArray, and, eq, gte, or, sql } = await import("drizzle-orm");
      const { ATTENTION_STATUSES, FAILED_ATTENTION_DAYS } = await import("../services/reelRecoverability");
      const cutoff = new Date(Date.now() - FAILED_ATTENTION_DAYS * 24 * 60 * 60 * 1000);
      const [row] = await d
        .select({ n: sql<number>`COUNT(*)`.as("n") })
        .from(reelJobs)
        .where(or(
          inArray(reelJobs.status, [...ATTENTION_STATUSES]),
          and(eq(reelJobs.status, "failed"), gte(reelJobs.updatedAt, cutoff)),
        ));
      heldReels = Number(row?.n ?? 0);
    } catch (err) {
      log.warn("operationsSignal: could not count held reels", err);
      unknown = true;
    }

    try {
      const { findUnreconciledAttempts } = await import("../services/publishAttemptLedger");
      openPublishes = (await findUnreconciledAttempts(15)).length;
    } catch (err) {
      log.warn("operationsSignal: could not count open publish attempts", err);
      unknown = true;
    }

    return { heldReels, openPublishes, total: heldReels + openPublishes, unknown };
  }),
  /**
   * Regenerate a dead reel from its surviving brief. This is a NEW PAID JOB, not
   * a repair — different media, new hashes, its own QA and approval.
   *
   * Routed through enqueueReelJob ON PURPOSE: that is where the M10 defect
   * preflight and the spend/governor gates live (daily cap, cooldowns, budget).
   * Calling the generator directly would quietly bypass the operator's own spend
   * limits, which is precisely the failure an "operator convenience" button
   * invites.
   */
  regenerateReelFromBrief: adminProcedure
    .input(z.object({
      jobId: z.number().int().positive(),
      /** Typed acknowledgement that this spends generation budget. */
      confirmSpend: z.literal(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const { reelJobs } = await import("../../drizzle/schema");
      const { eq, and, inArray } = await import("drizzle-orm");
      const { affectedRowCount } = await import("../lib/db-affected");

      const [job] = await d.select().from(reelJobs).where(eq(reelJobs.id, input.jobId)).limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: `Reel job ${input.jobId} not found` });
      // A job that may be live must be reconciled, never regenerated — that is how
      // the same content gets posted twice.
      if (job.status === "publishing" || job.status === "publish_ambiguous" || job.status === "posted") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This job has published or may be live. Reconcile it before regenerating, or you risk posting the same reel twice.",
        });
      }

      let brief: Record<string, unknown>;
      try { brief = JSON.parse(job.payload ?? "{}"); } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This job's brief is unreadable — there is nothing to regenerate from." });
      }
      const beats = brief.storyboardBeats;
      if (!Array.isArray(beats) || !beats.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This job has no storyboard beats — nothing to regenerate from." });
      }

      // Stale judgements about the DEAD media must not travel to the new job.
      delete (brief as Record<string, unknown>).renderedQa;
      delete (brief as Record<string, unknown>).audioQa;

      const { enqueueReelJob } = await import("../services/reelPipeline");
      const { withOperatorAction } = await import("../services/operatorActionLog");
      const { jobId: newJobId } = await withOperatorAction(
        { action: "regenerate", operatorId: ctx.user?.id ?? null, jobId: input.jobId, costsMoney: true },
        () => enqueueReelJob(brief as never, "admin"),
        {
          // enqueueReelJob throws a plain Error when the M10 preflight or the
          // spend governor says no. That is the system REFUSING, not breaking,
          // and it is the most important refusal to count correctly — it is how
          // "we keep hitting the daily cap" becomes visible instead of looking
          // like a broken regenerate button.
          isRefusal: (err) => err instanceof Error && /preflight blocked|governor|budget|spend|cap|cooldown/i.test(err.message),
        },
      );

      // Close the old one so it stops appearing as work. Best-effort: the new job
      // already exists and the spend is committed, so a failure here must not
      // surface as "regeneration failed".
      try {
        const closeable = ["assembled", "queued", "generating", "assets_ready", "assembling", "repair_rendering", "failed"];
        const res = await d.update(reelJobs)
          .set({ status: "failed", error: `superseded by regenerated job ${newJobId} (operator ${ctx.user?.id ?? "?"})`.slice(0, 500) })
          .where(and(eq(reelJobs.id, input.jobId), inArray(reelJobs.status, closeable)));
        if (affectedRowCount(res) !== 1) log.warn("regenerate: old job not closed (state changed under us)", { jobId: input.jobId });
      } catch (err) {
        log.warn("regenerate: could not close the superseded job", err);
      }

      return { ok: true, supersededJobId: input.jobId, newJobId };
    }),
  /** What happened to one request, start to finish — the run's own story. */
  getContentRun: adminProcedure
    .input(z.object({ runId: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const { getContentRun } = await import("../services/contentRun");
      const run = await getContentRun(input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "No such content run." });
      return run;
    }),

  /** Recent runs — the operator's own history of what they asked for. */
  recentContentRuns: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) return { runs: [] };
      const { contentRuns } = await import("../../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      const rows = await d.select().from(contentRuns).orderBy(desc(contentRuns.createdAt)).limit(input?.limit ?? 20);
      return {
        runs: rows.map((r: typeof rows[number]) => ({
          id: r.id,
          createdAt: r.createdAt,
          requestedFormat: r.requestedFormat,
          chosenFormat: r.chosenFormat,
          stage: r.stage,
          implementationState: r.implementationState,
          operationalState: r.operationalState,
          costCents: r.costCents,
          inventoryId: r.inventoryId,
          // Stated once, server-side, so no screen re-derives it and gets it wrong.
          isProvenPublished: r.operationalState === "published",
        })),
      };
    }),
  /**
   * What content actually EARNED — run -> lead -> paid invoice.
   *
   * `leads.utmContent` has been captured on every booking and callback the whole
   * time and read by NOTHING. This is its first consumer. Until now a reel with
   * 18,000 views and no bookings, and a carousel with 400 views and six paid
   * repairs, looked the same to every dashboard in the system.
   */
  contentRevenue: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).optional() }).optional())
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const { leads, invoices, contentRuns } = await import("../../drizzle/schema");
      const { eq, gte, desc, isNotNull } = await import("drizzle-orm");
      const since = new Date(Date.now() - (input?.days ?? 90) * 864e5);

      // Only leads that carry a tracking id can be attributed at all. Leads
      // without one are the blind spot — counted and NAMED by the aggregator
      // rather than quietly dropped.
      const rows = await d
        .select({
          leadId: leads.id,
          utmContent: leads.utmContent,
          invoiceId: leads.invoiceId,
          // The invoice's real columns: paymentStatus is the enum
          // (paid|pending|partial|refunded) and totalAmount is already in cents.
          invoiceStatus: invoices.paymentStatus,
          invoiceAmountCents: invoices.totalAmount,
        })
        .from(leads)
        .leftJoin(invoices, eq(leads.invoiceId, invoices.id))
        .where(gte(leads.createdAt, since))
        .limit(5000);

      // Generation cost per run, so revenue sits beside what it cost to make.
      const costByRun: Record<string, number> = {};
      try {
        const runs = await d
          .select({ id: contentRuns.id, costCents: contentRuns.costCents })
          .from(contentRuns)
          .orderBy(desc(contentRuns.createdAt))
          .limit(500);
        for (const r of runs) costByRun[r.id] = Number(r.costCents ?? 0);
      } catch (err) {
        log.warn("content run costs unavailable — revenue shown without cost", err);
      }

      const { aggregateContentRunRevenue } = await import("../services/contentRunAttribution");
      return { windowDays: input?.days ?? 90, ...aggregateContentRunRevenue(rows as never, costByRun) };
    }),
});
