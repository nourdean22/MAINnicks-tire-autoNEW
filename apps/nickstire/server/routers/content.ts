/**
 * Content router — public content access and admin content management.
 */
import { TRPCError } from "@trpc/server";
import { publicProcedure, adminProcedure, router, dbAdminProcedure } from "../_core/trpc";
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
import { AUTONOMY_LIMIT_KEYS } from "../../client/src/lib/autonomyPolicy";
import { dispatch } from "../services/eventBus";
import { queueStateForReelStatus } from "@shared/reelQueue";
import { EXPERIMENT_PRESET_IDS, buildExperimentPreset } from "@shared/contentExperiments";

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
  // `getPublishedArticles` returns [] on a dead handle — indistinguishable from
  // "this blog has no posts". That is the same lie as articleBySlug below, one
  // level up: the LIST version of a fabricated read.
  //
  // Guarded here rather than at the helper because the helper's [] is
  // load-bearing elsewhere: scripts/prerender.mjs loads DB blog slugs through
  // it and applies its own `.catch(() => [])`, and breaking that would drop
  // every dynamic post out of the prerender route list.
  //
  // Costs a visitor nothing. Blog.tsx does `(dbArticles || [])` and SiteMap.tsx
  // documents the same fallback, so both still render — with the 118 static
  // articles — exactly as they did when the read silently returned []. What
  // changes is that the failure is now VISIBLE instead of looking like an empty
  // blog, to us and to anything that prerenders the page.
  //
  // The guard is written inline, not extracted to a helper, deliberately:
  // scripts/lib/fabricatedAdminReadScan.mjs detects it TEXTUALLY in the
  // procedure body, so hiding it behind `await requireStore()` would leave the
  // ratchet reporting this pair as unguarded forever.
  publishedArticles: publicProcedure.query(async () => {
    if (!(await getDbTyped())) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "Article store unavailable — this is a read failure, not an empty blog.",
      });
    }
    return getPublishedArticles();
  }),
  // THIS FABRICATED READ COST US GOOGLE RANKINGS, not just a wrong number.
  //
  // getDynamicArticleBySlug returns `null` on a dead handle (content-generator.ts:449),
  // which is the same value it returns for "no such article". BlogPost.tsx renders
  // that as its not-found branch — "ARTICLE NOT FOUND" — and the prerenderer
  // captured and committed exactly that, at HTTP 200, for URLs the sitemap
  // advertises. GSC read them as Soft 404s.
  //
  // Measured in the 2026-09-10 refresh (run 34522396903): SIX DB-backed blog
  // routes rendered the not-found branch, all in a 90-second window ~14 minutes
  // into the run, right where the DB-dynamic routes are appended last. Every
  // static article rendered fine. That is a database handle failing late in a
  // long run being reported to the reader as "this article does not exist".
  //
  // ROS-083 shape: guard at the ROUTER, not the helper. The helper's `null` is
  // load-bearing for genuinely-absent slugs, and callers distinguish the two
  // cases only if the failure arrives as an error.
  //
  // A thrown SERVICE_UNAVAILABLE cannot be mistaken for an empty result: the
  // prerenderer already refuses to write a page that renders empty, and now the
  // server LOG names the cause instead of the run looking like a content gap.
  articleBySlug: publicProcedure
    .input(z.object({ slug: z.string().max(200) }))
    .query(async ({ input }) => {
      if (!(await getDbTyped())) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Article store unavailable — this is a read failure, not a missing article.",
        });
      }
      const row = await getDynamicArticleBySlug(input.slug);

      // A MISS IS WORTH A LINE, because one specific miss is currently
      // unexplained and invisible from outside.
      //
      // Two prerendered blog URLs have rendered "ARTICLE NOT FOUND" on four
      // consecutive refreshes while the SAME slugs return a full article from
      // production, the page renders correctly in a real browser, and no
      // `[tRPC ERROR] ... articleBySlug` ever appears in the server log — so the
      // query runs and returns NO ROW for a row that demonstrably exists. Eight
      // explanations were excluded by measurement (credential, network, TLS,
      // PRERENDER_MODE, a different database, payload size, a dead handle, and
      // render ordering); what remains cannot be settled from outside the
      // process, because a miss and a healthy empty result look identical.
      //
      // So the miss reports what the CONNECTION THAT SERVED IT can see. If the
      // count comes back 14, the row was there and the equality failed — look at
      // the slug bytes. If it comes back lower, or 0, that connection is reading
      // a different or partial view, and the pool is the subject. Either answer
      // ends the guessing; the two are indistinguishable without this line.
      //
      // Cheap by construction: it only runs when a lookup missed, which is rare
      // and is exactly when someone wants to know why.
      if (!row) {
        try {
          const visible = (await getPublishedArticles()).length;
          log.warn("articleBySlug found no published row", {
            slug: input.slug,
            publishedVisibleToThisConnection: visible,
          });
        } catch (err) {
          log.warn("articleBySlug miss — and the follow-up count also failed", {
            slug: input.slug,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return row;
    }),
  // Same shape: [] on a dead handle reads as "nothing to announce". A shop
  // notice that fails to load and a shop with no notices are different facts,
  // and only one of them is worth paging someone about. NotificationBar renders
  // nothing when the query has no data, so the visitor-facing result is
  // unchanged either way — the difference is whether we can tell.
  activeNotifications: publicProcedure.query(async () => {
    if (!(await getDbTyped())) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "Notification store unavailable — this is a read failure, not an absence of notices.",
      });
    }
    return getActiveNotifications();
  }),
  currentSeason: publicProcedure.query(() => {
    return { season: getCurrentSeason() };
  }),
});

