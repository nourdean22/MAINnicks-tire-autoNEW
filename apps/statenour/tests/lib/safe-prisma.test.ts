/**
 * The quota circuit must be VISIBLE in production.
 *
 * safeQuery's open-circuit branch hands the caller its zero/empty fallback
 * without ever asking the database. That branch had no logging at all, and the
 * only two lines it did have were wrapped in `process.env.NODE_ENV !==
 * "production"` — so production was silent by construction.
 *
 * That silence is what made the downstream surfaces unmeasurable: the home
 * header renders the literal word "calm", /system/coverage renders "Nothing
 * stale — All 8 categories are clean", and the health digest renders "all
 * other probes clean", all from fabricated zeros. Nobody could answer "has
 * this ever actually fired?" — which is the question that decides whether any
 * of those surfaces is worth fixing.
 *
 * These pins are about OBSERVABILITY, not about the circuit's policy. The 95%
 * drop is deliberate and unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `const log = logger.withSurface(...)` runs at module scope, so the mock has
// to exist before the module under test is imported. vi.mock is hoisted above
// ordinary consts, so the spies have to be hoisted with it — a plain
// `const warn = vi.fn()` here throws "Cannot access 'warn' before
// initialization" when the factory runs.
const { warn, info } = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));

vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ warn, info }) },
}));

import {
  safeQuery,
  markQuotaExhausted,
  markQuotaRecovered,
} from "@/lib/db/safe-prisma";

beforeEach(() => {
  warn.mockClear();
  info.mockClear();
  markQuotaRecovered();
  // The circuit lets 5% of queries through as probes. Without pinning
  // Math.random the open-circuit cases flake roughly 1 run in 20.
  vi.spyOn(Math, "random").mockReturnValue(0.99);
});

afterEach(() => {
  // lastQuotaErrorAt and the dedupe map are module-level and leak between
  // cases in the same file — statenour runs pool:"forks", one process per file.
  markQuotaRecovered();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/**
 * Every case runs under NODE_ENV=production ON PURPOSE. That is the whole
 * regression: the two transition logs used to be wrapped in
 * `process.env.NODE_ENV !== "production"`, so a test running under "test"
 * would pass against the broken code and prove nothing.
 *
 * vi.stubEnv, not Object.defineProperty — process.env rejects a partial
 * descriptor with "only accepts a configurable, writable, and enumerable data
 * descriptor".
 */
function setProd() {
  vi.stubEnv("NODE_ENV", "production");
}

describe("open circuit reports itself in production", () => {
  it("logs the skip, and does not run the query", async () => {
    setProd();
    markQuotaExhausted();
    const fn = vi.fn(async () => 42);

    const out = await safeQuery(fn, 0, { label: "pulse.cronFails" });

    expect(out).toBe(0);
    expect(fn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    // The label must be present — a line that does not name the caller cannot
    // tell the operator WHICH number on screen was fabricated.
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ label: "pulse.cronFails" });
  });

  it("reports once per label per window, not once per dropped read", async () => {
    setProd();
    markQuotaExhausted();
    const fn = vi.fn(async () => 42);

    for (let i = 0; i < 20; i++) await safeQuery(fn, 0, { label: "pulse.cronFails" });

    // ~46 call sites x 95% of reads for 60s is a flood without the dedupe.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it("reports separately for each distinct label", async () => {
    setProd();
    markQuotaExhausted();
    await safeQuery(async () => 1, 0, { label: "pulse.cronFails" });
    await safeQuery(async () => 1, 0, { label: "coverage.staleScan" });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("reports again in a NEW window — a second outage is a second incident", async () => {
    setProd();
    markQuotaExhausted();
    await safeQuery(async () => 1, 0, { label: "pulse.cronFails" });
    expect(warn).toHaveBeenCalledTimes(1);

    markQuotaRecovered();
    markQuotaExhausted();
    await safeQuery(async () => 1, 0, { label: "pulse.cronFails" });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("the circuit's own transitions are no longer production-gated", () => {
  it("logs when a quota error OPENS the circuit, in production", async () => {
    setProd();
    const fn = vi.fn(async () => {
      throw new Error("You have exceeded the compute time quota for this project");
    });

    const out = await safeQuery(fn, "fallback", { label: "brain.recall" });

    expect(out).toBe("fallback");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ label: "brain.recall" });
  });

  it("logs when a probe CLOSES the circuit, in production", async () => {
    setProd();
    markQuotaExhausted();
    // Let this one through as the 5% probe.
    vi.spyOn(Math, "random").mockReturnValue(0.01);

    const out = await safeQuery(async () => "live", "fallback", { label: "brain.recall" });

    expect(out).toBe("live");
    expect(info).toHaveBeenCalledTimes(1);
  });
});

describe("policy is unchanged", () => {
  it("a healthy circuit runs the query and logs nothing", async () => {
    setProd();
    const fn = vi.fn(async () => "live");
    const out = await safeQuery(fn, "fallback", { label: "pulse.cronFails" });
    expect(out).toBe("live");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it("a NON-quota error still throws rather than being swallowed", async () => {
    setProd();
    await expect(
      safeQuery(async () => {
        throw new Error("column does not exist");
      }, "fallback", { label: "pulse.cronFails" }),
    ).rejects.toThrow("column does not exist");
  });
});
