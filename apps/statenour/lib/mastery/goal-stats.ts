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
import { today } from "@/lib/utils/datetime";

import { prisma } from "@/lib/prisma";
import { creditStatXp, xpEventTotals } from "./credit";
import { SIGNAL_XP, levelFromXp, tierForLevel } from "./leveling";
import { DOMAINS } from "./config";
import { taskStatMultiplier, MIN_TASK_STAT_XP } from "./scoring-config";
import type { LevelUpPayload } from "./task-reward";

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
 * XP one task rep credits to a stat of the given weight, scaled by the
 * adaptive `multiplier` (effort × ROI × goal × streak, default 1 = the
 * prior flat behavior). Base is SIGNAL_XP.task, rounded to one decimal,
 * clamped ≥ 0. A non-positive weight earns 0 (no wrong credit).
 */
export function goalStatXp(weight: number, multiplier = 1): number {
  if (weight <= 0) return 0;
  const m = multiplier > 0 ? multiplier : 1;
  const xp = SIGNAL_XP.task * weight * m;
  return Math.max(0, Math.round(xp * 10) / 10);
}

/** Validate raw stat-hint keys against the real stat catalog (weight 1). */
export function statHintsToResolved(hints: string[] | null | undefined): ResolvedGoalStat[] {
  return (hints ?? [])
    .filter((k) => VALID_STATS.has(k))
    .map((statKey) => ({ statKey, weight: 1 }));
}

/** Stable idempotency key for one (task, stat) goal credit. */
export function goalTaskSourceKey(taskId: string, statKey: string): string {
  return `goal-task:${taskId}:${statKey}`;
}

/** A goal that contributes to stats, for the reverse (stat → goals) map. */
export interface GoalForStats {
  id: string;
  title: string;
  domain: string;
  statLinks?: { statKey: string; weight: number }[];
}

/**
 * Invert a set of goals into statKey → the goals that level it, using the
 * SAME declared-else-inferred resolution as the goal-card chips — so the
 * character-sheet citation and the chips can never disagree. Pure. A goal
 * whose domain is unmappable and which declares no stats contributes to
 * nothing (no phantom citation).
 */
export function goalsByStat(
  goals: GoalForStats[],
): Map<string, { id: string; title: string }[]> {
  const out = new Map<string, { id: string; title: string }[]>();
  for (const g of goals ?? []) {
    for (const s of effectiveGoalStats(g.statLinks ?? [], g.domain)) {
      const list = out.get(s.statKey) ?? [];
      list.push({ id: g.id, title: g.title });
      out.set(s.statKey, list);
    }
  }
  return out;
}

/**
 * Credit character-sheet stat XP for a completed task — the UNIFIED path
 * (2026-06-01). This is what makes a completed task actually move the
 * /stats levels (the `mastery_xp_event` log keyed by stat, which
 * `computeCharacterSheet` reads; NOT auto-learn's domain-bucket score).
 *
 * Stat resolution priority (review #1 — "even goal-less tasks feed a stat"):
 *   1. the linked goal's declared/inferred stats (when task.goalId set)
 *   2. the task's classifier `statHints`
 *   3. inference from the mission (or goal) domain string
 *
 * XP per stat is SCALED by the adaptive multiplier (effort × ROI × goal ×
 * streak — review #2: stat XP scales; goal `currentValue` stays flat).
 *
 * Idempotency / no double-count:
 *   · goal-resolved stats keep the historical `goal-task:<id>:<stat>` key.
 *   · statHints/domain-resolved stats use a fresh `task-stat:<id>:<stat>` key.
 *   · DAILY completions append `:<yyyy-mm-dd>` so each day credits once.
 * Returns BOTH the count of NEW stat credits AND the real total XP credited.
 * The per-stat XP is already computed here, so summing it is free — and it lets
 * the /missions reward toast show TRUE XP instead of mislabelling the count as
 * "+N XP". Fire-and-forget safe: never throws.
 */
export interface TaskCreditResult {
  /** (task, stat) pairs newly credited this call. 0 on a same-key re-credit. */
  statsCredited: number;
  /** Real total stat XP credited — sum of the per-stat amounts actually written. */
  xpCredited: number;
  /** Populated when the credit pushed the operator to a new overall level. */
  levelUp?: LevelUpPayload | null;
}

