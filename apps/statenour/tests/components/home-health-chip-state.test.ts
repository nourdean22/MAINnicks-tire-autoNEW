/**
 * "SYSTEM · healthy" on the HOME page is a claim about every source the
 * chip reads. This component was the SECOND consumer of the hub payload's
 * fabricated zeros (hub-grid was the first) — the quota circuit could
 * paint the operator's landing page green. Mirrors the pure-derivation
 * pattern of home-state-pulse-tone.test.ts.
 */
import { describe, expect, it } from "vitest";

import { homeHealthState, type HomeHealthSlice } from "@/components/home/home-health-chip";

function slice(over: Partial<HomeHealthSlice> = {}): HomeHealthSlice {
  return {
    crons: { declared: 12, silent: 0, measured: true },
    errors: { count24h: 3, fatal24h: 0, measured: true },
    devices: { offline: 0, measured: true },
    ...over,
  };
}

describe("homeHealthState", () => {
  it("no data yet → unknown", () => {
    expect(homeHealthState(null).state).toBe("unknown");
  });

  it("ANY unmeasured section vetoes the green — an all-clear needs every source", () => {
    for (const over of [
      { errors: { count24h: 0, fatal24h: 0, measured: false } },
      { crons: { declared: 0, silent: 0, measured: false } },
      { devices: { offline: 0, measured: false } },
    ] as const) {
      const r = homeHealthState(slice(over));
      expect(r.state).toBe("unknown");
      expect(r.detail).toMatch(/unmeasured/);
    }
  });

  it("fatal errors → broken", () => {
    expect(homeHealthState(slice({ errors: { count24h: 9, fatal24h: 2, measured: true } })).state).toBe(
      "broken",
    );
  });

  it("silent crons or offline devices → degraded, with both named when both fire", () => {
    const r = homeHealthState(
      slice({
        crons: { declared: 12, silent: 2, measured: true },
        devices: { offline: 1, measured: true },
      }),
    );
    expect(r.state).toBe("degraded");
    expect(r.detail).toMatch(/2 silent crons/);
    expect(r.detail).toMatch(/1 device offline/);
  });

  it("measured and clean → healthy with the real counts in the detail", () => {
    const r = homeHealthState(slice());
    expect(r.state).toBe("healthy");
    expect(r.detail).toBe("3 non-fatal errors · 12 crons declared");
  });

  it("a legacy payload without measured keeps the old behaviour (deploy window)", () => {
    const r = homeHealthState({
      crons: { declared: 12, silent: 0 },
      errors: { count24h: 3, fatal24h: 0 },
      devices: { offline: 0 },
    });
    expect(r.state).toBe("healthy");
  });
});
