/**
 * Q-23 phase 5 · analyzeLeadResponseTime says when its read failed.
 *
 * Its catch returned the same zeros as a quiet window, and the Lead SLA Monitor
 * painted them as an emerald "Avg: 0m". The failure now carries
 * `unavailable: true`, which client/src/pages/admin/intelligence/leadSla.ts
 * reads as UNMEASURED. A successful read never carries it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../db", () => ({
  getDb: async () => ({ execute: h.execute }),
}));

import { analyzeLeadResponseTime } from "./marketing";

afterEach(() => h.execute.mockReset());

describe("analyzeLeadResponseTime · failure is not a 0-minute average", () => {
  it("a failed read returns unavailable: true", async () => {
    h.execute.mockRejectedValueOnce(new Error("TiDB timeout"));
    const r = await analyzeLeadResponseTime();
    expect(r.unavailable).toBe(true);
    expect(r.avgMinutes).toBe(0);
  });

  it("an empty window is a successful read, without the marker", async () => {
    h.execute.mockResolvedValueOnce([[], []]);
    const r = await analyzeLeadResponseTime();
    expect(r.unavailable).toBeUndefined();
    expect(r.conversionBySpeed.reduce((s, b) => s + b.leads, 0)).toBe(0);
  });

  it("the bucket counts sum to the rows read (the client's sample size)", async () => {
    h.execute.mockResolvedValueOnce([
      [
        { id: 1, status: "booked", responseMinutes: 2 },
        { id: 2, status: "new", responseMinutes: 20 },
        { id: 3, status: "completed", responseMinutes: 45 },
        { id: 4, status: "lost", responseMinutes: 300 },
      ],
      [],
    ]);
    const r = await analyzeLeadResponseTime();
    expect(r.unavailable).toBeUndefined();
    expect(r.conversionBySpeed.reduce((s, b) => s + b.leads, 0)).toBe(4);
    expect(r.under5min).toBe(1);
    expect(r.over1hour).toBe(1);
  });
});
