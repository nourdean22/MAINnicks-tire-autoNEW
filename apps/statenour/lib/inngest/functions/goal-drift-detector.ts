/**
 * goal-drift-detector · Ambition Engine P2 · "Proactive Nick" (2026-05-31)
 *
 * Daily Inngest cron · the goal-drift detector from the Ambition Engine spec
 * (docs/specs/2026-05-30-ambition-engine.md §P2). Complements goal-pruner —
 * which only flags goals already 30+ days idle — by catching drift EARLIER:
 *
 *   · momentum-decay (P2) — a goal that WAS active (>=2 events in the prior
 *     4-week window) but has gone quiet this week, and isn't yet 30d-stale.
 *   · deadline-risk  (P1) — a goal with a deadline <=14 days out, behind on
 *     progress, with no movement this week.
 *
 * Emits priority-graded Coach Events (kind="goal-drift") -> /stats banner, and
 * acks them when the goal re-engages (activity resumes / done / paused).
 *
 * Pattern mirrors goal-pruner.ts (the established coach-writer cron). The drift
 * math is the pure `classifyDrift` (lib/mastery/goal-drift-classify.ts) so it's
 * unit-tested in isolation. Best-effort coach writes; idempotent per goalId.
 */

import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { logger as rootLogger } from "@/lib/logger";
import { recordCoachEvent, ackCoachEvent, buildCoachEventKey } from "@/lib/services/coach-events";
import {
  classifyDrift,
  type DriftVerdict,
  RECENT_DAYS,
  PRIOR_DAYS,
} from "@/lib/mastery/goal-drift-classify";

const log = rootLogger.withSurface("inngest/goal-drift-detector");
const inngest = getInngest();

interface DriftFlag {
  goalId: string;
  goalTitle: string;
  horizon: string | null;
  verdict: DriftVerdict;
  daysSinceActivity: number;
  progress: number;
  daysToDeadline: number | null;
}

async function scanForDrift(): Promise<{ flagged: DriftFlag[]; recovered: string[] }> {
  const { prisma } = await import("@/lib/prisma");
  const { activeOnly } = await import("@/lib/db/soft-delete");

  const now = Date.now();
  const recentCutoff = new Date(now - RECENT_DAYS * 86_400_000);
  const priorCutoff = new Date(now - PRIOR_DAYS * 86_400_000);

  const goals = await prisma.lifeGoal.findMany({
    where: activeOnly({ status: { in: ["active", "in_progress"] } }),
    select: {
      id: true,
      title: true,
      horizon: true,
      deadline: true,
      progress: true,
      updatedAt: true,
      events: {
        where: { createdAt: { gte: priorCutoff } },
        select: { createdAt: true },
      },
    },
  });

  const flagged: DriftFlag[] = [];
  const recovered: string[] = [];

  for (const g of goals) {
    let recentEvents = 0;
    let priorEvents = 0;
    let lastActivity = new Date(g.updatedAt);
    for (const e of g.events) {
      const t = new Date(e.createdAt);
      if (t >= recentCutoff) recentEvents++;
      else priorEvents++;
      if (t > lastActivity) lastActivity = t;
    }
    const daysSinceActivity = Math.floor((now - lastActivity.getTime()) / 86_400_000);
    const daysToDeadline = g.deadline
      ? Math.floor((new Date(g.deadline).getTime() - now) / 86_400_000)
      : null;

    const verdict = classifyDrift({
      recentEvents,
      priorEvents,
      daysSinceActivity,
      progress: g.progress,
      daysToDeadline,
    });

    if (verdict) {
      flagged.push({
        goalId: g.id,
        goalTitle: g.title,
        horizon: g.horizon,
        verdict,
        daysSinceActivity,
        progress: g.progress,
        daysToDeadline,
      });
    } else {
      // Active + not drifting -> ack any prior drift event for this goal.
      // ackCoachEvent is a no-op when none exists, so this is idempotent.
      recovered.push(g.id);
    }
  }

  return { flagged, recovered };
}

function titleFor(f: DriftFlag): string {
  if (f.verdict.signal === "deadline-risk") {
    return `Deadline risk · ${f.goalTitle} · ${f.daysToDeadline}d left at ${Math.round(f.progress)}%`;
  }
  return `Drifting · ${f.goalTitle} · quiet ${f.daysSinceActivity}d`;
}

function bodyFor(f: DriftFlag): string {
  if (f.verdict.signal === "deadline-risk") {
    return `${f.daysToDeadline} days to the deadline at ${Math.round(f.progress)}% — no movement this week. Re-commit, push, or move the date.`;
  }
  return `Was active, then nothing for ${f.daysSinceActivity} days. Re-engage now before it goes fully stale.`;
}

async function persistFlags(flagged: DriftFlag[]): Promise<void> {
  if (flagged.length === 0) return;
  await Promise.all(
    flagged.map((f) =>
      recordCoachEvent({
        kind: "goal-pace-shift",
        subjectId: f.goalId,
        priority: f.verdict.priority,
        title: titleFor(f),
        body: bodyFor(f),
        deepLink: `/stats#goal-${encodeURIComponent(f.goalId)}`,
        surfaces: ["goals"],
        extra: {
          goalTitle: f.goalTitle,
          horizon: f.horizon,
          signal: f.verdict.signal,
          daysSinceActivity: f.daysSinceActivity,
          progress: f.progress,
          daysToDeadline: f.daysToDeadline,
        },
      }),
    ),
  );
}

async function ackRecovered(recovered: string[]): Promise<void> {
  if (recovered.length === 0) return;
  await Promise.all(
    recovered.map((goalId) =>
      ackCoachEvent(buildCoachEventKey("goal-pace-shift", goalId)).catch(() => false),
    ),
  );
}

export const goalDriftDetector = inngest.createFunction(
  {
    id: "goal-drift-detector",
    name: "Goal drift detector · proactive momentum + deadline watch",
    retries: 2,
    // 30 min after goal-pruner (0 12) so the two goal scans don't collide.
    triggers: [{ cron: "30 12 * * *" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    const { flagged, recovered } = await step.run("scan-drift", () => scanForDrift());
    await step.run("persist-flags", () => persistFlags(flagged));
    await step.run("ack-recovered", () => ackRecovered(recovered));

    log.info("goal_drift_done", { flagged: flagged.length, recovered: recovered.length });

    return {
      flaggedCount: flagged.length,
      recoveredCount: recovered.length,
      samples: flagged.slice(0, 3).map((f) => ({
        title: f.goalTitle.slice(0, 50),
        signal: f.verdict.signal,
        priority: f.verdict.priority,
      })),
    };
  },
);
