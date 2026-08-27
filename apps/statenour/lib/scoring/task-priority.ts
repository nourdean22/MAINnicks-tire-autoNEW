import { daysUntil } from "@/lib/utils/datetime";

// ── CANONICAL PRIORITY POLARITY ─────────────────────────────────────
// autoPriority / manualPriorityOverride are 0-100 where HIGHER = MORE
// URGENT. scoreTaskPriority below — the engine syncTaskPriorities uses
// to rewrite every open task — has always produced this scale, but a
// second convention (5/15/30/60, lower = hotter) leaked in through the
// nick-agent create path and split readers down the middle for months:
// the 8am MIT picker, the daily scheduler and Nick's own task ordering
// were all surfacing the LEAST urgent work. 2026-08-19: one scale,
// pinned by tests/lib/scoring/task-priority-polarity.test.ts. Import
// bands/labels from here — never hand-roll thresholds.
export const PRIORITY_CRITICAL_MIN = 80;
export const PRIORITY_HIGH_MIN = 60;
export const PRIORITY_MEDIUM_MIN = 40;

// ── 2026-08-27 · REAL TERMS, MEASURED FIRST ─────────────────────────
// The old formula gave roiScore the dominant weight (0.35) — and live
// measurement showed roiScore is hand-assigned constants (open set:
// 25:1 50:5 55:1 70:4, 1.68 bits; hydration and customer follow-ups
// both hard-coded 70). A weighted sum of constants is a constant with
// extra steps. This revision demotes roi, adds the signals that are
// actually populated (lastTouchedAt 9/11, loopKind 11/11), arms a
// dollar term for when revenue items carry amounts, and applies an
// explicit habit-class demotion — the same DAILY/WEEKLY set the home
// card's arms already exclude (components/home/derive-briefing.ts).
// Weights live in this one block. Change them here or not at all.
export const NOW_WEIGHTS = {
  /** Hand-assigned at write time (measured 1.68 bits) — deliberately demoted. */
  roi: 0.15,
  /** Deadline proximity — overdue saturates at 100. */
  dueUrgency: 0.25,
  /** Days since lastTouchedAt — older open loops climb. */
  staleness: 0.15,
  /** Dollar amount parsed from the title — $0 today, armed for invoice imports. */
  dollar: 0.15,
  /** Mission rank of the parent mission. */
  mission: 0.15,
  /** Inverse frictionScore. */
  friction: 0.1,
  /** Energy fit — low-energy tasks are cheap to start. */
  energy: 0.05,
} as const;

/** Multiplier applied AFTER the weighted sum for DAILY/WEEKLY loops: a
 *  habit is maintenance, not attention — it must never outrank business
 *  work on equal terms. Mirrors the hard exclusion in derive-briefing. */
export const HABIT_CLASS_MULTIPLIER = 0.5;

/** Loop kinds that are habits. Single source — derive-briefing imports this. */
export const HABIT_LOOPS = new Set(["DAILY", "WEEKLY"]);

export type PriorityBand = "critical" | "high" | "medium" | "low";

export function priorityBandLabel(score: number | null | undefined): PriorityBand {
  const s = typeof score === "number" ? score : 50;
  if (s >= PRIORITY_CRITICAL_MIN) return "critical";
  if (s >= PRIORITY_HIGH_MIN) return "high";
  if (s >= PRIORITY_MEDIUM_MIN) return "medium";
  return "low";
}

/** Label → canonical score, for writers that only know a label. */
export function priorityFromLabel(p: unknown): number {
  return p === "critical" ? 90 : p === "high" ? 70 : p === "low" ? 30 : 50;
}

/** Sort comparator — most urgent first; unscored rows sink to the bottom. */
export function byPriorityDesc(
  a: { autoPriority?: number | null },
  b: { autoPriority?: number | null },
): number {
  return (b.autoPriority ?? -1) - (a.autoPriority ?? -1);
}

export type TaskPriorityCandidate = {
  id?: string;
  title: string;
  missionId: string;
  status: string;
  roiScore: number;
  frictionScore: number;
  energyRequired: string;
  dueDate?: string | Date | null;
  lastTouchedAt?: string | Date | null;
  loopKind?: string | null;
  manualPriorityOverride?: number | null;
};

export type RankedMissionRef = {
  id: string;
  rank: number;
  rankScore: number;
};

export type TaskPriorityResult = {
  score: number;
  explanation: string;
  manual: boolean;
};

