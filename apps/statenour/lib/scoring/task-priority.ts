import { daysUntil, hourET } from "@/lib/utils/datetime";

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
  roi: 0.13,
  /** Deadline proximity — continuous 21-day ramp (see getDueUrgency). */
  dueUrgency: 0.27,
  /** Days since lastTouchedAt — older open loops climb. */
  staleness: 0.13,
  /** Dollar amount parsed from the title — $0 today, armed for invoice imports. */
  dollar: 0.12,
  /** Mission rank of the parent mission. */
  mission: 0.15,
  /** Inverse frictionScore. */
  friction: 0.09,
  /** Energy fit vs the operator's clock — morning favors HIGH, evening LOW. */
  energy: 0.05,
  /** Started work (DOING / startedAt): an open loop outranks a fresh start —
   *  attention residue makes resuming cheaper than switching (Execution Deck
   *  §6). Sized so a strong READY task still clears the HIGH band (60) —
   *  the band thresholds feed the MIT picker and must stay reachable. */
  active: 0.06,
} as const;

/** Multiplier applied AFTER the weighted sum for DAILY/WEEKLY loops: a
 *  habit is maintenance, not attention — it must never outrank business
 *  work on equal terms. Mirrors the hard exclusion in derive-briefing. */
export const HABIT_CLASS_MULTIPLIER = 0.5;

/** A task waiting on someone/something is parked, not urgent — but never
 *  invisible: the multiplier keeps it ranked so a 60-day-blocked row can
 *  still surface via staleness instead of vanishing. */
export const BLOCKED_MULTIPLIER = 0.35;

/** Boundary rule (Execution Deck §3): StateNour is the personal OS. A
 *  BUSINESS-domain task is dampened here — the shop is run from
 *  nickstire.org/admin — UNLESS its due ramp is hot (>=75), because an
 *  overdue judgment item is exactly what this surface exists to catch. */
export const SHOP_CLASS_MULTIPLIER = 0.7;
export const SHOP_OVERDUE_EXEMPT_MIN = 75;

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
  /** Free-text blocker ("Eddy", "parts delivery") — presence parks the row. */
  waitingOn?: string | null;
  /** Set when the operator started this task — resuming beats switching. */
  startedAt?: string | Date | null;
};

export type RankedMissionRef = {
  id: string;
  rank: number;
  rankScore: number;
  /** MissionDomain of the parent — drives the shop boundary dampening. */
  domain?: string | null;
};

export type PriorityTermKey = keyof typeof NOW_WEIGHTS;

/** One term of the weighted sum: the 0-100 input, its weight, and what it means for THIS task. */
export type PriorityTerm = {
  key: PriorityTermKey;
  label: string;
  input: number;
  weight: number;
  /** input × weight — this term's share of the pre-multiplier score. */
  contribution: number;
  /** The input in operator words: "due in 3d", "untouched 12d", "$846", "mission #1". */
  note: string;
};

export type PriorityMultiplier = {
  key: "habit" | "blocked" | "shop";
  factor: number;
  note: string;
};

/**
 * 2026-09-15 · the scorer's own arithmetic, exposed so the task inspector can
 * show WHY a number is what it is instead of a bare `→ 63`. Computed from the
 * same terms that produce `score` (the sum below is reduced over `terms`, in
 * the same order as the old expression), so it cannot drift from the score.
 * Absent for a manual override, which has no terms.
 */
export type PriorityBreakdown = {
  terms: PriorityTerm[];
  weightedSum: number;
  multipliers: PriorityMultiplier[];
  score: number;
};

export type TaskPriorityResult = {
  score: number;
  explanation: string;
  manual: boolean;
  breakdown?: PriorityBreakdown;
};

/**
 * Continuous due ramp (Taskwarrior-shaped, 0-100). Pressure builds BEFORE
 * the deadline instead of jumping a staircase: floor 20 from 14 days out,
 * linear climb through the deadline (due today ≈ 73), saturating at 100
 * once a task is 7 days overdue. An undated task sits just below the
 * floor (10) so "far away" still beats "never".
 */
