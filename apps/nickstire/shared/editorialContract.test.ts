import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkEditorialContract, type EditorialBeat } from "./editorialContract";

const beat = (n: number, visual: string, onScreenText: string, seconds = 4): EditorialBeat => ({
  beatNumber: n, startSecond: (n - 1) * seconds, endSecond: n * seconds, visual, onScreenText, purpose: "",
});
const clean = (): EditorialBeat[] => [
  beat(1, "REAL macro of the worn edge", "ONE EDGE WORN SMOOTH. WHY?"),
  beat(2, "REAL gauge in the groove", "INNER 3/32. OUTER 7/32."),
  beat(3, "DETERMINISTIC card", "FOUR THINGS CAN DO THIS"),
  beat(4, "REAL alignment screen", "THE INSPECTION SAYS WHICH"),
  beat(5, "REAL macro again, then the exterior", "ONE EDGE WORN? GET IT CHECKED"),
];
const rules = (beats: EditorialBeat[]) => checkEditorialContract(beats).map((f) => f.rule);

describe("checkEditorialContract", () => {
  it("CONTROL: a Reel that follows the contract has no findings", () => {
    expect(checkEditorialContract(clean())).toEqual([]);
  });
  it("a logo or brand plate on frame one is the first thing it refuses", () => {
    const b = clean(); b[0] = beat(1, "logo animation on black, then the shop name", "NICK'S TIRE & AUTO");
    expect(rules(b)).toEqual(["logo_never_opens"]);
  });
  it("generic opening footage is flagged as having no subject", () => {
    const b = clean(); b[0] = beat(1, "generic moving car on a highway, stock footage", "TIRES MATTER");
    expect(rules(b)).toEqual(["frame_one_subject"]);
  });
  it("two ideas on one long card are flagged; a short two-sentence hook is not", () => {
    const b = clean(); b[2] = beat(3, "DETERMINISTIC card", "ALIGNMENT PULLS ONE EDGE DOWN. LOW PRESSURE WEARS BOTH EDGES AT ONCE.");
    expect(rules(b)).toEqual(["one_idea_per_card"]);
    expect(rules(clean())).toEqual([]); // "ONE EDGE WORN SMOOTH. WHY?" is two sentences, five words
  });
  it("a CTA before the last beat is flagged; the last beat's single CTA is not", () => {
    const b = clean(); b[1] = beat(2, "REAL gauge", "BOOK AN INSPECTION TODAY");
    expect(rules(b)).toEqual(["cta_last"]);
  });
  it("two different calls to action on the last card are flagged", () => {
    const b = clean(); b[4] = beat(5, "REAL macro", "CALL US OR BOOK ONLINE");
    expect(rules(b)).toEqual(["single_cta"]);
  });
  it("an end card held past two seconds is flagged; a closing evidence shot of any length is not", () => {
    const b = clean(); b[4] = { ...beat(5, "end card with logo and address", "VISIT US"), startSecond: 16, endSecond: 20 };
    expect(rules(b)).toEqual(["end_card_length"]);
    const ok = clean(); ok[4] = { ...ok[4], startSecond: 16, endSecond: 20 };
    expect(rules(ok)).toEqual([]);
  });
  it("beats are read in beatNumber order even when supplied out of order", () => {
    const b = clean().reverse();
    expect(checkEditorialContract(b)).toEqual([]);
  });
  it("the three proof packs satisfy the contract", () => {
    for (const slug of ["2026-10-08-proof-01-uneven-wear", "2026-10-08-proof-02-highway-shake", "2026-10-08-proof-03-patch-or-replace"]) {
      const brief = JSON.parse(readFileSync(new URL(`../docs/reel-packs/${slug}/brief.json`, import.meta.url), "utf8"));
      expect(checkEditorialContract(brief.storyboardBeats)).toEqual([]);
    }
  });
});
