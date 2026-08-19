/**
 * Honest confidence rendering · 2026-08-19 (Brain wave 2).
 *
 * confidence is a re-sighting counter (0.5 + 0.1×(n−1), capped at 1.0 —
 * memory-manager.ts:540), NOT a probability. Three operator surfaces
 * printed it as `NN%`, and two of them printed it directly beside the
 * sighting count — the same number twice, one copy lying. These pin the
 * inversion so the percentage cannot come back.
 */

import { describe, it, expect } from "vitest";
import {
  CEILING_SIGHTINGS,
  attentionTone,
  describeConfidenceAsAttention,
  describeSeenCount,
  sightingsFromConfidence,
} from "@/lib/brain/attention-label";

describe("sightingsFromConfidence", () => {
  it("inverts the forward formula exactly", () => {
    // forward: 0.5 + 0.1*(n-1)
    for (let n = 1; n <= 6; n++) {
      const confidence = 0.5 + 0.1 * (n - 1);
      expect(sightingsFromConfidence(confidence)).toBe(n);
    }
  });

  it("never returns less than one sighting", () => {
    expect(sightingsFromConfidence(0)).toBe(1);
    expect(sightingsFromConfidence(0.3)).toBe(1);
  });

  it("maps the 1.0 ceiling to the implied 6 sightings", () => {
    expect(sightingsFromConfidence(1.0)).toBe(CEILING_SIGHTINGS);
    expect(CEILING_SIGHTINGS).toBe(6);
  });
});

describe("describeConfidenceAsAttention", () => {
  it("never renders a percentage", () => {
    for (const c of [0.5, 0.6, 0.75, 0.9, 1.0]) {
      expect(describeConfidenceAsAttention(c)).not.toContain("%");
    }
  });

  it("says seen ~N× below the cap", () => {
    expect(describeConfidenceAsAttention(0.7)).toBe("seen ~3×");
  });

  it("flags the ceiling instead of implying certainty", () => {
    // 1.0 must NOT read as "100%" or "certain" — sightings past 6 are
    // indistinguishable, so the label says so.
    expect(describeConfidenceAsAttention(1.0)).toBe("seen 6×+");
  });
});

describe("describeSeenCount", () => {
  it("prefers the real column, which keeps counting past the cap", () => {
    expect(describeSeenCount(6516)).toBe("seen 6,516×");
    expect(describeSeenCount(1)).toBe("seen once");
    expect(describeSeenCount(0)).toBe("never seen");
  });
});

describe("attentionTone", () => {
  it("does not encode a truth ramp — quiet is not bad", () => {
    expect(attentionTone(1)).toBe("quiet");
    expect(attentionTone(3)).toBe("warm");
    expect(attentionTone(9)).toBe("hot");
  });
});

/**
 * Pipeline-status honesty · the mirror of the fail-open defect.
 *
 * gateUnreachable drives alarming copy ("none has ever been promotable ·
 * this queue cannot fill"). It is computed from four reads, any of which
 * can reject. `promotable` falls back to 0 when statusCounts is null — so
 * WITHOUT an explicit null-guard a failed status query would flip the flag
 * true and assert a structural dead end from missing data. Asserting
 * health from a failed read and asserting alarm from a failed read are
 * the same lie; both are barred.
 */
describe("pipeline-status gateUnreachable", () => {
  // Mirrors app/api/knowledge/pipeline-status/route.ts
  const STRONG = 0.75;
  const gateUnreachable = (
    statusCounts: Array<{ status: string; count: number }> | null,
    bestScore: number | null,
    totalClaims: number | null,
  ) => {
    const promotable = statusCounts?.find((s) => s.status === "source_supported")?.count ?? 0;
    return (
      statusCounts !== null &&
      bestScore !== null &&
      totalClaims !== null &&
      totalClaims > 0 &&
      promotable === 0 &&
      bestScore < STRONG
    );
  };

  it("fires on the real prod shape: many claims, none promotable, best below the gate", () => {
    expect(
      gateUnreachable(
        [
          { status: "unverified", count: 876 },
          { status: "weak_support", count: 17 },
        ],
        0.58,
        893,
      ),
    ).toBe(true);
  });

  it("NEVER fires when the status read failed — that is unknown, not a dead end", () => {
    expect(gateUnreachable(null, 0.58, 893)).toBe(false);
  });

  it("never fires when the score or total read failed", () => {
    expect(gateUnreachable([{ status: "unverified", count: 5 }], null, 893)).toBe(false);
    expect(gateUnreachable([{ status: "unverified", count: 5 }], 0.58, null)).toBe(false);
  });

  it("never fires on an empty corpus — nothing ingested is not a dead end", () => {
    expect(gateUnreachable([], 0.58, 0)).toBe(false);
  });

  it("never fires once something actually clears the gate", () => {
    expect(
      gateUnreachable([{ status: "source_supported", count: 1 }], 0.81, 100),
    ).toBe(false);
  });
});
