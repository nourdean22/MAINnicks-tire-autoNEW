/**
 * The Goals tab's pure model (job 2026-11-02-nour-os-interconnect W5; spec
 * docs/superpowers/specs/2026-05-29-goals-sam-redesign-design.md: "am I winning, and what's the one move?").
 *
 *  - missionPhaseLadder: the milestone ladder on a goal card, from the linked mission's plan phases
 *    (Asana: goal progress comes from the linked work). Read on the server in lib/services/goals.ts.
 *  - pickHeroGoal: the one goal the hero shows (Tability "My focus": the item that needs you now).
 *  - goalMomentState + maximForGoalMoment: one maxim from his books, only at a goal moment, the tag
 *    chosen by the state. A copy of W6's lib/brain/goal-maxim.ts contract until W6 merges (see SEAM).
 *  - goalsPulse + movedLine: the hero's one-line band and its accountability line.
 * Every input is plain data; nothing here reads a clock it was not given.
 */
import { goalDue, goalPaceView, type GoalHealth, type GoalHealthState, type PaceVerdict } from "@/lib/brain/goal-pace";
import { today } from "@/lib/utils/datetime";
import { etHourKey, pickMaximForDay, type Maxim, type MaximTag } from "@/lib/wisdom/maxims";

const DAY_MS = 86_400_000;

// ── Milestone ladder ─────────────────────────────────────────────────────────────────────────────

export interface LadderPhase {
  name: string;
  done: boolean;
  current: boolean;
}

/** Open statuses: the same set maybeSpawnNextPhase (lib/services/tasks.ts) waits on before the next phase spawns. */
const OPEN = new Set(["INBOX", "READY", "DOING", "WAITING"]);

/**
 * A phase is done when it has spawned tasks and none is open; phases spawn one after another, so a
 * phase with no tasks yet is not done. The first phase not done is current.
 */
export function missionPhaseLadder(
  planData: unknown,
  tasks: ReadonlyArray<{ status: string; phaseName: string | null }>,
): LadderPhase[] {
  const phases = (planData as { phases?: unknown } | null)?.phases;
  if (!Array.isArray(phases)) return [];
  let currentSet = false;
  const out: LadderPhase[] = [];
  for (const p of phases) {
    const name = (p as { name?: unknown } | null)?.name;
    if (typeof name !== "string" || !name.trim()) continue;
    const mine = tasks.filter((t) => t.phaseName === name);
    const done = mine.length > 0 && mine.every((t) => !OPEN.has(t.status));
    const current = !done && !currentSet;
    if (current) currentSet = true;
    out.push({ name, done, current });
  }
  return out;
}

// ── Goal moments and the maxim ───────────────────────────────────────────────────────────────────

/** The fields the page model reads; the board's goal rows carry all of them (lib/services/goals.ts getGoals). */
export interface PageGoal {
  id: string;
  title: string;
  progress: number;
  status: string;
  currentValue: number;
  targetValue: number;
  unit: string;
  deadline: string | null;
  horizon: string | null;
  createdAt: string;
  horizonSetAt?: string | null;
  health?: GoalHealth;
}

/**
 * The goal moment and its maxim. SEAM (manager ruling 2026-11-03): the one selector is W6's
 * `maximForGoalMoment` in lib/brain/goal-maxim.ts, so the card and Nick's recall pick the same line.
 * Until W6 is on main, the block below is a copy of W6's file at e6bbf5d0e8 (same names, signature,
 * states, tags, key and cap); the swap is: delete the block, import the same names from
 * "@/lib/brain/goal-maxim". `momentInput` adapts a board goal to its input.
 */
export const GOAL_MOMENT_STATES = ["behind_pace", "off_track", "at_risk", "check_in_due", "achieved"] as const;
export type GoalMomentState = (typeof GOAL_MOMENT_STATES)[number];

export const GOAL_MOMENT_TAG: Readonly<Record<GoalMomentState, MaximTag>> = {
  off_track: "decisions",
  behind_pace: "timing",
  at_risk: "focus",
  check_in_due: "focus",
  achieved: "learning",
};

export const MAXIM_TEXT_MAX = 160;

export interface GoalMomentInput {
  id: string;
  status: string;
  health: GoalHealthState | null;
  pace: { kind: string } | null;
}

export interface GoalMaxim {
  id: string;
  text: string;
  origin: string;
  state: GoalMomentState;
}

