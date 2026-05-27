/**
 * GET /api/cron/psychographic-ladder-refresh · 2026-05-27 · Power Atlas Phase 2
 *
 * Weekly Monday 06:00 UTC (1h after behavioral X-ray). Same staleness
 * filter (cached refreshedAt < newest ledger entry) and same 5-per-run
 * cap. Writes to PersonProfile.psychographicLadder.
 *
 * Silent · no Telegram.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { runPsychographicLadder } from "@/lib/brain/psychographic-ladder-adapter";

export const maxDuration = 300;

export const GET = cronHandler(async () => {
  const candidates = await prisma.personProfile.findMany({
    where: {
      status: { not: "blown_up" },
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      psychographicLadder: true,
      ledger: {
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    take: 20,
  });

  const eligible = candidates.filter((p) => {
    if (!p.psychographicLadder) return true;
    try {
      const fp = p.psychographicLadder as { refreshedAt?: string };
      const refreshedAt = fp.refreshedAt
        ? new Date(fp.refreshedAt)
        : new Date(0);
      const lastLedgerAt = p.ledger[0]?.createdAt ?? new Date(0);
      return lastLedgerAt > refreshedAt;
    } catch {
      return true;
    }
  });

  let refreshed = 0;
  for (const p of eligible.slice(0, 5)) {
    const ladder = await runPsychographicLadder(p.id);
    if (ladder) {
      await prisma.personProfile.update({
        where: { id: p.id },
        data: { psychographicLadder: ladder as never },
      });
      refreshed++;
    }
  }

  return { ok: true, candidates: eligible.length, refreshed };
});
