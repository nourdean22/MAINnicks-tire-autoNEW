/**
 * GET /api/cron/topic-goal-overlap-compute · 2026-05-27 · Power Atlas Phase 3
 *
 * Weekly Monday 05:30 UTC (30min after behavioral X-ray block). Walks
 * active person profiles, scores topic-fit-to-goals via one tracedAiChat
 * "reason" call per profile, persists result into
 * PersonProfile.metadata.topicGoalOverlap. Caps 5 profiles per run for
 * cost (weekly cadence catches up across the operator's network).
 *
 * Eligibility · profiles whose topicGoalOverlapUpdatedAt is older than
 * 7 days OR never computed.
 *
 * Silent · no Telegram · operator reads the alignment on /relationships.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { computeTopicGoalOverlap } from "@/lib/brain/topic-goal-overlap";

export const maxDuration = 300;

export const GET = cronHandler(async () => {
  const candidates = await prisma.personProfile.findMany({
    where: { status: { not: "blown_up" }, deletedAt: null },
    select: { id: true, metadata: true, lastInteraction: true },
    orderBy: { lastInteraction: "desc" },
    take: 100,
  });

  const sevenDaysAgo = Date.now() - 7 * 86400_000;
  const eligible = candidates.filter((p) => {
    const meta = p.metadata as { topicGoalOverlapUpdatedAt?: string } | null;
    if (!meta?.topicGoalOverlapUpdatedAt) return true;
    return new Date(meta.topicGoalOverlapUpdatedAt).getTime() < sevenDaysAgo;
  });

  let updated = 0;
  for (const p of eligible.slice(0, 5)) {
    const overlap = await computeTopicGoalOverlap(p.id);
    if (!overlap) continue;
    const existing = (p.metadata as Record<string, unknown> | null) ?? {};
    await prisma.personProfile.update({
      where: { id: p.id },
      data: {
        metadata: {
          ...existing,
          topicGoalOverlap: overlap,
          topicGoalOverlapUpdatedAt: new Date().toISOString(),
        } as never,
      },
    });
    updated++;
  }

  return { ok: true, candidates: eligible.length, updated };
});
