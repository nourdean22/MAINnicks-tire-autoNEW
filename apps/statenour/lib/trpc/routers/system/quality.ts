/**
 * lib/trpc/routers/system/quality.ts
 *
 * Per-domain slice of the system router (mechanical split · 2026-05-31).
 * Exports a plain procedure-object that system.ts spreads back into
 * `systemRouter` — the client paths stay FLAT as `trpc.system.<proc>`.
 * Procedures moved VERBATIM · no behavior / input-schema / middleware
 * change. See system.ts for the recomposition.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { operatorProcedure } from "../../trpc";
import { buildLensStats } from "@/lib/services/lens-stats";
import { ServiceError } from "@/lib/utils/service-error";
import { buildDecisionDriftFeed } from "@/lib/services/decision-drift";
import {
  listAntiPatterns,
  upsertAntiPattern,
  revisitAntiPattern,
  deleteAntiPattern,
} from "@/lib/services/anti-patterns";
import { buildNickQualityFeed } from "@/lib/services/nick-quality";
import {
  currentOperatorState,
  formatOperatorStateBlock,
} from "@/lib/services/operator-state";
import { buildStateCalibration } from "@/lib/services/state-calibration";
import { resolveAlert } from "@/lib/mastery/drift-engine";
import {
  antiPatternCreateSchema,
  preferenceVectorSaveSchema,
  personaDriftResolveSchema,
  contradictionResolveSchema,
  decisionReplayMarkSchema,
} from "@/lib/validators/system";
import {
  buildPreferenceVectorView,
  savePreferenceVectorOverride,
} from "@/lib/services/preference-vector";
import {
  listPersonaDrifts,
  resolvePersonaDrift,
} from "@/lib/services/persona-drift";
import {
  listContradictions,
  resolveContradictionEntry,
} from "@/lib/services/contradictions";
import {
  buildDecisionReplaysView,
  markDecisionReplay,
} from "@/lib/services/decision-replays";

export const qualityProcedures = {
  /**
   * Wave-5 (2026-07-29) · recent judged comparisons for the operator
   * label loop — unlabeled first, light payload (replies truncated for
   * the card; the judge's pick is HIDDEN client-side until the operator
   * labels, as the position-bias mitigation).
   */
  judgeRecent: operatorProcedure
    .input(z.object({ take: z.number().int().min(1).max(50) }).optional())
    .query(async ({ input }) => {
      const { readComparisons } = await import("@/lib/ai/judge-eval/persistence");
      const rows = await readComparisons({ take: input?.take ?? 20 });
      return rows.map((r) => ({
        id: r.id,
        prompt: r.prompt.slice(0, 280),
        v1Reply: r.v1Reply.slice(0, 600),
        v2Reply: r.v2Reply.slice(0, 600),
        judgeWinner: r.judgment.winner,
        v2Score: r.judgment.v2Score,
        operatorWinner: r.operatorWinner,
        createdAt: r.createdAt,
      }));
    }),

  /** Wave-5 · one-tap operator verdict on a judged comparison. */
  judgeLabel: operatorProcedure
    .input(z.object({ id: z.string().min(1), winner: z.enum(["v1", "v2", "tie"]) }))
    .mutation(async ({ input }) => {
      const { recordOperatorLabel } = await import("@/lib/ai/judge-eval/persistence");
      const ok = await recordOperatorLabel(input.id, input.winner);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "comparison not found" });
      return { ok };
    }),

  /** Wave-6 (2026-07-29) · the Journey lens — months-scale becoming,
   *  pure read over existing identity/XP/anti-pattern/skill rows. */
  journeyLens: operatorProcedure.query(async () => {
    const { buildJourneyLens } = await import("@/lib/services/journey-lens");
    return buildJourneyLens();
  }),

  /** Wave-6 · triage adoption from spine-5's own TaskEvent audit trail
   *  (source `triage:*`) — measures the ritual, adds no new contract. */
  triageAdoption: operatorProcedure
    .input(z.object({ windowDays: z.number().int().min(1).max(90) }).optional())
    .query(async ({ input }) => {
      const { prisma } = await import("@/lib/prisma");
      const windowDays = input?.windowDays ?? 14;
      const since = new Date(Date.now() - windowDays * 86_400_000);
      const rows = await prisma.taskEvent.groupBy({
        by: ["source"],
        where: { source: { startsWith: "triage:" }, createdAt: { gte: since } },
        _count: { _all: true },
      });
      return {
        windowDays,
        decisions: rows.map((r) => ({
          decision: (r.source ?? "").replace(/^triage:/, ""),
          count: r._count._all,
        })),
        total: rows.reduce((s, r) => s + r._count._all, 0),
      };
    }),

  /** Wave-5 · judge-vs-operator agreement + per-class precision/recall. */
  judgeCalibration: operatorProcedure.query(async () => {
    const { readComparisons } = await import("@/lib/ai/judge-eval/persistence");
    const { judgeCalibration } = await import("@/lib/ai/judge-eval/calibration");
    const rows = await readComparisons({ take: 500 });
    const labeled = rows.flatMap((r) =>
      r.operatorWinner !== null
        ? [{ judgeWinner: r.judgment.winner, operatorWinner: r.operatorWinner }]
        : [],
    );
    return judgeCalibration(labeled);
  }),

  /**
   * Phase U.3 (2026-05-18 PM) · owner-only · strategic-frameworks
   * lens-firing aggregates over a configurable window. Delegates to
   * the shared `lib/services/lens-stats.ts` service that the legacy
   * REST endpoint also calls · drift between consumers impossible.
   *
   * Input · `{ days: 1-90 }` default 7 · query param shape mirrors
   * the legacy `?days=N` REST URL.
   */
  lensStats: operatorProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(7) }))
    .query(async ({ input }) => {
      return buildLensStats({ days: input.days });
    }),

  /**
   * Phase VV · owner-only · the decision follow-through pulse (W12.2).
   * Replaces GET /api/system/decision-drift · delegates to the shared
   * `decision-drift.buildDecisionDriftFeed` service. QualityDecisionsView
   * polls this on a 2-minute interval — the page now drives the refetch
   * via refetchInterval rather than a manual setInterval.
   */
  decisionDrift: operatorProcedure.query(async () =>
    buildDecisionDriftFeed(),
  ),

  /**
   * Phase VV · owner-only · the anti-pattern library (W12.4) listing.
   * Replaces GET /api/system/anti-patterns · delegates to the shared
   * `anti-patterns.listAntiPatterns` service. Returns `{ items,
   * summary }` mirroring the legacy `data` envelope.
   */
  antiPatterns: operatorProcedure.query(async () => listAntiPatterns()),

  /**
   * Phase VV · owner-only · create (or merge-by-key) an anti-pattern.
   * Replaces POST /api/system/anti-patterns · delegates to the shared
   * `anti-patterns.upsertAntiPattern` service.
   *
   * Input uses the SHARED `antiPatternCreateSchema` from
   * @/lib/validators/system — the exact schema the REST route's
   * `CreateSchema.parse()` uses. NOT a permissive z.record at the
   * procedure boundary · this is the typed-payload-mismatch guard (the
   * /tasks quick-add bug class). Returns `{ item, action }` where
   * action is "created" | "updated".
   */
  createAntiPattern: operatorProcedure
    .input(antiPatternCreateSchema)
    .mutation(async ({ input }) => upsertAntiPattern(input)),

  /**
   * Phase VV · owner-only · bump an anti-pattern's revisit counter.
   * Replaces POST /api/system/anti-patterns/revisit · delegates to the
   * shared `anti-patterns.revisitAntiPattern` service. A missing key
   * throws ServiceError(404) → mapped to NOT_FOUND so both transports
   * reject identically.
   */
  revisitAntiPattern: operatorProcedure
    .input(z.object({ key: z.string().min(1).max(60) }))
    .mutation(async ({ input }) => {
      try {
        return await revisitAntiPattern(input.key);
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Phase VV · owner-only · soft-delete an anti-pattern (recoverable).
   * Replaces DELETE /api/system/anti-patterns?key=... · delegates to
   * the shared `anti-patterns.deleteAntiPattern` service.
   */
  deleteAntiPattern: operatorProcedure
    .input(z.object({ key: z.string().min(1).max(60) }))
    .mutation(async ({ input }) => deleteAntiPattern(input.key)),

  /**
   * Phase VV · owner-only · the Nick-quality trend (W12.1). Replaces
   * GET /api/system/quality · delegates to the shared
   * `nick-quality.buildNickQualityFeed` service. QualityNickView polls
   * this on a 60s interval — now driven by refetchInterval.
   */
  quality: operatorProcedure.query(async () => buildNickQualityFeed()),

  /**
   * Phase B.6c · owner-only · the 8-axis preference-vector view ·
   * current vector + system-prompt addendum + last-tune metadata +
   * 12-week per-axis trace. Replaces GET /api/system/preference-vector
   * · delegates to the shared `preference-vector.buildPreferenceVectorView`
   * service. PreferencesCard polls this on a 5-min interval — React
   * Query now drives the refetch via refetchInterval. Returns the view
   * at the top level (the legacy route returned the object directly · no
   * envelope change).
   */
  preferenceVector: operatorProcedure.query(async () =>
    buildPreferenceVectorView(),
  ),

  /**
   * Phase B.6c · owner-only · persist a preference-vector override.
   * Replaces POST /api/system/preference-vector · delegates to the
   * shared `preference-vector.savePreferenceVectorOverride` service
   * (which zeros every axis on `reset`, else merges the partial patch ·
   * invalidates the style-adapter cache · writes the audit event).
   *
   * Input is the SHARED `preferenceVectorSaveSchema` from
   * @/lib/validators/system — the EXACT schema the REST route's
   * `overrideSchema.safeParse` uses. The inner `vector` object is
   * `.strict()` so an unknown axis key is rejected at the boundary,
   * not silently dropped — the typed-payload-mismatch guard.
   */
  savePreferenceVector: operatorProcedure
    .input(preferenceVectorSaveSchema)
    .mutation(async ({ input }) =>
      savePreferenceVectorOverride({
        vector: input.vector,
        reset: input.reset,
      }),
    ),

  /**
   * Phase B.6c · owner-only · active persona-drift events for the
   * PersonaDriftCard (7d window · dismissed + snoozed-not-expired
   * filtered out). Replaces GET /api/system/persona-drift · delegates
   * to the shared `persona-drift.listPersonaDrifts` service.
   * PersonaDriftCard polls this on a 5-min interval — now driven by
   * refetchInterval.
   */
  personaDrift: operatorProcedure.query(async () => listPersonaDrifts()),

  /**
   * Phase B.6c · owner-only · resolve a persona-drift event (dismiss ·
   * snooze · acknowledge). Replaces POST
   * /api/system/persona-drift/[key]/resolve · delegates to the shared
   * `persona-drift.resolvePersonaDrift` service.
   *
   * Input is the SHARED `personaDriftResolveSchema` from
   * @/lib/validators/system (the EXACT schema the REST route's
   * `bodySchema` uses) PLUS a `key` scalar — the route carried `key`
   * as a path param; tRPC has no path, so it rides in the input object.
   * A missing key throws ServiceError(404) → mapped to NOT_FOUND so
   * both transports reject identically.
   */
  resolvePersonaDrift: operatorProcedure
    .input(personaDriftResolveSchema.extend({ key: z.string().min(1).max(128) }))
    .mutation(async ({ input }) => {
      try {
        return await resolvePersonaDrift({
          key: input.key,
          resolution: input.resolution,
          note: input.note,
        });
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Phase B.6c · owner-only · unresolved (+ optionally resolved)
   * contradictions for the ContradictionsCard, grouped by status with
   * an unresolved-count badge. Replaces GET /api/system/contradictions
   * · delegates to the shared `contradictions.listContradictions`
   * service. ContradictionsCard polls this on a 5-min interval — now
   * driven by refetchInterval.
   *
   * The legacy URL was `?days=14&includeResolved=true`; the typed input
   * mirrors those two params (`days` clamped 1-180 · default 30, the
   * route's QuerySchema defaults verbatim).
   */
  contradictions: operatorProcedure
    .input(
      z
        .object({
          days: z.number().int().min(1).max(180).default(30),
          includeResolved: z.boolean().default(false),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      listContradictions({
        days: input?.days ?? 30,
        includeResolved: input?.includeResolved ?? false,
      }),
    ),

  /**
   * Phase B.6c · owner-only · resolve a contradiction (current_wins ·
   * old_wins · both_valid · dismissed) with an optional note. Replaces
   * POST /api/system/contradictions/[key]/resolve · delegates to the
   * shared `contradictions.resolveContradictionEntry` service.
   *
   * Input is the SHARED `contradictionResolveSchema` from
   * @/lib/validators/system (the EXACT schema the REST route's
   * `resolveSchema` uses) PLUS a `key` scalar (the route's path param).
   * A missing-or-corrupt row throws ServiceError(404) → NOT_FOUND so
   * both transports reject identically.
   */
  resolveContradiction: operatorProcedure
    .input(
      contradictionResolveSchema.extend({ key: z.string().min(1).max(128) }),
    )
    .mutation(async ({ input }) => {
      try {
        return await resolveContradictionEntry({
          key: input.key,
          status: input.status,
          note: input.note,
        });
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Phase B.6c · owner-only · the decision-replay backlog for the
   * DecisionReplayCard · `due` (queued, split unconsumed / consumed-
   * today) + `recent` (last 10 reviewed). Replaces GET
   * /api/system/decision-replays · delegates to the shared
   * `decision-replays.buildDecisionReplaysView` service.
   * DecisionReplayCard polls this on a 5-min interval — now driven by
   * refetchInterval.
   */
  decisionReplays: operatorProcedure.query(async () =>
    buildDecisionReplaysView(),
  ),

  /**
   * Phase B.6c · owner-only · mark a decision-replay row. Replaces POST
   * /api/system/decision-replays/[id]/mark · delegates to the shared
   * `decision-replays.markDecisionReplay` service. Dual-mode (matching
   * the legacy route): omitting `outcome` stamps consumedAt only (the
   * tap-to-chat row click); supplying it ALSO dual-writes the
   * DecisionReplay outcome row (the inline lesson form).
   *
   * Input is the SHARED `decisionReplayMarkSchema` from
   * @/lib/validators/system PLUS an `id` scalar (the route's path
   * param). `outcome` is optional at this layer so the empty-body mark
   * path validates. A missing row → ServiceError(404) → NOT_FOUND; a
   * wrong-category row → ServiceError(400) → BAD_REQUEST · both
   * transports reject identically.
   */
  markDecisionReplay: operatorProcedure
    .input(
      decisionReplayMarkSchema.extend({ id: z.string().min(1).max(128) }),
    )
    .mutation(async ({ input }) => {
      try {
        return await markDecisionReplay({
          id: input.id,
          outcome: input.outcome,
          outcomeScore: input.outcomeScore,
          lesson: input.lesson,
        });
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code:
              err.status === 404
                ? "NOT_FOUND"
                : err.status === 400
                  ? "BAD_REQUEST"
                  : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  // ═════════════ Phase B.7a · system-pages sub-slice A ═════════════
  //
  // The authedFetch call-sites in the first ~13 app/(mastery)/system/*
  // page files migrated onto trpc.system.*. Every procedure delegates
  // to a shared lib/services/ function the legacy REST route ALSO calls
  // · drift structurally impossible. Read procedures return the explicit
  // shallow service shapes (Prisma Json columns projected to `unknown`
  // inside the service · the public AppRouter type stays shallow ·
  // TS2589 firewall).

  /**
   * scattered-components slice · owner-only · resolve a drift alert
   * (the TodoDesk aging-backlog "resolve" button). Replaces the
   * `action: "resolve"` branch of POST /api/drift · delegates to the
   * shared `drift-engine.resolveAlert` the REST route also calls. The
   * route's `action` discriminator is dropped (the procedure name IS
   * the action). DriftAlert.id is `Int @id` but stale localStorage ids
   * arrive stringified (`drift-42` → `42`) — the input accepts both and
   * coerces. A stale id whose row was already resolved / auto-archived
   * resolves `{ ok: true, note: "already gone" }` rather than throwing
   * (the legacy route's swallow-on-not-found behaviour).
   */
  resolveDrift: operatorProcedure
    .input(z.object({ id: z.union([z.string().max(128), z.number()]) }))
    .mutation(async ({ input }) => {
      try {
        await resolveAlert(input.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/Record to update not found|not found/i.test(msg)) {
          return { ok: true as const, note: "already gone" };
        }
        throw err;
      }
      return { ok: true as const };
    }),

  /**
   * Wave H · M1 · state-conditioned calibration grid. Mood × kind ·
   * hit rate per cell. Joins suggestion-loop action rows (now stamped
   * with operator-state snapshot at write-time) with their event
   * outcome. Reveals patterns like "Nick's task suggestions land 65%
   * when mood=energized but 22% when mood=depleted" · raw signal for
   * future state-aware suggestion gating.
   */
  stateCalibration: operatorProcedure
    .input(z.object({ sinceDays: z.number().int().min(1).max(365).optional() }).optional())
    .query(async ({ input }) => {
      return buildStateCalibration({ sinceDays: input?.sinceDays });
    }),

  /**
   * task #22 slice 5.4 · operator-state diagnostic.
   *
   * Returns the deterministic 5-dimensional operator-state snapshot
   * (focus · capacity · drift · momentum · mood) PLUS the formatted
   * system-prompt block (so the /system/operator-state page can show
   * "this is what Nick would see if we wired this in"). LeCun-lens
   * consolidation in one query · cheap (3 Prisma queries · degrades
   * to defaults on DB error · 0-confidence then).
   *
   * Owner-only · this exposes activity counts that aren't sensitive
   * on their own but the policy is "operator surfaces are gated".
   */
  operatorState: operatorProcedure.query(async () => {
    const snapshot = await currentOperatorState();
    return {
      snapshot,
      promptBlock: formatOperatorStateBlock(snapshot),
    };
  }),

  /**
   * Wave W Phase 3 · 2026-05-24 · landing-surface recommendation.
   *
   * Pulls the current operator-state snapshot through `chooseLanding`
   * (pure function in lib/services/operator-state.ts). Returns a
   * single `{ surface, reason }` or null when the snapshot has
   * insufficient confidence to recommend.
   *
   * Substrate-only this wave · UI placement decision deferred to
   * the /chat wave when the homepage gets a redesign. Future
   * consumers: a "Today, start here →" chip on HQ · a Cmd+K
   * "today" command · a morning-brief paragraph opener.
   */
  landingRecommendation: operatorProcedure.query(async () => {
    try {
      const snapshot = await currentOperatorState();
      const { chooseLanding } = await import(
        "@/lib/services/operator-state"
      );
      return chooseLanding(snapshot);
    } catch {
      return null;
    }
  }),

};
