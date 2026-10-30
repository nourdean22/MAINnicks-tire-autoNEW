/**
 * Monday brief "Goals" line (2026-10-30, job goals-system W2).
 *
 * The GTD weekly review's "Get Current" step: review every outcome, and make
 * sure each one carries at least one current action. The brief never read goals
 * before this; goals reached only Nick's prompt and the Home horizon line.
 *
 * Reads real rows only. No active goal is UNMEASURED and a failed read is ERROR,
 * never a 0 (empty-vs-error). Brief text may name a goal (the brief is Nour's
 * own); the durable payload carries ids and counts only.
 */
import { prisma } from "@/lib/prisma";
import { activeOnly } from "@/lib/db/soft-delete";
import { goalDue, goalPaceView } from "@/lib/brain/goal-pace";
import { escapeHtml } from "@/lib/utils/escape-html";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/goal-review-line");

/** Open = the same statuses the goals snapshot counts (lib/services/goals-snapshot.ts). */
const OPEN_TASK_STATUSES = ["INBOX", "READY", "DOING"] as const;

export interface GoalReviewRow {
  id: string;
  title: string;
  horizon: string | null;
  deadline: string | Date | null;
  createdAt: string | Date;
  /** When the current horizon was set (latest horizon_set GoalEvent); null = since creation. */
  horizonSetAt?: string | Date | null;
  targetValue: number;
  currentValue: number;
  unit?: string | null;
  openTasks: number;
}

function daysBehind(v: ReturnType<typeof goalPaceView>): number {
  return v?.kind === "chip" && v.verdict.kind === "behind" ? v.verdict.daysBehind : 0;
}

export interface GoalReviewSlice {
  lines: string[];
  payload: Record<string, unknown>;
}

export function goalReviewLines(rows: GoalReviewRow[] | "error", now: number): GoalReviewSlice {
  if (rows === "error") {
    return { lines: ["<b>Goals</b> · unknown (the goals read failed)"], payload: { state: "error" } };
  }
  if (rows.length === 0) {
    return { lines: ["<b>Goals</b> · not measured yet: no active goals"], payload: { state: "unmeasured" } };
  }

  const withNextStep = rows.filter((r) => r.openTasks > 0).length;
  const lines = [`<b>Goals</b> · ${rows.length} active · ${withNextStep} with a next step`];

  // One goal worth a look, read from the SAME verdict the goal card shows (goalPaceView), so the
  // brief can never call a goal behind or past its date while the card says otherwise: the one
  // longest past its date, else the one furthest behind on pace.
  const views = rows.map((r) => {
    const g = {
      currentValue: r.currentValue,
      targetValue: r.targetValue,
      unit: r.unit ?? "",
      status: "active",
      deadline: r.deadline ? new Date(r.deadline).toISOString() : null,
      horizon: r.horizon,
      createdAt: new Date(r.createdAt).toISOString(),
      horizonSetAt: r.horizonSetAt ? new Date(r.horizonSetAt).toISOString() : null,
    };
    const at = goalDue(g).at;
    return { r, v: goalPaceView(g, now), dueMs: at ? Date.parse(at) : Infinity };
  });
  const pastDue = views
    .filter(({ v }) => (v?.kind === "time" && v.label.startsWith("ended")) || (v?.kind === "chip" && v.verdict.kind === "missed"))
    .sort((a, b) => a.dueMs - b.dueMs);
  const behind = views
    .filter(({ v }) => v?.kind === "chip" && v.verdict.kind === "behind")
    .sort((a, b) => daysBehind(b.v) - daysBehind(a.v));
  const pick = pastDue[0] ? { word: "Past its date", ...pastDue[0] } : behind[0] ? { word: "Behind", ...behind[0] } : null;
  if (pick?.v && pick.v.kind !== "note") {
    lines.push(`${pick.word}: ${escapeHtml(pick.r.title.slice(0, 60))} · ${pick.v.label}`);
  }

  return {
    lines,
    payload: {
      state: "measured",
      active: rows.length,
      withNextStep,
      noNextStepIds: rows.filter((r) => r.openTasks === 0).map((r) => r.id),
      pastDueIds: pastDue.map((d) => d.r.id),
    },
  };
}

/** Reads active goals with their open linked task count. A failed read becomes "error". */
export async function readGoalReviewRows(): Promise<GoalReviewRow[] | "error"> {
  try {
    const goals = await prisma.lifeGoal.findMany({
      where: activeOnly({ status: "active" }),
      select: {
        id: true,
        title: true,
        horizon: true,
        deadline: true,
        createdAt: true,
        targetValue: true,
        currentValue: true,
        unit: true,
        _count: { select: { tasks: { where: { deletedAt: null, status: { in: [...OPEN_TASK_STATUSES] } } } } },
        events: { where: { kind: "horizon_set" }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      },
    });
    return goals.map(({ _count, events, ...g }) => ({ ...g, horizonSetAt: events[0]?.createdAt ?? null, openTasks: _count.tasks }));
  } catch (err) {
    log.warn("goals_read_failed", { err: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return "error";
  }
}

export async function buildGoalsSlice(now: number = Date.now()): Promise<GoalReviewSlice> {
  return goalReviewLines(await readGoalReviewRows(), now);
}
