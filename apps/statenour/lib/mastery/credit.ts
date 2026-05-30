/**
 * Mastery XP credit · Slice 2 · 2026-05-30
 *
 * The write side of the leveling engine for NON-task signals (habits,
 * journal, chat, email, decisions). Schema-free: each credit is one
 * BrainMemory(category="mastery_xp_event") row, idempotent by sourceKey
 * — re-crediting the same source overwrites instead of double-counting.
 * This doubles as the "+XP feed" (query recent rows) and the dedup log.
 *
 * Task completions stay where they are (MasteryScore.delta, written live
 * by auto-learn) so we never double-count; the character sheet sums both.
 */
import { prisma } from "@/lib/prisma";
import type { MasterySignal } from "./leveling";

export const MASTERY_XP_CATEGORY = "mastery_xp_event";

export interface XpCredit {
  /** Domain key the XP applies to (must be a DOMAINS key). */
  stat: string;
  xp: number;
  signal: MasterySignal;
  /** ≤120-char human "why" — shown in the +XP feed. */
  evidence: string;
  /** Stable per-source id for dedup, e.g. `journal:<entryId>`. */
  sourceKey: string;
}

/**
 * Credit XP to a stat. Idempotent per sourceKey. Returns true when this
 * was a NEW credit (so a backfill can count how much it actually added).
 * Fire-and-forget safe: never throws.
 */
export async function creditStatXp(ev: XpCredit): Promise<boolean> {
  if (ev.xp <= 0 || !ev.stat) return false;
  const key = ev.sourceKey;
  const existing = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: MASTERY_XP_CATEGORY, key } },
      select: { id: true },
    })
    .catch(() => null);
  await prisma.brainMemory
    .upsert({
      where: { category_key: { category: MASTERY_XP_CATEGORY, key } },
      create: {
        category: MASTERY_XP_CATEGORY,
        key,
        content: ev.evidence.slice(0, 280),
        source: "mastery-xp",
        createdBy: "system",
        metadata: { stat: ev.stat, xp: ev.xp, signal: ev.signal } as object,
      },
      update: {
        content: ev.evidence.slice(0, 280),
        metadata: { stat: ev.stat, xp: ev.xp, signal: ev.signal } as object,
      },
    })
    .catch(() => {});
  return existing === null;
}

/** Lifetime XP per stat from the XP-event log (every non-task signal). */
export async function xpEventTotals(): Promise<Map<string, number>> {
  const rows = await prisma.brainMemory
    .findMany({ where: { category: MASTERY_XP_CATEGORY }, select: { metadata: true } })
    .catch((): { metadata: unknown }[] => []);
  const totals = new Map<string, number>();
  for (const r of rows) {
    const m = (r.metadata ?? {}) as { stat?: string; xp?: number };
    if (typeof m.stat === "string" && typeof m.xp === "number") {
      totals.set(m.stat, (totals.get(m.stat) ?? 0) + m.xp);
    }
  }
  return totals;
}
