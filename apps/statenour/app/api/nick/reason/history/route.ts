/**
 * GET /api/nick/reason/history · Phase H.3 (2026-05-18 PM)
 *
 * Reads back the BrainMemory(category="reasoning_trace") rows that
 * Phase H.2.2 has been persisting. Returns the last 50 runs in
 * reverse-chronological order with the structured metadata Nick
 * persisted at run time (tier, classifierReason, totalMs, calls,
 * usd, stepKinds, confidence).
 *
 * This closes the loop Phase H.2.2 opened · the persistence existed
 * but nothing read it. Now the /reason/history page surfaces it.
 *
 * Also returns the cumulative cost · feeds the budget UI so the
 * operator sees how close they are to the daily cap.
 *
 * Owner-only.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import {
  DEFAULT_DAILY_CAP_USD,
  __internals as budgetInternals,
} from "@/lib/ai/reasoning/budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

interface HistoryRow {
  id: string;
  question: string;
  answer: string;
  tier: string;
  classifierReason: string;
  totalMs: number;
  calls: number;
  usd: number;
  confidence: number;
  stepCount: number;
  stepKinds: string[];
  createdAt: string;
}

export async function GET(req: Request) {
  try {
    await requireSession(req);
    const url = new URL(req.url);
    const limit = Math.max(
      1,
      Math.min(100, Number(url.searchParams.get("limit") ?? 50)),
    );

    const rows = await prisma.brainMemory.findMany({
      where: { category: "reasoning_trace", deletedAt: null },
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

    const history: HistoryRow[] = rows.map((r) => {
      // content shape (written by persistTrace): "[tier] Q → A"
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

    // Aggregate stats
    const totalRuns = history.length;
    const totalSpendAll = Math.round(
      history.reduce((s, h) => s + h.usd, 0) * 1000,
    ) / 1000;
    const spentTodayUsd = await budgetInternals.getTodaySpendUsd();
    const tierCounts: Record<string, number> = {};
    for (const h of history) tierCounts[h.tier] = (tierCounts[h.tier] ?? 0) + 1;

    return NextResponse.json(
      {
        history,
        stats: {
          totalRuns,
          totalSpendAllUsd: totalSpendAll,
          spentTodayUsd,
          dailyCapUsd: DEFAULT_DAILY_CAP_USD,
          tierCounts,
        },
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "private, max-age=15" } },
    );
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        error: "history_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
