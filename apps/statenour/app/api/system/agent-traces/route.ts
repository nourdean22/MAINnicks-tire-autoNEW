/**
 * GET /api/system/agent-traces · v10 Track E.5 · Apr 30.
 *
 * Operator-facing endpoint for /system/agent-traces. Returns:
 *   - top-N most-recent trace chains
 *   - each chain has root info + child calls + roll-ups
 *
 * Owner-gated. Read-only. Composes with v10.0.8 AgentTrace contract.
 *
 * Query params:
 *   ?limit  default 25, clamped [1, 100]
 *   ?source filter by TraceSource (chat | cron | autonomous | tool | journal | brain | other)
 */

import { apiHandler } from "@/lib/utils/http";
import {
  listRecentTraceChains,
  type TraceSource,
} from "@/lib/ai/agent-trace";
import { prisma } from "@/lib/prisma";

const VALID_SOURCES: ReadonlyArray<TraceSource> = [
  "chat",
  "cron",
  "autonomous",
  "tool",
  "journal",
  "brain",
  "other",
];

function isTraceSource(s: string | null): s is TraceSource {
  return s != null && (VALID_SOURCES as ReadonlyArray<string>).includes(s);
}

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get("limit") ?? "25", 10);
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(limitParam, 100))
      : 25;
    const sourceParam = url.searchParams.get("source");
    const source = isTraceSource(sourceParam) ? sourceParam : undefined;

    const chains = await listRecentTraceChains({ limit, source });

    // Roll-ups across the visible window — fast operator pulse.
    const totalCalls = chains.reduce((acc, c) => acc + c.callCount, 0);
    const totalCostCents = chains.reduce(
      (acc, c) => acc + c.totalCostCents,
      0,
    );
    const totalDurationMs = chains.reduce(
      (acc, c) => acc + c.totalDurationMs,
      0,
    );
    const errorChains = chains.filter((c) => c.hasError).length;

    // v10.0.223 · prior-24h baseline for TrendCounter deltas. Counts
    // span from current oldest chain back another 24h. Cheap aggregate
    // — single SQL pass against agent_traces. Filtered by source if
    // the operator is filtering the live window.
    const oldestVisible = chains.length > 0
      ? chains[chains.length - 1].startedAt
      : new Date();
    const priorWindowMs = 24 * 3600_000;
    const priorStart = new Date(oldestVisible.getTime() - priorWindowMs);
    const priorEnd = oldestVisible;
    const priorAgg = await prisma.agentTrace.groupBy({
      by: ["traceId"],
      where: {
        createdAt: { gte: priorStart, lt: priorEnd },
        ...(source ? { source } : {}),
      },
      _count: { _all: true },
      _sum: { costCents: true, durationMs: true },
      _max: { errorClass: true },
    });
    const priorChainCount = priorAgg.length;
    const priorTotalCalls = priorAgg.reduce((s, r) => s + r._count._all, 0);
    const priorTotalCostCents = priorAgg.reduce((s, r) => s + (r._sum.costCents ?? 0), 0);
    const priorTotalDurationMs = priorAgg.reduce((s, r) => s + (r._sum.durationMs ?? 0), 0);
    const priorErrorChains = priorAgg.filter((r) => r._max.errorClass !== null).length;

    return {
      generatedAt: new Date().toISOString(),
      filter: { limit, source: source ?? null },
      stats: {
        chainCount: chains.length,
        totalCalls,
        totalCostCents,
        totalDurationMs,
        errorChains,
        errorRate:
          chains.length > 0 ? errorChains / chains.length : 0,
      },
      // v10.0.223 · prior-24h baseline · drives TrendCounter deltas
      // on the 5-axis pulse summary. Same filter as the live window
      // (source) so deltas compare like-for-like.
      previous: {
        chainCount: priorChainCount,
        totalCalls: priorTotalCalls,
        totalCostCents: priorTotalCostCents,
        totalDurationMs: priorTotalDurationMs,
        errorChains: priorErrorChains,
      },
      chains: chains.map((c) => ({
        ...c,
        startedAt: c.startedAt.toISOString(),
        children: c.children.map((child) => ({
          ...child,
          startedAt: child.startedAt.toISOString(),
        })),
      })),
    };
  },
  { auth: "owner" }, // v9.1.14 sensitive-GET gate compliance
);
