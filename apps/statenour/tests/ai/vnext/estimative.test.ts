/**
 * BDN-302 · estimative-language reader regression armor.
 *
 * The load-bearing property under test is SEPARATION: likelihood and
 * confidence must never contaminate each other. Every other assertion
 * here is in service of that one.
 */

import { describe, expect, it } from "vitest";
import {
  ESTIMATIVE_BANDS,
  brierScore,
  parseEstimative,
  summarizeEstimativeCompliance,
} from "@/lib/ai/vnext/truth/estimative";

describe("estimative · band matching order", () => {
  it("matches 'very unlikely' as its own band, not as 'unlikely'", () => {
    const r = parseEstimative("That outcome is very unlikely given the trend.");
    expect(r.band?.label).toBe("very unlikely");
    expect(r.likelihood).toBeCloseTo(0.125, 5);
  });

  it("matches 'almost certain' rather than falling through to a shorter band", () => {
    const r = parseEstimative("Almost certain the invoice already cleared.");
    expect(r.band?.label).toBe("almost certain");
    expect(r.likelihood).toBeCloseTo(0.97, 5);
  });

  it("matches 'roughly even chance' ahead of 'even chance'", () => {
    const r = parseEstimative("Roughly even chance he reschedules.");
    expect(r.band?.label).toBe("roughly even chance");
  });

  it("keeps every multi-word band ahead of the shorter band it contains", () => {
    // Guards the BDN-103 failure class: an unordered scan would let a
    // short label swallow its longer superstring.
    const labels = ESTIMATIVE_BANDS.map((b) => b.label);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        // If a LATER label contains an EARLIER one, the earlier would
        // win first and shadow it. That is the bug.
        expect(labels[j].includes(labels[i])).toBe(false);
      }
    }
  });
});

describe("estimative · likelihood precedence", () => {
  it("prefers an explicit percentage over a band midpoint", () => {
    const r = parseEstimative("Likely — call it 62% based on the last 3 weeks.");
    expect(r.likelihood).toBeCloseTo(0.62, 5);
    expect(r.explicitPercent).toBe(true);
    expect(r.band?.label).toBe("likely");
  });

  it("falls back to the band midpoint when no number was written", () => {
    const r = parseEstimative("Probable, but I'd want another week of data.");
    expect(r.explicitPercent).toBe(false);
    expect(r.likelihood).toBeCloseTo(0.675, 5);
  });

  it("returns null likelihood when the text states no estimate at all", () => {
    const r = parseEstimative("Revenue was 41,200 last month.");
    expect(r.likelihood).toBeNull();
    expect(r.band).toBeNull();
  });

  it("rejects an out-of-range percentage rather than clamping it", () => {
    const r = parseEstimative("There's a 140% chance, obviously.");
    expect(r.likelihood).toBeNull();
  });

  it("does NOT read a business metric as a forecast", () => {
    // Self-review catch: Nick's replies are full of percentages that are
    // measurements, not probabilities. Feeding these to the Brier would
    // produce a legitimate-looking but meaningless calibration score.
    for (const metric of [
      "Revenue up 12% last month.",
      "Margin held at 34% across both bays.",
      "Utilization is 88% this week.",
    ]) {
      const r = parseEstimative(metric);
      expect(r.likelihood).toBeNull();
      expect(r.explicitPercent).toBe(false);
    }
  });

  it("still reads a percentage when the sentence is actually forecasting", () => {
    expect(parseEstimative("I'd put the odds at 35%.").likelihood).toBeCloseTo(0.35, 5);
    expect(parseEstimative("Maybe a 20% chance he calls back.").likelihood).toBeCloseTo(0.2, 5);
  });

  it("reads a tagged percentage without needing a cue word", () => {
    // The tag IS the declaration — it needs no surrounding prose.
    const r = parseEstimative("Bay 5 clears Friday. [~40% · conf: low]");
    expect(r.likelihood).toBeCloseTo(0.4, 5);
  });
});

describe("estimative · the compact tag", () => {
  it("reads likelihood and confidence out of the tail tag", () => {
    const r = parseEstimative("He churns before renewal. [~30% · conf: high]");
    expect(r.tagged).toBe(true);
    expect(r.likelihood).toBeCloseTo(0.3, 5);
    expect(r.confidence).toBe("high");
  });

  it("accepts permissive separators and the 'confidence' long form", () => {
    const r = parseEstimative("Call it. [45%, confidence: low]");
    expect(r.tagged).toBe(true);
    expect(r.likelihood).toBeCloseTo(0.45, 5);
    expect(r.confidence).toBe("low");
  });

  it("normalizes 'medium' to 'moderate' instead of dropping the row", () => {
    const r = parseEstimative("Worth a shot. [~55% · conf: medium]");
    expect(r.confidence).toBe("moderate");
  });
});

describe("estimative · SEPARATION (the load-bearing property)", () => {
  it("permits high confidence on a low-likelihood call", () => {
    const r = parseEstimative(
      "He does not take the deal. [~20% · conf: high] Three prior refusals on identical terms.",
    );
    expect(r.likelihood).toBeCloseTo(0.2, 5);
    expect(r.confidence).toBe("high");
  });

  it("permits low confidence on a high-likelihood call", () => {
    const r = parseEstimative("Very likely. Confidence: low — one data point.");
    expect(r.likelihood).toBeCloseTo(0.875, 5);
    expect(r.confidence).toBe("low");
  });

  it("never lets confidence supply a likelihood", () => {
    const r = parseEstimative("High confidence in the read.");
    expect(r.confidence).toBe("high");
    expect(r.likelihood).toBeNull();
  });
});

describe("estimative · bare hedge detection (the compliance signal)", () => {
  it("flags the pre-BDN-302 hedge shape", () => {
    const r = parseEstimative("Best guess: he pushes the appointment.");
    expect(r.bareHedge).toBe(true);
    expect(r.likelihood).toBeNull();
  });

  it("does NOT flag a hedge that also carries a band", () => {
    const r = parseEstimative("Best guess: unlikely he pushes it.");
    expect(r.bareHedge).toBe(false);
    expect(r.likelihood).toBeCloseTo(0.325, 5);
  });

  it("does not flag a plain factual answer", () => {
    expect(parseEstimative("Four tasks are open.").bareHedge).toBe(false);
  });
});

describe("estimative · Brier", () => {
  it("scores a confident hit near zero", () => {
    expect(brierScore(0.9, true)).toBeCloseTo(0.01, 5);
  });

  it("punishes a confident miss", () => {
    expect(brierScore(0.9, false)).toBeCloseTo(0.81, 5);
  });

  it("returns null — not zero — when there is nothing to grade", () => {
    // BDN-105 lesson: dropping ungraded rows silently makes a process
    // that never ran look adequately sampled.
    expect(brierScore(null, true)).toBeNull();
    expect(brierScore(0.5, null)).toBeNull();
  });
});

describe("estimative · compliance census", () => {
  it("counts likelihood, confidence, tags and bare hedges separately", () => {
    const s = summarizeEstimativeCompliance([
      "He renews. [~70% · conf: moderate]",
      "Very likely, confidence: low.",
      "Best guess: no.",
      "Revenue was 41,200.",
    ]);
    expect(s.total).toBe(4);
    expect(s.withLikelihood).toBe(2);
    expect(s.withConfidence).toBe(2);
    expect(s.tagged).toBe(1);
    expect(s.bareHedges).toBe(1);
  });

  it("reports an empty batch without dividing by zero", () => {
    expect(summarizeEstimativeCompliance([]).total).toBe(0);
  });
});
