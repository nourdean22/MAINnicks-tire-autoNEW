/**
 * Empty-buffer truthfulness for the CWV report.
 *
 * percentile() returns 0 for an empty list, and 0 <= threshold.good, so the
 * classifier alone rated every unmeasured metric "good". The ring buffer is
 * process memory, so this exact state recurs after EVERY deploy/restart —
 * a report with zero samples must say "unavailable", never "good"
 * (unknown-is-not-zero doctrine).
 *
 * vi.resetModules + dynamic import gives each test a fresh module-scope
 * buffer — mandatory in the serial single-fork suite where module state
 * leaks across test files.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const METRICS = ["LCP", "CLS", "INP", "FCP", "TTFB"] as const;

afterEach(() => {
  vi.resetModules();
});

describe("cwv-telemetry empty buffer", () => {
  it("rates every metric 'unavailable' when zero samples exist", async () => {
    vi.resetModules();
    const { getCwvReport } = await import("../lib/cwv-telemetry");
    const report = getCwvReport(60);
    expect(report.totalSamples).toBe(0);
    for (const m of METRICS) {
      expect(report.byMetric[m].rating).toBe("unavailable");
    }
  });

  it("a recorded sample flips only its own metric off 'unavailable'", async () => {
    vi.resetModules();
    const mod = await import("../lib/cwv-telemetry");
    mod.recordCwvSample({
      metric: "LCP",
      value: 1200,
      route: "/",
      navType: "navigate",
      sessionId: "test-session",
    });
    const report = mod.getCwvReport(60);
    expect(report.byMetric.LCP.samples).toBe(1);
    expect(report.byMetric.LCP.rating).toBe("good");
    // The other four are still unmeasured and must stay unavailable.
    for (const m of METRICS.filter((x) => x !== "LCP")) {
      expect(report.byMetric[m].rating).toBe("unavailable");
    }
  });
});
