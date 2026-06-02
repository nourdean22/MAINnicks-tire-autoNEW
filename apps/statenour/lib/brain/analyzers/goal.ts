/**
 * Goal analyzer engine · 2026-06-02
 *
 * Ports the goal-analyzer skill's SMART methodology (Specific / Measurable /
 * Achievable / Relevant / Time-bound, each scored 1-5 -> overall grade
 * S/A/B/C, plus progress + pace tracking and optimization advice), GROUNDED
 * in the operator's real LifeGoal rows. No fabrication: every sub-score is
 * derived from actual fields, each weakness names the exact gap, and an empty
 * portfolio is reported honestly rather than invented.
 *
 * Serves a known gap (MEMORY): the operator's goals are sparse and several
 * have targetValue=0 (= not Measurable). This surfaces and grades exactly that.
 *
 * Grade bands are adapted from the source skill (which graded a 4.8 avg as
 * "A"); kept as clean, defensible thresholds. Pure core = computeGoalAnalysis()
 * (unit-tested, no IO, `now` injected for determinism). IO wrapper =
 * analyzeGoals() (prisma read -> compute). Tool: lib/ai/tools/brain.ts.
 */
import { prisma } from "@/lib/prisma";

export type Grade = "S" | "A" | "B" | "C";
export type PaceStatus =
  | "ahead"
  | "on-track"
  | "behind"
  | "severely-behind"
  | "no-deadline"
  | "achieved";

export interface GoalInput {
  domain: string;
  title: string;
  metric: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  deadline: Date | null;
  status: string;
  progress: number;
  kind: string;
  horizon: string | null;
  why: string | null;
  parentGoalId: string | null;
  createdAt: Date;
}

export interface GoalScore {
  title: string;
  domain: string;
  smart: {
    specific: number;
    measurable: number;
    achievable: number;
    relevant: number;
    timeBound: number;
  };
  overall: number; // mean of the 5 sub-scores, 1-5
  grade: Grade;
  progressPct: number | null;
  pace: PaceStatus;
  weaknesses: string[];
  suggestion: string;
}

export interface GoalAnalysis {
  dataCompleteness: { activeGoals: number; sufficient: boolean; note: string };
  portfolio: {
    count: number;
    avgScore: number;
    gradeBreakdown: Record<Grade, number>;
    weakCount: number; // grade C
    unmeasurableCount: number; // metric goal with targetValue<=0
  } | null;
  goals: GoalScore[];
  guidance: string[];
}

