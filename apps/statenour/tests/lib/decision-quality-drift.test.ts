/**
 * Unit tests for lib/brain/decision-quality-drift.ts
 *
 * v8.2 · F3 · Apr 29.
 *
 * Pure-function `gradeToGpa` covered exhaustively. Drift detection
 * tested with mock prisma + clock control.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    masteryDecision: { findMany: (...a: unknown[]) => mocks.findMany(...a) },
    brainMemory: { create: (...a: unknown[]) => mocks.create(...a) },
  },
}));

import {
  gradeToGpa,
  runDecisionQualityDrift,
} from "@/lib/brain/decision-quality-drift";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: "x" });
});

describe("gradeToGpa", () => {
  it("decodes A through F and pluses/minuses", () => {
    expect(gradeToGpa("A+")).toBe(4.0);
    expect(gradeToGpa("A")).toBe(4.0);
    expect(gradeToGpa("A-")).toBe(3.7);
    expect(gradeToGpa("B")).toBe(3.0);
    expect(gradeToGpa("C-")).toBe(1.7);
    expect(gradeToGpa("F")).toBe(0.0);
  });

  it("decodes numeric scores 0-100", () => {
    expect(gradeToGpa("100")).toBe(4);
    expect(gradeToGpa("75")).toBe(3);
    expect(gradeToGpa("50")).toBe(2);
    expect(gradeToGpa("0")).toBe(0);
  });

  it("treats numeric inputs as 0-100 percentages (0..100 branch wins)", () => {
    // Numeric inputs are interpreted as percentage scores. The
    // 0..4 branch is dead code for typical inputs (kept as a
    // future-proof escape hatch only). Lock that contract here.
    expect(gradeToGpa("4")).toBe(4 / 25); // 4% percent → 0.16 GPA
    expect(gradeToGpa("4.0")).toBe(4 / 25);
    expect(gradeToGpa("80")).toBeCloseTo(3.2);
  });

  it("returns null for null/undefined/whitespace", () => {
    expect(gradeToGpa(null)).toBeNull();
    expect(gradeToGpa(undefined)).toBeNull();
    expect(gradeToGpa("")).toBeNull();
    expect(gradeToGpa("garbage")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(gradeToGpa("a")).toBe(4.0);
    expect(gradeToGpa("b+")).toBe(3.3);
  });
});

describe("runDecisionQualityDrift", () => {
  it("returns insufficient_data when baseline < 3 samples", async () => {
    mocks.findMany.mockResolvedValue([
      { grade: "A", date: "2026-04-29" },
      { grade: "B", date: "2026-04-28" },
    ]);
    const r = await runDecisionQualityDrift();
    expect(r.trend).toBe("insufficient_data");
    expect(r.drift).toBe(false);
  });

  it("flags drift when recent week is ≥15% worse than baseline", async () => {
    // Build 12 baseline rows averaging 3.5 (between B+ and A-) and
    // 4 recent rows averaging 2.0 (C). That's ~43% drop → drift.
    const rows: Array<{ grade: string; date: string }> = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 14 - i);
      rows.push({ grade: i % 2 === 0 ? "A" : "B", date: d.toISOString().slice(0, 10) });
    }
    for (let i = 0; i < 4; i++) {
      // Recent — clearly within "this week"
      rows.push({ grade: "C", date: now.toISOString().slice(0, 10) });
    }
    mocks.findMany.mockResolvedValue(rows);

    const r = await runDecisionQualityDrift();
    expect(r.drift).toBe(true);
    expect(r.deltaPct).toBeLessThan(-15);
    expect(r.trend).toBe("down");
    expect(r.alertWritten).toBe(true);
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("does NOT alert when drift is under threshold", async () => {
    const rows: Array<{ grade: string; date: string }> = [];
    const now = new Date();
    // Baseline avg ~3.5 (A/B mix), recent avg ~3.3 (B+). ~6% drop.
    for (let i = 0; i < 12; i++) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 14 - i);
      rows.push({ grade: i % 2 === 0 ? "A" : "B", date: d.toISOString().slice(0, 10) });
    }
    for (let i = 0; i < 3; i++) {
      rows.push({ grade: "B+", date: now.toISOString().slice(0, 10) });
    }
    mocks.findMany.mockResolvedValue(rows);

    const r = await runDecisionQualityDrift();
    expect(r.drift).toBe(false);
    expect(r.alertWritten).toBe(false);
  });

  it("dedupes via P2002 idempotency hit when called twice in the same week", async () => {
    const rows: Array<{ grade: string; date: string }> = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 14 - i);
      rows.push({ grade: "A", date: d.toISOString().slice(0, 10) });
    }
    for (let i = 0; i < 4; i++) {
      rows.push({ grade: "F", date: now.toISOString().slice(0, 10) });
    }
    mocks.findMany.mockResolvedValue(rows);
    mocks.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));

    const r = await runDecisionQualityDrift();
    // Drift detected, but write was suppressed by idempotency hit
    expect(r.drift).toBe(true);
    expect(r.alertWritten).toBe(false);
  });

  it("flags trend='up' when recent improved", async () => {
    const rows: Array<{ grade: string; date: string }> = [];
    const now = new Date();
    // Baseline ~2.0, recent ~3.5
    for (let i = 0; i < 12; i++) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 14 - i);
      rows.push({ grade: "C", date: d.toISOString().slice(0, 10) });
    }
    for (let i = 0; i < 4; i++) {
      rows.push({ grade: "A", date: now.toISOString().slice(0, 10) });
    }
    mocks.findMany.mockResolvedValue(rows);

    const r = await runDecisionQualityDrift();
    expect(r.trend).toBe("up");
    expect(r.drift).toBe(false);
    expect(r.deltaPct).toBeGreaterThan(0);
  });
});
