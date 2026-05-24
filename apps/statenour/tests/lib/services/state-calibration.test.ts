/**
 * tests/lib/services/state-calibration.test.ts · Wave I.b (2026-05-23).
 *
 * Pure-helper coverage for the M1 calibration grid math (ADR-0020).
 * The buildStateCalibration() top-level does 1 Prisma query · its
 * pure aggregation logic lives inline because there was no need to
 * extract it. This test file exercises the aggregation through the
 * adapter with a mocked prisma · 5 cases · enough for confidence.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  ALL_KINDS,
  ALL_MOODS,
  type KindKey,
} from "@/lib/services/state-calibration";
import type { MoodTag } from "@/lib/services/operator-state";

const mocks = vi.hoisted(() => ({
  brainMemory: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: mocks.brainMemory,
  },
}));

function mintRow(args: {
  suggestionKind: string;
  event: "acted" | "dismissed";
  mood: MoodTag | null;
}): { key: string; metadata: unknown } {
  return {
    key: `sugg:${Math.random().toString(36).slice(2)}:action:${args.event}`,
    metadata: {
      suggestionKind: args.suggestionKind,
      event: args.event,
      operatorStateSnapshot: args.mood
        ? {
            focus: 0.6,
            capacity: 0.5,
            drift: 0.2,
            momentum: 0.5,
            mood: args.mood,
            confidence: 0.7,
            ranAt: "2026-05-23T00:00:00.000Z",
          }
        : null,
    },
  };
}

describe("buildStateCalibration · M1 grid math", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the empty grid when no rows", async () => {
    mocks.brainMemory.findMany.mockResolvedValue([]);
    const { buildStateCalibration } = await import(
      "@/lib/services/state-calibration"
    );
    const report = await buildStateCalibration({ sinceDays: 30 });
    expect(report.totalRows).toBe(0);
    expect(report.cells).toEqual([]);
    // byMood + byKind still seed with zero rows · 4 moods · all kinds.
    expect(report.byMood).toHaveLength(ALL_MOODS.length);
    expect(report.byKind).toHaveLength(ALL_KINDS.length);
    expect(report.byMood.every((m) => m.total === 0)).toBe(true);
  });

  it("buckets acted rows by mood × kind", async () => {
    mocks.brainMemory.findMany.mockResolvedValue([
      mintRow({ suggestionKind: "task", event: "acted", mood: "energized" }),
      mintRow({ suggestionKind: "task", event: "acted", mood: "energized" }),
      mintRow({ suggestionKind: "task", event: "dismissed", mood: "depleted" }),
    ]);
    const { buildStateCalibration } = await import(
      "@/lib/services/state-calibration"
    );
    const report = await buildStateCalibration();
    const energizedTask = report.cells.find(
      (c) => c.mood === "energized" && c.kind === "task",
    );
    expect(energizedTask?.acted).toBe(2);
    expect(energizedTask?.total).toBe(2);
    expect(energizedTask?.hitRatePct).toBe(100);
    const depletedTask = report.cells.find(
      (c) => c.mood === "depleted" && c.kind === "task",
    );
    expect(depletedTask?.acted).toBe(0);
    expect(depletedTask?.dismissed).toBe(1);
    expect(depletedTask?.total).toBe(1);
    expect(depletedTask?.hitRatePct).toBe(0);
  });

  it("counts unstamped rows separately", async () => {
    mocks.brainMemory.findMany.mockResolvedValue([
      mintRow({ suggestionKind: "task", event: "acted", mood: null }),
      mintRow({ suggestionKind: "task", event: "acted", mood: null }),
      mintRow({ suggestionKind: "task", event: "acted", mood: "energized" }),
    ]);
    const { buildStateCalibration } = await import(
      "@/lib/services/state-calibration"
    );
    const report = await buildStateCalibration();
    expect(report.unstamped).toBe(2);
    // The 1 stamped row should hit the energized × task cell.
    const stampedCell = report.cells.find(
      (c) => c.mood === "energized" && c.kind === "task",
    );
    expect(stampedCell?.total).toBe(1);
  });

  it("classifies unknown suggestion kinds as 'other'", async () => {
    mocks.brainMemory.findMany.mockResolvedValue([
      mintRow({
        suggestionKind: "wat-is-this",
        event: "acted",
        mood: "neutral",
      }),
    ]);
    const { buildStateCalibration } = await import(
      "@/lib/services/state-calibration"
    );
    const report = await buildStateCalibration();
    const otherKind = report.cells.find(
      (c) => c.mood === "neutral" && c.kind === ("other" as KindKey),
    );
    expect(otherKind?.total).toBe(1);
  });

  it("rolls up per-mood + per-kind totals correctly", async () => {
    mocks.brainMemory.findMany.mockResolvedValue([
      mintRow({ suggestionKind: "task", event: "acted", mood: "energized" }),
      mintRow({ suggestionKind: "goal", event: "acted", mood: "energized" }),
      mintRow({ suggestionKind: "task", event: "dismissed", mood: "depleted" }),
    ]);
    const { buildStateCalibration } = await import(
      "@/lib/services/state-calibration"
    );
    const report = await buildStateCalibration();
    const energizedMood = report.byMood.find((m) => m.mood === "energized");
    expect(energizedMood?.acted).toBe(2);
    expect(energizedMood?.total).toBe(2);
    expect(energizedMood?.hitRatePct).toBe(100);
    const taskKind = report.byKind.find((k) => k.kind === "task");
    expect(taskKind?.total).toBe(2);
    expect(taskKind?.acted).toBe(1);
    expect(taskKind?.hitRatePct).toBe(50);
  });

  it("degrades to empty grid on Prisma error", async () => {
    mocks.brainMemory.findMany.mockRejectedValue(new Error("db down"));
    const { buildStateCalibration } = await import(
      "@/lib/services/state-calibration"
    );
    const report = await buildStateCalibration({ sinceDays: 30 });
    expect(report.totalRows).toBe(0);
    expect(report.cells).toEqual([]);
    expect(report.unstamped).toBe(0);
  });
});
