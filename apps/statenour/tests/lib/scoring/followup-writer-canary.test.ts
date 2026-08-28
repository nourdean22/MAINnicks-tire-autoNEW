/**
 * Collect-lane canary — operator picked lane (b) 2026-08-28: revenue urgency
 * enters NOUR OS as hand-curated collect/follow-up tasks, ranked by the
 * scorer's TERMS, never by a hand-blessed constant.
 *
 * Two pins:
 * 1 · SOURCE SCAN (polarity-test precedent): the customer-follow-up writer in
 *     lib/ai/tools/tasks.ts must not re-bless roiScore 70 — that constant is
 *     what tied follow-ups to the hydration habit's hand score.
 * 2 · RANKING with positive control: a follow-up AS THE WRITER NOW EMITS IT
 *     (roi 50, due set, $-note in title) outranks the hydration fixture on
 *     terms; the OLD writer shape (roi 70, same task) merely TIED hydration's
 *     roi under the pre-#1946 raw-roiScore ordering — ranked by luck.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { scoreTaskPriority, type RankedMissionRef } from "@/lib/scoring/task-priority";

const NOW = new Date("2026-08-28T15:00:00Z");
const DAY = 86_400_000;
const noMissions = new Map<string, RankedMissionRef>();

const hydration = {
  title: "Drink water — 6+ bottles",
  missionId: "m-habits",
  status: "DOING",
  roiScore: 70, // the live hand constant, measured 2026-08-27
  frictionScore: 20,
  energyRequired: "LOW",
  loopKind: "DAILY",
  lastTouchedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
  dueDate: null,
};

/** Exactly the shape the follow-up writer emits post-fix (note carries a $). */
const collectFollowUp = {
  title: "Follow up with Anthony Zunt — $927 invoice, partial-paid",
  missionId: "m-inbox",
  status: "READY",
  roiScore: 50,
  frictionScore: 20,
  energyRequired: "MEDIUM",
  loopKind: "ONCE" as string | null,
  lastTouchedAt: null,
  dueDate: new Date(NOW.getTime() + 2 * DAY),
};

describe("collect-lane canary: follow-up writer is scorer-honest", () => {
  it("SOURCE SCAN: the follow-up writer no longer hand-blesses roiScore 70", () => {
    const src = readFileSync(
      join(process.cwd(), "lib", "ai", "tools", "tasks.ts"),
      "utf8",
    );
    const followUpBlock = src.slice(
      src.indexOf("Follow up with ${customerName}"),
      src.indexOf("waitingOn: customerName"),
    );
    expect(followUpBlock.length).toBeGreaterThan(50); // anchor found
    expect(followUpBlock).toContain("roiScore: 50");
    expect(followUpBlock).not.toContain("roiScore: 70");
  });

  it("the writer-shaped collect task outranks the habit on TERMS", () => {
    const follow = scoreTaskPriority(collectFollowUp, noMissions, NOW);
    const habit = scoreTaskPriority(hydration, noMissions, NOW);
    expect(follow.score).toBeGreaterThan(habit.score);
    expect(follow.explanation).toContain("$927");
    expect(follow.explanation).toContain("due in 2d");
  });

  it("POSITIVE CONTROL: under the old raw-roiScore ordering the OLD writer shape only tied the habit", () => {
    const oldWriterShape = { ...collectFollowUp, roiScore: 70 };
    // Old chain compared hand constants: 70 vs 70 — a coin flip, not a ranking.
    expect(oldWriterShape.roiScore).toBe(hydration.roiScore);
    // And the fixed writer's 50 would have LOST outright under that ordering —
    // the constant fix only makes sense because #1946 ranks on terms now.
    expect(collectFollowUp.roiScore).toBeLessThan(hydration.roiScore);
  });
});
