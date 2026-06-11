/**
 * Level-Up Directive · /stats delivery-layer pass · 2026-06-10.
 *
 * The character sheet shows the numbers; this module decides the ONE
 * stat to level today and says why. Pure + deterministic — no DB, no
 * Date.now(), no AI. It only re-ranks data the /stats page already
 * fetches (operator.characterSheet · task.goals · operator.bodyTracking),
 * so every recommendation can cite its source ("Because… / Based on…")
 * and an unexplainable recommendation is structurally impossible.
 *
 * Candidate ranking (first match wins — the order IS the product):
 *   recovery       · fresh body log shows sleep < 6h or energy ≤ 2 →
 *                    never prescribe a heavy rep; recover the base.
 *   verge-goal     · a goal-linked stat ≥ VERGE_PCT into its level —
 *                    the cheapest win that also feeds a declared climb.
 *   neglected-goal · a goal-linked stat with 0 XP this week — drift on
 *                    a declared priority (the avoidance mirror).
 *   goal-behind    · an active goal pace-classified missed/behind
 *                    (lib/brain/goal-pace.computePace — reused, not
 *                    re-derived) → its highest-progress linked stat.
 *   body-neglect   · the whole Body branch took 0 XP this week.
 *   learning       · the Learning stat is already moving this week.
 *   closest        · fallback: the stat closest to leveling (this is
 *                    the old CharacterSheet "Next rep" strip, absorbed
 *                    here as the weakest signal instead of the only one).
 *
 * Callers attach pace verdicts BEFORE calling (computePace reads
 * Date.now(); keeping it out of this module keeps selection replayable
 * in tests with fixed verdicts).
 */
import { BRANCHES } from "./config";
import { tierForLevel } from "./leveling";
import type { PaceVerdict } from "@/lib/brain/goal-pace";

// ─── input shapes · structural subsets of what /stats already fetches ──

/** Subset of lib/mastery/character-sheet StatLevel the selector reads. */
export interface DirectiveStat {
  key: string;
  label: string;
  shortLabel?: string;
  icon: string;
  color: string;
  branch: string;
  level: number;
  xpIntoLevel: number;
  /** Full XP span of the current level (NOT remaining — see xpToNext). */
  xpForNext: number;
  progressPct: number;
  rising7dXp: number;
  goals?: { id: string; title: string }[];
}

/** Subset of the task.goals payload, with a pre-computed pace verdict. */
export interface DirectiveGoal {
  id: string;
  title: string;
  status: string;
  progress: number;
  pace?: PaceVerdict;
  /** Server-resolved goal→stat links (same resolver as the stat chips). */
  stats?: { statKey: string }[];
  /** The goal's best open task — the natural "start this rep" target. */
  nextMove?: { id: string; title: string } | null;
}

/** The latest body-tracking row (date keys are NY "YYYY-MM-DD"). */
export interface BodySnapshot {
  date: string;
  sleepHours: number | null;
  energy: number | null;
  workoutDone?: boolean | null;
}

// ─── tuning constants · exported so tests pin them on purpose ──────────

/** A goal-linked stat this far into its level counts as "on the verge". */
export const VERGE_PCT = 60;
/** Branch-average level gap that makes a build imbalance worth saying. */
export const IMBALANCE_LEVEL_GAP = 3;
/** Tier-boundary levels (tierForLevel) — the "skill cape" milestones. */
export const MILESTONE_LEVELS = [4, 7, 10, 13] as const;
/** Body-state override thresholds (operator spec). */
export const RECOVERY_SLEEP_HOURS = 6;
export const RECOVERY_ENERGY_MAX = 2;

export type DirectiveTier =
  | "recovery"
  | "verge-goal"
  | "neglected-goal"
  | "goal-behind"
  | "body-neglect"
  | "learning"
  | "closest";

export interface LevelUpDirective {
  stat: DirectiveStat;
  tier: DirectiveTier;
  /** XP remaining to the next level (xpForNext − xpIntoLevel, ≥ 0). */
  xpToNext: number;
  /** Always starts "Because" or "Based on" — the truth hierarchy. */
  reason: string;
  rep: { text: string; href: string; cta: string };
  /** The goal this stat serves, when one exists (goal-to-stat bridge). */
  goal: { id: string; title: string } | null;
  /** Avoidance mirror · the chosen stat itself took 0 XP this week. */
  neglected: boolean;
  /** Skill-cape path · the NEXT level is a tier boundary. */
  milestone: { level: number; tier: string } | null;
  /** Build diagnosis · null unless the math is clear. */
  imbalance: string | null;
  /** True when the body-state override picked the rep. */
  recovery: boolean;
}

// ─── helpers ────────────────────────────────────────────────────────────

const round1 = (n: number) => Math.round(n * 10) / 10;

export function xpToNext(s: Pick<DirectiveStat, "xpForNext" | "xpIntoLevel">): number {
  return Math.max(0, round1(s.xpForNext - s.xpIntoLevel));
}

const displayName = (s: DirectiveStat) => s.shortLabel || s.label;

