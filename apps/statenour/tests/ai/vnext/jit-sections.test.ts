/**
 * JIT section gate tests (lib/ai/vnext/jit-sections.ts).
 *
 * Pins the evidence-shaped behavior: the three hit-list sections drop
 * ONLY on casual + content turns (where the A/Bs showed the cut is
 * free-or-winning) and survive every grounded turn (where the bigger
 * A/B showed the cut loses). Fail-open on unknown input; kill-switch
 * restores the incumbent prompt byte-identically.
 */

import { afterEach, describe, it, expect } from "vitest";
import { applyJitSectionGate, JIT_SECTION_PREFIXES } from "@/lib/ai/vnext/jit-sections";

const PROMPT = [
  "# NICK · identity",
  "## TRUTH RULE",
  "Never claim past-tense action without a tool call.",
  "## ACTIVE AGENDA ITEMS",
  "- [commitment] Call the supplier",
  "## Behavioral patterns · hypotheses, not measurements",
  "- Body→Business",
  "## Processing intake",
  "How to process brain dumps.",
  "## Response style",
  "Short.",
].join("\n");

afterEach(() => {
  delete process.env.NICK_JIT_SECTIONS;
});

describe("applyJitSectionGate", () => {
  it("drops all three sections on a casual turn, keeps everything else", () => {
    const r = applyJitSectionGate(PROMPT, "hey what's up");
    expect(r.reason).toBe("casual");
    expect(r.dropped).toHaveLength(3);
    for (const prefix of JIT_SECTION_PREFIXES) {
      expect(r.prompt).not.toContain(prefix);
    }
    expect(r.prompt).toContain("## TRUTH RULE");
    expect(r.prompt).toContain("## Response style");
  });

  it("drops on a content turn (the census content scenario phrasing)", () => {
    const r = applyJitSectionGate(PROMPT, "write me an instagram carousel about winter tire safety");
    expect(r.reason).toBe("content");
    expect(r.dropped).toHaveLength(3);
  });

  it("keeps everything on grounded turns — the cases the bigger A/B said the sections win", () => {
    for (const msg of [
      "Should I raise prices at the shop?",
      "What did we decide about expansion, and why?",
      "What should I focus on today and why?",
      "Draft a two-line SMS to a customer whose estimate has been sitting a week.",
      "I have $80K. Open a second tire shop, or reinvest?",
    ]) {
      const r = applyJitSectionGate(PROMPT, msg);
      expect(r.reason, msg).toBeNull();
      expect(r.prompt, msg).toBe(PROMPT);
    }
  });

  it("fails open on empty/null messages (unknown turn keeps context)", () => {
    expect(applyJitSectionGate(PROMPT, null).prompt).toBe(PROMPT);
    expect(applyJitSectionGate(PROMPT, "   ").prompt).toBe(PROMPT);
  });

  it("kill-switch NICK_JIT_SECTIONS=0 restores incumbent behavior byte-identically", () => {
    process.env.NICK_JIT_SECTIONS = "0";
    const r = applyJitSectionGate(PROMPT, "hey what's up");
    expect(r.prompt).toBe(PROMPT);
    expect(r.dropped).toHaveLength(0);
  });

  it("no-ops on prompts that don't carry the sections", () => {
    const bare = "## TRUTH RULE\nx\n## Response style\ny";
    const r = applyJitSectionGate(bare, "hey what's up");
    expect(r.prompt).toBe(bare);
    expect(r.reason).toBeNull();
  });
});
