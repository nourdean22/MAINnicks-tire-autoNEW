/**
 * GET /api/system/audit
 *
 * Unified observability endpoint for the /system/audit dashboard.
 * Aggregates the data that used to be scattered across many routes:
 *
 *   - Recent ai_error events grouped by domain
 *   - Tool usage frequency (last 7 days)
 *   - Cron job health (last run per job, success/fail)
 *   - Prompt cache hit rate
 *   - Venice provider status
 *   - Embedding coverage
 *   - Cold memory stats
 *
 * Single endpoint keeps the dashboard snappy (one fetch → full view).
 *
 * v10.0.529.106 · Wave 79 · migrated to apiHandler. No fetch consumers
 * (used as a link target only) so returning the unwrapped data object
 * to let apiHandler envelope it is safe.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { getProviderStatus } from "@/lib/ai/provider";
import { getColdMemoryStats } from "@/lib/brain/cold-memory";
import { getRecentErrors } from "@/lib/errors/record-error";

export const dynamic = "force-dynamic";

interface ErrorGroup {
  domain: string;
  count: number;
  lastSeen: string;
  latestMessage: string;
}

interface ToolUsage {
  toolName: string;
  calls: number;
  avgDurationMs: number;
  lastUsed: string;
}

interface CronHealth {
  job: string;
  lastRun: string;
  status: "ok" | "failed" | "unknown";
  durationMs: number | null;
}

export const GET = apiHandler(
  async () => {
    const nowMs = Date.now();
    const hourAgo = new Date(nowMs - 60 * 60 * 1000);
    const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);

    // ── Parallelized queries for the full dashboard ──
    const [
      errors,
      errorCount60m,
      errorCount24h,
      cronEvents,
      toolCalls,
      promptCacheEvents,
      embedTotal,
      memoryTotal,
    ] = await Promise.all([
      getRecentErrors(60, 20),
      prisma.auditEvent.count({
        where: { eventType: "ai_error", createdAt: { gte: hourAgo } },
      }),
      prisma.auditEvent.count({
        where: { eventType: "ai_error", createdAt: { gte: dayAgo } },
      }),
      prisma.auditEvent.findMany({
        where: {
          createdAt: { gte: weekAgo },
          OR: [
            { eventType: { contains: "cron" } },
            { eventType: { contains: "ingested" } },
            { eventType: { contains: "failed" } },
            { actor: { contains: "cron" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, actor: true, eventType: true, detail: true, createdAt: true, payload: true },
      }),
      prisma.auditEvent.findMany({
        where: { eventType: "chat_tool_call", createdAt: { gte: weekAgo } },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: { detail: true, payload: true, createdAt: true },
      }).catch(() => []),
      prisma.auditEvent.findMany({
        where: { eventType: "prompt_cache", createdAt: { gte: dayAgo } },
        select: { detail: true },
      }).catch(() => []),
      prisma.vectorEmbedding.count().catch(() => 0),
      prisma.brainMemory.count().catch(() => 0),
    ]);

    // ── Group errors by domain ──
    const errorsByDomain = new Map<string, ErrorGroup>();
    for (const e of errors) {
      const existing = errorsByDomain.get(e.domain);
      if (existing) {
        existing.count++;
      } else {
        errorsByDomain.set(e.domain, {
          domain: e.domain,
          count: 1,
          lastSeen: e.createdAt,
          latestMessage: e.detail,
        });
      }
    }

    // ── Group cron events by job ──
    const cronHealth = new Map<string, CronHealth>();
    for (const evt of cronEvents) {
      const job = evt.actor;
      if (cronHealth.has(job)) continue; // first = most recent
      const isFail = /fail|error/i.test(evt.eventType) || /fail/i.test(evt.detail);
      const payload = evt.payload as Record<string, unknown> | null;
      const durationMs =
        typeof payload?.durationMs === "number" ? payload.durationMs : null;
      cronHealth.set(job, {
        job,
        lastRun: evt.createdAt.toISOString(),
        status: isFail ? "failed" : "ok",
        durationMs,
      });
    }

    // ── Tool usage frequency ──
    const toolUsageMap = new Map<string, { calls: number; totalMs: number; lastUsed: string }>();
    for (const call of toolCalls) {
      const payload = call.payload as Record<string, unknown> | null;
      const toolName = (payload?.toolName as string) || call.detail.split(":")[0] || "unknown";
      const durationMs = (payload?.durationMs as number) || 0;
      const existing = toolUsageMap.get(toolName);
      if (existing) {
        existing.calls++;
        existing.totalMs += durationMs;
      } else {
        toolUsageMap.set(toolName, {
          calls: 1,
          totalMs: durationMs,
          lastUsed: call.createdAt.toISOString(),
        });
      }
    }
    const toolUsage: ToolUsage[] = [...toolUsageMap.entries()]
      .map(([name, stats]) => ({
        toolName: name,
        calls: stats.calls,
        avgDurationMs: stats.calls > 0 ? Math.round(stats.totalMs / stats.calls) : 0,
        lastUsed: stats.lastUsed,
      }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 20);

    // ── Prompt cache hit rate ──
    let promptCacheHits = 0;
    let promptCacheTotal = 0;
    for (const evt of promptCacheEvents) {
      promptCacheTotal++;
      if (evt.detail.includes("HIT")) promptCacheHits++;
    }

    // ── Provider status ──
    const providerStatus = getProviderStatus();

    // ── Cold memory stats ──
    const coldStats = await getColdMemoryStats().catch(() => null);

    return {
      generatedAt: new Date().toISOString(),
      errors: {
        count60m: errorCount60m,
        count24h: errorCount24h,
        byDomain: [...errorsByDomain.values()].sort((a, b) => b.count - a.count),
        recent: errors.slice(0, 10),
      },
      crons: [...cronHealth.values()].sort(
        (a, b) => new Date(b.lastRun).getTime() - new Date(a.lastRun).getTime()
      ),
      toolUsage,
      promptCache: {
        hits: promptCacheHits,
        total: promptCacheTotal,
        hitRate: promptCacheTotal > 0 ? promptCacheHits / promptCacheTotal : 0,
      },
      provider: providerStatus,
      memory: {
        totalBrainMemories: memoryTotal,
        totalEmbeddings: embedTotal,
        coveragePct: memoryTotal > 0 ? (embedTotal / memoryTotal) * 100 : 0,
        ...(coldStats || {}),
      },
    };
  },
  { auth: "owner" },
);
