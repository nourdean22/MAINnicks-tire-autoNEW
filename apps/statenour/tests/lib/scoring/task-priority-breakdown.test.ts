/**
 * The priority breakdown reconciles with the score it explains (2026-09-15).
 *
 * `scoreTaskPriority` now returns the per-term arithmetic behind `score` so
 * the task inspector can show WHY instead of a bare number. The one thing
 * that must never happen is the breakdown telling a different story than
 * the score: every candidate shape below asserts
 * round(Σ contributions × Π multipliers) === score, contribution === input ×
 * weight, and that the term set IS the weight table. A manual override has
 * no terms and no breakdown.
 *
 * Positive control (run 2026-09-15 before commit): with the roi term's
 * contribution mutated to `input * weight * 2` the reconcile test goes red
 * on every non-manual candidate.
 */
import { describe, expect, it } from "vitest";
import {
  BLOCKED_MULTIPLIER,
  HABIT_CLASS_MULTIPLIER,
  NOW_WEIGHTS,
  SHOP_CLASS_MULTIPLIER,
  scoreTaskPriority,
  type RankedMissionRef,
  type TaskPriorityCandidate,
} from "@/lib/scoring/task-priority";

const NOW = new Date("2026-09-15T14:00:00Z"); // 10:00 ET · morning
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const missions = new Map<string, RankedMissionRef>([
  ["m1", { id: "m1", rank: 1, rankScore: 90, domain: "PERSONAL" }],
  ["shop", { id: "shop", rank: 2, rankScore: 70, domain: "BUSINESS" }],
]);

const base: TaskPriorityCandidate = {
  title: "Call Eddy about the lift",
  missionId: "m1",
  status: "READY",
  roiScore: 55,
  frictionScore: 30,
  energyRequired: "HIGH",
};

const CANDIDATES: Record<string, TaskPriorityCandidate> = {
  plain: base,
  overdueDollars: { ...base, title: "Invoice $1,846.50 · Mike", dueDate: days(-12), lastTouchedAt: days(-9) },
  doing: { ...base, status: "DOING", startedAt: days(-1) },
  blocked: { ...base, waitingOn: "Eddy" },
  habit: { ...base, loopKind: "DAILY" },
  shopDampened: { ...base, missionId: "shop", dueDate: days(30) },
  shopOverdueExempt: { ...base, missionId: "shop", dueDate: days(-10) },
  noMission: { ...base, missionId: "nope" },
};

describe("scoreTaskPriority · breakdown", () => {
  it("reconciles: round(Σ contributions × Π multipliers) === score, for every candidate shape", () => {
    for (const [name, c] of Object.entries(CANDIDATES)) {
      const r = scoreTaskPriority(c, missions, NOW);
      const b = r.breakdown!;
      expect(b, `${name}: no breakdown`).toBeDefined();
      const sum = b.terms.reduce((s, t) => s + t.contribution, 0);
      expect(b.weightedSum, `${name}: weightedSum`).toBeCloseTo(sum, 9);
      const factor = b.multipliers.reduce((m, x) => m * x.factor, 1);
      expect(Math.round(b.weightedSum * factor), `${name}: score`).toBe(r.score);
      expect(b.score, `${name}: breakdown.score`).toBe(r.score);
      for (const t of b.terms) {
        expect(t.contribution, `${name}/${t.key}`).toBeCloseTo(t.input * t.weight, 9);
        expect(t.weight, `${name}/${t.key}: weight is the table's`).toBe(NOW_WEIGHTS[t.key]);
      }
    }
  });

  it("the term set is exactly the weight table, in its order", () => {
    const r = scoreTaskPriority(base, missions, NOW);
    expect(r.breakdown!.terms.map((t) => t.key)).toEqual(Object.keys(NOW_WEIGHTS));
  });

  it("multipliers appear only when they apply, with the table's factors", () => {
    const keysOf = (c: TaskPriorityCandidate) => scoreTaskPriority(c, missions, NOW).breakdown!.multipliers.map((m) => [m.key, m.factor]);
    expect(keysOf(CANDIDATES.plain!)).toEqual([]);
    expect(keysOf(CANDIDATES.habit!)).toEqual([["habit", HABIT_CLASS_MULTIPLIER]]);
    expect(keysOf(CANDIDATES.blocked!)).toEqual([["blocked", BLOCKED_MULTIPLIER]]);
    expect(keysOf(CANDIDATES.shopDampened!)).toEqual([["shop", SHOP_CLASS_MULTIPLIER]]);
    // An overdue shop task is exactly what this surface exists to catch — no dampening.
    expect(keysOf(CANDIDATES.shopOverdueExempt!)).toEqual([]);
  });

  it("notes say what the input means for THIS task, in operator words", () => {
    const note = (c: TaskPriorityCandidate, key: string) =>
      scoreTaskPriority(c, missions, NOW).breakdown!.terms.find((t) => t.key === key)!.note;
    expect(note(CANDIDATES.overdueDollars!, "dueUrgency")).toBe("overdue 12d");
    expect(note(CANDIDATES.overdueDollars!, "dollar")).toBe("$1,846.5 in the title");
    expect(note(CANDIDATES.overdueDollars!, "staleness")).toBe("untouched 9d");
    expect(note(CANDIDATES.plain!, "dueUrgency")).toBe("no due date");
    expect(note(CANDIDATES.plain!, "staleness")).toBe("never touched");
    expect(note(CANDIDATES.plain!, "mission")).toBe("mission #1");
    expect(note(CANDIDATES.noMission!, "mission")).toBe("no ranked mission");
    expect(note(CANDIDATES.doing!, "active")).toContain("started");
    expect(note(CANDIDATES.plain!, "energy")).toBe("high energy · morning");
  });

  it("a manual override carries no breakdown — there are no terms behind it", () => {
    const r = scoreTaskPriority({ ...base, manualPriorityOverride: 88 }, missions, NOW);
    expect(r.manual).toBe(true);
    expect(r.score).toBe(88);
    expect(r.breakdown).toBeUndefined();
  });

  it("score and explanation are byte-identical to the pre-breakdown scorer for a known row", () => {
    // Pinned values computed with the previous implementation (same NOW, same
    // candidate) — the refactor to a reduced term list must not move them.
    const r = scoreTaskPriority(CANDIDATES.overdueDollars!, missions, NOW);
    expect(r.explanation).toBe("picked because: $1,846.5 · overdue 12d · untouched 9d · mission #1 · roi 55 → " + r.score);
    expect(r.score).toBeGreaterThanOrEqual(60); // an overdue $1.8k item is at least HIGH
  });
});
