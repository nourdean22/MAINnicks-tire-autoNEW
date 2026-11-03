/**
 * The Goals tab's pure model (job 2026-11-02-nour-os-interconnect W5; spec
 * docs/superpowers/specs/2026-05-29-goals-sam-redesign-design.md: "am I winning, and what's the one move?").
 *
 *  - missionPhaseLadder: the milestone ladder on a goal card, from the linked mission's plan phases
 *    (Asana: goal progress comes from the linked work). Read on the server in lib/services/goals.ts.
 *  - pickHeroGoal: the one goal the hero shows (Tability "My focus": the item that needs you now).
 *  - goalMoment + maximForGoalMoment: one maxim from his books, only at a goal moment, the tag chosen
 *    by the state (same pattern as lib/services/people/maxim-for-pick.ts). No model call.
 *  - goalsPulse + movedLine: the hero's one-line band and its accountability line.
 * Every input is plain data; nothing here reads a clock it was not given.
 */
import { goalDue, goalPaceView, type GoalHealth, type PaceVerdict } from "@/lib/brain/goal-pace";
import { MAXIM_POOL } from "@/lib/wisdom/maxim-pool";
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

export type GoalMomentState = "achieved" | "off_track" | "behind" | "check_in_due";

/** Which maxim tag answers which moment: a win locks in the lesson, off track asks for a decision. */
export const MOMENT_TAG: Readonly<Record<GoalMomentState, MaximTag>> = {
  achieved: "learning",
  off_track: "decisions",
  behind: "focus",
  check_in_due: "timing",
};

function paceVerdict(g: PageGoal, now: number): PaceVerdict | null {
  const view = goalPaceView(g, now);
  return view?.kind === "chip" ? view.verdict : null;
}

/** The goal's moment, or null when nothing calls for a maxim. An unknown health is never a moment. */
export function goalMoment(g: PageGoal, now: number): GoalMomentState | null {
  if (g.progress >= 100) return "achieved";
  const health = g.health?.state;
  const pace = paceVerdict(g, now);
  if (health === "off_track" || pace?.kind === "missed") return "off_track";
  if (health === "at_risk" || pace?.kind === "behind") return "behind";
  if (health === "no_check_in") return "check_in_due";
  return null;
}

export interface GoalMaxim {
  state: GoalMomentState;
  tag: MaximTag;
  id: string;
  text: string;
  source: string;
}

/** One maxim for the goal's moment, keyed by ET day and goal so it holds still all day. */
export function maximForGoalMoment(g: PageGoal, now: number, pool: readonly Maxim[] = MAXIM_POOL): GoalMaxim | null {
  const state = goalMoment(g, now);
  if (!state) return null;
  const tag = MOMENT_TAG[state];
  const m = pickMaximForDay(pool, tag, `${etHourKey(new Date(now)).slice(0, 10)}:${g.id}`);
  return m ? { state, tag, id: m.id, text: m.text, source: m.source } : null;
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
    const m = goalMoment(g, now);
    if (m === "behind") behind++;
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
