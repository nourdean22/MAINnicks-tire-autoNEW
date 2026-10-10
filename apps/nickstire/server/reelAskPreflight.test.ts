/**
 * A LEAKED CALL TO ACTION USED TO COST A WHOLE RENDER.
 *
 * askLeakageProblem had exactly ONE caller - assembleReel - and assembly runs
 * after every clip has been generated and paid for. A brief whose voiceover or
 * beats carried a spoken ask was therefore bought in full and then refused at
 * the last gate, with the clips discarded.
 *
 * Two of the three reel failures on 2026-09-09 were exactly that: "refusing to
 * render: the voiceover contains a call to action (dm-us)" and a beat carrying
 * "send this to...". The gate's own comment records that all three freshly
 * generated briefs measured on 2026-08-29 had one.
 *
 * ROOT CAUSE, and the reason this kept happening: the three canonical sample
 * briefs each burned a CTA into beat 5, labelled "Soft CTA + loop handoff".
 * They are the app's reference examples of correct output. The system was
 * imitating a pattern its own renderer refuses.
 *
 * The preflight now names it before any clip is bought. Two properties are
 * pinned here, and the second matters as much as the first:
 *
 *   1. It checks only the IRREVERSIBLE surfaces - beats and voiceover. A caption
 *      is editable right up to publish, so a caption problem is not a reason to
 *      refuse a render.
 *   2. It is a WARN, not a block, and that is a deliberate, temporary state.
 *      A block regenerates the brief, and the leaking fixtures have not been
 *      swept yet. The render-time gate remains the hard stop.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runReelPreflight } from "../client/src/lib/facelessReelStudio";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";

const STUDIO = readFileSync(path.join(__dirname, "..", "client", "src", "lib", "facelessReelStudio.ts"), "utf8");
const ASSEMBLY = readFileSync(path.join(__dirname, "services", "reelAssembly.ts"), "utf8");

const sample = () => structuredClone(SAMPLE_REEL_BRIEFS[0]);

describe("a leaked ask is named before the money is spent", () => {
  it("a CTA in a BEAT is reported by preflight", () => {
    const b = sample();
    b.storyboardBeats[b.storyboardBeats.length - 1].onScreenText = "Comment BRAKES and we'll take a look";
    const findings = runReelPreflight(b).findings.filter((f) => /call to action/i.test(f.message));
    expect(findings.length, "a beat CTA reached the renderer unannounced").toBeGreaterThan(0);
  });

  it("a CTA in the VOICEOVER is reported by preflight", () => {
    const b = sample();
    b.voiceoverScript = "Your brakes are talking. DM us BRAKES and we'll take a look.";
    const findings = runReelPreflight(b).findings.filter((f) => /call to action/i.test(f.message));
    expect(findings.length, "a spoken ask reached the renderer unannounced").toBeGreaterThan(0);
  });

  it("a caption ask is NOT reported - captions stay editable until publish", () => {
    // The pre-spend gate refuses what SPENDING makes permanent. A caption is
    // not that, and blocking a render over one would be wrong.
    const b = sample();
    b.selectedCaption = "Comment BRAKES. Also stop by. Also call (216) 862-0005.";
    const findings = runReelPreflight(b).findings.filter((f) => /competing asks|caption asks/i.test(f.message));
    expect(findings).toHaveLength(0);
  });
});

describe("the canonical samples no longer teach the pattern", () => {
  it("no shipped sample brief carries an ask in a beat or the voiceover", () => {
    // These are the app's reference examples. While they modelled a beat CTA,
    // everything imitating them inherited a defect the renderer refuses.
    for (const brief of SAMPLE_REEL_BRIEFS) {
      const leaks = runReelPreflight(brief).findings.filter((f) => /call to action/i.test(f.message));
      expect(leaks, `${brief.id} still models a CTA in a permanent surface`).toHaveLength(0);
    }
  });

  it("every sample still PASSES preflight outright", () => {
    for (const brief of SAMPLE_REEL_BRIEFS) {
      const r = runReelPreflight(brief);
      expect(r.status, `${brief.id}: ${r.blocking.map((f) => f.message).join(" | ")}`).toBe("pass");
    }
  });
});

describe("the severity is a deliberate, documented halfway house", () => {
  it("it is a WARN today, and the reason is recorded next to it", () => {
    // If someone promotes this to a block without sweeping the fixtures, the
    // suite goes red for a reason unrelated to the defect. The comment is the
    // handover note; this asserts it is still there.
    const at = STUDIO.indexOf("if (leakedAsk) push(");
    expect(at).toBeGreaterThan(-1);
    expect(STUDIO.slice(at, at + 120)).toContain('"warn"');
    expect(STUDIO.slice(Math.max(0, at - 1400), at)).toContain("WARN, NOT BLOCK");
  });

  it("the RENDER-time gate is still a hard throw - nothing ships with a leak", () => {
    // The warn is an early notice, not a replacement. If this ever softens, a
    // leaked ask reaches a published reel.
    const at = ASSEMBLY.indexOf("askLeakageProblem(");
    expect(at, "the render gate is gone").toBeGreaterThan(-1);
    // Typed since 2026-10-10 so the pipeline parks the job on first contact
    // instead of spending its retry budget on a verdict that cannot change.
    expect(ASSEMBLY.slice(at, at + 500)).toContain("throw new ReelAssemblyRefusedError(`refusing to render");
  });

  it("the render gate still checks the CAPTION, which preflight deliberately skips", () => {
    const at = ASSEMBLY.indexOf("askLeakageProblem(");
    const block = ASSEMBLY.slice(at, at + 500);
    expect(block).toContain("caption:");
    expect(block).toContain("declaredAsk:");
  });
});
