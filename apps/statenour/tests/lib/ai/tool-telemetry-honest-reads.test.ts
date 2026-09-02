/**
 * tests/lib/ai/tool-telemetry-honest-reads.test.ts · 2026-09-02.
 *
 * TWO DEFECTS, both "a read that failed rendered as health".
 *
 * ── 1 · a dead database rendered 185 green tools ──
 * `getToolStats` had exactly one error path: `logError(...)` then
 * `return []`. Every consumer is a dashboard, and the tRPC procedure
 * (lib/trpc/routers/brain.ts:1060-1064) rebuilds its rows from TOOL_CATALOG
 * regardless — so an empty stats array came back as the FULL catalog with
 * `totalCalls: 0, successRate: 0, lastCallAt: undefined` and an empty
 * problem list. The procedure physically could not error, so
 * ToolTelemetryPanel had nothing to branch on and drew a check beside every
 * tool name. It now throws; the one caller that genuinely wants
 * degrade-to-empty (lib/services/system-pages-b.ts:303) writes its own
 * `.catch(() => [])` at the call site, where it can be read.
 *
 * ── 2 · the problem-tool alarm could not fire for a mature tool ──
 * `stats.filter(s => s.totalCalls >= 10 && s.successRate < 0.5)` over
 * counters that ONLY increment (:87-89) — no window, no decay, no reset
 * path in the repo. Do the arithmetic on a real tool: 1,000 lifetime calls
 * at a 95% success rate is 950 successes; crossing a 0.5 lifetime rate
 * needs total > 2×950, i.e. more than 900 further calls, ALL failures. It
 * is 100% broken today and the alarm stays silent for days — structurally
 * dead for exactly the high-traffic tools whose failure costs most.
 *
 * The acute signal already existed and was surfaced nowhere: the circuit
 * breaker in the same file (5 failures / 10min, cleared by any success).
 * Unioning it in needs no new persistence and no new thresholds.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  toolTelemetry: { findMany: vi.fn() },
  logError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { toolTelemetry: mocks.toolTelemetry, $executeRaw: vi.fn() },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: mocks.logError }));

import {
  getToolStats,
  getProblemTools,
  recordToolFailure,
  recordToolSuccess,
  resetToolBreaker,
} from "@/lib/ai/tool-telemetry";

/** One `tool_telemetry` row as Prisma hands it back. */
function row(
  toolName: string,
  totalCalls: number,
  successCount: number,
): Record<string, unknown> {
  return {
    toolName,
    totalCalls,
    successCount,
    failCount: totalCalls - successCount,
    totalDurationMs: BigInt(totalCalls * 100),
    lastErrors: [],
    lastCallAt: new Date("2026-09-02T00:00:00.000Z"),
  };
}

/** The mature, high-traffic, historically-excellent tool from the header. */
const VETERAN = "searchWeb";
/** A young tool that has genuinely never worked. */
const DUD = "brokenScraper";

beforeEach(() => {
  vi.clearAllMocks();
  resetToolBreaker(VETERAN);
  resetToolBreaker(DUD);
  mocks.toolTelemetry.findMany.mockResolvedValue([]);
});

describe("getToolStats · a failed telemetry read throws instead of returning []", () => {
  it("REJECTS when the table read fails", async () => {
    mocks.toolTelemetry.findMany.mockRejectedValue(new Error("db down"));

    // Pre-fix this resolved to `[]`, which the procedure then expanded back
    // into a full green catalog.
    await expect(getToolStats()).rejects.toThrow("db down");
  });

  it("still logs the failure on the way out", async () => {
    mocks.toolTelemetry.findMany.mockRejectedValue(new Error("db down"));

    await expect(getToolStats()).rejects.toThrow();
    expect(mocks.logError).toHaveBeenCalledWith(
      "ai.tool-telemetry",
      expect.any(Error),
      { fn: "getToolStats.findMany" },
    );
  });

  it("getProblemTools rejects too — so the tRPC Promise.all cannot half-succeed", async () => {
    mocks.toolTelemetry.findMany.mockRejectedValue(new Error("db down"));

    await expect(getProblemTools()).rejects.toThrow("db down");
  });

  it("CONTROL · a successful read still resolves with mapped stats", async () => {
    // Without this, `throw new Error()` unconditionally would satisfy every
    // assertion above while deleting the feature.
    mocks.toolTelemetry.findMany.mockResolvedValue([row(VETERAN, 1000, 950)]);

    const stats = await getToolStats();

    expect(stats).toHaveLength(1);
    expect(stats[0].toolName).toBe(VETERAN);
    expect(stats[0].successRate).toBeCloseTo(0.95, 5);
  });
});

describe("getProblemTools · the alarm fires on recent behaviour", () => {
  it("flags a 1,000-call veteran that is broken RIGHT NOW", async () => {
    mocks.toolTelemetry.findMany.mockResolvedValue([row(VETERAN, 1000, 950)]);
    // Five failures inside the breaker window — the tool is down.
    for (let i = 0; i < 5; i++) recordToolFailure(VETERAN);

    const problems = await getProblemTools();

    // Its lifetime rate is still 0.95, so the old lane is silent. It would
    // need >900 further consecutive failures to speak.
    expect(problems).toContain(VETERAN);
  });

  it("CONTROL · the same veteran, NOT currently failing, is not flagged", async () => {
    mocks.toolTelemetry.findMany.mockResolvedValue([row(VETERAN, 1000, 950)]);

    // Four failures — below the breaker threshold. Nothing is wrong yet.
    for (let i = 0; i < 4; i++) recordToolFailure(VETERAN);

    expect(await getProblemTools()).not.toContain(VETERAN);
  });

  it("CONTROL · a recovered tool drops off the alarm", async () => {
    mocks.toolTelemetry.findMany.mockResolvedValue([row(VETERAN, 1000, 950)]);
    for (let i = 0; i < 5; i++) recordToolFailure(VETERAN);
    expect(await getProblemTools()).toContain(VETERAN);

    // The breaker's cooldown still stands after a success, which is what
    // keeps this an alarm and not a flicker.
    recordToolSuccess(VETERAN);
    expect(await getProblemTools()).toContain(VETERAN);

    // A full reset (cooldown elapsed / manual) clears it.
    resetToolBreaker(VETERAN);
    expect(await getProblemTools()).not.toContain(VETERAN);
  });

  it("keeps the lifetime lane for a young tool that never worked", async () => {
    // 20 calls, 5 successes — the case the original heuristic was right about.
    mocks.toolTelemetry.findMany.mockResolvedValue([row(DUD, 20, 5)]);

    expect(await getProblemTools()).toContain(DUD);
  });

  it("CONTROL · a tool under the call floor is not flagged on one bad result", async () => {
    mocks.toolTelemetry.findMany.mockResolvedValue([row(DUD, 3, 0)]);

    expect(await getProblemTools()).not.toContain(DUD);
  });

  it("reports each tool once even when both lanes fire", async () => {
    mocks.toolTelemetry.findMany.mockResolvedValue([row(DUD, 20, 5)]);
    for (let i = 0; i < 5; i++) recordToolFailure(DUD);

    const problems = await getProblemTools();

    expect(problems.filter((t) => t === DUD)).toHaveLength(1);
  });
});
