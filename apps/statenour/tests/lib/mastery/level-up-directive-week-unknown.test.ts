/**
 * W4 fix round 2 (a): the level-up directive makes no neglect or momentum claim from a weekly
 * read that failed (skill empty-vs-error: fixing one consumer is not fixing the class).
 *
 * THE DEFECT. computeCharacterSheet now marks every stat `rising7dUnknown` when the 7-day read
 * failed (rising7dXp then defaults to 0), but selectLevelUpDirective read that 0 as measured:
 * tier 3 told Nour a goal-linked stat "took 0 XP in 7 days", tier 5 that his whole Body branch
 * gained nothing, `neglected` lit "Neglected this week", and tier 6 could cite a partial weekly
 * number as momentum. The data reaches it unchanged from operator.characterSheet
 * (components/mastery/level-up-directive-card.tsx). Each case pairs the unknown read with its
 * MEASURED-ZERO control: a read that succeeded with 0 still yields the neglect line.
 */
import { describe, expect, it } from "vitest";

import { selectLevelUpDirective, type DirectiveStat } from "@/lib/mastery/level-up-directive";

const stat = (key: string, branch: string, rising7dXp: number, extra: Partial<DirectiveStat> = {}): DirectiveStat => ({
  key,
  label: key,
  color: "#888",
  branch,
  level: 5,
  xpIntoLevel: 10,
  xpForNext: 100,
  progressPct: 10,
  rising7dXp,
  ...extra,
});
const unknown = (s: DirectiveStat): DirectiveStat => ({ ...s, rising7dUnknown: true });
const GOAL = { goals: [{ id: "g1", title: "Ship the brief" }] };

describe("selectLevelUpDirective with an unreadable week", () => {
  it("control: a measured 0 on a goal-linked stat still yields the neglected-goal line", () => {
    const d = selectLevelUpDirective({ stats: [stat("focus", "mind", 0, GOAL), stat("craft", "empire", 4)] })!;
    expect(d.tier).toBe("neglected-goal");
    expect(d.neglected).toBe(true);
    expect(d.reason).toMatch(/took 0 XP in 7 days/);
  });

  it("makes no neglected-goal claim and lights no neglect flag when the week could not be read", () => {
    const d = selectLevelUpDirective({ stats: [stat("focus", "mind", 0, GOAL), stat("craft", "empire", 0)].map(unknown) })!;
    expect(d.tier, "an unread week was told as neglect").not.toBe("neglected-goal");
    expect(d.neglected).toBe(false);
    expect(d.reason).not.toMatch(/took 0 XP|in 7 days/);
  });

  it("control: a measured 0 across the Body branch still yields body-neglect", () => {
    const d = selectLevelUpDirective({ stats: [stat("strength", "body", 0), stat("endurance", "body", 0), stat("craft", "empire", 3)] })!;
    expect(d.tier).toBe("body-neglect");
  });

  it("does not say the whole Body branch gained nothing when the week could not be read", () => {
    const d = selectLevelUpDirective({ stats: [stat("strength", "body", 0), stat("endurance", "body", 0), stat("craft", "empire", 0)].map(unknown) })!;
    expect(d.tier).not.toBe("body-neglect");
    expect(d.reason).not.toMatch(/no Body stat gained XP/i);
  });

  it("control: a measured Learning gain still yields the momentum tier", () => {
    const d = selectLevelUpDirective({ stats: [stat("learning", "mind", 6), stat("strength", "body", 2)] })!;
    expect(d.tier).toBe("learning");
  });

  it("cites no Learning momentum from a partial weekly number when the week is unknown", () => {
    // One half of the weekly read answered (events), the other failed: 6 is a floor, not the week.
    const d = selectLevelUpDirective({ stats: [stat("learning", "mind", 6), stat("strength", "body", 2)].map(unknown) })!;
    expect(d.tier).not.toBe("learning");
    expect(d.reason).not.toMatch(/this week/);
  });
});
