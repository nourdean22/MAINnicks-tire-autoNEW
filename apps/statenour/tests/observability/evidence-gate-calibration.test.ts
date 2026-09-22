/**
 * The calibration readout must refuse to mislead the promotion decision.
 *
 * AGENTS.md §4 L6 defers enforcement "once the shadow false-positive rate is
 * known". These lock the three rules that make the resulting number safe to act
 * on — each written because the first hand-measurement got it wrong:
 *
 *   1 · cohort at the last precision change (a first pass mixed pre- and
 *       post-fix turns and measured the FIX'S ABSENCE, not the gate)
 *   2 · state no rate at all on a thin sample (post-fix n was 12; "4 of 12"
 *       rendered as 33.3% invites a decision the data cannot support)
 *   3 · split by driver (named-claim blocks fell 21/91 → 1/12 while fact-check
 *       became dominant; an aggregate would promote whichever is loudest)
 */
import { describe, it, expect } from "vitest";
import {
  assembleBufferShadow,
  assembleGateCalibration,
  BUFFER_SHADOW_SINCE,
  classifyDriver,
  type GateTurn,
  isBlockingVerdict,
  MIN_SAMPLE,
} from "@/lib/observability/evidence-gate-calibration";

const FIX = "2026-09-16T08:56:00.000Z";
const before = (n: number) => new Date(Date.parse(FIX) - (n + 1) * 60_000);
const after = (n: number) => new Date(Date.parse(FIX) + (n + 1) * 60_000);

const turn = (at: Date, gate: Record<string, unknown>) => ({ createdAt: at, gate, excerpt: "reply" });
const pass = (at: Date) => turn(at, { verdict: "pass" });
const namedBlock = (at: Date, names: string[] = ["Some Channel"]) =>
  turn(at, { verdict: "block", namedClaims: names.length, unreceipted: names, blockingReasons: ["named 1 resource(s) with no tool receipt"] });
const factBlock = (at: Date) =>
  turn(at, { verdict: "repair", namedClaims: 0, blockingReasons: ["fact-check 2/4 unverified (asserted without hedge)"] });
const lengthBlock = (at: Date) =>
  turn(at, { verdict: "repair", namedClaims: 0, blockingReasons: ["length 506 words = 169% of the 300 ceiling"] });

describe("isBlockingVerdict", () => {
  it.each(["pass", "ok", "allow", ""])("treats %s as passing", (v) =>
    expect(isBlockingVerdict(v)).toBe(false),
  );
  it.each(["block", "repair"])("treats %s as blocking", (v) => expect(isBlockingVerdict(v)).toBe(true));
});

describe("classifyDriver", () => {
  it("a named-resource block is the fabrication case the gate exists for", () => {
    expect(classifyDriver({ namedClaims: 2, blockingReasons: ["named 2 resource(s) with no tool receipt"] })).toBe("named_claim");
  });
  it("separates fact-check from named claims", () => {
    expect(classifyDriver({ namedClaims: 0, blockingReasons: ["fact-check 2/4 unverified (asserted without hedge)"] })).toBe("fact_check");
  });
  it("surfaces LENGTH as its own driver — it is not an evidence signal", () => {
    // Folding a 506-word reply into an "evidence" block rate would make the
    // gate look stricter about truth than it is.
    expect(classifyDriver({ namedClaims: 0, blockingReasons: ["length 506 words = 169% of the 300 ceiling"] })).toBe("length");
  });
});

