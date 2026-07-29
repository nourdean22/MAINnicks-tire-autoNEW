/**
 * GET /api/cron/xp-decay — loss-aversion decay (Wave-8, 2026-07-29).
 *
 * Operator-decided 2026-07-29: WIRE the decay that `decayXp`
 * (lib/mastery/leveling.ts) implemented and tested on 2026-06-01 but
 * never had a cron home ("the mastery-decay cron is currently dead; a
 * later slice gives it a home" — this is that slice).
 *
 * Event-sourced, never destructive: decay lands as a NEGATIVE-xp
 * mastery_xp_event row (the totals summers are plain SUMs — verified
 * against sumStatXpSql), idempotent per stat per day via the
 * (category,key) unique. Deleting the row restores the XP — fully
 * reversible, per the same recomputability contract as backfills.
 *
 * Look-back honesty: rep recency is scanned over a 90-day window; a
 * stat idle longer than the window decays as if 90 days idle (stated
 * cap, not silent).
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { decayXp } from "@/lib/mastery/leveling";
import { xpEventTotals, MASTERY_XP_CATEGORY } from "@/lib/mastery/credit";

export const maxDuration = 60;

const log = rootLogger.withSurface("cron/xp-decay");

const LOOKBACK_DAYS = 90;
/** Below this loss the decay row isn't worth the noise. */
const MIN_LOSS = 1;

export const GET = cronHandler(async () => {
  const totals = await xpEventTotals();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const events = await prisma.brainMemory.findMany({
    where: { category: MASTERY_XP_CATEGORY, createdAt: { gte: since } },
    select: { metadata: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });

  const lastRep = new Map<string, Date>();
  for (const e of events) {
    const m = e.metadata as { stat?: string; xp?: number } | null;
    if (!m?.stat || typeof m.xp !== "number" || m.xp <= 0) continue;
    if (!lastRep.has(m.stat)) lastRep.set(m.stat, e.createdAt);
  }

  const dayKey = new Date().toISOString().slice(0, 10);
  let statsDecayed = 0;
  let totalLoss = 0;
  const skipped: string[] = [];

  for (const [stat, xp] of totals) {
    if (xp <= 0) continue;
    const last = lastRep.get(stat);
    const daysSince = last
      ? Math.floor((Date.now() - last.getTime()) / 86_400_000)
      : LOOKBACK_DAYS;
    // decayXp applies ratePerDay compounding past graceDays; feeding it
    // ONE day at a time (yesterday's total vs today) would double-count
    // on consecutive runs — instead each daily row realizes only the
    // single-day marginal loss at the current idle depth.
    const before = decayXp(xp, daysSince - 1);
    const after = decayXp(xp, daysSince);
    const loss = Math.round((before - after) * 10) / 10;
    if (loss < MIN_LOSS) {
      skipped.push(stat);
      continue;
    }
    try {
      await prisma.brainMemory.create({
        data: {
          category: MASTERY_XP_CATEGORY,
          key: `decay:${stat}:${dayKey}`,
          content: `-${loss} XP decay · ${stat} idle ${daysSince}d`,
          confidence: 1,
          source: "xp-decay-cron",
          metadata: {
            stat,
            xp: -loss,
            signal: "decay",
            evidence: `${daysSince}d since last rep (grace 7d) → -${loss} XP`,
            decay: true,
          } as never,
        },
      });
      statsDecayed++;
      totalLoss += loss;
    } catch (err) {
      // P2002 = today's decay row already exists (idempotent re-run) — fine.
      if ((err as { code?: string })?.code !== "P2002") {
        log.warn("decay_write_failed", {
          stat,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  log.info("xp_decay_done", { statsDecayed, totalLoss, skipped: skipped.length });
  return { statsDecayed, totalLoss: Math.round(totalLoss * 10) / 10, skippedStats: skipped.length };
});
