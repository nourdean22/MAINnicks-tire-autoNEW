/**
 * situation-synthesizer.test.ts
 *
 * Pure-logic unit tests for the HQ Situation card's synthesizer.
 * Zero DB dependencies — the synthesizer takes pre-fetched streams
 * + counts and returns the ranked + deduplicated payload.
 *
 * Run: npm test (vitest)
 */

import { describe, it, expect } from "vitest";
import {
  rankCandidate,
  dedupeCandidates,
  synthesizeSituation,
  type SituationCandidate,
} from "@/lib/ultron/situation-synthesizer";

const emptyCounts = {
  blindSpots: 0,
  activeBets: 0,
  agingBeliefs: 0,
  stalePins: 0,
  openRuminations: 0,
  reflectionsToday: 0,
};

const c = (
  partial: Partial<SituationCandidate> & { headline: string }
): SituationCandidate => ({
  source: "momentum",
  severity: "low",
  ...partial,
});

describe("rankCandidate", () => {
  it("puts critical before high before medium before low", () => {
    const a = c({ headline: "a", severity: "critical" });
    const b = c({ headline: "b", severity: "high" });
    const d = c({ headline: "d", severity: "low" });
    expect(rankCandidate(a)).toBeLessThan(rankCandidate(b));
    expect(rankCandidate(b)).toBeLessThan(rankCandidate(d));
  });

  it("puts wins after other severities — they shouldn't eclipse critical", () => {
    const win = c({ headline: "win", severity: "win", source: "momentum" });
    const crit = c({ headline: "crit", severity: "critical", source: "blind_spot" });
    expect(rankCandidate(crit)).toBeLessThan(rankCandidate(win));
  });

  it("blind_spot source beats narrator source at same severity", () => {
    const b = c({ headline: "b", severity: "medium", source: "blind_spot" });
    const n = c({ headline: "n", severity: "medium", source: "narrator" });
    expect(rankCandidate(b)).toBeLessThan(rankCandidate(n));
  });

  it("age decay slips stale medium items below fresh medium items", () => {
    const fresh = c({ headline: "fresh", severity: "medium", ageDays: 0, source: "blind_spot" });
    const stale = c({ headline: "stale", severity: "medium", ageDays: 90, source: "blind_spot" });
    expect(rankCandidate(fresh)).toBeLessThan(rankCandidate(stale));
  });

  it("does NOT apply age decay to critical severity", () => {
    const oldCrit = c({
      headline: "old-crit",
      severity: "critical",
      ageDays: 365,
      source: "blind_spot",
    });
    const freshCrit = c({
      headline: "fresh-crit",
      severity: "critical",
      ageDays: 0,
      source: "blind_spot",
    });
    expect(rankCandidate(oldCrit)).toEqual(rankCandidate(freshCrit));
  });
});

describe("dedupeCandidates", () => {
  it("keeps the higher-ranked of two candidates sharing tokens + domain", () => {
    const a: SituationCandidate = c({
      headline: "stale leads going cold",
      severity: "high",
      source: "blind_spot",
      domain: "lead",
      dedupeTokens: ["leads", "cold"],
    });
    const b: SituationCandidate = c({
      headline: "outreach dropping on cold leads",
      severity: "medium",
      source: "narrator",
      domain: "lead",
      dedupeTokens: ["leads", "cold"],
    });
    const { kept, dropped } = dedupeCandidates([a, b]);
    expect(kept).toHaveLength(1);
    expect(kept[0].headline).toBe("stale leads going cold");
    expect(dropped).toHaveLength(1);
    expect(dropped[0].headline).toBe("outreach dropping on cold leads");
  });

  it("keeps both when domains differ even if tokens overlap", () => {
    const a: SituationCandidate = c({
      headline: "leads cold",
      severity: "medium",
      source: "blind_spot",
      domain: "lead",
      dedupeTokens: ["cold"],
    });
    const b: SituationCandidate = c({
      headline: "body cold (gym skip)",
      severity: "medium",
      source: "blind_spot",
      domain: "body",
      dedupeTokens: ["cold"],
    });
    const { kept } = dedupeCandidates([a, b]);
    expect(kept).toHaveLength(2);
  });

  it("keeps all when no tokens provided", () => {
    const a = c({ headline: "a", severity: "medium" });
    const b = c({ headline: "b", severity: "medium" });
    const { kept, dropped } = dedupeCandidates([a, b]);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });
});

