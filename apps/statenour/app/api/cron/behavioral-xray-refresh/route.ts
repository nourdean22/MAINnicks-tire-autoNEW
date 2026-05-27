/**
 * GET /api/cron/behavioral-xray-refresh · 2026-05-27 · Power Atlas Phase 2
 *
 * Weekly Monday 05:00 UTC. Refreshes behavioralFingerprint Json column
 * on profiles whose last ledger activity is newer than the cached
 * fingerprint's refreshedAt (or which have no fingerprint yet). Caps
 * 5 profiles per run to bound cost · weekly cadence catches up.
 *
 * Silent · no Telegram · operator reads results on /relationships.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { runBehavioralXray } from "@/lib/brain/behavioral-xray-adapter";

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
      behavioralFingerprint: true,
      ledger: {
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    take: 20, // cap per run · weekly cadence catches up
  });

  const eligible = candidates.filter((p) => {
    if (!p.behavioralFingerprint) return true;
    try {
      const fp = p.behavioralFingerprint as { refreshedAt?: string };
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
    const fingerprint = await runBehavioralXray(p.id);
    if (fingerprint) {
      await prisma.personProfile.update({
        where: { id: p.id },
        data: { behavioralFingerprint: fingerprint as never },
      });
      refreshed++;
    }
  }

  return { ok: true, candidates: eligible.length, refreshed };
});
