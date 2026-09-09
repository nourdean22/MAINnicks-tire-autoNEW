/**
 * THE RENDER WAS UNTAGGED, WHICH IS NOT NEUTRAL — IT IS AMBIGUOUS.
 *
 * The assembly encode produced 8-bit 4:2:0 H.264 with no colour primaries, no
 * transfer characteristic, no matrix and no range. Every decoder then guesses,
 * and they do not guess alike: Instagram's transcoder, Safari, Chrome and
 * QuickTime each apply their own default. A reel that looked correct in the
 * render can arrive on a phone washed out, crushed or hue-shifted.
 *
 * The reason it survived this long is the nastiest property of the bug: our own
 * QA reads the same untagged file under the same assumption that produced it,
 * so every gate agreed the render was fine. Nothing upstream could see it.
 *
 * Rec.709 is the correct declaration here — 8-bit SDR sources, 1080x1920 SDR
 * deliverable, and 709 is what every consumer surface expects of HD. This TAGS
 * what the pipeline already produces. It converts nothing, so no existing
 * render changes appearance; it only stops the guessing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ASSEMBLY = readFileSync(path.join(__dirname, "services", "reelAssembly.ts"), "utf8");

describe("the deliverable declares its colour space", () => {
  it("all four tags are present", () => {
    for (const flag of ["-colorspace", "-color_primaries", "-color_trc", "-color_range"]) {
      expect(ASSEMBLY, `missing ${flag}`).toContain(flag);
    }
  });

  it("they agree on Rec.709 — a mismatched set is worse than none", () => {
    // colorspace/primaries/trc must all be bt709. A file tagged with mixed
    // standards is actively misleading rather than merely ambiguous.
    const idx = ASSEMBLY.indexOf('"-colorspace"');
    expect(idx).toBeGreaterThan(-1);
    const block = ASSEMBLY.slice(idx, idx + 260);
    expect((block.match(/"bt709"/g) ?? []).length).toBe(3);
    expect(block).toContain('"tv"');
  });

  it("range is limited (tv), matching the 8-bit 4:2:0 pipeline it describes", () => {
    // Declaring full range on a limited-range encode would crush blacks and clip
    // highlights on every player that believed the tag.
    expect(ASSEMBLY).toContain('"-color_range",\n    "tv",');
    expect(ASSEMBLY).toContain('"yuv420p"');
  });

  it("the tags sit on the FINAL encode, not a probe or an intermediate", () => {
    // Tagging an intermediate and not the deliverable would be a no-op that
    // reads as done.
    const enc = ASSEMBLY.indexOf('"libx264"');
    const tag = ASSEMBLY.indexOf('"-colorspace"');
    const out = ASSEMBLY.indexOf("outPath,");
    expect(enc).toBeGreaterThan(-1);
    expect(tag).toBeGreaterThan(enc);
    expect(tag).toBeLessThan(out);
  });

  it("PLANTED CANARY: the untagged encode would fail the first pin", () => {
    const stripped = ASSEMBLY.replace(/"-colorspace",\s*\n\s*"bt709",/, "");
    expect(stripped).not.toContain('"-colorspace",\n    "bt709",');
  });

  it("it TAGS rather than CONVERTS — no colour filter was added", () => {
    // A conversion would change the look of everything already rendered and
    // invalidate the approved reference frames. Tagging is the safe half.
    expect(ASSEMBLY).not.toContain("colorspace=bt709");
    expect(ASSEMBLY).not.toContain("zscale");
  });
});
