"use client";

/**
 * GoalsHero · 2026-05-29 · Sam-Altman /goals redesign.
 *
 * The answer the operator opens /goals to get, as ONE hero zone:
 *   1. NicksGoalsBrief  · the ONE thing that compounds this week (the why)
 *   2. TopGoalToday     · the ONE goal that needs attention now (the what)
 *   3. accountability   · is that goal actually moving? (the honest check)
 *
 * The accountability line is derived — no new persistence. The snapshot
 * carries `daysSinceActivity`, so we can say "moved in the last week" vs
 * "hasn't moved in Nd · that's the bet to make today" without a point
 * delta (the snapshot has no 7-day-ago progress). A persisted
 * name-your-bet loop is a clean Phase 2 if the operator wants it.
 *
 * Both children self-hide on empty, so a quiet morning stays quiet.
 */

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { NicksGoalsBrief } from "@/components/goals/nicks-goals-brief";
import {
  TopGoalToday,
  pickTopGoal,
  type TopGoalTodayProps,
} from "@/components/goals/top-goal-today";

export function GoalsHero({ ladder }: { ladder: TopGoalTodayProps["ladder"] }) {
  const top = pickTopGoal(ladder);
  const showAccountability = top !== null && top.daysSinceActivity !== null;
  const moving =
    showAccountability && (top.daysSinceActivity as number) < 7;

  return (
    <div className="space-y-2">
      <NicksGoalsBrief />
      <TopGoalToday ladder={ladder} />
      {showAccountability && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] text-[12px] leading-snug">
          {moving ? (
            <>
              <CheckCircle2
                size={13}
                className="text-emerald-400 shrink-0"
                strokeWidth={2}
              />
              <span className="text-[var(--text-secondary)]">
                Your #1 moved in the last week — keep the streak going.
              </span>
            </>
          ) : (
            <>
              <AlertCircle
                size={13}
                className="text-rose-400 shrink-0"
                strokeWidth={2}
              />
              <span className="text-[var(--text-secondary)]">
                Your #1 hasn&apos;t moved in {top.daysSinceActivity}d — that&apos;s
                the bet to make today.
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
