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
  describeCandidate,
} from "../lib/attributionConfidenceBands";

// bandOf and describeBand are internal now (knip: a test is not a consumer). The public
// surface is describeCandidate; these two helpers reach the same ladder through it.
const CONF = { verified: 1, strong: 0.9, weak: 0.75, unscored: null } as const;
const band = (b: keyof typeof CONF) => describeCandidate({ confidence: CONF[b], resolution: "manual_review", invoiceId: 1 });
const bandOf = (c: number | null | undefined) => describeCandidate({ confidence: c, resolution: "manual_review", invoiceId: 1 }).band;

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
    expect(band("verified").observed).toBe(true);
    expect(band("strong").observed).toBe(false);
    expect(band("weak").observed).toBe(false);
    expect(band("unscored").observed).toBe(false);
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
    const d = band("weak");
    expect(d.whatWouldRaiseIt).toContain("Capturing what the caller actually asked for");
  });

  it("strong can only become observed via a recorded lead link", () => {
    expect(band("strong").whatWouldRaiseIt).toContain("lead link");
  });

  it("verified has nothing above it, and says so with null rather than filler", () => {
    expect(band("verified").whatWouldRaiseIt).toBeNull();
  });

  it("every band states its basis in full — no blanks", () => {
    for (const b of ["verified", "strong", "weak", "unscored"] as const) {
      expect(band(b).basis.trim().length).toBeGreaterThan(40);
      expect(band(b).label.trim().length).toBeGreaterThan(3);
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
      const d = band(b);
      expect(d.why.trim().length).toBeGreaterThan(20);
      expect(d.why).not.toMatch(/phone_time|candidate|normalized|inferred/i);
      expect(d.label).not.toMatch(/\+|inferred/);
    }
  });

  it("the weak band names the two facts it rests on and that nothing else ties them", () => {
    expect(band("weak").label).toBe("Same phone and timing only");
    expect(band("weak").why).toMatch(/14 days/);
    expect(band("weak").why).toMatch(/nothing else/i);
  });

  it("the strong band adds the service, the verified band names the record", () => {
    expect(band("strong").label).toBe("Same phone, timing and service");
    expect(band("verified").label).toBe("Recorded link");
    expect(band("unscored").label).toBe("No single sale fits");
  });
});

describe("describeCandidate · the why follows the candidate, not only its confidence (Codex, PR 3271)", () => {
  it("a direct lead link whose sale is claimed by another lead is ambiguous WITH a sale, and says that", () => {
    // buildCallInvoiceCandidates returns resolution "ambiguous", the invoiceId, confidence null.
    const d = describeCandidate({ confidence: null, resolution: "ambiguous", invoiceId: 6060001 });
    expect(d.band).toBe("unscored");
    expect(d.why).toMatch(/another lead/i);
    expect(d.why).not.toMatch(/no one sale/i);
  });

  it("an ambiguous row with no sale keeps the no-single-sale words", () => {
    const d = describeCandidate({ confidence: null, resolution: "ambiguous", invoiceId: null });
    expect(d.why).toMatch(/no one sale to confirm/i);
  });

  it("a scored row is the plain band", () => {
    expect(describeCandidate({ confidence: 0.75, resolution: "manual_review", invoiceId: 1 })).toEqual(band("weak"));
  });
});
