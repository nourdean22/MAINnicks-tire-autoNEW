/**
 * "Not erroring" is not "working".
 *
 * checkMirrorHealth gated every alert on `consecutiveFailures > 2`. But the most
 * common way this mirror stops working is not an error — the session expires and
 * nothing runs. No sync attempt means no failure to count, so consecutiveFailures
 * stays 0 and the check returned "OK" indefinitely while the data aged.
 *
 * Measured 2026-07-20: it ran 1,253 times in seven days, every single one
 * reporting `OK | data: 2d old | session: expired`. staleDays and sessionActive
 * were computed, printed into a human-readable string, and gated on by NOTHING —
 * the same computed-and-discarded shape as the rest of this codebase's honesty
 * defects, on the one check whose entire job is to notice.
 *
 * consecutiveFailures is also module-level, so it resets on every process
 * restart. On a platform that redeploys often it may never reach 3.
 */
import { describe, it, expect } from "vitest";
import { readSource } from "./testUtils/sourceAssertions";

const src = readSource("server/services/shopDriverMirror.ts");

describe("staleness escalates on its own", () => {
  it("has a stale threshold independent of failure count", () => {
    expect(src).toMatch(/MAX_ACCEPTABLE_STALE_DAYS = 3/);
    expect(src).toMatch(/staleDays !== null && staleDays > MAX_ACCEPTABLE_STALE_DAYS/);
  });

  it("alerts on that path, not just logs it", () => {
    const idx = src.indexOf("staleDays > MAX_ACCEPTABLE_STALE_DAYS");
    expect(src.slice(idx, idx + 700)).toMatch(/await sendMirrorAlert\(/);
  });

  it("names the real condition: not erroring, not running", () => {
    expect(src).toMatch(/is not erroring, it is not running/);
  });

  it("says what is downstream, so the number is actionable", () => {
    // A stale-data alert that does not say WHAT is wrong gets ignored.
    expect(src).toMatch(/Dashboard stats, revenue and recoverable-estimate figures/);
  });
});

describe("an expired session is surfaced before it becomes stale data", () => {
  it("reports DEGRADED rather than OK", () => {
    expect(src).toMatch(/DEGRADED: session expired/);
  });

  it("OK now requires the session to actually be active", () => {
    // The old string interpolated the session state into an "OK" message.
    expect(src).toMatch(/OK \| data: \$\{staleDays \?\? 0\}d old \| session: active/);
  });
});

describe("weekends must not page the operator", () => {
  it("tolerates up to three days — the shop is closed Sundays", () => {
    // One or two days without a new invoice is normal on a Monday. A check that
    // cries wolf every week is a check nobody reads.
    expect(src).toMatch(/closed Sundays/);
    const threshold = Number(src.match(/MAX_ACCEPTABLE_STALE_DAYS = (\d+)/)?.[1] ?? 0);
    expect(threshold).toBeGreaterThanOrEqual(3);
  });
});
