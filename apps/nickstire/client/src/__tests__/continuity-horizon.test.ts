/**
 * Continuity QA + horizon derivation.
 *
 * Both exist to catch failures that pass every other gate: an episode whose
 * narrator grew a body is not unsafe or unspellable, it is just wrong for this
 * universe — and a snapshot compared against the wrong horizon produces a
 * confident number nobody can challenge.
 */
import { describe, it, expect } from "vitest";
import { runContinuityQa, continuityBlocks } from "../../../shared/contentContinuityQa";
import { horizonForSnapshot } from "../../../shared/contentExperiments";

const hoursAfter = (base: Date, h: number) => new Date(base.getTime() + h * 3_600_000);
const PUB = new Date("2026-07-31T12:00:00Z");

describe("continuity QA — the narrator must never grow a body", () => {
  it("BLOCKS a design that gives NICK-01 a physical form", () => {
    // "digital mechanic in a uniform" is what every model reaches for, and it
    // would also trip the faceless gate at render — this catches it before spend.
    const f = runContinuityQa({
      cast: ["nick_01"],
      designTexts: ["NICK-01 in a black and gold uniform, visor down, standing over the bay"],
    });
    expect(continuityBlocks(f).some((x) => x.rule === "narrator-embodied")).toBe(true);
  });

  it("passes NICK-01 rendered as light and motion", () => {
    const f = runContinuityQa({
      cast: ["nick_01"],
      designTexts: ["a narrow warm brushed gold scanning beam sweeps the tread, cold icy blue reticle holds on the defect"],
    });
    expect(continuityBlocks(f)).toEqual([]);
  });

  it("BLOCKS an unregistered cast member", () => {
    const f = runContinuityQa({ cast: ["ghost" as never], designTexts: ["deep matte black bay"] });
    expect(continuityBlocks(f).some((x) => x.rule === "unknown-character")).toBe(true);
  });
});

describe("continuity QA — franchise contract", () => {
  it("BLOCKS a specific failure timeline", () => {
    const f = runContinuityQa({
      franchiseId: "rust_files",
      designTexts: ["graphite grey metal seam, corrosion spreading"],
      caption: "This bracket will fail within three weeks if it is not replaced.",
    });
    expect(continuityBlocks(f).some((x) => x.rule === "failure-deadline")).toBe(true);
  });

  it("allows a mechanism claim with no timeline", () => {
    const f = runContinuityQa({
      franchiseId: "rust_files",
      designTexts: ["graphite grey metal seam, corrosion spreading along the fastener"],
      caption: "Corrosion can weaken this connection over time.",
    });
    expect(continuityBlocks(f)).toEqual([]);
  });

  it("warns (not blocks) when cast drifts outside the show's regulars", () => {
    const f = runContinuityQa({
      franchiseId: "recall_radar",
      cast: ["tread"],
      designTexts: ["warm brushed gold beam over the assembly"],
    });
    expect(f.some((x) => x.rule === "cast-drift" && x.severity === "warn")).toBe(true);
    expect(continuityBlocks(f)).toEqual([]);
  });

  it("warns on off-palette colour — several studios, one page", () => {
    const f = runContinuityQa({ designTexts: ["a pastel lavender garage with peach lighting"] });
    expect(f.some((x) => x.rule === "off-palette")).toBe(true);
  });

  it("warns when no bible colour is named at all", () => {
    const f = runContinuityQa({ designTexts: ["a tire rotating on a floor"] });
    expect(f.some((x) => x.rule === "palette-absent")).toBe(true);
  });
});

describe("horizon derivation — never snap a reading to the wrong window", () => {
  it.each([[24, 24], [30, 24], [72, 72], [90, 72], [168, 168], [200, 168]])(
    "%ih after publish → horizon %i",
    (h, expected) => {
      expect(horizonForSnapshot(PUB, hoursAfter(PUB, h))).toBe(expected);
    },
  );

  it.each([5, 12, 19, 48, 120, 300])("%ih is outside every window → null, not the nearest bucket", (h) => {
    // Forcing a 5-hour reading into the 24h bucket would compare a post that is
    // still accruing against one that has settled.
    expect(horizonForSnapshot(PUB, hoursAfter(PUB, h))).toBeNull();
  });

  it("a capture before publish is never a horizon", () => {
    expect(horizonForSnapshot(PUB, hoursAfter(PUB, -3))).toBeNull();
  });
});

describe("continuity QA — must not block the vocabulary this content is made of", () => {
  // The first draft of the embodiment rule matched `body|standing|holds` and
  // rejected all of these. A rule that blocks correct designs gets disabled,
  // and then it protects nothing — so these are the load-bearing assertions.
  it.each([
    "macro on the body panel where corrosion starts",
    "rim-lit pothole edge with standing water",
    "the icy blue reticle holds on the shoulder puncture",
    "gold beam walks the length of the brake line",
    "deep matte black bay, single overhead work light",
  ])("passes legitimate design language: %s", (text) => {
    expect(continuityBlocks(runContinuityQa({ cast: ["nick_01"], designTexts: [text] }))).toEqual([]);
  });

  it("still blocks the actual failure mode it exists for", () => {
    const f = runContinuityQa({
      cast: ["nick_01"],
      designTexts: ["NICK-01 wearing black and gold overalls, visor down"],
    });
    expect(continuityBlocks(f).some((x) => x.rule === "narrator-embodied")).toBe(true);
  });
});
