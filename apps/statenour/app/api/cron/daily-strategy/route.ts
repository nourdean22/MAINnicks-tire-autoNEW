/**
 * GET /api/cron/daily-strategy · Wave X.f (2026-05-24) · activation
 *
 * Writes today's `DailyStrategy` row · the cockpit tile at
 * `/api/command/data` reads from this table (line 87) but no
 * writer existed · operator never saw the strategic briefing
 * because the row was always null.
 *
 * What this does:
 *   1. Calls `runStrategicTriggers()` (15 behavioral triggers
 *      from `lib/services/strategic-triggers.ts`) to surface what
 *      patterns fired against today's data.
 *   2. Picks a focusLaw — the top fired trigger's Greene law ref.
 *   3. Composes a deterministic briefing (template + fired-trigger
 *      detail strings). NO AI call · the triggers are themselves
 *      the AI signal · re-summarizing in another model would add
 *      cost without adding intelligence.
 *   4. Upserts `DailyStrategy` keyed by today's ET date · idempotent
 *      (re-running same day overwrites today's row, not appending).
 *
 * Folded into mega-morning · runs ~7am ET so the cockpit has a
 * fresh strategic briefing for the operator's first session.
 *
 * Honesty footnote · when zero triggers fire (a quiet day with no
 * fired patterns) the briefing is a plain "no strategic alerts ·
 * standard operating posture" rather than an AI-fabricated story.
 * Clarity-gate principle: don't fake significance.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { runStrategicTriggers } from "@/lib/services/strategic-triggers";
import { startOfDayET } from "@/lib/utils/datetime";
import { logger } from "@/lib/logger";

const log = logger.withSurface("cron/daily-strategy");

export const dynamic = "force-dynamic";

/**
 * Compose a deterministic briefing string from fired triggers ·
 * no AI call · the triggers are themselves the signal.
 */
function composeBriefing(fired: ReturnType<typeof runStrategicTriggers> extends Promise<infer T> ? T : never): {
  briefing: string;
  shopAdvice: string | null;
  personalAdvice: string | null;
} {
  if (fired.length === 0) {
    return {
      briefing: "No strategic alerts fired against today's data. Standard operating posture.",
      shopAdvice: null,
      personalAdvice: null,
    };
  }

  const critical = fired.filter((t) => t.severity === "critical");
  const warning = fired.filter((t) => t.severity === "warning");

  const headlines: string[] = [];
  if (critical.length > 0) {
    headlines.push(`${critical.length} CRITICAL pattern${critical.length > 1 ? "s" : ""}: ${critical.slice(0, 2).map((t) => t.name).join(" · ")}`);
  }
  if (warning.length > 0) {
    headlines.push(`${warning.length} warning${warning.length > 1 ? "s" : ""}: ${warning.slice(0, 2).map((t) => t.name).join(" · ")}`);
  }

  const top = fired[0];
  const briefing = headlines.length > 0
    ? `${headlines.join(" · ")}. Top trigger: ${top.name} — ${top.detail}`
    : `${fired.length} trigger${fired.length > 1 ? "s" : ""} fired. Top: ${top.name} — ${top.detail}`;

  // Naive split — info/warning bias toward shop, critical biases toward
  // personal/operator. Honest about the split being heuristic, not AI.
  const shopAdvice = fired.slice(0, 3).map((t) => `${t.name}: ${t.detail}`).join(" · ");
  const personalAdvice = critical.length > 0
    ? critical.map((t) => `${t.name} — Law ${t.lawRef.book} #${t.lawRef.number} applies.`).join(" · ")
    : null;

  return { briefing, shopAdvice, personalAdvice };
}

export const GET = apiHandler(
  async () => {
    const date = startOfDayET();
    const fired = await runStrategicTriggers(false);

    const { briefing, shopAdvice, personalAdvice } = composeBriefing(fired);
    const focusLaw = fired.length > 0
      ? `Book ${fired[0].lawRef.book} · Law #${fired[0].lawRef.number}`
      : null;

    // Upsert keyed on today's ET date (the strategyDate column has a
    // unique constraint per the schema). Re-running same day overwrites.
    const row = await prisma.dailyStrategy.upsert({
      where: { strategyDate: date },
      create: {
        strategyDate: date,
        briefing,
        focusLaw,
        triggers: fired.length > 0 ? JSON.parse(JSON.stringify(fired)) : undefined,
        shopAdvice,
        personalAdvice,
        provider: "deterministic-v1",
      },
      update: {
        briefing,
        focusLaw,
        triggers: fired.length > 0 ? JSON.parse(JSON.stringify(fired)) : undefined,
        shopAdvice,
        personalAdvice,
        provider: "deterministic-v1",
      },
      select: { id: true },
    });

    log.info("daily_strategy_written", {
      strategyId: row.id,
      firedCount: fired.length,
      criticalCount: fired.filter((t) => t.severity === "critical").length,
    });

    return {
      ok: true,
      strategyId: row.id,
      date: date.toISOString(),
      firedCount: fired.length,
      focusLaw,
    };
  },
  { auth: "cron" },
);