describe("assembleGateCalibration", () => {
  it("COHORTS at the precision change — pre-fix turns never contaminate the decision figure", () => {
    const turns = [
      ...Array.from({ length: 50 }, (_, i) => namedBlock(before(i))), // the old false-positive surface
      ...Array.from({ length: MIN_SAMPLE }, (_, i) => pass(after(i))),
    ];
    const out = assembleGateCalibration(turns, { cohortSince: FIX });

    expect(out.beforeFix.wouldBlock).toBe(50);
    // The post-fix cohort is clean, and that is the only one promotion may use.
    expect(out.afterFix.wouldBlock).toBe(0);
    expect(out.afterFix.wouldBlockPct).toBe(0);
  });

  it("states NO RATE when the post-fix sample is too thin", () => {
    const turns = [
      ...Array.from({ length: 8 }, (_, i) => pass(after(i))),
      ...Array.from({ length: 4 }, (_, i) => namedBlock(after(100 + i))),
    ];
    const out = assembleGateCalibration(turns, { cohortSince: FIX });

    expect(out.afterFix.turns).toBe(12);
    expect(out.afterFix.wouldBlock).toBe(4);
    // 4/12 is not 33.3% — it is "not enough turns". null, never a number.
    expect(out.afterFix.wouldBlockPct).toBeNull();
    expect(out.sufficient).toBe(false);
    expect(out.caveat).toMatch(/No rate is stated/i);
  });

  it("states a rate once the sample supports one", () => {
    const turns = [
      ...Array.from({ length: MIN_SAMPLE - 10 }, (_, i) => pass(after(i))),
      ...Array.from({ length: 10 }, (_, i) => namedBlock(after(500 + i))),
    ];
    const out = assembleGateCalibration(turns, { cohortSince: FIX });

    expect(out.sufficient).toBe(true);
    expect(out.afterFix.turns).toBe(MIN_SAMPLE);
    expect(out.afterFix.wouldBlockPct).toBe(Number(((10 / MIN_SAMPLE) * 100).toFixed(1)));
  });

  it("never calls a block rate a false-positive rate", () => {
    // Deciding whether a block was CORRECT needs human judgement. Conflating
    // the two is how a 37% block rate becomes "37% false positives".
    const turns = Array.from({ length: MIN_SAMPLE }, (_, i) => namedBlock(after(i)));
    const out = assembleGateCalibration(turns, { cohortSince: FIX });
    expect(out.caveat).toMatch(/NOT a false-positive rate/i);
    expect(out.afterFix.sample.length).toBeGreaterThan(0);
  });

  it("splits drivers so promotion cannot be decided on whichever is loudest", () => {
    const turns = [
      ...Array.from({ length: 5 }, (_, i) => namedBlock(after(i))),
      ...Array.from({ length: 9 }, (_, i) => factBlock(after(100 + i))),
      ...Array.from({ length: 3 }, (_, i) => lengthBlock(after(200 + i))),
    ];
    const out = assembleGateCalibration(turns, { cohortSince: FIX });
    expect(out.afterFix.byDriver).toEqual({ named_claim: 5, fact_check: 9, length: 3, other: 0 });
  });

  it("carries the offending names into the sample so a human can judge them", () => {
    // "TEE and Manny" — two people in conversation — survived the 2026-09-16
    // precision fix. A reviewer needs the string, not just a count.
    const turns = [namedBlock(after(1), ["TEE and Manny"])];
    const out = assembleGateCalibration(turns, { cohortSince: FIX });
    expect(out.afterFix.sample[0].unreceipted).toContain("TEE and Manny");
    expect(out.afterFix.sample[0].driver).toBe("named_claim");
  });
});