function getDueUrgency(dueDate: string | Date | null | undefined, now: Date) {
  const remaining = daysUntil(dueDate, now);

  if (remaining === null) {
    return 10;
  }

  const daysOverdue = -remaining;

  if (daysOverdue >= 7) {
    return 100;
  }

  if (daysOverdue >= -14) {
    return Math.round(((daysOverdue + 14) * 80) / 21 + 20);
  }

  return 20;
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

/**
 * Energy fit vs the operator's ET clock: mornings reward HIGH-energy work,
 * afternoons MEDIUM, evenings LOW. The weight (0.05) keeps this a nudge,
 * never a decider — it breaks ties between otherwise-equal candidates.
 */
function getEnergyFit(energyRequired: string, now: Date): number {
  const h = hourET(now);
  if (h < 12) {
    return energyRequired === "HIGH" ? 100 : energyRequired === "MEDIUM" ? 75 : 55;
  }
  if (h < 18) {
    return energyRequired === "MEDIUM" ? 100 : energyRequired === "LOW" ? 75 : 60;
  }
  return energyRequired === "LOW" ? 100 : energyRequired === "MEDIUM" ? 60 : 30;
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
  const energyBonus = getEnergyFit(task.energyRequired, now);
  const isDoing = task.status === "DOING" || Boolean(task.startedAt);
  const activeBonus = isDoing ? 100 : 0;
  const isHabit = HABIT_LOOPS.has((task.loopKind ?? "").toUpperCase());
  const isBlocked = typeof task.waitingOn === "string" && task.waitingOn.trim().length > 0;
  const isShopDampened =
    (mission?.domain ?? "").toUpperCase() === "BUSINESS" && dueUrgency < SHOP_OVERDUE_EXEMPT_MIN;

  const remaining = daysUntil(task.dueDate, now);
  const hour = hourET(now);
  const daypart = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  // The weighted sum, term by term, in the ORDER of the original expression
  // (floating-point addition is order-sensitive; keeping it keeps every
  // existing score byte-identical).
  const rawTerms: Array<Omit<PriorityTerm, "contribution">> = [
    { key: "roi", label: "roi", input: task.roiScore, weight: NOW_WEIGHTS.roi, note: `roi ${task.roiScore} (hand-assigned)` },
    {
      key: "dueUrgency",
      label: "deadline",
      input: dueUrgency,
      weight: NOW_WEIGHTS.dueUrgency,
      note:
        remaining === null
          ? "no due date"
          : remaining <= 0
            ? `overdue ${Math.abs(Math.round(remaining))}d`
            : `due in ${Math.round(remaining)}d`,
    },
    {
      key: "staleness",
      label: "staleness",
      input: staleness,
      weight: NOW_WEIGHTS.staleness,
      note: touchDays === null ? "never touched" : touchDays === 0 ? "touched today" : `untouched ${touchDays}d`,
    },
    {
      key: "dollar",
      label: "dollars",
      input: dollarUrgency,
      weight: NOW_WEIGHTS.dollar,
      note: dollars > 0 ? `$${dollars.toLocaleString("en-US")} in the title` : "no $ in the title",
    },
    {
      key: "mission",
      label: "mission rank",
      input: missionWeight,
      weight: NOW_WEIGHTS.mission,
      note: mission ? `mission #${mission.rank}` : "no ranked mission",
    },
    { key: "friction", label: "low friction", input: inverseFriction, weight: NOW_WEIGHTS.friction, note: `friction ${task.frictionScore}` },
    {
      key: "energy",
      label: "energy fit",
      input: energyBonus,
      weight: NOW_WEIGHTS.energy,
      // Nullish-safe: quick-add payloads and test mocks omit energyRequired
      // (getEnergyFit already tolerated it); a NOTE must never throw the scorer.
      note: `${(task.energyRequired ?? "unknown").toLowerCase()} energy · ${daypart}`,
    },
    { key: "active", label: "in progress", input: activeBonus, weight: NOW_WEIGHTS.active, note: isDoing ? "started — resuming beats switching" : "not started" },
  ];
  const terms: PriorityTerm[] = rawTerms.map((t) => ({ ...t, contribution: t.input * t.weight }));
  const weighted = terms.reduce((sum, t) => sum + t.contribution, 0);

  const multipliers: PriorityMultiplier[] = [];
  if (isHabit) multipliers.push({ key: "habit", factor: HABIT_CLASS_MULTIPLIER, note: "daily/weekly loop — maintenance, not attention" });
  if (isBlocked) multipliers.push({ key: "blocked", factor: BLOCKED_MULTIPLIER, note: `waiting on ${task.waitingOn!.trim()}` });
  if (isShopDampened) multipliers.push({ key: "shop", factor: SHOP_CLASS_MULTIPLIER, note: `business domain, due ramp ${dueUrgency} < ${SHOP_OVERDUE_EXEMPT_MIN}` });
  const multiplier = multipliers.reduce((m, x) => m * x.factor, 1);
  const score = Math.round(weighted * multiplier);

  // One line, material terms only — "picked because: $846 · overdue 108d".
  const parts: string[] = [];
  if (dollars > 0) parts.push(`$${dollars.toLocaleString("en-US")}`);
  if (remaining !== null) {
    if (remaining <= 0) parts.push(`overdue ${Math.abs(Math.round(remaining))}d`);
    else parts.push(`due in ${Math.round(remaining)}d`);
  }
  if (isDoing) parts.push("in progress");
  if (isBlocked) parts.push(`waiting on ${task.waitingOn!.trim()} ×${BLOCKED_MULTIPLIER}`);
  if (touchDays !== null && touchDays >= 3) parts.push(`untouched ${touchDays}d`);
  if (isHabit) parts.push(`habit ×${HABIT_CLASS_MULTIPLIER}`);
  if (isShopDampened) parts.push(`shop ×${SHOP_CLASS_MULTIPLIER}`);
  if (mission && mission.rank <= 2) parts.push(`mission #${mission.rank}`);
  if (task.roiScore !== 50) parts.push(`roi ${task.roiScore}`);
  if (parts.length === 0) parts.push("no strong signal");

  return {
    score,
    explanation: `picked because: ${parts.join(" · ")} → ${score}`,
    manual: false,
    breakdown: { terms, weightedSum: weighted, multipliers, score },
  };
}

export const computeTaskPriority = scoreTaskPriority;
