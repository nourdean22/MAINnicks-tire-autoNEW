/**
 * lib/trpc/routers/system/agents.ts
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
import { ServiceError } from "@/lib/utils/service-error";
import {
  buildAutonomousActionsFeed,
  buildAgentTracesFeed,
  buildAgentTraceDetail,
} from "@/lib/services/system-pages";
import {
  buildVapiCallStats,
  buildToolStats,
  buildRoutePerformance,
  buildTireStockRequests,
} from "@/lib/services/system-pages-b";
import {
  buildAgentTraceByMessage,
} from "@/lib/services/agent-trace-by-message";
const TraceSourceSchema = z.enum([
  "chat",
  "cron",
  "autonomous",
  "tool",
  "journal",
  "brain",
  "other",
]);

export const agentsProcedures = {
  /**
   * Phase B.7a · owner-only · Nick's autonomous-action audit feed ·
   * grouped-by-rule leaderboard + latest 100 rows + approval breakdown.
   * Replaces GET /api/system/actions · delegates to the shared
   * `system-pages.buildAutonomousActionsFeed` service. The legacy
   * `?since` / `?rule` / `?approval` query params are mirrored as typed
   * optional inputs. ActionsPage polls this on a 30s interval · React
   * Query drives the refetch · the input object is the query key so
   * changing a filter triggers a refetch without a manual `load()`.
   */
  autonomousActions: operatorProcedure
    .input(
      z
        .object({
          since: z.enum(["24h", "7d", "30d"]).optional(),
          rule: z.string().max(200).optional(),
          approval: z
            .enum(["auto", "pending", "approved", "rejected"])
            .optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildAutonomousActionsFeed({
        since: input?.since,
        rule: input?.rule,
        approval: input?.approval,
      }),
    ),

  /**
   * Phase B.7a · owner-only · recent agent-trace chains + roll-ups + a
   * prior-24h baseline for the TrendCounter deltas. Replaces GET
   * /api/system/agent-traces · delegates to the shared
   * `system-pages.buildAgentTracesFeed` service. The legacy `?limit`
   * (clamped 1-100) / `?source` query params are mirrored as typed
   * inputs · `source` is strict to the TraceSource enum. AgentTracesPage
   * keys on the input object so switching the source filter refetches.
   */
  agentTraces: operatorProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          source: TraceSourceSchema.optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildAgentTracesFeed({
        limit: input?.limit,
        source: input?.source,
      }),
    ),

  /**
   * Phase B.7a · owner-only · the full chain for one trace + per-row +
   * consolidated explainability envelope. Replaces GET
   * /api/system/agent-traces/[traceId] · delegates to the shared
   * `system-pages.buildAgentTraceDetail` service. An unknown traceId
   * throws ServiceError(404) → NOT_FOUND so both transports reject
   * identically (the page branches on the 404 to show a "stale link"
   * message).
   */
  agentTraceDetail: operatorProcedure
    .input(z.object({ traceId: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      try {
        return await buildAgentTraceDetail(input.traceId);
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
   * Cross-domain residuals slice · owner-only · resolve a ChatMessage
   * to its agent-trace chain (the "why this answer" panel under each
   * Nick reply). Replaces GET /api/system/agent-traces/by-message/
   * [messageId] · delegates to the shared
   * `agent-trace-by-message.buildAgentTraceByMessage` service. Distinct
   * from `agentTraceDetail` (the /system page · keyed by traceId) — this
   * is keyed by messageId and carries the fresh-stream fallbacks.
   *
   * The route's path param + optional `?conversationId` query param are
   * mirrored as a strict typed input. The ReasoningTrace card lazy-
   * fetches this via `utils.system.agentTraceByMessage.fetch()` only on
   * expand. A missing-and-unresolvable message throws ServiceError(404)
   * → NOT_FOUND so both transports reject identically.
   */
  agentTraceByMessage: operatorProcedure
    .input(
      z.object({
        messageId: z.string().min(1).max(128),
        conversationId: z.string().min(1).max(64).optional(),
      }),
    )
    .query(async ({ input }) => {
      try {
        return await buildAgentTraceByMessage(
          input.messageId,
          input.conversationId,
        );
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

  // ═══════════ scattered-components REST→tRPC slice · system/* ═══════════
  //
  // The drift / session-expiry / client-error endpoints the migrated
  // components/{ultron/today,hud,ui}/* surfaces hit. Each procedure
  // delegates to a shared function the legacy REST route ALSO calls ·
  // drift structurally impossible. None returns a Prisma row · the
  // AppRouter stays trivially shallow.

  /**
   * Phase B.7b · owner-only · tool registry + family rollup · joins
   * the static TOOL_FAMILIES metadata with live availability +
   * BrainMemory-backed telemetry + a registry-drift report. Replaces
   * GET /api/system/tools/stats · delegates to the shared
   * `system-pages-b.buildToolStats` service. No input. The legacy
   * route wrapped the payload in `{ data }`; the procedure returns it
   * unwrapped and ToolsPage reads the object directly.
   */
  toolStats: operatorProcedure.query(async () => buildToolStats()),

  /**
   * Phase B.7b · owner-only · per-route latency percentiles
   * (p50/p95/p99 + error rate) over a configurable window. Replaces
   * GET /api/system/performance · delegates to the shared
   * `system-pages-b.buildRoutePerformance` service. The legacy
   * `?hours` (clamped 1-720) / `?minRequests` (floored at 1) query
   * params are mirrored as typed inputs · PerformancePage keys on the
   * input so switching the window refetches.
   */
  routePerformance: operatorProcedure
    .input(
      z
        .object({
          hours: z.number().int().min(1).max(720).optional(),
          minRequests: z.number().int().min(1).max(1000).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildRoutePerformance({
        hours: input?.hours,
        minRequests: input?.minRequests,
      }),
    ),

  /**
   * Phase B.7b · owner-only · VAPI call analytics · status / endReason
   * breakdown + avg duration + spend + most-recent call. Replaces GET
   * /api/system/vapi-calls · delegates to the shared
   * `system-pages-b.buildVapiCallStats` service (the VAPI key stays
   * server-side). The legacy `?days` query param (clamped 1-90) is
   * mirrored as a typed input · VapiCallsPage polls this on a 60s
   * interval and keys on the input so switching the window refetches.
   * The legacy route's apiHandler wrapped the payload in `{ data }`;
   * the procedure returns it unwrapped.
   */
  vapiCalls: operatorProcedure
    .input(
      z
        .object({ days: z.number().int().min(1).max(90).optional() })
        .optional(),
    )
    .query(async ({ input }) => buildVapiCallStats({ days: input?.days })),

  /**
   * Phase B.7b · owner-only · the used-tire stock-check log · top-
   * asked sizes + urgency mix + daily histogram + recent calls.
   * Replaces GET /api/system/tire-stock-requests · delegates to the
   * shared `system-pages-b.buildTireStockRequests` service (the
   * BrainMemory Json `content` column is JSON.parsed + projected to
   * scalar fields inside the service). The legacy `?days` query param
   * (clamped 1-365) is mirrored as a typed input · TireStockRequests
   * Page polls this on a 60s interval and keys on the input so
   * switching the window refetches.
   */
  tireStockRequests: operatorProcedure
    .input(
      z
        .object({ days: z.number().int().min(1).max(365).optional() })
        .optional(),
    )
    .query(async ({ input }) =>
      buildTireStockRequests({ days: input?.days }),
    ),

  /**
   * Cockpit Observability stats. Pulls cost, TTFT averages, memory decay aggregates,
   * recent runs, and prompt versions table.
   */
  cockpitStats: operatorProcedure.query(async () => {
    const { prisma } = await import("@/lib/prisma");

    // 1. KPI Metrics
    const costAgg = { _sum: { costCents: 0 as number | null }, _avg: { durationMs: 0 as number | null } };

    const totalCostCents = costAgg._sum.costCents ?? 0;
    const avgDurationMs = costAgg._avg.durationMs ?? 0;

    // Fetch durMs for p95
    const durations: Array<{ durationMs: number }> = [];
    const p95Idx = Math.floor(durations.length * 0.95);
    const p95TtftMs = durations[p95Idx]?.durationMs ?? 0;

    const feedbackAgg = { _avg: { score: 0 as number | null } };
    const averageFeedback = feedbackAgg._avg.score ?? 0;

    const pendingApprovalsCount = await prisma.approvalRequest.count({
      where: { status: "pending_approval" },
    });

    // 2. Timeline of recent runs
    const recentRuns: Array<{
      id: string;
      traceId: string;
      model: string;
      provider: string;
      status: string;
      costCents: number;
      durationMs: number;
      feedback: { score: number; note: string } | null;
      createdAt: Date;
    }> = [];

    // 3. Memory Category usage (for Decay Visualizer)
    const memoryHits: Array<{ category: string; _count: { _all: number } }> = [];

    // 4. Prompt versions table
    const promptVersionsRaw = await prisma.promptVersion.findMany({
      orderBy: { version: "desc" },
    }) as unknown as Array<{
      id: string;
      version: number;
      active: boolean;
      systemPrompt: string;
      createdAt: Date;
      runs: Array<{ feedback: { score: number } | null }>;
    }>;

    const promptVersions = promptVersionsRaw.map((pv) => {
      const runsWithFeedback = pv.runs.filter((r) => r.feedback !== null);
      const avgScore =
        runsWithFeedback.length > 0
          ? runsWithFeedback.reduce((acc, r) => acc + (r.feedback?.score ?? 0), 0) /
            runsWithFeedback.length
          : 0;

      return {
        id: pv.id,
        version: pv.version,
        active: pv.active,
        systemPrompt: pv.systemPrompt.slice(0, 100) + "...",
        createdAt: pv.createdAt.toISOString(),
        totalRuns: pv.runs.length,
        averageFeedback: avgScore,
      };
    });

    return {
      kpis: {
        totalCostCents,
        p95TtftMs,
        averageFeedback,
        pendingApprovalsCount,
        avgDurationMs,
      },
      recentRuns: recentRuns.map((r) => ({
        id: r.id,
        traceId: r.traceId,
        model: r.model,
        provider: r.provider,
        status: r.status,
        costCents: r.costCents,
        durationMs: r.durationMs,
        feedback: r.feedback,
        createdAt: r.createdAt.toISOString(),
      })),
      memoryDecay: memoryHits.map((mh) => ({
        category: mh.category,
        count: mh._count._all,
      })),
      promptVersions,
    };
  }),

  /**
   * Set specific prompt version active and disable other versions.
   */
  setActivePromptVersion: operatorProcedure
    .input(z.object({ version: z.number().int() }))
    .mutation(async ({ input }) => {
      const { prisma } = await import("@/lib/prisma");

      // Set all other prompt versions to active = false
      await prisma.promptVersion.updateMany({
        where: { active: true },
        data: { active: false },
      });

      // Set the specified version to active = true
      await prisma.promptVersion.update({
        where: { version: input.version },
        data: { active: true },
      });

      return { success: true };
    }),

};
