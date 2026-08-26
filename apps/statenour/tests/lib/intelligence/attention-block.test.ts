/**
 * The quiet-domain block states counts, and never a precision it does not have.
 *
 * WHAT THIS WIRES. `lib/brain/attention-tracker.ts` had zero production
 * consumers. It works — probed against prod 2026-08-26, `analyzeAttentionPatterns`
 * returned in 393ms with three real neglected domains, all reading exactly 14.
 *
 * THE SENTINEL IS THE WHOLE TEST. `daysSinceEngagement` is `mention ?
 * actualDays : 14`, over a 14-day scan window. So `14` means "never seen in the
 * window" — the true figure could be 14 or 400. Rendering "14d silent" would
 * state a precision the data does not have. That is the same class of defect
 * this brief has been measured committing elsewhere (81.3% CRITICAL, inverted at
 * both extremes), so it does not get to enter through a new door.
 *
 * NOT RENDERED, deliberately: `focusScore` (live 0) and `attentionVelocity`
 * (live -50). Both are ratios over a filtered population whose denominator never
 * reaches the output. An alarming number with an invisible denominator is an
 * argument, not a fact; the counts beside it are checkable.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  renderAttentionBlock,
  ATTENTION_WINDOW_DAYS,
  type NeglectInput,
} from "@/lib/intelligence/attention-block";

/** The exact shape prod returned on 2026-08-26. */
const LIVE: NeglectInput[] = [
  { domain: "revenue", daysSinceEngagement: 14, hasGoal: false },
  { domain: "system", daysSinceEngagement: 14, hasGoal: false },
  { domain: "financial", daysSinceEngagement: 14, hasGoal: false },
];

describe("renderAttentionBlock · the sentinel must not become a measurement", () => {
  it("at the cap it says 'not in the last 14d', never '14d silent'", () => {
    const out = renderAttentionBlock(LIVE);
    expect(out).toContain(`not in the last ${ATTENTION_WINDOW_DAYS}d`);
    expect(out, "a saturated sentinel must not be printed as an exact age").not.toMatch(
      /\b14d quiet\b/,
    );
  });

  it("below the cap it prints the real number, because there it IS one", () => {
    const out = renderAttentionBlock([{ domain: "leads", daysSinceEngagement: 9, hasGoal: true }]);
    expect(out).toContain("9d quiet");
    expect(out).not.toContain(`not in the last ${ATTENTION_WINDOW_DAYS}d`);
  });

  it("a goal with no attention leads — it is a commitment, not a quiet topic", () => {
    const out = renderAttentionBlock([
      { domain: "revenue", daysSinceEngagement: 14, hasGoal: false },
      { domain: "body", daysSinceEngagement: 8, hasGoal: true },
    ]);
    expect(out).toMatch(/Goals with no attention:.*body/);
    expect(out.indexOf("Goals with no attention")).toBeLessThan(out.indexOf("no goal set"));
  });

  it("EMPTY IS NOT UNMEASURED: a measured zero says so, a failed read says otherwise", () => {
    // The two must never collapse. This is the same distinction the EmptyState
    // provenance work put on every panel.
    const measured = renderAttentionBlock([]);
    expect(measured).toMatch(/no domain has gone quiet/i);
    expect(measured).not.toContain("UNMEASURED");

    const failed = renderAttentionBlock(null);
    expect(failed).toContain("UNMEASURED");
    expect(failed).toMatch(/not a claim/i);
  });

  it("POSITIVE CONTROL: a real render names every domain it was given", () => {
    // Without this, a renderer that emitted only the heading would satisfy every
    // "does not contain" assertion above while saying nothing.
    const out = renderAttentionBlock(LIVE);
    for (const d of LIVE) expect(out).toContain(d.domain);
    expect(out).toContain("## Attention");
  });
});

describe("the wiring · rendered beside the model, never through it", () => {
  const composer = () => readFileSync("lib/intelligence/compose-daily-brief.ts", "utf8");

  it("the composer renders it and it reaches the returned text", () => {
    const src = composer();
    expect(src).toContain("renderAttentionBlock");
    expect(src).toContain("analyzeAttentionPatterns");
    expect(src).toMatch(/\$\{attentionBlock\}/);
  });

  it("THE CONTRACT: attentionBlock is NOT handed to generateText", () => {
    const src = composer();
    const promptStart = src.indexOf("const promptText =");
    const promptEnd = src.indexOf("const queue = await loadOperatorQueue()");
    expect(promptStart).toBeGreaterThan(-1);
    expect(promptEnd).toBeGreaterThan(promptStart);
    const promptRegion = src.slice(promptStart, promptEnd);
    expect(promptRegion).not.toContain("attentionBlock");
    expect(promptRegion).not.toContain("analyzeAttentionPatterns");
  });

  it("only the counts are wired — no derived scores", () => {
    // Guards the judgement call, not just the code. If someone later pipes the
    // derived scores in, this fails and makes them argue for it.
    //
    // Comments are stripped first: the composer EXPLAINS why those scores are
    // excluded, and naming them in prose is not wiring them. Caught by this very
    // test on its first run — the detector flagged its own rationale.
    const code = composer()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("focusScore");
    expect(code).not.toContain("attentionVelocity");
  });

  it("a failed read cannot take the block with it", () => {
    const src = composer();
    const at = src.indexOf("attentionBlock = renderAttentionBlock(profile.neglectedDomains)");
    expect(at).toBeGreaterThan(-1);
    const around = src.slice(Math.max(0, at - 250), at + 400);
    expect(around).toMatch(/try\s*\{/);
    expect(around).toMatch(/renderAttentionBlock\(null\)/);
  });
});
