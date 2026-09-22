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
  DEFAULT_OUT_PATH,
  HARVEST_OUT_DIR,
  isShortReply,
  isPlausibleRepairLength,
  reclassifyByReply,
  resolveOutPath,
  REPAIR_CLASSES,
  REPAIR_PATTERNS,
  type RepairMatch,
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
    // Each string stands in for a real matched candidate from the first
    // production run — same trigger phrase, same tense, private specifics
    // replaced (review on #2480). Each is the operator ENGAGED, not
    // dissatisfied. Harvesting them would train regression tests on Nick's
    // successes.
    for (const text of [
      "Keep going, this is exactly the kind of thing I wanted.",
      "Loving this so far, let's keep going and zoom in on the second point.",
      "Go deeper on the second option.",
      "dig deeper",
    ]) {
      expect(classifyRepair(text), `continuation must not match: ${text}`).toBeNull();
    }
  });

  it("does NOT treat first-person narration as a repair", () => {
    // This operator converses; second-person past tense is ordinary speech.
    // Synthetic stand-ins, same shape as the measured false positives.
    for (const text of [
      "OK so yesterday, like I told you after the trip, we went back to the shop.",
      "I told the supplier we needed them by Tuesday",
      "like I know I can do better and all I can think about is the next quarter.",
      "Then two minutes later I'm telling myself the same thing again and eventually I forget.",
    ]) {
      expect(classifyRepair(text), `narration must not match: ${text}`).toBeNull();
    }
  });

  // Fixtures that dropped their trigger would abstain trivially and guard
  // nothing. Each synthetic stand-in must still carry the phrase that fooled
  // the first draft — checked here so a future "tidy-up" cannot hollow them out.
  it("the synthetic abstain fixtures still carry the trigger phrases they guard against", () => {
    expect("Keep going, this is exactly the kind of thing I wanted.").toMatch(/keep going/i);
    expect("Loving this so far, let's keep going and zoom in on the second point.").toMatch(/keep going/i);
    expect("Go deeper on the second option.").toMatch(/go deeper/i);
    expect("OK so yesterday, like I told you after the trip, we went back to the shop.").toMatch(/i told you/i);
    expect("like I know I can do better and all I can think about is the next quarter.").toMatch(/do better/i);
    expect("Then two minutes later I'm telling myself the same thing again and eventually I forget.").toMatch(
      /the same thing again/i,
    );
    // And the second-person forms of the same phrases DO fire — the guard is
    // direction and judgement, not the words.
    expect(classifyRepair("you can do better than that")?.failureClass).toBe("GENERIC");
    expect(classifyRepair("you gave me the same thing again")?.failureClass).toBe("REPETITION");
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

  // ── Output boundary (review on #2480) ─────────────────────────────────
  // The old assertion here was `src` contains "eval-datasets/" — satisfied by
  // any comment. The boundary is now a function, tested on its behaviour, and
  // main() is pinned to route --out through it on comment-stripped source.
  describe("output path boundary", () => {
    const cwd = resolve("/repo/apps/statenour");
    const inside = (p: string) => resolve(cwd, HARVEST_OUT_DIR, p);

    it("defaults to a file inside eval-datasets/", () => {
      expect(resolveOutPath(null, cwd)).toBe(inside("repair-signal-candidates.json"));
      expect(DEFAULT_OUT_PATH.startsWith(`${HARVEST_OUT_DIR}/`)).toBe(true);
    });

    it("accepts a relative or absolute path that resolves to a file inside eval-datasets/", () => {
      expect(resolveOutPath("eval-datasets/other.json", cwd)).toBe(inside("other.json"));
      expect(resolveOutPath("eval-datasets/sub/dir/x.json", cwd)).toBe(inside("sub/dir/x.json"));
      expect(resolveOutPath(inside("abs.json"), cwd)).toBe(inside("abs.json"));
    });

    it.each([
      ["the header's old example — a tracked path", "other.json"],
      ["a sibling directory", "../eval-datasets-2/x.json"],
      ["traversal back out of the directory", "eval-datasets/../secrets.json"],
      ["the directory itself", "eval-datasets"],
      ["an absolute path elsewhere", resolve("/tmp/candidates.json")],
    ])("refuses %s", (_label, raw) => {
      expect(() => resolveOutPath(raw, cwd)).toThrow(/must resolve inside eval-datasets\//);
    });

    it("main() routes --out through the boundary, and the bare fallback is gone", () => {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      expect(code).toMatch(/const outPath = resolveOutPath\(arg\("--out"\)\)/);
      expect(code).not.toMatch(/arg\("--out"\)\s*\?\?/);
    });
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

describe("reclassifyByReply · the reply names what 'try again' cannot", () => {
  const generic: RepairMatch = { tier: "medium", failureClass: "UNDER_RESEARCH", label: "go-deeper" };

  it("POSITIVE CONTROL: a plain reply leaves a generic hit untouched", () => {
    expect(reclassifyByReply(generic, "Here are three options, ranked by effort.")).toEqual(generic);
  });

  // Both of these scored ZERO in the first production run, because the operator
  // does not phrase them — the reply does.
  // ⚠ A banner alone is contaminated evidence: 32 of 41 banners in 60 days were
  // English false positives, and every banner-then-retry pair in that corpus
  // was one of them (docs/audits/claim-banner-classification-2026-09-22.md).
  // The promotion therefore needs today's detector to agree on the ORIGINAL
  // text — the part after the banner — and without a replay it does not happen.
  const bannered =
    "[VERIFIER · v10.0.162] ⚠ The response below claimed actions (task-create, I've added) but no matching tool call fired. Treat the claim as **unverified**.\n\n_Original response (unverified):_\n\nDone. Both tasks created. Your Monday plate is set.";

  it("a verifier banner the current detector still agrees with makes 'try again' a FALSE_COMPLETION", () => {
    const seen: string[] = [];
    const stillFlagged = (original: string) => {
      seen.push(original);
      return true;
    };
    expect(reclassifyByReply(generic, bannered, stillFlagged)).toEqual({
      tier: "strong",
      failureClass: "FALSE_COMPLETION",
      label: "verifier-banner-then-retry",
    });
    // the replay sees the ORIGINAL response, never the banner text
    expect(seen).toEqual(["\n\nDone. Both tasks created. Your Monday plate is set."]);
  });

  it("a banner the current detector RETRACTS keeps the repair generic and labels it", () => {
    expect(reclassifyByReply(generic, bannered, () => false)).toEqual({
      ...generic,
      label: "go-deeper·verifier-banner-retracted",
    });
  });

  it("no replay available → no promotion (a banner alone is not evidence)", () => {
    expect(reclassifyByReply(generic, bannered)).toEqual({
      ...generic,
      label: "go-deeper·verifier-banner-retracted",
    });
  });

  it("an unbannered reply reaches the replay unchanged (nothing to strip)", () => {
    const seen: string[] = [];
    const plainBanner = "[VERIFIER · v10.0.162] ⚠ claimed actions but no tool call fired. Pinned.";
    reclassifyByReply(generic, plainBanner, (o) => {
      seen.push(o);
      return true;
    });
    expect(seen).toEqual([plainBanner]);
  });

  it("a tool-unavailable reply makes 'try again' a NO_TOOL — the dominant real pattern", () => {
    for (const reply of [
      "Web search is unavailable. The API key was reported as leaked.",
      "No web search this session, so going from knowledge:",
      "Still nothing. GitHub tools aren't attached to this session.",
      "Can't search the web right now — no tool attached this turn.",
    ]) {
      expect(reclassifyByReply(generic, reply), reply).toEqual({
        tier: "strong",
        failureClass: "NO_TOOL",
        label: "tool-unavailable-then-retry",
      });
    }
  });

  it("AVAILABILITY is not unavailability — 'search is available / alive' must NOT flip to NO_TOOL", () => {
    for (const reply of [
      "Good — web search is available this turn. Tell me what you want and I'll pull real sources.",
      "Web search is alive. The first pass was generic — let me hit harder.",
      "Web search is available this turn. Hitting the actual stacks you run.",
    ]) {
      expect(reclassifyByReply(generic, reply), reply).toEqual(generic);
    }
  });

  it("NOISE is not unavailability — 'search isn't pulling the right results' stays under-research", () => {
    expect(
      reclassifyByReply(generic, "Search isn't pulling the right results from my end — came back with noise, not videos."),
    ).toEqual(generic);
  });

  it("an operator who NAMED the failure is believed over the reply", () => {
    const named: RepairMatch = { tier: "strong", failureClass: "MEMORY_MISS", label: "i-already-told-you" };
    expect(reclassifyByReply(named, "[VERIFIER · v10.0.162] ⚠ claimed actions but no tool call fired")).toEqual(named);
  });

  it("no paired reply → unchanged", () => {
    expect(reclassifyByReply(generic, null)).toEqual(generic);
  });

  it("reads only the reply's OPENING, so a late aside about search does not flip a real answer", () => {
    const reply = `${"Here are five videos worth your drive. ".repeat(20)} (note: web search is unavailable for the sixth)`;
    expect(reply.length).toBeGreaterThan(600);
    expect(reclassifyByReply(generic, reply)).toEqual(generic);
  });
});
