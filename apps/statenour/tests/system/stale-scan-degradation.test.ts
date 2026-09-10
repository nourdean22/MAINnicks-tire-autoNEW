/**
 * tests/system/stale-scan-degradation.test.ts · 2026-09-10
 *
 * A scanner that cannot read must not report "clean".
 *
 * `scanStaleData` runs eight independent reads, every one of which falls
 * back to empty. The aggregate returned `totalStaleRows: 0` with nothing
 * to distinguish a quota outage from a genuinely tidy system -- and
 * `system-hub` then reported `measured: true` beside a total that was
 * really only a floor.
 *
 * The control is the half that keeps this honest in the other direction:
 * a real zero must still be reportable as a confident zero.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QUOTA_ERROR_PATTERNS } from "@/lib/db/safe-prisma";

/**
 * Every model method rejects with a QUOTA error, which is the one class
 * safeQuery converts into a fallback. A generic Error would THROW
 * instead, so this fixture has to use the real pattern -- the same trap
 * that made the first version of the sibling canary fail for the wrong
 * reason.
 */
const quota = () => Promise.reject(new Error(`${QUOTA_ERROR_PATTERNS[0]} for this project`));
const healthy = () => Promise.resolve([]);

const mode = { fail: true };

vi.mock("@/lib/prisma", () => {
  const method = () => (mode.fail ? quota() : healthy());
  const model = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "count") return () => (mode.fail ? quota() : Promise.resolve(0));
        return method;
      },
    },
  );
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "$queryRaw" || prop === "$queryRawUnsafe") return method;
          return model;
        },
      },
    ),
  };
});
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}));

import { scanStaleData } from "@/lib/system/stale-data-scanner";
import { markQuotaRecovered } from "@/lib/db/safe-prisma";

beforeEach(() => {
  // The quota circuit is module-level. Reset it or the first failing test
  // opens the breaker and every later scan takes the SKIP path instead of
  // the error path it means to exercise.
  markQuotaRecovered();
});

describe("a scan that could not read says so", () => {
  it("CANARY · a total quota outage reports degraded reads, not a clean system", async () => {
    mode.fail = true;
    const report = await scanStaleData();

    // The number that used to be the whole story...
    expect(report.totalStaleRows).toBe(0);
    // ...is now explicitly not a measurement.
    expect(report.degradedReads.length).toBeGreaterThan(0);
    // Every label is a named scan, so a consumer can say WHICH is missing
    // rather than discrediting the entire report.
    for (const label of report.degradedReads) {
      expect(label).toMatch(/^stale\./);
    }
  });
});

describe("CONTROL · a healthy scan reports a clean zero, with no warning", () => {
  it("no degraded reads when every scan runs", async () => {
    mode.fail = false;
    const report = await scanStaleData();

    expect(report.degradedReads).toEqual([]);
    expect(report.totalStaleRows).toBe(0);
    // Without this control, "always report degraded" would pass the
    // canary above and make the signal meaningless.
  });
});
