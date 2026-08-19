/**
 * GET /api/cron/pricing-advisory · AG-19 (2026-07-09)
 *
 * Revives the dead pricing-advisor loop. composeAdvisory() — the
 * complete, tested pipeline (ALG win-rate outliers → competitor prices
 * → 3 drafted experiments per outlier) — had ZERO production callers
 * since it shipped: no cron route, absent from every fan-out list. All
 * its read surfaces (pricingAdvisorySummary chat tool, GET
 * /api/system/pricing-advisory, the coach-event banner renderer at
 * coach-event-banner.tsx) returned empty forever.
 *
 * composeAdvisory is a pure composer — persistence is THIS route's job:
 *   1. BrainMemory(category="pricing_advisory", key=weekly_<date-ET>)
 *      with the full snapshot in metadata (idempotent weekly upsert)
 *   2. a coach event (kind "pricing-advisory" — the renderer existed,
 *      no writer did) so the banner finally fires
 *
 * Scheduled via WEEKLY_JOBS (Sunday-ET evening fan-out) · see
 * lib/inngest/jobs.ts + config/crons.ts manifest entry.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { composeAdvisory } from "@/lib/services/pricing-advisor";
import { recordCoachEvent } from "@/lib/services/coach-events";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/pricing-advisory");

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = cronHandler(
  async () => {
    const snapshot = await composeAdvisory();

    const todayEt = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    const key = `weekly_${todayEt}`;

    await prisma.brainMemory.upsert({
      where: { category_key: { category: "pricing_advisory", key } },
      create: {
        category: "pricing_advisory",
        key,
        content: snapshot.headline,
        confidence: 0.9,
        source: "cron:pricing-advisor",
        metadata: { snapshot } as never,
      },
      update: {
        content: snapshot.headline,
        metadata: { snapshot } as never,
        lastSeen: new Date(),
      },
    });

    if (!snapshot.empty && snapshot.outliers.length > 0) {
      await recordCoachEvent({
        kind: "pricing-advisory",
        subjectId: "global",
        priority: "P2",
        title: snapshot.headline.slice(0, 80),
        body: `${snapshot.outliers.length} pricing outlier(s) vs fleet median · experiments drafted.`,
      }).catch((err) => {
        log.warn("coach_event_failed", {
          error: err instanceof Error ? err.message.slice(0, 160) : String(err),
        });
      });
    }

    return {
      ok: true,
      key,
      empty: snapshot.empty?.reason ?? null,
      outliers: snapshot.outliers.length,
      headline: snapshot.headline,
    };
  },
);
