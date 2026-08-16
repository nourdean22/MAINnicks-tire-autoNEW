/**
 * Provenance labels · lib/brain/contextual-recall.ts (2026-08-16).
 *
 * These exist because the FIRST version of this feature shipped a lie. It
 * rendered the gateway's `weak_inference` class as the word "unverified" —
 * but that class is the ladder's FALLBACK for any source string it does not
 * recognize, and `evidenceClassForSource` matches operator sources by three
 * EXACT equality checks (user / manual / skill_ingestion), not by prefix.
 *
 * So real operator-authored writers landed in it:
 *   · `source: "operator"` — app/api/relationships/log-outreach/route.ts,
 *     lib/media/media-moment.ts (whose own comment calls that source
 *     "load-bearing, not decoration")
 *   · `source: "pin:chat"` / `"pin:manual"` — lib/services/pins.ts, i.e. the
 *     memories the operator EXPLICITLY pinned
 *
 * Every one of those would have been announced to the model as "unverified",
 * on every chat turn, with no flag gating it. That is the same overclaim this
 * change set exists to remove, pointed the other way: asserting a check had
 * run and failed, when no check ran at all.
 *
 * The rule these tests encode: a label may report what the ladder KNOWS. It
 * may not assert a verification outcome the system never computed.
 */
import { describe, it, expect } from "vitest";
import { provenancePrefix } from "@/lib/brain/contextual-recall";
import { evidenceClassForSource } from "@/lib/brain/memory-commit-gateway";

const mem = (source: string, seenCount = 1) => ({
  category: "relationships_outreach",
  content: "x",
  confidence: 1,
  relevance: "direct" as const,
  source,
  seenCount,
});

describe("provenancePrefix", () => {
  it("never calls an unrecognized source 'unverified'", () => {
    // The regression, stated as a test. "operator" and "pin:*" are real
    // writers that the ladder does not classify.
    for (const source of ["operator", "pin:chat", "pin:manual", "auto_pin:blindspot"]) {
      expect(evidenceClassForSource(source)).toBe("weak_inference");
      expect(provenancePrefix(mem(source))).not.toContain("unverified");
    }
  });

  it("admits ignorance instead — 'unclassified'", () => {
    expect(provenancePrefix(mem("operator"))).toContain("unclassified");
  });

  it("labels a genuinely operator-stated source as such", () => {
    expect(provenancePrefix(mem("manual"))).toContain("you stated");
    expect(provenancePrefix(mem("user"))).toContain("you stated");
  });

  it("distinguishes a machine inference from an operator statement — the whole point", () => {
    const inference = provenancePrefix(mem("blind-spot-insight"));
    const stated = provenancePrefix(mem("manual"));
    expect(inference).toContain("inferred");
    expect(inference).not.toEqual(stated);
  });

  it("carries the category and the sighting count", () => {
    const out = provenancePrefix(mem("manual", 4));
    expect(out).toContain("relationships_outreach");
    expect(out).toContain("seen 4x");
  });

  it("omits the sighting count when a memory has been seen once", () => {
    // confidence IS 0.5 + 0.1*(sightings-1), so "seen 1x" would be noise.
    expect(provenancePrefix(mem("manual", 1))).not.toContain("seen");
  });

  it("does not throw when source/seenCount are missing", () => {
    // Lexical-union rows synthesize these; they must degrade, not crash.
    expect(() =>
      provenancePrefix({
        category: "pattern",
        content: "x",
        confidence: 0.5,
        relevance: "background",
      }),
    ).not.toThrow();
  });

  it("never renders a confidence percentage — it was a frequency count wearing a certainty costume", () => {
    expect(provenancePrefix(mem("manual", 6))).not.toMatch(/\d+%/);
  });
});
