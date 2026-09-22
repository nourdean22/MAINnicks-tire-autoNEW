/**
 * Contract + canaries for the operator-repair harvester.
 *
 * Per AGENTS.md > "Ship the canary, not just the control": this miner IS a
 * control — it decides which production turns become regression scenarios. A
 * miner with bad precision does not fail loudly; it quietly fills the corpus
 * with the wrong cases, and every test later derived from it inherits the
 * error. So the two defects the first production run actually exposed each get
 * an assertion, not a comment.
 *
 * Both were found by reading 19 real candidates by hand, not by the counts:
 *   1. REPETITION vs MEMORY_MISS differ ONLY by pronoun direction.
 *   2. "keep going" / "go deeper" are CONTINUATION — said while satisfied.
 * The second is the dangerous one. It is sign-flipped: harvesting it builds a
 * regression corpus out of turns where Nick did WELL.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyRepair,
  isShortReply,
  isPlausibleRepairLength,
  REPAIR_CLASSES,
  REPAIR_PATTERNS,
} from "@/scripts/harvest-repair-signals";

describe("repair-signal matcher", () => {
  // The import above is itself the canary for the entry guard: without it,
  // module scope calls main(), which queries production and would take this
  // worker down. If this file collects at all, the guard held.
  it("is importable without executing main()", () => {
    expect(typeof classifyRepair).toBe("function");
    expect(REPAIR_PATTERNS.length).toBeGreaterThan(0);
  });

  it("fires on explicit operator corrections", () => {
    for (const text of [
      "you told me that already",
      "you didn't actually create the task",
      "that's not what I asked",
      "why didn't you search for it",
      "I already told you that",
      "that's outdated",
      "stop lecturing me",
      "try again",
      "that's too generic",
    ]) {
      expect(classifyRepair(text), `should have matched: ${text}`).not.toBeNull();
    }
  });

  // ── Canary 1 · pronoun direction ────────────────────────────────────
  // An earlier draft matched `already (told|said) (me|you)` with no subject
  // anchor, so BOTH directions scored REPETITION. That does not fail loudly:
  // it files every memory-miss under the operator's loudest complaint and
  // makes the corpus look like it measures repetition while hiding a
  // different failure inside it.
  it("distinguishes REPETITION from MEMORY_MISS by pronoun direction alone", () => {
    const nickRepeated = classifyRepair("you already told me that");
    const nickForgot = classifyRepair("I already told you that");
    expect(nickRepeated?.failureClass).toBe("REPETITION");
    expect(nickForgot?.failureClass).toBe("MEMORY_MISS");
    expect(nickRepeated?.failureClass).not.toBe(nickForgot?.failureClass);
  });

  // ── Canary 2 · the sign-flip ────────────────────────────────────────
  it("does NOT treat continuation as a complaint", () => {
    // Every string here was a real matched candidate in the first production
    // run. Each is the operator ENGAGED, not dissatisfied. Harvesting them
    // would train regression tests on Nick's successes.
    for (const text of [
      "Keep going keep interesting me",
      "I'm loving the advice let's keep going zoom in more less about pain too.",
      "Go deeper on Recorded",
      "dig deeper",
    ]) {
      expect(classifyRepair(text), `continuation must not match: ${text}`).toBeNull();
    }
  });

  it("does NOT treat first-person narration as a repair", () => {
    // This operator converses; second-person past tense is ordinary speech.
    for (const text of [
      "OK well good morning so yesterday like I told you after the aircraft carrier we went back",
      "I told the supplier we needed them by Tuesday",
      "like i know i can do better and all i can think about is a new women",
      "Yeah then two seconds later having to tell myself the same thing again eventually I forget",
    ]) {
      expect(classifyRepair(text), `narration must not match: ${text}`).toBeNull();
    }
  });

  it("keeps the weak tier out of prose", () => {
    // A bare "no" IS a repair; "no" inside a sentence is not. Without the
    // length guard the weak tier would dominate every reported rate.
    expect(classifyRepair("no")?.tier).toBe("weak");
    expect(classifyRepair("no rush on this, whenever you get to it is fine")).toBeNull();
    expect(isShortReply("no")).toBe(true);
    expect(isShortReply("x".repeat(100))).toBe(false);
  });

  it("keeps medium-tier content patterns out of pasted documents", () => {
    const short = "that's too generic";
    const pasted = `${short} — ${"padding. ".repeat(120)}`;
    expect(classifyRepair(short)).not.toBeNull();
    expect(isPlausibleRepairLength(pasted)).toBe(false);
    expect(classifyRepair(pasted), "a pasted document is content, not a repair").toBeNull();
  });

  it("every pattern names a declared failure class", () => {
    for (const p of REPAIR_PATTERNS) {
      expect(REPAIR_CLASSES).toContain(p.failureClass);
    }
  });
});

describe("harvester source contract", () => {
  const src = readFileSync(
    resolve(process.cwd(), "scripts/harvest-repair-signals.ts"),
    "utf8",
  );

  // Same contract as tests/brain/recall-corpus-builder.test.ts pins on
  // harvest-eval-corpus.ts. This miner reads the most sensitive slice of the
  // corpus — by construction it selects the turns where the operator was
  // annoyed — so read-only is asserted from source, not assumed from intent.
  it.each([
    ["create", /\.create(Many)?\s*\(/],
    ["update", /\.update(Many)?\s*\(/],
    ["delete", /\.delete(Many)?\s*\(/],
  ])("never calls prisma .%s()", (_name, pattern) => {
    expect(src).not.toMatch(pattern);
  });

  it("writes only to the gitignored eval-datasets dir by default", () => {
    expect(src).toMatch(/eval-datasets\//);
  });

  it("exits non-zero when a source failed, so a stopped flywheel cannot read as healthy", () => {
    const tail = src.slice(src.indexOf("if (degraded)"));
    expect(tail).toContain("process.exit(1)");
  });

  it("refuses to harvest when its own matcher self-test fails", () => {
    // The single most likely wrong answer this script can give is a zero, and
    // a zero from a broken matcher is indistinguishable from a clean corpus.
    // The self-test gate is what makes those two cases different.
    expect(src).toMatch(/runSelfTest\(\) !== 0/);
    expect(src).toContain("refusing to harvest");
  });

  it("reports every rate against a stated denominator", () => {
    // The repo's recurring defect class: a filtered ratio with no base rate.
    expect(src).toContain("operatorMessagesScanned");
    expect(src).toMatch(/NO DATA \(denominator is zero\)/);
  });
});