/** Stable "closest to leveling" order: progress desc, level desc, key asc. */
function byVerge(a: DirectiveStat, b: DirectiveStat): number {
  return (
    b.progressPct - a.progressPct ||
    b.level - a.level ||
    a.key.localeCompare(b.key)
  );
}

/** Date-key freshness: entry is from today or yesterday (NY date keys,
 *  compared as UTC midnights so the diff is exact and TZ-free). */
export function isFreshDateKey(entryDate: string, todayKey: string): boolean {
  const entry = Date.parse(`${entryDate}T00:00:00Z`);
  const now = Date.parse(`${todayKey}T00:00:00Z`);
  if (Number.isNaN(entry) || Number.isNaN(now)) return false;
  return Math.abs(now - entry) <= 86_400_000;
}

/**
 * Build diagnosis · average level per branch; speak only when one branch
 * trails the leader by ≥ IMBALANCE_LEVEL_GAP whole levels on average.
 * Returns e.g. "Body trailing Craft & Empire", or null when unclear.
 */
export function computeBuildImbalance(stats: DirectiveStat[]): string | null {
  const byBranch = new Map<string, { sum: number; n: number }>();
  for (const s of stats) {
    const acc = byBranch.get(s.branch) ?? { sum: 0, n: 0 };
    acc.sum += s.level;
    acc.n += 1;
    byBranch.set(s.branch, acc);
  }
  if (byBranch.size < 2) return null;
  let hi: { key: string; avg: number } | null = null;
  let lo: { key: string; avg: number } | null = null;
  for (const [key, { sum, n }] of byBranch) {
    const avg = sum / n;
    if (!hi || avg > hi.avg) hi = { key, avg };
    if (!lo || avg < lo.avg) lo = { key, avg };
  }
  if (!hi || !lo || hi.avg - lo.avg < IMBALANCE_LEVEL_GAP) return null;
  const label = (k: string) => BRANCHES.find((b) => b.key === k)?.label ?? k;
  return `${label(lo.key)} trailing ${label(hi.key)}`;
}

/** The rep for a goal-bridged pick: the goal's open next task when the
 *  goals payload knows one, else the goal card.
 *  KNOWN LIMITATION (2026-06-10): /missions does not yet consume the
 *  ?taskId= param — the link lands on the missions surface (safe, the
 *  task lives there) without scrolling/highlighting. Same convention +
 *  limitation as GoalBoard's existing nextMove links (goal-board.tsx),
 *  so a future missions-side deep-link fix repairs both at once. */
function repForGoal(
  cited: { id: string; title: string },
  goalById: Map<string, DirectiveGoal>,
): LevelUpDirective["rep"] {
  const full = goalById.get(cited.id);
  if (full?.nextMove) {
    return {
      cta: "Start this rep",
      href: `/missions?taskId=${full.nextMove.id}`,
      text: `Next task on '${cited.title}': ${full.nextMove.title}`,
    };
  }
  return {
    cta: "Open goal",
    href: `/stats#goal-${cited.id}`,
    text: `Land one rep on '${cited.title}'.`,
  };
}

// ─── the selector ───────────────────────────────────────────────────────

export interface DirectiveInput {
  stats: DirectiveStat[];
  /** Active goals with pace pre-attached (card calls computePace). */
  goals?: DirectiveGoal[];
  /** Latest body-tracking entry, if any. */
  latestBody?: BodySnapshot | null;
  /** NY "YYYY-MM-DD" for body-log freshness (lib/utils/datetime today()). */
  todayKey?: string;
}

