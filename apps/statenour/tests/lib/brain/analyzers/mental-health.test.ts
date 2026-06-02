import { describe, it, expect } from "vitest";

import {
  computeMentalHealth,
  type DailyLogInput,
} from "@/lib/brain/analyzers/mental-health";

/** Deterministic date n days after a fixed epoch (no Date.now — keeps tests stable). */
function day(offset: number): Date {
  return new Date(2026, 0, 1 + offset);
}
function log(
  offset: number,
  mood: number | null,
  extra: Partial<DailyLogInput> = {},
): DailyLogInput {
  return {
    logDate: day(offset),
    moodScore: mood,
    energyScore: extra.energyScore ?? 6,
    sleepHours: extra.sleepHours ?? 7,
    workoutCompleted: extra.workoutCompleted ?? false,
    driftIncidents: extra.driftIncidents ?? 0,
  };
}

describe("computeMentalHealth", () => {
  it("flags insufficient data with fewer than 7 mood points", () => {
    const dailyLogs = [log(0, 6), log(1, 7), log(2, 5)];
    const r = computeMentalHealth({ dailyLogs, bodyRows: [], journalRows: [], days: 30 });
    expect(r.dataCompleteness.sufficient).toBe(false);
    expect(r.concern.level).toBe("insufficient-data");
    // safety boundary present even on the thin path
    expect(r.safety.cannotDo.join(" ")).toMatch(/self-harm/i);
  });

  it("reports a stable, healthy window", () => {
    const dailyLogs = Array.from({ length: 14 }, (_, i) => log(i, 7));
    const r = computeMentalHealth({ dailyLogs, bodyRows: [], journalRows: [], days: 30 });
    expect(r.dataCompleteness.sufficient).toBe(true);
    expect(r.concern.level).toBe("stable");
    expect(r.mood?.avg).toBe(7);
    expect(r.mood?.trend).toBe("stable");
  });

  it("escalates on a declining, low-mood, short-sleep window", () => {
    // mood falls 8 -> 1 over 14 days, mostly low, on 5h sleep
    const dailyLogs = Array.from({ length: 14 }, (_, i) =>
      log(i, Math.max(1, 8 - Math.round(i * 0.5)), { sleepHours: 5 }),
    );
    const r = computeMentalHealth({ dailyLogs, bodyRows: [], journalRows: [], days: 30 });
    expect(["worth-attention", "elevated"]).toContain(r.concern.level);
    expect(r.mood?.trend).toBe("declining");
    expect(r.concern.factors.length).toBeGreaterThan(0);
    // an elevated reading must lead with the non-diagnosis / resource framing
    if (r.concern.level === "elevated") {
      expect(r.guidance[0]).toMatch(/not a diagnosis|988/i);
    }
  });

  it("surfaces the workout -> mood lever in guidance", () => {
    // workout days mood 9, rest days mood 5
    const dailyLogs = Array.from({ length: 14 }, (_, i) =>
      log(i, i % 2 === 0 ? 9 : 5, { workoutCompleted: i % 2 === 0 }),
    );
    const r = computeMentalHealth({ dailyLogs, bodyRows: [], journalRows: [], days: 30 });
    expect(r.workout?.moodLiftVsRest).not.toBeNull();
    expect(r.workout?.moodLiftVsRest ?? 0).toBeGreaterThan(0);
    expect(r.guidance.join(" ")).toMatch(/workout/i);
  });

  it("computes a sleep<->mood correlation when both series vary", () => {
    // mood rises with sleep
    const dailyLogs = Array.from({ length: 10 }, (_, i) =>
      log(i, Math.min(10, 3 + i), { sleepHours: 5 + i * 0.3 }),
    );
    const r = computeMentalHealth({ dailyLogs, bodyRows: [], journalRows: [], days: 30 });
    expect(r.sleep?.moodCorrelation).not.toBeNull();
    expect(r.sleep?.moodCorrelation ?? 0).toBeGreaterThan(0.5);
    expect(r.sleep?.correlation).toBe("strong");
  });

  it("always includes safety boundaries + US crisis resources", () => {
    const dailyLogs = Array.from({ length: 8 }, (_, i) => log(i, 6));
    const r = computeMentalHealth({ dailyLogs, bodyRows: [], journalRows: [], days: 30 });
    expect(r.safety.crisisResources.join(" ")).toMatch(/988/);
    expect(r.safety.cannotDo).toContain("Diagnose any mental-health condition");
  });
});
