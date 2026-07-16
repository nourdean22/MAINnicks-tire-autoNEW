/**
 * lib/trpc/routers/journal.ts · Phase TT (2026-05-19 AM) ·
 * extended Phase TT.2 (2026-05-22 · legacy-modernizer REST→tRPC
 * journal slice).
 *
 * Journal-domain procedures · the 7th domain router (nick · operator ·
 * system · chat · browser · task · journal). Wraps every endpoint the
 * /journal page + its 5 sub-components touch:
 *
 *   feed · metacognition          → the page's two loads (Phase TT)
 *   threads · createThread        → ThreadRail
 *   convergence · runConvergenceScan · dismissCandidate → ThreadRadar
 *   suggestions · acceptSuggestion · dismissSuggestion  → ThreadSuggestions
 *   reflect                       → ReflectComposer
 *   calibrationSamples · calibrate → MemoryCalibration
 *
 * Delegates to shared services so the legacy REST routes and these
 * procedures call the SAME functions · drift structurally impossible:
 *   · buildJournalFeed              → @/lib/services/journal-feed
 *   · getLatestLearningJournalEntry → @/lib/brain/learning-journal
 *   · journal-threads.ts            → listThreads · createEmptyThread ·
 *       confirmCandidate · listConvergenceCandidates · dismissCandidate ·
 *       listThreadSuggestions · acceptThreadSuggestion ·
 *       dismissThreadSuggestion
 *   · journal-convergence.runConvergenceScan
 *   · journal-reflect.createReflection   (extracted in TT.2)
 *   · journal-calibrate.{getCalibrationSamples,applyCalibration} (TT.2)
 *
 * The thread / convergence / suggestion inputs are bare scalars
 * (key · hash · name) declared inline. The reflect / calibrate inputs
 * have real structure → the schemas live in @/lib/validators/journal
 * and are SHARED with the REST routes (the schema is the contract).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, operatorProcedure } from "../trpc";
import { buildJournalFeed } from "@/lib/services/journal-feed";
import { getLatestLearningJournalEntry } from "@/lib/brain/learning-journal";
// 2026-05-24 · Wave S · feature-mining wire-ups · 7 new procedures
// surface existing lib/brain/* helpers on /journal. The helpers were
// all paid-for · just not connected to the operator's eye.
import { measureLearningVelocity } from "@/lib/brain/learning-velocity";
import { getGhostPredictions } from "@/lib/brain/ghost-nick";
import { loadRecentContradictions } from "@/lib/brain/contradiction-surfacer";
import { analyzeEmotionalArc } from "@/lib/brain/emotional-arc";
import { computeDriftScore } from "@/lib/brain/drift-detector";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("trpc/journal");
import {
  acceptThreadSuggestion,
  confirmCandidate,
  createEmptyThread,
  dismissCandidate,
  dismissThreadSuggestion,
  listConvergenceCandidates,
  listThreadSuggestions,
  listThreads,
} from "@/lib/services/journal-threads";
import { runConvergenceScan } from "@/lib/services/journal-convergence";
import { createReflection, ReflectFieldError } from "@/lib/services/journal-reflect";
import {
  applyCalibration,
  getCalibrationSamples,
} from "@/lib/services/journal-calibrate";
import { ServiceError } from "@/lib/utils/service-error";
import {
  calibrationRulingSchema,
  reflectSubmitSchema,
} from "@/lib/validators/journal";
import { confirmJournalLink, backfillJournalBrain } from "@/lib/brain/journal-brain";
import { getJournalSettings, JOURNAL_SETTINGS_DEFAULTS } from "@/lib/journal/settings";

/** The four journal silos that carry the Journal Brain grounding columns. */
const journalSiloSchema = z.enum([
  "brain_dump",
  "reflection",
  "situation_log",
  "decision_replay",
]);