export const contentAdminRouter = router({
  allArticles: dbAdminProcedure.query(async () => {
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
  allNotifications: dbAdminProcedure.query(async () => {
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
  generationLog: dbAdminProcedure.query(async () => {
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
  listCampaignGenomes: dbAdminProcedure
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

        /**
         * Format fatigue: what did we actually publish, most recent first.
         *
         * This filtered on status "posted", which NOTHING writes to
         * socialContentInventory — that value belongs to reelJobs and
         * socialDrafts. The query therefore always returned zero rows while
         * reporting `available: true`, so the planner read a permanently empty
         * result as a MEASUREMENT that no format was overused, and the fatigue
         * rule could never fire. A wrong status string is not a small bug when
         * `available` turns its emptiness into a finding.
         */
        const recent = await d
          .select({ contentType: socialContentInventory.contentType })
          .from(socialContentInventory)
          .where(inArray(socialContentInventory.status, ["published", "published_partial"]))
          .orderBy(desc(socialContentInventory.updatedAt))
          .limit(6);
        signals.recentFormats = {
          // No publish history is MISSING DATA, not evidence of variety. The
          // shop has published five times ever; an empty window here is the
          // normal case and must grade the planner's confidence down.
          available: recent.length > 0,
          values: recent.map((r: typeof recent[number]) =>
            (r.contentType === "post" ? "single" : String(r.contentType)) as never),
        };

        /**
         * Footage on hand: clips from reels whose assets survived. This is what
         * makes a reel FREE instead of a paid generation — so it directly drives
         * whether the planner recommends spending money.
         *
         * It used to be `COUNT(*) * 6`: a job count multiplied by a guess at
         * clips-per-reel, presented to the operator as a literal number of clips.
         * A fabricated number is worse than a missing one — a missing signal
         * grades confidence down and says so, while a fabricated one is acted on.
         * Now the actual stored clip lists are counted.
         */
        const clipRows = await d
          .select({ clipUrlsJson: reelJobs.clipUrlsJson })
          .from(reelJobs)
          .where(and(
            inArray(reelJobs.status, ["assembled", "assets_ready"]),
            gte(reelJobs.updatedAt, new Date(Date.now() - 30 * 864e5)),
          ))
          .limit(200);
        let clipCount = 0;
        for (const r of clipRows as Array<{ clipUrlsJson: string | null }>) {
          try {
            const urls = JSON.parse(r.clipUrlsJson ?? "[]");
            if (Array.isArray(urls)) clipCount += urls.filter((u) => typeof u === "string" && u).length;
          } catch { /* an unreadable clip list contributes nothing — never a guess */ }
        }
        // photoCount stays 0 AND the signal stays honest about it: no query
        // measures a photo library, so this is a partial signal, not a full one.
        signals.mediaOnHand = { available: clipRows.length > 0, clipCount, photoCount: 0 };
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
      const { publishPolicyVersion, PolicyValidationError } = await import("../services/autonomyControl");
      const { validateAutonomyPolicyShape } = await import("../../client/src/lib/autonomyPolicy");
      if (!validateAutonomyPolicyShape(input.policy)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Policy failed shape validation" });
      }
      return publishPolicyVersion(input.policy, input.note, ctx.user?.email ?? "admin").catch((err: unknown) => {
        throw err instanceof PolicyValidationError ? new TRPCError({ code: "BAD_REQUEST", message: err.message }) : err;
      });
    }),

  setAutonomyKillSwitch: adminProcedure
    .input(z.object({ scope: z.enum(["global", "generation", "publishing"]), on: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const { setKillSwitch } = await import("../services/autonomyControl");
      return setKillSwitch(input.scope, input.on, ctx.user?.email ?? "admin");
    }),

  /** One limit, edited on the server against the stored policy (Autonomy control's limit rows). */
  setAutonomyLimit: adminProcedure
    .input(z.object({ key: z.enum(AUTONOMY_LIMIT_KEYS), value: z.number().finite() }))
    .mutation(async ({ input, ctx }) => {
      const { setPolicyLimit, PolicyValidationError } = await import("../services/autonomyControl");
      return setPolicyLimit(input.key, input.value, ctx.user?.email ?? "admin").catch((err: unknown) => {
        throw err instanceof PolicyValidationError ? new TRPCError({ code: "BAD_REQUEST", message: err.message }) : err;
      });
    }),

  /** Paid beat repairs: "auto" spends within the budget; "approval_required" waits for the operator. */
  setAutonomyPaidRepair: adminProcedure
    .input(z.object({
      permission: z.enum(["auto", "approval_required"]),
      /** Turning paid repairs on: the budget and repair limit the confirm showed. */
      confirmedLimits: z.object({
        maxGenerationCostPerDayUsd: z.number().finite(),
        maxRepairAttemptsPerAsset: z.number().finite(),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { setPaidRepairPermission, PolicyValidationError, PolicyConflictError } = await import("../services/autonomyControl");
      return setPaidRepairPermission(input.permission, ctx.user?.email ?? "admin", input.confirmedLimits).catch((err: unknown) => {
        if (err instanceof PolicyConflictError) throw new TRPCError({ code: "CONFLICT", message: err.message });
        throw err instanceof PolicyValidationError ? new TRPCError({ code: "BAD_REQUEST", message: err.message }) : err;
      });
    }),

  runConceptTournament: adminProcedure
    .input(z.object({
      campaignAsk: z.string().min(8).max(600),
      objective: z.string().max(32).optional(),
      proofHandles: z.array(z.string().max(200)).max(8).optional(),
      avoidRecent: z.array(z.string().max(200)).max(12).optional(),
      generateGenome: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { assertAllowed } = await import("../services/autonomyControl");
      await assertAllowed({ type: "generate_campaign" }).catch((err: unknown) => {
        if (err instanceof Error && err.message.startsWith("Blocked by autonomy policy")) {
          throw new TRPCError({ code: "FORBIDDEN", message: err.message });
        }
        return undefined; // policy infra failure — default posture allows
      });
      const { createContentRun, advanceContentRun, RUN_STAGE } = await import("../services/contentRun");
      const contentRunId = await createContentRun({
        requestedBy: ctx.user?.email ?? null,
        requestSource: "operator",
        requestedTopic: input.campaignAsk,
        requestedFormat: null,
      });
      if (!contentRunId) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the canonical content run; campaign generation refused rather than escaping lineage." });
      }
      await advanceContentRun(contentRunId, {
        stage: RUN_STAGE.planning,
        objective: input.objective ?? null,
        evidence: { at: new Date().toISOString(), what: "concept tournament started" },
      });
      try {
        const { runConceptTournament } = await import("../services/conceptTournament");
        const { generateGenome, ...tournamentInput } = input;
        const result = await runConceptTournament(tournamentInput, { generateGenome });
        await advanceContentRun(contentRunId, {
          stage: RUN_STAGE.planning,
          thesis: result.winner?.title ?? null,
          evidence: {
            at: new Date().toISOString(),
            what: result.genomeId
              ? `concept tournament completed; genome persisted as ${result.genomeId}`
              : "concept tournament completed",
            proof: result.genomeId ?? null,
          },
        });
        if (!result.genome) return { ...result, contentRunId, seeds: null };
        const { genomeToReelSeed, genomeToCarouselSeed, genomeToPhotoSeed } = await import("../../client/src/lib/creativeGenome");
        return {
          ...result,
          contentRunId,
          seeds: {
            reel: genomeToReelSeed(result.genome),
            carousel: genomeToCarouselSeed(result.genome),
            photo: genomeToPhotoSeed(result.genome),
          },
        };
      } catch (err) {
        await advanceContentRun(contentRunId, {
          stage: RUN_STAGE.failed,
          failureReason: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000),
          evidence: { at: new Date().toISOString(), what: "concept tournament failed" },
        });
        throw err;
      }
    }),

  /** Content experiment registry (0108) — operator start surface.
   *
   *  Assignment at enqueue and hook-arm resolution at generation have been
   *  wired since 0108, and the daily content-experiment-resolve cron records
   *  verdicts — but an experiment can only exist once STARTED, and starting
   *  one is deliberately an operator action: it changes what the autonomous
   *  reel lane generates (within already-authorized publishing). The preset
   *  is the one interventional test the pipeline already understands
   *  end-to-end: hook_style direct-vs-baseline, decided on shares_per_reach
   *  at the 72h horizon. Idempotent — re-starting re-asserts the same arms. */
  startContentExperiment: dbAdminProcedure
    .input(z.object({ preset: z.enum(EXPERIMENT_PRESET_IDS) }))
    .mutation(async ({ input }) => {
      // The definitions live in shared/contentExperiments.ts
      // (buildExperimentPreset) so this router and the generator read ONE
      // table. Only a WIRED preset starts: an exposed one gives both arms the
      // same content, so it would run an A/A test under a treatment's name and
      // could conclude a false tie or winner (2026-10-08).
      const def = buildExperimentPreset(input.preset);
      if (def.wiring !== "wired") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${def.preset} is not wired yet: nothing in generation applies its arm, so both arms would be the same content and the result would mean nothing. Wire the arm into generation first.`,
        });
      }
      // A pack-variant experiment builds only approved variant PAIRS; with none
      // approved every Reel would build the base pack and record nothing, so a
      // start would run an empty experiment that looks live (2026-10-08).
      if (def.primaryVariable === "pack_variant") {
        const { eligibleVariantPacks } = await import("../services/approvedReelPackRotation");
        const armIds = def.arms.map((a) => a.armId);
        if (eligibleVariantPacks(def.experimentId, armIds).length === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `${def.preset} has no approved variant pairs the daily lane can build: approve a variant for every arm (${armIds.join(", ")}) of at least one rotation pack the lane has not reached yet, in APPROVED_PACK_VARIANTS, first.`,
          });
        }
      }
      const { startExperiment } = await import("../services/contentExperimentStore");
      const ok = await startExperiment(def);
      if (!ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "experiment registry unavailable (no DB)" });
      return {
        started: def.experimentId,
        preset: def.preset,
        arms: def.arms.map((a) => a.armId),
        primaryMetric: def.primaryMetric,
        metricNote: def.metricNote,
        wiring: def.wiring,
      };
    }),

  /** Stop a running content experiment (2026-10-08). The lever the wiring
   *  gate assumed: the resolver now reports a running unwired experiment as
   *  "not wired, not judged (stop it)", and until this existed nothing but SQL
   *  could. A stopped experiment leaves assignment and judging at once. */
  stopContentExperiment: dbAdminProcedure
    .input(z.object({ experimentId: z.string().min(1).max(100), reason: z.string().min(1).max(500) }))
    .mutation(async ({ input }) => {
      const { stopExperiment } = await import("../services/contentExperimentStore");
      const stopped = await stopExperiment(input.experimentId, input.reason);
      if (!stopped) throw new TRPCError({ code: "NOT_FOUND", message: `no RUNNING experiment "${input.experimentId}" (unknown id, or already concluded/stopped)` });
      return { stopped: input.experimentId };
    }),

  /** Blind pairwise review (2026-10-08, services/pairwiseReview.ts): the next
   *  two judged photo posts the operator has not compared, with NO scores, and
   *  the running agreement between the operator's picks and the judge. Three
   *  states: a pair, verified nothing left to compare, or unreadable. */
  pairwiseNext: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return { available: false as const, pair: null, readout: null, reason: "no database" };
    try {
      const { loadPairCandidates, loadPickRecords, nextBlindPair, judgeAgreement } = await import("../services/pairwiseReview");
      const [candidates, picks] = await Promise.all([loadPairCandidates(d), loadPickRecords(d)]);
      const pair = nextBlindPair(candidates, new Set(picks.map((p) => p.key)));
      return { available: true as const, pair, readout: judgeAgreement(picks), candidates: candidates.length };
    } catch (err) {
      return { available: false as const, pair: null, readout: null, reason: err instanceof Error ? err.message.slice(0, 200) : String(err) };
    }
  }),

  /** Record one blind pick. The judge totals are re-read server-side. */
  pairwisePick: dbAdminProcedure
    .input(z.object({ aId: z.number().int().positive(), bId: z.number().int().positive(), pick: z.enum(["a", "b", "tie"]) }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "no database" });
      const { recordPairPick, PairPickError } = await import("../services/pairwiseReview");
      try {
        return await recordPairPick(d, { ...input, actor: ctx.user?.email ?? "admin" });
      } catch (err) {
        const code = err instanceof PairPickError && err.kind === "write_failed" ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST";
        throw new TRPCError({ code, message: err instanceof Error ? err.message : String(err) });
      }
    }),

  /** Shadow-judge disagreement readout (2026-08-06) — the reader the shadow
   *  lane (#1389) shipped without. Every autonomous post carries the
   *  independent tournament judge's verdict in evalScoresJson.shadowJudge;
   *  this surfaces self-eval vs judge so the gate-flip decision is made on
   *  an accumulated readout, not vibes. Zero rows is reported as zero — a
   *  quiet lane must be distinguishable from a missing reader. */
  shadowJudgeReadout: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return { total: 0, judged: 0, errors: 0, disagreements: [], rows: [] };
    const { igAutopostLog } = await import("../../drizzle/schema");
    const { desc, sql } = await import("drizzle-orm");
    const raw = await d.select({
      id: igAutopostLog.id,
      slot: igAutopostLog.slot,
      status: igAutopostLog.status,
      conceptKey: igAutopostLog.conceptKey,
      overallScore: igAutopostLog.overallScore,
      evalScoresJson: igAutopostLog.evalScoresJson,
      createdAt: igAutopostLog.createdAt,
    }).from(igAutopostLog)
      .where(sql`${igAutopostLog.evalScoresJson} LIKE '%shadowJudge%'`)
      .orderBy(desc(igAutopostLog.createdAt))
      .limit(200);
    const rows = (raw as Array<{ id: number; slot: string; status: string; conceptKey: string; overallScore: number | null; evalScoresJson: string | null; createdAt: Date }>)
      .map((r) => {
        let shadow: { total?: number; rejected?: boolean; note?: string; error?: string } = {};
        try {
          shadow = (JSON.parse(r.evalScoresJson ?? "{}") as { shadowJudge?: typeof shadow }).shadowJudge ?? {};
        } catch { shadow = { error: "unparseable evalScoresJson" }; }
        return {
          id: r.id, slot: r.slot, status: r.status, conceptKey: r.conceptKey,
          selfOverall: r.overallScore, judgeTotal: shadow.total ?? null,
          judgeRejected: shadow.rejected ?? null, judgeError: shadow.error ?? null,
          note: shadow.note ?? null, createdAt: r.createdAt,
        };
      });
    const judged = rows.filter((r) => r.judgeTotal != null);
    const disagreements = judged.filter((r) => (r.selfOverall ?? 0) >= 70 && ((r.judgeTotal ?? 100) < 60 || r.judgeRejected === true));
    return {
      total: rows.length,
      judged: judged.length,
      errors: rows.filter((r) => r.judgeError != null).length,
      disagreements,
      rows: rows.slice(0, 50),
    };
  }),

  /** Registry status: every experiment with assignment/published counts and
   *  the persisted verdict (refusals included — a refusal is a result). */
  contentExperimentStatus: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return { experiments: [] };
    const { contentExperiments, contentExperimentAssignments } = await import("../../drizzle/schema");
    const { sql, desc } = await import("drizzle-orm");
    const experiments = await d.select().from(contentExperiments)
      .orderBy(desc(contentExperiments.startedAt)).limit(20);
    const counts = await d.select({
      experimentId: contentExperimentAssignments.experimentId,
      assigned: sql<number>`count(*)`,
      published: sql<number>`count(${contentExperimentAssignments.mediaId})`,
    }).from(contentExperimentAssignments).groupBy(contentExperimentAssignments.experimentId);
    const countMap = new Map(
      (counts as Array<{ experimentId: string; assigned: unknown; published: unknown }>)
        .map((c) => [c.experimentId, { assigned: Number(c.assigned), published: Number(c.published) }] as const),
    );
    return {
      experiments: (experiments as Array<{
        experimentId: string; primaryVariable: string; objective: string; primaryMetric: string;
        status: string; startedAt: Date; concludedAt: Date | null;
        verdictStatus: string | null; verdictNote: string | null;
      }>).map((e) => ({
        experimentId: e.experimentId,
        primaryVariable: e.primaryVariable,
        objective: e.objective,
        primaryMetric: e.primaryMetric,
        status: e.status,
        startedAt: e.startedAt,
        concludedAt: e.concludedAt,
        verdictStatus: e.verdictStatus,
        verdictNote: e.verdictNote,
        counts: countMap.get(e.experimentId) ?? { assigned: 0, published: 0 },
      })),
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
    .input(z.object({ genome: z.unknown(), contentRunId: z.string().max(64).optional() }))
    .mutation(async ({ input, ctx }) => {
      const { creativeGenomeSchema } = await import("../../client/src/lib/creativeGenome");
      const genome = creativeGenomeSchema.parse(input.genome);
      const { createContentRun, advanceContentRun, RUN_STAGE } = await import("../services/contentRun");
      const contentRunId = input.contentRunId ?? await createContentRun({
        requestedBy: ctx.user?.email ?? null,
        requestSource: "operator",
        requestedTopic: genome.audienceMoment,
        requestedFormat: "reel",
      });
      if (!contentRunId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the canonical content run." });
      await advanceContentRun(contentRunId, {
        stage: RUN_STAGE.generating,
        chosenFormat: "reel",
        formatReason: "Genome Reel Director",
        objective: genome.objective,
        thesis: genome.mechanicTruth,
        evidence: { at: new Date().toISOString(), what: "Reel Director started from campaign genome" },
      });
      try {
        const { draftReelFromGenome } = await import("../services/reelDirector");
        const result = await draftReelFromGenome(genome);
        (result.brief as unknown as { contentRunId?: string }).contentRunId = contentRunId;
        await advanceContentRun(contentRunId, {
          stage: RUN_STAGE.generating,
          evidence: { at: new Date().toISOString(), what: "Reel Director produced a scored brief" },
        });
        return { ...result, contentRunId };
      } catch (err) {
        await advanceContentRun(contentRunId, {
          stage: RUN_STAGE.failed,
          failureReason: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000),
          evidence: { at: new Date().toISOString(), what: "Reel Director failed" },
        });
        throw err;
      }
    }),

  /** Genome Wave 2: Carousel Director — one campaign genome -> a full
   *  boost-scored CarouselBrief via the existing generator. Generation only;
   *  the client chains the result into saveCarouselDraft (Draft Board), where
   *  the existing render + publish paths take over. */
  draftCarouselFromGenome: adminProcedure
    .input(z.object({ genome: z.unknown(), contentRunId: z.string().max(64).optional() }))
    .mutation(async ({ input, ctx }) => {
      const { creativeGenomeSchema } = await import("../../client/src/lib/creativeGenome");
      const genome = creativeGenomeSchema.parse(input.genome);
      const { createContentRun, advanceContentRun, RUN_STAGE } = await import("../services/contentRun");
      const contentRunId = input.contentRunId ?? await createContentRun({
        requestedBy: ctx.user?.email ?? null,
        requestSource: "operator",
        requestedTopic: genome.audienceMoment,
        requestedFormat: "carousel",
      });
      if (!contentRunId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the canonical content run." });
      await advanceContentRun(contentRunId, {
        stage: RUN_STAGE.generating,
        chosenFormat: "carousel",
        formatReason: "Genome Carousel Director",
        objective: genome.objective,
        thesis: genome.mechanicTruth,
        evidence: { at: new Date().toISOString(), what: "Carousel Director started from campaign genome" },
      });
      try {
        const { draftCarouselFromGenome } = await import("../services/carouselDirector");
        const result = await draftCarouselFromGenome(genome);
        (result.brief as unknown as { contentRunId?: string }).contentRunId = contentRunId;
        await advanceContentRun(contentRunId, {
          stage: RUN_STAGE.generating,
          evidence: { at: new Date().toISOString(), what: "Carousel Director produced a scored brief" },
        });
        return { ...result, contentRunId };
      } catch (err) {
        await advanceContentRun(contentRunId, {
          stage: RUN_STAGE.failed,
          failureReason: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000),
          evidence: { at: new Date().toISOString(), what: "Carousel Director failed" },
        });
        throw err;
      }
    }),

  /** Genome Wave 1: generate ONE claim-safe campaign genome + the seeds that
   *  drive today's reel/carousel/photo flows from it. */
  generateCampaignGenome: dbAdminProcedure
    .input(z.object({
      campaignAsk: z.string().min(8).max(600),
      objective: z.string().max(32).optional(),
      proofHandles: z.array(z.string().max(200)).max(8).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { createContentRun, advanceContentRun, RUN_STAGE } = await import("../services/contentRun");
      const contentRunId = await createContentRun({
        requestedBy: ctx.user?.email ?? null,
        requestSource: "operator",
        requestedTopic: input.campaignAsk,
        requestedFormat: null,
      });
      if (!contentRunId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the canonical content run." });
      await advanceContentRun(contentRunId, {
        stage: RUN_STAGE.planning,
        objective: input.objective ?? null,
        evidence: { at: new Date().toISOString(), what: "direct campaign genome generation started" },
      });
      try {
        const { generateCampaignGenome } = await import("../services/genomeGen");
        const { genomeToReelSeed, genomeToCarouselSeed, genomeToPhotoSeed } = await import("../../client/src/lib/creativeGenome");
        const { genome, attempts } = await generateCampaignGenome(input);
        const { saveGenome } = await import("../services/creativeMemory");
        const saved = await saveGenome({ genome, campaignAsk: input.campaignAsk, source: "direct" });
        await advanceContentRun(contentRunId, {
          stage: RUN_STAGE.planning,
          objective: genome.objective,
          thesis: genome.mechanicTruth,
          evidence: {
            at: new Date().toISOString(),
            what: saved?.id ? `campaign genome persisted as ${saved.id}` : "campaign genome generated; persistence unavailable",
            proof: saved?.id ?? null,
          },
        });
        return {
          genome,
          genomeId: saved?.id ?? null,
          contentRunId,
          attempts,
          seeds: {
            reel: genomeToReelSeed(genome),
            carousel: genomeToCarouselSeed(genome),
            photo: genomeToPhotoSeed(genome),
          },
        };
      } catch (err) {
        await advanceContentRun(contentRunId, {
          stage: RUN_STAGE.failed,
          failureReason: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000),
          evidence: { at: new Date().toISOString(), what: "direct campaign genome generation failed" },
        });
        throw err;
      }
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

        const contentRunId = typeof input.brief?.contentRunId === "string" ? input.brief.contentRunId : null;
        if (contentRunId) {
          const { advanceContentRun, RUN_STAGE, IMPLEMENTATION_STATE } = await import("../services/contentRun");
          await advanceContentRun(contentRunId, {
            stage: RUN_STAGE.awaiting_approval,
            chosenFormat: "carousel",
            implementationState: IMPLEMENTATION_STATE.built,
            evidence: {
              at: new Date().toISOString(),
              what: `carousel draft ${input.id} persisted to the Draft Board`,
              proof: input.id,
            },
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
      // Tracked so an empty result can distinguish "nothing to show" from
      // "nothing could be read" — see the guard after both fetches.
      let dbFailed = false;
      let sheetFailed = false;
      try {
        const { getDb } = await import("../db");
        const { socialDrafts } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const d = await getDb();
        if (!d) dbFailed = true;
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
        dbFailed = true;
        log.warn("Failed to fetch Reel drafts from DB, continuing to sheet", dbErr);
      }

      // Fetch sheets drafts
      let sheetDrafts: any[] = [];
      try {
        const { fetchReelDraftsFromSheet } = await import("../sheets-sync");
        sheetDrafts = await fetchReelDraftsFromSheet();
      } catch (sheetErr) {
        sheetFailed = true;
        log.warn("fetchReelDraftsFromSheet failed", sheetErr);
      }

      /**
       * An empty list is only honest when we actually LOOKED.
       *
       * Both sources had their own catch and the function returned [] regardless,
       * so a database outage and a Google Sheets outage together rendered on the
       * Planning board as "No drafts found" — an outage presented as an editorial
       * fact. The operator's reasonable response to an empty board is to go make
       * something, which is the worst possible move while the drafts they already
       * have are merely unreadable.
       *
       * A PARTIAL failure still returns data, because one live source is real
       * information; only the case where nothing could be read at all throws.
       */
      if (dbFailed && sheetFailed) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not read drafts from either the database or the sheet — this is not an empty board.",
        });
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
      // The both-sources-failed throw above must ESCAPE. This catch would have
      // swallowed it and returned [] — a fix that fixes nothing, because the
      // screen still renders an outage as an empty board.
      if (err instanceof TRPCError) throw err;
      log.warn("allReelDrafts failed", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not read reel drafts — this is not an empty board.",
      });
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
  /**
   * Wave A1: route a campaign-package carousel into the CANONICAL inventory,
   * so it flows through the same needs_review → approve → publish gates as
   * every other draft instead of the copy/paste PublishDrawer. Additive: the
   * Draft Board keeps working; this is the sanctioned exit from it.
   * Idempotent per draft (stable id) — staging twice returns the same row.
   */
  stageCarouselToInventory: adminProcedure
    .input(z.object({ draftId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { socialDrafts, socialContentInventory } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — cannot stage (outage, not a refusal)." });

      const rows = await d.select().from(socialDrafts)
        .where(and(eq(socialDrafts.id, input.draftId), eq(socialDrafts.contentType, "carousel"))).limit(1);
      const row = rows[0];
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Carousel draft is not in the database — save it from the Draft Board first (sheet-only drafts must be saved before staging)." });
      }
      let brief: Record<string, unknown> = {};
      try { brief = JSON.parse(row.briefJson || "{}"); } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Draft briefJson is not valid JSON — repair the draft before staging." });
      }
      const slides = Array.isArray(brief.renderedSlideUrls)
        ? (brief.renderedSlideUrls as unknown[]).filter((u): u is string => typeof u === "string" && u.length > 0)
        : [];
      if (slides.length < 2) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `A carousel needs at least 2 RENDERED slides before staging (found ${slides.length}). Render slides on the Draft Board first.` });
      }
      const caption = String(brief.selectedCaption ?? "").trim();
      if (!caption) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Draft has no selected caption — pick one before staging." });
      }
      const hashtags = Array.isArray(brief.hashtags)
        ? (brief.hashtags as unknown[]).filter((t): t is string => typeof t === "string" && t.length > 0)
        : [];

      const inventoryId = `cp_${input.draftId}`.slice(0, 64);
      const existing = await d.select({ id: socialContentInventory.id }).from(socialContentInventory)
        .where(eq(socialContentInventory.id, inventoryId)).limit(1);
      if (existing.length) return { inventoryId, alreadyStaged: true };

      await d.insert(socialContentInventory).values({
        id: inventoryId,
        platform: "instagram",
        contentType: "carousel",
        // Campaign grouping rides the EXISTING column — insights can cohort
        // by campaign without a parallel content model.
        campaignId: String(brief.campaignKeyword ?? "").slice(0, 64) || null,
        topic: String(row.topic || brief.topic || "carousel").slice(0, 128),
        seriesName: "campaign_package",
        hookCategory: String(brief.campaignKeyword ?? "campaign").slice(0, 64),
        // hookText is what the queue shows AND what publishes — caption + tags
        // in the same composition the queue's captionWithHashtags mirrors.
        hookText: hashtags.length
          ? `${caption}\n\n${hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")}`
          : caption,
        bodyText: "",
        visualStyle: String(brief.creativeTerritory ?? "campaign").slice(0, 64),
        persona: "nick",
        // "pending" maps to needs_review in the queue — nothing publishes
        // without an operator approval, same as every other lane.
        status: "pending",
        assetPaths: slides,
        briefJson: JSON.stringify({
          source: "campaign_package",
          carouselDraftId: input.draftId,
          topic: row.topic,
          selectedCaption: caption,
          hashtags,
          creativeTerritory: brief.creativeTerritory ?? null,
          renderedSlideUrls: slides,
          stagedAt: new Date().toISOString(),
        }),
      });
      return { inventoryId, alreadyStaged: false };
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
      // Meta's own carousel bound, which postInstagramCarousel already enforces
      // at the Graph call ("Carousel needs 2-10 images"). Stating it at the
      // boundary turns a round-trip failure into a validation error, and makes
      // the publishToSocial routing below unambiguous (>=2 images = carousel).
      imageUrls: z.array(z.string()).min(2).max(10),
      caption: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { getMetaSocialStatus } = await import("../services/metaSocial");
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
            // This used to say "flip the legacy_autopost_live feature flag ON
            // and configure Meta API credentials". This procedure never reads
            // that flag — credentials alone decide sandbox vs live — so the
            // note pointed the operator at a switch that does nothing here and
            // implied a second condition guarding the live path. There wasn't
            // one. Now there is: publishToSocial's kill switch.
            `💡 <i>Sandbox because Meta API credentials are not configured. Once they are, this posts LIVE — subject to the publishing kill switch and content governor.</i>`,
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
        // LIVE branch. This used to call postInstagramCarousel DIRECTLY, which
        // walked straight past every gate the shared publish door enforces:
        //   1. the autonomy kill switches (global / publishing / instagram)
        //      plus the DENY audit record,
        //   2. the content governor (daily caps + spacing against actually
        //      published inventory),
        //   3. claim-safety on the caption.
        // Eight publish call sites gate on captionClaimBlockers; this was the
        // one that did not. The control is three procedures below: publishReel
        // had the identical shape and was routed through publishToSocial for
        // exactly these reasons.
        const { captionClaimBlockers, assertPermanentPublicMediaUrl, publishToSocial } =
          await import("../services/socialPublish");
        const blockers = captionClaimBlockers(input.caption);
        if (blockers.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Caption blocked by claim-safety: ${blockers.map((b) => b.rule).join(", ")}`,
          });
        }
        // A presigned URL publishes fine and then 404s when the signature
        // expires, leaving a live post with dead panels.
        for (const url of input.imageUrls) assertPermanentPublicMediaUrl(url);

        const { results } = await publishToSocial({
          platforms: ["instagram"],
          caption: input.caption,
          imageUrls: input.imageUrls,
        });
        const ig = results.find((r) => r.platform === "instagram");
        // `ambiguous` means media_publish LEFT and no answer came back — the
        // carousel MAY be live. Reporting that as a plain failure invites a
        // retry, and the retry duplicates a live post. postInstagramCarousel
        // has always been able to return this; the old code dropped the flag.
        if (ig?.ambiguous) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The publish call timed out AFTER it was sent — the carousel MAY BE LIVE. Check the Instagram account before retrying; retrying now can duplicate it.",
          });
        }
        return { success: !!ig?.success, postId: ig?.postId, error: ig?.error, isSandbox: false };
      } catch (err) {
        // A deliberate refusal must not be relabelled a server fault. Without
        // this, the claim-safety BAD_REQUEST above surfaces as a 500 and reads
        // as "Meta is down, retry" instead of "this caption is not publishable".
        if (err instanceof TRPCError) throw err;
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
            // Also named legacy_autopost_live, which this procedure does not
            // read either. The reel live path is gated on two REAL switches;
            // name those instead so the operator can find them.
            `💡 <i>Sandbox because Meta API credentials are not configured. The live path additionally requires REEL_LEGACY_PUBLISH_ENABLED=true and REEL_PUBLISH_ENABLED=true.</i>`,
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
        // Same wart as publishCarousel: this swallowed the FORBIDDEN raised by
        // the legacy-publisher gate below and re-reported it as a 500.
        if (err instanceof TRPCError) throw err;
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
        contentRunId: z.string().max(64).nullable().optional(),
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
        // Authored DUA concept. zod strips unknown keys, so without this the
        // field is dropped at the transport boundary and the FULL gate branch in
        // runReelPreflight is unreachable on this route: invented measurements,
        // layer/disclosure violations and franchise conditions all disappear
        // while relevance silently degrades to an advisory warning. Same defect
        // class as the visualWorld and genomeId strips above.
        dua: z.object({
          id: z.string().max(200),
          franchiseId: z.string().max(80).optional(),
          absurdityType: z.string().max(80),
          absurdityLevel: z.number().int().min(0).max(5),
          levelOptIn: z.boolean().optional(),
          subject: z.string().max(40),
          violation: z.string().max(2000),
          benignResolution: z.string().max(2000),
          usefulFact: z.string().max(2000),
          factSources: z.array(z.string().max(400)).readonly(),
          factSourceTypes: z.array(z.string().max(60)).readonly().optional(),
          brandConnection: z.string().max(2000),
          audienceParticipation: z.string().max(2000),
          visualMetaphor: z.string().max(2000),
          audioMetaphor: z.string().max(2000),
          payoff: z.string().max(2000),
          disclosureMode: z.string().max(60).optional(),
          roles: z.array(z.string().max(60)).readonly().optional(),
          assets: z.array(z.object({
            id: z.string().max(200),
            layer: z.string().max(40),
            origin: z.string().max(40),
            description: z.string().max(1000),
          })).readonly().optional(),
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
          // Was z.literal("not_evaluated") — a real verdict would have been
          // rejected by the very schema meant to carry it.
          entailment: z.enum(["supported", "partially_supported", "contradicted", "not_supported", "not_evaluated"]),
          entailmentReasons: z.array(z.string()).optional(),
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

      // SCORE AGAINST WHAT WE HAVE ALREADY MADE.
      // calculateReelQualityScore's distinctiveness part scores ZERO without
      // this context, deliberately - a brief certified "distinct" by a scorer
      // that never saw a sibling is how 166 near-identical packs all cleared
      // 70/75. getRecentReelSignals reports available:false on a DB fault
      // rather than throwing; an empty window legitimately means "nothing
      // recent to repeat", which is the same answer a healthy new account gives.
      const { getRecentReelSignals } = await import("../services/reelRepetitionHistory");
      const recent = await getRecentReelSignals();
      const { calculateReelQualityScore } = await import("../../client/src/lib/facelessReelStudio");
      const score = calculateReelQualityScore(brief as any, undefined, { recent });
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
        // Must survive the whitelist for the same reason it must survive zod:
        // stripping it here makes the authored DUA gate unreachable downstream.
        dua: (brief as any).dua,
        // Campaign lineage + approved visual world MUST survive the whitelist:
        // omitting them here silently stripped genomeId (review P2) and the
        // hero-frame URL before inventory + reel_jobs persistence.
        genomeId: (brief as any).genomeId ?? null,
        contentRunId: (brief as any).contentRunId ?? null,
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
        ({ jobId } = await enqueueReelJob(briefWithId, "admin", {
          objective: "DISCOVERY",
          disclosureMode: "visibly_animated",
          ctaType: (briefWithId as { ctaType?: "SEND" | "SAVE" | "COMMENT" | "VISIT" | "FOLLOW" | "NONE" }).ctaType ?? "NONE",
        }));
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
      if (row.status === "failed" || row.status === "needs_regen") {
        // 2026-08-20 · Higgsfield stock-fallback remediation self-audit
        // (workflow-confirmed P1): needs_regen is a new terminal status this
        // job can land in — without this branch it fell through to the
        // "queued" default, so the Studio wizard's polling never terminated
        // and the operator never saw the provider-down error. It maps onto
        // the client's existing "failed" bucket (row.error is populated the
        // same way for both) rather than growing a new client-facing state.
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
      // The Studio sends its source detail (up to 1000 chars, see sourceDetail
      // below) as the topic steer. A hard max(300) refused every long detail
      // before generation ran (NICKSTIRE-A, 2026-09-30). The full text still
      // reaches the generator via sourceDetail; the steer is capped, not refused.
      topic: z.string().max(1000).optional().transform((t) => (t === undefined ? t : t.trim().slice(0, 300))),
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
        const { scoreReelBriefWithMemory } = await import("../services/reelQualityScore");
        const { brief } = await generateReelBriefAI(input);
        // Scored WITH the recent-reel history: without it the distinctiveness
        // part reports "not checked" and costs its points anyway, so this lane
        // silently required a perfect score everywhere else.
        const qualityScore = await scoreReelBriefWithMemory(brief);
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
   *  enforceable server-side rather than advisory client-only.
   *
   *  Reads the recent-reel history (one SELECT, no writes) so this returns the
   *  SAME verdict as the enqueue path. It used to score without that context,
   *  which made the "server-authoritative" gate disagree with the gate that
   *  actually admits a brief — the authoritative answer was the less informed
   *  one. Still no generation, storage or posting. */
  validateReelBrief: adminProcedure
    .input(z.object({ brief: reelBriefScoreInput }))
    .mutation(async ({ input }) => {
      const { buildHiggsfieldReelPromptPack } = await import("../../client/src/lib/facelessReelStudio");
      const { scoreReelBriefWithMemory } = await import("../services/reelQualityScore");
      const brief = input.brief as unknown as ReelBrief;
      const promptPack = buildHiggsfieldReelPromptPack(brief);
      brief.promptPack = promptPack;
      brief.higgsfieldPromptPack = promptPack;
      const qualityScore = await scoreReelBriefWithMemory(brief);
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
      const { enqueueReelJob, processNextReelJob, processNextAssemblyJob, REEL_GENERATION_TERMINAL_STATUSES } = await import("../services/reelPipeline");
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
        const { jobId } = await enqueueReelJob(bestBrief, "admin", {
          objective: "DISCOVERY",
          disclosureMode: "visibly_animated",
          ctaType: (bestBrief as { ctaType?: "SEND" | "SAVE" | "COMMENT" | "VISIT" | "FOLLOW" | "NONE" }).ctaType ?? "NONE",
        });
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
            } else if (res.status && REEL_GENERATION_TERMINAL_STATUSES.has(res.status)) {
              // 2026-08-20 · Higgsfield stock-fallback remediation. Before this,
              // a terminal paid-provider failure landed here as "needs_regen" —
              // a status this loop did not recognize as terminal. It matched
              // neither branch above NOR `!res.processed` (a needs_regen result
              // has processed:true), so the loop looped again with no sleep; the
              // job is no longer "queued" so every subsequent attempt returned
              // processed:false, silently burning the remaining attempts on 2s
              // sleeps before falling through with lastError still "" — the
              // REAL reason (e.g. "preflight: higgsfield session dead — ...")
              // was lost, and the operator saw a blank
              // "Reel clip generation failed or timed out: " error.
              lastError = res.error || `${res.status} status`;
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
          // ── HUMAN CONSENT + AI DISCLOSURE (2026-09-07) ──
          //
          // This path publishes to the SAME live Instagram account as the
          // autonomous cron, and it had NO approval gate, no claim audit, no
          // originality check — and it passed no `isAiGenerated`, so
          // metaSocial omitted the `is_ai_generated` field entirely and posted
          // AI-generated video to a live audience UNDISCLOSED. "Live test" is a
          // description of intent, not a different audience: the followers are
          // real and the post is real.
          //
          // Consent first, and it is not overridable here for the same reason
          // it is not overridable on the canary route.
          const testCaption = finalJob.caption || bestBrief.selectedCaption || "";
          const { reelApprovalProblem } = await import("../services/reelApproval");
          const approvalProblem = await reelApprovalProblem({
            jobId,
            caption: testCaption,
            videoUrl: finalJob.mp4Url,
          });
          if (approvalProblem) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `Refusing to publish: no live human approval for this exact caption and asset [${approvalProblem.code}] ${approvalProblem.reason}. Approve the job first, or run with dryRun.`,
            });
          }

          // Disclosure derives from the STORED CLIP PATHS, not from a caller
          // flag — the same provider-independent derivation the cron uses, so
          // this door cannot post undisclosed by omission.
          const { shouldDiscloseAi } = await import("@shared/reelDisclosure");
          const isAiGenerated = shouldDiscloseAi(finalJob.clipUrlsJson, testCaption);

          log.info(`Publishing to Instagram: ${finalJob.mp4Url}`);
          pubResult = await publishToSocial({
            platforms: ["instagram"],
            videoUrl: finalJob.mp4Url,
            caption: testCaption,
            isAiGenerated,
          });
          if (pubResult.igPostId) {
            permalink = await getInstagramPermalink(pubResult.igPostId);
            await db.update(reelJobs)
              .set({ status: "posted", queueState: queueStateForReelStatus("posted"), igPostId: pubResult.igPostId })
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
  /**
   * The door for a finished mp4 — MoneyPrinter output, a hand-edited cut,
   * anything produced outside the reel pipeline.
   *
   * ingestFinishedMp4 shipped with twelve tests and ZERO importers: grep found
   * it referenced only by its own spec. BUILT-TESTED-UNWIRED is a repeat
   * pattern in this repo and it is registered as a P2 on the mp4-ingest
   * capability, so this is the missing half, not a new feature — the service
   * already enforces the flag, the ftyp header check, the presigned-URL
   * refusal and the linked-draft guarantee.
   *
   * NOT on socialPipeline, which registers MP4_INGEST_ENABLED but declares
   * itself READ-ONLY in its own header ("It never writes, posts, or mutates").
   * It lives beside listInventory / actOnInventoryItem because what it produces
   * is an inventory row those two already manage.
   *
   * The errors are deliberately passed through verbatim. Every one of them
   * names a specific refusal the operator can act on — the flag is off, that is
   * not an mp4, that URL expires — and flattening them into "ingest failed"
   * would turn a legible gate into a mystery.
   */
  ingestFinishedMp4: adminProcedure
    .input(z.object({
      source: z.string().min(1).max(2048),
      topic: z.string().min(1).max(128),
      caption: z.string().min(1).max(2200),
      bodyText: z.string().max(2200).optional(),
      origin: z.string().min(1).max(40).default("manual"),
    }))
    .mutation(async ({ input }) => {
      const { ingestFinishedMp4 } = await import("../services/mp4Ingest");
      try {
        return await ingestFinishedMp4(input);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "mp4 ingest failed",
        });
      }
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

  /**
   * The Action Center's "Publish" wire (2026-07-25). "Publish through the
   * normal gates" was structurally impossible for canary/autopost reels: the
   * assembly writeback UPDATE matched zero inventory rows (no draft ever
   * existed for those briefIds), so the gate was empty and the button dead.
   * This reconciles an assembled job with the gate:
   *  - draft missing         → CREATE it (review_ready) so approve → publish works
   *  - draft already published → mark the JOB published (closes ghost cards
   *    whose content went out through the queue long ago)
   *  - draft mid-flow        → nothing to do; it is already in Publish → Reels
   * Ambiguous jobs are refused — resolving a may-be-live publish comes first,
   * or staging would arm a duplicate of a possibly-live reel.
   */
  reconcileAssembledReel: adminProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { reelJobs } = await import("../../drizzle/schema");
      const rows = await d.select().from(reelJobs).where(eq(reelJobs.id, input.jobId)).limit(1);
      const job = rows[0];
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: `Reel job ${input.jobId} not found.` });
      if (job.status !== "assembled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Only assembled jobs can be staged for publish (this one is ${job.status}). An ambiguous publish must be resolved first — staging it would arm a duplicate of a possibly-live reel.`,
        });
      }
      if (!job.mp4Url) throw new TRPCError({ code: "BAD_REQUEST", message: "This job has no rendered master to stage." });
      if (!job.briefId || job.briefId === "unknown") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This job carries no brief id, so it cannot be linked to a draft." });
      }

      const existing = await d.select({ status: socialContentInventory.status })
        .from(socialContentInventory).where(eq(socialContentInventory.id, job.briefId)).limit(1);

      if (existing[0]) {
        if (["published", "published_partial"].includes(existing[0].status)) {
          // The content already went out through the queue; only the job row
          // never heard. Close the ghost — CAS on status so a concurrent
          // change is never overwritten.
          await d.update(reelJobs).set({ status: "published", queueState: queueStateForReelStatus("published"), updatedAt: new Date() })
            .where(and(eq(reelJobs.id, input.jobId), eq(reelJobs.status, "assembled")));
          return { outcome: "job_marked_published" as const, draftId: job.briefId };
        }
        return { outcome: "already_staged" as const, draftId: job.briefId, draftStatus: existing[0].status };
      }

      let brief: Record<string, unknown> = {};
      try {
        const payload = JSON.parse(job.payload ?? "{}");
        brief = (payload?.brief && typeof payload.brief === "object" ? payload.brief : payload) as Record<string, unknown>;
      } catch { /* stage with minimal fields — the master is the substance */ }

      const { ensureReelDraftForJob } = await import("../services/reelInventoryLink");
      await ensureReelDraftForJob(d, { briefId: job.briefId, mp4Url: job.mp4Url, brief });
      return { outcome: "staged" as const, draftId: job.briefId };
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

      let ctx: { jobId?: number | null; caption?: string | null } = {};
      try { ctx = JSON.parse(attempt.contextJson ?? "{}"); } catch { /* timing-only match */ }
      const jobId = input.jobId ?? ctx.jobId ?? null;

      // The attempt row is authoritative: it stores what was actually dispatched,
      // including scheduled posts that have no reelJobs row.
      let expectedCaption: string | null = typeof ctx.caption === "string" ? ctx.caption : null;
      if (!expectedCaption && jobId) {
        const [job] = await d.select().from(reelJobs).where(eq(reelJobs.id, Number(jobId))).limit(1);
        if (job?.payload) {
          try { expectedCaption = (JSON.parse(job.payload) as { selectedCaption?: string }).selectedCaption ?? null; } catch { /* fall back to timing */ }
        }
      }

      const { findUnreconciledAttempts } = await import("../services/publishAttemptLedger");
      const open = await findUnreconciledAttempts(0);
      const durable = open.find((a) => a.attemptId === input.attemptId);
      if (durable?.operatorRequired) {
        return {
          status: "needs_operator" as const,
          candidates: durable.handoffCandidates,
          detail: durable.handoffDetail ?? "Automation exhausted safe evidence; use the preserved handoff evidence.",
          jobId,
          attemptId: input.attemptId,
        };
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
      // 2026-08-20 · Higgsfield stock-fallback remediation self-audit
      // (workflow-confirmed P0): needs_regen never published and is never
      // live — it belongs here for the same reason "failed" does. Without
      // it, the Action Center's Discard/Archive buttons (legitimately
      // offered by classifyRecoverability for a needs_regen job) matched
      // zero rows and threw the misleading "already published, or it may be
      // live" error for a job that was neither.
      const CLOSEABLE = ["assembled", "queued", "generating", "assets_ready", "assembling", "repair_rendering", "failed", "needs_regen"];
      const res = await d
        .update(reelJobs)
        .set({ status: "failed", queueState: queueStateForReelStatus("failed"), error: `${input.mode === "archive" ? "archived" : "discarded"} by operator: ${input.reason}`.slice(0, 500) })
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
    if (!d) return { heldReels: 0, openPublishes: 0, total: 0, unknown: true, videoProviderBlocked: null as number | null };

    let heldReels = 0;
    let openPublishes = 0;
    let unknown = false;

    try {
      const { reelJobs } = await import("../../drizzle/schema");
      const { sql } = await import("drizzle-orm");
      // ONE predicate, shared with the detail list. This clause used to be
      // hand-copied here, which is how the badge and the list drifted apart
      // before — same idea, two implementations, two different answers.
      const { buildAttentionPredicate } = await import("../services/reelRecoverability");
      const [row] = await d
        .select({ n: sql<number>`COUNT(*)`.as("n") })
        .from(reelJobs)
        .where(await buildAttentionPredicate());
      heldReels = Number(row?.n ?? 0);
    } catch (err) {
      log.warn("operationsSignal: could not count held reels", err);
      unknown = true;
    }

    // Kept so the overlap can be removed from the total below. A job sitting in
    // `publishing` is in ATTENTION_STATUSES *and* has an unreconciled attempt, so
    // summing the two counts blind reports one problem as two and inflates the
    // badge — the operator taps expecting two things to fix and finds one.
    let overlappingJobIds = new Set<number>();
    try {
      const { findUnreconciledAttempts } = await import("../services/publishAttemptLedger");
      const attempts = await findUnreconciledAttempts(15);
      openPublishes = attempts.length;
      overlappingJobIds = new Set(
        attempts.map((a: { jobId?: number | null }) => a.jobId).filter((id): id is number => typeof id === "number"),
      );
    } catch (err) {
      log.warn("operationsSignal: could not count open publish attempts", err);
      unknown = true;
    }

    // Only subtract when BOTH counts are real. If either failed, the overlap is
    // itself unknown and a "correction" would be arithmetic on a guess.
    const overlap = unknown ? 0 : Math.min(overlappingJobIds.size, heldReels, openPublishes);

    // Is the provider that would actually render even credentialed?
    //
    // Rides this already-polled query on purpose — no new poll, and it lands on
    // Today, which is where the operator starts. On 2026-08-03 prod had
    // REEL_VIDEO_PROVIDER pinned to higgsfield with generation, autopost and
    // publish all enabled while that session had been expired since 07-31. Every
    // count on this screen was correct and none of them could say that the thing
    // producing reels could not run.
    //
    // Counts PROBLEMS, not health: exceptionFeed drops `count === 0`, so 0 means
    // "nothing to report" and disappears, while 1 surfaces. Encoding it the other
    // way round ("1 = online") would make a healthy pipeline a permanent alarm.
    //
    // Presence FIRST, then liveness where liveness is knowable. Presence alone is
    // not enough for Higgsfield: getHiggsfieldCredentialsJson returns the stored
    // blob without parsing it, so the session that expired on 2026-07-31 kept
    // reading as configured while every render died at the CLI.
    //
    // Liveness comes from the keepalive's durable verdict in cron_log, not a
    // fresh CLI spawn — this runs on a display path polled every 60s. null =
    // could not determine, which reading() maps to `unknown` rather than a false
    // all-clear.
    let videoProviderBlocked: number | null = null;
    try {
      const { selectReelVideoProvider, reelProviderCredentialsPresent } = await import("../services/reelPipeline");
      const provider = await selectReelVideoProvider();
      if (!(await reelProviderCredentialsPresent(provider))) {
        videoProviderBlocked = 1;
      } else if (provider === "higgsfield") {
        const { higgsfieldSessionHealth } = await import("../services/higgsfieldStudio");
        const { healthy } = await higgsfieldSessionHealth();
        // healthy === null stays null: "the keepalive cannot vouch for this" is
        // an unknown, not a pass and not a failure.
        videoProviderBlocked = healthy === null ? null : healthy ? 0 : 1;
      } else {
        // Veo has no equivalent session to expire; presence is the whole answer.
        videoProviderBlocked = 0;
      }
    } catch {
      videoProviderBlocked = null;
    }

    return {
      heldReels,
      openPublishes,
      total: heldReels + openPublishes - overlap,
      unknown,
      videoProviderBlocked,
    };
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

      // ALLOWLIST, not denylist. The old guard named three unsafe statuses and let
      // everything else through, which permitted regenerating a job that was
      // mid-render: the operator paid twice, and the "closed" job kept running,
      // wrote itself back to assets_ready -> assembled, and got published by the
      // daily cron from under the supersede. See REGENERABLE_STATUSES.
      const { REGENERABLE_STATUSES, isRegenerable } = await import("../services/reelRecoverability");
      if (!isRegenerable(job.status)) {
        const mayBeLive = job.status === "publishing" || job.status === "publish_ambiguous" || job.status === "posted";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: mayBeLive
            ? "This job has published or may be live. Reconcile it before regenerating, or you risk posting the same reel twice."
            : `This job is still in flight (${job.status}). Regenerating now would pay for a second render of the same brief while the first keeps running — and the running one cannot be cancelled. Wait for it to finish or fail, then regenerate.`,
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

      /**
       * A brief describes WHAT TO MAKE. Everything a previous run accumulated
       * while trying to make it is execution state, and carrying it into a fresh
       * paid job is not a copy — it is a corruption.
       *
       * Each of these was measured to cause a specific harm:
       *   renderedQa / audioQa      stale verdicts about media that no longer
       *                             exists, read as judgements of the NEW render
       *   repairQueue               qualityGate.ts:121 counts its length as the
       *                             job's repair attempts, so a brand-new job is
       *                             born already at its repair cap
       *   mp4History                selectiveRepair's record of supplanted
       *                             renders belonging to a different job
       *   contentReservationId      the OLD job's reservation. reelPipeline.ts:200
       *                             only overwrites it when a new reservation is
       *                             taken, so otherwise this job would later
       *                             RELEASE a reservation it does not own
       *                             (reelPipeline.ts:296-300)
       *
       * Listed explicitly rather than whitelisted because the brief's own field
       * set is open — a new creative field must reach the new job by default, and
       * a new piece of execution state must be added here deliberately.
       */
      for (const stale of ["renderedQa", "audioQa", "repairQueue", "mp4History", "contentReservationId"]) {
        delete (brief as Record<string, unknown>)[stale];
      }
      // 2026-08-20 · Higgsfield stock-fallback remediation self-audit
      // (workflow-confirmed P0): a stale per-beat veoOperationName is
      // execution state too, and this path was never guarded against it —
      // this codebase already found and fixed the identical defect for the
      // (now-removed) forced free-lane rescue (docs/NICKSTIRE-SCAN-LEDGER.md
      // lines 210-219): the new job's clipUrlsJson starts empty, so EVERY
      // beat is reprocessed, including the one carrying the old handle,
      // which takes the "resuming" branch instead of submitting fresh. If
      // that stale/expired handle then local-times-out, the outer catch
      // sees hasRemoteOperationId=true and classifies it as
      // LOCAL_TIMEOUT_REMOTE_RUNNING -> RESUME_OPERATION, which never
      // consumes an attempt — the job can cycle queued<->generating forever,
      // never reach a terminal status, and its generation-ledger reservation
      // never settles.
      for (const beat of beats) {
        if (beat && typeof beat === "object") delete (beat as Record<string, unknown>).veoOperationName;
      }

      // Regeneration is a new paid episode, even when it preserves the old
      // creative brief. Do not let the approved-pack identity or the old brief
      // id collapse it into the original unique episode row.
      const { randomUUID } = await import("crypto");
      const regeneratedEpisodeId = `regen_${input.jobId}_${randomUUID()}`;
      brief.id = regeneratedEpisodeId;
      const preservedPack = (brief as { approvedProductionPack?: import("@shared/episodeContract").ApprovedProductionPackSnapshot; episodeContract?: { productionPack?: import("@shared/episodeContract").ApprovedProductionPackSnapshot } }).approvedProductionPack
        ?? (brief as { episodeContract?: { productionPack?: import("@shared/episodeContract").ApprovedProductionPackSnapshot } }).episodeContract?.productionPack;
      const priorSlot = (brief as { productionSlot?: string; episodeContract?: { productionSlot?: string } }).productionSlot
        ?? (brief as { episodeContract?: { productionSlot?: string } }).episodeContract?.productionSlot;
      const productionSlot = priorSlot === "morning" || priorSlot === "midday" || priorSlot === "evening" ? priorSlot : undefined;

      const { enqueueReelJob } = await import("../services/reelPipeline");
      const { withOperatorAction } = await import("../services/operatorActionLog");
      // The two typed refusals, so the classifier below can test identity
      // instead of parsing prose.
      const { AutonomyDenial } = await import("../services/autonomyControl");
      const { GovernorDenial } = await import("../services/contentGovernor");
      const { jobId: newJobId } = await withOperatorAction(
        { action: "regenerate", operatorId: ctx.user?.id ?? null, jobId: input.jobId, costsMoney: true },
        () => enqueueReelJob(brief as never, "admin", {
          objective: "DISCOVERY",
          disclosureMode: "visibly_animated",
          ctaType: (brief as { ctaType?: "SEND" | "SAVE" | "COMMENT" | "VISIT" | "FOLLOW" | "NONE" }).ctaType ?? "NONE",
          episodeId: regeneratedEpisodeId,
          ...(productionSlot ? { productionSlot } : {}),
          ...(preservedPack ? { approvedProductionPack: preservedPack } : {}),
        }),
        {
          /**
           * The system REFUSING is not the system breaking, and this is the
           * most important refusal to classify correctly: it is how "we keep
           * hitting the daily cap" becomes visible instead of looking like a
           * broken regenerate button.
           *
           * TYPES FIRST, TEXT ONLY WHERE NO TYPE EXISTS YET. The previous
           * version was a pure message regex, and it matched none of the words
           * in "Blocked by autonomy policy v3: kill_switch_all" — so every
           * kill-switch and operating-mode denial was logged as a FAILURE. That
           * is precisely the defect #914 removed from operatorActionLog, having
           * come back through a different door.
           *
           * The two remaining string tests are for throws that genuinely have
           * no type yet (reelPipeline.ts:141 preflight, :268 budget); they are
           * anchored to their literal prefixes rather than to loose words like
           * "cap", which would also match an unrelated "capacity" error.
           */
          isRefusal: (err) => {
            if (err instanceof AutonomyDenial || err instanceof GovernorDenial) return true;
            if (!(err instanceof Error)) return false;
            return err.message.startsWith("Reel preflight blocked")
              || err.message.startsWith("BUDGET_DAILY_EXCEEDED");
          },
        },
      );

      // Close the old one so it stops appearing as work. Best-effort: the new job
      // already exists and the spend is committed, so a failure here must not
      // surface as "regeneration failed".
      try {
        // The SAME allowlist the entry guard used. The old close list included
        // queued/generating/assembling/repair_rendering — statuses this mutation
        // can no longer be reached with, and which it could not have closed
        // anyway: marking a row `failed` does not stop the worker holding it.
        const res = await d.update(reelJobs)
          .set({ status: "failed", queueState: queueStateForReelStatus("failed"), error: `superseded by regenerated job ${newJobId} (operator ${ctx.user?.id ?? "?"})`.slice(0, 500) })
          .where(and(eq(reelJobs.id, input.jobId), inArray(reelJobs.status, [...REGENERABLE_STATUSES])));
        if (affectedRowCount(res) !== 1) log.warn("regenerate: old job not closed (state changed under us)", { jobId: input.jobId });
      } catch (err) {
        log.warn("regenerate: could not close the superseded job", err);
      }

      // Closing a job by hand skipped the release the pipeline does on its own
      // failures (reelPipeline.ts:648, :713), so every regenerate stranded the old
      // job's content reservation — the topic stayed locked against a job that
      // will never run again. Best-effort and last: the new job already exists.
      try {
        const { releaseFailedJobReservation } = await import("../services/reelPipeline");
        await releaseFailedJobReservation(job.payload, job.id);
      } catch (err) {
        log.warn("regenerate: could not release the superseded job's reservation", err);
      }

      return { ok: true, supersededJobId: input.jobId, newJobId };
    }),
  /** What happened to one request, start to finish — the run's own story. */
  getContentRun: dbAdminProcedure
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
      // Not `{ runs: [] }`. An unreachable database is not a shop that has never
      // asked for anything — and now that this has a screen, that difference is
      // the one the operator would actually read.
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available — the run trail is unknown, not empty." });
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
  /**
   * Queue entries whose reel job is dead but which still say "awaiting review".
   * READ-ONLY — reports what would change and why. Applying is a separate tap,
   * because mass-updating production rows is a data change, not a side effect of
   * opening a screen.
   */
  queueTruthReport: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    const { socialContentInventory, reelJobs } = await import("../../drizzle/schema");
    const { eq, inArray, sql } = await import("drizzle-orm");

    const rows = await d
      .select({
        inventoryId: socialContentInventory.id,
        inventoryStatus: socialContentInventory.status,
        jobId: reelJobs.id,
        jobStatus: reelJobs.status,
        jobError: reelJobs.error,
        assetPaths: socialContentInventory.assetPaths,
      })
      .from(socialContentInventory)
      .leftJoin(reelJobs, eq(reelJobs.briefId, socialContentInventory.id))
      .where(inArray(socialContentInventory.status, ["pending", "needs_review"]))
      .limit(500);

    const { planInventoryReconcile } = await import("../services/inventoryJobReconcile");
    return planInventoryReconcile(rows.map((r: typeof rows[number]) => ({
      inventoryId: r.inventoryId,
      inventoryStatus: r.inventoryStatus,
      jobId: r.jobId ?? null,
      jobStatus: r.jobStatus ?? null,
      jobError: r.jobError ?? null,
      hasRenderedAsset: Array.isArray(r.assetPaths) ? r.assetPaths.length > 0 : Boolean(r.assetPaths),
    })));
  }),

  /** Apply the report. Operator-triggered, and it re-plans rather than trusting
   *  ids the client sent — the queue may have moved since the report was read. */
  applyQueueTruth: adminProcedure
    .input(z.object({ confirm: z.literal(true) }))
    .mutation(async ({ ctx }) => {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { socialContentInventory, reelJobs } = await import("../../drizzle/schema");
      const { eq, inArray, and } = await import("drizzle-orm");
      const { affectedRowCount } = await import("../lib/db-affected");
      const { planInventoryReconcile } = await import("../services/inventoryJobReconcile");
      const { recordOperatorAction, ACTION_OUTCOME } = await import("../services/operatorActionLog");

      const rows = await d
        .select({
          inventoryId: socialContentInventory.id, inventoryStatus: socialContentInventory.status,
          jobId: reelJobs.id, jobStatus: reelJobs.status, jobError: reelJobs.error,
          assetPaths: socialContentInventory.assetPaths,
        })
        .from(socialContentInventory)
        .leftJoin(reelJobs, eq(reelJobs.briefId, socialContentInventory.id))
        .where(inArray(socialContentInventory.status, ["pending", "needs_review"]))
        .limit(500);

      const plan = planInventoryReconcile(rows.map((r: typeof rows[number]) => ({
        inventoryId: r.inventoryId, inventoryStatus: r.inventoryStatus,
        jobId: r.jobId ?? null, jobStatus: r.jobStatus ?? null, jobError: r.jobError ?? null,
        hasRenderedAsset: Array.isArray(r.assetPaths) ? r.assetPaths.length > 0 : Boolean(r.assetPaths),
      })));

      let updated = 0;
      for (const row of plan.rows) {
        // Guarded on the status we planned against — if the row moved, skip it
        // rather than overwrite a decision someone else made.
        const res = await d.update(socialContentInventory)
          .set({
            status: "failed",
            errorMessage: `generation failed with no media${row.regenerable ? " — regenerable, the brief is intact" : ""}`.slice(0, 500),
            updatedAt: new Date(),
          })
          .where(and(eq(socialContentInventory.id, row.inventoryId), inArray(socialContentInventory.status, ["pending", "needs_review"])));
        if (affectedRowCount(res) === 1) updated++;
      }

      await recordOperatorAction({
        action: "queue_truth_reconcile", outcome: ACTION_OUTCOME.ok,
        operatorId: ctx.user?.id ?? null,
        detail: { planned: plan.misreported, updated, regenerable: plan.regenerable },
      });
      return { planned: plan.misreported, updated, regenerable: plan.regenerable };
    }),
});
