import { describe, it, expect } from "vitest";
import { stripUnfoundedVerdicts, stripVerdictFromTitle } from "./estimateWording";

const hasUnfoundedVerdict = (s: string) => stripUnfoundedVerdicts(s).dropped > 0;

// Each verdict is paired with the hedged or neutral phrasing of the same thought, which must stay.
const PAIRS: Array<[verdict: string, clean: string]> = [
  ["Replacing the pads is necessary.", "Resurfacing if necessary, otherwise replacement."],
  ["Your brakes are dangerous.", "Worn pads could become dangerous over time."],
  ["Driving on this tire is unsafe.", "Replacement is not necessary if the tread passes."],
  ["This needs attention immediately.", "We check the rotors as the pads come off."],
  ["This is an urgent repair.", "The job takes one to two hours."],
];

describe("estimate wording detector", () => {
  it.each(PAIRS)("flags %j and keeps %j", (verdict, clean) => {
    expect(hasUnfoundedVerdict(verdict)).toBe(true);
    expect(hasUnfoundedVerdict(clean)).toBe(false);
  });

  it("drops only the offending sentences and counts them", () => {
    const r = stripUnfoundedVerdicts("It is dangerous. Parts vary by brand! Act immediately? Tax extra.");
    expect(r).toEqual({ text: "Parts vary by brand! Tax extra.", dropped: 2 });
  });

  it("does not flag words that merely contain a verdict word", () => {
    expect(hasUnfoundedVerdict("An unnecessary upsell is never quoted.")).toBe(false);
  });

  it("strips the verdict word from a title and leaves a clean title alone", () => {
    expect(stripVerdictFromTitle("Urgent Front Brake Replacement")).toEqual({ text: "Front Brake Replacement", dropped: 1 });
    expect(stripVerdictFromTitle("Front Brake Replacement")).toEqual({ text: "Front Brake Replacement", dropped: 0 });
  });
});
