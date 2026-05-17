/**
 * GET /api/cron/mastery-decay · Wave 23 (v10.0.529.79) · #3
 *
 * Nightly · decays each mastery axis by DECAY_RATE/day when no DONE
 * task moved that domain today. Mirror of the identity-snapshot decay
 * pattern · keeps mastery scores HONEST instead of monotonically
 * increasing.
 *
 * Why this matters:
 *   Without decay, 6 months of no fitness work still leaves you at
 *   60/100 → the score is a lie. With decay, the 8-axis radar tells
 *   the truth: use it or lose it.
 *
 * Idempotent:
 *   · Only writes a row when no row for (today, domain) exists yet
 *   · The auto-learn upsert path always runs first (intra-day), so a
 *     domain that had ANY DONE work today already has a row · decay
 *     skips it
 *   · Safe to re-run · second invocation finds the decay row and
 *     skips (no double-decay)
 *
 * Folded into mega-evening · runs at ~10pm ET = 2am UTC.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { today as todayET } from "@/lib/utils/datetime";
import { logger } from "@/lib/logger";

const log = logger.withSurface("cron/mastery-decay");

/** Decay per day · -0.05 means 20 days of no work moves an axis 1
 *  point down. Slow enough to feel fair · fast enough to register
 *  visible drift over a month. */
const DECAY_RATE = 0.05;

/** Floor · mastery never decays below this. */
const SCORE_FLOOR = 0;

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async () => {
    const date = todayET();

    // Find all domains that exist in mastery_scores history.
    const knownDomains = await prisma.masteryScore
      .findMany({
        distinct: ["domain"],
        select: { domain: true },
      })
      .catch((): Array<{ domain: string }> => []);

    if (knownDomains.length === 0) {
      return { ok: true, decayed: 0, skipped: 0, message: "no domains in history" };
    }

    let decayed = 0;
    let skipped = 0;

    for (const { domain } of knownDomains) {
      // If a row for (today, domain) exists, the auto-learn path
      // already bumped this domain today → no decay.
      const existing = await prisma.masteryScore
        .findUnique({
          where: { date_domain: { date, domain } },
          select: { id: true },
        })
        .catch(() => null);

      if (existing) {
        skipped++;
        continue;
      }

      // Read the most recent score for this domain.
      const latest = await prisma.masteryScore
        .findFirst({
          where: { domain },
          orderBy: { date: "desc" },
          select: { score: true },
        })
        .catch(() => null);

      const priorScore = latest?.score ?? 50;
      const nextScore = Math.max(SCORE_FLOOR, Math.round((priorScore - DECAY_RATE) * 10) / 10);
      const delta = Math.round((nextScore - priorScore) * 10) / 10;

      try {
        await prisma.masteryScore.create({
          data: {
            date,
            domain,
            score: nextScore,
            delta,
            evidence: "no qualifying work today · decay",
          },
        });
        decayed++;
      } catch (err) {
        log.warn("decay_write_failed", {
          domain,
          error: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
      }
    }

    return {
      ok: true,
      decayed,
      skipped,
      date,
      decayRate: DECAY_RATE,
    };
  },
  { auth: "cron" },
);
