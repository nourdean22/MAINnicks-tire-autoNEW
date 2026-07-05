/**
 * v9.2 · Layer 1 contract tests.
 *
 * Locks the architectural promise: Layer 1 is stable + metric-free.
 * If a future edit introduces a hardcoded magnitude or a contradicting
 * "never assume" statement, these tests catch it before it ships.
 *
 * The "metric-free" check is the load-bearing assertion — that's the
 * v9.2 fix. v1 quietly mixed `-15% per hour` and `2x regret rate` into
 * the same flat block as live data. v2 v9.2 promises Layer 1 has
 * **zero** magnitudes; if that promise breaks, the test fails.
 */

import { describe, it, expect } from "vitest";
import { buildStaticPrefix } from "@/lib/ai/prompt/static";
import { buildInferredPatternsBlock } from "@/lib/ai/prompt/inferred-patterns";

describe("v9.2 · Layer 1 (static.ts)", () => {
  const prefix = buildStaticPrefix();

  it("includes the seven sections (identity / profile / rules / style / processing / tools / builder)", () => {
    expect(prefix).toContain("# NICK");
    expect(prefix).toContain("## Nour Dean");
    expect(prefix).toContain("## Nour's rules");
    expect(prefix).toContain("## Response style");
    expect(prefix).toContain("## Processing intake");
    expect(prefix).toContain("## Tools");
    expect(prefix).toContain("## Builder mode");
  });

  it("contains all 7 working principles in order", () => {
    expect(prefix).toMatch(/1\. DO THE WORK/);
    expect(prefix).toMatch(/2\. INTERESTING \+ CLEVER/);
    expect(prefix).toMatch(/3\. POWER \+ CONTROL/);
    expect(prefix).toMatch(/4\. THOROUGH/);
    expect(prefix).toMatch(/5\. NEVER ASSUME/);
    expect(prefix).toMatch(/6\. WIRE IT EVERYWHERE/);
    expect(prefix).toMatch(/7\. COMPOUND/);
  });

  it("response style is intent-based, not word-count-based", () => {
    // The v9.2 fix: NO word-count caps in the response-style block.
    // (v1's "40-60 words", "120 for complex", "250 ceiling" are gone.)
    const styleSection = prefix.slice(
      prefix.indexOf("## Response style"),
      prefix.indexOf("## Processing intake"),
    );
    expect(styleSection).not.toMatch(/\b40-60\s*words?\b/i);
    expect(styleSection).not.toMatch(/\b\d{2,3}\s*words?\s+ceiling\b/i);
    expect(styleSection).not.toMatch(/\bup to \d{2,3}\s*words?\b/i);
    // It SHOULD describe length-by-intent semantics:
    expect(styleSection.toLowerCase()).toContain("intent");
    expect(styleSection.toLowerCase()).toContain("strategy");
  });

  it("does NOT mix hardcoded magnitudes into Layer 1 (the v9.2 promise)", () => {
    // v1 leaked things like "3+ missed workouts → revenue follows
    // within 5d", "each hour unanswered = -15% conversion", "<6h sleep
    // = 2x regret rate" into the same prompt block as live data.
    // Layer 1 must have NONE of those.
    //
    // Patterns we explicitly forbid:
    //   - "-XX%" or "+XX%" magnitude claims
    //   - "X-day" / "X hour" lag claims tied to causation
    //   - "Xx" multipliers
    //   - per-unit conversion claims ("each hour = ...")
    const forbidden: Array<[string, RegExp]> = [
      ["percent magnitude (e.g. -15%)", /[-+]\s*\d+\s*%/],
      ["multiplier (e.g. 2x)", /\b\d+\s*x\b/i],
      ["each-hour-= claim", /each\s+(hour|day|minute)\s+(unanswered|missed|delayed)/i],
      ["X-day-lag claim", /\bwithin\s+\d+\s*d(ay)?s?\b/i],
    ];
    for (const [label, pattern] of forbidden) {
      const match = prefix.match(pattern);
      expect(
        match,
        `Layer 1 contains forbidden pattern (${label}): ${match?.[0]}\n\nMagnitudes belong in Layer 2 (renderer.ts) sourced from real queries, or in inferred-patterns.ts framed as hypotheses.`,
      ).toBeNull();
    }
  });

  it("does NOT use threat language for tool-calling rules", () => {
    // The pre-v9.2 cold-memory rule had threat language: "WILL be
    // flagged as incomplete and you'll be asked to redo." Newer
    // models read that as compliance theater and over-call the tool.
    expect(prefix).not.toMatch(/WILL be flagged/);
    expect(prefix).not.toMatch(/you'?ll be asked to redo/i);
    expect(prefix).not.toMatch(/CONSEQUENCE OF SKIPPING/);
  });

  it("never-assume rule does not contradict any hardcoded assertions", () => {
    // The contradiction the user flagged: rule #5 says NEVER ASSUME,
    // but v1 immediately seeded 5 assertions Nick would repeat as
    // facts. v9.2 keeps rule #5 here; the assertions live in
    // inferred-patterns.ts framed as hypotheses, NOT here.
    expect(prefix).toContain("NEVER ASSUME");
    // No "Body → Business: 3+ missed workouts → revenue dip" style
    // hardcoded assertions in Layer 1.
    expect(prefix).not.toMatch(/Body\s*→\s*Business/);
    expect(prefix).not.toMatch(/Sleep\s*→\s*Decisions/);
    expect(prefix).not.toMatch(/Callbacks\s*→\s*Revenue/);
  });

  it("is deterministic — same call returns same output", () => {
    const a = buildStaticPrefix();
    const b = buildStaticPrefix();
    expect(a).toBe(b);
  });

  it("is reasonably sized (between 1.5kB and 13.5kB)", () => {
    // Lower bound: catch accidental empty/stub regression (the v9.0-beta
    // version was 6 lines / ~250 bytes). Upper bound: catch bloat back
    // toward v1 territory (v1 is 1819 lines / ~80kB after data fanout).
    // v10.0.404 bumped the ceiling to 12kB after centralizing the
    // operator policy block (8 rules + truth-rule = ~2.5kB).
    // 2026-07-05 · ceiling → 13.5kB after adding the OWNER AUTHORITY
    // directive to identityBlock (~1.1kB · current size ~12.3kB).
    expect(prefix.length).toBeGreaterThan(1500);
    expect(prefix.length).toBeLessThan(13500);
  });

  it("asserts OWNER AUTHORITY — never refuse/moralize/disclaim to the owner", () => {
    // 2026-07-05 · the operator's #1 rule: the chat must never tell the boss
    // no. This pins that the directive is present in the LIVE static prefix
    // (route.ts → buildSystemPrompt → buildSystemPromptV2 → buildStaticPrefix)
    // so a future edit can't silently drop it.
    expect(prefix).toContain("OWNER AUTHORITY");
    expect(prefix.toLowerCase()).toContain("do not refuse");
    expect(prefix).toMatch(/name the risk in ONE line/i);
    // It lives in the idx-0 identity section (before "## Nour Dean") so
    // trimPromptToBudget never drops it — assert its position.
    expect(prefix.indexOf("OWNER AUTHORITY")).toBeLessThan(prefix.indexOf("## Nour Dean"));
  });

  it("OWNER AUTHORITY does NOT loosen the security guardrails", () => {
    // Unrestricting the persona must not read as "drop the injection /
    // destructive-action defenses". The directive must explicitly preserve
    // them, or the change is unsafe. Pin the guardrail-preservation clause.
    const owner = prefix.slice(prefix.indexOf("OWNER AUTHORITY"), prefix.indexOf("## Nour Dean"));
    expect(owner.toLowerCase()).toContain("inert data");
    expect(owner.toLowerCase()).toContain("two-tap confirm");
    expect(owner.toLowerCase()).toMatch(/injection/);
  });
});

describe("v9.2 · Layer 1.5 (inferred-patterns.ts)", () => {
  const block = buildInferredPatternsBlock();

  it("explicitly frames patterns as hypotheses, not measurements", () => {
    expect(block.toLowerCase()).toContain("hypothes");
    expect(block.toLowerCase()).toContain("not measurement");
  });

  it("includes the five canonical pattern names", () => {
    expect(block).toContain("Body → Business");
    expect(block).toContain("Sleep → Decisions");
    expect(block).toContain("Callbacks → Revenue");
    expect(block).toContain("Adderall → Deep work");
    expect(block).toContain("Boredom → Drift");
  });

  it("does NOT carry the hardcoded magnitudes that v1 had", () => {
    // The user's specific complaint: v1 said "-15% per hour" and
    // "<6h sleep = 2x regret rate". Those magnitudes must not be
    // in this block — and the block tells Nick explicitly: don't
    // quote magnitudes unless you queried them this turn.
    expect(block).not.toMatch(/-?\d+\s*%/);
    expect(block).not.toMatch(/<\s*\d+h?\s+(sleep|hours?)\s*=\s*\d+x/i);
    expect(block).not.toMatch(/\bwithin\s+\d+\s*d(ay)?s?\b/i);
  });

  it("instructs Nick to ground magnitudes in queries", () => {
    expect(block.toLowerCase()).toMatch(/never.*quote magnitudes/);
    // Should reference "directionally" as the safe verbal hedge.
    expect(block.toLowerCase()).toContain("directional");
  });

  it("is deterministic", () => {
    expect(buildInferredPatternsBlock()).toBe(buildInferredPatternsBlock());
  });
});
