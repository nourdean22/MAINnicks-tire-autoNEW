/**
 * GET / POST /api/mit · v10.0.300 · daily Most Important Task slot
 * for Ultron HQ.
 *
 * One MIT per day · the operator's binary daily-focus anchor.
 * Distinct from todo lists · only ONE thing matters today.
 *
 * Persisted as brainMemory (category="daily_mit", key=YYYY-MM-DD)
 * so:
 *   · Auto-clears at midnight (next day = new key = empty MIT)
 *   · Historical record · which days had what MIT (audit later)
 *   · Decays via the brain-cycle along with everything else
 *
 * GET returns { key, text, updatedAt } · text is null if not set today.
 * POST { text } sets/updates. Empty/blank text clears today's MIT.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export const GET = apiHandler(async () => {
  const key = todayKey();
  const row = await prisma.brainMemory.findFirst({
    where: { category: "daily_mit", key, deletedAt: null },
    select: { content: true, updatedAt: true },
  });
  return {
    key,
    text: row?.content ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}, { auth: "owner" });

export const POST = apiHandler(async (req) => {
  const body = (await readRequestJson(req)) as { text?: string };
  const text = (body.text ?? "").trim();
  const key = todayKey();

  if (!text) {
    // Empty text = clear today's MIT (soft-delete · keeps history)
    await prisma.brainMemory.updateMany({
      where: { category: "daily_mit", key, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { ok: true, cleared: true, key };
  }

  // 120 char ceiling · MIT is meant to be terse
  const trimmed = text.slice(0, 120);

  const row = await prisma.brainMemory.upsert({
    where: { category_key: { category: "daily_mit", key } },
    update: {
      content: trimmed,
      deletedAt: null,
      lastSeen: new Date(),
    },
    create: {
      category: "daily_mit",
      key,
      content: trimmed,
      confidence: 1,
      source: "ui:mit-slot",
      createdBy: "user",
    },
  });

  return { ok: true, text: row.content, key };
}, { auth: "owner" });
