/**
 * GET /api/cron/tone-shift-detect · 2026-05-27 · Power Atlas Phase 3
 *
 * Daily 01:00 UTC = 8pm ET (prev night). Walks active person profiles,
 * scores trailing-3 vs trailing-30 chat-mention sentiment, persists the
 * shift snapshot into PersonProfile.metadata.toneShift. Caps 10 profiles
 * per run to bound cost (gpt-4o-mini fast tier · ~2 calls per profile).
 *
 * Eligibility · profiles whose toneShiftUpdatedAt is older than 24h OR
 * never computed. Daily cadence catches the operator's full network in
 * about a week (~70 active people · 10/run).
 *
 * Silent · no Telegram · operator reads the alert on /relationships.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { detectToneShift } from "@/lib/brain/tone-shift-detector";

export const maxDuration = 300;

export const GET = cronHandler(async () => {
  const candidates = await prisma.personProfile.findMany({
    where: { status: { not: "blown_up" }, deletedAt: null },
    select: { id: true, metadata: true },
    take: 200,
  });

  const oneDayAgo = Date.now() - 86400_000;
  const eligible = candidates.filter((p) => {
    const meta = p.metadata as { toneShiftUpdatedAt?: string } | null;
    if (!meta?.toneShiftUpdatedAt) return true;
    return new Date(meta.toneShiftUpdatedAt).getTime() < oneDayAgo;
  });

  let updated = 0;
  for (const p of eligible.slice(0, 10)) {
    const snap = await detectToneShift(p.id);
    if (!snap) continue;
    const existing = (p.metadata as Record<string, unknown> | null) ?? {};
    await prisma.personProfile.update({
      where: { id: p.id },
      data: {
        metadata: {
          ...existing,
          toneShift: snap,
          toneShiftUpdatedAt: new Date().toISOString(),
        } as never,
      },
    });
    updated++;
  }

  return { ok: true, candidates: eligible.length, updated };
});
