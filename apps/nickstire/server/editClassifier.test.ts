/**
 * The edit classifier turns "operator changed the draft" into graded training
 * signal. It must detect the high-confidence failure modes and never invent a
 * category on a no-op edit. Pure and deterministic — no DB, no LLM.
 */
import { describe, it, expect } from "vitest";
import { classifyEdit, tallyEditCategories } from "./services/editClassifier";

describe("classifyEdit", () => {
  it("returns nothing for a no-op or empty edit", () => {
    expect(classifyEdit("same text", "same text")).toEqual([]);
    expect(classifyEdit("", "anything")).toEqual([]);
    expect(classifyEdit("anything", "")).toEqual([]);
  });

  it("flags too_long when the operator sharply trims a long draft", () => {
    const draft = "Thanks so much for your message! ".repeat(6) + "We would be absolutely delighted to help you with your vehicle today.";
    const cats = classifyEdit(draft, "Yep, come on by — we'll take care of it.");
    expect(cats).toContain("too_long");
  });

  it("flags too_robotic when a corporate phrase is removed", () => {
    expect(classifyEdit("Thank you for reaching out! We can help with that.", "We can help with that. Come by any time."))
      .toContain("too_robotic");
  });

  it("flags unnecessary_price when the operator drops a price", () => {
    expect(classifyEdit("An oil change is $49, come on by.", "Come on by for an oil change, we'll sort you out."))
      .toContain("unnecessary_price");
  });

  it("flags price_changed when the operator corrects a price", () => {
    const cats = classifyEdit("Used tires are $49 installed.", "Used tires are $60 installed.");
    expect(cats).toContain("price_changed");
    expect(cats).not.toContain("unnecessary_price");
  });

  it("flags added_invitation when the operator adds a CTA the draft lacked", () => {
    expect(classifyEdit("We do brakes and tires.", "We do brakes and tires — drop it off any day and we'll check it free."))
      .toContain("added_invitation");
  });

  it("flags too_aggressive when a pushy phrase is removed", () => {
    expect(classifyEdit("You need to act now before it's too late!", "Whenever works for you — we're here 7 days."))
      .toContain("too_aggressive");
  });

  it("flags full_rewrite when almost nothing carries over", () => {
    expect(classifyEdit("Our synthetic blend package is available.", "Pull up whenever, first come first served."))
      .toContain("full_rewrite");
  });

  it("falls back to minor_edit for a small tweak with no detectable pattern", () => {
    expect(classifyEdit("We can take a look at that today.", "We can take a look at that for you today."))
      .toEqual(["minor_edit"]);
  });
});

describe("tallyEditCategories", () => {
  it("counts categories across rows and ignores nulls", () => {
    const tally = tallyEditCategories([["too_long", "too_robotic"], ["too_long"], null, ["added_invitation"], undefined]);
    expect(tally).toEqual({ too_long: 2, too_robotic: 1, added_invitation: 1 });
  });
});
