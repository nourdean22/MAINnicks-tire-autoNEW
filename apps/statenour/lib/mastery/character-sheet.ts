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
import { toDateString } from "@/lib/utils/datetime";
import { DOMAINS } from "./config";
import { levelProgress, tierForLevel, xpForLevel } from "./leveling";
import { xpEventTotals, xpEventTotalsSince } from "./credit";
import { goalsByStat, type GoalForStats } from "./goal-stats";

export interface StatLevel {
  key: string;
  label: string;
  /** Short display name for the UI (falls back to label). */
  shortLabel: string;
  /** One-line plain-coach description of what this stat is. */
  description: string;
  icon: string;
  color: string;
  /** Which skill-tree branch this stat belongs to (body/mind/empire/influence). */
  branch: string;
  /** Lifetime XP = sum of all deltas ever attributed to this stat. */
  xp: number;
  level: number;
  tier: string;
  tierEmoji: string;
  xpIntoLevel: number;
  xpForNext: number;
  progressPct: number;
  /** XP gained in the last 7 days — the "slope"/momentum this week. */
  rising7dXp: number;
  /** Active goals that level this stat (the reverse of the goal-card
   *  chips) — the Ambition Engine P1 character-sheet citation. */
  goals: { id: string; title: string }[];
}

/**
 * Build the full character sheet — one StatLevel per domain, sorted by
 * level (then XP) so the strongest stats lead. Each stat opens at a
 * starting level seeded from its 0-10 baseline self-rating (your real
 * skill on Day 1) and climbs as you log reps on top of that floor — the
 * RPG "character build", not a dishonest Lvl 1 for everything.
 */
export async function computeCharacterSheet(): Promise<StatLevel[]> {
  // Two XP sources, summed: task completions live in MasteryScore.delta
  // (written by auto-learn), every other signal lives in the mastery_xp
  // event log (written by creditStatXp). Kept separate so we never
  // double-count, combined here for the lifetime total.
  // 7-day window powers the "rising this week" slope (momentum, not just
  // the lifetime level). MasteryScore.date keys are "YYYY-MM-DD" — lexical
  // >= works for the window.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const sinceKey = toDateString(since);
  type DomainSum = { domain: string; _sum: { delta: number | null } };
  const [sums, eventTotals, weekSums, weekEvents, activeGoals] = await Promise.all([
    prisma.masteryScore
      .groupBy({ by: ["domain"], _sum: { delta: true } })
      .catch(() => [] as DomainSum[]),
    xpEventTotals(),
    prisma.masteryScore
      .groupBy({
        by: ["domain"],
        _sum: { delta: true },
        where: { date: { gte: sinceKey } },
      })
      .catch(() => [] as DomainSum[]),
    xpEventTotalsSince(since),
    // Ambition Engine P1 · active goals + their stat links, for the
    // character-sheet citation (which goals feed each stat). Best-effort —
    // a goals-query failure must never break the leveling board.
    prisma.lifeGoal
      .findMany({
        where: { deletedAt: null, status: "active" },
        select: {
          id: true,
          title: true,
          domain: true,
          statLinks: { select: { statKey: true, weight: true } },
        },
      })
      .catch(() => [] as GoalForStats[]),
  ]);

  const deltaByDomain = new Map(
    sums.map((s) => [s.domain, Math.max(0, s._sum.delta ?? 0)]),
  );
  const weekByDomain = new Map(
    weekSums.map((s) => [s.domain, Math.max(0, s._sum.delta ?? 0)]),
  );

  // Reverse map · which active goals level each stat (same resolver as the
  // goal-card chips, so the citation and the chips can never disagree).
  const goalCitations = goalsByStat(activeGoals);

  return DOMAINS.map((d) => {
    // Earned XP — everything you've ever logged in this stat (task bumps +
    // the AI-attributed signal events).
    const earned =
      (deltaByDomain.get(d.key) ?? 0) + (eventTotals.get(d.key) ?? 0);
    // Starting floor from your 0-10 self-rating: a 7.5 opens around Lvl 8,
    // so your real craft shows on Day 1; every rep then stacks ON TOP of
    // it. levelFromXp(xpForLevel(N)) === N, so an untouched stat lands
    // exactly at its baseline level, 0% into the next.
    const baselineXp = xpForLevel(Math.max(1, Math.round(d.baseline)));
    const xp = Math.round((baselineXp + earned) * 10) / 10;
    const p = levelProgress(xp);
    const tier = tierForLevel(p.level);
    const rising7dXp =
      Math.round(
        ((weekByDomain.get(d.key) ?? 0) + (weekEvents.get(d.key) ?? 0)) * 10,
      ) / 10;
    return {
      key: d.key,
      label: d.label,
      shortLabel: d.shortLabel,
      description: d.description,
      icon: d.icon,
      color: d.color,
      branch: d.branch,
      xp,
      level: p.level,
      tier: tier.name,
      tierEmoji: tier.emoji,
      xpIntoLevel: p.xpIntoLevel,
      xpForNext: p.xpForNext,
      progressPct: p.progressPct,
      rising7dXp,
      goals: goalCitations.get(d.key) ?? [],
    };
  }).sort((a, b) => b.level - a.level || b.xp - a.xp);
}

/** Compact one-liner per stat for AI context / Telegram — e.g.
 *  "🗣️ Persuasion & Influence · Lvl 1 Apprentice (0/5 XP)". */
export function statLine(s: StatLevel): string {
  return `${s.icon} ${s.label} · Lvl ${s.level} ${s.tier} (${s.xpIntoLevel}/${s.xpForNext} XP)`;
}
