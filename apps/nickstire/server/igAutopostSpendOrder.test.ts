/**
 * ig-autopost spends on pixels LAST (2026-10-08).
 *
 * Railway, 2026-10-07: three runs of 332–342 s and four of five runs posting
 * nothing. Each attempt generated the image, THEN evaluated the caption (which
 * never reads the image) and, after the loop, asked the independent judge
 * (which reads the concept, caption and image PROMPT, never the image). A
 * failed caption or a judge rejection therefore cost ~2.5 min and one image
 * credit for a verdict already decidable. The loop now runs caption eval →
 * judge → image; a live judge rejection REGENERATES (the old flow ended the
 * run and waited for the next tick), and the run aborts with the judge's
 * reason only when every attempt is spent, recording no image for the
 * rejected concept. The judge therefore sees up to MAX_REGEN_ATTEMPTS + 1
 * concepts per run instead of one.
 *
 * Source-order canary: `runIgAutopost` wires DB, LLM and image providers
 * internally, so the order is asserted on the loop's text, sliced between the
 * markers that bound it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sliceBlock } from "./testUtils/sourceBlock";

const SRC = readFileSync(path.join(__dirname, "services", "igAutopost.ts"), "utf8");
const loop = sliceBlock(SRC, "// Generate → eval, regenerating until pass or attempts exhausted.", "// ── DRYRUN ── log + Telegram preview", { label: "runIgAutopost generate loop" });

describe("runIgAutopost: caption, then judge, then pixels", () => {
  it("evaluates the caption and asks the judge before selectPostImage, inside the attempt loop", () => {
    const caption = loop.indexOf("await evalCaption(post, brief)");
    const judge = loop.indexOf("await judgeConcept(post, captionEval");
    const image = loop.indexOf("await selectPostImage(post)");
    expect(caption).toBeGreaterThan(-1);
    expect(judge).toBeGreaterThan(caption);
    expect(image).toBeGreaterThan(judge);
    // One image call, and it sits after both verdicts.
    expect(loop.split("await selectPostImage(post)")).toHaveLength(2);
  });

  it("a caption below threshold skips the image and says so in the eval line", () => {
    const skip = sliceBlock(loop, "if (!captionOnly.passed) {", "// JUDGE BEFORE PIXELS", { label: "caption-fail branch" });
    expect(skip).toContain("imageGenerated: false");
    expect(skip).toContain("continue;");
    expect(skip).not.toContain("selectPostImage");
  });

  it("a live judge rejection regenerates; the run aborts on the judge's reason only when no attempt survived; dryrun keeps previewing", () => {
    const reject = sliceBlock(loop, "if (!dryRun && judgeGate.block) {", "const image = await selectPostImage(post);", { label: "judge-reject branch" });
    expect(reject).toContain("continue;");
    expect(reject).not.toContain("break;");
    expect(reject).not.toContain("selectPostImage");
    const blocked = sliceBlock(loop, "if (!best && judgeBlocked) {", "// No draft cleared the gate", { label: "judge-blocked return" });
    expect(blocked).toContain("imageUrl: null");
    expect(blocked).toContain("error: `judge-blocked: ${reason}`");
    expect(blocked).toContain('status: "aborted"');
    expect(blocked).toContain("no image was generated for the rejected concept");
  });

  it("the judge is reached only through judgeConcept (one call site, once per caption-passing attempt), only when switched on, and the per-run call count is logged", () => {
    expect(SRC.split("judgeSingleConcept({")).toHaveLength(2);
    expect(loop).toContain("if (shadowJudge) judgeCalls++;");
    expect(loop).toContain("judgeCalls,");
    const helper = sliceBlock(SRC, "async function judgeConcept(", "function composeCaption(", { label: "judgeConcept" });
    expect(helper).toContain('if (process.env.IG_SHADOW_JUDGE === "false") return undefined;');
    expect(helper).toContain("return { error: errMsg(err).slice(0, 200) };");
    expect(helper).toContain("priority: dryRun ? 1 : 0");
  });
});