describe("assembleBufferShadow - the E3 pre-flush lane's shadow (2026-09-22)", () => {
  // `tokenUsage.evidenceGate.turnRisk` has been persisted since 8e3a4a14a
  // (2026-09-15T17:29Z) as "would the pre-flush lane have buffered this turn".
  // The promotion question is COST (share of turns that stop streaming) against
  // BENEFIT (share of verifier-banner turns that would have been repairable
  // before flush). Both are ratios; both get the module's thin-sample rule.
  const SHADOW = "2026-09-15T17:29:16.000Z";
  const shadowAt = (n: number) => new Date(Date.parse(SHADOW) + (n + 1) * 60_000);
  const preShadow = (n: number) => new Date(Date.parse(SHADOW) - (n + 1) * 60_000);
  const LOOKUP = "factual lookup with no tool expected to fire";
  const FIGURE = "invites a specific figure with no tool behind it";
  const risky = (at: Date, reasons: string[], over: Partial<GateTurn> = {}): GateTurn => ({
    createdAt: at,
    gate: { verdict: "pass", turnRisk: { buffer: true, risk: "high", register: "coaching", reasons, toolsFired: 0 } },
    excerpt: "reply",
    ...over,
  });
  const calm = (at: Date, over: Partial<GateTurn> = {}): GateTurn => ({
    createdAt: at,
    gate: { verdict: "pass", turnRisk: { buffer: false, risk: "low", register: "coaching", reasons: [], toolsFired: 0 } },
    excerpt: "reply",
    ...over,
  });
  const unshadowed = (at: Date, over: Partial<GateTurn> = {}): GateTurn => ({
    createdAt: at,
    gate: { verdict: "pass" },
    excerpt: "reply",
    ...over,
  });

  it("POSITIVE CONTROL: counts buffer vs stream and states the rate once the shadow sample clears the floor", () => {
    const turns = [
      ...Array.from({ length: 30 }, (_, i) => risky(shadowAt(i), [LOOKUP])),
      ...Array.from({ length: 10 }, (_, i) => calm(shadowAt(100 + i))),
    ];
    const out = assembleBufferShadow(turns, { since: SHADOW });
    expect(out.withShadow).toBe(MIN_SAMPLE);
    expect(out).toMatchObject({ turns: 40, wouldBuffer: 30, wouldStream: 10, wouldBufferPct: 75, sufficient: true });
  });

  it("withholds the buffer rate below the floor - counts only, never a percentage", () => {
    const out = assembleBufferShadow([risky(shadowAt(0), [LOOKUP]), calm(shadowAt(1))], { since: SHADOW });
    expect(out).toMatchObject({ withShadow: 2, wouldBuffer: 1, wouldStream: 1, wouldBufferPct: null, sufficient: false });
    expect(out.caveat).toContain(`${MIN_SAMPLE} needed`);
  });

  it("the banner recall has its OWN floor: 6 of 7 is stated as 6 of 7, never as 85.7%", () => {
    // 40 shadowed turns make the buffer rate statable; 7 banner turns do not
    // make the recall statable. The two denominators are independent.
    const turns = [
      ...Array.from({ length: 34 }, (_, i) => risky(shadowAt(i), [LOOKUP])),
      ...Array.from({ length: 6 }, (_, i) => risky(shadowAt(50 + i), [LOOKUP], { verifierBanner: true })),
      calm(shadowAt(70), { verifierBanner: true }),
    ];
    const out = assembleBufferShadow(turns, { since: SHADOW });
    expect(out.sufficient).toBe(true);
    expect(out.banner).toEqual({ turns: 7, wouldHaveBuffered: 6, wouldHaveStreamed: 1, noShadow: 0, recallPct: null });
    expect(out.caveat).toContain("6 of 7");
    expect(out.caveat).not.toContain("85.7");
  });

  it("states the recall once the banner sample itself clears the floor", () => {
    const turns = Array.from({ length: 40 }, (_, i) =>
      i < 30 ? risky(shadowAt(i), [LOOKUP], { verifierBanner: true }) : calm(shadowAt(i), { verifierBanner: true }),
    );
    const out = assembleBufferShadow(turns, { since: SHADOW });
    expect(out.banner).toMatchObject({ turns: 40, wouldHaveBuffered: 30, recallPct: 75 });
  });

  it("recall divides by the CLASSIFIED banner turns, never by the ones that carried no shadow (review on #2509)", () => {
    // 50 banner turns: 10 unshadowed, 30 buffered, 10 streamed. The lane caught 30 of the
    // 40 it classified = 75%, not 30 of 50 = 60% - a deploy gap is not a routing miss.
    const turns = [
      ...Array.from({ length: 10 }, (_, i) => unshadowed(shadowAt(i), { verifierBanner: true })),
      ...Array.from({ length: 30 }, (_, i) => risky(shadowAt(20 + i), [LOOKUP], { verifierBanner: true })),
      ...Array.from({ length: 10 }, (_, i) => calm(shadowAt(60 + i), { verifierBanner: true })),
    ];
    const out = assembleBufferShadow(turns, { since: SHADOW });
    expect(out.banner).toEqual({ turns: 50, wouldHaveBuffered: 30, wouldHaveStreamed: 10, noShadow: 10, recallPct: 75 });
    expect(out.caveat).toContain("30 of 40 classified");
    expect(out.caveat).toContain("10 banner turn(s) carried no shadow");
    expect(out.caveat).toContain("not only L6-preventable");
  });

  it("a banner turn the shadow never classified is counted as noShadow, not as a miss", () => {
    const out = assembleBufferShadow([unshadowed(shadowAt(0), { verifierBanner: true })], { since: SHADOW });
    expect(out.banner).toMatchObject({ turns: 1, wouldHaveBuffered: 0, wouldHaveStreamed: 0, noShadow: 1 });
  });

  it("cohorts at the shadow's first write - a pre-shadow banner turn is not evidence of a silent instrument", () => {
    const out = assembleBufferShadow(
      [unshadowed(preShadow(0), { verifierBanner: true }), risky(shadowAt(0), [LOOKUP])],
      { since: SHADOW },
    );
    expect(out.turns).toBe(1);
    expect(out.banner.noShadow).toBe(0);
  });

  it("splits buffered turns by reason, once per turn, with the banner sub-count alongside", () => {
    const turns = [
      risky(shadowAt(0), [LOOKUP, LOOKUP], { verifierBanner: true }),
      risky(shadowAt(1), [LOOKUP, FIGURE]),
      risky(shadowAt(2), [FIGURE]),
      calm(shadowAt(3), { verifierBanner: true }),
    ];
    const out = assembleBufferShadow(turns, { since: SHADOW });
    expect(out.byReason).toEqual([
      { reason: LOOKUP, buffered: 2, bannered: 1 },
      { reason: FIGURE, buffered: 2, bannered: 0 },
    ]);
    // The top row is named in the caveat with BOTH fractions, so a reader can
    // see whether the reason that buffers most turns is also the one carrying
    // the banners. Measured 2026-09-22 on prod: 77/84 and 6/6 - it does not
    // separate, so "narrow the predicate to its reasons" is not available.
    expect(out.caveat).toContain(`"${LOOKUP}"`);
    expect(out.caveat).toContain("2/3 buffered turns");
    expect(out.caveat).toContain("1/1 buffered banner turns");
  });

  it("rides along on assembleGateCalibration; the gate cohorts and the shadow cohort are independent", () => {
    const turns = [pass(after(0)), risky(shadowAt(0), [LOOKUP])];
    const out = assembleGateCalibration(turns, { cohortSince: FIX });
    expect(out.beforeFix.turns).toBe(1);
    expect(out.afterFix.turns).toBe(1);
    expect(out.bufferShadow.since).toBe(BUFFER_SHADOW_SINCE);
    expect(out.bufferShadow).toMatchObject({ turns: 2, withShadow: 1, wouldBuffer: 1 });
  });
});
