/**
 * GET /api/cron/greene-law-tag-refresh · 2026-05-27 · Power Atlas Phase 3
 *
 * Weekly Monday 07:00 UTC. Walks active person profiles, runs the Greene
 * law tagger, persists the top-3 applicable law numbers into
 * PersonProfile.applicableLaws.
 *
 * Caps 8 profiles per run · weekly cadence catches up across the
 * operator's network. Most-recent-interaction first so the laws stay
 * fresh on profiles the operator is actively engaging with.
 *
 * Silent · no Telegram · operator reads the laws on /relationships
 * (GreeneLawSidebar already mounted in Phase 1).
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { tagApplicableLaws } from "@/lib/brain/greene-law-tagger";

export const maxDuration = 300;

export const GET = cronHandler(async () => {
  const candidates = await prisma.personProfile.findMany({
    where: { status: { not: "blown_up" }, deletedAt: null },
    select: { id: true, applicableLaws: true },
    orderBy: { lastInteraction: "desc" },
    take: 40,
  });

  let updated = 0;
  for (const p of candidates.slice(0, 8)) {
    const laws = await tagApplicableLaws(p.id);
    if (laws.length === 0) continue;
    await prisma.personProfile.update({
      where: { id: p.id },
      data: { applicableLaws: laws },
    });
    updated++;
  }

  return { ok: true, candidates: candidates.length, updated };
});
