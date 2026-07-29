/**
 * Pattern Lab pins: the adaptation formatter's hard 800-char handoff budget,
 * priority of the Nick adaptation, and the anti-scrape + fail-closed contracts
 * on the router (code-shaped raw anchors — see igEvidence.test.ts for why no
 * comment stripping).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatPatternAdaptation, type ReelPattern } from "../shared/reelPatterns";

const FULL: ReelPattern = {
  id: "rp_test",
  label: "Pothole gremlin cause-loop",
  sourceLabel: "seen on explore",
  hookType: "impossible_object",
  pacing: { totalSeconds: 18, beatCount: 5, avgShotLength: 3.5, firstTextAtSecond: 1 },
  visualStyle: { lens: "cinematic macro", lighting: "dark shop, gold rim light", color: "amber on black", motion: "slow push-in", texture: "tactile miniature" },
  captionStyle: { wordsPerBeat: 6, placement: "upper third", hierarchy: "headline_only" },
  audioStyle: { musicMood: "tense build", voiceover: false, sfx: ["metal clink", "air hiss"] },
  loopType: "cause_loop",
  shareTrigger: "Send this to someone who blames the tire after every pothole",
  saveTrigger: "One reusable truth: alignment moves before the tire looks hurt",
  nickAdaptation: "Gremlin steals a wheel weight; alignment lines bend; THE TIRE GETS BLAMED / BUT THE ALIGNMENT MOVED; gremlin waits again.",
};

describe("formatPatternAdaptation", () => {
  it("fits the handoff's hard 800-char budget with every load-bearing field present", () => {
    const out = formatPatternAdaptation(FULL);
    expect(out.length).toBeLessThanOrEqual(800);
    expect(out).toContain("hook: impossible_object");
    expect(out).toContain("loop: cause_loop");
    expect(out).toContain("18s, 5 beats");
    expect(out).toContain("NICK VERSION:");
    expect(out).toContain("STRUCTURE only");
  });

  it("still fits 800 under absurdly long inputs, and the Nick adaptation survives truncation", () => {
    const bloated: ReelPattern = {
      ...FULL,
      label: "L".repeat(500),
      visualStyle: { lens: "x".repeat(500), lighting: "y".repeat(500), color: "z".repeat(500), motion: "m".repeat(500), texture: "t".repeat(500) },
      shareTrigger: "s".repeat(500),
      saveTrigger: "k".repeat(500),
      nickAdaptation: "NICK-TRUTH-CORE " + "a".repeat(500),
    };
    const out = formatPatternAdaptation(bloated);
    expect(out.length).toBeLessThanOrEqual(800);
    expect(out).toContain("NICK VERSION: NICK-TRUTH-CORE");
  });
});

describe("router contract pins", () => {
  const SRC = readFileSync(resolve(process.cwd(), "server/routers/instagramAdmin.ts"), "utf8");
  // Scope EXACTLY to the pattern procs (list → end of recordPatternUse) — an
  // end-of-file slice swept unrelated later procs into the anti-scrape pin.
  const start = SRC.indexOf("listReelPatterns:");
  const useStart = SRC.indexOf("recordPatternUse:", start);
  const end = SRC.indexOf("return { ok: true };", useStart);
  const BLOCK = SRC.slice(start, end);

  it("saveReelPattern is strict and REQUIRES a real Nick adaptation", () => {
    expect(BLOCK).toContain("nickAdaptation: z.string().trim().min(10)");
    const save = BLOCK.slice(BLOCK.indexOf("saveReelPattern:"), BLOCK.indexOf("deleteReelPattern:"));
    expect(save).toContain(".strict())");
  });

  it("delete and use-recording fail CLOSED on unreadable driver results", () => {
    const tail = BLOCK.slice(BLOCK.indexOf("deleteReelPattern:"));
    expect(tail.split("affectedRowCount").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("ANTI-SCRAPE: the pattern procs never fetch — sourceUrl is a citation, not an asset", () => {
    expect(BLOCK).not.toContain("fetch(");
  });
});
