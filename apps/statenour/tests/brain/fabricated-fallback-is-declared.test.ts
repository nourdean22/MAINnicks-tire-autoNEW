/**
 * tests/brain/fabricated-fallback-is-declared.test.ts · 2026-09-10
 *
 * `lib/db/safe-prisma.ts` already knew the truth and said it in a log:
 *
 *   note: "the value this caller returns is fabricated, not measured"
 *
 * An accurate sentence that only ever reached a log line. The CALLER --
 * the thing about to render that value as a fact -- had no way to know.
 * That is how a failed `getDoneTodayCount()` becomes "done today **0**"
 * in NICK's prompt, and it is a sentence with real weight to say to
 * someone who worked all morning.
 *
 * `onFallback` makes the signal in-band. It is optional and additive, so
 * every existing call site is untouched; a caller that RENDERS the value
 * can opt in and report it honestly.
 *
 * The controls matter as much as the canaries: a success must never fire
 * it, or every healthy turn grows a warning and the warning stops
 * meaning anything.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}));

import { safeQuery, isQuotaError, QUOTA_ERROR_PATTERNS, markQuotaRecovered } from "@/lib/db/safe-prisma";
import { renderCapacityBlock } from "@/lib/intelligence/capacity-block";

beforeEach(() => {
  vi.clearAllMocks();
  // The quota circuit is MODULE-LEVEL state. Without this, the canary
  // below trips the breaker and every later test in this file takes the
  // skip path instead of the branch it means to exercise -- a test
  // polluting its own suite.
  markQuotaRecovered();
});

describe("safeQuery tells the caller when it served a fabricated value", () => {
  it("CONTROL · a successful read never fires onFallback", async () => {
    const onFallback = vi.fn();
    const out = await safeQuery(async () => 42, 0, { label: "t.ok", onFallback });

    expect(out).toBe(42);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("CONTROL · a NON-quota error still throws rather than fabricating", async () => {
    // The fallback is for quota exhaustion, not for hiding real bugs. If
    // this ever starts returning the fallback, a genuine defect becomes a
    // silent zero -- the exact thing this file exists to prevent.
    const onFallback = vi.fn();
    await expect(
      safeQuery(
        async () => {
          throw new Error("column does not exist");
        },
        0,
        { label: "t.bug", onFallback },
      ),
    ).rejects.toThrow(/column does not exist/);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("CANARY · a quota error fires onFallback and returns the fallback", async () => {
    const onFallback = vi.fn();
    // Built from the module's OWN pattern list rather than a plausible
    // guess -- my first attempt invented wording that isQuotaError does
    // not match, so the canary failed for the wrong reason.
    const quota = new Error(`${QUOTA_ERROR_PATTERNS[0]} for this project`);
    expect(isQuotaError(quota)).toBe(true);

    const out = await safeQuery(
      async () => {
        throw quota;
      },
      0,
      { label: "t.quota", onFallback },
    );

    expect(out).toBe(0);
    expect(onFallback).toHaveBeenCalledWith("quota-error");
  });
});

describe("a partially unmeasured capacity block says so", () => {
  const base = {
    openCount: 4,
    lateCount: 1,
    staleCount: 0,
    doneToday: 0,
    capacityRemainingMin: 120,
    allocatedMin: 60,
  };

  it("CANARY · a degraded read is declared, and the numbers are disowned", () => {
    const out = renderCapacityBlock({ ...base, degradedReads: ["task-signals.done-today"] });

    expect(out).toMatch(/PARTIALLY UNMEASURED/);
    expect(out).toContain("task-signals.done-today");
    // The load-bearing instruction, not just a status word.
    expect(out).toMatch(/do not tell Nour\s+he has done nothing/i);
    // ...and the reads that DID work are still shown. Suppressing every
    // number on a partial outage trades one lie for another.
    expect(out).toMatch(/Open \*\*4\*\*/);
  });

  it("CONTROL · a healthy gather renders no warning", () => {
    const out = renderCapacityBlock({ ...base, degradedReads: [] });
    expect(out).not.toMatch(/UNMEASURED/);
    expect(out).toMatch(/Open \*\*4\*\*/);
  });

  it("CONTROL · absent degradedReads is treated as healthy, not degraded", () => {
    // Every existing caller predates the field. If `undefined` read as
    // "degraded", the warning would fire on every turn until it became
    // wallpaper.
    const out = renderCapacityBlock(base);
    expect(out).not.toMatch(/UNMEASURED/);
  });

  it("CONTROL · a TOTAL failure still uses the stronger existing wording", () => {
    // The null branch predates this change and is more emphatic on
    // purpose; the partial path must not have replaced it.
    const out = renderCapacityBlock(null);
    expect(out).toMatch(/\*\*UNMEASURED\*\*/);
    expect(out).toMatch(/nothing was counted/i);
  });
});
