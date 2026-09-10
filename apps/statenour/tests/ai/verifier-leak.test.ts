/**
 * VERIFIER LEAK tests -- 2026-09-10.
 *
 * Audit finding #4: two disclosure systems fighting each other. The
 * structured CONTEXT & EVIDENCE panel is the right surface and already
 * ships; the generation/persist layers ALSO prepend a raw system trace
 * into the assistant's own message text, which the operator then reads
 * mid-conversation in Nick's voice:
 *
 *   "[VERIFIER . v10.0.162] (warn) The response below claimed an action
 *    (pinned) but no matching tool call fired..."
 *   "[VERIFIER NOTE: my previous response was flagged as fabricated.
 *    Disregard it. Do not reference it.]"
 *
 * `stripVerifierBanner` was written for exactly this in 2026-07-11 --
 * its docstring says "the warning chip already conveys the diagnostic
 * visually" -- and had zero production callers for two months. These
 * tests pin the wiring, and pin it BEHAVIOURALLY: they build a banner
 * with the real builder and assert the real strip removes it, so a
 * change to either side fails here rather than silently un-wiring the
 * fix. (The marker literal is duplicated in fabrication-rewriter.ts and
 * sanitize-history.ts to dodge a circular import, with nothing guarding
 * the drift -- the round-trip below is that guard.)
 */
import { describe, it, expect } from "vitest";
import {
  buildVerifierBanner,
  stripVerifierBanner,
  isVerifierRewritten,
} from "@/lib/ai/chat/fabrication-rewriter";
import { sanitizeMessageHistory } from "@/lib/ai/chat/sanitize-history";

const ORIGINAL = "Pinned it to the top of your board. Go run.";

describe("banner never reaches the bubble", () => {
  it("round-trips: strip removes exactly what the builder added", () => {
    const rewritten =
      buildVerifierBanner("The response below claimed an action (pinned) but no matching tool call fired.") +
      ORIGINAL;
    expect(isVerifierRewritten(rewritten)).toBe(true);
    expect(stripVerifierBanner(rewritten)).toBe(ORIGINAL);
  });

  it("the stripped text carries no system notation at all", () => {
    const rewritten = buildVerifierBanner("no matching tool call fired.") + ORIGINAL;
    const shown = stripVerifierBanner(rewritten);
    expect(shown).not.toMatch(/VERIFIER/i);
    expect(shown).not.toMatch(/unverified/i);
    // The banner's own copy is first-person ("ask me to retry -- I'll
    // fire the tool this time"), which is precisely why it must not be
    // rendered as Nick's words.
    expect(shown).not.toMatch(/I'll fire the tool/i);
  });

  // CONTROL: an ordinary reply must pass through byte-identical, or the
  // strip is mangling real answers rather than removing traces.
  it("CONTROL - ordinary text is returned untouched", () => {
    expect(stripVerifierBanner(ORIGINAL)).toBe(ORIGINAL);
    expect(isVerifierRewritten(ORIGINAL)).toBe(false);
  });

  it("CONTROL - text that merely mentions the word verifier is not stripped", () => {
    const t = "The verifier flagged something earlier, but the answer stands.";
    expect(stripVerifierBanner(t)).toBe(t);
  });
});

describe("model history carries no first-person self-correction", () => {
  function history(assistantText: string) {
    return sanitizeMessageHistory([
      { role: "user", parts: [{ type: "text", text: "pin that for me" }] },
      { role: "assistant", parts: [{ type: "text", text: assistantText }] },
      { role: "user", parts: [{ type: "text", text: "did it work?" }] },
    ]);
  }

  it("neutralizes a banner-prefixed prior turn", () => {
    const rewritten = buildVerifierBanner("claimed an action but no tool fired.") + ORIGINAL;
    const out = history(rewritten);
    const text = out[1].parts?.[0]?.text ?? "";
    expect(text).not.toContain(ORIGINAL);
    expect(text).toMatch(/removed by system/i);
  });

  /**
   * The actual leak vector. The old note was written in the first person
   * and handed to the model AS ITS OWN prior assistant turn -- so the
   * model had a ready-made sentence in its own voice saying "disregard
   * my previous response", and reproduced that register in the next
   * reply. Third-person metadata gives it nothing to copy.
   */
  it("the replacement note is third-person, with no quotable first-person line", () => {
    const rewritten = buildVerifierBanner("claimed an action but no tool fired.") + ORIGINAL;
    const text = history(rewritten)[1].parts?.[0]?.text ?? "";
    expect(text).not.toMatch(/\bmy previous response\b/i);
    expect(text).not.toMatch(/\bDisregard it\b/);
    expect(text).not.toMatch(/^\s*I\b/m);
  });

  // CONTROL: a clean prior turn must survive intact, or the neutralizer
  // is eating real conversation history.
  it("CONTROL - a clean prior turn is left alone", () => {
    const out = history(ORIGINAL);
    expect(out[1].parts?.[0]?.text).toBe(ORIGINAL);
  });
});