export async function creditTaskStats(
  taskId: string,
  opts: { perDay?: boolean; dayKey?: string } = {},
): Promise<TaskCreditResult> {
  if (!taskId) return { statsCredited: 0, xpCredited: 0 };
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: {
        goalId: true,
        statHints: true,
        effort: true,
        roiScore: true,
        streakCount: true,
        loopKind: true,
        mission: { select: { domain: true } },
        goal: {
          select: {
            domain: true,
            title: true,
            statLinks: { select: { statKey: true, weight: true } },
          },
        },
      },
    })
    .catch(() => null);
  if (!task) return { statsCredited: 0, xpCredited: 0 };

  // Resolve stats by priority, and remember which keying scheme + evidence.
  let stats: ResolvedGoalStat[];
  let goalKeyed = false;
  let evidence: string;
  if (task.goalId) {
    // A goal-linked task ALWAYS uses the goal-task: key namespace, even if the
    // goal relation didn't resolve (rare — FK is onDelete:SetNull so it
    // normally can't), so the same (task,stat) can never be credited under
    // both key schemes and double-count.
    if (task.goal) {
      stats = effectiveGoalStats(task.goal.statLinks ?? [], task.goal.domain);
      evidence = `goal rep · ${task.goal.title ?? ""}`.trim();
    } else {
      stats = inferGoalStats((task.mission?.domain || "").toLowerCase());
      evidence = "goal-linked rep";
    }
    goalKeyed = true;
  } else {
    const hinted = statHintsToResolved(task.statHints);
    if (hinted.length > 0) {
      stats = hinted;
      evidence = "task → stat hint";
    } else {
      const domain = (task.mission?.domain || task.goal?.domain || "").toLowerCase();
      stats = inferGoalStats(domain);
      evidence = domain ? `task · ${domain}` : "task";
    }
  }
  if (stats.length === 0) return { statsCredited: 0, xpCredited: 0 };

  const multiplier = taskStatMultiplier({
    roiScore: task.roiScore,
    effort: task.effort,
    streakCount: task.streakCount,
    loopKind: task.loopKind,
    hasGoalId: !!task.goalId,
  });
  const daySuffix = opts.perDay ? `:${opts.dayKey ?? today()}` : "";

  // Snapshot total XP BEFORE credits to detect level transitions.
  let totalXpBefore = 0;
  try {
    const totals = await xpEventTotals();
    for (const v of totals.values()) totalXpBefore += v;
  } catch { /* non-fatal */ }

  let statsCredited = 0;
  let xpCredited = 0;
  for (const s of stats) {
    const xp = Math.max(MIN_TASK_STAT_XP, goalStatXp(s.weight, multiplier));
    if (xp <= 0) continue;
    const base = goalKeyed
      ? goalTaskSourceKey(taskId, s.statKey)
      : `task-stat:${taskId}:${s.statKey}`;
    const isNew = await creditStatXp({
      stat: s.statKey,
      xp,
      signal: "task",
      evidence: evidence.slice(0, 120),
      sourceKey: `${base}${daySuffix}`,
    });
    // Only count + sum NEWLY-credited stats — a same-key re-credit (idempotent)
    // adds 0 to both, so the reward stays honest on repeat completions.
    if (isNew) {
      statsCredited++;
      xpCredited += xp;
    }
  }

  // Detect level-up: compare the overall level before and after this credit.
  const roundedXp = Math.round(xpCredited * 10) / 10;
  let levelUp: LevelUpPayload | null = null;
  if (roundedXp > 0) {
    const levelBefore = levelFromXp(totalXpBefore);
    const levelAfter = levelFromXp(totalXpBefore + roundedXp);
    if (levelAfter > levelBefore) {
      const tier = tierForLevel(levelAfter);
      levelUp = {
        newLevel: levelAfter,
        tierName: tier.name,
        tierEmoji: tier.emoji,
      };
    }
  }

  return { statsCredited, xpCredited: roundedXp, levelUp };
}

/**
 * @deprecated back-compat shim — prefer `creditTaskStats`. Kept so any
 * lingering caller (or a future re-add) still credits the goal path.
 */
export async function creditGoalStatsForTask(
  taskId: string,
  _goalId: string,
): Promise<TaskCreditResult> {
  return creditTaskStats(taskId);
}