export const journalRouter = router({
  /**
   * Phase TT · owner-only · unified journal feed merging the 4
   * thought-capture tables (BrainDump · Reflection · SituationLog ·
   * DecisionReplay) into a single chronologically-sorted stream
   * with rollup counts by source and entryType.
   *
   * The page polls this on filter switch (source · type · limit ·
   * days change) · React Query keys on the input so each filter
   * combination has its own cache slot.
   */
  feed: operatorProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(100),
          days: z.number().int().min(1).max(365).default(60),
          type: z.string().max(40).nullable().optional(),
          source: z.string().max(40).optional(),
          // Feed v2 (audit 2026-07-15) · server-side search + cursor
          // pagination. `cursor` is the field name tRPC's
          // useInfiniteQuery expects — nextCursor from the previous
          // page feeds back in here.
          search: z.string().max(200).optional(),
          cursor: z.string().datetime().nullish(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildJournalFeed({
        limit: input?.limit,
        days: input?.days,
        type: input?.type,
        source: input?.source,
        search: input?.search,
        cursor: input?.cursor ?? undefined,
      }),
    ),

  /**
   * Phase TT · owner-only · most-recent learning-journal entry ·
   * Nick's nightly self-assessment of his own brain. Powers the
   * small metacognition card at the top of /journal. Returns
   * `null` when no cron run has landed yet · page renders nothing
   * in that case.
   */
  metacognition: operatorProcedure.query(async () => {
    return getLatestLearningJournalEntry();
  }),

  // ──────────────────────── Threads (ThreadRail) ────────────────────────

  /**
   * Phase TT.2 · owner-only · active (and optionally dormant) journal
   * threads with a 3-excerpt preview. Replaces GET /api/journal/threads.
   * Delegates to `journal-threads.listThreads` · the same function the
   * REST route calls · drift impossible.
   */
  threads: operatorProcedure
    .input(
      z
        .object({ includeDormant: z.boolean().optional() })
        .optional(),
    )
    .query(async ({ input }) =>
      listThreads({ includeDormant: input?.includeDormant ?? false }),
    ),

  /**
   * Phase TT.2 · owner-only · create a journal thread · two modes,
   * matching POST /api/journal/threads verbatim:
   *   · clusterHash present → confirm a convergence candidate
   *     (spawn thread + seed members + retire candidate)
   *   · clusterHash absent  → operator-initiated empty thread
   *
   * Both service functions return `{ error }` on a business-rule
   * rejection (duplicate name · candidate gone · too few members) ·
   * we surface that as a BAD_REQUEST so the component's existing
   * error-toast path is preserved (the REST route returned 422).
   */
  createThread: operatorProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        clusterHash: z.string().min(1).max(200).optional(),
        summary: z.string().max(400).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const result = input.clusterHash
        ? await confirmCandidate({
            clusterHash: input.clusterHash,
            name: input.name,
            summary: input.summary ?? null,
          })
        : await createEmptyThread({
            name: input.name,
            summary: input.summary ?? null,
          });
      if ("error" in result) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      }
      return result;
    }),

  // ─────────────────── Convergence radar (ThreadRadar) ───────────────────

  /**
   * Phase TT.2 · owner-only · active convergence candidates the
   * nightly cron detected and the operator hasn't named yet.
   * Replaces GET /api/journal/convergence · delegates to
   * `journal-threads.listConvergenceCandidates`.
   */
  convergence: operatorProcedure.query(async () =>
    listConvergenceCandidates(),
  ),

  /**
   * Phase TT.2 · owner-only · run the convergence scan NOW (manual
   * trigger · normally fires nightly at 22:00 UTC). Replaces POST
   * /api/journal/convergence · delegates to the same
   * `runConvergenceScan` the Inngest cron + REST route use.
   *
   * Returns the scan telemetry the ThreadRadar shows inline. The
   * component reads `ranAt` + the scanned/found/afterPrune counts ·
   * we add `ranAt` here exactly as the REST route did.
   */
  runConvergenceScan: operatorProcedure.mutation(async () => {
    const result = await runConvergenceScan();
    return { ok: true, ranAt: new Date().toISOString(), ...result };
  }),

  /**
   * Phase TT.2 · owner-only · dismiss a convergence candidate by
   * clusterHash (soft-delete so the next scan doesn't re-surface it).
   * Replaces DELETE /api/journal/convergence?hash=... · delegates to
   * `journal-threads.dismissCandidate`.
   */
  dismissCandidate: operatorProcedure
    .input(z.object({ hash: z.string().min(1).max(200) }))
    .mutation(async ({ input }) => dismissCandidate(input.hash)),

  // ───────────────── Borderline joins (ThreadSuggestions) ─────────────────

  /**
   * Phase TT.2 · owner-only · entries the capture-hook scored in the
   * 0.65-0.80 SUGGEST band · waiting for operator confirm/reject.
   * Replaces GET /api/journal/suggestions · delegates to
   * `journal-threads.listThreadSuggestions`.
   */
  suggestions: operatorProcedure.query(async () =>
    listThreadSuggestions(),
  ),

  /**
   * Phase TT.2 · owner-only · accept a suggested thread join · promotes
   * the entry to a real JournalThreadEntry and clears the suggestion.
   * Replaces POST /api/journal/suggestions · delegates to
   * `journal-threads.acceptThreadSuggestion`.
   */
  acceptSuggestion: operatorProcedure
    .input(z.object({ key: z.string().min(1).max(200) }))
    .mutation(async ({ input }) => acceptThreadSuggestion(input.key)),

  /**
   * Phase TT.2 · owner-only · dismiss a suggested join (soft-delete).
   * Replaces DELETE /api/journal/suggestions?key=... · delegates to
   * `journal-threads.dismissThreadSuggestion`.
   */
  dismissSuggestion: operatorProcedure
    .input(z.object({ key: z.string().min(1).max(200) }))
    .mutation(async ({ input }) => dismissThreadSuggestion(input.key)),

  // ─────────────────────── Reflect (ReflectComposer) ──────────────────────

  /**
   * Phase TT.2 · owner-only · create a structured Reflection from a
   * template submission. Replaces POST /api/ultron/reflect · delegates
   * to `journal-reflect.createReflection` · the SAME function the REST
   * route calls.
   *
   * Input uses the SHARED `reflectSubmitSchema` from
   * @/lib/validators/journal — the exact schema the REST route's
   * `safeParseBody` parses. NOT a permissive z.record at the procedure
   * boundary · this is the typed-payload-mismatch guard (the /tasks
   * quick-add bug class). `ReflectFieldError` (zero filled fields) maps
   * to BAD_REQUEST so both transports reject identically.
   */
  reflect: operatorProcedure
    .input(reflectSubmitSchema)
    .mutation(async ({ input }) => {
      try {
        return await createReflection(input);
      } catch (err) {
        if (err instanceof ReflectFieldError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  // ──────────────────── Calibrate (MemoryCalibration) ─────────────────────

  /**
   * Phase TT.2 · owner-only · pick 1-3 aging brain memories for the
   * operator to re-rule. Replaces GET /api/ultron/calibrate · delegates
   * to `journal-calibrate.getCalibrationSamples`. Returns
   * `{ samples, generatedAt }` mirroring the legacy `data` envelope.
   */
  calibrationSamples: operatorProcedure.query(async () =>
    getCalibrationSamples(),
  ),

  /**
   * Phase TT.2 · owner-only · apply one calibration ruling (verify /
   * update / retire) to a brain memory. Replaces PATCH
   * /api/ultron/calibrate · delegates to
   * `journal-calibrate.applyCalibration`.
   *
   * Input uses the SHARED `calibrationRulingSchema` · the service
   * throws ServiceError(404) for a missing memory and ServiceError(400)
   * when an `update` ruling omits `newContent` · mapped to NOT_FOUND /
   * BAD_REQUEST so both transports behave identically.
   */
  calibrate: operatorProcedure
    .input(calibrationRulingSchema)
    .mutation(async ({ input }) => {
      try {
        return await applyCalibration(input);
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "BAD_REQUEST",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  // 2026-05-24 · Wave S · feature-mining wire-ups (7 procedures · one
  // per /journal feature the operator can't currently see). Each
  // wraps an existing lib/brain/* helper with a degradation fallback
  // so the journal page never hard-fails on a brain-helper error.

  /**
   * Wave S #7 · Learning-velocity ticker.
   *
   * Renders "12 entries this week · 3 new domains · 2 beliefs revised"
   * as a one-liner above the feed. Delegates to measureLearningVelocity
   * which already produces this shape for /brain. Single read, no
   * mutations · cached for the page session.
   */
  learningVelocity: operatorProcedure.query(async () => {
    try {
      const v = await measureLearningVelocity();
      return {
        memoriesThisWeek: v.memoriesCreated.thisWeek,
        memoriesDelta: v.memoriesCreated.delta,
        newConnections: v.connections.new,
        contradictionsResolved: v.contradictions.resolved,
        wisdomPromotions: v.wisdomPromotions.recent,
        healthScore: v.healthScore,
        overallGrowth: v.overallGrowth,
      };
    } catch (err) {
      log.warn("learning_velocity_failed", { error: sanitizeError(err) });
      return null;
    }
  }),

  /**
   * Wave S #4 · Ghost counter-question.
   *
   * ReflectComposer promises "one counter-question to push Nour's
   * reasoning" in its docstring (line 17). This wires the promise to
   * the existing ghost-nick helper · picks the most-recent prediction
   * whose `basis` field reads as a probing question. Falls back to
   * null when ghost-nick has nothing to say · composer skips the slot.
   */
  ghostCounterQuestion: operatorProcedure.query(async () => {
    try {
      const bundle = await getGhostPredictions();
      if (!bundle || !bundle.predictions || bundle.predictions.length === 0) {
        return null;
      }
      // Pick the highest-confidence non-dismissed prediction that
      // frames a tension · re-shape its title as a question. One line ·
      // operator can ignore. ghost-nick.GhostPrediction stores the
      // task title (not a prediction string) · the basis is in
      // signals[] (what drove the pick).
      const top = bundle.predictions
        .filter((p) => !p.dismissed)
        .slice()
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
      if (!top) return null;
      const titleClipped = top.title.slice(0, 120);
      return {
        question: `Past-Nour predicted you'd work on "${titleClipped}" today · did you?`,
        basis: top.signals?.slice(0, 2).join(" · ") ?? null,
        confidence: top.confidence,
      };
    } catch (err) {
      log.warn("ghost_counter_question_failed", { error: sanitizeError(err) });
      return null;
    }
  }),

  /**
   * Wave S #1 · Contradictions for a specific entry.
   *
   * The brainMemoryId is the FeedEntry.id when the entry is a
   * BrainDump (the page's natural granularity). Returns up to 3
   * contradictions tied to entries within ~30d of the target ·
   * matches the operator's natural recall window.
   */
  contradictionsForEntry: operatorProcedure
    .input(z.object({ brainMemoryId: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      try {
        // Second arg is includeResolved boolean · default false (only
        // unresolved). Loader caps at 40 rows internally · ample for
        // the 30d window we hit here.
        const all = await loadRecentContradictions(30, false);
        const related = all
          .filter(
            (c) =>
              c.new_memory_id === input.brainMemoryId ||
              c.old_memory_id === input.brainMemoryId,
          )
          .slice(0, 3);
        return related.map((c) => ({
          key: c.key,
          otherId:
            c.new_memory_id === input.brainMemoryId
              ? c.old_memory_id
              : c.new_memory_id,
          signal: c.signal,
          excerpt:
            c.new_memory_id === input.brainMemoryId
              ? c.old_excerpt
              : c.new_excerpt,
          status: c.status,
          daysApart: c.days_apart,
        }));
      } catch (err) {
        log.warn("contradictions_for_entry_failed", {
          error: sanitizeError(err),
        });
        return [];
      }
    }),

  /**
   * Wave S #6 + #3 · Thread drift + emotional arc signals.
   *
   * Combined into one read because both surface on the ThreadRail
   * and react-query already keys by no-args here. The arc is
   * overall-session (analyzeEmotionalArc is whole-history) · the
   * drift result includes per-domain decay. Both fall back to null
   * on helper failure (silent · the rail handles null gracefully).
   */
  brainSignals: operatorProcedure.query(async () => {
    try {
      const [arc, drift] = await Promise.all([
        analyzeEmotionalArc().catch(() => null),
        computeDriftScore().catch(() => null),
      ]);
      return {
        emotionalArc: arc
          ? {
              trajectory: arc.trajectory,
              energyTrend: arc.energyTrend,
              dominantState: arc.dominantState,
              volatility: arc.volatilityScore,
              stressDays: arc.stressDays,
              intervention: arc.interventionRecommendation,
            }
          : null,
        drift: drift
          ? {
              overallScore: drift.overallScore,
              topConcern: drift.topConcern,
              topSignals: drift.signals
                .slice()
                .sort((a, b) => b.score * b.weight - a.score * a.weight)
                .slice(0, 3)
                .map((s) => ({
                  source: s.source,
                  label: s.label,
                  score: s.score,
                  detail: s.detail,
                })),
            }
          : null,
      };
    } catch (err) {
      log.warn("brain_signals_failed", { error: sanitizeError(err) });
      return null;
    }
  }),

  /**
   * Wave S #5 · Weekly memoir items.
   *
   * Returns the top 3 BrainMemory rows from category WISDOM or
   * BELIEF with createdAt in the last 7 days · these are the
   * distilled outputs from the nightly wisdom-distiller cron.
   * Surfaced as a small block above the feed when the operator
   * filters to "last 7 days." Silent when fewer than 3 items.
   */
  weeklyMemoirItems: operatorProcedure.query(async () => {
    try {
      const { prisma } = await import("@/lib/prisma");
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const items = await prisma.brainMemory.findMany({
        where: {
          deletedAt: null,
          createdAt: { gte: since },
          category: { in: [BRAIN_CATEGORIES.WISDOM, BRAIN_CATEGORIES.BELIEF] },
        },
        select: { id: true, key: true, content: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 3,
      });
      return items.map((m) => ({
        id: m.id,
        text:
          typeof m.content === "string"
            ? m.content.slice(0, 200)
            : String(m.content).slice(0, 200),
        createdAt: m.createdAt.toISOString(),
      }));
    } catch (err) {
      log.warn("weekly_memoir_failed", { error: sanitizeError(err) });
      return [];
    }
  }),

  /**
   * Wave S #2 · Save prediction tied to a decision entry.
   *
   * Lightweight write into the existing Prediction model · the
   * journal-entry-row exposes a 1-line form on decision-class
   * entries · operator types prediction text + target date · this
   * persists. The existing predictions-grader cron grades it once
   * the target date passes · no new infra needed.
   */
  savePrediction: operatorProcedure
    .input(
      z.object({
        prediction: z.string().min(3).max(500),
        targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        confidence: z.number().min(0).max(1).default(0.6),
        sourceEntryId: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const { prisma } = await import("@/lib/prisma");
        const today = new Date().toISOString().slice(0, 10);
        const row = await prisma.prediction.create({
          data: {
            date: today,
            targetDate: input.targetDate,
            category: "behavior",
            prediction: input.prediction,
            basis: input.sourceEntryId
              ? `journal-entry:${input.sourceEntryId}`
              : "operator-typed",
            confidence: input.confidence,
            status: "pending",
            kind: "binary",
          },
          select: { id: true, status: true, targetDate: true },
        });
        return { ok: true as const, id: row.id, targetDate: row.targetDate };
      } catch (err) {
        log.error("save_prediction_failed", {
          input,
          error: sanitizeError(err),
        });
        return { ok: false as const, error: "save_prediction_failed" };
      }
    }),

  // ──────────────── Journal Brain · link confirm + impact receipt ────────────────

  /**
   * Journal Brain (2026-06-01 · Phase 1) · derived "impact receipt" for one
   * entry. NOT stored — computed from the grounding columns + the mastery_xp
   * ledger rows keyed to this entry (baseline `journal-base:<id>` + grounded
   * `goal-journal:<id>:*`). Powers the inline receipt under each feed entry.
   */
  receipt: operatorProcedure
    .input(z.object({ silo: journalSiloSchema, id: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const { prisma } = await import("@/lib/prisma");
      const sel = { goalId: true, missionId: true, linkConfidence: true, linkStatus: true, enrichedAt: true };
      const row =
        input.silo === "brain_dump"
          ? await prisma.brainDump.findUnique({ where: { id: input.id }, select: { ...sel, entryType: true } })
          : input.silo === "reflection"
          ? await prisma.reflection.findUnique({ where: { id: input.id }, select: sel })
          : input.silo === "situation_log"
          ? await prisma.situationLog.findUnique({ where: { id: input.id }, select: sel })
          : await prisma.decisionReplay.findUnique({ where: { id: input.id }, select: sel });
      if (!row) return null;
      const goal = row.goalId
        ? await prisma.lifeGoal.findUnique({ where: { id: row.goalId }, select: { id: true, title: true } }).catch(() => null)
        : null;
      const mission = row.missionId
        ? await prisma.mission.findUnique({ where: { id: row.missionId }, select: { id: true, title: true } }).catch(() => null)
        : null;
      const events = await prisma.brainMemory
        .findMany({
          where: {
            category: "mastery_xp_event",
            OR: [{ key: `journal-base:${input.id}` }, { key: { startsWith: `goal-journal:${input.id}:` } }],
          },
          select: { key: true, metadata: true },
        })
        .catch(() => [] as { key: string; metadata: unknown }[]);
      const xp = events
        .map((e) => {
          const m = (e.metadata ?? {}) as Record<string, unknown>;
          return {
            stat: typeof m.stat === "string" ? m.stat : "?",
            xp: typeof m.xp === "number" ? m.xp : 0,
            kind: e.key.startsWith("journal-base:") ? ("baseline" as const) : ("grounded" as const),
          };
        })
        .filter((x) => x.xp > 0);
      // Phase 2 · the journal "take" (bold idea + sharp challenge), if generated.
      const takeRow = await prisma.brainMemory
        .findUnique({
          where: { category_key: { category: "journal_brain_take", key: `journal-take:${input.id}` } },
          select: { content: true },
        })
        .catch(() => null);
      let take: {
        idea: string | null;
        challenge: string | null;
        nextAction: { action: string; domain: string | null; nextActionPromoted?: boolean } | null;
      } | null = null;
      if (takeRow?.content) {
        try {
          const p = JSON.parse(takeRow.content) as {
            idea?: string | null;
            challenge?: string | null;
            nextAction?: { action?: string; domain?: string | null; nextActionPromoted?: boolean } | null;
          };
          const na =
            p.nextAction && typeof p.nextAction.action === "string"
              ? {
                  action: p.nextAction.action,
                  domain: p.nextAction.domain ?? null,
                  nextActionPromoted: p.nextAction.nextActionPromoted ?? false,
                }
              : null;
          if (p.idea || p.challenge || na)
            take = { idea: p.idea ?? null, challenge: p.challenge ?? null, nextAction: na };
        } catch {
          /* malformed take · ignore */
        }
      }
      return {
        entryType: input.silo === "brain_dump" ? (row as { entryType?: string | null }).entryType ?? null : null,
        linkStatus: row.linkStatus,
        linkConfidence: row.linkConfidence,
        enrichedAt: row.enrichedAt,
        goal: goal ? { id: goal.id, title: goal.title } : null,
        mission: mission ? { id: mission.id, title: mission.title } : null,
        xp,
        totalXp: Math.round(xp.reduce((s, x) => s + x.xp, 0) * 10) / 10,
        take,
      };
    }),

  /**
   * Proof of Becoming · journal-advancement item D (2026-06-10). DERIVED,
   * never fabricated: counts the operator's ENRICHED brain dumps from the
   * last 7 days grouped by life domain + entry type, with grounded-link
   * counts and a prior-week comparison. v1 reads brain_dumps only — they
   * are the operator's own captured thoughts (reflections are cron
   * outputs). An entry "counts as proof" because the brain actually
   * decoded it — no synthetic scores, no invented progress.
   */
  proofStack: operatorProcedure.query(async () => {
    const { prisma } = await import("@/lib/prisma");
    const DAY = 86_400_000;
    const now = Date.now();
    const rows = await prisma.brainDump
      .findMany({
        where: {
          createdAt: { gte: new Date(now - 14 * DAY) },
          deletedAt: null,
          enrichedAt: { not: null },
        },
        select: {
          createdAt: true,
          entryType: true,
          extractedItems: true,
          linkStatus: true,
          rawThoughts: true,
          summary: true,
        },
        orderBy: { createdAt: "desc" },
        take: 400,
      })
      .catch(
        (): {
          createdAt: Date;
          entryType: string | null;
          extractedItems: string | null;
          linkStatus: string | null;
          rawThoughts: string;
          summary: string | null;
        }[] => [],
      );
    let weekTotal = 0;
    let prevWeekTotal = 0;
    let grounded = 0;
    const byDomain = new Map<string, number>();
    const byType = new Map<string, number>();

    // 10 identity "proof of becoming" domains (item D · 2026-06-10). Each
    // THIS-WEEK entry is binned into exactly ONE — first match wins, so the
    // grid sums back to weekTotal · no double-count, no fabrication. Bins on
    // the brain's structured signals (entryType + extracted domains) plus the
    // operator's own words; a zero domain reads "no proof logged", never fudged.
    const norm = (s: string) => s.toLowerCase();
    const tagHit = (tags: string[], ...needles: string[]) =>
      tags.some((h) => needles.some((n) => norm(h).includes(n)));
    const BECOMING_DOMAINS: {
      key: string;
      label: string;
      match: (entryType: string, domains: string[], text: string) => boolean;
    }[] = [
      { key: "fitness", label: "Fitness", match: (_t, d, x) => tagHit(d, "health", "body", "fitness") || /\b(workout|gym|train(ed|ing)?|run|lift|reps|cardio|diet|sleep)\b/.test(x) },
      { key: "business", label: "Business", match: (_t, d, x) => tagHit(d, "business", "empire", "finance", "content", "mission") || /\b(revenue|client|sale|deal|launch|ship(ped)?|invoice|profit)\b/.test(x) },
      { key: "leadership", label: "Leadership", match: (_t, d, x) => tagHit(d, "social", "influence", "leadership") || /\b(team|led|delegat|hire|manage(d|r)?|mentor|negotiat)\b/.test(x) },
      { key: "faith", label: "Faith", match: (_t, d, x) => tagHit(d, "spiritual", "faith") || /\b(pray(ed|er)?|god|faith|quran|salah|gratitude|grateful)\b/.test(x) },
      { key: "family-future", label: "Family / Future", match: (t, _d, x) => t === "planning" || /\b(family|wife|kids?|son|daughter|legacy|future|90 days?|vision)\b/.test(x) },
      { key: "follow-through", label: "Follow-through", match: (t) => t === "decision" },
      { key: "emotional-control", label: "Emotional control", match: (t) => t === "venting" },
      { key: "dopamine-control", label: "Dopamine control", match: (_t, _d, x) => /\b(resist(ed)?|avoid(ed)?|temptation|scroll|porn|junk|distract|urge|craving|said no)\b/.test(x) },
      { key: "patience", label: "Patience", match: (_t, _d, x) => /\b(patien(t|ce)|wait(ed)?|slow|long game|compound|stayed calm|held back)\b/.test(x) },
      { key: "discipline", label: "Discipline", match: () => true },
    ];
    const becoming: Record<string, number> = Object.fromEntries(
      BECOMING_DOMAINS.map((d) => [d.key, 0]),
    );
    for (const r of rows) {
      const isThisWeek = now - r.createdAt.getTime() < 7 * DAY;
      if (!isThisWeek) {
        prevWeekTotal++;
        continue;
      }
      weekTotal++;
      if (r.linkStatus === "auto" || r.linkStatus === "confirmed") grounded++;
      let domains: string[] = [];
      let jsonType: string | null = null;
      try {
        const parsed = JSON.parse(r.extractedItems ?? "{}") as {
          domains?: unknown;
          entryType?: unknown;
        };
        if (Array.isArray(parsed.domains))
          domains = parsed.domains.filter((d): d is string => typeof d === "string");
        if (typeof parsed.entryType === "string") jsonType = parsed.entryType;
      } catch {
        /* legacy/malformed JSON · still counts toward the total */
      }
      for (const d of domains.slice(0, 4)) byDomain.set(d, (byDomain.get(d) ?? 0) + 1);
      const t = r.entryType ?? jsonType;
      if (t) byType.set(t, (byType.get(t) ?? 0) + 1);
      // Identity-domain bin (first match wins → sums back to weekTotal).
      const proofText = `${r.rawThoughts} ${r.summary ?? ""}`.toLowerCase();
      const bin = BECOMING_DOMAINS.find((d) => d.match(t ?? "", domains, proofText));
      if (bin) becoming[bin.key] += 1;
    }
    return {
      weekTotal,
      prevWeekTotal,
      grounded,
      byDomain: [...byDomain.entries()]
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count),
      byType: [...byType.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      // 10 fixed identity domains, ordered, zeros included (the grid renders
      // empty domains honestly as "no proof logged").
      becomingDomains: BECOMING_DOMAINS.map((d) => ({
        key: d.key,
        label: d.label,
        count: becoming[d.key],
      })),
    };
  }),

  /**
   * Feed-OS · journal-advancement item G (2026-06-10). The freshest
   * journal-extracted NEXT MOVE for the home surface — the "Act" output
   * of the journal loop feeding the OS's action surface. Reads the
   * journal_brain_take rows written in the last 48h, returns the newest
   * one carrying a non-null nextAction (honest: null when none exists —
   * the strip self-hides, nothing is invented).
   */
  latestNextAction: operatorProcedure.query(async () => {
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.brainMemory
      .findMany({
        where: {
          category: "journal_brain_take",
          updatedAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
          deletedAt: null,
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: { key: true, content: true, updatedAt: true },
      })
      .catch((): { key: string | null; content: string; updatedAt: Date }[] => []);
    for (const r of rows) {
      try {
        const p = JSON.parse(r.content) as {
          nextAction?: { action?: string; domain?: string | null; nextActionPromoted?: boolean } | null;
        };
        if (
          p.nextAction &&
          typeof p.nextAction.action === "string" &&
          // Live-verify 2026-07-15 · scrub literal "null"-string actions
          // (legacy model artifact) so the home hub never surfaces them.
          !["null", "none", "n/a"].includes(p.nextAction.action.trim().toLowerCase()) &&
          p.nextAction.nextActionPromoted !== true
        ) {
          return {
            action: p.nextAction.action,
            domain: p.nextAction.domain ?? null,
            // key is `journal-take:<entryId>` → expose the entry id for
            // the /journal#bd-<id> deep link.
            entryId: r.key?.startsWith("journal-take:") ? r.key.slice("journal-take:".length) : null,
            at: r.updatedAt.toISOString(),
          };
        }
      } catch {
        /* malformed take · skip */
      }
    }
    return null;
  }),

  /**
   * Journal Insights Preview · Rank 10 local-only panel (2026-06-13).
   * Distills and returns recent journal takeaways (nextAction, idea, challenge)
   * parsed from the `journal_brain_take` table.
   */
  insightsPreview: operatorProcedure.query(async () => {
    const { prisma } = await import("@/lib/prisma");
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000); // 14d window
    const takeRows = await prisma.brainMemory.findMany({
      where: {
        category: "journal_brain_take",
        createdAt: { gte: since },
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const parsedTakes = takeRows.map((row) => {
      const entryId = row.key.replace("journal-take:", "");
      let parsed: {
        idea?: string | null;
        ideaPromoted?: boolean;
        challenge?: string | null;
        challengePromoted?: boolean;
        nextAction?: {
          action?: string;
          domain?: string | null;
          nextActionPromoted?: boolean;
        } | null;
      } = {};
      try {
        parsed = JSON.parse(row.content);
      } catch {}
      // Live-verify 2026-07-15 · legacy takes can carry the literal
      // string "null" as the action (model artifact, now scrubbed at
      // write in generateJournalTake) — treat those as no-action so
      // the panel doesn't render "NEXT ACTION: null [ACCEPT]".
      const actionStr = parsed.nextAction?.action?.trim().toLowerCase();
      const nextAction =
        parsed.nextAction && actionStr && !["null", "none", "n/a"].includes(actionStr)
          ? parsed.nextAction
          : null;
      return {
        id: row.id,
        entryId,
        updatedAt: row.updatedAt,
        idea: parsed.idea ?? null,
        challenge: parsed.challenge ?? null,
        nextAction,
        // Loop-closure wave · server-truth promoted flags so the panel
        // renders accepted state across remounts (was a client-side Set).
        ideaPromoted: parsed.ideaPromoted === true,
        challengePromoted: parsed.challengePromoted === true,
        nextActionPromoted: parsed.nextAction?.nextActionPromoted === true,
      };
    });

    const entryIds = parsedTakes.map((t) => t.entryId);
    if (entryIds.length === 0) return [];

    const [dumps, reflections, situations, decisions] = await Promise.all([
      prisma.brainDump.findMany({
        where: { id: { in: entryIds } },
        select: { id: true, summary: true, rawThoughts: true, goalId: true },
      }),
      prisma.reflection.findMany({
        where: { id: { in: entryIds } },
        select: { id: true, insight: true, goalId: true },
      }),
      prisma.situationLog.findMany({
        where: { id: { in: entryIds } },
        select: { id: true, situation: true, goalId: true },
      }),
      prisma.decisionReplay.findMany({
        where: { id: { in: entryIds } },
        select: { id: true, title: true, goalId: true },
      }),
    ]);

    const titleMap = new Map<string, string>();
    const goalMap = new Map<string, string | null>();

    for (const d of dumps) {
      titleMap.set(d.id, d.summary?.slice(0, 120) || d.rawThoughts.slice(0, 80));
      goalMap.set(d.id, d.goalId);
    }
    for (const r of reflections) {
      titleMap.set(r.id, r.insight.slice(0, 120));
      goalMap.set(r.id, r.goalId);
    }
    for (const s of situations) {
      titleMap.set(s.id, s.situation.slice(0, 120));
      goalMap.set(s.id, s.goalId);
    }
    for (const d of decisions) {
      titleMap.set(d.id, d.title.slice(0, 120));
      goalMap.set(d.id, d.goalId);
    }

    return parsedTakes.map((t) => ({
      ...t,
      entryTitle: titleMap.get(t.entryId) || "Journal Entry",
      goalId: goalMap.get(t.entryId) ?? null,
    }));
  }),

  /**
   * Journal Brain · confirm or reject a PROPOSED goal/mission link. Accept →
   * linkStatus="confirmed" + (idempotently) bank the grounded XP bonus. Reject
   * → clear the link + linkStatus="rejected". The grounded credit is idempotent
   * by sourceKey, so confirming an already-auto-credited entry is a no-op.
   */
  confirmLink: operatorProcedure
    .input(z.object({ silo: journalSiloSchema, id: z.string().min(1).max(64), accept: z.boolean() }))
    .mutation(async ({ input }) => {
      const r = await confirmJournalLink(input.silo, input.id, input.accept);
      if (!r.ok) throw new TRPCError({ code: "NOT_FOUND", message: "journal entry not found" });
      return { ok: true as const, accepted: r.accepted, creditedStats: r.creditedStats };
    }),

  /** Journal Brain · read the tunable settings (Phase 2 settings panel). */
  getSettings: operatorProcedure.query(async () => getJournalSettings()),

  /** Journal Brain · update the singleton settings (Phase 2 settings panel). */
  updateSettings: operatorProcedure
    .input(
      z.object({
        baselineXp: z.number().min(0.1).max(5).optional(),
        baselineEnabled: z.boolean().optional(),
        qualityFloorChars: z.number().int().min(0).max(2000).optional(),
        groundedXpMultiplier: z.number().min(1).max(5).optional(),
        autoConfirmThreshold: z.number().min(0).max(1).optional(),
        challengeCadence: z.enum(["every", "daily", "off"]).optional(),
        creativeIntensity: z.enum(["bold", "balanced", "off"]).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { prisma } = await import("@/lib/prisma");
      return prisma.journalSettings.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", ...JOURNAL_SETTINGS_DEFAULTS, ...input },
        update: input,
      });
    }),

  /**
   * Journal Brain (Phase 3) · backfill — re-run the enrichment pass over
   * historical entries (enrichedAt = null) across all 4 silos, bounded per
   * silo, with an opt dryRun that only COUNTS candidates. Idempotent (grounded
   * credit dedupes by sourceKey). Operator runs dryRun first to size, then
   * drains in batches.
   */
  backfillBrain: operatorProcedure
    .input(
      z.object({
        silo: journalSiloSchema.optional(),
        limit: z.number().int().min(1).max(200).default(25),
        dryRun: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const results = await backfillJournalBrain(input);
      return { ok: true as const, dryRun: input.dryRun, results };
    }),

  /**
   * Journal-to-Action Seam (P0) · promoteNextAction
   *
   * Promotes a journal take layer (nextAction · idea · challenge) to a
   * real task. Thin adapter — the logic + per-layer idempotency flags
   * live in lib/services/journal-promote.ts (loop-closure wave,
   * audit 2026-07-15). Name kept for API stability.
   */
  promoteNextAction: operatorProcedure
    .input(
      z.object({
        entryId: z.string().min(1).max(64),
        kind: z.enum(["nextAction", "idea", "challenge"]).default("nextAction"),
      }),
    )
    .mutation(async ({ input }) => {
      const { promoteJournalTake, JournalPromoteError } = await import(
        "@/lib/services/journal-promote"
      );
      try {
        return await promoteJournalTake(input.entryId, input.kind);
      } catch (err) {
        if (err instanceof JournalPromoteError) {
          throw new TRPCError({
            code:
              err.code === "NOT_FOUND"
                ? "NOT_FOUND"
                : err.code === "TASK_FAILED"
                  ? "INTERNAL_SERVER_ERROR"
                  : "BAD_REQUEST",
            message: err.message,
          });
        }
        throw err;
      }
    }),
});
