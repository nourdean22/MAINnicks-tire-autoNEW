import { describe, it, expect } from "vitest";

import {
  computeWorkHealth,
  type DailyWorkRow,
  type BodyWorkRow,
} from "@/lib/brain/analyzers/work-health";

const NOW = new Date(2026, 1, 1); // fixed — no Date.now()

function day(offset: number): Date {
  return new Date(2026, 0, 1 + offset);
}
function dayStr(offset: number): string {
  return day(offset).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function daily(offset: number, deepWork: number, drift: number): DailyWorkRow {
  return { logDate: day(offset), deepWorkBlocks: deepWork, driftIncidents: drift };
}
function bodyRow(offset: number, stress: number | null, energy: number | null): BodyWorkRow {
  return { date: dayStr(offset), stress, energy };
}

describe("computeWorkHealth", () => {
  it("always ships the non-clinical strain disclaimer", () => {
    const r = computeWorkHealth({ daily: [], body: [], days: 30 }, NOW);
    expect(r.strain.disclaimer).toMatch(/not a burnout diagnosis|heuristic/i);
  });

  it("returns insufficient-data strain with too few daily logs", () => {
    const rows = [daily(0, 3, 1), daily(1, 2, 2), daily(2, 3, 1)];
    const r = computeWorkHealth({ daily: rows, body: [], days: 30 }, NOW);
    expect(r.dataCompleteness.sufficient).toBe(false);
    expect(r.strain.level).toBe("insufficient-data");
    expect(r.dataCompleteness.note).toMatch(/directional/i);
  });

  it("computes deep-work and drift averages + trends", () => {
    // deepWork rises 1->7, drift falls 6->0 over 7 days
    const rows = Array.from({ length: 7 }, (_, i) => daily(i, 1 + i, 6 - i));
    const r = computeWorkHealth({ daily: rows, body: [], days: 30 }, NOW);
    expect(r.deepWork?.direction).toBe("rising");
    expect(r.drift?.direction).toBe("falling");
    expect(r.deepWork?.avg ?? 0).toBeGreaterThan(0);
  });

  it("reads LOW strain on a healthy window", () => {
    // good focus, no drift, low/falling stress, high energy
    const dailyRows = Array.from({ length: 7 }, (_, i) => daily(i, 4, 0));
    const bodyRows = Array.from({ length: 7 }, (_, i) => bodyRow(i, 2, 8));
    const r = computeWorkHealth({ daily: dailyRows, body: bodyRows, days: 30 }, NOW);
    expect(r.strain.level).toBe("low");
  });

  it("escalates strain when high stress + high drift + low energy co-occur", () => {
    // 7 days: drift ~6/day (high), stress 8 (high), energy 3 (low)
    const dailyRows = Array.from({ length: 7 }, (_, i) => daily(i, 1, 6));
    const bodyRows = Array.from({ length: 7 }, (_, i) => bodyRow(i, 8, 3));
    const r = computeWorkHealth({ daily: dailyRows, body: bodyRows, days: 30 }, NOW);
    expect(r.strain.level).toBe("high");
    expect(r.strain.points).toBeGreaterThanOrEqual(5);
    expect(r.strain.factors.length).toBeGreaterThan(0);
    expect(r.guidance[0]).toMatch(/HIGH|not a diagnosis/i);
  });

  it("works with no body data — strain reads from the work side alone", () => {
    // high drift only, no stress/energy logged
    const rows = Array.from({ length: 6 }, (_, i) => daily(i, 1, 6));
    const r = computeWorkHealth({ daily: rows, body: [], days: 30 }, NOW);
    expect(r.stress).toBeNull();
    expect(r.energy).toBeNull();
    expect(r.drift?.avg).toBe(6);
    // high drift alone (2pts) -> elevated, never crashes on missing body
    expect(["elevated", "high"]).toContain(r.strain.level);
  });

  it("never moralizes the energy/stress metric direction itself", () => {
    const dailyRows = Array.from({ length: 6 }, (_, i) => daily(i, 3, 1));
    const bodyRows = Array.from({ length: 6 }, (_, i) => bodyRow(i, 4, 6));
    const r = computeWorkHealth({ daily: dailyRows, body: bodyRows, days: 30 }, NOW);
    // a metric's direction is rising/flat/falling — never a good/bad label
    expect(["rising", "flat", "falling"]).toContain(r.stress?.direction ?? "flat");
    expect(["rising", "flat", "falling"]).toContain(r.energy?.direction ?? "flat");
  });
});
