/**
 * lib/trpc/routers/nick.ts · Phase J (2026-05-18 PM)
 *
 * Reasoning engine procedures. Replaces:
 *   · POST /api/nick/reason          → reason
 *   · GET  /api/nick/reason/history  → history
 *   · GET  /api/nick/reason/telemetry → telemetry
 *
 * NOT migrated: POST /api/nick/reason/stream (SSE · stays REST · tRPC
 * subscription migration would require WebSocket infrastructure ·
 * scoped to a future wave).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, operatorProcedure } from "../trpc";
import { reason } from "@/lib/ai/reasoning/engine";
import { classifyReasoning } from "@/lib/ai/reasoning/classifier";
import { checkBudget, reserveBudget, releaseReservation } from "@/lib/ai/reasoning/budget";
import {
  DEFAULT_DAILY_CAP_USD,
  __internals as budgetInternals,
} from "@/lib/ai/reasoning/budget";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
// Cross-domain residuals slice (2026-05-22) · the proactive-suggestion
// aggregator the NickSuggestions chip strip reads. The shared service
// is also called by the legacy GET /api/nick/suggest route — drift
// structurally impossible.
import { buildNickSuggestions } from "@/lib/services/nick-suggestions";
// Task #13 (2026-05-23) · specialist sub-agent router · operator-only
// classification endpoint. Gated behind ENABLE_SPECIALIST_ROUTING; when
// the flag is off the procedure still works but always returns
// `{ route: "general", reason: "routing-disabled" }`.
import { routeMessage } from "@/lib/ai/agents/router";

const VALID_TIERS = ["quick", "standard", "smart", "deep", "thorough", "mega"] as const;
const TierSchema = z.enum(VALID_TIERS);

const ReasonInput = z.object({
  question: z.string().min(1).max(4000),
  brainContext: z.string().max(8000).optional(),
  tier: TierSchema.optional(),
  confirmExpensive: z.boolean().optional(),
  persist: z.boolean().optional(),
});

function detectPrivateMarker(text: string): boolean {
  return /\b(@private|\/private)\b/i.test(text);
}

export const nickRouter = router({
  /**
   * Run the reasoning engine for a question. Mirrors the H.6+ POST
   * /api/nick/reason behavior · budget gate · mega confirm · persist
   * opt-out · returns ReasoningResult.
   */
  reason: operatorProcedure
    .input(ReasonInput)
    .mutation(async ({ input }) => {
      const effectiveTier = input.tier ?? classifyReasoning(input.question).tier;

      // H.3.4 · mega confirm gate
      if (effectiveTier === "mega" && input.confirmExpensive !== true) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Mega tier runs $0.20+ per call. Re-send with confirmExpensive=true to proceed.",
          cause: new Error(JSON.stringify({
            error: "confirm_expensive",
            tier: "mega",
            estimatedUsd: 0.25,
          })),
        });
      }

      // H.3.3 + H.6.2 + H.7.2 · budget gate with in-flight reservation
      const budget = await checkBudget(effectiveTier);
      if (!budget.allow) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: budget.reason,
          cause: new Error(JSON.stringify({
            error: "budget_exceeded",
            spentTodayUsd: budget.spentTodayUsd,
            inFlightUsd: budget.inFlightUsd,
            capUsd: budget.capUsd,
            estimatedRunUsd: budget.estimatedRunUsd,
          })),
        });
      }

      const reservation = await reserveBudget(effectiveTier, budget.estimatedRunUsd);
      const persist =
        input.persist === false
          ? false
          : input.persist === true
            ? true
            : !detectPrivateMarker(input.question);
      try {
        return await reason({
          question: input.question,
          brainContext: input.brainContext,
          tier: input.tier,
          persist,
        });
      } finally {
        void releaseReservation(reservation);
      }
    }),

  /**
   * Read the last N persisted reasoning_trace rows. Mirrors GET
   * /api/nick/reason/history. Returns history + stats.
   */
  history: operatorProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 50;

      const rows = await prisma.brainMemory.findMany({
        where: { category: BRAIN_CATEGORIES.REASONING_TRACE, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          content: true,
          confidence: true,
          createdAt: true,
          metadata: true,
        },
      });

      const history = rows.map((r) => {
        const m = r.content.match(/^\[([^\]]+)\]\s*(.*?)\s*→\s*(.*)$/);
        const tier = m?.[1] ?? "unknown";
        const question = m?.[2] ?? r.content;
        const answer = m?.[3] ?? "";
        const meta = (r.metadata ?? {}) as {
          tier?: string;
          classifierReason?: string;
          totalMs?: number;
          calls?: number;
          usd?: number;
          stepCount?: number;
          stepKinds?: string[];
        };
        return {
          id: r.id,
          question,
          answer,
          tier: meta.tier ?? tier,
          classifierReason: meta.classifierReason ?? "",
          totalMs: typeof meta.totalMs === "number" ? meta.totalMs : 0,
          calls: typeof meta.calls === "number" ? meta.calls : 0,
          usd: typeof meta.usd === "number" ? meta.usd : 0,
          confidence: r.confidence ?? 0,
          stepCount: typeof meta.stepCount === "number" ? meta.stepCount : 0,
          stepKinds: Array.isArray(meta.stepKinds) ? meta.stepKinds : [],
          createdAt: r.createdAt.toISOString(),
        };
      });

      const totalRuns = history.length;
      const totalSpendAllUsd = Math.round(
        history.reduce((s, h) => s + h.usd, 0) * 1000,
      ) / 1000;
      const rawSpend = await budgetInternals.getTodaySpendUsd();
      const spentTodayUsd = typeof rawSpend === "number" ? rawSpend : 0;
      const tierCounts: Record<string, number> = {};
      for (const h of history) tierCounts[h.tier] = (tierCounts[h.tier] ?? 0) + 1;

      return {
        history,
        stats: {
          totalRuns,
          totalSpendAllUsd,
          spentTodayUsd,
          dailyCapUsd: DEFAULT_DAILY_CAP_USD,
          tierCounts,
        },
        fetchedAt: new Date().toISOString(),
      };
    }),

  /**
   * Aggregated telemetry · per-tier latency p50/p95 + cost + fallback
   * rate + classifier marker quality. Mirrors GET /api/nick/reason/telemetry.
   */
  telemetry: operatorProcedure.query(async () => {
    const rows = await prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.REASONING_TRACE, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { createdAt: true, confidence: true, metadata: true },
    });

    const byTier = new Map<
      string,
      { latencies: number[]; costs: number[]; confidences: number[]; fallbackCount: number }
    >();
    const markerCounts: Record<string, number> = {};
    const markerQuality = new Map<string, { confidences: number[]; fallbacks: number }>();

    for (const r of rows) {
      const m = (r.metadata ?? {}) as {
        tier?: string;
        classifierReason?: string;
        totalMs?: number;
        usd?: number;
      };
      const tier = m.tier ?? "unknown";
      const entry = byTier.get(tier) ?? {
        latencies: [],
        costs: [],
        confidences: [],
        fallbackCount: 0,
      };
      entry.latencies.push(m.totalMs ?? 0);
      entry.costs.push(m.usd ?? 0);
      entry.confidences.push(r.confidence ?? 0);
      if ((r.confidence ?? 0) <= 0.3) entry.fallbackCount += 1;
      byTier.set(tier, entry);

      const reason = (m.classifierReason ?? "").trim();
      if (reason) {
        const bucket = reason.split(/\s+/)[0] || "other";
        markerCounts[bucket] = (markerCounts[bucket] ?? 0) + 1;
        const qual = markerQuality.get(bucket) ?? { confidences: [], fallbacks: 0 };
        qual.confidences.push(r.confidence ?? 0);
        if ((r.confidence ?? 0) <= 0.3) qual.fallbacks += 1;
        markerQuality.set(bucket, qual);
      }
    }

    const percentile = (sorted: number[], pct: number): number =>
      sorted.length === 0
        ? 0
        : sorted[Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length))];

    const tierStats = Array.from(byTier.entries())
      .map(([tier, e]) => {
        const sortedLat = [...e.latencies].sort((a, b) => a - b);
        const sum = (arr: number[]) => arr.reduce((s, n) => s + n, 0);
        return {
          tier,
          runs: e.latencies.length,
          avgLatencyMs: Math.round(sum(e.latencies) / Math.max(1, e.latencies.length)),
          p50LatencyMs: percentile(sortedLat, 50),
          p95LatencyMs: percentile(sortedLat, 95),
          avgCostUsd:
            Math.round((sum(e.costs) / Math.max(1, e.costs.length)) * 10000) / 10000,
          totalCostUsd: Math.round(sum(e.costs) * 1000) / 1000,
          avgConfidence:
            Math.round((sum(e.confidences) / Math.max(1, e.confidences.length)) * 1000) /
            1000,
          fallbackRate:
            Math.round((e.fallbackCount / Math.max(1, e.latencies.length)) * 1000) / 10,
        };
      })
      .sort((a, b) => b.runs - a.runs);

    const markerQualityRows = Array.from(markerQuality.entries())
      .map(([marker, q]) => {
        const avg =
          q.confidences.reduce((s, n) => s + n, 0) /
          Math.max(1, q.confidences.length);
        const fb = (q.fallbacks / Math.max(1, q.confidences.length)) * 100;
        const verdict: "good" | "ok" | "tune" =
          avg >= 0.75 && fb < 10 ? "good" : avg >= 0.5 && fb < 25 ? "ok" : "tune";
        return {
          marker,
          count: q.confidences.length,
          avgConfidence: Math.round(avg * 1000) / 1000,
          fallbackRate: Math.round(fb * 10) / 10,
          verdict,
        };
      })
      .sort((a, b) => b.count - a.count);

    const totalRuns = rows.length;
    const totalSpendAll =
      Math.round(tierStats.reduce((s, t) => s + t.totalCostUsd, 0) * 1000) / 1000;
    const rawSpend = await budgetInternals.getTodaySpendUsd();
    const spentTodayUsd = typeof rawSpend === "number" ? rawSpend : 0;

    return {
      totals: {
        totalRuns,
        totalSpendAllUsd: totalSpendAll,
        spentTodayUsd,
        dailyCapUsd: DEFAULT_DAILY_CAP_USD,
        oldestRun: rows[rows.length - 1]?.createdAt?.toISOString() ?? null,
        newestRun: rows[0]?.createdAt?.toISOString() ?? null,
      },
      tierStats,
      markerCounts,
      markerQuality: markerQualityRows,
      fetchedAt: new Date().toISOString(),
    };
  }),

  /**
   * Cross-domain residuals slice (2026-05-22) · owner-only · the Nick
   * proactive-layer aggregator · cross-references mastery scores ·
   * stuck/overdue tasks · stalled goals · pattern clusters · orphan
   * nudges · contradictions · unresolved reflections · broken promises
   * · stale pins into ≤5 severity-ranked suggestion chips. Replaces GET
   * /api/nick/suggest · delegates to the shared
   * `nick-suggestions.buildNickSuggestions` service the REST route also
   * calls · drift impossible.
   *
   * No input · the feed is operator-scoped. NickSuggestions polls this
   * on a 60s interval + an onDataChanged refresh — React Query now
   * drives the refetch. The legacy route's `cache: "no-store"` semantics
   * are preserved via `staleTime: 0` at the call-site. Returns the
   * explicit shallow `NickSuggestionsView` (every signal is a scalar
   * projection · no Prisma Json reaches the AppRouter · TS2589 firewall).
   */
  suggestions: operatorProcedure.query(async () => buildNickSuggestions()),

  /**
   * AG-21 (2026-07-09) · persona effectiveness scores. The write side
   * (recordPersonaUsage) has fed BrainMemory(persona_usage) from all
   * three reasoning sub-pipelines since M.2, but scorePersonas() had
   * zero callers — the accumulated telemetry was invisible. Read-only;
   * returns sorted PersonaScore[] with good/ok/tune verdicts. This is
   * the prerequisite surface for any future scorer-driven selection.
   */
  personaScores: operatorProcedure.query(async () => {
    const { scorePersonas } = await import("@/lib/ai/personas/scorer");
    return scorePersonas();
  }),

  /**
   * Task #13 (2026-05-23) · classify a message → route decision.
   * Diagnostics-only · the live chat handler does NOT call this; it
   * lives here so the operator UI can surface "this turn would route
   * to <specialist>" affordance + so tests can exercise the router
   * via a stable API surface.
   *
   * When ENABLE_SPECIALIST_ROUTING != "true", every call returns
   * `{ route: "general", reason: "routing-disabled", confidence: 1 }`
   * (the router itself short-circuits on the flag).
   */
  classifyMessage: operatorProcedure
    .input(
      z.object({
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant", "system"]),
              content: z.string().min(1).max(4000),
            }),
          )
          .min(1)
          .max(20),
      }),
    )
    .mutation(async ({ input }) => {
      return routeMessage({ messages: input.messages });
    }),
});
