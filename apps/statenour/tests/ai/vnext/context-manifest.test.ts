/**
 * Context Manifest tests (lib/ai/vnext/context-manifest.ts — log-only).
 *
 * Pins the load-bearing property: the manifest splits on the SAME
 * `\n## ` boundary as trimPromptToBudget, so `###` sub-blocks fuse into
 * their parent section here exactly as the trimmer sees them (the #1450
 * fusion class stays visible instead of smoothed over).
 */

import { describe, it, expect } from "vitest";
import { buildContextManifest } from "@/lib/ai/vnext/context-manifest";

const PROMPT = [
  "You are Nick.",
  "## TRUTH RULE",
  "Never claim past-tense action without a tool call.",
  "## CONTENT ENGINE",
  "### Sub-block A",
  "aaa",
  "### Sub-block B",
  "bbb",
  "## Response style",
  "Short.",
].join("\n");

describe("buildContextManifest", () => {
  it("splits on the trimmer's boundary with a preamble section", () => {
    const m = buildContextManifest(PROMPT);
    expect(m.sections.map((s) => s.title)).toEqual([
      "(preamble)",
      "TRUTH RULE",
      "CONTENT ENGINE",
      "Response style",
    ]);
  });

  it("### sub-blocks FUSE into their parent section (the #1450 visibility property)", () => {
    const m = buildContextManifest(PROMPT);
    const engine = m.sections.find((s) => s.title === "CONTENT ENGINE")!;
    // Both sub-blocks' bytes count against CONTENT ENGINE, none appear as sections.
    expect(m.sections.some((s) => s.title.includes("Sub-block"))).toBe(false);
    expect(engine.chars).toBeGreaterThan("CONTENT ENGINE".length + 10);
  });

  it("section chars sum to the whole prompt", () => {
    const m = buildContextManifest(PROMPT);
    const sum = m.sections.reduce((a, s) => a + s.chars, 0);
    expect(sum).toBe(PROMPT.length);
    expect(m.promptChars).toBe(PROMPT.length);
  });

  it("hash is stable for identical prompts and distinct for different ones", () => {
    expect(buildContextManifest(PROMPT).promptHash).toBe(buildContextManifest(PROMPT).promptHash);
    expect(buildContextManifest(PROMPT).promptHash).not.toBe(buildContextManifest(PROMPT + "x").promptHash);
    expect(buildContextManifest(PROMPT).promptHash).toHaveLength(16);
  });

  it("top lists the largest sections first, bounded by topN", () => {
    const m = buildContextManifest(PROMPT, 2);
    expect(m.top).toHaveLength(2);
    expect(m.top[0].chars).toBeGreaterThanOrEqual(m.top[1].chars);
  });

  it("handles an empty prompt without throwing", () => {
    const m = buildContextManifest("");
    expect(m.sectionCount).toBe(1);
    expect(m.promptChars).toBe(0);
  });
});
