/**
 * quality-bench · a chronic failure must not report as a healthy run.
 *
 * From the 2026-09-17 audit packet, Priority 1:
 *   "the benchmark must preserve unresolved critical failures even when the
 *    aggregate improves (`bench_ok` currently logs despite 4/8 failures)."
 *
 * The original handler branched on "should I alert?" and treated everything
 * else as OK. Alerting required a REGRESSION (pass rate below the previous
 * run) or a first-ever run, so a suite stuck at the same failure count week
 * after week satisfied neither and fell through to `log.info("bench_ok")`.
 *
 * ★ Visibility was tied to the DELTA, so a failure went quiet exactly when it
 *   became chronic — the moment it most needed attention.
 */
import { describe, it, expect } from "vitest";
import { classifyBenchOutcome } from "../../lib/inngest/functions/quality-bench";

describe("classifyBenchOutcome", () => {
  it("REGRESSION — fewer passing than last week alerts", () => {
    expect(classifyBenchOutcome({ failed: 3, passRate: 0.625, prevRate: 0.875 })).toBe("alert");
  });

  it("FIRST RUN — no baseline and failures present alerts", () => {
    expect(classifyBenchOutcome({ failed: 4, passRate: 0.5, prevRate: null })).toBe("alert");
  });

  it("THE AUDIT'S CASE — 4/8 failing, unchanged from last week, is NOT ok", () => {
    // Identical pass rate: not a regression, not a first run. This is the exact
    // input that used to log `bench_ok` with "passed: 4, total: 8".
    const outcome = classifyBenchOutcome({ failed: 4, passRate: 0.5, prevRate: 0.5 });
    expect(outcome).toBe("unresolved");
    expect(outcome).not.toBe("ok");
  });

  it("IMPROVED BUT STILL BROKEN — an improving aggregate does not clear failures", () => {
    // 6/8 passing this week vs 4/8 last week is real progress, and two checks
    // are still failing. Progress is not the same as resolved.
    expect(classifyBenchOutcome({ failed: 2, passRate: 0.75, prevRate: 0.5 })).toBe("unresolved");
  });

  it("OK means zero failures, and nothing else", () => {
    expect(classifyBenchOutcome({ failed: 0, passRate: 1, prevRate: 0.5 })).toBe("ok");
    expect(classifyBenchOutcome({ failed: 0, passRate: 1, prevRate: null })).toBe("ok");
    expect(classifyBenchOutcome({ failed: 0, passRate: 1, prevRate: 1 })).toBe("ok");
  });

  it("MUTATION — no non-zero failure count can ever classify as ok", () => {
    // The guard the whole file exists for. Swept across baselines so a future
    // edit cannot reintroduce a path where failures read as healthy.
    for (const failed of [1, 2, 4, 8]) {
      for (const prevRate of [null, 0, 0.25, 0.5, 0.75, 1]) {
        for (const passRate of [0, 0.25, 0.5, 0.75]) {
          expect(
            classifyBenchOutcome({ failed, passRate, prevRate }),
            `failed=${failed} passRate=${passRate} prevRate=${String(prevRate)} must not be ok`,
          ).not.toBe("ok");
        }
      }
    }
  });
});
