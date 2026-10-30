/**
 * lib/services/home-maxim.ts · the Home maxim's server side: today's pick (lib/wisdom/maxims.ts over
 * MAXIM_POOL), Keep (a pin through the existing pin service, so Nick can use it in chat) and Skip (a 30-day
 * expiring maxim_skip row, the alert_dismiss pattern; both category exclusion lists in lib/brain/categories.ts
 * name it so the nightly merge never deletes one and recall never reads one as a belief).
 */
import { prisma } from "@/lib/prisma";
import { createPin } from "@/lib/services/pins";
import { MAXIM_POOL } from "@/lib/wisdom/maxim-pool";
import { MAXIM_SKIP_CATEGORY, MAXIM_SKIP_DAYS, pickMaxim, type Maxim, type MaximPick } from "@/lib/wisdom/maxims";

export interface HomeMaximView {
  id: string;
  text: string;
  source: string;
  reason: string | null;
  position: number;
  total: number;
}

/** Keys of the live Skip markers. A failed read throws: the caller shows no maxim, never a skipped one. */
async function skippedIds(now: Date): Promise<Set<string>> {
  const rows = await prisma.brainMemory.findMany({
    where: { category: MAXIM_SKIP_CATEGORY, deletedAt: null, expiresAt: { gt: now } },
    select: { key: true },
  });
  return new Set(rows.map((r) => r.key));
}

export async function getHomeMaxim(args: { step: number; context?: string | null; now?: Date }): Promise<HomeMaximView | null> {
  const now = args.now ?? new Date();
  const pick: MaximPick | null = pickMaxim({
    pool: MAXIM_POOL,
    skipped: await skippedIds(now),
    context: args.context,
    at: now,
    step: args.step,
  });
  if (!pick) return null;
  return {
    id: pick.maxim.id,
    text: pick.maxim.text,
    source: pick.maxim.source,
    reason: pick.reason,
    position: pick.position,
    total: pick.total,
  };
}

function findMaxim(id: string): Maxim | null {
  return MAXIM_POOL.find((m) => m.id === id) ?? null;
}

/** Keep: pin the maxim's text with its source, through the same service the brain's pin button uses. */
export async function keepHomeMaxim(id: string): Promise<{ ok: boolean }> {
  const maxim = findMaxim(id);
  if (!maxim) return { ok: false };
  await createPin({ content: `${maxim.text} (${maxim.source})`, source: "home:maxim-keep", label: maxim.source });
  return { ok: true };
}

/** Skip: hide this maxim for 30 days. An upsert on (category, key), so a second tap only renews the window. */
export async function skipHomeMaxim(id: string, now: Date = new Date()): Promise<{ ok: boolean; until?: string }> {
  if (!findMaxim(id)) return { ok: false };
  const expiresAt = new Date(now.getTime() + MAXIM_SKIP_DAYS * 86_400_000);
  // brain-memory-direct-write: a Skip marker for the Home maxim rotation, not a semantic memory
  await prisma.brainMemory.upsert({
    where: { category_key: { category: MAXIM_SKIP_CATEGORY, key: id } },
    create: { category: MAXIM_SKIP_CATEGORY, key: id, content: "skipped on Home", confidence: 1, source: "home:maxim-skip", expiresAt },
    update: { expiresAt, deletedAt: null },
  });
  return { ok: true, until: expiresAt.toISOString() };
}
