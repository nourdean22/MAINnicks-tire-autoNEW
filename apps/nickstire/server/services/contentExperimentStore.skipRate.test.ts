/**
 * Skip rate reaches the experiment evaluator (2026-10-08).
 *
 * ig_metric_snapshots.skip_rate is DECIMAL(6,4); mysql2 returns DECIMAL as a
 * string ("83.6000") and instagram-data.ts writes it with String(...). The
 * gatherer accepted only `typeof number`, so every skip rate read as "not
 * reported" — the metric a hook experiment exists to move was invisible.
 */
import { describe, expect, it, vi } from "vitest";

const PUBLISHED = new Date("2026-09-01T12:00:00Z");
const CAPTURED_72H = new Date("2026-09-04T12:00:00Z");

const { selects } = vi.hoisted(() => ({ selects: [] as unknown[][] }));
vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: async () => selects.shift() ?? [] }) }),
  }),
}));

import { gatherObservations } from "./contentExperimentStore";

describe("gatherObservations — skipRate", () => {
  it("reads a DECIMAL string as its number, keeps junk as null, never 0", async () => {
    selects.push(
      [
        { armId: "hook-control", mediaId: "m1", publishedAt: PUBLISHED },
        { armId: "hook-direct", mediaId: "m2", publishedAt: PUBLISHED },
        { armId: "hook-direct", mediaId: "m3", publishedAt: PUBLISHED },
      ],
      [{ capturedAt: CAPTURED_72H, reach: 900, skipRate: "83.6000" }],
      [{ capturedAt: CAPTURED_72H, reach: 700, skipRate: "41.2500" }],
      [{ capturedAt: CAPTURED_72H, reach: 500, skipRate: null }],
    );
    const obs = await gatherObservations("hook-style-direct-v1", "skipRate", 72);
    expect(obs.map((o) => o.metricValue)).toEqual([83.6, 41.25, null]);
  });

  it("an integer column is unchanged (avgWatchTimeMs)", async () => {
    selects.push(
      [{ armId: "hook-control", mediaId: "m1", publishedAt: PUBLISHED }],
      [{ capturedAt: CAPTURED_72H, reach: 900, avgWatchTimeMs: 3200 }],
    );
    const obs = await gatherObservations("x", "avgWatchTimeMs", 72);
    expect(obs[0].metricValue).toBe(3200);
  });
});
