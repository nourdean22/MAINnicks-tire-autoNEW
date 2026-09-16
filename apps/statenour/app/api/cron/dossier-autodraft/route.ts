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
import { Prisma } from "@prisma/client";
import { draftDossierFor } from "@/lib/brain/dossier-autodrafter";
import { computePowerBalance } from "@/lib/brain/power-balance-engine";
import { runBehavioralXray } from "@/lib/brain/behavioral-xray-adapter";
import { runPsychographicLadder } from "@/lib/brain/psychographic-ladder-adapter";

export const maxDuration = 300;

// 2026-06-02 · Power Atlas completion · refresh staleness for the AI-based
// engines. behavioralFingerprint + psychographicLadder carry a `refreshedAt`
// ISO timestamp; we skip recompute when it's newer than this window so the
// weekly cron never re-pays for a fingerprint it just wrote. Matches the
// dossier cron's own weekly cadence.
const ENGINE_REFRESH_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function isFingerprintFresh(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const refreshedAt = (value as { refreshedAt?: unknown }).refreshedAt;
  if (typeof refreshedAt !== "string") return false;
  const ts = Date.parse(refreshedAt);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < ENGINE_REFRESH_STALE_MS;
}

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
      behavioralFingerprint: true,
      psychographicLadder: true,
    },
    orderBy: { lastInteraction: { sort: "desc", nulls: "last" } },
    take: 20,
  });

  let drafted = 0;
  let powerBalanceWrites = 0;
  let fingerprintWrites = 0;
  let ladderWrites = 0;
  for (const p of profiles.slice(0, 5)) {
    // ── Power balance · 2026-06-02 · PURE COMPUTE (no AI · 2 DB reads +
    //    math). Cheap → recompute every run. The engine itself honors
    //    powerBalanceManualLock (returns null when locked); when null we
    //    skip the write so the operator's slider value stays sticky.
    const power = await computePowerBalance(p.id);
    if (power !== null) {
      await prisma.personProfile.update({
        where: { id: p.id },
        data: { powerBalance: power },
      });
      powerBalanceWrites++;
    }

    const draft = await draftDossierFor(p.id);
    if (!draft) continue;
    await prisma.personProfile.update({
      where: { id: p.id },
      data: {
        dossierMd: draft,
        dossierUpdatedAt: new Date(),
      },
    });

    // ── AI engines · 2026-06-02 · behavioral X-ray + psychographic ladder.
    //    COST-GATED: only run for a person the cron ALREADY successfully
    //    AI-drafted this run (`draft` non-null → reached here), so we never
    //    add an LLM call for a person the cron skipped. Idempotent: skip
    //    recompute when the existing fingerprint's refreshedAt is < 7d old.
    //    Each engine returns null on thin signal / parse / provider failure
    //    → we leave the prior value untouched. Worst case: 2 extra "reason"
    //    calls per drafted person (≤5/run, weekly), all behind the
    //    tracedAiChat budget gate.
    if (!isFingerprintFresh(p.behavioralFingerprint)) {
      const fingerprint = await runBehavioralXray(p.id);
      if (fingerprint) {
        await prisma.personProfile.update({
          where: { id: p.id },
          data: { behavioralFingerprint: fingerprint as unknown as Prisma.InputJsonValue },
        });
        fingerprintWrites++;
      }
    }
    if (!isFingerprintFresh(p.psychographicLadder)) {
      const ladder = await runPsychographicLadder(p.id);
      if (ladder) {
        await prisma.personProfile.update({
          where: { id: p.id },
          data: { psychographicLadder: ladder as unknown as Prisma.InputJsonValue },
        });
        ladderWrites++;
      }
    }

    // Queue embedding refresh so hybrid search picks up the new dossier
    const { enqueuePersonEmbed } = await import(
      "@/lib/brain/people-embed-hook"
    );
    await enqueuePersonEmbed(p.id);
    drafted++;
  }

  return {
    ok: true,
    candidates: profiles.length,
    drafted,
    powerBalanceWrites,
    fingerprintWrites,
    ladderWrites,
  };
});
