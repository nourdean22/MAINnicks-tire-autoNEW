/**
 * GET /api/cron/dossier-autodraft · 2026-05-27 · Power Atlas Phase 2
 *
 * Weekly Monday 04:00 UTC = 11pm ET Sunday. Drafts updated dossierMd
 * for up to 5 high-priority profiles (role filter + sorted by most-
 * recent interaction). Embedding refresh fires after each successful
 * draft so /api/people/search picks up the change.
 *
 * Operator approves Monday morning. Operator's existing dossier blob
 * is never overwritten by a failed draft.
 *
 * Silent · no Telegram.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { draftDossierFor } from "@/lib/brain/dossier-autodrafter";

export const maxDuration = 300;

export const GET = cronHandler(async () => {
  // Monday-only self-gate · 2026-06-02 · wired into the daily MORNING_JOBS
  // fan-out (no day-of-week gate), so skip every day but Monday (UTC) to
  // preserve the weekly cadence without running the AI drafting 7x/week.
  // Non-Monday runs short-circuit here before any DB/AI work.
  if (new Date().getUTCDay() !== 1) {
    return { skipped: true, reason: "weekly cron · not Monday (UTC)" };
  }
  const profiles = await prisma.personProfile.findMany({
    where: {
      status: { not: "blown_up" },
      deletedAt: null,
      role: {
        in: [
          "friend",
          "close_friend",
          "family",
          "mentor",
          "mentee",
          "romantic",
          "advisor",
        ],
      },
    },
    select: {
      id: true,
      dossierUpdatedAt: true,
      lastInteraction: true,
    },
    orderBy: { lastInteraction: "desc" },
    take: 20,
  });

  let drafted = 0;
  for (const p of profiles.slice(0, 5)) {
    const draft = await draftDossierFor(p.id);
    if (!draft) continue;
    await prisma.personProfile.update({
      where: { id: p.id },
      data: {
        dossierMd: draft,
        dossierUpdatedAt: new Date(),
      },
    });
    // Queue embedding refresh so hybrid search picks up the new dossier
    const { enqueuePersonEmbed } = await import(
      "@/lib/brain/people-embed-hook"
    );
    await enqueuePersonEmbed(p.id);
    drafted++;
  }

  return { ok: true, candidates: profiles.length, drafted };
});
