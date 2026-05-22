/**
 * lib/services/mit.ts · Phase B.6a (2026-05-22 · legacy-modernizer
 * REST→tRPC ultron slice · operator-domain sub-slice).
 *
 * The daily Most Important Task slot · one MIT per day · the
 * operator's binary daily-focus anchor. Persisted as a BrainMemory
 * row (category="daily_mit", key=YYYY-MM-DD) so it auto-clears at
 * midnight (next day = new key = empty MIT) and decays via the
 * brain-cycle.
 *
 * Extracted from the inline route logic in app/api/mit/route.ts so
 * BOTH the legacy REST route AND the new `operator.mit` / `setMit`
 * tRPC procedures call the same functions · drift impossible.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface MitView {
  key: string;
  text: string | null;
  updatedAt: string | null;
}

/** Read today's MIT · text is null when not set today. */
export async function getMit(): Promise<MitView> {
  const key = todayKey();
  const row = await prisma.brainMemory.findFirst({
    where: { category: BRAIN_CATEGORIES.MIT, key, deletedAt: null },
    select: { content: true, updatedAt: true },
  });
  return {
    key,
    text: row?.content ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

export type SetMitResult =
  | { ok: true; cleared: true; key: string }
  | { ok: true; text: string; key: string };

/**
 * Set/update today's MIT. Empty/blank text clears it (soft-delete ·
 * keeps history). Non-empty text is capped at 120 chars (MIT is
 * meant to be terse) and upserted by date.
 */
export async function setMit(rawText: string): Promise<SetMitResult> {
  const text = (rawText ?? "").trim();
  const key = todayKey();

  if (!text) {
    // Empty text = clear today's MIT (soft-delete · keeps history)
    await prisma.brainMemory.updateMany({
      where: { category: BRAIN_CATEGORIES.MIT, key, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { ok: true, cleared: true, key };
  }

  // 120 char ceiling · MIT is meant to be terse
  const trimmed = text.slice(0, 120);

  const row = await prisma.brainMemory.upsert({
    where: { category_key: { category: BRAIN_CATEGORIES.MIT, key } },
    update: {
      content: trimmed,
      deletedAt: null,
      lastSeen: new Date(),
    },
    create: {
      category: BRAIN_CATEGORIES.MIT,
      key,
      content: trimmed,
      confidence: 1,
      source: "ui:mit-slot",
      createdBy: "user",
    },
  });

  return { ok: true, text: row.content, key };
}
