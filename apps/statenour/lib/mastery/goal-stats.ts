/**
 * Goal → stat spine · Ambition Engine P1 · 2026-05-31
 *
 * Connects a LifeGoal to the 33 mastery stats. A goal DECLARES which
 * stats it levels via GoalStat rows; when it has declared none we INFER
 * one from the goal's domain — so the spine is non-inert for every
 * existing goal with zero backfill. A completed Task tagged with the
 * goal then credits XP to those stats through the existing leveling
 * engine.
 *
 * Crediting rides the IDEMPOTENT xpEvent log (creditStatXp), NOT a second
 * MasteryScore.delta — task completions already write a delta for the
 * task's OWN attributed stat (auto-learn), and the character sheet sums
 * both. Keeping the goal credit in the xpEvent log means a goal-tagged
 * task never double-counts its own stat, and re-running is a no-op
 * (sourceKey `goal-task:<taskId>:<statKey>`).
 *
 * The pure functions (inferGoalStats · effectiveGoalStats · goalStatXp ·
 * goalTaskSourceKey) are the single source of truth shared by this
 * crediting path AND the UI stat chips, so server + client never drift.
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import { creditStatXp } from "./credit";
import { SIGNAL_XP } from "./leveling";
import { DOMAINS } from "./config";

export interface ResolvedGoalStat {
  statKey: string;
  weight: number;
}

const VALID_STATS = new Set<string>(DOMAINS.map((d) => d.key));

/**
 * goal.domain → a mastery stat key. Extends attribution.ts's
 * HABIT_CATEGORY_DOMAIN precedent for the goal domains the schema +
 * authoring UI emit (`business · fitness · finance · personal · career`
 * per schema.prisma, plus `health · content` from the edit form). A
 * domain that already IS a stat key skips this map (handled below).
 */
const GOAL_DOMAIN_TO_STAT: Record<string, string> = {
  business: "business_ops",
  career: "business_ops",
  finance: "financial",
  financial: "financial",
  health: "physical",
  fitness: "physical",
  content: "marketing",
  personal: "discipline",
  family: "relationships",
  spiritual: "faith",
  skills: "technical",
  mind: "mental",
};

/**
 * Infer the stat(s) a goal levels from its domain, for goals that have
 * declared none. A domain that already is a valid stat key passes
 * through; an unmappable domain returns [] — better no credit than a
 * confidently wrong one.
 */
export function inferGoalStats(domain: string): ResolvedGoalStat[] {
  const d = (domain ?? "").toLowerCase().trim();
  if (!d) return [];
  if (VALID_STATS.has(d)) return [{ statKey: d, weight: 1 }];
  const mapped = GOAL_DOMAIN_TO_STAT[d];
  return mapped ? [{ statKey: mapped, weight: 1 }] : [];
}

/**
 * The effective stats a goal levels: its DECLARED GoalStat rows (valid
 * keys only, non-positive weights normalized to 1) when any exist, else
 * domain inference. Pure — shared by the crediting path and the chips.
 */
export function effectiveGoalStats(
  declared: { statKey: string; weight: number }[],
  domain: string,
): ResolvedGoalStat[] {
  const valid = (declared ?? [])
    .filter((s) => VALID_STATS.has(s.statKey))
    .map((s) => ({ statKey: s.statKey, weight: s.weight > 0 ? s.weight : 1 }));
  return valid.length > 0 ? valid : inferGoalStats(domain);
}

/**
 * XP one goal-tagged task rep credits to a stat of the given weight.
 * Base is SIGNAL_XP.task (a completed task) scaled by the stat's weight
 * (the goal's 0..1 effort share), rounded to one decimal. Clamped ≥ 0.
 */
export function goalStatXp(weight: number): number {
  const xp = SIGNAL_XP.task * (weight > 0 ? weight : 0);
  return Math.max(0, Math.round(xp * 10) / 10);
}

/** Stable idempotency key for one (task, stat) goal credit. */
export function goalTaskSourceKey(taskId: string, statKey: string): string {
  return `goal-task:${taskId}:${statKey}`;
}

/**
 * Credit XP to a goal's stats for a completed task tagged with it. Reads
 * the goal's declared GoalStat rows (falling back to domain inference),
 * then writes one idempotent xpEvent per stat. Returns the count of NEW
 * credits (a backfill/double-fire returns 0). Fire-and-forget safe:
 * never throws.
 */
export async function creditGoalStatsForTask(
  taskId: string,
  goalId: string,
): Promise<number> {
  if (!taskId || !goalId) return 0;
  const goal = await prisma.lifeGoal
    .findUnique({
      where: { id: goalId },
      select: {
        domain: true,
        title: true,
        statLinks: { select: { statKey: true, weight: true } },
      },
    })
    .catch(() => null);
  if (!goal) return 0;

  const stats = effectiveGoalStats(goal.statLinks ?? [], goal.domain);
  let credited = 0;
  for (const s of stats) {
    const xp = goalStatXp(s.weight);
    if (xp <= 0) continue;
    const isNew = await creditStatXp({
      stat: s.statKey,
      xp,
      signal: "task",
      evidence: `goal rep · ${goal.title}`.slice(0, 120),
      sourceKey: goalTaskSourceKey(taskId, s.statKey),
    });
    if (isNew) credited++;
  }
  return credited;
}
