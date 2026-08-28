/**
 * Canaries for the AI-disclosure gate — a trust boundary, so presence
 * assertions are worthless here. Every arm below DRIVES the real
 * `assessDisclosure` with a planted pack and asserts on the verdict.
 *
 * Structure, deliberate: each rule gets a POSITIVE control (a violating pack
 * that must fail, naming the specific code) AND a negative control (the nearest
 * compliant pack, which must pass). Without the second half a gate that simply
 * refuses everything scores identically to a working one.
 */
import { describe, it, expect } from "vitest";
import {
  assessDisclosure,
  assertDisclosureCompliant,
  realEvidenceClaims,
  type ReelPack,
} from "./disclosureGate";

/** A real-footage repair pack — the baseline compliant case. */
const REAL_REPAIR: ReelPack = {
  id: "real-repair",
  title: "Brake job, uncut",
  framing: "repair",
  caption: "We pulled this rotor off a customer car this morning.",
  scenes: [
    { id: "s1", source: "real", description: "rotor on the lift" },
    { id: "s2", source: "real", description: "new rotor installed" },
  ],
};

/** A disclosed synthetic explainer — the other compliant case. */
const DISCLOSED_EXPLAINER: ReelPack = {
  id: "syn-explainer",
  title: "How a belt separation forms",
  framing: "explainer",
  caption: "Animation: what happens inside a tire when the belts let go.",
  aiDisclosure: true,
  scenes: [
    { id: "s1", source: "ai", description: "cutaway animation" },
    { id: "s2", source: "graphic", description: "title card" },
  ],
};

describe("compliant packs pass (negative control — a gate that fails everything is not a gate)", () => {
  it("real footage under a real-evidence framing passes", () => {
    const v = assessDisclosure(REAL_REPAIR);
    expect(v.violations).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.requiresDisclosure).toBe(false);
  });

  it("disclosed synthetic footage under an explainer framing passes", () => {
    const v = assessDisclosure(DISCLOSED_EXPLAINER);
    expect(v.violations).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.requiresDisclosure).toBe(true);
    expect(v.syntheticScenes).toEqual(["s1"]);
  });

  it("assertDisclosureCompliant does not throw on a compliant pack", () => {
    expect(() => assertDisclosureCompliant(REAL_REPAIR)).not.toThrow();
  });
});

describe("THE RULE: AI footage may never carry a real-evidence framing", () => {
  it("FIRES: an AI scene inside a 'repair' pack", () => {
    const v = assessDisclosure({
      ...REAL_REPAIR,
      id: "violating-repair",
      aiDisclosure: true, // disclosed, and STILL a violation — disclosure does not license the claim
      scenes: [
        { id: "s1", source: "real" },
        { id: "s2", source: "ai" },
      ],
    });
    expect(v.ok).toBe(false);
    expect(v.violations.map((x) => x.code)).toContain("AI_PRESENTED_AS_REAL");
    // The message must name the offending scene, or a reviewer cannot act on it.
    expect(v.violations.find((x) => x.code === "AI_PRESENTED_AS_REAL")?.detail).toContain("s2");
  });

  it.each(["customer_incident", "repair", "test", "before_after", "diagnosis"] as const)(
    "FIRES on every real-evidence framing: %s",
    (framing) => {
      const v = assessDisclosure({
        id: `f-${framing}`,
        title: "t",
        framing,
        aiDisclosure: true,
        scenes: [{ id: "s1", source: "ai" }],
      });
      expect(v.violations.map((x) => x.code)).toContain("AI_PRESENTED_AS_REAL");
    },
  );

  it("SPARES explainer/entertainment/promotion framings", () => {
    for (const framing of ["explainer", "entertainment", "promotion"] as const) {
      const v = assessDisclosure({
        id: `ok-${framing}`,
        title: "t",
        framing,
        aiDisclosure: true,
        scenes: [{ id: "s1", source: "ai" }],
      });
      expect(v.violations.map((x) => x.code)).not.toContain("AI_PRESENTED_AS_REAL");
    }
  });

  it("assertDisclosureCompliant THROWS and names the code", () => {
    expect(() =>
      assertDisclosureCompliant({
        id: "boom",
        title: "t",
        framing: "before_after",
        aiDisclosure: true,
        scenes: [{ id: "s1", source: "ai" }],
      }),
    ).toThrow(/AI_PRESENTED_AS_REAL/);
  });
});

