/**
 * THE GENERATOR WAS WRITING HOOK 105 WITH NO KNOWLEDGE OF HOOKS 1 THROUGH 104.
 *
 * Instagram measures our first three seconds for us. `reels_skip_rate` is "the
 * percentage of views from people who skipped during the first 3 seconds", and
 * "how likely you are to watch less than three seconds" is a NAMED prediction
 * in Meta's published Reels ranking documentation. This app has collected it
 * into ig_metric_snapshots since migration 0108.
 *
 * Measured against production 2026-09-09, one row per post, latest snapshot:
 *
 *   41 published posts carry a skip rate; corpus mean 66.4%
 *   best hook 39.8%, worst 92.9%
 *   Pearson r between skip rate and reach: -0.633 (n=41)
 *
 * Nothing fed any of that back to the writer. These pins cover the two ways
 * that loop can go wrong: teaching the model nothing when we DO know something,
 * and teaching it something when we DO NOT.
 */
import { describe, it, expect } from "vitest";
import {
  buildHookEvidenceFragment,
  NO_HOOK_EVIDENCE,
  MIN_HOOK_SAMPLE,
  type MeasuredHookEvidence,
} from "./services/hookPerformance";
import { readFileSync } from "node:fs";
import path from "node:path";

const GEN = readFileSync(path.join(__dirname, "services", "reelBriefGen.ts"), "utf8");

const good: MeasuredHookEvidence = {
  available: true,
  sampleSize: 41,
  corpusMeanSkipPct: 66.4,
  best: [
    { hook: "What's hiding under your car?", skipPct: 39.8, reach: 257 },
    { hook: "Is this your windshield after a light rain?", skipPct: 42.3, reach: 354 },
  ],
  worst: [
    { hook: "Cleveland's undercarriage 'weather report'.", skipPct: 83.0, reach: 147 },
    { hook: "Cleveland winters bring more than just snow...", skipPct: 82.9, reach: 144 },
  ],
};

describe("the scoreboard teaches from real numbers", () => {
  it("names the corpus mean, the sample size, and both ends", () => {
    const f = buildHookEvidenceFragment(good);
    expect(f).toContain("66.4%");
    expect(f).toContain("41 published reels");
    expect(f).toContain("What's hiding under your car?");
    expect(f).toContain("Cleveland winters bring more than just snow...");
    expect(f).toContain("39.8%");
  });

  it("separates what held viewers from what lost them", () => {
    const f = buildHookEvidenceFragment(good);
    const held = f.indexOf("HELD VIEWERS");
    const lost = f.indexOf("LOST VIEWERS");
    expect(held).toBeGreaterThan(-1);
    expect(lost).toBeGreaterThan(held);
    // the best hook must sit in the held half, not the lost half
    expect(f.indexOf("What's hiding under your car?")).toBeGreaterThan(held);
    expect(f.indexOf("What's hiding under your car?")).toBeLessThan(lost);
  });

  it("tells the model to study the difference, not copy the wording", () => {
    // Copying a winning hook verbatim would repeat its subject, which the
    // distinctiveness scoring penalises. The scoreboard must not fight it.
    expect(buildHookEvidenceFragment(good)).toContain("rather than copying their wording");
  });
});

describe("and says NOTHING when it knows nothing", () => {
  it("an unreadable history produces an EMPTY fragment, not an empty scoreboard", () => {
    // "Your best hooks were: (nothing)" after a database blip would teach the
    // generator from an outage. Absent evidence must produce absent guidance.
    expect(buildHookEvidenceFragment(NO_HOOK_EVIDENCE)).toBe("");
  });

  it("too small a sample produces an empty fragment", () => {
    const thin: MeasuredHookEvidence = {
      ...good, sampleSize: MIN_HOOK_SAMPLE - 1, corpusMeanSkipPct: 50,
    };
    expect(buildHookEvidenceFragment(thin)).toBe("");
  });

  it("a mean with no examples behind it produces an empty fragment", () => {
    expect(buildHookEvidenceFragment({ ...good, best: [], worst: [] })).toBe("");
  });

  it("available with no mean produces an empty fragment", () => {
    expect(buildHookEvidenceFragment({ ...good, corpusMeanSkipPct: null })).toBe("");
  });
});

describe("the generator actually receives it", () => {
  it("reelBriefGen builds the fragment and appends it to the system prompt", () => {
    // A scoreboard nothing reads is the defect this whole file exists to avoid.
    expect(GEN).toContain("getMeasuredHookEvidence");
    expect(GEN).toContain("buildHookEvidenceFragment");
    expect(GEN).toContain("systemPrompt +=");
  });

  it("an empty fragment appends nothing at all", () => {
    const region = GEN.slice(GEN.indexOf("buildHookEvidenceFragment"));
    expect(region.slice(0, 300)).toContain("if (fragment)");
  });

  it("a failure to read the scoreboard never stops a reel being written", () => {
    const region = GEN.slice(GEN.indexOf("getMeasuredHookEvidence") - 800);
    const block = region.slice(0, 1600);
    expect(block).toContain("try {");
    expect(block).toContain("catch");
    expect(block).toContain("log.warn");
  });
});