describe("synthesizeSituation", () => {
  it("returns null primary + 5 monitors when given no candidates", () => {
    const r = synthesizeSituation({
      candidates: [],
      autoResolved: [],
      counts: emptyCounts,
    });
    expect(r.primary).toBeNull();
    expect(r.secondaries).toHaveLength(0);
    expect(r.monitors.length).toBeGreaterThanOrEqual(4);
  });

  it("picks the highest-severity candidate as primary", () => {
    const r = synthesizeSituation({
      candidates: [
        c({ headline: "low", severity: "low" }),
        c({ headline: "crit", severity: "critical", source: "blind_spot" }),
        c({ headline: "med", severity: "medium" }),
      ],
      autoResolved: [],
      counts: emptyCounts,
    });
    expect(r.primary?.headline).toBe("crit");
  });

  it("puts second and third candidates into secondaries (max 2)", () => {
    const r = synthesizeSituation({
      candidates: [
        c({ headline: "a", severity: "critical", source: "blind_spot" }),
        c({ headline: "b", severity: "high" }),
        c({ headline: "c", severity: "medium" }),
        c({ headline: "d", severity: "low" }),
      ],
      autoResolved: [],
      counts: emptyCounts,
    });
    expect(r.primary?.headline).toBe("a");
    expect(r.secondaries).toHaveLength(2);
    expect(r.secondaries[0].headline).toBe("b");
    expect(r.secondaries[1].headline).toBe("c");
  });

  it("counts noise correctly (old-stack 7 cards minus what we kept)", () => {
    const r = synthesizeSituation({
      candidates: [c({ headline: "only one", severity: "high" })],
      autoResolved: [],
      counts: emptyCounts,
    });
    expect(r.noiseReduced).toBe(6);
  });

  it("blind-spots monitor flips to alert tone at 5+", () => {
    const r = synthesizeSituation({
      candidates: [],
      autoResolved: [],
      counts: { ...emptyCounts, blindSpots: 6 },
    });
    const watch = r.monitors.find((m) => m.id === "blind-spots");
    expect(watch?.tone).toBe("alert");
  });

  it("bet-hit monitor shows win tone at 60%+", () => {
    const r = synthesizeSituation({
      candidates: [],
      autoResolved: [],
      counts: emptyCounts,
      ambientRates: { betHitRatePct: 75 },
    });
    const bet = r.monitors.find((m) => m.id === "bet-hit");
    expect(bet?.tone).toBe("win");
    expect(bet?.value).toBe("75%");
  });

  it("surfaces auto-resolved rows distinct from regular candidates", () => {
    const r = synthesizeSituation({
      candidates: [c({ headline: "live", severity: "high" })],
      autoResolved: [c({ headline: "cron ran overnight", severity: "low", autoResolved: true })],
      counts: emptyCounts,
    });
    expect(r.autoResolved).toHaveLength(1);
    expect(r.autoResolved[0].headline).toBe("cron ran overnight");
  });

  // May 02 · v10.0.147 · two new SignalZone sources
  it("ranks forecast source between calibration and reflection (same severity ladder)", () => {
    const fc = c({ headline: "fc", severity: "low", source: "forecast" });
    const cal = c({ headline: "cal", severity: "low", source: "calibration" });
    // forecast and calibration share the same source weight (4), so
    // their ranks should match at the same severity.
    expect(rankCandidate(fc)).toBe(rankCandidate(cal));
  });

  it("ranks brain_growth softer than blind_spot at same severity", () => {
    const bg = c({ headline: "bg", severity: "low", source: "brain_growth" });
    const bs = c({ headline: "bs", severity: "low", source: "blind_spot" });
    expect(rankCandidate(bs)).toBeLessThan(rankCandidate(bg));
  });

  it("forecast win does not eclipse a critical blind-spot", () => {
    const r = synthesizeSituation({
      candidates: [
        c({ headline: "fc-win", severity: "win", source: "forecast" }),
        c({ headline: "blind", severity: "critical", source: "blind_spot" }),
      ],
      autoResolved: [],
      counts: emptyCounts,
    });
    expect(r.primary?.headline).toBe("blind");
  });

  it("brain_growth + forecast both surface as secondaries when nothing critical is present", () => {
    const r = synthesizeSituation({
      candidates: [
        c({ headline: "fc", severity: "low", source: "forecast" }),
        c({ headline: "bg", severity: "win", source: "brain_growth" }),
      ],
      autoResolved: [],
      counts: emptyCounts,
    });
    // win has the lowest severity rank; forecast (low) wins primary,
    // brain_growth (win) lands in secondaries.
    expect(r.primary?.headline).toBe("fc");
    expect(r.secondaries.map((s) => s.headline)).toContain("bg");
  });

  it("dedup: blind-spot + narrator on same domain collapse, but the dropped count lifts noiseReduced", () => {
    const r = synthesizeSituation({
      candidates: [
        c({
          headline: "blindspot: stale leads",
          severity: "critical",
          source: "blind_spot",
          domain: "lead",
          dedupeTokens: ["leads"],
        }),
        c({
          headline: "coach: outreach dropping",
          severity: "high",
          source: "narrator",
          domain: "lead",
          dedupeTokens: ["leads"],
        }),
      ],
      autoResolved: [],
      counts: emptyCounts,
    });
    expect(r.primary?.headline).toContain("blindspot");
    expect(r.secondaries).toHaveLength(0);
    // Old cards (7) minus 1 kept + 1 dropped from dedup = 7
    expect(r.noiseReduced).toBeGreaterThanOrEqual(6);
  });
});
