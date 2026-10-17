/**
 * Brain FU6 (skill empty-vs-error): the XP drift detector reads two windows, and a failed window is
 * not a measurement.
 *
 * THE DEFECT. detectXpDrift read both windows through xpEventTotalsSince, which turns a failed read
 * into an EMPTY map. With the 7-day read failed and the 35-day read answering, every stat with a
 * 28-day baseline got recent7 = 0, ratio 0, and a "decay" drift: the narrator then told the
 * operator a stat was slipping when nothing had been measured. The fix reads through
 * xpEventTotalsSinceOrNull and returns no drift (one warn line) when either window is unreadable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  read: vi.fn<(days: number) => Map<string, number> | null>(),
}));

const windowDays = (since: Date) => Math.round((Date.now() - since.getTime()) / 86_400_000);

vi.mock("@/lib/mastery/credit", () => ({
  // The null-on-failure reader the detector must use.
  xpEventTotalsSinceOrNull: async (since: Date) => h.read(windowDays(since)),
  // The swallowing reader: a failed read becomes an empty map, exactly like credit.ts.
  xpEventTotalsSince: async (since: Date) => h.read(windowDays(since)) ?? new Map<string, number>(),
}));

import { detectXpDrift } from "@/lib/mastery/xp-drift";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.read.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

/** 35-day total 140 with 0 in the last 7 = a baseline of 140 over 28 days. */
const full35 = () => new Map([["focus", 140]]);

describe("detectXpDrift: a window it could not read makes no claim", () => {
  it("returns no drifts and logs when the 7-day read fails and the 35-day read answers", async () => {
    h.read.mockImplementation((days) => (days === 7 ? null : full35()));
    const drifts = await detectXpDrift();
    expect(drifts, "a failed 7-day read was drawn as a decay").toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("xp_drift_read_failed");
    expect(String(warn.mock.calls[0][0])).toContain("7d");
  });

  it("returns no drifts and logs when the 35-day read fails and the 7-day read answers", async () => {
    h.read.mockImplementation((days) => (days === 35 ? null : new Map([["focus", 90]])));
    expect(await detectXpDrift()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("35d");
  });

  it("returns no drifts when both reads fail", async () => {
    h.read.mockReturnValue(null);
    expect(await detectXpDrift()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("xp_drift_read_failed");
  });
});

describe("detectXpDrift: positive control, a real slump is still found", () => {
  it("flags a decay when the 7-day window answered with nothing and the baseline is real", async () => {
    h.read.mockImplementation((days) => (days === 7 ? new Map() : full35()));
    const drifts = await detectXpDrift();
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toMatchObject({ stat: "focus", direction: "decay", ratio: 0 });
    expect(warn).not.toHaveBeenCalled();
  });

  it("flags a surge on real data and logs nothing", async () => {
    // 7d = 70, 35d = 98: baseline 28 over 28 days (1/day), recent 10/day = ratio 10.
    h.read.mockImplementation((days) => new Map([["strength", days === 7 ? 70 : 98]]));
    const drifts = await detectXpDrift();
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toMatchObject({ stat: "strength", direction: "surge" });
    expect(warn).not.toHaveBeenCalled();
  });
});