export function selectLevelUpDirective(
  input: DirectiveInput,
): LevelUpDirective | null {
  const stats = input.stats ?? [];
  if (stats.length === 0) return null;

  const goals = (input.goals ?? []).filter((g) => g.status === "active");
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const statByKey = new Map(stats.map((s) => [s.key, s]));

  let stat: DirectiveStat | null = null;
  let tier: DirectiveTier = "closest";
  let reason = "";
  let rep: LevelUpDirective["rep"] | null = null;
  let citedGoal: { id: string; title: string } | null = null;
  let recovery = false;

  // ① RECOVERY override · a fresh body log showing short sleep or low
  // energy vetoes every heavy-rep recommendation below.
  const body = input.latestBody;
  if (
    body &&
    input.todayKey &&
    isFreshDateKey(body.date, input.todayKey) &&
    ((body.sleepHours != null && body.sleepHours < RECOVERY_SLEEP_HOURS) ||
      (body.energy != null && body.energy <= RECOVERY_ENERGY_MAX))
  ) {
    const bodyStats = stats.filter((s) => s.branch === "body").sort(byVerge);
    stat = bodyStats[0] ?? [...stats].sort(byVerge)[0];
    tier = "recovery";
    recovery = true;
    const parts: string[] = [];
    if (body.sleepHours != null && body.sleepHours < RECOVERY_SLEEP_HOURS)
      parts.push(`slept ${body.sleepHours}h`);
    if (body.energy != null && body.energy <= RECOVERY_ENERGY_MAX)
      parts.push(`energy ${body.energy}/5`);
    const when = body.date === input.todayKey ? "today's" : "yesterday's";
    reason = `Based on ${when} body log (${parts.join(", ")}) — recover the base before a heavy rep.`;
    rep = {
      cta: "Log recovery",
      href: "/stats#body",
      text: "Low-friction rep: a walk, mobility work, or an early night — log it in Body.",
    };
  }

  // ② VERGE + GOAL · a goal-linked stat on the verge of leveling.
  if (!stat) {
    const s = stats
      .filter((x) => (x.goals?.length ?? 0) > 0 && x.progressPct >= VERGE_PCT)
      .sort(byVerge)[0];
    if (s) {
      const g = s.goals![0];
      stat = s;
      tier = "verge-goal";
      citedGoal = g;
      reason = `Because ${displayName(s)} is ${s.progressPct}% into Lvl ${s.level} — ${Math.round(xpToNext(s))} XP closes Lvl ${s.level + 1} — and it feeds '${g.title}'.`;
      rep = repForGoal(g, goalById);
    }
  }

  // ③ NEGLECTED + STRATEGIC · goal-linked but zero XP this week.
  if (!stat) {
    const s = stats
      .filter((x) => (x.goals?.length ?? 0) > 0 && x.rising7dXp === 0)
      .sort(
        (a, b) =>
          (b.goals?.length ?? 0) - (a.goals?.length ?? 0) ||
          b.progressPct - a.progressPct ||
          a.key.localeCompare(b.key),
      )[0];
    if (s) {
      const g = s.goals![0];
      stat = s;
      tier = "neglected-goal";
      citedGoal = g;
      reason = `Because ${displayName(s)} took 0 XP in 7 days while '${g.title}' depends on it.`;
      rep = repForGoal(g, goalById);
    }
  }

  // ④ GOAL BEHIND/MISSED · pace verdicts say a declared climb is slipping.
  if (!stat) {
    const slipping = goals
      .filter((g) => g.pace?.kind === "missed" || g.pace?.kind === "behind")
      .sort((a, b) => {
        const rank = (g: DirectiveGoal) => (g.pace?.kind === "missed" ? 0 : 1);
        return rank(a) - rank(b) || a.progress - b.progress;
      });
    for (const g of slipping) {
      const linked = (g.stats ?? [])
        .map((l) => statByKey.get(l.statKey))
        .filter((s): s is DirectiveStat => !!s)
        .sort(byVerge);
      if (linked.length === 0) continue;
      stat = linked[0];
      tier = "goal-behind";
      citedGoal = { id: g.id, title: g.title };
      reason =
        g.pace?.kind === "missed"
          ? `Because '${g.title}' is ${g.pace.overdueDays}d past its deadline at ${g.progress}% — ${displayName(stat)} is its lever.`
          : `Because '${g.title}' is behind pace at ${g.progress}% done — ${displayName(stat)} is its lever.`;
      rep = repForGoal(citedGoal, goalById);
      break;
    }
  }

  // ⑤ BODY NEGLECT · the whole Body branch took 0 XP this week.
  if (!stat) {
    const bodyStats = stats.filter((s) => s.branch === "body");
    if (bodyStats.length > 0 && bodyStats.every((s) => s.rising7dXp === 0)) {
      stat = [...bodyStats].sort(byVerge)[0];
      tier = "body-neglect";
      reason = "Based on the XP log — no Body stat gained XP in 7 days.";
      rep = {
        cta: "Open Body",
        href: "/stats#body",
        text: "Train, stretch, or log a session — any Body rep breaks the zero.",
      };
    }
  }

  // ⑥ LEARNING MOMENTUM · the loop is already hot; compound it.
  if (!stat) {
    const s = stats.find((x) => x.key === "learning" && x.rising7dXp > 0);
    if (s) {
      stat = s;
      tier = "learning";
      reason = `Because Learning is already moving (+${s.rising7dXp} XP this week) — compound it.`;
      rep = {
        cta: "Open learning",
        href: "/stats#learning",
        text: "Run one loop session below.",
      };
    }
  }

  // ⑦ CLOSEST · the old "Next rep" strip, now the weakest signal.
  if (!stat) {
    const s = [...stats].sort(byVerge)[0];
    stat = s;
    tier = "closest";
    reason = `Because it's the closest level-up on the board — ${Math.round(xpToNext(s))} XP to Lvl ${s.level + 1}.`;
    const g = s.goals?.[0];
    if (g) {
      citedGoal = g;
      rep = repForGoal(g, goalById);
    } else {
      rep = {
        cta: "Open missions",
        href: "/missions",
        text: "Any attributed rep counts — a mission task is the fastest source.",
      };
    }
  }

  const nextLevel = stat.level + 1;
  return {
    stat,
    tier,
    xpToNext: xpToNext(stat),
    reason,
    rep: rep!,
    goal: citedGoal ?? stat.goals?.[0] ?? null,
    neglected: stat.rising7dXp === 0,
    milestone: (MILESTONE_LEVELS as readonly number[]).includes(nextLevel)
      ? { level: nextLevel, tier: tierForLevel(nextLevel).name }
      : null,
    imbalance: computeBuildImbalance(stats),
    recovery,
  };
}
