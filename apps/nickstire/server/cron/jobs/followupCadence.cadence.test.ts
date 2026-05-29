/**
 * wave-143 · nextDueTouch — the follow-up cadence decision (the flywheel).
 *
 * This pure function is the safety-critical core: it decides which touch (if
 * any) a completed booking is due for, ONE at a time. The "one touch per run,
 * never all at once" guarantee — even for an old booking with no touches yet —
 * is what keeps the auto-caller from dialing a customer 3 times in a row.
 * A regression here is a spam regression, so it's pinned.
 */
import { describe, expect, it } from "vitest";
import { nextDueTouch } from "./followupCadence";

const DAY = 86_400_000;
const now = 1_700_000_000_000;
const ago = (days: number) => new Date(now - days * DAY);

describe("wave-143 · nextDueTouch", () => {
  it("d7 fires once the booking is >= 7 days old", () => {
    expect(nextDueTouch(ago(8), new Set(), now)).toBe("d7");
  });

  it("nothing is due before 7 days", () => {
    expect(nextDueTouch(ago(3), new Set(), now)).toBeNull();
  });

  it("after d7 fired, d30 fires at >= 30 days", () => {
    expect(nextDueTouch(ago(31), new Set(["d7"]), now)).toBe("d30");
  });

  it("after d7 fired but only 20 days old, nothing due yet", () => {
    expect(nextDueTouch(ago(20), new Set(["d7"]), now)).toBeNull();
  });

  it("after d7 + d30 fired, d60 fires at >= 60 days", () => {
    expect(nextDueTouch(ago(61), new Set(["d7", "d30"]), now)).toBe("d60");
  });

  it("all three fired -> null (cadence complete)", () => {
    expect(nextDueTouch(ago(90), new Set(["d7", "d30", "d60"]), now)).toBeNull();
  });

  it("old booking, nothing fired -> d7 FIRST (one touch per run, never all at once)", () => {
    expect(nextDueTouch(ago(70), new Set(), now)).toBe("d7");
  });
});
