import { describe, expect, it } from "vitest";
import {
  GOAL_MOMENT_TAG,
  MAXIM_TEXT_MAX,
  goalMomentState,
  maximForGoalMoment,
} from "@/lib/brain/goal-maxim";
import { MAXIM_POOL } from "@/lib/wisdom/maxim-pool";
import type { Maxim } from "@/lib/wisdom/maxims";

const maxim = (id: string, tags: string[], text = `maxim ${id}`): Maxim => ({ id, text, source: "Test", ref: id, tags });
const POOL = [
  maxim("t1", ["timing"]),
  maxim("d1", ["decisions"]),
  maxim("f1", ["focus"]),
  maxim("l1", ["learning"]),
  maxim("p1", ["people"]),
];
const DAY = "2026-11-02";

describe("goalMomentState", () => {
  it("an achieved goal is achieved whatever its last health said", () => {
    expect(goalMomentState({ status: "achieved", health: "off_track", pace: { kind: "behind" } })).toBe("achieved");
  });
  it("off track beats behind pace; a missed date is off track", () => {
    expect(goalMomentState({ status: "active", health: "off_track", pace: { kind: "behind" } })).toBe("off_track");
    expect(goalMomentState({ status: "active", health: "on_track", pace: { kind: "missed" } })).toBe("off_track");
    expect(goalMomentState({ status: "missed", health: null, pace: null })).toBe("off_track");
  });
  it("behind pace, then at risk, then a due check-in", () => {
    expect(goalMomentState({ status: "active", health: "at_risk", pace: { kind: "behind" } })).toBe("behind_pace");
    expect(goalMomentState({ status: "active", health: "at_risk", pace: { kind: "on-track" } })).toBe("at_risk");
    expect(goalMomentState({ status: "active", health: "no_check_in", pace: null })).toBe("check_in_due");
  });
  it("on track or an unreadable health is no moment: unknown never earns a maxim", () => {
    expect(goalMomentState({ status: "active", health: "on_track", pace: { kind: "ahead" } })).toBeNull();
    expect(goalMomentState({ status: "active", health: "unknown", pace: null })).toBeNull();
  });
});

describe("maximForGoalMoment", () => {
  it("picks only a maxim carrying the state's tag, and names the state", () => {
    const r = maximForGoalMoment({ id: "g1", status: "active", health: "on_track", pace: { kind: "behind" } }, POOL, DAY);
    expect(r).toEqual({ id: "t1", text: "maxim t1", origin: "Test", state: "behind_pace" });
  });
  it("returns null when the goal has no moment or no maxim carries the tag", () => {
    expect(maximForGoalMoment({ id: "g1", status: "active", health: "on_track", pace: null }, POOL, DAY)).toBeNull();
    expect(maximForGoalMoment({ id: "g1", status: "achieved", health: null, pace: null }, [maxim("x", ["money"])], DAY)).toBeNull();
  });
  it("holds still for one goal on one day and two goals can differ", () => {
    const pool = Array.from({ length: 40 }, (_, i) => maxim(`f${i}`, ["focus"]));
    const a = maximForGoalMoment({ id: "goal-a", status: "active", health: "at_risk", pace: null }, pool, DAY);
    expect(maximForGoalMoment({ id: "goal-a", status: "active", health: "at_risk", pace: null }, pool, DAY)).toEqual(a);
    const ids = new Set(
      ["goal-b", "goal-c", "goal-d", "goal-e"].map((id) => maximForGoalMoment({ id, status: "active", health: "at_risk", pace: null }, pool, DAY)?.id),
    );
    ids.add(a?.id);
    expect(ids.size).toBeGreaterThan(1);
  });
  it("clips the text at the named cap", () => {
    const long = maxim("long", ["learning"], "x".repeat(MAXIM_TEXT_MAX + 50));
    const r = maximForGoalMoment({ id: "g", status: "achieved", health: null, pace: null }, [long], DAY);
    expect(r?.text.length).toBeLessThanOrEqual(MAXIM_TEXT_MAX);
  });
  it("every state's tag exists in the real pool (no state can go silent)", () => {
    for (const tag of new Set(Object.values(GOAL_MOMENT_TAG))) {
      expect(MAXIM_POOL.some((m) => m.tags.includes(tag)), tag).toBe(true);
    }
  });
});