describe("BYPASS 1 · relabelling — the framing field says entertainment, the caption says testimony", () => {
  it("FIRES on caption text asserting real evidence over synthetic footage", () => {
    const v = assessDisclosure({
      id: "relabelled",
      title: "Tire failure",
      framing: "entertainment", // relabelled to dodge the framing rule
      aiDisclosure: true,
      caption: "This customer came in with the belts already separating.",
      scenes: [{ id: "s1", source: "ai" }],
    });
    expect(v.ok).toBe(false);
    expect(v.violations.map((x) => x.code)).toContain("TEXT_CLAIMS_REAL_EVIDENCE");
  });

  it("SPARES a generic explainer caption with the same footage", () => {
    const v = assessDisclosure({
      id: "generic",
      title: "Tire failure",
      framing: "entertainment",
      aiDisclosure: true,
      caption: "Belt separation is what happens when a tire runs underinflated for months.",
      scenes: [{ id: "s1", source: "ai" }],
    });
    expect(v.violations.map((x) => x.code)).not.toContain("TEXT_CLAIMS_REAL_EVIDENCE");
    expect(v.ok).toBe(true);
  });

  it("the phrase matcher itself sees the claims (positive control on the matcher)", () => {
    // If this regressed to matching nothing, every arm above would pass vacuously.
    expect(realEvidenceClaims("This customer came in yesterday").length).toBeGreaterThan(0);
    expect(realEvidenceClaims("We pulled it off the lift").length).toBeGreaterThan(0);
    expect(realEvidenceClaims("Brake pads wear out over time.")).toEqual([]);
  });

  it("does NOT flag real-evidence text when the footage is real", () => {
    // The claim is true here, so the gate must stay silent — otherwise it blocks
    // exactly the honest shop-floor content the account needs most.
    const v = assessDisclosure(REAL_REPAIR);
    expect(v.violations.map((x) => x.code)).not.toContain("TEXT_CLAIMS_REAL_EVIDENCE");
  });
});

describe("BYPASS 2 · omission — an undeclared source cannot back a real claim", () => {
  it("FIRES when a scene declares no source under a real-evidence framing", () => {
    const v = assessDisclosure({
      id: "omitted",
      title: "t",
      framing: "diagnosis",
      scenes: [{ id: "s1", source: "real" }, { id: "s2" }],
    });
    expect(v.ok).toBe(false);
    expect(v.violations.map((x) => x.code)).toContain("UNDECLARED_SCENE_SOURCE");
    expect(v.violations.find((x) => x.code === "UNDECLARED_SCENE_SOURCE")?.detail).toContain("s2");
  });

  it("an unrecognised source string is treated as unknown, not waved through", () => {
    const v = assessDisclosure({
      id: "bogus",
      title: "t",
      framing: "repair",
      // A typo or an invented value must fail closed rather than pass as 'real'.
      scenes: [{ id: "s1", source: "reall" as never }],
    });
    expect(v.violations.map((x) => x.code)).toContain("UNDECLARED_SCENE_SOURCE");
  });

  it("an empty pack cannot pass", () => {
    const v = assessDisclosure({ id: "empty", title: "t", framing: "explainer", scenes: [] });
    expect(v.ok).toBe(false);
    expect(v.violations.map((x) => x.code)).toEqual(["EMPTY_PACK"]);
  });
});

describe("BYPASS 3 · partial honesty — disclosure is evaluated over every scene", () => {
  it("FIRES when synthetic footage carries no disclosure", () => {
    const v = assessDisclosure({
      id: "undisclosed",
      title: "t",
      framing: "explainer",
      scenes: [{ id: "s1", source: "real" }, { id: "s2", source: "ai" }],
    });
    expect(v.violations.map((x) => x.code)).toContain("MISSING_AI_DISCLOSURE");
  });

  it("a hybrid scene counts as synthetic", () => {
    const v = assessDisclosure({
      id: "hybrid",
      title: "t",
      framing: "explainer",
      scenes: [{ id: "s1", source: "hybrid" }],
    });
    expect(v.requiresDisclosure).toBe(true);
    expect(v.violations.map((x) => x.code)).toContain("MISSING_AI_DISCLOSURE");
  });

  it("aiDisclosure must be exactly true — truthy is not enough", () => {
    const v = assessDisclosure({
      id: "truthy",
      title: "t",
      framing: "explainer",
      aiDisclosure: "yes" as never,
      scenes: [{ id: "s1", source: "ai" }],
    });
    expect(v.violations.map((x) => x.code)).toContain("MISSING_AI_DISCLOSURE");
  });

  it("stock and graphic footage do NOT require an AI disclosure", () => {
    const v = assessDisclosure({
      id: "stock",
      title: "t",
      framing: "explainer",
      scenes: [{ id: "s1", source: "stock" }, { id: "s2", source: "graphic" }],
    });
    expect(v.requiresDisclosure).toBe(false);
    expect(v.ok).toBe(true);
  });
});

describe("the catalog's own synthetic concepts are gate-compliant by construction", () => {
  it("no catalog concept pairs synthetic production with a real-evidence framing", async () => {
    // The catalog and the gate must agree, or the first synthetic pack built
    // from a catalog row fails at publish time instead of at authoring time.
    const { CONCEPTS } = await import("./conceptCatalog");
    const offenders = CONCEPTS.filter(
      (c) =>
        c.productionType !== "real" &&
        ["customer_incident", "repair", "test", "before_after", "diagnosis"].includes(c.framing),
    ).map((c) => c.id);
    expect(offenders).toEqual([]);
  });
});
