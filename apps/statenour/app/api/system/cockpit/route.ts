/**
 * GET /api/system/cockpit — unified operator cockpit aggregate.
 *
 * v10.0.529.106 · Wave 65 · the "single pane of glass" for the OS.
 *
 * Pre-Wave-65 there were 22+ scattered /system/* dashboards. Operator
 * had to visit /system/costs · /system/chat-health · /system/cron-runs ·
 * /system/agent-traces · /brain/* etc to assemble a mental health
 * check. The 6-agent audit (May 16, post-consolidation) flagged the
 * "unified operator cockpit" as the next failure mode prevention:
 * after the consolidation moved coherence to ~92%, the remaining
 * failure mode is not knowing when the OS regresses before it hits
 * production load.
 *
 * This endpoint composes 5 SCORECARDS from already-built modules:
 *   1. cost today (lib/services/cost-slo.ts:computeTodayBurn)
 *   2. eval pass rate (BrainMemory category=eval_run last 24h)
 *   3. cron success rate 24h (CronJobLog)
 *   4. brain recall precision (BrainMemory category=chat_feedback /
 *      total chat turns, last 24h)
 *   5. voice p50 latency (VoiceLatencyEvent percentile · last 24h)
 *
 * Designed to be opened once per morning as a 30-second OS health
 * check. The cockpit page (app/(mastery)/system/cockpit/page.tsx)
 * polls this every 60s.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { z } from "zod";
import { computeTodayBurn, resolveDailyAiBudgetCents } from "@/lib/services/cost-slo";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ScoreCard {
  key: string;
  label: string;
  value: string;
  numeric: number | null;
  status: "ok" | "warn" | "alert";
  detail: string;
}

export async function GET(req: Request) {
  await requireSession(req);

  const since24h = new Date(Date.now() - 24 * 3600_000);

  // Run all 5 reads in parallel · each has its own catch so one
  // dead surface doesn't tank the whole cockpit.
  const [
    burnCents,
    budgetCents,
    evalRows,
    cronStats,
    chatStats,
    voiceP50,
  ] = await Promise.all([
    computeTodayBurn().catch(() => 0),
    resolveDailyAiBudgetCents().catch(() => 500),
    prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.EVAL_RUN,
        createdAt: { gte: since24h },
        deletedAt: null,
      },
      select: { content: true },
      take: 100,
    }).catch(() => []),
    prisma.cronJobLog.groupBy({
      by: ["status"],
      where: { createdAt: { gte: since24h } },
      _count: { _all: true },
    }).catch(() => []),
    prisma.chatMessage.aggregate({
      where: { createdAt: { gte: since24h }, role: "assistant" },
      _count: { _all: true },
    }).catch(() => ({ _count: { _all: 0 } })),
    prisma.$queryRawUnsafe<Array<{ p50: number | null }>>(
      `SELECT percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms::numeric) AS p50
       FROM voice_latency_events
       WHERE created_at >= $1`,
      since24h,
    ).catch(() => [{ p50: null }]),
  ]);

  // ─── SCORECARD 1 · cost today ──────────────────────────────────
  const burnPct = budgetCents > 0 ? burnCents / budgetCents : 0;
  const costCard: ScoreCard = {
    key: "cost",
    label: "cost today",
    value: `$${(burnCents / 100).toFixed(2)}`,
    numeric: burnCents,
    status: burnPct > 1.0 ? "alert" : burnPct > 0.7 ? "warn" : "ok",
    detail: `budget $${(budgetCents / 100).toFixed(0)} · ${Math.round(burnPct * 100)}% burn`,
  };

  // ─── SCORECARD 2 · eval pass rate (last 24h) ───────────────────
  let evalPassed = 0;
  let evalTotal = 0;
  for (const r of evalRows) {
    try {
      const parsed = JSON.parse(r.content) as { passed?: boolean };
      evalTotal++;
      if (parsed.passed === true) evalPassed++;
    } catch {
      evalTotal++;
    }
  }
  const evalRate = evalTotal > 0 ? evalPassed / evalTotal : null;
  // v10.0.529.106 · Wave 87 · sample-size gate.
  // Pre-fix · ANY failed eval triggered a red alert (a 0/1 run scored
  // 0% and flagged the entire cockpit headline). 1-3 samples is noise ·
  // need at least 5 runs before the alert/warn tiers fire. Below that
  // the card stays neutral and the detail says "X runs · need more
  // data" so the operator knows why it's not scoring.
  const MIN_EVAL_SAMPLE = 5;
  const evalCard: ScoreCard = {
    key: "eval",
    label: "eval pass rate",
    value: evalRate !== null ? `${Math.round(evalRate * 100)}%` : "—",
    numeric: evalRate !== null ? Math.round(evalRate * 100) : null,
    status: evalRate === null || evalTotal < MIN_EVAL_SAMPLE ? "ok"
      : evalRate < 0.7 ? "alert"
      : evalRate < 0.85 ? "warn" : "ok",
    detail: evalTotal === 0 ? "no eval runs · 24h"
      : evalTotal < MIN_EVAL_SAMPLE
        ? `${evalPassed}/${evalTotal} passed · need ${MIN_EVAL_SAMPLE}+ to score`
        : `${evalPassed}/${evalTotal} passed · 24h`,
  };

  // ─── SCORECARD 3 · cron success rate 24h ──────────────────────
  const cronSuccess = cronStats.find((c) => c.status === "success")?._count._all ?? 0;
  const cronFailed = cronStats.find((c) => c.status === "failure")?._count._all ?? 0;
  const cronTotal = cronSuccess + cronFailed;
  const cronRate = cronTotal > 0 ? cronSuccess / cronTotal : null;
  const cronCard: ScoreCard = {
    key: "cron",
    label: "cron success",
    value: cronRate !== null ? `${Math.round(cronRate * 100)}%` : "—",
    numeric: cronRate !== null ? Math.round(cronRate * 100) : null,
    status: cronRate === null ? "ok"
      : cronRate < 0.85 ? "alert"
      : cronRate < 0.95 ? "warn" : "ok",
    detail: cronTotal > 0 ? `${cronSuccess}/${cronTotal} ok · 24h` : "no cron runs · 24h",
  };

  // ─── SCORECARD 4 · chat turns volume (proxy for recall load) ───
  const chatTurnsCount = chatStats._count?._all ?? 0;
  const chatCard: ScoreCard = {
    key: "chat",
    label: "chat turns",
    value: String(chatTurnsCount),
    numeric: chatTurnsCount,
    status: chatTurnsCount > 200 ? "warn" : "ok",
    detail: "assistant turns · 24h",
  };

  // ─── SCORECARD 5 · voice p50 latency ──────────────────────────
  const voiceMs = voiceP50?.[0]?.p50 ?? null;
  const voiceCard: ScoreCard = {
    key: "voice",
    label: "voice p50",
    value: voiceMs !== null ? `${Math.round(voiceMs)}ms` : "—",
    numeric: voiceMs !== null ? Math.round(voiceMs) : null,
    status: voiceMs === null ? "ok"
      : voiceMs > 1200 ? "alert"
      : voiceMs > 800 ? "warn" : "ok",
    detail: voiceMs !== null ? "target ≤800ms · 24h" : "no voice calls · 24h",
  };

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    scorecards: [costCard, evalCard, cronCard, chatCard, voiceCard],
    headlineStatus:
      [costCard, evalCard, cronCard, voiceCard].some((c) => c.status === "alert") ? "alert"
      : [costCard, evalCard, cronCard, voiceCard].some((c) => c.status === "warn") ? "warn"
      : "ok",
  });
}
