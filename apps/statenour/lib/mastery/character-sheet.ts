/**
 * Mastery character sheet · 2026-05-30
 *
 * Every mastery stat as a LEVEL, computed from the lifetime sum of its
 * MasteryScore deltas (every action ever attributed to it). Schema-free
 * — no new tables — so it ships on data we already have. This is the
 * read side of the leveling engine; the write side is the existing
 * auto-learn bump (+ later slices that feed journal/chat/email).
 */
import { prisma } from "@/lib/prisma";
import { DOMAINS } from "./config";
import { levelProgress, tierForLevel } from "./leveling";

export interface StatLevel {
  key: string;
  label: string;
  icon: string;
  color: string;
  /** Lifetime XP = sum of all deltas ever attributed to this stat. */
  xp: number;
  level: number;
  tier: string;
  tierEmoji: string;
  xpIntoLevel: number;
  xpForNext: number;
  progressPct: number;
}

/**
 * Build the full character sheet — one StatLevel per domain, sorted by
 * level (then XP) so the strongest stats lead. Domains with no history
 * yet (e.g. freshly-added persuasion / emotional_intelligence) come back
 * at Level 1 with 0 XP, which is the honest starting point.
 */
export async function computeCharacterSheet(): Promise<StatLevel[]> {
  const sums = await prisma.masteryScore
    .groupBy({ by: ["domain"], _sum: { delta: true } })
    .catch(() => [] as { domain: string; _sum: { delta: number | null } }[]);

  const xpByDomain = new Map(
    sums.map((s) => [s.domain, Math.max(0, s._sum.delta ?? 0)]),
  );

  return DOMAINS.map((d) => {
    const xp = Math.round((xpByDomain.get(d.key) ?? 0) * 10) / 10;
    const p = levelProgress(xp);
    const tier = tierForLevel(p.level);
    return {
      key: d.key,
      label: d.label,
      icon: d.icon,
      color: d.color,
      xp,
      level: p.level,
      tier: tier.name,
      tierEmoji: tier.emoji,
      xpIntoLevel: p.xpIntoLevel,
      xpForNext: p.xpForNext,
      progressPct: p.progressPct,
    };
  }).sort((a, b) => b.level - a.level || b.xp - a.xp);
}

/** Compact one-liner per stat for AI context / Telegram — e.g.
 *  "🗣️ Persuasion & Influence · Lvl 1 Apprentice (0/5 XP)". */
export function statLine(s: StatLevel): string {
  return `${s.icon} ${s.label} · Lvl ${s.level} ${s.tier} (${s.xpIntoLevel}/${s.xpForNext} XP)`;
}
