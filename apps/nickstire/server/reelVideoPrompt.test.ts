import { describe, it, expect } from "vitest";
import { buildStructuredVideoPrompt, promptShapeProblem, REQUIRED_BLOCKS } from "@shared/reelVideoPrompt";

// Shaped after a REAL persisted payload (job 1770003, read from prod 2026-08-29).
const beat = {
  visual: "Salt crystals clinging to a rusted rocker panel in winter light.",
  motion: "Slow push-in on the salt crystals, revealing their texture.",
  audioCue: "Low, ominous drone with a faint metallic scrape.",
};

describe("buildStructuredVideoPrompt", () => {
  it("emits the observed model block format", () => {
    const p = buildStructuredVideoPrompt(beat);
    for (const b of REQUIRED_BLOCKS) expect(p).toContain(`${b}:`);
    expect(promptShapeProblem(p)).toBeNull();
  });

  it("DELIVERS motion and audioCue, which reelPipeline used to leave unread", () => {
    const p = buildStructuredVideoPrompt(beat);
    expect(p).toContain("Slow push-in");
    expect(p).toContain("metallic scrape");
  });

  it("job 1770004's shape — motion present, audioCue absent — still builds", () => {
    const p = buildStructuredVideoPrompt({ visual: "A worn bushing.", motion: "Slow push-in, subtle flex." });
    expect(promptShapeProblem(p)).toBeNull();
    expect(p).not.toContain("AUDIO:");
  });

  it("OMITS empty blocks rather than emitting a bare label", () => {
    const p = buildStructuredVideoPrompt({ visual: "A tire." });
    expect(p).not.toContain("AUDIO:");
    expect(p).not.toContain("CINEMATOGRAPHY:");
  });
});

describe("promptShapeProblem — THE CANARY", () => {
  it("FAILS a prose-only prompt, which is exactly what regression looks like", () => {
    const r = promptShapeProblem("A worn brake pad on a workbench. The camera pushes in slowly.");
    expect(r).toContain("not a structured shot spec");
    expect(r).toContain("SUBJECT");
  });

  it("FAILS when one required block is dropped", () => {
    const p = buildStructuredVideoPrompt(beat).replace(/^ACTION AND CAMERA MOTION:.*$/m, "");
    expect(promptShapeProblem(p)).toContain("ACTION AND CAMERA MOTION");
  });

  it("FAILS an empty prompt", () => {
    expect(promptShapeProblem("")).toContain("empty");
  });

  it("POSITIVE CONTROL: the checker is not vacuously failing everything", () => {
    expect(promptShapeProblem(buildStructuredVideoPrompt(beat))).toBeNull();
  });
});
