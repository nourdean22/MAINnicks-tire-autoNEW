/**
 * Confidence bands — ranking evidence without inventing a probability.
 *
 * The queue shows 0.9 and 0.75 beside real invoices, and an operator
 * confirming money reads those as percentages. They are not: they are ordinal
 * labels for two evidence recipes that differ by EXACTLY ONE FACT — whether the
 * service text overlapped — and neither has ever been calibrated against
 * outcomes.
 *
 * This matters because the last defect found in this queue was an over-count:
 * eight calls claiming one invoice, each individually plausible. A number that
 * reads as a probability invites the batch-confirm behaviour that produced it.
 */
import { describe, expect, it } from "vitest";

import {
  BAND_CALIBRATION_CAVEAT,
  bandMix,
  bandOf,
  describeBand,
} from "../lib/attributionConfidenceBands";

describe("the producer's actual ladder maps to bands", () => {
  it.each([
    [1, "verified"],
    [0.9, "strong"],
    [0.75, "weak"],
    [null, "unscored"],
    [undefined, "unscored"],
  ])("confidence %s is %s", (c, expected) => {
    expect(bandOf(c as number | null | undefined)).toBe(expected);
  });

  it("only VERIFIED is an observed link — everything else is inference", () => {
    // The distinction the whole module exists to preserve.
    expect(describeBand("verified").observed).toBe(true);
    expect(describeBand("strong").observed).toBe(false);
    expect(describeBand("weak").observed).toBe(false);
    expect(describeBand("unscored").observed).toBe(false);
  });

  it("a value above 1 does not invent a band above verified", () => {
    expect(bandOf(1.5)).toBe("verified");
  });

  it("NaN is unscored, not silently weak", () => {
    expect(bandOf(Number.NaN)).toBe("unscored");
  });
});

describe("the bands say what would RAISE them — the only actionable part", () => {
  it("weak points at the real cause: the request was never captured", () => {
    const d = describeBand("weak");
    expect(d.whatWouldRaiseIt).toContain("Capturing what the caller actually asked for");
  });

  it("strong can only become observed via a recorded lead link", () => {
    expect(describeBand("strong").whatWouldRaiseIt).toContain("lead link");
  });

  it("verified has nothing above it, and says so with null rather than filler", () => {
    expect(describeBand("verified").whatWouldRaiseIt).toBeNull();
  });

  it("every band states its basis in full — no blanks", () => {
    for (const b of ["verified", "strong", "weak", "unscored"] as const) {
      expect(describeBand(b).basis.trim().length).toBeGreaterThan(40);
      expect(describeBand(b).label.trim().length).toBeGreaterThan(3);
    }
  });
});

describe("the calibration caveat is not optional", () => {
  it("says plainly that the bands are an ordering, not a percentage", () => {
    expect(BAND_CALIBRATION_CAVEAT).toContain("not probability");
    expect(BAND_CALIBRATION_CAVEAT).toContain("ordering, not a percentage");
  });

  it("admits nobody has measured the hit rate", () => {
    // If this ever becomes false, the caveat must change with it — pinning the
    // claim here is what forces that.
    expect(BAND_CALIBRATION_CAVEAT).toContain("Nobody has yet measured");
  });
});

describe("the mix is what an operator should watch", () => {
  it("counts each band and reports the inferred share", () => {
    const m = bandMix([1, 1, 0.9, 0.75, 0.75, null]);
    expect(m.verified).toBe(2);
    expect(m.strong).toBe(1);
    expect(m.weak).toBe(2);
    expect(m.unscored).toBe(1);
    expect(m.total).toBe(6);
    // 4 of 6 rest on inference.
    expect(m.inferredPct).toBe(67);
  });

  it("an all-verified queue is 0% inferred", () => {
    expect(bandMix([1, 1, 1]).inferredPct).toBe(0);
  });

  it("an all-weak queue is 100% inferred — the batch-confirm warning case", () => {
    expect(bandMix([0.75, 0.75]).inferredPct).toBe(100);
  });

  it("an EMPTY queue reports null, not 0% — unmeasured is not measured-zero", () => {
    const m = bandMix([]);
    expect(m.total).toBe(0);
    expect(m.inferredPct).toBeNull();
  });

  it("POSITIVE CONTROL: the mix discriminates rather than returning a constant", () => {
    // Without this, a function returning all-zeros would satisfy the empty case
    // and a function returning a fixed shape would satisfy the counted ones.
    const a = bandMix([1, 1, 1]);
    const b = bandMix([0.75, 0.75, 0.75]);
    expect(a.inferredPct).not.toBe(b.inferredPct);
    expect(a.verified).not.toBe(b.verified);
  });

  it("is total — hostile input never throws", () => {
    expect(() => bandMix([null, undefined, Number.NaN, -1, 0, 99])).not.toThrow();
  });
});

describe("plain words for the operator (2026-10-25)", () => {
  // Nour reads the card on his phone between jobs. "Phone + time only · inferred" told him
  // the recipe; it never told him what was uncertain. Every band now carries a `why` in
  // words, and the label is a sentence fragment a non-engineer can read.
  it("every band says why it is what it is, in words, without the recipe's tokens", () => {
    for (const b of ["verified", "strong", "weak", "unscored"] as const) {
      const d = describeBand(b);
      expect(d.why.trim().length).toBeGreaterThan(20);
      expect(d.why).not.toMatch(/phone_time|candidate|normalized|inferred/i);
      expect(d.label).not.toMatch(/\+|inferred/);
    }
  });

  it("the weak band names the two facts it rests on and that nothing else ties them", () => {
    expect(describeBand("weak").label).toBe("Same phone and timing only");
    expect(describeBand("weak").why).toMatch(/14 days/);
    expect(describeBand("weak").why).toMatch(/nothing else/i);
  });

  it("the strong band adds the service, the verified band names the record", () => {
    expect(describeBand("strong").label).toBe("Same phone, timing and service");
    expect(describeBand("verified").label).toBe("Recorded link");
    expect(describeBand("unscored").label).toBe("No single sale fits");
  });
});
