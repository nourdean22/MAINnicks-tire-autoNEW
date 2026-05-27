/**
 * GET /api/cron/reciprocity-tracker-update · 2026-05-27 · Power Atlas Phase 3
 *
 * Weekly Sunday 03:00 UTC = 10pm ET Saturday. Walks every active person
 * profile, computes the 90d reciprocity gradient (operator-initiated vs
 * their-initiated %), and persists the snapshot into
 * PersonProfile.metadata.reciprocity.
 *
 * Task 3.4 EXTENSION · also computes powerBalance via computePowerBalance,
 * RESPECTING the manual-lock flag. When the engine returns null (operator
 * has manually set the gauge), this cron MUST skip the powerBalance write
 * so the slider value remains sticky. The skipped count is reported back
 * so the operator can see how many manual locks are active.
 *
 * Silent · no Telegram · operator reads the gradient on /relationships.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { computeReciprocity } from "@/lib/brain/reciprocity-tracker";
import { computePowerBalance } from "@/lib/brain/power-balance-engine";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const profiles = await prisma.personProfile.findMany({
    where: { status: { not: "blown_up" }, deletedAt: null },
    select: { id: true, metadata: true },
    take: 200,
  });

  let updated = 0;
  let powerBalanceUpdated = 0;
  let skippedManualLock = 0;

  for (const p of profiles) {
    // ── reciprocity gradient ─────────────────────────────────────────
    const reciprocity = await computeReciprocity(p.id);
    if (reciprocity) {
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

    // ── Task 3.4 · power-balance auto-compute with manual-lock check ──
    // computePowerBalance returns null when powerBalanceManualLock=true ·
    // we MUST skip the write in that case · operator's manual slider
    // value is sticky.
    const nextPower = await computePowerBalance(p.id);
    if (nextPower === null) {
      skippedManualLock++;
      continue;
    }
    await prisma.personProfile.update({
      where: { id: p.id },
      data: { powerBalance: nextPower },
    });
    powerBalanceUpdated++;
  }

  return {
    ok: true,
    candidates: profiles.length,
    updated,
    powerBalanceUpdated,
    skippedManualLock,
  };
});
