/**
 * GET /api/system/chat-health — chat-route operator rollup.
 *
 * Single endpoint feeding /system/chat-health. Pulls from
 * AiGeneration, ApiRequestLog, ErrorLog, ToolTelemetry (typed table,
 * post-Wave-53), AuditEvent — every signal needed to answer "is the
 * chat layer healthy and fast right now?"
 *
 * Returns:
 *   · TTFT p50/p95/p99 (last 24h chat requests)
 *   · cost / turn distribution
 *   · regen rate (reply-gate failures)
 *   · top error fingerprints
 *   · tool failure leaderboard
 *   · turn count + provider distribution
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { safeQuery } from "@/lib/db/safe-prisma";
import { getBlockedTools } from "@/lib/ai/tool-telemetry";
import { getCacheStats } from "@/lib/ai/system-prompt-cache";
import { requireSession } from "@/lib/auth-guard";

export async function GET(req: Request) {
  await requireSession(req);
  const since24h = new Date(Date.now() - 24 * 3600_000);
  const since7d = new Date(Date.now() - 7 * 86400_000);

  const [
    chatLatency,
    chatCost,
    chatVolume,
    topErrors,
    toolHealth,
    qualityRows,
    providerMix,
  ] = await Promise.all([
    // Latency percentiles via Postgres percentile_cont — same path
    // used by /system/performance.
    safeQuery(
      async () => {
        const rows = await prisma.$queryRaw<
          Array<{
            p50_ms: number | null;
            p95_ms: number | null;
            p99_ms: number | null;
            avg_ms: number | null;
            n: bigint;
          }>
        >`
          SELECT
            percentile_cont(0.5)  WITHIN GROUP (ORDER BY duration_ms)::float8 AS p50_ms,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p95_ms,
            percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p99_ms,
            AVG(duration_ms)::float8 AS avg_ms,
            COUNT(*)::bigint AS n
          FROM api_request_logs
          WHERE created_at >= ${since24h}
            AND path = '/api/ai/chat'
        `;
        const r = rows[0];
        return {
          p50: Math.round(Number(r?.p50_ms ?? 0)),
          p95: Math.round(Number(r?.p95_ms ?? 0)),
          p99: Math.round(Number(r?.p99_ms ?? 0)),
          avg: Math.round(Number(r?.avg_ms ?? 0)),
          requests24h: Number(r?.n ?? 0),
        };
      },
      { p50: 0, p95: 0, p99: 0, avg: 0, requests24h: 0 },
      { label: "chat-health.latency" },
    ),

    // AI cost — chat feature only.
    safeQuery(
      async () => {
        const rows = await prisma.$queryRaw<
          Array<{ cost_24h: bigint | null; cost_7d: bigint | null; n_24h: bigint }>
        >`
          SELECT
            COALESCE(SUM(cost_cents) FILTER (WHERE created_at >= ${since24h}), 0)::bigint AS cost_24h,
            COALESCE(SUM(cost_cents) FILTER (WHERE created_at >= ${since7d}), 0)::bigint AS cost_7d,
            COUNT(*) FILTER (WHERE created_at >= ${since24h})::bigint AS n_24h
          FROM ai_generations
          WHERE feature = 'chat'
        `;
        const r = rows[0];
        const calls24h = Number(r?.n_24h ?? 0);
        const cents24h = Number(r?.cost_24h ?? 0);
        return {
          totalCents24h: cents24h,
          totalCents7d: Number(r?.cost_7d ?? 0),
          avgPerTurnCents: calls24h > 0 ? cents24h / calls24h : 0,
        };
      },
      { totalCents24h: 0, totalCents7d: 0, avgPerTurnCents: 0 },
      { label: "chat-health.cost" },
    ),

    // Volume + error rate.
    safeQuery(
      async () => {
        const rows = await prisma.$queryRaw<
          Array<{ total: bigint; errors: bigint }>
        >`
          SELECT
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS errors
          FROM api_request_logs
          WHERE created_at >= ${since24h}
            AND path = '/api/ai/chat'
        `;
        const r = rows[0];
        const total = Number(r?.total ?? 0);
        const errors = Number(r?.errors ?? 0);
        return {
          total,
          errors,
          errorRate: total > 0 ? errors / total : 0,
        };
      },
      { total: 0, errors: 0, errorRate: 0 },
      { label: "chat-health.volume" },
    ),

    // Top error fingerprints in last 24h.
    safeQuery(
      async () => {
        const rows = await prisma.errorLog.groupBy({
          by: ["message"],
          where: {
            createdAt: { gte: since24h },
            // Restrict to chat-adjacent errors via context
            OR: [
              { context: { path: ["source"], equals: "chat" } },
              { stack: { contains: "ai/chat" } },
            ],
          },
          _count: { id: true },
          _max: { createdAt: true },
          orderBy: { _count: { id: "desc" } },
          take: 5,
        });
        return rows.map((e) => ({
          message: e.message,
          count: e._count.id,
          lastSeen: e._max.createdAt?.toISOString() ?? null,
        }));
      },
      [] as Array<{ message: string; count: number; lastSeen: string | null }>,
      { label: "chat-health.errors" },
    ),

    // v10.0.529.106 · Wave 53 · Phase 3 cutover · reads the typed
    // ToolTelemetry table directly · pre-Wave-53 this scanned
    // BrainMemory(category=tool_telemetry) and parsed the JSON blob
    // client-side per row.
    safeQuery(
      async () => {
        const rows = await prisma.toolTelemetry.findMany({
          orderBy: { lastCallAt: "desc" },
          take: 20,
          select: {
            toolName: true,
            totalCalls: true,
            successCount: true,
            failCount: true,
            totalDurationMs: true,
            lastErrors: true,
            lastCallAt: true,
          },
        });
        return rows.map((r) => {
          const durationMs = Number(r.totalDurationMs);
          const successRate = r.totalCalls > 0 ? r.successCount / r.totalCalls : 0;
          const avgMs = r.totalCalls > 0 ? Math.round(durationMs / r.totalCalls) : 0;
          const errors = (r.lastErrors as Array<{ message: string; at: number }> | null) ?? [];
          return {
            tool: r.toolName,
            calls: r.totalCalls,
            successRate,
            avgMs,
            failCount: r.failCount,
            lastCallAt: r.lastCallAt ? r.lastCallAt.getTime() : null,
            recentErrors: errors.slice(0, 2),
          };
        });
      },
      [] as Array<{
        tool: string;
        calls: number;
        successRate: number;
        avgMs: number;
        failCount: number;
        lastCallAt: number | null;
        recentErrors: Array<{ message: string; at: number }>;
      }>,
      { label: "chat-health.tools" },
    ),

    // Reply-gate / quality data from chat-message tokenUsage.
    safeQuery(
      async () => {
        const rows = await prisma.chatMessage.findMany({
          where: {
            createdAt: { gte: since24h },
            role: "assistant",
          },
          select: { tokenUsage: true },
          take: 200,
        });
        let total = 0;
        let regenSuggested = 0;
        let qualitySum = 0;
        for (const r of rows) {
          total++;
          const tu = r.tokenUsage as Record<string, unknown> | null;
          const quality = tu?.quality as { score?: number; regen?: boolean } | undefined;
          if (typeof quality?.score === "number") qualitySum += quality.score;
          if (quality?.regen === true) regenSuggested++;
        }
        return {
          assistantTurns: total,
          regenSuggested,
          regenRate: total > 0 ? regenSuggested / total : 0,
          avgQuality: total > 0 ? qualitySum / total : 0,
        };
      },
      { assistantTurns: 0, regenSuggested: 0, regenRate: 0, avgQuality: 0 },
      { label: "chat-health.quality" },
    ),

    // Provider distribution from AiGeneration model field.
    safeQuery(
      async () => {
        const rows = await prisma.aiGeneration.groupBy({
          by: ["model"],
          where: { feature: "chat", createdAt: { gte: since24h } },
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
          take: 10,
        });
        return rows.map((r) => ({ model: r.model, count: r._count.id }));
      },
      [] as Array<{ model: string; count: number }>,
      { label: "chat-health.provider" },
    ),
  ]);

  return NextResponse.json({
    data: {
      window: { hours: 24, since: since24h.toISOString() },
      latency: chatLatency,
      cost: chatCost,
      volume: chatVolume,
      quality: qualityRows,
      topErrors,
      toolHealth: toolHealth.sort((a, b) => b.calls - a.calls),
      problemTools: toolHealth.filter(
        (t) => t.calls >= 5 && t.successRate < 0.7,
      ),
      providerMix,
      blockedTools: getBlockedTools(),
      promptCache: getCacheStats(),
      generatedAt: new Date().toISOString(),
    },
  });
}
