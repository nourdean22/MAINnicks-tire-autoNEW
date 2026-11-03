/**
 * The Goals tab's pure model (job 2026-11-02-nour-os-interconnect W5; spec
 * docs/superpowers/specs/2026-05-29-goals-sam-redesign-design.md: "am I winning, and what's the one move?").
 *
 *  - missionPhaseLadder: the milestone ladder on a goal card, from the linked mission's plan phases
 *    (Asana: goal progress comes from the linked work). Read on the server in lib/services/goals.ts.
 *  - pickHeroGoal: the one goal the hero shows (Tability "My focus": the item that needs you now).
 *  - momentInput: a board goal as W6's maximForGoalMoment (lib/brain/goal-maxim.ts) reads it, so the card
 *    and Nick's recall pick the same maxim for the same goal on the same day.
 *  - goalsPulse + movedLine: the hero's one-line band and its accountability line.
 * Every input is plain data; nothing here reads a clock it was not given.
 */
import { etDaysBetween, goalDue, goalPaceView, type GoalHealth, type GoalHealthState, type PaceVerdict } from "@/lib/brain/goal-pace";
import { goalMomentState, type GoalMomentInput } from "@/lib/brain/goal-maxim";
import { etHourKey, type Maxim } from "@/lib/wisdom/maxims";


// ── Milestone ladder ─────────────────────────────────────────────────────────────────────────────

export interface LadderPhase {
  name: string;
  done: boolean;
  current: boolean;
}

/** Open statuses: the same set maybeSpawnNextPhase (lib/services/tasks.ts) waits on before the next phase spawns. */
const OPEN = new Set(["INBOX", "READY", "DOING", "WAITING"]);

/**
 * A phase is done when it has a DONE task and none is open; phases spawn one after another, so a
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
    // Done needs one DONE task: a phase whose steps were all archived was dropped, not finished.
    const done = mine.some((t) => t.status === "DONE") && mine.every((t) => !OPEN.has(t.status));
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

// ── Board goals into the moment contract ──────────────────────────────────────────────────────────

function paceVerdict(g: PageGoal, now: number): PaceVerdict | null {
  const view = goalPaceView(g, now);
  return view?.kind === "chip" ? view.verdict : null;
}

/** A board goal as the moment selector reads it: health from the newest check-in, pace from goalPaceView. */
export function momentInput(g: PageGoal, now: number): GoalMomentInput {
  return { id: g.id, status: g.status, health: g.health?.state ?? null, pace: paceVerdict(g, now) };
}

/**
 * The pool minus the maxims Nour skipped on Home (getGoals `skippedMaximIds`). An unread list (null, or
 * an older payload without the field) gives no pool: the card shows no maxim, never a skipped one.
 */
export function maximPoolWithout(pool: readonly Maxim[], skipped: readonly string[] | null | undefined): Maxim[] | null {
  if (!skipped) return null;
  const out = new Set(skipped);
  return pool.filter((m) => !out.has(m.id));
}

/** The ET day key for a clock, as `today()` gives it. */
export function etDay(now: number): string {
  return etHourKey(new Date(now)).slice(0, 10);
}

// ── The hero ─────────────────────────────────────────────────────────────────────────────────────

export type HeroReason = "furthest_behind" | "due_soonest" | "health" | "least_progress" | "only";

function daysBehind(v: PaceVerdict | null): number {
  if (v?.kind === "missed") return v.overdueDays;
  if (v?.kind === "behind") return v.daysBehind;
  return -1;
}

/** Health that asks for him, worst first; anything else does not rank. */
const HEALTH_RANK: Partial<Record<GoalHealthState, number>> = { off_track: 3, at_risk: 2, no_check_in: 1 };

/**
 * The item that needs him now (Tability "My focus"), first match wins, ties keep the server's order:
 * 1. missed its date or furthest behind pace; 2. due soonest (goalDue: his deadline, else the horizon's
 * end); 3. worst health (off track > at risk > no check-in); 4. least progress. An achieved goal yields
 * to any open one. The reason says what decided it; "only" when there is one goal.
 */
export function pickHeroGoal<T extends PageGoal>(
  goals: readonly T[],
  now: number,
): { goal: T; reason: HeroReason; health?: GoalHealthState } | null {
  if (goals.length === 0) return null;
  if (goals.length === 1) return { goal: goals[0]!, reason: "only" };
  const open = goals.filter((g) => g.progress < 100);
  const pool = open.length > 0 ? open : goals;
  let behind: { goal: T; days: number } | null = null;
  for (const g of pool) {
    const days = daysBehind(paceVerdict(g, now));
    if (days >= 0 && (!behind || days > behind.days)) behind = { goal: g, days };
  }
  if (behind) return { goal: behind.goal, reason: "furthest_behind" };
  let soonest: { goal: T; at: number } | null = null;
  for (const g of pool) {
    const due = goalDue(g);
    const at = due.at ? Date.parse(due.at) : NaN;
    if (Number.isFinite(at) && at >= now && (!soonest || at < soonest.at)) soonest = { goal: g, at };
  }
  if (soonest) return { goal: soonest.goal, reason: "due_soonest" };
  let worst: { goal: T; rank: number; state: GoalHealthState } | null = null;
  for (const g of pool) {
    const state = g.health?.state;
    const rank = state ? HEALTH_RANK[state] ?? 0 : 0;
    if (state && rank > 0 && (!worst || rank > worst.rank)) worst = { goal: g, rank, state };
  }
  if (worst) return { goal: worst.goal, reason: "health", health: worst.state };
  let least = pool[0]!;
  for (const g of pool) if (g.progress < least.progress) least = g;
  return { goal: least, reason: "least_progress" };
}

/** The pulse of all goals. `unknown` = health not read (a failed check-in read, or no field): never fine. */
export function goalsPulse(goals: readonly PageGoal[], now: number) {
  let behind = 0;
  let offTrack = 0;
  let checkInDue = 0;
  let unknown = 0;
  for (const g of goals) {
    if (!g.health || g.health.state === "unknown") unknown++;
    const m = goalMomentState(momentInput(g, now));
    if (m === "behind_pace" || m === "at_risk") behind++;
    else if (m === "off_track") offTrack++;
    else if (m === "check_in_due") checkInDue++;
  }
  return { total: goals.length, behind, offTrack, checkInDue, unknown };
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
  const newest = read.items[0]; // relatedActivity sorts newest first (lib/services/related-activity.ts)
  if (newest) {
    const d = etDaysBetween(Date.parse(newest.at), now);
    const unread = read.failed.length > 0 ? " (some sources unread)" : "";
    return `${d <= 0 ? "Moved today" : `Moved ${d}d ago`}${unread}`;
  }
  if (read.failed.length > 0) return `Couldn't read ${read.failed.join(", ")}: activity unknown`;
  return read.since ? `Nothing logged since ${read.since.slice(0, 10)}` : "Nothing logged yet";
}
