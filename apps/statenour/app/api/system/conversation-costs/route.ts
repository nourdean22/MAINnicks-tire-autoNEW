/**
 * GET /api/system/conversation-costs?range=7d|30d|all&limit=50
 *
 * Per-conversation cost breakdown. Joins ChatMessage native cost
 * columns (populated by C2) with AiGeneration (which has the
 * authoritative per-call cost calc) so the panel shows:
 *   · Cost per conversation (sum across all assistant turns)
 *   · Token totals (prompt + completion)
 *   · Latency stats (avg, p95)
 *   · Provider breakdown
 *
 * v7.6 · C11 · Apr 29 · ChatMessage Batch A.
 *
 * Why this matters: /system/costs already exists with provider lanes
 * + budget gauge. C11 adds a CONVERSATION dimension so Nour can spot
 * "wait, this one chat cost $4 — what was I doing?" and click through
 * to see the actual conversation.
 *
 * Auth: session.
 *
 * v10.0.529.106 · Wave 79 · migrated to apiHandler. No external UI
 * consumers found · returning unwrapped data lets the envelope wrap
 * cleanly.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Range = "1d" | "7d" | "30d" | "all";

function rangeToMs(r: Range): number | null {
  switch (r) {
    case "1d":  return 24 * 60 * 60 * 1000;
    case "7d":  return 7 * 24 * 60 * 60 * 1000;
    case "30d": return 30 * 24 * 60 * 60 * 1000;
    case "all": return null;
  }
}

interface ConvCostRow {
  conversation_id: string;
  title: string | null;
  message_count: bigint;
  total_cost_cents: bigint | null;
  total_prompt_tokens: bigint | null;
  total_completion_tokens: bigint | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  primary_provider: string | null;
  last_active_at: Date | null;
}

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const rangeParam = (url.searchParams.get("range") || "30d") as Range;
    const range: Range = ["1d", "7d", "30d", "all"].includes(rangeParam) ? rangeParam : "30d";
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 200);

    const cutoffMs = rangeToMs(range);
    const sinceClause = cutoffMs
      ? `AND m.created_at >= NOW() - INTERVAL '${cutoffMs} milliseconds'`
      : "";

    // Aggregate per conversation. ChatMessage native columns populated
    // by C2/C4. mode() WITHIN GROUP gives the most-used provider per
    // conv (tie-breaker: alphabetical). percentile_cont gives p95.
    const rows = await prisma.$queryRawUnsafe<ConvCostRow[]>(`
      SELECT
        c.id AS conversation_id,
        c.title,
        COUNT(m.id)::bigint AS message_count,
        SUM(m.cost_cents)::bigint AS total_cost_cents,
        SUM(m.prompt_tokens)::bigint AS total_prompt_tokens,
        SUM(m.completion_tokens)::bigint AS total_completion_tokens,
        AVG(m.latency_ms)::int AS avg_latency_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY m.latency_ms) AS p95_latency_ms,
        mode() WITHIN GROUP (ORDER BY m.provider) AS primary_provider,
        c.last_active_at
      FROM chat_conversations c
      LEFT JOIN chat_messages m ON m.conversation_id = c.id AND m.role = 'assistant'
      WHERE c.archived_at IS NULL
        ${sinceClause}
      GROUP BY c.id, c.title, c.last_active_at
      HAVING COUNT(m.id) > 0
      ORDER BY total_cost_cents DESC NULLS LAST, c.last_active_at DESC
      LIMIT ${limit}
    `);

    // Totals across the result set
    let totalCostCents = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalMessages = 0;
    for (const r of rows) {
      totalCostCents += Number(r.total_cost_cents ?? 0n);
      totalPromptTokens += Number(r.total_prompt_tokens ?? 0n);
      totalCompletionTokens += Number(r.total_completion_tokens ?? 0n);
      totalMessages += Number(r.message_count ?? 0n);
    }

    // Cross-reference with AiGeneration for authoritative cost (C2
    // wrote NULL into ChatMessage.cost_cents until the join is wired —
    // this is the wire). Falls back to native column when AiGen has
    // no matching row.
    const aiGenAggregate = await prisma.aiGeneration.aggregate({
      where: cutoffMs
        ? { createdAt: { gte: new Date(Date.now() - cutoffMs) } }
        : undefined,
      _sum: { costCents: true, promptTokens: true, outputTokens: true },
      _count: { id: true },
    });

    return {
      range,
      generatedAt: new Date().toISOString(),
      totals: {
        conversations: rows.length,
        messages: totalMessages,
        costCents: totalCostCents,
        // AiGeneration aggregate covers EVERYTHING (chat + journal +
        // image gen + brain digests), useful as ceiling.
        ceilingCostCents: aiGenAggregate._sum.costCents ?? 0,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
      },
      conversations: rows.map((r) => ({
        conversationId: r.conversation_id,
        title: r.title,
        messageCount: Number(r.message_count),
        costCents: Number(r.total_cost_cents ?? 0n),
        promptTokens: Number(r.total_prompt_tokens ?? 0n),
        completionTokens: Number(r.total_completion_tokens ?? 0n),
        avgLatencyMs: r.avg_latency_ms,
        p95LatencyMs: r.p95_latency_ms != null ? Math.round(r.p95_latency_ms) : null,
        primaryProvider: r.primary_provider,
        lastActiveAt: r.last_active_at,
      })),
    };
  },
  { auth: "owner" },
);