function getDueUrgency(dueDate: string | Date | null | undefined, now: Date) {
  const remaining = daysUntil(dueDate, now);

  if (remaining === null) {
    return 10;
  }

  if (remaining <= 0) {
    return 100;
  }

  if (remaining < 1) {
    return 90;
  }

  if (remaining === 1) {
    return 75;
  }

  if (remaining <= 3) {
    return 60;
  }

  if (remaining <= 7) {
    return 40;
  }

  return 10;
}

/** Days since the task was last touched; null when never touched. */
function daysSinceTouch(lastTouchedAt: string | Date | null | undefined, now: Date): number | null {
  if (!lastTouchedAt) return null;
  const t = new Date(lastTouchedAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/** Staleness: an untouched open loop gains claim on attention as it ages. */
function getStaleness(days: number | null): number {
  if (days === null) return 40; // unknown — mid-low, never dominates
  if (days <= 2) return 15;
  if (days <= 7) return 45;
  if (days <= 21) return 70;
  return 90;
}

/** First $-amount in the title, or 0. "$1,846.50" → 1846.5 */
export function dollarAmountFromTitle(title: string): number {
  const m = /\$\s?(\d[\d,]*(?:\.\d+)?)/.exec(title);
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Log-scaled dollar urgency: $0→0 · $100→50 · $1k→75 · ≥$10k→100. */
function getDollarUrgency(amount: number): number {
  if (amount <= 0) return 0;
  return Math.min(100, Math.round(25 * Math.log10(amount + 1)));
}

export function scoreTaskPriority(
  task: TaskPriorityCandidate,
  missionRankings: Map<string, RankedMissionRef>,
  now = new Date()
): TaskPriorityResult {
  if (typeof task.manualPriorityOverride === "number") {
    return {
      score: task.manualPriorityOverride,
      explanation: `Manual priority override ${task.manualPriorityOverride} set by operator.`,
      manual: true
    };
  }

  const mission = missionRankings.get(task.missionId);
  const dueUrgency = getDueUrgency(task.dueDate, now);
  const touchDays = daysSinceTouch(task.lastTouchedAt, now);
  const staleness = getStaleness(touchDays);
  const dollars = dollarAmountFromTitle(task.title);
  const dollarUrgency = getDollarUrgency(dollars);
  const inverseFriction = Math.max(0, 100 - task.frictionScore);
  const missionWeight = !mission ? 10 : mission.rank === 1 ? 100 : mission.rank === 2 ? 70 : 50;
  const energyBonus = task.energyRequired === "LOW" ? 100 : task.energyRequired === "MEDIUM" ? 70 : 45;
  const isHabit = HABIT_LOOPS.has((task.loopKind ?? "").toUpperCase());

  const weighted =
    task.roiScore * NOW_WEIGHTS.roi +
    dueUrgency * NOW_WEIGHTS.dueUrgency +
    staleness * NOW_WEIGHTS.staleness +
    dollarUrgency * NOW_WEIGHTS.dollar +
    missionWeight * NOW_WEIGHTS.mission +
    inverseFriction * NOW_WEIGHTS.friction +
    energyBonus * NOW_WEIGHTS.energy;
  const score = Math.round(weighted * (isHabit ? HABIT_CLASS_MULTIPLIER : 1));

  // One line, material terms only — "picked because: $846 · overdue 108d".
  const remaining = daysUntil(task.dueDate, now);
  const parts: string[] = [];
  if (dollars > 0) parts.push(`$${dollars.toLocaleString("en-US")}`);
  if (remaining !== null) {
    if (remaining <= 0) parts.push(`overdue ${Math.abs(Math.round(remaining))}d`);
    else parts.push(`due in ${Math.round(remaining)}d`);
  }
  if (touchDays !== null && touchDays >= 3) parts.push(`untouched ${touchDays}d`);
  if (isHabit) parts.push(`habit ×${HABIT_CLASS_MULTIPLIER}`);
  if (mission && mission.rank <= 2) parts.push(`mission #${mission.rank}`);
  if (task.roiScore !== 50) parts.push(`roi ${task.roiScore}`);
  if (parts.length === 0) parts.push("no strong signal");

  return {
    score,
    explanation: `picked because: ${parts.join(" · ")} → ${score}`,
    manual: false
  };
}

export const computeTaskPriority = scoreTaskPriority;
