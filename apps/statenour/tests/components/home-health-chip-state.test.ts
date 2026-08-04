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

  it("broken needs clearly-elevated error volume (>=40/24h), not a bare >0", () => {
    // fatal24h counts level='error' since the 2026-08-04 repoint; the live
    // baseline is ~12.6/day, so an ordinary day must NOT read as broken.
    expect(
      homeHealthState(slice({ errors: { count24h: 12, fatal24h: 12, measured: true } })).state,
    ).toBe("healthy");
    expect(
      homeHealthState(slice({ errors: { count24h: 39, fatal24h: 39, measured: true } })).state,
    ).not.toBe("broken"); // 39 lands in degraded-band territory via count>20, never broken
    const broken = homeHealthState(slice({ errors: { count24h: 40, fatal24h: 40, measured: true } }));
    expect(broken.state).toBe("broken");
    expect(broken.detail).toMatch(/40 errors in 24h/);
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
    expect(r.detail).toBe("3 error-log rows 24h · 12 crons declared");
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