function clamp(n: number, lo = 1, hi = 5): number {
  return Math.max(lo, Math.min(hi, n));
}
function round(n: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
function gradeOf(score: number): Grade {
  if (score >= 4.5) return "S";
  if (score >= 3.5) return "A";
  if (score >= 2.5) return "B";
  return "C";
}

/** A title shorter than this reads as vague ("get fit", "save money"). */
const VAGUE_TITLE_MAX = 8;

function scoreGoal(g: GoalInput, now: Date): GoalScore {
  const title = g.title.trim();
  const hasWhy = !!(g.why && g.why.trim().length > 0);
  const hasMetric = g.metric.trim().length > 0;
  const isMetricKind = g.kind === "metric";

  // Specific — a defined metric + a "why" + a non-vague title.
  let specific = 3;
  if (hasMetric) specific += 1;
  if (hasWhy) specific += 1;
  if (title.length < VAGUE_TITLE_MAX) specific -= 2;
  specific = clamp(specific);

  // Measurable — the load-bearing gap. A metric goal needs a real target
  // (+ unit); target=0 is the operator's known anti-pattern.
  let measurable: number;
  if (isMetricKind) {
    if (g.targetValue > 0 && g.unit.trim().length > 0) measurable = 5;
    else if (g.targetValue > 0) measurable = 3;
    else measurable = 1; // target<=0 -> not measurable
  } else if (g.kind === "milestone") {
    measurable = 4; // checklist %
  } else {
    measurable = 2; // narrative — hard to measure objectively
  }

  // Achievable — can't truly know without domain judgment, so stay
  // conservative + grounded: a thought-through goal (has a "why") and one
  // not already missed scores neutral-to-good.
  let achievable = 3;
  if (hasWhy) achievable += 1;
  if (g.status === "missed") achievable = 1;
  achievable = clamp(achievable);

  // Relevant — has a purpose ("why"), ladders into a parent goal, sits in a domain.
  let relevant = 2;
  if (hasWhy) relevant += 1;
  if (g.parentGoalId) relevant += 1;
  if (g.domain.trim().length > 0) relevant += 1;
  relevant = clamp(relevant);

  // Time-bound — a hard deadline beats a fuzzy horizon beats nothing.
  let timeBound: number;
  if (g.deadline) timeBound = 5;
  else if (g.horizon && g.horizon.trim().length > 0) timeBound = 3;
  else timeBound = 1;

  const smart = { specific, measurable, achievable, relevant, timeBound };
  const overall = round(
    (specific + measurable + achievable + relevant + timeBound) / 5,
  );
  const grade = gradeOf(overall);

  // Progress % — from real values when measurable, else the stored progress.
  let progressPct: number | null;
  if (isMetricKind && g.targetValue > 0) {
    progressPct = round(clamp((g.currentValue / g.targetValue) * 100, 0, 100), 0);
  } else if (g.progress > 0) {
    progressPct = round(clamp(g.progress, 0, 100), 0);
  } else {
    progressPct = isMetricKind && g.targetValue <= 0 ? null : 0;
  }

  // Pace — progress vs elapsed time toward the deadline.
  let pace: PaceStatus;
  if (g.status === "achieved") {
    pace = "achieved";
  } else if (!g.deadline || progressPct == null) {
    pace = "no-deadline";
  } else {
    const total = g.deadline.getTime() - g.createdAt.getTime();
    const elapsed = now.getTime() - g.createdAt.getTime();
    const timePct = total > 0 ? clamp((elapsed / total) * 100, 0, 100) : 100;
    const gap = progressPct - timePct;
    if (gap >= 10) pace = "ahead";
    else if (gap >= -10) pace = "on-track";
    else if (gap >= -30) pace = "behind";
    else pace = "severely-behind";
  }

  // Weaknesses — transparent + actionable; each maps to a low sub-score.
  const weaknesses: string[] = [];
  if (measurable <= 2)
    weaknesses.push(
      isMetricKind
        ? "Not measurable -- targetValue is 0 (or no unit). Set a real target + unit."
        : "Hard to measure -- define a checklist or a numeric target.",
    );
  if (timeBound <= 1)
    weaknesses.push("Not time-bound -- add a deadline or a horizon.");
  if (!hasWhy)
    weaknesses.push("No 'why' -- add the motivation so it survives a priority shift.");
  if (specific <= 2)
    weaknesses.push("Vague -- make the title concrete and attach a metric.");
  if (g.status === "missed")
    weaknesses.push("Marked missed -- revive with a new plan or kill it.");
  if (pace === "severely-behind")
    weaknesses.push("Severely behind pace -- re-scope the target or move the deadline.");

  const suggestion =
    weaknesses[0] ??
    (pace === "ahead"
      ? "Ahead of pace -- consider raising the target."
      : "Well-formed goal. Keep logging progress.");

  return {
    title: g.title,
    domain: g.domain,
    smart,
    overall,
    grade,
    progressPct,
    pace,
    weaknesses,
    suggestion,
  };
}

/** Pure scoring core — synthetic-testable, `now` injected. */
export function computeGoalAnalysis(goals: GoalInput[], now: Date): GoalAnalysis {
  const count = goals.length;

  if (count === 0) {
    return {
      dataCompleteness: {
        activeGoals: 0,
        sufficient: false,
        note: "No active goals to analyze.",
      },
      portfolio: null,
      goals: [],
      guidance: [
        "No active goals. Author one SMART goal (specific metric + target value + unit + deadline) so Nick can track and coach it.",
      ],
    };
  }

  const scored = goals.map((g) => scoreGoal(g, now));
  const gradeBreakdown: Record<Grade, number> = { S: 0, A: 0, B: 0, C: 0 };
  for (const s of scored) gradeBreakdown[s.grade] += 1;
  const avgScore = round(scored.reduce((a, s) => a + s.overall, 0) / count);
  const weakCount = scored.filter((s) => s.grade === "C").length;
  const unmeasurableCount = goals.filter(
    (g) => g.kind === "metric" && g.targetValue <= 0,
  ).length;

  const guidance: string[] = [];
  if (unmeasurableCount > 0)
    guidance.push(
      `${unmeasurableCount} of ${count} goal(s) have targetValue=0 -- not measurable. Set real targets so progress is trackable.`,
    );
  if (weakCount > 0)
    guidance.push(
      `${weakCount} goal(s) grade C (weak SMART). Fix the named weaknesses or kill them -- a vague goal is a zombie.`,
    );
  const behind = scored.filter(
    (s) => s.pace === "behind" || s.pace === "severely-behind",
  ).length;
  if (behind > 0)
    guidance.push(`${behind} goal(s) behind pace -- re-scope or re-prioritize.`);
  if (guidance.length === 0)
    guidance.push("Goal portfolio is well-formed and on pace. Keep logging progress.");

  return {
    dataCompleteness: {
      activeGoals: count,
      sufficient: true,
      note: `Analyzed ${count} active goal(s).`,
    },
    portfolio: { count, avgScore, gradeBreakdown, weakCount, unmeasurableCount },
    goals: scored,
    guidance,
  };
}

/** IO wrapper — reads the operator's active goals and runs the pure core. */
export async function analyzeGoals(): Promise<GoalAnalysis> {
  const rows = await prisma.lifeGoal
    .findMany({
      where: { deletedAt: null, status: "active" },
      orderBy: { createdAt: "asc" },
      select: {
        domain: true,
        title: true,
        metric: true,
        targetValue: true,
        currentValue: true,
        unit: true,
        deadline: true,
        status: true,
        progress: true,
        kind: true,
        horizon: true,
        why: true,
        parentGoalId: true,
        createdAt: true,
      },
    })
    .catch((): never[] => []);

  const goals: GoalInput[] = rows.map((r) => ({
    domain: r.domain,
    title: r.title,
    metric: r.metric,
    targetValue: r.targetValue,
    currentValue: r.currentValue,
    unit: r.unit,
    deadline: r.deadline,
    status: r.status,
    progress: r.progress,
    kind: r.kind,
    horizon: r.horizon,
    why: r.why,
    parentGoalId: r.parentGoalId,
    createdAt: r.createdAt,
  }));

  return computeGoalAnalysis(goals, new Date());
}
