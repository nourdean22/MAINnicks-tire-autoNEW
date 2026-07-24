/**
 * compactCaption regression tests (Wave 2, 2026-07-24).
 *
 * compact()'s `\s+ → " "` ran on every generated caption, flattening it to one
 * unbroken line: Instagram captions live on paragraph breaks, and the
 * evaluator reads the caption's FIRST LINE (`caption.split(/\n+/)`) to score
 * hook strength — so the collapse both published walls of text and corrupted
 * the score that was supposed to catch weak hooks.
 */
import { describe, expect, it } from "vitest";
import { compactCaption, evaluateInstagramDraft } from "./services/instagramStudio";

describe("compactCaption preserves caption structure", () => {
  it("keeps paragraph breaks while collapsing runs of spaces within lines", () => {
    const raw = "Cold    mornings expose weak tread.\n\nSwing by   Nick's for a free check.\n\nNo appointment needed.";
    expect(compactCaption(raw, 2200)).toBe(
      "Cold mornings expose weak tread.\n\nSwing by Nick's for a free check.\n\nNo appointment needed.",
    );
  });

  it("caps blank runs at one empty line and trims line ends", () => {
    const raw = "Hook line.   \n\n\n\nBody paragraph.\t\nCTA line.";
    expect(compactCaption(raw, 2200)).toBe("Hook line.\n\nBody paragraph.\nCTA line.");
  });

  it("still enforces the length ceiling", () => {
    expect(compactCaption("x".repeat(3000), 2200)).toHaveLength(2200);
  });

  it("a multi-paragraph caption keeps its first line distinct for hook scoring", () => {
    const caption = compactCaption("Your brakes gave you three warnings this week.\n\nHere is what each one means and when to come in.", 2200);
    const strong = evaluateInstagramDraft({
      source: { type: "manual_idea", detail: "brake education" },
      format: "post",
      caption,
      headline: "Three brake warnings",
      subheadline: "What each one means",
      artDirection: "brake rotor close-up",
    });
    const flattened = evaluateInstagramDraft({
      source: { type: "manual_idea", detail: "brake education" },
      format: "post",
      // The pre-fix behavior: the whole caption is one line, so the "first
      // line" the hook scorer sees is the entire caption.
      caption: caption.replace(/\s+/g, " "),
      headline: "Three brake warnings",
      subheadline: "What each one means",
      artDirection: "brake rotor close-up",
    });
    const hook = (r: ReturnType<typeof evaluateInstagramDraft>) => r.dimensions.find((d) => d.key === "hook_strength")!;
    // The structured caption's hook line must never score WORSE than the same
    // text flattened — if this fails, first-line extraction regressed.
    expect(hook(strong).score).toBeGreaterThanOrEqual(hook(flattened).score);
  });
});