/** Highest first: achieved > off_track > behind_pace > at_risk > check_in_due; on track or unknown is none. */
export function goalMomentState(g: Omit<GoalMomentInput, "id">): GoalMomentState | null {
  if (g.status === "achieved") return "achieved";
  if (g.status === "missed" || g.health === "off_track" || g.pace?.kind === "missed") return "off_track";
  if (g.pace?.kind === "behind") return "behind_pace";
  if (g.health === "at_risk") return "at_risk";
  if (g.health === "no_check_in") return "check_in_due";
  return null;
}

export function maximForGoalMoment(goal: GoalMomentInput, pool: readonly Maxim[], day: string = today()): GoalMaxim | null {
  const state = goalMomentState(goal);
  if (!state) return null;
  const m = pickMaximForDay(pool, GOAL_MOMENT_TAG[state], `${day}:${goal.id}:${state}`);
  return m ? { id: m.id, text: m.text.slice(0, MAXIM_TEXT_MAX), origin: m.source, state } : null;
}

// ── Board goals into the moment contract ──────────────────────────────────────────────────────────

function paceVerdict(g: PageGoal, now: number): PaceVerdict | null {
  const view = goalPaceView(g, now);
  return view?.kind === "chip" ? view.verdict : null;
}

/** A board goal as the moment selector reads it: health from the newest check-in, pace from goalPaceView. */
export function momentInput(g: PageGoal, now: number): GoalMomentInput {
  return { id: g.id, status: g.status, health: g.health?.state ?? null, pace: paceVerdict(g, now) };
}

/** The ET day key for a clock, as `today()` gives it. */
export function etDay(now: number): string {
  return etHourKey(new Date(now)).slice(0, 10);
}

// ── The hero ─────────────────────────────────────────────────────────────────────────────────────

export type HeroReason = "due_soonest" | "furthest_behind" | "first";

function daysBehind(v: PaceVerdict | null): number {
  if (v?.kind === "missed") return v.overdueDays;
  if (v?.kind === "behind") return v.daysBehind;
  return -1;
}

/**
 * The goal whose due date (goalDue: his deadline, else the horizon's end) comes soonest; with none
 * ahead, the one furthest behind pace; else the first in the server's order. An achieved goal yields
 * the hero to any open one.
 */
export function pickHeroGoal<T extends PageGoal>(goals: readonly T[], now: number): { goal: T; reason: HeroReason } | null {
  if (goals.length === 0) return null;
  const open = goals.filter((g) => g.progress < 100);
  const pool = open.length > 0 ? open : goals;
  let soonest: { goal: T; at: number } | null = null;
  for (const g of pool) {
    const due = goalDue(g);
    const at = due.at ? Date.parse(due.at) : NaN;
    if (Number.isFinite(at) && at >= now && (!soonest || at < soonest.at)) soonest = { goal: g, at };
  }
  if (soonest) return { goal: soonest.goal, reason: "due_soonest" };
  let behind: { goal: T; days: number } | null = null;
  for (const g of pool) {
    const days = daysBehind(paceVerdict(g, now));
    if (days >= 0 && (!behind || days > behind.days)) behind = { goal: g, days };
  }
  if (behind) return { goal: behind.goal, reason: "furthest_behind" };
  return { goal: pool[0]!, reason: "first" };
}

export function goalsPulse(goals: readonly PageGoal[], now: number) {
  let behind = 0;
  let offTrack = 0;
  let checkInDue = 0;
  for (const g of goals) {
    const m = goalMomentState(momentInput(g, now));
    if (m === "behind_pace" || m === "at_risk") behind++;
    else if (m === "off_track") offTrack++;
    else if (m === "check_in_due") checkInDue++;
  }
  return { total: goals.length, behind, offTrack, checkInDue };
}

/** The since-list read (task.goalSinceCheckIn) as the hero sees it. */
export type SinceForHero =
  | "loading"
  | "error"
  | { since: string | null; total: number; items: ReadonlyArray<{ at: string; kind: string; title: string }>; failed: readonly string[] };

/** The accountability line: did the goal move lately? A failed source is unknown, never "nothing". */
export function movedLine(read: SinceForHero, now: number): string {
  if (read === "loading") return "Reading recent activity";
  if (read === "error") return "Couldn't read recent activity";
  const newest = read.items[0];
  if (newest) {
    const d = Math.floor((now - Date.parse(newest.at)) / DAY_MS);
    return d <= 0 ? "Moved today" : `Moved ${d}d ago`;
  }
  if (read.failed.length > 0) return `Couldn't read ${read.failed.join(", ")}: activity unknown`;
  return read.since ? `Nothing logged since ${read.since.slice(0, 10)}` : "Nothing logged yet";
}
