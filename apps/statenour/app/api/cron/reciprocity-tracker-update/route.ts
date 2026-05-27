/**
 * GET /api/cron/reciprocity-tracker-update · 2026-05-27 · Power Atlas Phase 3
 *
 * Weekly Sunday 03:00 UTC = 10pm ET Saturday. Walks every active person
 * profile, computes the 90d reciprocity gradient (operator-initiated vs
 * their-initiated %), and persists the snapshot into
 * PersonProfile.metadata.reciprocity.
 *
 * Extended in Task 3.4: also computes powerBalance via
 * computePowerBalance, RESPECTING the manual-lock flag so the operator's
 * manual gauge value is never overwritten.
 *
 * Silent · no Telegram · operator reads the gradient on /relationships.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { computeReciprocity } from "@/lib/brain/reciprocity-tracker";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const profiles = await prisma.personProfile.findMany({
    where: { status: { not: "blown_up" }, deletedAt: null },
    select: { id: true, metadata: true },
    take: 200,
  });

  let updated = 0;

  for (const p of profiles) {
    const reciprocity = await computeReciprocity(p.id);
    if (!reciprocity) continue;
    const existing = (p.metadata as Record<string, unknown> | null) ?? {};
    await prisma.personProfile.update({
      where: { id: p.id },
      data: {
        metadata: {
          ...existing,
          reciprocity,
          reciprocityUpdatedAt: new Date().toISOString(),
        } as never,
      },
    });
    updated++;
  }

  return { ok: true, candidates: profiles.length, updated };
});
